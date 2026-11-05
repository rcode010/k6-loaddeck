# Contributing

Install Node.js 24 or newer, then run `npm ci` and `npm run check`. Use F5 in VS Code to launch the extension. Install k6 in that extension host environment.

Keep changes focused and preserve existing repository history. Use clear Conventional Commit subjects. Before committing, run type checking, lint, relevant unit/integration tests and the bundle build. Run `npm run format` for consistent formatting. Source code and generated k6 scripts must contain no comments; explanations belong in documentation and descriptive names.

Real execution tests require `LOADDECK_TEST_K6=/absolute/path/to/k6`. Browser tests additionally require `LOADDECK_TEST_BROWSER=/absolute/path/to/chromium` and a prior `npm run build`. Fixtures target loopback only. Do not run load tests against third-party services to verify a change.

Add meaningful tests for input validation, process lifecycle, metrics, persistence, comparison or secret handling when those behaviors change. Keep fake data confined to explicit automated test fixtures. Never claim an integration passed if it was skipped.

A pull request should describe the problem, resulting behavior, verification commands and remaining limitations. Do not publish, release, push changes or alter repository settings without maintainer permission. The stable release gates in `docs/READINESS.md` must pass before version 1.0.
