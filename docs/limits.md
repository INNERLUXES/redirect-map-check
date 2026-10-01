# Limits

## What a map check cannot see

- **Which rule the server applies first.** The tool reads the map as a list of exact redirects. A real server applies its own order: Apache runs mod_alias and mod_rewrite rules in an order set by its configuration, nginx picks an exact `location` before a prefix one and a regular expression before a plain prefix, and a platform's own redirect table may run before or after the server's. A rule elsewhere in the configuration (a forced trailing slash, a forced lower case, a `www` redirect, a language redirect) can add a hop or change the target. Check the server configuration as a whole on the staging site.
- **Rules with regular expressions.** `RedirectMatch`, `RewriteRule`, nginx rewrites with captures or variables, prefix and regular expression locations, and `if` blocks are reported as `unsupported`, not evaluated. The old URLs they cover show up as `unmapped`. A pattern rule is the usual way to move a whole section (`/blog/(.*)\.html` to `/blogs/journal/$1`); list the URLs it should cover in a CSV map, or check them on the staging site.
- **Prefix matching.** Apache's `Redirect /a /b` also redirects `/a/x` to `/b/x`. The tool reads it as a redirect of `/a` only, so `/a/x` may be reported as `unmapped` although the server would redirect it.
- **Redirects that are not in the map.** Redirects made in JavaScript, with a `<meta http-equiv="refresh">`, by a CDN or edge rule, or automatically by the new platform (some platforms redirect old handles of renamed products on their own) are not in the map file, so the tool does not see them.
- **Whether the new page is equivalent.** The tool checks that a redirect reaches a page that exists. It cannot tell whether `/products/linen-dress` is the right replacement for `/linen-wrap-dress.html`, whether the new page has the same content, or whether a category was split or merged well. Review the mapping of the pages that bring the most traffic by hand.
- **Whether the pages answer.** A URL in the new sitemap may still answer 404, 500, or a redirect of its own on the live server; a sitemap is a list, not a test. The tool never crawls the site. Crawl the old URLs against the staging site before launch, and again on launch day, to see the real status codes and hops.
- **What the sitemaps leave out.** Old URLs that were never in the old sitemap (filtered category pages, old campaign landing pages, paginated pages, image URLs) are not checked unless they are added to the old URL file. Add the URLs that receive traffic or links, from analytics, Search Console and server logs, to the list.
- **Hosts and protocols.** Without `--keep-host`, the tool does not see a move between domains or a redirect that sends visitors to the wrong host. With `--keep-host`, every URL in all three files should be a full address, or the paths and the full addresses will not match.
- **Query strings.** Parameters are compared in the order written. `?a=1&b=2` and `?b=2&a=1` are different addresses to the tool. Only `utm_*`, `gclid` and `fbclid` are dropped.
- **Gone pages.** A page removed on purpose (Apache `Redirect gone`, an nginx `return 410`) is reported as `unsupported`, and the old URL then shows as `unmapped`. That is correct when the page should have a replacement, and expected when it should not.

## What is read

- **Sitemaps** as the sitemaps.org protocol describes them: the `<loc>` of each `<url>`, or of each `<sitemap>` in an index. Namespace prefixes are accepted. Comments, processing instructions and CDATA sections are handled; the five XML escapes and numeric character references are decoded. A DOCTYPE or ENTITY declaration, any other escape, and a document that is not well formed stop the run.
- **Sitemap indexes** only with `--sitemap-dir`. Each child is read from that folder under the last part of its address, which must be a plain file name of letters, digits, dots, hyphens and underscores. Compressed (`.gz`) children and an index inside an index are refused.
- **URL lists**: one address per line; blank lines and lines starting with `#` are skipped. A line that is not a web address (such as `mailto:`) is left out and counted in a note.
- **CSV maps** with a known header or without one; cells as RFC 4180 defines them. Only commas separate cells.
- **Apache** `Redirect`, `RedirectPermanent` and `RedirectTemp`. Container lines such as `<IfModule>` and common directives that do not redirect are skipped; other lines are reported.
- **nginx** exact locations with one `return` and literal `rewrite` rules; the configuration must be balanced (every `{` closed, every directive ended with `;`).
- Windows line ends and a leading byte order mark are accepted in every file.

## Size

- A file over 50 MB is refused before it is read, and so is each child sitemap of an index.
- At most 1,000,000 URLs are read from one URL file (counting all children of an index together), and at most 1,000,000 redirects from one map. A larger file stops the run with exit code 2, rather than checking only part of the site: an unmapped page in the part left out would be missed. Split the check by section.
- A URL longer than 8,192 characters is not read and is counted in a note.
- Chains are followed for at most 20 hops; a longer chain is reported as an error at the point where following stopped.
- Sitemap elements nested more than 64 deep and nginx blocks nested more than 32 deep stop the run.
- Text shown in a report is cut to a fixed length: 300 characters for an address, 200 for a map line.

Every limit is reported, as an error, a finding or a note, so a cut is never silent.
