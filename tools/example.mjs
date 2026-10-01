// Runs the README examples and checks that they report what the README shows.

import { main } from '../src/index.js';

async function run(argv) {
  let out = '';
  const code = await main(argv, { out: (t) => { out += t; }, err: (t) => process.stderr.write(t) });
  process.stdout.write(out);
  return { code, out };
}

const problems = [];
function expect(name, result, code, expected, unwanted) {
  const missing = expected.filter((e) => !result.out.includes(e));
  const wrong = unwanted.filter((e) => result.out.includes(e));
  if (result.code !== code || missing.length || wrong.length) {
    problems.push(`${name}: unexpected report (exit code ${result.code}, expected ${code}; missing: ${missing.join(' / ') || 'none'}; should not appear: ${wrong.join(' / ') || 'none'})`);
  }
}

const sites = ['--old', 'examples/old-sitemap.xml', '--new', 'examples/new-sitemap.xml'];

const csv = await run([...sites, '--map', 'examples/redirects.csv']);
expect('redirects.csv', csv, 1, [
  'redirect-map-check: old examples/old-sitemap.xml, new examples/new-sitemap.xml, map examples/redirects.csv (csv)',
  'old URLs: 23 (4 kept, 18 redirected, 1 unmapped); new URLs: 23 (5 new-only); redirects: 22',
  'findings: 5 error, 3 warning, 3 info (11 shown)',
  'ERROR     unmapped              /size-guide.html is not on the new site and has no redirect',
  'ERROR     target-missing        /women/tops.html -> /collections/womens-tops (line 7)',
  'ERROR     loop                  redirect loop: /spring-sale -> /promo -> /spring-sale (line 22)',
  'ERROR     duplicate-source      /linen-wrap-dress.html is mapped 2 times',
  'ERROR     self-redirect         /blog/care-for-linen.html redirects to itself (line 21)',
  'WARNING   chain                 /men/shirts.html -> /collections/mens-shirts -> /collections/men-shirts (line 9)',
  'WARNING   to-home               2 old pages are redirected to the home page: /oxford-shirt.html (line 16), /canvas-tote.html (line 18)',
  'WARNING   status-not-permanent  /men/jackets.html -> /collections/men-jackets (line 11) is a 302',
  'INFO      case-or-slash-only    /FAQ -> /faq (line 24)',
  'INFO      kept                  4 old URLs exist unchanged on the new site',
  'INFO      new-only              5 new URLs are not on the old site and no redirect points to them',
  'GATE: FAIL - 5 errors'
], ['/sale.html', 'unsupported', 'utm_source']);

process.stdout.write('\n');
const nginx = await run([...sites, '--map', 'examples/nginx.conf']);
expect('nginx.conf', nginx, 1, [
  'map examples/nginx.conf (nginx)',
  'old URLs: 23 (4 kept, 8 redirected, 11 unmapped); new URLs: 23 (11 new-only); redirects: 8',
  'WARNING   status-not-permanent  /sale.html -> /collections/sale (line 14) is a 302',
  'WARNING   unsupported           line 17: a rule with a regular expression is not evaluated',
  'WARNING   unsupported           line 20: only exact "location = /path" blocks are read',
  'ERROR     unmapped              /men/shirts.html is not on the new site and has no redirect',
  'GATE: FAIL - 11 errors'
], ['target-missing', 'chain', 'loop']);

if (problems.length) {
  for (const p of problems) console.error(`example: ${p}`);
  process.exit(1);
}
