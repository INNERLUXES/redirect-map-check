# 1. Read sitemaps and map files, do not crawl the sites

## Context

The tool needs the old site's URLs, the new site's URLs and the redirects between them. The obvious way to get all three is to crawl: fetch the old sitemap from the live site, follow the redirects with real requests, and fetch the new pages to see whether they answer. That makes the result depend on the network, on the state of both sites at the moment of the run, on rate limits and firewalls, and on credentials for a staging site that is usually protected. It also means the tool sends requests to whatever addresses the input names. A sitemap index or a map from a pull request could point it at an internal address, a cloud metadata endpoint, or a site that does not belong to the team, and the pipeline would make those requests with its own network access. And on the day it matters most, the old site is often already switched off, so there is nothing left to crawl.

## Decision

The tool reads local files only: an export of the old site's URLs, a sitemap of the new site, and the redirect map. A sitemap index is read only from a local folder given with `--sitemap-dir`. It never fetches a page, a sitemap or a child sitemap, and an address given where a file is expected is refused.

## Consequences

The check runs anywhere Node runs, with no network access, and the same files always give the same report, so it can gate a pull request that changes the map. It can run before the new site exists anywhere but on a build server, and after the old site is gone, from the export kept in the repository. No input can make it send a request. The cost is that it checks the map, not the servers: the order in which a server applies its rules, rules with regular expressions, and the real status codes stay outside it. The README and docs/limits.md say so, and recommend a crawl of the old URLs against the staging site as a separate step, run by people who choose which site it may reach.
