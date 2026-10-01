import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs, main, checkMap, toText, toMarkdown, toJson, toCsv, csvCell, mdCell, USAGE, VERSION } from '../src/index.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const at = (p) => join(root, p);
const quiet = { out: () => {}, err: () => {} };

async function capture(argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

const csvRun = ['--old', at('examples/old-sitemap.xml'), '--new', at('examples/new-sitemap.xml'), '--map', at('examples/redirects.csv')];
const nginxRun = ['--old', at('examples/old-sitemap.xml'), '--new', at('examples/new-sitemap.xml'), '--map', at('examples/nginx.conf')];

// A report with text that tries to break each format.
function hostile() {
  return checkMap({ old: [], new: ['/x'], rules: [], unsupported: [{ line: 2, text: '=HYPERLINK("x")|a\nb', reason: 'not read' }, { line: 3, text: '@sum', reason: '-1' }] });
}

test('parseArgs reads options and refuses bad input', () => {
  const o = parseArgs(['--old', 'o.xml', '--new', 'n.xml', '--map', 'm.csv', '--sitemap-dir', 'd', '--format', 'csv', '--fail-on', 'warning',
    '--keep-host', '--strict-slash', '--case-insensitive', '--home-limit', '0', '--limit', '50']);
  assert.deepEqual([o.old, o.new, o.map, o.sitemapDir, o.format, o.failOn], ['o.xml', 'n.xml', 'm.csv', 'd', 'csv', 'warning']);
  assert.ok(o.keepHost && o.strictSlash && o.caseInsensitive);
  assert.equal(o.homeLimit, 0);
  assert.equal(o.limit, 50);
  const d = parseArgs(['--old', 'o', '--new', 'n', '--map', 'm']);
  assert.deepEqual([d.format, d.failOn, d.homeLimit, d.limit, d.keepHost], ['text', 'error', 10, 200, false]);
  assert.throws(() => parseArgs(['--new', 'n', '--map', 'm']), /--old/);
  assert.throws(() => parseArgs(['--old', 'o', '--map', 'm']), /--new/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n']), /--map/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--format', 'xml']), /unknown format xml/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--fail-on', 'info']), /error or warning/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--limit', '0']), /at least 1/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--home-limit', '-1']), /needs a value|whole number/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--limit', 'ten']), /whole number/);
  assert.throws(() => parseArgs(['--old', 'https://www.example.com/sitemap.xml', '--new', 'n', '--map', 'm']), /never fetches a URL/);
  assert.throws(() => parseArgs(['--old']), /needs a value/);
  assert.throws(() => parseArgs(['--old', 'o', '--new', 'n', '--map', 'm', '--crawl']), /unknown argument --crawl/);
  assert.throws(() => parseArgs(['-']), /standard input/);
});

test('exit codes: 0 when nothing fails the gate, 1 on errors or with --fail-on warning, 2 on usage or input errors', async () => {
  assert.equal(await main(csvRun, quiet), 1);
  assert.equal(await main(['--old', at('examples/new-sitemap.xml'), '--new', at('examples/new-sitemap.xml'), '--map', at('examples/nginx.conf'), '--home-limit', '0'], quiet), 0);
  assert.equal(await main(['--old', at('examples/old-sitemap.xml'), '--new', at('examples/new-sitemap.xml'), '--map', at('LICENSE')], quiet), 2);
  assert.equal(await main(['--nope'], quiet), 2);
  assert.equal(await main(['--help'], quiet), 0);
  const v = await capture(['--version']);
  assert.equal(v.out.trim(), VERSION);
  const missing = await capture(['--old', at('examples/none.xml'), '--new', at('examples/new-sitemap.xml'), '--map', at('examples/redirects.csv')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /none\.xml: no such file/);
  const usage = await capture(['--old', 'o']);
  assert.ok(usage.err.includes(USAGE));
});

test('a map with only warnings passes by default and fails with --fail-on warning', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'redirect-map-check-'));
  try {
    await writeFile(join(dir, 'old.txt'), '/a.html\n/b.html\n');
    await writeFile(join(dir, 'new.txt'), '/a\n/b\n');
    await writeFile(join(dir, 'map.csv'), 'from,to,status\n/a.html,/a,301\n/b.html,/b,302\n');
    const args = ['--old', join(dir, 'old.txt'), '--new', join(dir, 'new.txt'), '--map', join(dir, 'map.csv')];
    assert.equal(await main(args, quiet), 0);
    assert.equal(await main([...args, '--fail-on', 'warning'], quiet), 1);
    await writeFile(join(dir, 'map.csv'), 'from,to\n/a.html,/a\n/b.html,/b\n');
    assert.equal(await main([...args, '--fail-on', 'warning'], quiet), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('text output gives the inputs, the summary, each finding and the gate', async () => {
  const { out } = await capture(csvRun);
  assert.ok(out.startsWith(`redirect-map-check: old ${at('examples/old-sitemap.xml')}, new ${at('examples/new-sitemap.xml')}, map ${at('examples/redirects.csv')} (csv)\n`));
  assert.match(out, /\nold URLs: 23 \(4 kept, 18 redirected, 1 unmapped\); new URLs: 23 \(5 new-only\); redirects: 22\n/);
  assert.match(out, /\nfindings: 5 error, 3 warning, 3 info \(11 shown\)\n/);
  assert.match(out, /\nERROR {5}unmapped {14}\/size-guide\.html is not on the new site and has no redirect\n/);
  assert.match(out, /\nWARNING {3}status-not-permanent {2}\/men\/jackets\.html/);
  assert.match(out, /GATE: FAIL - 5 errors\n$/);
  const limited = await capture([...csvRun, '--limit', '2']);
  assert.match(limited.out, /findings: 5 error, 3 warning, 3 info \(showing the first 2 of 11 \(--limit\)\)/);
  assert.equal((limited.out.match(/^ERROR/gm) || []).length, 2);
});

test('JSON output holds the whole report', async () => {
  const { code, out } = await capture([...csvRun, '--format', 'json']);
  assert.equal(code, 1);
  const rep = JSON.parse(out);
  assert.deepEqual(rep.counts, { error: 5, warning: 3, info: 3 });
  assert.equal(rep.byCheck.chain, 1);
  assert.equal(rep.byCheck.loop, 1);
  assert.equal(rep.sources.mapFormat, 'csv');
  assert.deepEqual(rep.findings.find((f) => f.id === 'chain'), {
    id: 'chain', severity: 'warning', line: 9, from: '/men/shirts.html', to: '/collections/men-shirts',
    message: '/men/shirts.html -> /collections/mens-shirts -> /collections/men-shirts (line 9): 2 redirects in a row; redirect /men/shirts.html straight to /collections/men-shirts'
  });
  assert.equal(toJson(rep), `${JSON.stringify(rep, null, 2)}\n`);
});

test('Markdown escapes pipes and line breaks so map text cannot break a table', async () => {
  assert.equal(mdCell('a|b\nc\\d'), 'a\\|b c\\\\d');
  const md = toMarkdown(hostile());
  assert.match(md, /^## redirect-map-check: 0 error, 2 warning, 1 info/);
  for (const line of md.split('\n').filter((l) => l.startsWith('| warning'))) {
    assert.equal(line.replace(/\\\|/g, '').split('|').length, 6, line);
  }
  assert.match(md, /\*\*Gate passed\*\* \(--fail-on error\)\./);
  const { out } = await capture([...csvRun, '--format', 'markdown']);
  assert.match(out, /\| error \| loop \| 22 \| redirect loop: \/spring-sale -> \/promo -> \/spring-sale \(line 22\)/);
  assert.match(out, /\*\*Gate failed:\*\* 5 errors\./);
});

test('CSV follows RFC 4180 and defuses formulas', async () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=1+2'), "'=1+2");
  assert.equal(csvCell('-x'), "'-x");
  assert.equal(csvCell('+x'), "'+x");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(7), '7');
  const lines = toCsv(hostile()).split('\r\n');
  assert.equal(lines[0], 'severity,id,line,from,to,message');
  assert.equal(lines[1], 'warning,unsupported,2,,,"line 2: not read: =HYPERLINK(""x"")|a b"');
  const { out } = await capture([...csvRun, '--format', 'csv']);
  assert.ok(out.includes('\r\nerror,unmapped,,/size-guide.html,,/size-guide.html is not on the new site and has no redirect\r\n'));
  assert.ok(out.endsWith('\r\n'));
});

test('the nginx example reports unsupported rules and the old URLs they leave unmapped', async () => {
  const { code, out } = await capture([...nginxRun, '--format', 'json']);
  assert.equal(code, 1);
  const rep = JSON.parse(out);
  assert.equal(rep.sources.mapFormat, 'nginx');
  assert.equal(rep.byCheck.unsupported, 2);
  assert.equal(rep.byCheck.unmapped, 11);
  assert.equal(rep.byCheck['status-not-permanent'], 1);
});

test('text output shows notes and keeps every finding on one line', () => {
  const rep = checkMap({ old: ['/a'], new: ['/b'], rules: [{ from: '/a', to: '/b\u2028x\u001b[2J', status: 301, line: 1 }] }, { notes: ['a note'] });
  const text = toText(rep);
  assert.match(text, /\nnote: a note\n/);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u0085\u2028]/.test(text));
  assert.match(toText(checkMap({ old: ['/a'], new: ['/a'], rules: [] })), /GATE: PASS \(--fail-on error\)/);
  assert.match(toText(checkMap({ old: [], new: [], rules: [] })), /\nno findings\n/);
});
