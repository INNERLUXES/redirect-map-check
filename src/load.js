// Reads the three inputs: the old site's URLs, the new site's URLs and the redirect map.
// URL files are a sitemap, a sitemap index with its child sitemaps in a local folder, or a list with one URL per line.
// Redirect maps are CSV (including Shopify and Magento style exports), Apache Redirect lines or simple nginx rules.
// Everything is read from local files; nothing is fetched.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readSitemapXml } from './xml.js';

export const LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxUrls: 1000000,
  maxNesting: 32
};

export const MAP_FORMATS = ['csv', 'apache', 'nginx'];
export const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

// Column names of a CSV header, as pairs of source and target, in lower case.
export const CSV_HEADERS = [
  ['from', 'to'],
  ['redirect from', 'redirect to'],
  ['request_path', 'target_path'],
  ['source', 'target'],
  ['old url', 'new url']
];
const STATUS_HEADERS = ['status', 'status code', 'code', 'redirect_type', 'redirect type'];

const REGEX_RULE = 'a rule with a regular expression is not evaluated; list the URLs it covers in a CSV map to check them';

function short(text, max = 200) {
  const s = String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function mb(bytes) {
  return `${bytes / 1024 / 1024} MB`;
}

// Reads a file as UTF-8 after checking that it is a regular file within the size limit.
export async function readBounded(path, limits = LIMITS) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path}: not a file`);
  if (info.size > limits.maxFileBytes) throw new Error(`${path}: ${info.size} bytes is over the ${mb(limits.maxFileBytes)} limit`);
  return (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
}

function overLimit(limits) {
  return `more than ${limits.maxUrls.toLocaleString('en-US')} URLs, which is over the limit; split the check into smaller parts`;
}

// One URL per line; blank lines and lines starting with # are skipped.
export function parseUrlList(text, limits = LIMITS) {
  const urls = [];
  for (const raw of String(text).split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    urls.push(line);
    if (urls.length > limits.maxUrls) throw new Error(overLimit(limits));
  }
  return urls;
}

export function looksLikeXml(text) {
  return /^\s*</.test(text);
}

// The file name a sitemap index points to: the last part of the address, which must be a plain file name.
export function childSitemapName(loc) {
  const path = String(loc).split(/[?#]/)[0];
  let name = path.slice(path.lastIndexOf('/') + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the name as written
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : null;
}

// Reads a URL file. A sitemap index is read only through --sitemap-dir: each child sitemap must be a file
// of the same name in that folder. The tool never fetches a child sitemap.
export async function loadUrls(path, options = {}) {
  const limits = options.limits || LIMITS;
  const text = await readBounded(path, limits);
  if (!looksLikeXml(text)) {
    try {
      return { source: path, kind: 'list', urls: parseUrlList(text, limits), files: [path] };
    } catch (error) {
      throw new Error(`${path}: ${error.message}`);
    }
  }
  let doc;
  try {
    doc = readSitemapXml(text, limits.maxUrls);
  } catch (error) {
    throw new Error(`${path}: not a sitemap the tool can read: ${error.message}`);
  }
  if (doc.kind === 'urlset') return { source: path, kind: 'sitemap', urls: doc.locs, files: [path] };

  if (!options.sitemapDir) {
    throw new Error(`${path}: a sitemap index that lists ${doc.locs.length} sitemap(s); save them in one folder and give it with --sitemap-dir (the tool never fetches them)`);
  }
  const urls = [];
  const files = [];
  for (const loc of doc.locs) {
    const name = childSitemapName(loc);
    if (!name) throw new Error(`${path}: the sitemap "${short(loc, 120)}" does not end in a plain file name`);
    if (/\.gz$/i.test(name)) throw new Error(`${path}: ${name} is compressed; unpack it into --sitemap-dir and list the unpacked name`);
    const file = join(options.sitemapDir, name);
    let childText;
    try {
      childText = await readBounded(file, limits);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`${path}: lists ${short(loc, 120)}, but ${file} does not exist; save it in --sitemap-dir`);
      throw error;
    }
    let child;
    try {
      child = readSitemapXml(childText, limits.maxUrls);
    } catch (error) {
      throw new Error(`${file}: not a sitemap the tool can read: ${error.message}`);
    }
    if (child.kind !== 'urlset') throw new Error(`${file}: a sitemap index inside a sitemap index is not read`);
    for (const url of child.locs) {
      urls.push(url);
      if (urls.length > limits.maxUrls) throw new Error(`${path}: ${overLimit(limits)}`);
    }
    files.push(file);
  }
  return { source: path, kind: 'sitemap index', urls, files };
}

// ---------- CSV ----------

// Rows of a CSV file as RFC 4180 defines them, each with the line it starts on. Rows with only empty cells are dropped.
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (c === '\n') line += 1;
        cell += c;
      }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = [];
      cell = '';
      line += 1;
      rowLine = line;
    } else cell += c;
  }
  if (quoted) throw new Error(`a quoted cell that starts on line ${rowLine} is not closed`);
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push({ line: rowLine, cells: row });
  }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

function looksLikeUrl(cell) {
  return /^\s*(?:\/|https?:\/\/)/i.test(cell || '');
}

function readStatus(raw) {
  const n = Number(raw);
  return /^\d{3}$/.test(raw) && REDIRECT_STATUSES.includes(n) ? n : null;
}

// A CSV map: a header with a known pair of column names, or two columns (from, to) and an optional third (status) without one.
export function parseCsvMap(text) {
  const rows = parseCsvRows(text);
  const rules = [];
  const unsupported = [];
  if (!rows.length) return { format: 'csv', rules, unsupported };
  let fromCol = 0;
  let toCol = 1;
  let statusCol = 2;
  let start = 0;
  if (!looksLikeUrl(rows[0].cells[0])) {
    const head = rows[0].cells.map((c) => c.trim().toLowerCase());
    const pair = CSV_HEADERS.find(([f, t]) => head.includes(f) && head.includes(t));
    if (!pair) {
      throw new Error(`the first row is neither a redirect nor a header with known columns (${CSV_HEADERS.map(([f, t]) => `"${f}","${t}"`).join(', ')})`);
    }
    fromCol = head.indexOf(pair[0]);
    toCol = head.indexOf(pair[1]);
    statusCol = head.findIndex((h) => STATUS_HEADERS.includes(h));
    start = 1;
  }
  for (const r of rows.slice(start)) {
    const from = (r.cells[fromCol] || '').trim();
    const to = (r.cells[toCol] || '').trim();
    const statusText = statusCol >= 0 ? (r.cells[statusCol] || '').trim() : '';
    const text = r.cells.join(',');
    if (!from || !to) {
      unsupported.push({ line: r.line, text, reason: 'the source or the target cell is empty' });
      continue;
    }
    let status = null;
    if (statusText) {
      status = readStatus(statusText);
      if (status === null) {
        unsupported.push({ line: r.line, text, reason: `status "${short(statusText, 20)}" is not a redirect status (301, 302, 303, 307 or 308)` });
        continue;
      }
    }
    rules.push({ from, to, status, line: r.line });
  }
  return { format: 'csv', rules, unsupported };
}

// ---------- Apache ----------

const APACHE_IGNORED = new Set(['rewriteengine', 'rewritebase', 'rewriteoptions', 'options', 'directoryindex', 'errordocument', 'header', 'setenvif', 'addtype', 'addhandler']);
const APACHE_STATUS_WORDS = { permanent: 301, temp: 302, seeother: 303, gone: 410 };

function words(line) {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
}

// Apache mod_alias lines: Redirect [status] /path target, RedirectPermanent and RedirectTemp.
// Redirect without a status sends 302, as Apache does. RedirectMatch and mod_rewrite rules are reported, not guessed.
export function parseApacheMap(text) {
  const rules = [];
  const unsupported = [];
  String(text).split(/\r\n?|\n/).forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;
    if (!line || line.startsWith('#') || line.startsWith('<')) return;
    const w = words(line);
    const directive = w[0].toLowerCase();
    if (directive === 'redirect' || directive === 'redirectpermanent' || directive === 'redirecttemp') {
      const args = w.slice(1);
      let status = directive === 'redirectpermanent' ? 301 : 302;
      if (directive === 'redirect' && args.length && !looksLikeUrl(args[0])) {
        const word = args.shift().toLowerCase();
        status = Object.hasOwn(APACHE_STATUS_WORDS, word) ? APACHE_STATUS_WORDS[word] : /^\d{3}$/.test(word) ? Number(word) : null;
        if (status === null) {
          unsupported.push({ line: number, text: line, reason: `"${short(word, 20)}" is not a status Apache knows` });
          return;
        }
      }
      if (!REDIRECT_STATUSES.includes(status)) {
        unsupported.push({ line: number, text: line, reason: `status ${status} is not a redirect, so the URL is not redirected` });
        return;
      }
      if (args.length !== 2) {
        unsupported.push({ line: number, text: line, reason: 'a Redirect line needs a source path and a target' });
        return;
      }
      rules.push({ from: args[0], to: args[1], status, line: number });
    } else if (directive === 'redirectmatch' || directive === 'rewriterule' || directive === 'rewritecond') {
      unsupported.push({ line: number, text: line, reason: REGEX_RULE });
    } else if (!APACHE_IGNORED.has(directive)) {
      unsupported.push({ line: number, text: line, reason: 'not a redirect directive this tool reads' });
    }
  });
  return { format: 'apache', rules, unsupported };
}

// ---------- nginx ----------

function nginxTokens(text) {
  const tokens = [];
  const s = String(text);
  let line = 1;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/.test(c)) i += 1;
    else if (c === '#') {
      while (i < s.length && s[i] !== '\n') i += 1;
    } else if (c === '{' || c === '}' || c === ';') {
      tokens.push({ t: c, line, punct: true });
      i += 1;
    } else if (c === '"' || c === "'") {
      const start = line;
      let j = i + 1;
      let value = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\' && s[j + 1] === c) {
          value += c;
          j += 2;
          continue;
        }
        if (s[j] === '\n') line += 1;
        value += s[j];
        j += 1;
      }
      if (j >= s.length) throw new Error(`a quoted value that starts on line ${start} is not closed`);
      tokens.push({ t: value, line: start });
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && !/[\s{};]/.test(s[j])) j += 1;
      tokens.push({ t: s.slice(i, j), line });
      i = j;
    }
  }
  return tokens;
}

function nginxBlock(tokens, start, depth, limits) {
  if (depth > limits.maxNesting) throw new Error(`blocks nested more than ${limits.maxNesting} deep`);
  const items = [];
  let words = [];
  let pos = start;
  while (pos < tokens.length) {
    const tk = tokens[pos];
    pos += 1;
    if (tk.punct && tk.t === ';') {
      if (words.length) items.push({ words, block: null });
      words = [];
    } else if (tk.punct && tk.t === '{') {
      const inner = nginxBlock(tokens, pos, depth + 1, limits);
      items.push({ words, block: inner.items, line: tk.line });
      pos = inner.pos;
      words = [];
    } else if (tk.punct && tk.t === '}') {
      if (depth === 0) throw new Error(`a "}" on line ${tk.line} closes no block`);
      if (words.length) throw new Error(`the directive on line ${words[0].line} does not end with ";"`);
      return { items, pos };
    } else words.push(tk);
  }
  if (depth > 0) throw new Error('a "{" block is not closed');
  if (words.length) throw new Error(`the directive on line ${words[0].line} does not end with ";"`);
  return { items, pos };
}

// The literal path of a regular expression of the form ^/path$, or null when it uses any other regular expression feature.
// An escaped dot, hyphen, slash, underscore or tilde stands for itself; an unescaped dot is read as a dot.
export function literalPattern(pattern) {
  const m = /^\^(\/.*)\$$/s.exec(pattern);
  if (!m) return null;
  let out = '';
  const s = m[1];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') {
      const n = s[i + 1];
      if (n !== undefined && /[./\-_~]/.test(n)) {
        out += n;
        i += 1;
        continue;
      }
      return null;
    }
    if ('*+?()[]{}|^$'.includes(c)) return null;
    out += c;
  }
  return out;
}

function nginxReturn(args) {
  if (args.length !== 2) return { error: 'only "return <3xx code> <target>;" is read' };
  const status = readStatus(args[0]);
  if (status === null) return { error: `status ${short(args[0], 20)} is not a redirect status` };
  if (args[1].includes('$')) return { error: 'the target uses a variable, which is not evaluated' };
  return { to: args[1], status };
}

function nginxRewrite(args) {
  const [pattern, target, flag] = args;
  if (args.length < 2 || args.length > 3) return { error: 'only "rewrite ^/path$ /target permanent;" is read' };
  const from = literalPattern(pattern);
  if (from === null) return { error: REGEX_RULE };
  if (target.includes('$')) return { error: 'the target uses a capture or a variable, which is not evaluated' };
  const absolute = /^https?:\/\//i.test(target);
  let status;
  if (flag === 'permanent') status = 301;
  else if (flag === 'redirect' || (absolute && (flag === undefined || flag === 'last' || flag === 'break'))) status = 302;
  else return { error: 'an internal rewrite, not a redirect the browser sees' };
  return { from, to: target.replace(/\?$/, ''), status };
}

function hasRedirect(items) {
  return items.some((it) => ['return', 'rewrite'].includes(it.words[0]?.t));
}

// nginx: "location = /a { return 301 /b; }" and "rewrite ^/a$ /b permanent;" (or redirect). Prefix and regular
// expression locations, returns outside an exact location, rewrites with captures and if blocks are reported, not guessed.
export function parseNginxMap(text, limits = LIMITS) {
  const rules = [];
  const unsupported = [];
  const { items } = nginxBlock(nginxTokens(text), 0, 0, limits);
  const flagged = (it, reason) => unsupported.push({ line: it.words[0]?.line ?? it.line ?? 0, text: short(it.words.map((w) => w.t).join(' ') + (it.block ? ' { ... }' : ';')), reason });
  const walk = (list, context) => {
    for (const it of list) {
      const name = it.words[0]?.t;
      const args = it.words.slice(1).map((w) => w.t);
      const line = it.words[0]?.line ?? it.line ?? 0;
      if (name === 'location' && it.block) {
        const exact = args.length === 2 && args[0] === '=' ? args[1] : args.length === 1 && /^=\//.test(args[0]) ? args[0].slice(1) : null;
        if (exact !== null && !context) {
          const body = it.block;
          if (body.length === 1 && !body[0].block && body[0].words[0]?.t === 'return') {
            const r = nginxReturn(body[0].words.slice(1).map((w) => w.t));
            if (r.error) flagged(it, r.error);
            else rules.push({ from: exact, to: r.to, status: r.status, line });
          } else if (hasRedirect(body)) flagged(it, 'only "location = /path { return 301 /target; }" with nothing else in the block is read');
          continue;
        }
        if (hasRedirect(it.block)) flagged(it, exact !== null ? 'a location inside another block is not evaluated' : 'only exact "location = /path" blocks are read; a prefix or regular expression location is not evaluated');
        walk(it.block.filter((x) => !['return', 'rewrite'].includes(x.words[0]?.t)), 'a location');
      } else if (name === 'rewrite') {
        if (context) flagged(it, `a rewrite inside ${context} is not evaluated`);
        else {
          const r = nginxRewrite(args);
          if (r.error) flagged(it, r.error);
          else rules.push({ from: r.from, to: r.to, status: r.status, line });
        }
      } else if (name === 'return') {
        flagged(it, 'a return outside "location = /path" applies to every URL of its block and is not evaluated');
      } else if (name === 'if' && it.block) {
        if (hasRedirect(it.block)) flagged(it, 'an if block is not evaluated');
        walk(it.block.filter((x) => !['return', 'rewrite'].includes(x.words[0]?.t)), 'an if block');
      } else if (it.block) walk(it.block, context);
    }
  };
  walk(items, null);
  return { format: 'nginx', rules, unsupported };
}

// ---------- any map ----------

export function detectMapFormat(text) {
  const lines = String(text).split(/\r\n?|\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.some((l) => /^(?:Redirect|RedirectMatch|RedirectPermanent|RedirectTemp|RewriteRule|RewriteCond|RewriteEngine)\s/i.test(l))) return 'apache';
  if (lines.some((l) => /^(?:server|location|rewrite|return|if)\b/.test(l) && /[;{]/.test(l))) return 'nginx';
  return 'csv';
}

export function parseMap(text, limits = LIMITS) {
  const format = detectMapFormat(text);
  const map = format === 'apache' ? parseApacheMap(text) : format === 'nginx' ? parseNginxMap(text, limits) : parseCsvMap(text);
  if (map.rules.length > limits.maxUrls) throw new Error(`more than ${limits.maxUrls.toLocaleString('en-US')} redirects, which is over the limit; split the map`);
  return map;
}

export async function loadMap(path, limits = LIMITS) {
  const text = await readBounded(path, limits);
  try {
    return { source: path, ...parseMap(text, limits) };
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}
