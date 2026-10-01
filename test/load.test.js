import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import {
  LIMITS, MAP_FORMATS, REDIRECT_STATUSES, CSV_HEADERS, readBounded, parseUrlList, looksLikeXml, childSitemapName, loadUrls,
  parseCsvRows, parseCsvMap, parseApacheMap, literalPattern, parseNginxMap, detectMapFormat, parseMap, loadMap
} from '../src/index.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const at = (p) => join(root, p);
let dir;

const sitemap = (...paths) => `<urlset>${paths.map((p) => `<url><loc>https://www.example.com${p}</loc></url>`).join('')}</urlset>`;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'redirect-map-check-'));
  await writeFile(join(dir, 'index.xml'), '<sitemapindex><sitemap><loc>https://www.example.com/sitemaps/pages.xml</loc></sitemap><sitemap><loc>https://www.example.com/sitemaps/products.xml?v=2</loc></sitemap></sitemapindex>');
  await writeFile(join(dir, 'pages.xml'), sitemap('/', '/pages/about-us'));
  await writeFile(join(dir, 'products.xml'), sitemap('/products/a', '/products/b'));
  await writeFile(join(dir, 'missing-index.xml'), '<sitemapindex><sitemap><loc>https://www.example.com/gone.xml</loc></sitemap></sitemapindex>');
  await writeFile(join(dir, 'nested-index.xml'), '<sitemapindex><sitemap><loc>https://www.example.com/index.xml</loc></sitemap></sitemapindex>');
  await writeFile(join(dir, 'traversal-index.xml'), '<sitemapindex><sitemap><loc>https://www.example.com/..%2F..%2Fsecret.xml</loc></sitemap></sitemapindex>');
  await writeFile(join(dir, 'gz-index.xml'), '<sitemapindex><sitemap><loc>https://www.example.com/products.xml.gz</loc></sitemap></sitemapindex>');
  await writeFile(join(dir, 'list.txt'), '# old URLs\n\nhttps://www.example.com/a\r\n/b\n  /c  \n');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a URL list skips blank lines and comments; XML is told apart by its first character', async () => {
  assert.deepEqual(parseUrlList('# c\n\n/a\r\n /b \n'), ['/a', '/b']);
  const list = await loadUrls(join(dir, 'list.txt'));
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.urls, ['https://www.example.com/a', '/b', '/c']);
  assert.ok(looksLikeXml('  <?xml version="1.0"?>'));
  assert.ok(!looksLikeXml('/a'));
  const old = await loadUrls(at('examples/old-sitemap.xml'));
  assert.equal(old.kind, 'sitemap');
  assert.equal(old.urls.length, 23);
  assert.equal(old.urls[22], 'https://www.example.com/blog/care-for-linen.html');
});

test('a sitemap index is read from the local folder given with --sitemap-dir', async () => {
  const r = await loadUrls(join(dir, 'index.xml'), { sitemapDir: dir });
  assert.equal(r.kind, 'sitemap index');
  assert.deepEqual(r.urls, ['https://www.example.com/', 'https://www.example.com/pages/about-us', 'https://www.example.com/products/a', 'https://www.example.com/products/b']);
  assert.deepEqual(r.files.map((f) => f.slice(dir.length + 1)), ['pages.xml', 'products.xml']);
});

test('a sitemap index is never fetched: without the folder, or with a missing, nested, compressed or odd child, it stops', async () => {
  await assert.rejects(loadUrls(join(dir, 'index.xml')), /sitemap index that lists 2 sitemap\(s\); .*--sitemap-dir \(the tool never fetches them\)/);
  await assert.rejects(loadUrls(join(dir, 'missing-index.xml'), { sitemapDir: dir }), /gone\.xml does not exist; save it in --sitemap-dir/);
  await assert.rejects(loadUrls(join(dir, 'nested-index.xml'), { sitemapDir: dir }), /a sitemap index inside a sitemap index/);
  await assert.rejects(loadUrls(join(dir, 'traversal-index.xml'), { sitemapDir: dir }), /does not end in a plain file name/);
  await assert.rejects(loadUrls(join(dir, 'gz-index.xml'), { sitemapDir: dir }), /is compressed/);
  assert.equal(childSitemapName('https://www.example.com/a/sitemap-1.xml?x=1'), 'sitemap-1.xml');
  assert.equal(childSitemapName('https://www.example.com/..'), null);
  assert.equal(childSitemapName('https://www.example.com/a%2F..%2Fb.xml'), null);
});

test('size limits: files over the byte limit and lists over the URL limit are refused, and say so', async () => {
  assert.equal(LIMITS.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(LIMITS.maxUrls, 1000000);
  const small = { ...LIMITS, maxFileBytes: 100 };
  await assert.rejects(readBounded(at('examples/old-sitemap.xml'), small), /bytes is over the .* MB limit/);
  await assert.rejects(loadUrls(at('examples/old-sitemap.xml'), { limits: small }), /over the/);
  await assert.rejects(loadMap(at('examples/redirects.csv'), small), /over the/);
  const few = { ...LIMITS, maxUrls: 2 };
  assert.throws(() => parseUrlList('/a\n/b\n/c', few), /more than 2 URLs, which is over the limit/);
  await assert.rejects(loadUrls(at('examples/new-sitemap.xml'), { limits: few }), /more than 2 <loc> entries/);
  await assert.rejects(loadUrls(join(dir, 'index.xml'), { sitemapDir: dir, limits: { ...LIMITS, maxUrls: 3 } }), /more than 3 URLs/);
  assert.throws(() => parseMap('/a,/b\n/c,/d\n/e,/f', few), /more than 2 redirects/);
  await assert.rejects(readBounded(at('examples')), /not a file/);
});

test('CSV rows follow RFC 4180: quotes, doubled quotes, commas and line breaks inside quotes', () => {
  const rows = parseCsvRows('from,to\r\n"/a,b","/say ""hi"""\n"/multi\nline",/x\n\n,\n');
  assert.deepEqual(rows.map((r) => r.cells), [['from', 'to'], ['/a,b', '/say "hi"'], ['/multi\nline', '/x']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 3]);
  assert.throws(() => parseCsvRows('"/a,/b'), /quoted cell that starts on line 1 is not closed/);
});

test('CSV maps: a from,to,status header, two columns without a header, and Shopify and Magento exports', () => {
  const plain = parseCsvMap('from,to,status\n/a,/b,301\n/c,/d,\n/e,/f,200\n/g,,301');
  assert.deepEqual(plain.rules, [{ from: '/a', to: '/b', status: 301, line: 2 }, { from: '/c', to: '/d', status: null, line: 3 }]);
  assert.match(plain.unsupported[0].reason, /status "200" is not a redirect status/);
  assert.match(plain.unsupported[1].reason, /source or the target cell is empty/);
  assert.deepEqual(parseCsvMap('/a,/b\n/c,/d,308').rules.map((r) => [r.from, r.to, r.status]), [['/a', '/b', null], ['/c', '/d', 308]]);
  const shopify = parseCsvMap('Redirect from,Redirect to\n/products/old,/products/new\n');
  assert.deepEqual(shopify.rules, [{ from: '/products/old', to: '/products/new', status: null, line: 2 }]);
  const magento = parseCsvMap('url_rewrite_id,store_id,request_path,target_path,redirect_type\n1,1,old-shirt.html,shirts/new-shirt.html,301\n2,1,old-hat.html,hats.html,302');
  assert.deepEqual(magento.rules.map((r) => [r.from, r.to, r.status]), [['old-shirt.html', 'shirts/new-shirt.html', 301], ['old-hat.html', 'hats.html', 302]]);
  assert.throws(() => parseCsvMap('old,new\n/a,/b'), /neither a redirect nor a header with known columns/);
  assert.equal(CSV_HEADERS.length, 5);
  assert.deepEqual(REDIRECT_STATUSES, [301, 302, 303, 307, 308]);
});

test('Apache: Redirect lines are read, with 302 as Apache\'s default; regular expression rules are reported, not guessed', () => {
  const map = parseApacheMap([
    '# moved pages',
    '<IfModule mod_alias.c>',
    'Redirect 301 /about-us.html /pages/about-us',
    'Redirect permanent /contact.html https://www.example.com/pages/contact',
    'Redirect /sale.html /collections/sale',
    'RedirectPermanent /men.html /collections/men',
    'RedirectTemp /women.html /collections/women',
    'Redirect "/a b.html" "/pages/a b"',
    'Redirect gone /old-catalog.pdf',
    'Redirect 301 /only-one',
    'RedirectMatch 301 ^/blog/(.*)\\.html$ /blogs/journal/$1',
    'RewriteEngine On',
    'RewriteCond %{HTTP_HOST} ^example\\.com$',
    'RewriteRule ^shop/(.*)$ /collections/$1 [R=301,L]',
    'Header set X-Frame-Options DENY',
    'SetHandler none',
    '</IfModule>'
  ].join('\n'));
  assert.deepEqual(map.rules.map((r) => [r.from, r.to, r.status, r.line]), [
    ['/about-us.html', '/pages/about-us', 301, 3],
    ['/contact.html', 'https://www.example.com/pages/contact', 301, 4],
    ['/sale.html', '/collections/sale', 302, 5],
    ['/men.html', '/collections/men', 301, 6],
    ['/women.html', '/collections/women', 302, 7],
    ['/a b.html', '/pages/a b', 302, 8]
  ]);
  const reasons = map.unsupported.map((u) => [u.line, u.reason]);
  assert.match(reasons[0][1], /status 410 is not a redirect/);
  assert.match(reasons[1][1], /needs a source path and a target/);
  assert.deepEqual(reasons.slice(2, 5).map((r) => r[0]), [11, 13, 14]);
  for (const r of reasons.slice(2, 5)) assert.match(r[1], /regular expression is not evaluated/);
  assert.match(reasons[5][1], /not a redirect directive/);
  assert.equal(reasons.length, 6);
});

test('nginx: exact locations with a return and literal rewrites are read; everything else is reported', () => {
  const map = parseNginxMap([
    'server {',
    '  listen 443 ssl;',
    '  location = /about-us.html { return 301 /pages/about-us; }',
    '  location =/contact.html { return 308 "/pages/contact"; }',
    '  rewrite ^/women\\.html$ /collections/women permanent;',
    '  rewrite ^/sale.html$ https://www.example.com/collections/sale;',
    '  rewrite ^/blog/(.*)$ /blogs/$1 permanent;',
    '  rewrite ^/men\\.html$ /collections/men last;',
    '  location /men/ { return 301 /collections/men; }',
    '  location ~ \\.php$ { return 301 /; }',
    '  location = /x { add_header X-A b; return 301 /y; }',
    '  location = /v { return 301 $scheme://$host/w; }',
    '  if ($host = example.com) { return 301 https://www.example.com$request_uri; }',
    '  return 301 https://www.example.com$request_uri;',
    '  location / { try_files $uri $uri/ =404; }',
    '}'
  ].join('\n'));
  assert.deepEqual(map.rules.map((r) => [r.from, r.to, r.status, r.line]), [
    ['/about-us.html', '/pages/about-us', 301, 3],
    ['/contact.html', '/pages/contact', 308, 4],
    ['/women.html', '/collections/women', 301, 5],
    ['/sale.html', 'https://www.example.com/collections/sale', 302, 6]
  ]);
  const reasons = map.unsupported.map((u) => `${u.line}: ${u.reason}`);
  assert.equal(reasons.length, 8);
  assert.match(reasons[0], /^7: a rule with a regular expression/);
  assert.match(reasons[1], /^8: an internal rewrite/);
  assert.match(reasons[2], /^9: only exact "location = \/path" blocks/);
  assert.match(reasons[3], /^10: only exact/);
  assert.match(reasons[4], /^11: only "location = \/path \{ return 301 \/target; \}" with nothing else/);
  assert.match(reasons[5], /^12: the target uses a variable/);
  assert.match(reasons[6], /^13: an if block is not evaluated/);
  assert.match(reasons[7], /^14: a return outside "location = \/path"/);
  assert.equal(literalPattern('^/a\\.html$'), '/a.html');
  assert.equal(literalPattern('^/a(b)?$'), null);
  assert.equal(literalPattern('/a'), null);
  assert.throws(() => parseNginxMap('server { rewrite ^/a$ /b permanent; '), /block is not closed/);
  assert.throws(() => parseNginxMap('rewrite ^/a$ /b permanent'), /does not end with ";"/);
  assert.throws(() => parseNginxMap('}'), /closes no block/);
  assert.throws(() => parseNginxMap(`${'a {'.repeat(40)}`), /nested more than 32/);
});

test('the map format is detected from the content; maps are loaded from files', async () => {
  assert.deepEqual(MAP_FORMATS, ['csv', 'apache', 'nginx']);
  assert.equal(detectMapFormat('# x\nRedirect 301 /a /b'), 'apache');
  assert.equal(detectMapFormat('rewriterule ^a$ /b [R=301]'), 'apache');
  assert.equal(detectMapFormat('server {\n location = /a { return 301 /b; }\n}'), 'nginx');
  assert.equal(detectMapFormat('from,to\n/a,/b'), 'csv');
  const csv = await loadMap(at('examples/redirects.csv'));
  assert.equal(csv.format, 'csv');
  assert.equal(csv.rules.length, 23);
  const nginx = await loadMap(at('examples/nginx.conf'));
  assert.equal(nginx.format, 'nginx');
  assert.equal(nginx.rules.length, 8);
  assert.equal(nginx.unsupported.length, 2);
  await assert.rejects(loadMap(at('LICENSE')), /LICENSE: the first row is neither a redirect nor a header/);
});
