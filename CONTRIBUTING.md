# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, with `!` for a breaking change.

## Changing a check

1. Describe the change in docs/method.md first: what the check reports, its severity, and why it matters for a site move, with the part of Google's site move guide or RFC 9110 it follows. Where the tool makes its own choice (the default trailing slash rule, the tracking parameters dropped, the home page limit), say so and say why.
2. Add a test with the old URLs, the new URLs and the redirects written inline, where the result can be worked out by hand.
3. Text from the input goes through `safeText` before it reaches a finding or a note.
4. A finding id, once released, keeps its meaning: pipelines and other tools read it from the JSON and CSV reports.

## Adding a map format

1. Read only the forms that can be evaluated exactly. Report everything else as `unsupported`, with the line and the reason; never turn a pattern into a guess.
2. Keep the line number of each redirect, so every finding points back to the row to fix.
3. Bound the work: no nested repetition in patterns, no recursion without a depth limit, and the same size limits as the other readers.

## Rules for the code

- No runtime dependencies. Node 22 or newer and nothing else.
- The tool reads the files it is given and writes only to the screen. It opens no network connection, fetches no sitemap and runs no other program.
- Source files stay ASCII; write any other character in a pattern as a `\u` escape.
- Never commit a real store's sitemap or redirect map, even as a fixture. Write made-up ones on example.com.

## Before you open the pull request

```
npm test
npm run check
npm run example
```
