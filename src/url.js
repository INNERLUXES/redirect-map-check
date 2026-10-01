// URL normalisation, so that the old site, the new site and the redirect map are compared on the same form.
// The percent-encoding rules follow RFC 3986 section 6.2.2 (https://www.rfc-editor.org/rfc/rfc3986).

export const MAX_URL_LENGTH = 8192;

// Query parameters added by ad and analytics links; they never name a different page.
export const TRACKING_PARAM = /^(?:utm_[a-z0-9_]*|gclid|fbclid)$/;

const WITH_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/s;
const OTHER_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const PATH_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/;
const QUERY_SAFE = /^[A-Za-z0-9\-._~!$'()*+,;=:@/?]$/;
const HEX2 = /^[0-9A-Fa-f]{2}$/;

function hex(byte) {
  return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}

// Escapes of unreserved characters are decoded, other escapes get upper-case hex digits,
// and characters that may not stand in that part of a URL are encoded as UTF-8.
export function normalizeEncoding(text, safe = PATH_SAFE) {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '%' && HEX2.test(text.slice(i + 1, i + 3))) {
      const code = parseInt(text.slice(i + 1, i + 3), 16);
      const ch = String.fromCharCode(code);
      out += code < 0x80 && UNRESERVED.test(ch) ? ch : `%${text.slice(i + 1, i + 3).toUpperCase()}`;
      i += 3;
      continue;
    }
    const ch = String.fromCodePoint(text.codePointAt(i));
    if (ch.length === 1 && ch.charCodeAt(0) < 0x80 && safe.test(ch)) out += ch;
    else for (const byte of Buffer.from(ch, 'utf8')) out += hex(byte);
    i += ch.length;
  }
  return out;
}

function lowerOutsideEscapes(text) {
  return text.replace(/%[0-9A-F]{2}|[^%]+/g, (part) => (part[0] === '%' ? part : part.toLowerCase()));
}

// Percent-encoded characters decoded for case folding, so that an encoded capital letter folds too.
// A run that decodes to a reserved character or is not valid UTF-8 stays encoded.
function decodeForFolding(path) {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      const s = decodeURIComponent(run);
      return /[\s/?#[\]@!$&'()*+,;=%]/.test(s) ? run : s;
    } catch {
      return run;
    }
  });
}

function trimSlash(path) {
  if (path === '/') return path;
  return path.replace(/\/+$/, '') || '/';
}

function paramName(param) {
  const name = param.split('=')[0];
  try {
    return decodeURIComponent(name.replace(/\+/g, ' ')).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

// Reads one URL or path. Returns { error } when it is not a web address, or the forms used to compare it:
//   key    the form every check compares (host and scheme only with keepHost, case folded with caseInsensitive,
//          trailing slash removed unless strictSlash)
//   exact  the same without case folding or slash trimming, to tell a real redirect from a change of case or slash
//   loose  case folded and slash trimmed always, to find redirects that change only case or a trailing slash
//   full   the exact form with scheme and host always kept, to find a redirect to the very same address
//   home   true when the key is the home page
export function normalizeUrl(raw, options = {}) {
  const o = { keepHost: false, strictSlash: false, caseInsensitive: false, ...options };
  const text = String(raw).trim();
  if (!text) return { error: 'empty' };
  if (text.length > MAX_URL_LENGTH) return { error: `longer than ${MAX_URL_LENGTH} characters` };

  let scheme = '';
  let host = '';
  let rest;
  const m = WITH_SCHEME.exec(text);
  if (m) {
    scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { error: `the scheme ${scheme} is not http or https` };
    host = m[2];
    rest = m[3];
    if (!host) return { error: 'no host after the scheme' };
  } else if (text.startsWith('//')) {
    const n = /^\/\/([^/?#]*)(.*)$/s.exec(text);
    host = n[1];
    rest = n[2];
    if (!host) return { error: 'no host after "//"' };
  } else if (OTHER_SCHEME.test(text)) {
    return { error: 'not a web address' };
  } else {
    rest = text.startsWith('/') ? text : `/${text}`;
  }

  if (host) {
    if (host.includes('@')) return { error: 'the address holds a user name or password' };
    host = host.toLowerCase().replace(/\.$/, '').replace(/\.(?=:)/, '');
    if ((scheme === 'http' && host.endsWith(':80')) || (scheme === 'https' && host.endsWith(':443'))) host = host.replace(/:\d+$/, '');
  }

  const hash = rest.indexOf('#');
  if (hash !== -1) rest = rest.slice(0, hash);
  const q = rest.indexOf('?');
  let path = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? '' : rest.slice(q + 1);
  if (path === '') path = '/';

  const params = query.split('&').filter((p) => p !== '' && !TRACKING_PARAM.test(paramName(p)));
  const search = params.length ? `?${params.map((p) => normalizeEncoding(p, QUERY_SAFE)).join('&')}` : '';

  const exactPath = normalizeEncoding(path, PATH_SAFE);
  const foldedPath = lowerOutsideEscapes(normalizeEncoding(decodeForFolding(path).toLowerCase(), PATH_SAFE));
  const keyPath = o.caseInsensitive ? foldedPath : exactPath;
  const origin = host ? `${scheme ? `${scheme}:` : ''}//${host}` : '';
  const keyOrigin = o.keepHost ? origin : '';
  const finalPath = o.strictSlash ? keyPath : trimSlash(keyPath);

  return {
    key: `${keyOrigin}${finalPath}${search}`,
    exact: `${keyOrigin}${exactPath}${search}`,
    loose: `${keyOrigin}${trimSlash(foldedPath)}${search}`,
    full: `${origin}${exactPath}${search}`,
    home: finalPath === '/' && search === ''
  };
}
