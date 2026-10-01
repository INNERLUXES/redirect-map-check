# Changes

## 1.0.0

First release.

- Checks a redirect map against the old and the new site's URLs before a site move, following Google Search Central's guide to site moves with URL changes and the redirect status codes of RFC 9110.
- Reads URLs from sitemaps, from sitemap indexes whose child sitemaps are in a local folder (`--sitemap-dir`), and from lists with one URL per line; never fetches anything.
- Reads redirect maps as CSV (`from,to[,status]`, Shopify `Redirect from,Redirect to`, Magento `request_path,target_path`, or two columns without a header), Apache `Redirect` lines, and nginx `location = /a { return 301 /b; }` and literal `rewrite` rules. Regular expression rules and other forms are reported as unsupported, not guessed.
- A small, strict sitemap reader: only `<loc>` inside `<url>` or `<sitemap>`, CDATA and the XML escapes handled, DOCTYPE and ENTITY declarations refused.
- URLs normalised before comparing: scheme and host ignored unless `--keep-host`, trailing slash removed unless `--strict-slash`, case folded with `--case-insensitive`, `utm_*`, `gclid` and `fbclid` dropped, percent-encoding normalised.
- Twelve checks: `unmapped`, `target-missing`, `loop`, `duplicate-source`, `self-redirect`, `chain` (an error after 20 hops), `to-home` (an error over `--home-limit`), `status-not-permanent`, `unsupported`, `case-or-slash-only`, `kept` and `new-only`.
- Reports as text, Markdown, JSON and CSV, with the first `--limit` findings shown and every finding counted; `--fail-on` for a pipeline gate.
- Bounded input: files over 50 MB refused, at most 1,000,000 URLs or redirects per file, URLs over 8,192 characters not read, chains followed for at most 20 hops.
- Release packages come with a CycloneDX SBOM, SHA-256 checksums and a build provenance attestation.
