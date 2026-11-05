import type { Metrics, Run } from "./model";
export interface ComparisonRow {
  key: keyof Metrics;
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
      (r) => r.state !== "completed" && r.state !== "threshold_failed",
    )
  )
    notes.push(
      "At least one run is incomplete or failed. Compare only the available observations.",
    );
  const definitions: [
    keyof Metrics,
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
  const rows = definitions.map(([key, label, unit, direction]) => {
    const a = baseline.metrics[key],
      b = candidate.metrics[key];
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
