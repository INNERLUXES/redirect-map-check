# Method

The tool answers one question: after the move, will every address of the old site lead a visitor and a search engine to the right page of the new site, in one permanent step? It reads the old site's URLs, the new site's URLs and the redirect map, normalises every address the same way, follows each redirect to its end, and reports what does not arrive. The site move rules follow Google Search Central, [Site moves with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes), and the meaning of each status code follows [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110), section 15.4.

## Why the map decides the result of a move

Search engines rank addresses, not products. When an online store moves to a new platform, the ranking, the links from other sites and the bookmarks of returning customers all belong to the old addresses. Google's guide says what carries them over: map every old URL to its new URL, use permanent server-side redirects from each old URL to its new one, and avoid chains of redirects. A page that is left out answers 404 and drops out of the index; a page sent to the wrong place, or to the home page, loses what it had built up. Once the old site is switched off, the only record of what it held is the export made before the move, which is why the check runs before launch day.

A finding is an **error** when an old address will not reach a working page: the visitor and the crawler hit a 404, a loop or a dead end. It is a **warning** when the address arrives but in a way that wastes or weakens the move: an extra hop, a temporary status, a redirect to the home page. It is **info** when nothing is wrong but the number is worth knowing.

## Reading the inputs

1. **URLs.** A sitemap gives the text of each `<loc>` in a `<url>`; a sitemap index gives the `<loc>` of each `<sitemap>`, and each child is read from the folder given with `--sitemap-dir`, never fetched. A list gives one address per line. The reader is strict: a DOCTYPE or ENTITY declaration, an unknown escape, a bare `&`, or a tag that is not closed stops the run with the reason.
2. **Redirects.** A CSV map gives one redirect per row; Apache gives one per `Redirect` line; nginx gives one per exact `location` with a single `return`, and one per `rewrite` whose pattern is a literal path. Each redirect keeps the line it came from, so every finding points back to the row to fix.
3. **What is not read.** A rule the tool cannot evaluate exactly (a regular expression, a capture, a variable, a prefix location, a condition) is reported as `unsupported` with its line and the reason. It is never turned into a guess, because a guessed redirect would hide an `unmapped` error behind a rule that may not match.

## Comparing addresses

Two addresses are the same page when they are the same after this normalisation:

1. **Scheme and host** are ignored by default, so a map written with paths matches a sitemap written with full addresses, and a move from `http` to `https` is not a difference. `--keep-host` compares them, for a move between domains or subdomains; the default ports 80 and 443 are dropped and the host is lower-cased.
2. **Trailing slash.** `/women/` and `/women` are the same by default, since most platforms answer both with the same page. `--strict-slash` keeps them apart, for servers that treat them as two addresses.
3. **Case.** Paths are case sensitive by default, as RFC 3986 says and as most servers treat them. `--case-insensitive` folds them, for a server that answers `/Women` and `/women` with the same page.
4. **Query.** The fragment is removed. The parameters `utm_*`, `gclid` and `fbclid` are dropped: they come from ad and newsletter links and never name a different page. Other parameters are kept in their order, since `?page=2` or `?color=blue` may be a page of its own.
5. **Percent-encoding** is normalised as RFC 3986 section 6.2.2 says: escapes of unreserved characters are decoded (`%7E` is `~`), other escapes get upper-case hex digits, and characters that may not stand in a URL are encoded as UTF-8 (`é` is `%C3%A9`).

The first redirect given for a source is the one the other checks use; later ones for the same source are reported as `duplicate-source` when their target differs.

## The checks

| Id | Severity | Rule and why it matters |
| --- | --- | --- |
| `unmapped` | error | An old URL is not on the new site (after normalisation) and no redirect has it as its source. After the move it answers 404. Google's guide asks for a mapping of every old URL; a page that is not mapped drops out of the index with everything it had built up |
| `target-missing` | error | A redirect's target is not on the new site and is not the source of another redirect. The visitor is sent to a page that does not exist; the redirect turns a 404 into a redirect and then a 404. The usual cause is a typo or a handle that changed on the new platform |
| `loop` | error | Following the redirects comes back to an address already passed (A -> B -> A). No URL in the loop can be reached; browsers stop with an error. The loop is reported once, with every address in it |
| `duplicate-source` | error | One old URL is mapped to two or more different targets. Only one of them can apply on the server, and which one depends on the order of the rules, so the map does not say what will happen. Rows with the same source and the same target are only counted in a note |
| `self-redirect` | error | The target is the source itself, with the same scheme, host, path and query. Served as written, it is a loop of one |
| `chain` | warning / error | The target of a redirect is itself redirected (A -> B -> C). Google's guide asks to avoid chains: each hop is another request, and Google follows a limited number of hops in one crawl. The message gives the full chain and the direct target, so the row can be changed to A -> C. Following stops after 20 hops, which browsers also treat as the end; such a chain is an error |
| `to-home` | warning / error | Old pages redirected to the home page, counted in one finding. Google treats redirects of many old URLs to the home page as soft 404s: the old page is dropped as if it were gone, and the home page gains nothing. Send each page to its closest equivalent. More than `--home-limit` (default 10) is an error, since by then it is a pattern, not an exception. A redirect from the home page to itself is not counted |
| `status-not-permanent` | warning | A redirect with status 302, 303 or 307 where the map gives a status. RFC 9110 section 15.4 defines 301 (Moved Permanently) and 308 (Permanent Redirect) as permanent, and 302 (Found), 303 (See Other) and 307 (Temporary Redirect) as temporary. Google's guide asks for permanent redirects in a site move: a temporary one tells search engines to keep the old address. An Apache `Redirect` without a status is a 302 and is reported |
| `unsupported` | warning | A map line the tool did not read: a regular expression rule, a rule with a capture or variable, a prefix location, an `if` block, an empty cell, a status that is not a redirect, or an address that is not a web address. The old URLs such a rule was meant to cover show up as `unmapped`; check them by hand or list them in a CSV map |
| `case-or-slash-only` | info | A redirect that only changes the case of the path or a trailing slash. Usually correct (it gives one address per page), but on a server that already treats both forms the same, it can be a loop; check it on the staging site |
| `kept` | info | Old URLs that exist unchanged on the new site. They need no redirect, and are counted so the totals add up: old URLs = kept + redirected + unmapped |
| `new-only` | info | New URLs that are not on the old site and that no redirect points to, counted and named. Most are new pages, but this list is also where the right targets of broken redirects are found: a product page with no redirect to it often means its old page was sent somewhere else |

Notes add what is not a finding: redirect sources that are not in the old URL file (often fine, such as old campaign addresses, but also a sign of a mistyped source), old URLs that are on the new site and also redirected (the redirect wins, so the new page at that address cannot be reached), addresses in a URL file that could not be read, and redirects that change only the scheme or host.

## Severity and the gate

`--fail-on error`, the default, makes the run exit with `1` when any error is found. `--fail-on warning` also fails on warnings. Info never fails a run. `--limit` cuts only the list that is shown; the counts and the gate always cover every finding.

The method has no randomness and no network access: the same files always give the same report, and any change in the report comes from a change in the files.
