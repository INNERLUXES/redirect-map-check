# Secure defaults

The default run is the safe run. Nothing below needs a flag, and none of it can be switched off.

## How the tool behaves by default

- **No network.** The tool reads the files it is given and sends nothing anywhere. It does not fetch sitemaps, child sitemaps, pages or redirect targets, does not resolve host names, and does not check for updates. An address given where a file is expected is refused. It can run in a locked-down build job with no outbound access at all.
- **No commands.** The tool runs no other program. No path, host or rule from the input is ever put on a command line, and nothing in a configuration snippet is executed: an nginx or Apache file is read as text and only the redirect lines are taken from it.
- **No dependencies.** Node 22 or newer and nothing else, so there is no third-party code in the path of sitemaps and maps that may hold unreleased product names or internal addresses.
- **Safe XML.** The sitemap reader is a small scanner written for sitemaps, not a general XML parser. A DOCTYPE or ENTITY declaration stops the run before anything is parsed, so no entity can expand and no external entity can be resolved. Only the five predefined escapes and numeric character references are decoded; any other escape, a bare `&`, a tag that is not closed, a second root element or an element inside `<loc>` stops the run with the reason.
- **Local sitemap indexes only.** A sitemap index is read only with `--sitemap-dir`. Each child must be a plain file name inside that folder: no path parts, no `..`, no encoded slashes. A compressed child, a missing child and an index inside an index stop the run; the tool never falls back to fetching.
- **Rules are never guessed.** Redirects with regular expressions, captures, variables, prefix matching or conditions are reported as `unsupported` with their line and the reason. They are not translated into exact redirects, because a guess that happens to match would hide a page that the server will not redirect.
- **Clean output.** Text from the input has control characters, line separators and direction controls removed and its length capped before it reaches a report, so a hostile map cannot rewrite the terminal or reorder what a reviewer reads. Markdown cells escape pipes, backslashes and line breaks. CSV cells are quoted as RFC 4180 says, and a cell that a spreadsheet would read as a formula gets a leading `'`. No report renders an address as a clickable link.
- **Bounded input.** Files over 50 MB are refused before they are read. More than 1,000,000 URLs in one URL file, or redirects in one map, stop the run. URLs over 8,192 characters are not read. Chains are followed for at most 20 hops, and loops are detected at the first repeat. XML nesting over 64 and nginx nesting over 32 stop the run. The report says when a limit was reached, so a cut is never silent.
- **Strict addresses.** Only `http` and `https` addresses and paths are compared. `javascript:`, `data:`, `mailto:` and other schemes are refused, and so is an address with a user name or password in it. The reason is given for each one.
- **Fails closed.** A missing option, a missing file, a file over the limit, too many URLs, a sitemap that is not well formed, a sitemap index without its folder, or a CSV header the tool does not know stops the run with exit code 2 and the reason, instead of a clean report about nothing.
- **The gate is on.** Without any option, an error makes the run exit with `1`: an unmapped page, a missing target, a loop, a duplicate source or a self-redirect. A pipeline that adds the tool is protected from the first run; there is no report-only mode to forget to turn off.
- **Counts are never cut.** `--limit` shortens only the list of findings shown. The counts per severity and per check, and the gate, always cover every finding.
- **Writes nothing to disk.** The report goes to the screen. Redirect it to a file, or to the job summary, only when you need to keep it.

## Running it in a pipeline safely

1. Keep the inputs in the repository: the export of the old site's URLs, the redirect map, and, for a sitemap index, its child sitemaps in one folder. Changes to the map then go through review like code.
2. Build the new site's sitemap in an earlier step of the same job, from the same commit, and give it to the tool as a file. Do not let the job download a sitemap from an address that a pull request can change.
3. Run the check with read access to the repository and nothing else: no deploy keys, no hosting tokens, no write permissions. It needs none.
4. Use the tool from a pinned commit. `npx --yes github:INNERLUXES/redirect-map-check#<commit>` runs exactly the code that was reviewed, not whatever the default branch holds on the day.
5. Run the check on every pull request that changes the map or the new site's URLs, not only on launch day. A product renamed on the new platform a week before launch silently breaks the redirects that point to it; the check catches it in the pull request that renamed it.
6. Keep the default `--fail-on error`. Add `--fail-on warning` once the map is clean, so that new chains, temporary redirects and redirects to the home page stop a merge too.
7. Write the Markdown report to the job summary, so the reviewer sees the findings next to the change, and keep the exit code as the gate.
8. Keep `--home-limit` low. Raising it to make a run pass hides the soft 404 pattern the check exists to catch; fix the redirects instead.
9. Decide the comparison options once, from how the new server behaves (`--strict-slash` if it treats `/a` and `/a/` as different pages, `--case-insensitive` if it folds case), write them into the pipeline file, and review a change to them like a change to the map.

## Building a map the tool can check well

1. Start from complete lists. Export every URL of the old site from its platform or its sitemap, and add the URLs that receive traffic or links but are not in the sitemap: filtered category pages, old campaign pages, paginated pages, from analytics, Search Console and server logs.
2. Map one to one. Send each old product to its new product page, each old category to its new category, each old article to its new article. Use the home page only for the home page.
3. Point straight at the final address. When the new site has its own redirects (from a slug with a trailing slash, from an old handle), map to the address that answers 200, not to one that redirects again.
4. Use permanent redirects. Give 301 (or 308) for every row of the map, and write the status in the map, so the check can see it. In Apache, write `Redirect 301` or `RedirectPermanent`; a bare `Redirect` is a 302.
5. Prefer exact rules. Write one exact redirect per page in the map the check reads, even when the server will use a pattern rule. Generate the exact list from the pattern if needed, and check that list; the pattern itself cannot be checked.
6. Keep one source per row. When the same old URL appears twice, decide which target is right and remove the other row; do not rely on the order of the rules.
7. Keep tracking parameters out of targets. A target with `utm_` parameters works, but it carries campaign data into every visit from an old link and into the address search engines see.
8. Keep the map free of private data. A map is often shared with agencies and hosting providers; it should hold addresses only, not customer names, order numbers, or staging host names with credentials in them.

## Moving the site safely

The tool tells you that a map is wrong; these are the usual steps to move a store without losing its search traffic, as Google's guide to site moves describes them.

1. **Freeze the old URL list.** Export it before the move and keep it. Once the old platform is switched off, the export is the only record of what had to be redirected.
2. **Check the map before launch.** Run this tool until it reports no errors, and review the warnings one by one.
3. **Test on staging.** Crawl the old URLs against the staging site with its real server configuration, and check the real status codes and hop counts. A map check cannot see the order in which the server applies its rules.
4. **Launch with the redirects in place.** The redirects go live in the same release as the new site. A gap of even a few hours sends crawlers to 404 pages.
5. **Update what you control.** Change internal links, canonical tags, hreflang annotations, the sitemap and links in ads and emails to the new addresses, so that visitors and crawlers do not depend on the redirects for links you own.
6. **Submit the new sitemap and watch.** Submit the new sitemap in Search Console, and watch crawl errors, 404s and the indexing of the new pages in the weeks after the move. Add a redirect for every old URL that shows up as a 404.
7. **Keep the redirects.** Keep them in place for as long as possible, as Google's guide asks: old links, bookmarks and emails keep being used long after the move, and removing the redirects loses what they carried over.

## Sharing a report safely

1. A report shows addresses from the old site, the new site and the map, and map lines that were not read. For a public site that is harmless. Before launch it can show the addresses of unreleased products or collections: share the report with the people who can see the map.
2. The report never shows file contents other than addresses and map lines. Findings name addresses by path and query; host names appear only with `--keep-host`, or inside a map line or an address that could not be read. A credential pasted into a map line is shown when that line is reported as unsupported; remove it from the map and rotate it.
3. Prefer the Markdown or text report over the raw files when you send the result to another team, so only the findings leave the repository.
