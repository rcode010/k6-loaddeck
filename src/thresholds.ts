import { durationSeconds } from "./duration";
import type { QuickTest, ThresholdResult } from "./model";
export type MetricType = "counter" | "gauge" | "rate" | "trend";
export interface MetricDefinition {
  name: string;
  type: MetricType;
  unit: string;
  source: "builtin" | "k6-json" | "declared";
}
export interface ThresholdRule {
  metric: string;
  metricType?: MetricType;
  aggregation: string;
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
  value: number;
  scope: string;
  abortOnFail: boolean;
  delayAbortEval: string;
}
export interface ThresholdDefinition {
  metric: string;
  expression: string;
  metricType: MetricType;
  unit: string;
  abortOnFail: boolean;
  delayAbortEval?: string;
}
const metricTypes: Record<string, MetricType> = Object.fromEntries([
  ...[
    "http_req_duration",
    "http_req_blocked",
    "http_req_connecting",
    "http_req_tls_handshaking",
    "http_req_sending",
    "http_req_waiting",
    "http_req_receiving",
    "iteration_duration",
    "group_duration",
    "ws_connecting",
    "ws_session_duration",
    "grpc_req_duration",
  ].map((name) => [name, "trend" as const]),
  ...[
    "http_reqs",
    "iterations",
    "dropped_iterations",
    "data_sent",
    "data_received",
    "ws_sessions",
    "ws_msgs_sent",
    "ws_msgs_received",
  ].map((name) => [name, "counter" as const]),
  ...["http_req_failed", "checks"].map((name) => [name, "rate" as const]),
  ...["vus", "vus_max"].map((name) => [name, "gauge" as const]),
]);
export function metricDefinition(
  name: string,
  type?: MetricType,
  contains?: string,
): MetricDefinition {
  const builtin = Object.hasOwn(metricTypes, name)
    ? metricTypes[name]
    : undefined;
  const resolved = builtin ?? type;
  if (!resolved || !["counter", "gauge", "rate", "trend"].includes(resolved))
    throw new Error(`Choose the actual k6 metric type for ${name}.`);
  if (builtin && type && builtin !== type)
    throw new Error(`${name} is a ${builtin} metric.`);
  return {
    name,
    type: resolved,
    unit:
      resolved === "rate"
        ? "ratio"
        : contains === "time" || builtin === "trend"
          ? "ms"
          : ["data_sent", "data_received"].includes(name)
            ? "bytes"
            : resolved === "counter"
              ? "count"
              : "value",
    source: builtin ? "builtin" : "declared",
  };
}
export const builtinMetrics = Object.entries(metricTypes).map(([name, type]) =>
  metricDefinition(name, type),
);
export function thresholdAggregations(type: MetricType): string[] {
  return {
    counter: ["count", "rate"],
    gauge: ["value"],
    rate: ["rate"],
    trend: ["avg", "min", "max", "med", "p(90)", "p(95)", "p(99)"],
  }[type];
}
export function validAggregation(
  type: MetricType,
  aggregation: string,
): boolean {
  if (thresholdAggregations(type).includes(aggregation)) return true;
  const percentile = /^p\((\d+(?:\.\d+)?)\)$/.exec(aggregation);
  return (
    type === "trend" &&
    !!percentile &&
    Number(percentile[1]) >= 0 &&
    Number(percentile[1]) <= 100
  );
}
export function parseThreshold(expression: string): {
  aggregation: string;
  operator: ThresholdRule["operator"];
  value: number;
} {
  const match =
    typeof expression === "string" &&
    /^\s*(avg|min|max|med|p\(\d+(?:\.\d+)?\)|rate|count|value)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i.exec(
      expression,
    );
  if (!match || !Number.isFinite(Number(match[3])))
    throw new Error("Enter a valid k6 threshold expression.");
  return {
    aggregation: match[1]!,
    operator: match[2]! as ThresholdRule["operator"],
    value: Number(match[3]),
  };
}
function scopeText(scope: string): string {
  if (!scope) return "";
  if (typeof scope !== "string" || scope.length > 1000)
    throw new Error("Invalid threshold tag filter.");
  return scope
    .split(",")
    .map((pair) => {
      const index = pair.indexOf(":");
      const key = pair.slice(0, index).trim(),
        value = pair.slice(index + 1).trim();
      if (
        index < 1 ||
        !/^[_A-Za-z][_A-Za-z0-9]*$/.test(key) ||
        !value ||
        /[{},\r\n]/.test(value)
      )
        throw new Error("Threshold scope: use tag:value pairs.");
      return `${key}:${value}`;
    })
    .join(",");
}
function definition(rule: ThresholdRule): ThresholdDefinition {
  if (
    !/^[_A-Za-z][_A-Za-z0-9]*$/.test(rule.metric) ||
    rule.metric === "__proto__"
  )
    throw new Error("Invalid threshold metric name.");
  const metric = metricDefinition(rule.metric, rule.metricType);
  if (
    !["<", "<=", ">", ">=", "==", "!="].includes(rule.operator) ||
    !Number.isFinite(rule.value) ||
    !validAggregation(metric.type, rule.aggregation)
  )
    throw new Error(
      `Invalid threshold aggregation, operator or value for ${rule.metric}.`,
    );
  if (metric.type === "rate" && (rule.value < 0 || rule.value > 1))
    throw new Error("Rate thresholds use a ratio between 0 and 1.");
  if (
    typeof rule.abortOnFail !== "boolean" ||
    typeof rule.delayAbortEval !== "string"
  )
    throw new Error("Invalid threshold abort controls.");
  if (rule.delayAbortEval) {
    if (!rule.abortOnFail)
      throw new Error("Delay abort evaluation requires Abort on failure.");
    const delay = durationSeconds(rule.delayAbortEval);
    if (!Number.isFinite(delay) || delay < 0 || delay > 86400)
      throw new Error(
        "Abort evaluation delay must be a duration up to 24 hours.",
      );
  }
  const scope = scopeText(rule.scope);
  return {
    metric: rule.metric + (scope ? `{${scope}}` : ""),
    expression: `${rule.aggregation}${rule.operator}${rule.value}`,
    metricType: metric.type,
    unit:
      rule.aggregation === "rate" && metric.type === "counter"
        ? "per second"
        : metric.unit,
    abortOnFail: rule.abortOnFail,
    ...(rule.delayAbortEval ? { delayAbortEval: rule.delayAbortEval } : {}),
  };
}
export function compileThresholds(
  rules: ThresholdRule[],
): Record<
  string,
  { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
> {
  if (!Array.isArray(rules) || rules.length > 100)
    throw new Error("Configure at most 100 threshold rules.");
  const result: Record<
    string,
    { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
  > = Object.create(null);
  for (const rule of rules) {
    const d = definition(rule);
    (result[d.metric] ??= []).push({
      threshold: d.expression,
      abortOnFail: d.abortOnFail,
      ...(d.delayAbortEval ? { delayAbortEval: d.delayAbortEval } : {}),
    });
  }
  return result;
}
export function configuredThresholds(
  config: Pick<QuickTest, "thresholds" | "thresholdRules">,
): ThresholdDefinition[] {
  const result: ThresholdDefinition[] = [];
  for (const [metric, expressions] of Object.entries(config.thresholds)) {
    if (
      !Array.isArray(expressions) ||
      !expressions.length ||
      expressions.length > 20
    )
      throw new Error("Thresholds require 1–20 expressions per metric.");
    const match = /^([_A-Za-z][_A-Za-z0-9]*)(?:\{([^{}]+)\})?$/.exec(metric);
    if (!match) throw new Error("Invalid threshold metric or filter.");
    for (const expression of expressions)
      result.push(
        definition({
          metric: match[1]!,
          scope: match[2] ?? "",
          ...parseThreshold(expression),
          abortOnFail: false,
          delayAbortEval: "",
        }),
      );
  }
  compileThresholds(config.thresholdRules ?? []);
  for (const rule of config.thresholdRules ?? []) result.push(definition(rule));
  return result;
}
export function thresholdOptions(
  config: Pick<QuickTest, "thresholds" | "thresholdRules">,
): Record<
  string,
  { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
> {
  const result: Record<
    string,
    { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
  > = Object.create(null);
  for (const d of configuredThresholds(config))
    (result[d.metric] ??= []).push({
      threshold: d.expression,
      abortOnFail: d.abortOnFail,
      ...(d.delayAbortEval ? { delayAbortEval: d.delayAbortEval } : {}),
    });
  return result;
}
export function reconcileThresholds(
  config: Pick<QuickTest, "thresholds" | "thresholdRules">,
  evaluated: ThresholdResult[],
): ThresholdResult[] {
  const results = [...evaluated];
  for (const d of configuredThresholds(config)) {
    const existing = results.find(
      (result) =>
        result.metric === d.metric && result.expression === d.expression,
    );
    if (existing)
      Object.assign(existing, {
        abortOnFail: d.abortOnFail,
        delayAbortEval: d.delayAbortEval,
        unit: existing.unit ?? d.unit,
      });
    else
      results.push({
        metric: d.metric,
        expression: d.expression,
        ok: null,
        abortOnFail: d.abortOnFail,
        delayAbortEval: d.delayAbortEval,
        unit: d.unit,
      });
  }
  return results;
}
