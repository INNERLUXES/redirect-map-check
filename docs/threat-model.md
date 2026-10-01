# Threat model

## What the tool touches

- It reads the old URL file, the new URL file and the map named on the command line, and, for a sitemap index, the child sitemaps in the folder given with `--sitemap-dir`, and only those. Nothing inside them is followed as a link, fetched or run.
- It writes only to the screen (standard output and standard error).
- It opens no network connection and runs no other program.

## What the input may hold

Sitemaps and redirect maps come from many hands: an export from the old platform, a sitemap built by the new one, a spreadsheet edited by the marketing team, a configuration snippet from a hosting provider, or a file attached to a pull request by an outside contributor. The tool treats all of them as possibly hostile. A sitemap is XML, and XML can carry entity declarations that expand to gigabytes (the "billion laughs" pattern) or point to local files and remote addresses (external entities). A map can carry text meant to break a report: formulas for a spreadsheet, Markdown that hides a row, or terminal escape sequences. A sitemap index can name child files with paths meant to reach outside the folder.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| An entity declaration in a sitemap expands to a huge string, or an external entity reads a local file or a remote address | Any `<!DOCTYPE` or `<!ENTITY` in a sitemap stops the run before anything is parsed. Only the five predefined escapes and numeric character references are decoded; any other `&name;` is an error |
| A sitemap index makes the tool fetch child sitemaps from an address an attacker controls, or probe an internal network | The tool never fetches anything. A sitemap index is read only with `--sitemap-dir`, from local files. An address given as `--old`, `--new` or `--map` is refused |
| A child sitemap name such as `..%2F..%2Fsecrets.xml` reads a file outside the folder | The child name is the last part of its address, decoded once, and must be a plain file name of letters, digits, dots, hyphens and underscores; anything else stops the run |
| A huge file, a huge number of URLs or a deep nesting exhausts memory or the call stack | Files over 50 MB are refused before they are read; more than 1,000,000 URLs or redirects stop the run; XML nesting over 64 and nginx nesting over 32 stop the run; URLs over 8,192 characters are not read |
| A redirect loop or a very long chain makes the check run forever | Each chain is followed with a set of visited addresses and stops at the first repeat (a loop) or after 20 hops |
| A pattern with nested repetition takes exponential time on a crafted line | The patterns for escapes, CSV, Apache and nginx lines have no nested repetition; the XML reader and the nginx reader are hand-written scanners that read each character once |
| Map text rewrites the terminal through escape sequences, or reorders text with direction characters | Control characters (C0 and C1), line and paragraph separators and Unicode direction controls are replaced by a space before any text reaches a report, and the length is capped |
| Map text breaks the Markdown table in the job summary, or injects Markdown that hides a finding | Pipes, backslashes and line breaks are escaped in every table cell |
| A CSV report runs a formula when opened in a spreadsheet | Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading `'`; every cell is quoted as RFC 4180 says |
| A rule the tool does not understand is read as something it is not, and a clean report hides a missing redirect | Rules with regular expressions, captures, variables or conditions are reported as `unsupported` and never evaluated; the URLs they were meant to cover stay `unmapped` |
| A partial read gives a clean report for a site whose missing pages were in the part not read | Every limit stops the run or is reported: too many URLs is an error, unreadable lines are counted in notes, `--limit` cuts only the list shown, never the counts or the gate |
| A wrong file is given (a README instead of the map) and gives a clean report about nothing | A CSV map without a known header or a URL in its first cell stops the run; a map with no redirect the tool could read is noted; an empty URL file is noted |
| A `javascript:` or `data:` address in a map ends up as a link in a report | Only `http` and `https` addresses and paths are read; anything else is `unsupported`. Reports never render an address as a link |

## Out of scope

Whether the redirects are right for the business, what the live server does, and who may change the map. docs/limits.md lists what a map check cannot see.
