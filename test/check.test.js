import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMap, FINDINGS, SEVERITIES, RANK, MAX_HOPS, PERMANENT, isFindingId, safeText, meetsThreshold } from '../src/index.js';

const r = (from, to, status = 301, line = null) => ({ from, to, status, line });
const ids = (rep) => rep.findings.map((f) => f.id);
const find = (rep, id) => rep.findings.filter((f) => f.id === id);
const run = (old, newer, rules, options) => checkMap({ old, new: newer, rules }, options);

test('every check has an id and known severities, and the list is complete', () => {
  assert.deepEqual(FINDINGS.map((f) => f.id), ['unmapped', 'target-missing', 'loop', 'duplicate-source', 'self-redirect', 'chain', 'to-home', 'status-not-permanent', 'unsupported', 'case-or-slash-only', 'kept', 'new-only']);
  for (const f of FINDINGS) for (const s of f.severity.split(' / ')) assert.ok(SEVERITIES.includes(s), f.id);
  assert.ok(isFindingId('chain'));
  assert.ok(!isFindingId('nothing'));
  assert.ok(RANK.error < RANK.warning && RANK.warning < RANK.info);
  assert.ok(meetsThreshold('error', 'warning'));
  assert.ok(!meetsThreshold('warning', 'error'));
  assert.ok(!meetsThreshold('info', 'warning'));
  assert.deepEqual(PERMANENT, [301, 308]);
});

test('a complete map of one-hop permanent redirects passes', () => {
  const rep = run(['https://www.example.com/a.html', '/b.html', '/terms'], ['/pages/a', '/pages/b', '/terms'], [r('/a.html', '/pages/a'), r('/b.html', 'https://www.example.com/pages/b', 308)]);
  assert.deepEqual(ids(rep), ['kept']);
  assert.equal(rep.gate.pass, true);
  assert.deepEqual(rep.summary, { oldUrls: 3, newUrls: 3, redirects: 2, kept: 1, redirected: 2, unmapped: 0, newOnly: 0 });
});

test('unmapped: an old URL not on the new site and without a redirect is an error', () => {
  const rep = run(['/a', '/b', '/c/'], ['/c'], [r('/a', '/c')]);
  assert.deepEqual(find(rep, 'unmapped').map((f) => f.from), ['/b']);
  assert.match(find(rep, 'unmapped')[0].message, /^\/b is not on the new site and has no redirect$/);
  assert.equal(rep.gate.pass, false);
  assert.equal(rep.summary.kept, 1);
});

test('target-missing: a target not on the new site and not redirected is an error; a redirected target is not', () => {
  const rep = run(['/a', '/b'], ['/x'], [r('/a', '/typo', 301, 4), r('/b', '/c'), r('/c', '/x')]);
  const missing = find(rep, 'target-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].message, '/a -> /typo (line 4): the target is not on the new site and is not redirected');
  assert.equal(missing[0].line, 4);
});

test('chain: A -> B -> C is a warning with the full chain and the direct target', () => {
  const rep = run(['/a'], ['/c'], [r('/a', '/b', 301, 2), r('/b', '/c')]);
  const chain = find(rep, 'chain');
  assert.equal(chain.length, 1);
  assert.equal(chain[0].severity, 'warning');
  assert.equal(chain[0].message, '/a -> /b -> /c (line 2): 2 redirects in a row; redirect /a straight to /c');
  assert.equal(chain[0].to, '/c');
  const three = run(['/a'], ['/d'], [r('/a', '/b'), r('/b', '/c'), r('/c', '/d')]);
  assert.equal(find(three, 'chain').length, 2);
  assert.match(find(three, 'chain')[0].message, /^\/a -> \/b -> \/c -> \/d: 3 redirects in a row/);
});

test('loop: a cycle is an error, reported once, however many rules lead into it', () => {
  const rep = run(['/a', '/b'], ['/x'], [r('/a', '/b'), r('/b', '/c'), r('/c', '/b'), r('/d', '/a')]);
  const loops = find(rep, 'loop');
  assert.equal(loops.length, 1);
  assert.match(loops[0].message, /^redirect loop: \/b -> \/c -> \/b/);
  assert.equal(find(rep, 'target-missing').length, 0);
  const two = run([], [], [r('/x', '/y'), r('/y', '/x')]);
  assert.equal(find(two, 'loop').length, 1);
});

test('the chain is followed for at most 20 hops, then reported as an error', () => {
  const rules = [];
  for (let i = 0; i < 25; i += 1) rules.push(r(`/p${i}`, `/p${i + 1}`));
  const rep = run(['/p0'], ['/p25'], rules);
  const long = find(rep, 'chain').filter((f) => f.severity === 'error');
  assert.equal(MAX_HOPS, 20);
  assert.equal(long[0].message.startsWith('/p0 starts a chain of more than 20 redirects; following stopped at /p20'), true);
  assert.equal(long.length, 5);
  const exactly = [];
  for (let i = 0; i < 20; i += 1) exactly.push(r(`/q${i}`, `/q${i + 1}`));
  const ok = run(['/q0'], ['/q20'], exactly);
  assert.equal(find(ok, 'chain').filter((f) => f.severity === 'error').length, 0);
  assert.match(find(ok, 'chain')[0].message, /20 redirects in a row; redirect \/q0 straight to \/q20/);
  const short = run(['/p0'], ['/p25'], rules, { maxHops: 3 });
  assert.match(find(short, 'chain').find((f) => f.severity === 'error').message, /more than 3 redirects/);
});

test('to-home: a warning with the count, an error over --home-limit', () => {
  const old = ['/a', '/b', '/c'];
  const rules = [r('/a', '/'), r('/b', 'https://www.example.com/'), r('/c', '/?utm_source=x')];
  const rep = run(old, ['/'], rules);
  const home = find(rep, 'to-home');
  assert.equal(home.length, 1);
  assert.equal(home[0].severity, 'warning');
  assert.match(home[0].message, /^3 old pages are redirected to the home page: \/a, \/b, \/c\. Google treats such redirects as soft 404s/);
  assert.equal(find(run(old, ['/'], rules, { homeLimit: 2 }), 'to-home')[0].severity, 'error');
  assert.equal(find(run(old, ['/'], rules, { homeLimit: 3 }), 'to-home')[0].severity, 'warning');
  assert.equal(find(run(['/a'], ['/'], [r('/a', '/?page=2')]), 'to-home').length, 0);
});

test('status-not-permanent: 302, 303 and 307 are warnings; 301, 308 and an unknown status are not', () => {
  const rep = run(['/a', '/b', '/c', '/d', '/e', '/f'], ['/x'], [r('/a', '/x', 302), r('/b', '/x', 303), r('/c', '/x', 307), r('/d', '/x', 301), r('/e', '/x', 308), r('/f', '/x', null)]);
  assert.deepEqual(find(rep, 'status-not-permanent').map((f) => f.from), ['/a', '/b', '/c']);
  assert.match(find(rep, 'status-not-permanent')[0].message, /is a 302, a temporary redirect; a site move needs a permanent 301 or 308/);
  assert.equal(rep.gate.pass, true);
  assert.equal(run(['/a'], ['/x'], [r('/a', '/x', 302)], { failOn: 'warning' }).gate.pass, false);
});

test('duplicate-source: the same source mapped to different targets is an error; the same target twice is a note', () => {
  const rep = run(['/a'], ['/x', '/y'], [r('/a', '/x', 301, 2), r('/a/', '/y', 301, 5), r('/a', '/x', 301, 7)]);
  const dup = find(rep, 'duplicate-source');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].message, '/a is mapped 3 times, to different targets: /x (line 2), /y (line 5); the first one is used in the other checks');
  assert.ok(rep.notes.some((n) => /1 redirect repeat an earlier one/.test(n)));
  assert.equal(find(run(['/a'], ['/x'], [r('/a', '/x'), r('/a', '/x')]), 'duplicate-source').length, 0);
});

test('self-redirect is an error; a redirect that only changes case or a trailing slash is info', () => {
  const rep = run(['/a', '/B', '/c/'], ['/a', '/b', '/c'], [r('/a', '/a'), r('/B', '/b'), r('/c/', '/c')]);
  assert.deepEqual(find(rep, 'self-redirect').map((f) => f.from), ['/a']);
  assert.deepEqual(find(rep, 'case-or-slash-only').map((f) => `${f.from} -> ${f.to}`), ['/B -> /b', '/c/ -> /c']);
  assert.equal(find(rep, 'target-missing').length, 0);
  assert.equal(find(rep, 'loop').length, 0);
  const strict = run(['/c/'], ['/c'], [r('/c/', '/c')], { strictSlash: true });
  assert.deepEqual(ids(strict), ['case-or-slash-only']);
  const scheme = run(['http://www.example.com/a'], ['/a'], [r('http://www.example.com/a', 'https://www.example.com/a')]);
  assert.equal(find(scheme, 'self-redirect').length, 0);
  assert.ok(scheme.notes.some((n) => /change only the scheme or the host/.test(n)));
});

test('kept and new-only are counted; a new page that no redirect reaches is named', () => {
  const rep = run(['/', '/terms', '/old'], ['/', '/terms', '/new', '/stockists'], [r('/old', '/new')]);
  assert.equal(find(rep, 'kept')[0].message, '2 old URLs exist unchanged on the new site and need no redirect');
  assert.equal(find(rep, 'new-only')[0].message, '1 new URL is not on the old site and no redirect points to it: /stockists');
  assert.equal(rep.summary.newOnly, 1);
  assert.equal(rep.summary.kept, 2);
});

test('normalisation options change what matches', () => {
  const old = ['/Women/', '/sale?utm_source=x'];
  const newer = ['/women', '/sale'];
  assert.deepEqual(find(run(old, newer, []), 'unmapped').map((f) => f.from), ['/Women']);
  assert.equal(find(run(old, newer, [], { caseInsensitive: true }), 'unmapped').length, 0);
  assert.deepEqual(find(run(old, newer, [], { caseInsensitive: true, strictSlash: true }), 'unmapped').map((f) => f.from), ['/women/']);
  const hosts = run(['https://old.example.com/a'], ['https://www.example.com/a'], [], { keepHost: true });
  assert.deepEqual(find(hosts, 'unmapped').map((f) => f.from), ['https://old.example.com/a']);
});

test('unsupported map lines and unreadable URLs are reported, not guessed', () => {
  const rep = checkMap({ old: ['/a', 'mailto:x@example.com'], new: ['/b'], rules: [r('/a', '/b'), r('javascript:alert(1)', '/b', 301, 9)], unsupported: [{ line: 3, text: 'RedirectMatch ^/x(.*) /y', reason: 'a rule with a regular expression is not evaluated' }] });
  const u = find(rep, 'unsupported');
  assert.equal(u.length, 2);
  assert.match(u[0].message, /^line 3: a rule with a regular expression is not evaluated: RedirectMatch/);
  assert.match(u[1].message, /^line 9: the source "javascript:alert\(1\)": not a web address/);
  assert.ok(rep.notes.some((n) => /1 line of the old URL file could not be read as a web address/.test(n)));
});

test('--limit shows the first findings, errors first; the counts and the gate cover all', () => {
  const old = Array.from({ length: 30 }, (_, i) => `/p${i}`);
  const rep = run(old, ['/x'], [r('/p0', '/x', 302)], { limit: 5 });
  assert.equal(rep.total, 30);
  assert.equal(rep.shown, 5);
  assert.equal(rep.findings.length, 5);
  assert.equal(rep.counts.error, 29);
  assert.equal(rep.byCheck.unmapped, 29);
  assert.equal(rep.byCheck['status-not-permanent'], 1);
  assert.ok(rep.findings.every((f) => f.severity === 'error'));
  assert.equal(rep.gate.reason, '29 errors');
});

test('safeText strips control and direction characters and caps the length', () => {
  assert.equal(safeText('a\u001b[2Jb\u202Ec\u2028d'), 'a [2Jb c d');
  assert.equal(safeText('x'.repeat(400)).length, 300);
  const rep = run(['/a\u0007b'], [], []);
  assert.ok(!/[\u0000-\u001f]/.test(find(rep, 'unmapped')[0].message));
});
