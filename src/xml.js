// A small, strict reader for sitemap files (https://www.sitemaps.org/protocol.html).
// It reads only the text of <loc> inside <url> (a sitemap) or <sitemap> (a sitemap index).
// A DOCTYPE or ENTITY declaration is refused outright, so no entity can expand; only the five
// predefined XML escapes and numeric character references are read. Nothing is ever fetched.

export const XML_ESCAPES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const MAX_DEPTH = 64;

function shown(text) {
  const s = String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

// Decodes the escapes in a run of text. A bare "&" or an unknown escape is an error, as in XML.
export function decodeXmlText(text) {
  return text.replace(/&([^;&\s<]{1,40});|&/g, (all, name) => {
    if (name === undefined) throw new Error('a bare "&" that does not start an escape');
    if (Object.hasOwn(XML_ESCAPES, name)) return XML_ESCAPES[name];
    const ref = /^#x([0-9A-Fa-f]{1,6})$/.exec(name) || /^#([0-9]{1,7})$/.exec(name);
    if (ref) {
      const code = parseInt(ref[1], name[1] === 'x' ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error(`character reference &${shown(name)}; is not a valid character`);
      return String.fromCodePoint(code);
    }
    throw new Error(`unknown escape &${shown(name)}; (only &lt; &gt; &amp; &quot; &apos; and character references are read)`);
  });
}

function localName(name) {
  return name.slice(name.indexOf(':') + 1);
}

// Reads a sitemap or a sitemap index. Returns { kind: 'urlset' | 'sitemapindex', locs }.
// Throws with the reason when the text is not a well-formed sitemap of this shape.
export function readSitemapXml(text, maxLocs = Infinity) {
  const s = String(text).replace(/^\uFEFF/, '');
  if (/<!DOCTYPE/i.test(s) || /<!ENTITY/i.test(s)) {
    throw new Error('holds a DOCTYPE or ENTITY declaration; sitemaps need neither, and they are refused so that no entity can expand');
  }
  const stack = [];
  const locs = [];
  let root = null;
  let rootClosed = false;
  let buf = null;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const end = lt === -1 ? s.length : lt;
    if (end > i) {
      const run = s.slice(i, end);
      if (buf !== null) buf += decodeXmlText(run);
      else if (!stack.length && run.trim()) throw new Error('text outside the root element');
      i = end;
    }
    if (lt === -1) break;
    if (s.startsWith('<!--', lt)) {
      const close = s.indexOf('-->', lt + 4);
      if (close === -1) throw new Error('a comment is not closed');
      i = close + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const close = s.indexOf(']]>', lt + 9);
      if (close === -1) throw new Error('a CDATA section is not closed');
      if (buf !== null) buf += s.slice(lt + 9, close);
      else if (!stack.length) throw new Error('a CDATA section outside the root element');
      i = close + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const close = s.indexOf('?>', lt + 2);
      if (close === -1) throw new Error('a processing instruction is not closed');
      i = close + 2;
      continue;
    }
    if (s.startsWith('<!', lt)) throw new Error('a declaration other than a comment or CDATA');
    let j = lt + 1;
    let quote = null;
    for (; j < s.length; j += 1) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      else if (c === '<') throw new Error('a "<" inside a tag');
    }
    if (j >= s.length) throw new Error('a tag is not closed');
    const inner = s.slice(lt + 1, j);
    i = j + 1;
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      const open = stack.pop();
      if (open !== name) throw new Error(`</${shown(name)}> does not close <${shown(open ?? '')}>`);
      if (buf !== null && localName(name) === 'loc') {
        locs.push(buf.trim());
        buf = null;
        if (locs.length > maxLocs) throw new Error(`more than ${maxLocs.toLocaleString('en-US')} <loc> entries, which is over the limit`);
      }
      if (!stack.length) rootClosed = true;
      continue;
    }
    const name = /^[^\s/]+/.exec(inner)?.[0];
    if (!name) throw new Error('a tag without a name');
    if (buf !== null) throw new Error(`an element <${shown(name)}> inside <loc>`);
    if (rootClosed) throw new Error('more than one root element');
    if (root === null) root = localName(name);
    if (inner.endsWith('/')) {
      if (!stack.length) rootClosed = true;
      continue;
    }
    const parent = stack.length ? localName(stack[stack.length - 1]) : null;
    stack.push(name);
    if (stack.length > MAX_DEPTH) throw new Error(`elements nested more than ${MAX_DEPTH} deep`);
    if (stack.length === 3 && localName(name) === 'loc' && (parent === 'url' || parent === 'sitemap')) buf = '';
  }
  if (stack.length) throw new Error(`<${shown(stack[stack.length - 1])}> is not closed`);
  if (root === null) throw new Error('no root element');
  if (root !== 'urlset' && root !== 'sitemapindex') throw new Error(`the root element is <${shown(root)}>, not <urlset> or <sitemapindex>`);
  return { kind: root, locs };
}
