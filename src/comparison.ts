import type { Metrics, Run } from "./model";
export interface ComparisonRow {
  key: string;
  label: string;
  unit: string;
  baseline?: number;
  candidate?: number;
  delta?: number;
  percent?: number;
  interpretation: string;
}
export function compareRuns(
  baseline: Run,
  candidate: Run,
  scenario?: string,
): { comparable: boolean; notes: string[]; rows: ComparisonRow[] } {
  if (baseline.id === candidate.id)
    throw new Error("Choose two different runs.");
  if (baseline.testKind !== candidate.testKind)
    throw new Error("Choose two runs of the same test type.");
  if (
    baseline.testKind === "custom" &&
    (!baseline.scriptIdentity ||
      baseline.scriptIdentity !== candidate.scriptIdentity)
  )
    throw new Error("Custom tests must use the same script identity.");
  const comparable = baseline.fingerprint === candidate.fingerprint;
  const notes: string[] = [];
  if (!comparable)
    notes.push(
      "Unequal test conditions: target, request, workload, assertions or script content differ. Figures are factual; no performance verdict is issued.",
    );
  if (!comparable && baseline.conditions && candidate.conditions) {
    for (const key of new Set([
      ...Object.keys(baseline.conditions),
      ...Object.keys(candidate.conditions),
    ]))
      if (baseline.conditions[key] !== candidate.conditions[key])
        notes.push(
          `${key}: baseline ${baseline.conditions[key] ?? "unavailable"}; candidate ${candidate.conditions[key] ?? "unavailable"}.`,
        );
    if (notes.length === 1)
      notes.push(
        "Request headers, payload, target parameters, checks or data references differ; sensitive values are omitted.",
      );
  }
  if (
    [baseline, candidate].some(
      (r) =>
        (r.state !== "completed" && r.state !== "threshold_failed") ||
        (r.observation !== undefined && r.observation !== "complete"),
    )
  )
    notes.push(
      "At least one run is incomplete, failed or stopped early. Compare only the available observations.",
    );
  const aRun = scopedRun(baseline, scenario),
    bRun = scopedRun(candidate, scenario);
  const definitions: [
    string,
    string,
    string,
    "lower" | "higher" | "neutral",
  ][] = [
    ["avg", "Average latency", "ms", "lower"],
    ["p95", "p95 latency", "ms", "lower"],
    ["p99", "p99 latency", "ms", "lower"],
    ["rps", "Throughput", "req/s", "higher"],
    ["failureRate", "HTTP failure rate", "%", "lower"],
    ["requests", "HTTP requests", "count", "neutral"],
  ];
  const protocolKeys = Object.keys(aRun.protocolMetrics ?? {}).filter(
    (key) =>
      key.includes(".") &&
      !key.startsWith("negotiated.") &&
      Number.isFinite(aRun.protocolMetrics?.[key]) &&
      Number.isFinite(bRun.protocolMetrics?.[key]),
  );

  if (
    protocolKeys.length &&
    !definitions.some(
      ([key]) =>
        aRun.metrics[key as keyof Metrics] !== undefined &&
        bRun.metrics[key as keyof Metrics] !== undefined,
    )
  )
    definitions.length = 0;
  const labels: Record<string, string> = {
    grpc_req_duration: "gRPC call latency",
    ws_connecting: "WebSocket connection latency",
    ws_session_duration: "WebSocket session duration",
    ws_sessions: "WebSocket sessions",
    ws_msgs_sent: "WebSocket messages sent",
    ws_msgs_received: "WebSocket messages received",
    ws_ping: "WebSocket ping latency",
  };
  for (const key of protocolKeys) {
    const dot = key.indexOf(".");
    const metric = key.slice(0, dot),
      aggregation = key.slice(dot + 1);
    const definition = baseline.metricCatalog?.find((m) => m.name === metric);
    const unit =
      aggregation === "rate" && definition?.type !== "rate"
        ? "per second"
        : (definition?.unit ??
          (/duration|connecting|ping/.test(metric!)
            ? "ms"
            : aggregation === "count"
              ? "count"
              : "value"));
    definitions.push([
      key,
      `${labels[metric!] ?? metric} (${aggregation})`,
      unit,
      ["grpc_req_duration", "ws_connecting", "ws_ping"].includes(metric!)
        ? "lower"
        : "neutral",
    ]);
  }
  const aValues: Record<string, number | undefined> = {
      ...aRun.metrics,
      ...aRun.protocolMetrics,
    },
    bValues: Record<string, number | undefined> = {
      ...bRun.metrics,
      ...bRun.protocolMetrics,
    };
  const rows = definitions.map(([key, label, unit, direction]) => {
    const a = aValues[key],
      b = bValues[key];
    const valid =
      a !== undefined &&
      b !== undefined &&
      Number.isFinite(a) &&
      Number.isFinite(b);
    const delta = valid ? b - a : undefined;
    const percent = valid && a !== 0 ? ((b - a) / a) * 100 : undefined;
    const canInterpret =
      comparable &&
      notes.length === 0 &&
      direction !== "neutral" &&
      delta !== undefined;
    const interpretation = canInterpret
      ? delta === 0
        ? "Unchanged"
        : (direction === "lower" ? delta < 0 : delta > 0)
          ? "Improved"
          : "Regressed"
      : "Context only";
    return {
      key,
      label,
      unit,
      baseline: a,
      candidate: b,
      delta,
      percent,
      interpretation,
    };
  });
  if (!rows.some((r) => r.delta !== undefined))
    throw new Error("These runs have no common usable metrics.");
  return { comparable, notes, rows };
}

export function commonScenarios(baseline: Run, candidate: Run): string[] {
  return Object.keys(baseline.scenarioMetrics ?? {})
    .filter((name) => candidate.scenarioMetrics?.[name] !== undefined)
    .sort();
}
export function scopedRun(run: Run, scenario?: string): Run {
  if (!scenario) return run;
  const metrics = run.scenarioMetrics?.[scenario];
  if (!metrics)
    throw new Error(
      `Scenario ${scenario} has no recorded measurements in one of the selected runs.`,
    );
  return {
    ...run,
    metrics,
    series: run.scenarioSeries?.[scenario] ?? [],
    protocolMetrics: run.scenarioProtocolMetrics?.[scenario] ?? {},
  };
}
