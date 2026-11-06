# Architecture

The extension host owns process execution, filesystem paths, settings, credentials and storage. The webview renders forms, charts, history and comparisons. No server or database is required.

- `src/extension.ts`: commands, Activity Bar navigation, webview lifecycle, trust and authorization, SecretStorage and file pickers.
- `src/model.ts`: versioned test/run models and webview message contracts.
- `src/definition.ts`, `workload.ts`, `integrations.ts`, `outputs.ts`: validation, executor-specific options, credential references, dataset parsing and output capability policy.
- `src/checks.ts`, `thresholds.ts`: safe check predicates, scoped groups/tags, metric types, legal aggregations, serialized expressions and combined threshold configuration.
- `src/summary.ts`, `observation.ts`, `outcome.ts`: authoritative summary adaptation, conservative early-abort classification and consistent completion/evaluation labels.
- `src/generator.ts`: serialized, standalone k6 JavaScript using documented built-in APIs.
- `src/runner.ts`: argument-array subprocess launch, discovery, cancellation, incremental file collection, authoritative summary adapter and cleanup.
- `src/logs.ts`: UTF-8 line buffering, bounded records and split-chunk credential protection; retained logs are capped at 64 KiB per run.
- `src/metrics.ts`: partial JSON-line parsing and bounded time-bucket aggregation. No sampled percentile is presented as exact.
- `src/history.ts`: versioned local result storage with serialized atomic writes, retention and damaged-file preservation.
- `src/comparison.ts`, `series.ts`: read-only eligibility, scoped metric selection, native protocol rows, delta math, exact bucket-rate calculations and common chart scales.
- `src/reports.ts`: normalized JSON/CSV and escaped standalone HTML.
- `webview/`: dependency-light TypeScript UI, local SVG charts, progressive disclosure and accessible form controls.

The webview has a restrictive Content Security Policy and locally bundled assets. It cannot request arbitrary shell commands. Host-side validation runs again before execution. A single active run is enforced in both UI orchestration and the runner.

Generated tests use an isolated k6 configuration, conservative defaults and a private temporary directory. The internal collector always remains enabled alongside explicitly selected additional outputs. Collected points are read in bounded chunks, compacted into at most 600 global time buckets and 120 buckets per observed scenario, and delivered approximately once per second. Internal raw streams stop at 256 MiB. Temporary scripts, raw points and summary files are removed after execution. User-selected raw output files remain at their selected paths and refuse to overwrite existing files.

History uses the workspace storage URI when available, otherwise global extension storage. It stores compact summaries and chart buckets, never raw point files. Started runs are persisted and marked interrupted if reopened without a final result. Unknown schemas and damaged data are preserved in recovery files. There is no migration from any prior product schema because this is the first schema.

Comparison fingerprints include the generated test configuration, or a custom script path and content digest. Credentials are represented by variable names rather than secret values. Different conditions permit factual deltas but suppress quality verdicts. A fingerprint match does not establish identical server hardware or statistical significance.

Custom scripts are launched unchanged from their own directory. Their setup, teardown, imports and options remain intact. They can use arbitrary capabilities supported by the selected binary, with corresponding trust and authorization responsibilities. Their authoritative summary is not intercepted or rewritten.

Threshold results use a nullable outcome: unknown evaluations are not failures or passes. Generated tests include every configured threshold from the JSON and visual forms, including rules on the same metric. Required percentile aggregations are requested from k6's summary; they are never reconstructed from chart buckets. Early threshold termination is marked only when an aborting rule failed and a known schedule was not fully observed. Iteration-limited workloads without a predictable finish receive a possible-abort label.

Scoped chart series retain actual bucket widths in seconds. Older records without that metadata still provide their saved summary rates and latency series; throughput curves are unavailable instead of being fabricated from gaps between points. Per-scenario averages/counters remain observed metrics, and unavailable global percentiles are never substituted. Paired charts share both elapsed-time and value scales. Native WebSocket/gRPC counters remain factual context rather than automatic quality scores.

Generated JSON is parsed as data, JSON paths require own properties, and special property names are preserved through headers, check names and tag serialization. WebSocket content assertions record a real failed k6 check if no message arrives before the session closes. They still affect the process outcome only through an explicit checks threshold.
