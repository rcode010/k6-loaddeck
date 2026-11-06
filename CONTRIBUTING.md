# Contributing

## Development setup

Install Node.js 24 or newer and Grafana k6 in the VS Code extension host environment.

```sh
npm ci
npm run check
```

Open the repository in desktop VS Code and press F5 with **Run LoadDeck**. Browser and desktop tests require a prior build. See [Compatibility and verification](docs/READINESS.md) for dependencies and commands.

## Changes and tests

Keep changes focused, use descriptive names and strong types, and place explanations in documentation. Source and generated scripts follow the repository's comment-free convention. Use Conventional Commit subjects and preserve existing authorship.

Add meaningful coverage for validation, process lifecycle, metrics, persistence, comparison, and credentials. Integration fixtures target loopback only. Keep test doubles in explicit fixtures and report skipped checks accurately.

Before submitting:

```sh
npm run check
npm run format:check
npm run package
```

A pull request should explain the concrete problem, resulting behavior, relevant verification, and limitations. Include actual screenshots for visible changes.

## Packaging and releases

`npm run package` creates a local VSIX without publishing. LoadDeck is MIT licensed and marked free in Marketplace metadata.

The publisher ID is `rcode010`, matching the repository maintainer. Register that ID or confirm its ownership through [Marketplace publisher management](https://marketplace.visualstudio.com/manage) before publishing. Follow the [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for account setup and supported authentication.

Stable 1.0 requires the checks in [Compatibility and verification](docs/READINESS.md). Publishing, tagging releases, pushing, and changing repository settings require maintainer authorization.
