# Readiness and verification

LoadDeck is a buildable **0.1 development preview**. The P0 execution/history/comparison path and substantial GUI implementations in all eight feature families exist. **The complete specification is not yet implemented or signed off. This is not a feature-complete stable 1.0 release.**

## Verified locally

Environment: Linux x64, Node.js 26.13.0, desktop VS Code 1.144.1, Grafana k6 v2.3.0, installed Chromium and OpenSSL. k6 was downloaded to `/tmp` for verification; no global binary was installed.

The final full suite passed **37 tests with zero failures and zero skips**, including a real thirty-second streaming run and a Chromium accessibility audit. Type checking, current ESLint and the bundle build passed in the same run. Desktop VS Code checks additionally exercised two real runs, extension-host reload, persistent History and compatible-run comparison, scenario selection and matching chart axes. The desktop harness uses keyboard controls to avoid Electron nested-frame pointer-coordinate instability.

Real loopback fixtures cover:

- GET and POST/JSON, authoritative averages/p95/p99, checks, passing and failing thresholds, exit code 99, cancellation and live updates.
- Thirty seconds of ongoing metric collection with bounded chart buckets.
- History retention, a newly constructed storage service reopening results, serialized writes, interrupted-run marking and preservation of damaged files.
- Comparison type/script eligibility, changed conditions, zero baselines, missing values and direction-aware interpretation.
- All six built-in executors, staggered scenarios, scoped check groups/tags, allowed-status lists, regular expressions, case-insensitive headers, UTF-16 length versus UTF-8 byte size, and scenario-filtered thresholds.
- Correct k6 metric types, decimal percentiles, preserved JSON-plus-builder rules, three-second abort evaluation delay, early-abort observation metadata and unevaluated thresholds when no summary exists.
- Scoped comparison without global-percentile substitution, identical chart axes, exact stored bucket widths, bounded per-scenario series, native protocol comparison rows and history reopening of these records.
- Silent WebSocket content assertions fail even for patterns that could match an empty string; an actual empty message remains distinguishable from silence. Zero-length HTTP response bounds accept an actual empty response.
- Special JSON, header, tag and check names remain data; inherited JSON properties cannot falsely satisfy a response check. A real Unicode console flood verifies the total 64 KiB retained-log budget.
- WebSocket echo and unary gRPC request/response assertions with protocol metrics.
- Basic, Digest, Bearer, API-key, cookie and OAuth client-credentials flows; secrets absent from generated source and stored run objects in the tested fixtures.
- JSON/CSV datasets, changing request values, SharedArray initialization, form encoding, multipart upload, protected URL query parameters and simultaneous native JSON/CSV outputs.
- HTTP/2 negotiation and client-certificate authentication against a temporary local CA, with certificate verification enabled.
- InfluxDB v1-compatible and Prometheus remote-write wire fixtures, simultaneous internal collection and a refused backend surfacing as execution failure. These are controlled wire fixtures, not a deployed InfluxDB/Prometheus installation.
- The real bundled webview: URL submission, executor and protocol controls, matching check choices, missing binary state, History selection, Compare navigation, dark/light narrow layouts, no narrow-page overflow and an axe WCAG A/AA audit.
- A real isolated VS Code Extension Development Host: activation, required command registration, opening the webview, History/Compare navigation and installation checking. It exited successfully. A separate keyboard-driven desktop test exercised URL submission, real results, rerun, host reload, History selection and comparison.

## Commands

```sh
npm run check
LOADDECK_TEST_LONG=1 LOADDECK_TEST_BROWSER=/usr/bin/chromium LOADDECK_TEST_K6=/tmp/k6-v2.3.0-linux-amd64/k6 npm run check
LOADDECK_TEST_VSCODE=/usr/share/code/code npm run test:host
LOADDECK_TEST_VSCODE=/usr/share/code/code LOADDECK_TEST_K6=/tmp/k6-v2.3.0-linux-amd64/k6 npm run test:vscode:ui
npm run format:check
npm run package
```

The test runner prints explicit skips when optional binary/browser/long-run variables are absent. CI is configured for Linux, macOS and Windows with k6 v2.3.0; no remote CI workflow has been executed or pushed during this implementation.

## Stable release gates still open

| Family         | Implemented and locally exercised                                                                                                                                    | Remaining before family sign-off                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenarios      | Named/enabled scenarios, independent HTTP/WebSocket/gRPC request/auth/data/check settings, nonsecret environment, staggered scheduling, tags and scoped results      | Broader mixed-protocol compatibility verification                                                                                           |
| Executors      | Six typed forms, validation, real execution, stage editing, arrival-rate sleep suppression, dropped-iteration display                                                | Cross-platform execution and broader saturation/cleanup verification                                                                        |
| Thresholds     | Metric-aware rules, observed metric catalog, decimal percentiles, preserved combined rules, tag scopes, delayed abort, observed values and unevaluated states        | Custom metric emission remains script-first; broader mixed-workload abort coverage and custom-metric authoring are not signed off           |
| Checks         | Status/lists, duration, body text/regex/nonempty/UTF-16 length/UTF-8 size, JSON/header assertions, WebSocket content/regex, scoped check tags/groups and gRPC fields | Full check-breakdown coverage for user-authored scripts and independent request workflows; broader protocol-specific receive expectations   |
| Protocols      | HTTP, negotiated HTTP/2, WebSocket exchange and unary gRPC with file/import controls                                                                                 | Broader binary/platform compatibility profiles and streaming operations (script-first)                                                      |
| Authentication | Basic, Digest, Bearer, header/query API keys, cookie, OAuth client credentials and HTTP mTLS                                                                         | Native k6 secret-source integration and credential deletion/profile management                                                              |
| Data           | JSON/CSV picker, row/column preview, runtime variables, templating, four row strategies, repeat/fail policy, verified form/multipart request support                 | Portable copied/relative dependencies and richer per-run nonsecret overrides                                                                |
| Outputs        | Concurrent internal/native JSON/CSV, normalized JSON/CSV, self-contained HTML, opt-in version-profile external adapters, refused-backend diagnostics                 | Real deployed backend verification, more binary capability profiles, external secret-source support and independent-output failure metadata |

Other open acceptance gates:

- Additional desktop VS Code automation for Stop, failure states, Restricted Mode and SecretStorage runtime injection. URL submission, results, rerun, reload persistence, History, scenario selection and common chart scales have passed in the real host.
- Manual screen-reader, keyboard, light/dark/high-contrast and remote-host verification. The browser harness audit does not prove accessibility in every VS Code theme.
- macOS/Windows execution, cancellation/process-tree cleanup and packaging verification. The CI definition is not evidence of those checks passing.
- Broader security fuzzing for payloads, unusual URL encodings, very large output and exceptional process cleanup. No-comments enforcement, split-credential log buffering, actual retained-byte limits and special JSON properties have automated coverage.
- Rich existing-script identity management, summary capability negotiation and safe rerun after script changes. Arbitrary custom scripts currently retain observed metrics without authoritative final percentiles; scripts are never rewritten.
- Rerun/edit from sensitive historical configurations currently requires re-entry rather than retaining raw headers, bodies or URL queries. This favors privacy but does not satisfy the full saved-template workflow yet.
- More history sorting options, broader metric help text and saved-test organization. Comparison now supports shared chart scales, scenario selection, native protocol rows and explicit missing scoped data. Older records without exact bucket widths retain summary rates but cannot show trustworthy throughput curves.
- Recovery of abandoned temporary run directories after a hard extension-host crash. Normal completion, cancellation and handled failures clean up transient artifacts.

## Packaging and maintainer decisions

Local `vsce package` succeeds without pushing or publishing. Publisher and license have not been selected in the repository. VSCE emits `Publisher="undefined"` when the publisher is absent; the resulting VSIX is a **development packaging check**, not a Marketplace-ready artifact. Use F5 for development. The maintainer must choose a real publisher ID and license before distribution; no identity or legal terms have been invented.

Source maps and all runtime assets are bundled locally. Test-host code, source, node_modules and development fixtures are excluded from the VSIX. No release, tag, remote change, push or publication has been made.

## Local commit milestones

- `916fd41` — validated k6 execution and metrics core; typecheck, lint, seven unit tests and bundle build passed.
- `fff886c` — dashboard, persistent history and comparison; real GET/POST, threshold/cancellation and storage reopening passed.
- `acc149a` — scenario/executor/assertion builders; all six real executor fixtures and staggered scenarios passed.
- `46e319e` — protocol, protected authentication, dataset and output workflows; real protocol/auth/data fixtures passed.
- `d423b38` — output hardening, Digest, protected URL values, form/multipart requests and concrete comparison conditions; real fixtures passed.
- `ce6592d` — bounded streamed-log redaction and protected runtime variables for existing scripts; unit/security checks passed.
- `610d5e0` — correct live protocol counter totals, observed zeros and safe workload draft restoration; real integration/browser checks passed.
- `bfb3c4f` — repeated cancellation and a new run after cancellation; real lifecycle fixture passed.
- `fe593bf` — maintained ESLint 10 toolchain; lint and type checking passed.
- `c9ae10e` — per-host authorization keys and bounded shutdown cleanup; full 24-test verification passed.

The following continuation milestones are also verified locally:

- `a92ea4a` — allowed-status lists, regex, UTF-8 response size, grouped/scoped checks and real observed breakdowns.
- `1cebbe6` — metric-aware thresholds, real metric catalogs, decimal percentiles, delayed abort outcomes and explicit unevaluated results.
- `7ce1b33` — bounded scenario series, accurate bucket widths, scenario comparison, native protocol rows and common chart axes.
- `257124b` — reject sub-second quick/constant workloads before k6 launch.
- `1d3dc79` — fail message assertions when no message arrives; preserve zero-length response semantics.
- `8ee0834` — preserve special JSON/check names and reject inherited response paths.
- `7f43680` — preserve special scenario/check tags and runtime credential-header names.
- `8ac6a39` — enforce the actual total UTF-8 log-byte limit.

Verification used `npm run check` with the k6, browser and long-run fixture variables enabled: **37 passed, zero failures, zero skips**. The desktop keyboard suite additionally passed real runs, reload persistence, scenario comparison and shared scales. The final documentation commit records the associated harness and screenshots. No remote CI, macOS or Windows execution is implied by these local results.

Independent-scenario continuation: real mixed HTTP POST/WebSocket execution passed with isolated authentication, dataset rows, scenario environment and scoped metrics. The Chromium builder test verifies independent request editing. Sensitive scenario configurations are omitted from History. Named WebSocket/gRPC scenarios now pass the same target validation as ordinary requests; unsupported WebSocket Digest auth is rejected.

Workload continuation: all five preset schedules passed real short-duration k6 fixtures. Executor forms retain independent numeric fields and ramp stages across switches, verified in Chromium. The planned timeline shows staggered schedules; load confirmation estimates concurrent VUs, normalized arrival rates and iteration budgets including graceful-stop overlap.

Dataset continuation: schema/type overrides, redacted schema previews and guided URL/body/message binding insertion are implemented. Real CSV fixtures verify number/boolean overrides and all four row strategies under repeat/fail policies. Exhaustion with fail aborts k6 instead of throwing an iteration error that could still exit zero.

Protocol continuation: schema-derived unary gRPC method discovery and preflight validation, HTTP redirect/timeout controls, gRPC connect/call timeouts and scheduled WebSocket messages with receive deadlines passed real fixtures. Client certificates passed real secure WebSocket and gRPC fixtures in addition to HTTP/2, using a temporary trusted CA with verification enabled.

NTLM continuation: the HTTP adapter passed a real k6 NTLMv2 handshake against a loopback fixture verifying the password proof. Enterprise domain-controller compatibility remains environment-dependent. Inapplicable Digest/NTLM protocol combinations are disabled/rejected.
