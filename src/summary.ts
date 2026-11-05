import type { CheckResult, Metrics, ThresholdResult } from "./model";
import {
  metricDefinition,
  parseThreshold,
  type MetricDefinition,
  type MetricType,
} from "./thresholds";
interface MetricSummary {
  type?: MetricType;
  contains?: string;
  values?: Record<string, number>;
  thresholds?: Record<string, { ok?: boolean | null }>;
}
export interface SummaryResult {
  metrics: Metrics;
  thresholds: ThresholdResult[];
  checkResults: CheckResult[];
  protocolMetrics: Record<string, number>;
  metricCatalog: MetricDefinition[];
  engineElapsedMs?: number;
}
export function readSummary(value: unknown): SummaryResult {
  if (!value || typeof value !== "object")
    throw new Error("Invalid k6 summary.");
  const summary = value as {
    metrics?: Record<string, MetricSummary>;
    root_group?: unknown;
    state?: { testRunDurationMs?: number };
  };
  if (!summary.metrics || typeof summary.metrics !== "object")
    throw new Error("Missing k6 summary metrics.");
  const number = (metric: string, key: string) => {
    const n = summary.metrics?.[metric]?.values?.[key];
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
  };
  const catalog: MetricDefinition[] = [];
  for (const [name, record] of Object.entries(summary.metrics).slice(0, 1000)) {
    if (!/^[_A-Za-z][_A-Za-z0-9]{0,199}$/.test(name)) continue;
    try {
      catalog.push({
        ...metricDefinition(name, record.type, record.contains),
        source: "k6-json",
      });
    } catch {
      continue;
    }
  }
  const thresholds = Object.entries(summary.metrics).flatMap(
    ([metric, record]) =>
      Object.entries(record.thresholds ?? {}).map(
        ([expression, result]): ThresholdResult => {
          let aggregation: string | undefined;
          try {
            aggregation = parseThreshold(expression).aggregation;
          } catch {
            aggregation = undefined;
          }
          const observedValue = aggregation
            ? number(metric, aggregation)
            : undefined;
          const definition = catalog.find(
            (entry) => entry.name === metric.split("{")[0],
          );
          return {
            metric,
            expression,
            ok: typeof result?.ok === "boolean" ? result.ok : null,
            observedValue,
            unit:
              aggregation === "rate" && definition?.type === "counter"
                ? "per second"
                : definition?.unit,
          };
        },
      ),
  );
  const checks: CheckResult[] = [];
  const collect = (group: unknown, depth = 0) => {
    if (
      !group ||
      typeof group !== "object" ||
      depth > 20 ||
      checks.length >= 2000
    )
      return;
    const g = group as { path?: string; checks?: unknown; groups?: unknown };
    const entries = Array.isArray(g.checks)
      ? g.checks
      : g.checks && typeof g.checks === "object"
        ? Object.values(g.checks)
        : [];
    for (const entry of entries.slice(0, 2000 - checks.length)) {
      if (!entry || typeof entry !== "object") continue;
      const c = entry as { name?: string; passes?: number; fails?: number };
      if (
        typeof c.name === "string" &&
        Number.isInteger(c.passes) &&
        Number.isInteger(c.fails) &&
        c.passes! >= 0 &&
        c.fails! >= 0
      )
        checks.push({
          name: c.name,
          passes: c.passes!,
          fails: c.fails!,
          group: g.path,
          source: "k6-summary",
        });
    }
    const children = Array.isArray(g.groups)
      ? g.groups
      : g.groups && typeof g.groups === "object"
        ? Object.values(g.groups)
        : [];
    for (const child of children.slice(0, 2000)) collect(child, depth + 1);
  };
  collect(summary.root_group);
  const elapsed = summary.state?.testRunDurationMs;
  return {
    metrics: {
      requests: number("http_reqs", "count"),
      rps: number("http_reqs", "rate"),
      avg: number("http_req_duration", "avg"),
      p95: number("http_req_duration", "p(95)"),
      p99: number("http_req_duration", "p(99)"),
      failureRate: number("http_req_failed", "rate"),
      checksPassed: number("checks", "passes"),
      checksFailed: number("checks", "fails"),
      vus: number("vus", "value"),
      droppedIterations: number("dropped_iterations", "count"),
    },
    thresholds,
    checkResults: checks,
    metricCatalog: catalog,
    protocolMetrics: Object.fromEntries(
      Object.entries(summary.metrics)
        .filter(([name]) => /^(ws_|grpc_)/.test(name))
        .flatMap(([name, record]) =>
          Object.entries(record.values ?? {})
            .filter(([, n]) => typeof n === "number" && Number.isFinite(n))
            .map(([key, n]) => [`${name}.${key}`, n]),
        ),
    ),
    engineElapsedMs:
      typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : undefined,
  };
}
