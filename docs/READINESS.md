# Compatibility and verification

LoadDeck 0.2 is a development preview. Core and advanced workflows have local integration coverage. Stable 1.0 remains gated on cross-platform and manual accessibility verification.

The complete local suite passes **56 tests with zero failures and zero skips**, including real backend, browser, and 30-second streaming fixtures. Type checking, linting, formatting, bundling, VSIX packaging, desktop activation, the extended desktop workflow suite, and Restricted Mode checks pass.

## Verified environment

Linux x64, Node.js 26.13.0, VS Code 1.144.1, Grafana k6 2.3.0, Chromium, and OpenSSL. InfluxDB 1.13.2 and Prometheus 3.16.0 run as temporary loopback-only processes. Test binaries and data are isolated; no global service installation is required.

| Area                 | Automated evidence                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution            | Real GET/POST/JSON, five presets, all six executors, cancellation, repeated Stop, subsequent runs, and sustained streaming                                       |
| Scenarios            | Staggered independent HTTP/WebSocket requests, authentication, data, environment, tags, checks, and scoped results                                               |
| Assertions           | Scoped checks, status lists, regex, UTF-8/UTF-16 semantics, own-property JSON paths, special keys, decimal percentiles, delayed aborts, and unknown evaluations  |
| Protocols            | HTTP/2, WebSocket receive deadlines, gRPC schema discovery/unary calls, and secure HTTP/WebSocket/gRPC client certificates                                       |
| Authentication       | Basic, Digest, NTLMv2 password proofs, Bearer, API keys, cookies, OAuth client credentials, and k6 secret-source console redaction                               |
| Data and saved tests | Type overrides, exhaustion matrix, portable dependencies, protected template reopening/deletion, and script change detection                                     |
| History/comparison   | Atomic storage, corruption recovery, retention, interrupted records, scenario selection, shared scales, missing/zero values, and protocol exports                |
| Outputs              | Concurrent internal/native collection, queryable InfluxDB/Prometheus persistence, refused-backend failures, and delivery status                                  |
| Browser UI           | Request/scenario editing, guided bindings, executor state, History/Compare/Saved tests, themes, narrow layouts, keyboard focus, forced colors, and axe WCAG A/AA |
| Desktop VS Code      | Activation, real runs, reload, History/Compare, Stop, failures, protected credentials/templates, and Restricted Mode denial before requests                      |
| Resources            | Bounded logs/buckets/stream reads, normal cleanup, and conservative abandoned-run recovery                                                                       |

Fixtures target loopback only. Storage-provider and browser-message test doubles are confined to explicit fixtures; performance measurements come from k6.

## Run the checks

```sh
npm run check
npm run format:check
npm run package
```

For real execution, browser, and sustained-stream coverage, set `LOADDECK_TEST_K6` to the k6 executable, `LOADDECK_TEST_BROWSER` to Chromium, and `LOADDECK_TEST_LONG=1` before `npm run check`.

Add `LOADDECK_TEST_INFLUXDB` and `LOADDECK_TEST_PROMETHEUS` with backend executable paths for the persistence test. Their temporary data is removed afterward.

Desktop checks use an isolated VS Code profile:

```sh
LOADDECK_TEST_VSCODE=/absolute/path/to/code npm run test:host
LOADDECK_TEST_VSCODE=/absolute/path/to/code LOADDECK_TEST_K6=/absolute/path/to/k6 npm run test:vscode:ui
LOADDECK_TEST_VSCODE=/absolute/path/to/code LOADDECK_TEST_K6=/absolute/path/to/k6 npm run test:vscode:trust
```

Missing optional dependencies produce explicit skips. OpenSSL fixtures skip on Windows. The macOS TLS fixture requires `LOADDECK_TEST_SYSTEM_CA=1` on a disposable GitHub-hosted runner. It removes its generated keychain certificate and private files afterward; the VM is destroyed after the job, clearing its trust-settings record. It never changes trust settings on an ordinary developer Mac. Rebuild before browser/desktop checks; they exercise bundled assets.

## Compatibility boundaries

- Generated tests isolate ambient k6 options. Existing scripts preserve source, settings, imports, setup, teardown, and environment behavior.
- Scenario selection, external adapters, and automatic secret-source delivery use the verified k6 2.3.x profile. Other binaries retain script execution and environment fallback.
- Custom scripts may lack authoritative final percentiles. Missing scoped data stays unavailable; global percentiles are not substituted.
- Raw JSON/CSV can contain sensitive tags. External persistence stays unverified unless output reports failure; the extension does not query backends to certify delivery.
- Saved configurations and original-script locations use VS Code SecretStorage. History and exports omit those raw configurations.
- Normal cleanup is immediate. Recovery removes marked directories older than 24 hours only when both recorded host and engine PIDs are gone. Unmarked, recent, active, or incomplete-ownership directories are preserved.

## Before stable 1.0

- Execute the CI matrix and desktop/process-cleanup checks on macOS and Windows. A workflow definition is not a passing run.
- Complete manual screen-reader, keyboard, theme, and remote-host verification. Automated audits do not replace assistive-technology testing.
- Confirm ownership of the configured `algorithmalbert` publisher ID and complete Marketplace registration before publication.

Local packaging and verification do not publish the extension or create a release.
