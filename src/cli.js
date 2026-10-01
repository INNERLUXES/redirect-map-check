// Command line: redirect-map-check --old <file> --new <file> --map <file> [options]

import { readFileSync } from 'node:fs';
import { loadUrls, loadMap } from './load.js';
import { checkMap, FINDINGS } from './check.js';
import { toText, toMarkdown, toJson, toCsv } from './report.js';

const FORMATS = { text: toText, markdown: toMarkdown, json: toJson, csv: toCsv };
const THRESHOLDS = ['error', 'warning'];

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const USAGE = `Usage: redirect-map-check --old <file> --new <file> --map <file> [options]

Checks a redirect map before a site moves to a new platform or a new URL structure:
every old URL must reach a page of the new site in one permanent redirect. It reads
the files it is given and nothing else: it never fetches a page or a sitemap.

Options:
  --old <file>            the old site's URLs: a sitemap, a sitemap index, or one URL per line
  --new <file>            the new site's URLs, in the same forms
  --map <file>            the redirects: CSV (from,to[,status] or a Shopify or Magento export),
                          Apache Redirect lines, or nginx "location = /a { return 301 /b; }"
                          and "rewrite ^/a$ /b permanent;" rules
  --sitemap-dir <dir>     the folder that holds the child sitemaps of a sitemap index
  --format <name>         text, markdown, json or csv (default: text)
  --fail-on <level>       exit with 1 when a finding is at this level or above: error or warning
                          (default: error)
  --keep-host             compare scheme and host too (default: compare path and query only)
  --strict-slash          /a and /a/ are different URLs (default: the same)
  --case-insensitive      /A and /a are the same URL (default: different)
  --home-limit <n>        more than n redirects to the home page is an error (default: 10)
  --limit <n>             show the first n findings; the counts cover all (default: 200)
  --help                  show this text
  --version               show the version

Checks: ${FINDINGS.map((f) => f.id).join(', ')}

Exit codes: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
`;

function count(option, value, min) {
  if (!/^\d{1,9}$/.test(value) || Number(value) < min) throw new Error(`${option} takes a whole number of at least ${min}, not ${value}`);
  return Number(value);
}

export function parseArgs(argv) {
  const o = {
    old: null, new: null, map: null, sitemapDir: null, format: 'text', failOn: 'error',
    keepHost: false, strictSlash: false, caseInsensitive: false, homeLimit: 10, limit: 200, help: false, version: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--old') o.old = next();
    else if (a === '--new') o.new = next();
    else if (a === '--map') o.map = next();
    else if (a === '--sitemap-dir') o.sitemapDir = next();
    else if (a === '--format') o.format = next();
    else if (a === '--fail-on') o.failOn = next();
    else if (a === '--keep-host') o.keepHost = true;
    else if (a === '--strict-slash') o.strictSlash = true;
    else if (a === '--case-insensitive') o.caseInsensitive = true;
    else if (a === '--home-limit') o.homeLimit = count(a, next(), 0);
    else if (a === '--limit') o.limit = count(a, next(), 1);
    else if (a === '-') throw new Error('reading from standard input is not supported; give a file');
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.help && !o.version) {
    if (o.old === null) throw new Error("give the old site's URLs with --old");
    if (o.new === null) throw new Error("give the new site's URLs with --new");
    if (o.map === null) throw new Error('give the redirect map with --map');
    if (!FORMATS[o.format]) throw new Error(`unknown format ${o.format} (text, markdown, json or csv)`);
    if (!THRESHOLDS.includes(o.failOn)) throw new Error(`--fail-on takes error or warning, not ${o.failOn}`);
    if (/^https?:\/\//i.test(o.old) || /^https?:\/\//i.test(o.new) || /^https?:\/\//i.test(o.map)) {
      throw new Error('give local files; the tool never fetches a URL');
    }
  }
  return o;
}

// Exit code: 0 no finding at the --fail-on level, 1 such a finding, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`redirect-map-check: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  let oldUrls;
  let newUrls;
  let map;
  try {
    oldUrls = await loadUrls(o.old, { sitemapDir: o.sitemapDir });
    newUrls = await loadUrls(o.new, { sitemapDir: o.sitemapDir });
    map = await loadMap(o.map);
  } catch (error) {
    io.err(`redirect-map-check: ${error.code === 'ENOENT' ? `${error.path}: no such file` : error.message}\n`);
    return 2;
  }
  const notes = [];
  for (const u of [oldUrls, newUrls]) {
    if (u.files.length > 1) notes.push(`${u.source} is a sitemap index; ${u.files.length} child sitemaps read from --sitemap-dir`);
    if (!u.urls.length) notes.push(`${u.source} holds no URLs`);
  }
  const report = checkMap({ old: oldUrls.urls, new: newUrls.urls, rules: map.rules, unsupported: map.unsupported }, {
    keepHost: o.keepHost, strictSlash: o.strictSlash, caseInsensitive: o.caseInsensitive,
    homeLimit: o.homeLimit, limit: o.limit, failOn: o.failOn, notes,
    sources: { old: o.old, new: o.new, map: o.map, mapFormat: map.format }
  });
  io.out(FORMATS[o.format](report));
  return report.gate.pass ? 0 : 1;
}
