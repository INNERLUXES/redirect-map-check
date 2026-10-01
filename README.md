# redirect-map-check

Checks a redirect map before a website moves to a new platform or a new URL structure: every URL of the old site must reach a page of the new site, in one permanent redirect, so that search engines carry the old pages' rankings over to the new ones. It follows Google's guide to [site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes) and the redirect status codes of [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110).

An online store that moves to a new platform almost always gets new URLs: `/linen-wrap-dress.html` becomes `/products/linen-wrap-dress`, `/women/dresses.html` becomes `/collections/women-dresses`. Every category and product page that ranked in search, and every link that other sites and old emails point to, depends on a redirect from the old address to the new one. The redirect map is usually a spreadsheet built by hand from two exports, and the usual mistakes are quiet: a product nobody mapped, a target with a typo, a redirect to a redirect, a loop, a whole catalogue sent to the home page, a 302 where a 301 was meant. Each of them shows up weeks later as lost rankings and 404s in Search Console, when the old site is gone. This tool compares the map with the old and the new site's URLs before launch day and fails the pipeline when the map is wrong.

- Every finding has an id, a severity (error, warning, info), the line of the map it comes from, and a plain message that says what to change.
- It reads sitemaps, sitemap indexes, URL lists, CSV maps (including Shopify and Magento style exports), Apache `Redirect` lines and simple nginx rules.
- Rules it cannot evaluate, such as `RedirectMatch`, `RewriteRule` or an nginx rewrite with a capture, are reported as unsupported, never guessed at.
- It reads local files only. It never fetches a page, a sitemap or a child sitemap, and opens no network connection.
- Plain JavaScript, no dependencies; the same files always give the same report.

```
npm test
```

```
ℹ tests 49
ℹ pass 49
ℹ fail 0
```

## Quick start

Requires Node 22 or newer. There is nothing to install.

```
git clone https://github.com/INNERLUXES/redirect-map-check.git
cd redirect-map-check
node bin/redirect-map-check.js --old examples/old-sitemap.xml --new examples/new-sitemap.xml --map examples/redirects.csv
```

Or without a clone:

```
npx --yes github:INNERLUXES/redirect-map-check --old old-sitemap.xml --new new-sitemap.xml --map redirects.csv
```

`examples/old-sitemap.xml` is a made-up clothing store on example.com on its old platform: pages, categories, products and a blog. `examples/new-sitemap.xml` is the same store on its new platform. `examples/redirects.csv` maps one to the other, with good mappings and one of each common mistake:

```
redirect-map-check: old examples/old-sitemap.xml, new examples/new-sitemap.xml, map examples/redirects.csv (csv)
old URLs: 23 (4 kept, 18 redirected, 1 unmapped); new URLs: 23 (5 new-only); redirects: 22
findings: 5 error, 3 warning, 3 info (11 shown)

ERROR     unmapped              /size-guide.html is not on the new site and has no redirect

ERROR     target-missing        /women/tops.html -> /collections/womens-tops (line 7): the target is not on the new site and is not redirected

ERROR     loop                  redirect loop: /spring-sale -> /promo -> /spring-sale (line 22); none of these URLs can be reached

ERROR     duplicate-source      /linen-wrap-dress.html is mapped 2 times, to different targets: /products/linen-wrap-dress (line 13), /products/linen-dress (line 14); the first one is used in the other checks

ERROR     self-redirect         /blog/care-for-linen.html redirects to itself (line 21); a browser that follows it never arrives

WARNING   chain                 /men/shirts.html -> /collections/mens-shirts -> /collections/men-shirts (line 9): 2 redirects in a row; redirect /men/shirts.html straight to /collections/men-shirts

WARNING   to-home               2 old pages are redirected to the home page: /oxford-shirt.html (line 16), /canvas-tote.html (line 18). Google treats such redirects as soft 404s; send each to its closest new page (more than 10 is an error, --home-limit)

WARNING   status-not-permanent  /men/jackets.html -> /collections/men-jackets (line 11) is a 302, a temporary redirect; a site move needs a permanent 301 or 308

INFO      case-or-slash-only    /FAQ -> /faq (line 24) only changes the case or a trailing slash

INFO      kept                  4 old URLs exist unchanged on the new site and need no redirect

INFO      new-only              5 new URLs are not on the old site and no redirect points to them: /pages/stockists, /collections/all, /collections/women-tops, /products/oxford-shirt, /blogs/journal/care-for-linen

note: 4 redirect sources are not in the old URL file: /collections/mens-shirts, /spring-sale, /promo, /FAQ

GATE: FAIL - 5 errors
```

The exit code is `1`. The `new-only` line is worth reading next to the errors: `/collections/women-tops`, `/products/oxford-shirt` and `/blogs/journal/care-for-linen` are the pages the broken redirects should have pointed to. The `/sale.html` row points to `/collections/sale?utm_source=old-site`; tracking parameters are dropped before comparing, so it matches. `examples/nginx.conf` holds part of the same map as nginx rules, with one rule that uses a capture and one prefix location, both reported as unsupported.

## Usage

```
redirect-map-check --old <file> --new <file> --map <file> [options]
```

```
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
--help                  show the usage
--version               show the version
```

## Checks

| Id | Severity | What it reports |
| --- | --- | --- |
| `unmapped` | error | An old URL that is not on the new site and has no redirect: it will answer 404 after the move |
| `target-missing` | error | A redirect whose target is not on the new site and is not itself redirected |
| `loop` | error | Redirects that lead back to a URL already passed, such as A -> B -> A; reported once per loop |
| `duplicate-source` | error | The same old URL mapped twice, to different targets; the first one is used in the other checks |
| `self-redirect` | error | A redirect whose target is its own source |
| `chain` | warning / error | A redirect that leads to another redirect, with the full chain and the direct target to use instead; an error when the chain is longer than 20 hops |
| `to-home` | warning / error | Old pages redirected to the home page, counted; an error when there are more than `--home-limit` (default 10) |
| `status-not-permanent` | warning | A 302, 303 or 307 where a permanent 301 or 308 is expected, when the map gives a status |
| `unsupported` | warning | A line of the map in a form the tool does not read, such as a regular expression rule, an empty cell or a status that is not a redirect |
| `case-or-slash-only` | info | A redirect that only changes the case of the path or a trailing slash |
| `kept` | info | Old URLs that exist unchanged on the new site, counted |
| `new-only` | info | New URLs that are not on the old site and that no redirect points to, counted and named |

[docs/method.md](docs/method.md) gives each check and why it matters for a site move.

## Input formats

**URL files** (`--old`, `--new`):

- A sitemap: the text of each `<loc>` inside `<url>`. Image, video and `hreflang` entries are not read.
- A sitemap index: the text of each `<loc>` inside `<sitemap>`, read only with `--sitemap-dir`. Each child sitemap must be saved in that folder under the last part of its address (`https://www.example.com/sitemaps/products.xml` is read from `<dir>/products.xml`). Compressed children and an index inside an index are refused.
- A list: one URL or path per line; blank lines and lines starting with `#` are skipped.

**Redirect maps** (`--map`), recognised from the content:

- CSV with a header row: `from,to[,status]`, `Redirect from,Redirect to` (Shopify), `request_path,target_path[,redirect_type]` (Magento), `source,target` or `old url,new url`; or two or three columns without a header when the first cell starts with `/` or `http`. Quoted cells follow RFC 4180.
- Apache: `Redirect [status] /old /new`, `RedirectPermanent` and `RedirectTemp`. A `Redirect` without a status is a 302, as in Apache. `RedirectMatch`, `RewriteRule` and `RewriteCond` lines are reported as unsupported.
- nginx: `location = /old { return 301 /new; }` and `rewrite ^/old$ /new permanent;` (or `redirect`). Prefix and regular expression locations, rewrites with captures or variables, `if` blocks and a `return` outside an exact location are reported as unsupported.

**Comparing URLs.** Before comparing, every URL is normalised: scheme and host are ignored (`--keep-host` compares them), a trailing slash is removed (`--strict-slash` keeps it), the path stays case sensitive (`--case-insensitive` folds it), the fragment is removed, `utm_*`, `gclid` and `fbclid` parameters are dropped while other query parameters are kept in order, and percent-encoding is normalised (`%7E` is `~`, `%c3%a9` is `%C3%A9`, `é` is `%C3%A9`).

## Formats

- `text`: for a terminal, errors first.
- `markdown`: a table of findings for a pull request comment or the job summary. Pipes and line breaks in text from the map are escaped, so a map cannot break the table.
- `json`: the whole report, with the counts per check, for other tools.
- `csv`: one row per finding shown, quoted as RFC 4180 says. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet does not run it as a formula.

## Exit codes

`0` no finding at the `--fail-on` level, `1` at least one such finding (by default: an error), `2` a usage or input error (a missing option, a missing file, a file over 50 MB, more than 1,000,000 URLs in a file, a sitemap that is not well-formed or holds a DOCTYPE, a sitemap index without `--sitemap-dir`, a CSV header the tool does not know).

## In a pipeline

Export the old site's sitemap before the move, keep it in the repository next to the map, and check the map against the new site's sitemap from the staging build on every change:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
  with:
    node-version: 22
- name: Check the redirect map
  run: |
    npx --yes github:INNERLUXES/redirect-map-check --old migration/old-sitemap.xml --new build/sitemap.xml --map migration/redirects.csv --format markdown >> "$GITHUB_STEP_SUMMARY"
```

The step summary shows the table; the exit code fails the job. Add `--fail-on warning` once chains, temporary redirects and redirects to the home page should stop the launch too.

## Limits

A map check sees the map, not the server. It cannot see which rule the server applies first, rules with regular expressions, redirects made in JavaScript or by the platform itself, or whether a new page really replaces the old one. Crawl the old URLs against the staging site before launch, and again after it. [docs/limits.md](docs/limits.md) lists these, with the size limits.

## Background

- How online stores are rebuilt and moved to a new platform without losing the pages that bring in search traffic: [ecommerce web development](https://innerluxes.dev/web-development/ecommerce).

## License

MIT
