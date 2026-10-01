# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "redirect-map-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up sitemap or map (example.com addresses, no real stores, customers, keys or tokens) that shows the problem, what you expected and what happened.

## Scope

In scope:

- an input that makes the tool open a network connection, run a program, or read a file it was not given, including a child sitemap outside the `--sitemap-dir` folder
- a sitemap whose entities expand, or whose DOCTYPE or ENTITY declaration is accepted
- an input that makes the tool hang, take very long, or use unbounded memory or stack
- text from a sitemap or a map that breaks a Markdown table, injects a formula into a CSV report, or rewrites the terminal through control or direction characters
- a rule with a regular expression, capture or variable that is evaluated or guessed instead of reported as unsupported
- an old URL reported as covered when the rule for it in docs/method.md says it is unmapped, or a loop, chain or missing target that is not reported

Out of scope: what the live servers do with the redirects, and whether a new page is the right replacement for an old one (docs/limits.md lists what a map check cannot see).

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
