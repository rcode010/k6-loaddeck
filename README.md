# LoadDeck

Performance testing for VS Code, powered by Grafana k6. Configure a request, run a test, and compare the results with earlier runs—all from the editor.

LoadDeck is free, [MIT licensed](LICENSE), and independent of Grafana Labs. Version 0.2 is a development preview; see [compatibility and verification](docs/READINESS.md) for tested environments and release limitations.

![LoadDeck dashboard](docs/screenshots/home-dark.png)

## Get started

1. Install [Grafana k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) in the environment running your VS Code extension host.
2. Install the LoadDeck VSIX using **Extensions: Install from VSIX…**.
3. Open LoadDeck from the Activity Bar or run **LoadDeck: Open Performance Dashboard**.
4. Enter a URL you are authorized to test and select **Run Test**.

Smoke defaults to one virtual user for ten seconds. Load defaults to ten users for thirty seconds. A workspace folder or saved script is optional. External targets, credentials, external outputs, and larger workloads require acknowledgment.

For Remote SSH, WSL, and containers, k6 must be installed in that extension host. Set `loaddeck.binaryPath` if the executable is outside its PATH, then use **LoadDeck: Check Installation**.

To build a local VSIX:

```sh
npm ci
npm run package
code --install-extension k6-loaddeck-0.2.0.vsix
```

Building requires Node.js 24 or newer. For extension development, open this repository in VS Code and press F5 with **Run LoadDeck**.

## Test, inspect, compare

- **New test:** configure requests or choose Smoke, Load, Stress, Spike, or Soak. Advanced settings stay out of the basic URL-first flow.
- **Dashboard:** follow real throughput, latency, failures, virtual users, checks, and execution logs. Stop a running test or inspect its final outcome.
- **History:** reopen persistent local results, filter by date/type/outcome, rerun reproducible tests, and export JSON, CSV, or self-contained HTML reports.
- **Compare:** inspect two same-type runs on shared chart scales. Different workloads or incomplete observations suppress performance verdicts.
- **Saved tests:** reuse protected configurations and credential references. Names remain visible; configurations use VS Code SecretStorage.
- **Scripts:** export standalone JavaScript with relative dependencies, or run existing scripts unchanged. The verified k6 2.3 profile supports named-scenario selection. Rerunning changed source requires confirmation.

![Real k6 results in VS Code](docs/screenshots/vscode-results.png)

## Advanced testing

| Area           | Capabilities                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Scenarios      | Independent requests, protocols, authentication, datasets, checks, environment, tags, and staggered schedules             |
| Executors      | All six built-in executors, independent editor settings, planned timelines, and load estimates                            |
| Thresholds     | Metric-aware aggregations, decimal percentiles, multiple rules, tag filters, delayed aborts, and unevaluated results      |
| Checks         | HTTP status/header/body/JSON assertions, regex and text size, WebSocket content/receive expectations, and gRPC assertions |
| Protocols      | HTTP/1.1, negotiated HTTP/2, scheduled WebSocket messages, and unary gRPC with schema-derived methods                     |
| Authentication | Basic, Digest, NTLMv2, Bearer, API keys, cookies, OAuth client credentials, and supported client certificates             |
| Data           | JSON/CSV datasets, inferred schema, type overrides, guided bindings, row strategies, and repeat/fail policies             |
| Outputs        | Concurrent internal/native JSON/CSV collection, normalized reports, and opt-in InfluxDB/Prometheus adapters               |

HTTP/2 is negotiated with the server. Arrival rate schedules iteration starts; it does not guarantee requests/second. Custom protocols, streaming gRPC, browser journeys, and specialized authentication remain available through compatible scripts.

## Credentials and data

Use runtime references such as `${API_TOKEN}` in protected fields. Store values through **LoadDeck: Store Runtime Credential**, or supply them in the extension host environment. **Manage Runtime Credentials** updates or deletes stored values.

Generated runs on the verified k6 2.3 profile prefer a private temporary k6 secret source for eligible single-line credentials. Certificates, multiline values, exported scripts, and other profiles use environment fallback. Redaction is best effort; review raw outputs and logs before sharing them.

Dataset bindings use `{{column}}`. A quoted `"{{column}}"` in a JSON payload preserves its dataset type. File-backed rows use `SharedArray`. Type overrides and exhaustion policies are validated; row uniqueness is scoped to a scenario.

History excludes raw bodies, credential values, dataset rows, and URL queries. Explicitly saved test configurations use protected storage; History retains a template reference. Native output files can contain sensitive tags and remain at your selected path.

## Trustworthy results

Generated tests obtain final percentiles from k6's authoritative summary. Existing scripts retain observed metrics when no compatible summary is available. Missing measurements display **N/A**; coarse buckets never become invented final percentiles.

Checks and thresholds are separate. Failing checks change the outcome only when enforced by a threshold on `checks`. Completed, threshold-failed, execution-failed, cancelled, and early-aborted runs remain distinguishable.

No account, backend, or telemetry is required. External outputs are opt-in and verified with k6 2.3.x, InfluxDB v1, and Prometheus remote write. History and comparison work without those services.

## Development

```sh
npm ci
npm run check
npm run format:check
npm run package
```
