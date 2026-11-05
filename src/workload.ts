import type { QuickTest } from "./model";
import { durationSeconds } from "./duration";
export const executors = [
  "shared-iterations",
  "per-vu-iterations",
  "constant-vus",
  "ramping-vus",
  "constant-arrival-rate",
  "ramping-arrival-rate",
] as const;
export type Executor = (typeof executors)[number];
export interface Stage {
  duration: string;
  target: number;
}
export interface Scenario {
  name: string;
  enabled: boolean;
  executor: Executor;
  vus?: number;
  iterations?: number;
  duration?: string;
  maxDuration?: string;
  startVUs?: number;
  rate?: number;
  startRate?: number;
  timeUnit?: string;
  preAllocatedVUs?: number;
  maxVUs?: number;
  stages?: Stage[];
  startTime: string;
  gracefulStop: string;
  gracefulRampDown?: string;
  url: string;
  tags: Record<string, string>;
}
export interface CheckRule {
  name: string;
  kind:
    | "status"
    | "duration"
    | "bodyContains"
    | "bodyNonempty"
    | "jsonEquals"
    | "headerEquals"
    | "headerExists"
    | "bodyLength"
    | "messageContains"
    | "grpcStatus";
  value: string;
  path: string;
  enabled: boolean;
}
export interface ThresholdRule {
  metric: string;
  aggregation: string;
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=";
  value: number;
  scope: string;
  abortOnFail: boolean;
  delayAbortEval: string;
}
export function scenarioOptions(
  s: Scenario,
  index: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    executor: s.executor,
    exec: `scenario_${index}`,
    startTime: s.startTime,
    gracefulStop: s.gracefulStop,
    tags: s.tags,
  };
  const keys: Record<Executor, string[]> = {
    "shared-iterations": ["vus", "iterations", "maxDuration"],
    "per-vu-iterations": ["vus", "iterations", "maxDuration"],
    "constant-vus": ["vus", "duration"],
    "ramping-vus": ["startVUs", "stages", "gracefulRampDown"],
    "constant-arrival-rate": [
      "rate",
      "timeUnit",
      "duration",
      "preAllocatedVUs",
      "maxVUs",
    ],
    "ramping-arrival-rate": [
      "startRate",
      "timeUnit",
      "stages",
      "preAllocatedVUs",
      "maxVUs",
    ],
  };
  for (const key of keys[s.executor]) {
    const value = s[key as keyof Scenario];
    if (value !== undefined && value !== "") result[key] = value;
  }
  return result;
}
export function defaultScenario(c: QuickTest): Scenario {
  const base: Scenario = {
    name: "main",
    enabled: true,
    executor: "constant-vus",
    vus: c.vus,
    duration: c.duration,
    startTime: "0s",
    gracefulStop: "5s",
    url: c.url,
    tags: {},
  };
  if (c.testKind === "stress")
    return {
      ...base,
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: c.duration, target: c.vus },
        { duration: c.duration, target: c.vus * 2 },
        { duration: c.duration, target: 0 },
      ],
    };
  if (c.testKind === "spike")
    return {
      ...base,
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "1s", target: c.vus },
        { duration: c.duration, target: c.vus },
        { duration: "1s", target: 0 },
      ],
    };
  return base;
}
function duration(value: unknown, label: string, zero = false): void {
  const seconds = typeof value === "string" ? durationSeconds(value) : NaN;
  if (
    !Number.isFinite(seconds) ||
    seconds < (zero ? 0 : 0.001) ||
    seconds > 86400
  )
    throw new Error(`${label}: enter a valid duration up to 24 hours.`);
}
function integer(value: unknown, label: string, zero = false): void {
  if (
    !Number.isInteger(value) ||
    Number(value) < (zero ? 0 : 1) ||
    Number(value) > 1000000
  )
    throw new Error(
      `${label}: enter a valid ${zero ? "nonnegative" : "positive"} integer.`,
    );
}
export function validateScenarios(scenarios: Scenario[]): void {
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.length > 20)
    throw new Error("Configure 1–20 scenarios.");
  if (!scenarios.some((s) => s.enabled))
    throw new Error("Enable at least one scenario.");
  const names = new Set<string>();
  for (const s of scenarios) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(s.name) || names.has(s.name))
      throw new Error(
        "Scenario names must be unique identifiers starting with a letter.",
      );
    names.add(s.name);
    if (!executors.includes(s.executor))
      throw new Error("Select a supported executor.");
    duration(s.startTime, "Scenario start", true);
    duration(s.gracefulStop, "Graceful stop", true);
    if (
      !s.tags ||
      typeof s.tags !== "object" ||
      Object.values(s.tags).some((v) => typeof v !== "string")
    )
      throw new Error("Scenario tags must be strings.");
    if (/arrival-rate$/.test(s.executor)) {
      integer(s.preAllocatedVUs, "Preallocated VUs");
      if (s.maxVUs !== undefined) {
        integer(s.maxVUs, "Maximum VUs");
        if (s.maxVUs < s.preAllocatedVUs!)
          throw new Error("Maximum VUs must cover preallocated VUs.");
      }
      duration(s.timeUnit, "Rate time unit");
      if (s.executor === "constant-arrival-rate")
        integer(s.rate, "Iteration rate");
      else integer(s.startRate, "Starting iteration rate", true);
    } else if (s.executor === "ramping-vus")
      integer(s.startVUs, "Starting VUs", true);
    else integer(s.vus, "Virtual users");
    if (
      s.executor === "shared-iterations" ||
      s.executor === "per-vu-iterations"
    ) {
      integer(s.iterations, "Iterations");
      if (s.maxDuration) duration(s.maxDuration, "Maximum duration");
    }
    if (s.executor === "constant-vus" || s.executor === "constant-arrival-rate")
      duration(s.duration, "Scenario duration");
    if (s.executor.startsWith("ramping-")) {
      if (!Array.isArray(s.stages) || !s.stages.length || s.stages.length > 100)
        throw new Error("Add 1–100 ramp stages.");
      for (const stage of s.stages) {
        duration(stage.duration, "Stage duration");
        integer(stage.target, "Stage target", true);
      }
      if (s.gracefulRampDown)
        duration(s.gracefulRampDown, "Graceful ramp down", true);
    }
  }
}
export function compileThresholds(
  rules: ThresholdRule[],
): Record<
  string,
  { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
> {
  const result: Record<
    string,
    { threshold: string; abortOnFail: boolean; delayAbortEval?: string }[]
  > = {};
  if (!Array.isArray(rules) || rules.length > 100)
    throw new Error("Configure at most 100 thresholds.");
  for (const rule of rules) {
    if (
      !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rule.metric) ||
      !["<", "<=", ">", ">=", "==", "!="].includes(rule.operator) ||
      !Number.isFinite(rule.value) ||
      rule.value < 0
    )
      throw new Error("Invalid threshold metric, operator or value.");
    const type =
      rule.metric.includes("duration") || rule.metric === "latency"
        ? "trend"
        : ["http_req_failed", "checks"].includes(rule.metric)
          ? "rate"
          : ["vus", "vus_max"].includes(rule.metric)
            ? "gauge"
            : "counter";
    const valid: Record<string, string[]> = {
      trend: ["avg", "min", "max", "med", "p(90)", "p(95)", "p(99)"],
      rate: ["rate"],
      gauge: ["value", "min", "max"],
      counter: ["count", "rate"],
    };
    if (!valid[type]!.includes(rule.aggregation))
      throw new Error(
        `Invalid aggregation for ${rule.metric}. Custom metrics require their actual k6 metric type.`,
      );
    if (
      rule.scope &&
      !/^[A-Za-z0-9_ .:/=-]+:[A-Za-z0-9_ .:/=,-]+$/.test(rule.scope)
    )
      throw new Error("Threshold scope: use tag:value pairs.");
    if (rule.delayAbortEval)
      duration(rule.delayAbortEval, "Abort evaluation delay", true);
    const key = rule.metric + (rule.scope ? `{${rule.scope}}` : "");
    (result[key] ??= []).push({
      threshold: `${rule.aggregation}${rule.operator}${rule.value}`,
      abortOnFail: rule.abortOnFail,
      ...(rule.delayAbortEval ? { delayAbortEval: rule.delayAbortEval } : {}),
    });
  }
  return result;
}
export function validateChecks(rules: CheckRule[]): void {
  if (!Array.isArray(rules) || rules.length > 100)
    throw new Error("Configure at most 100 checks.");
  const names = new Set<string>();
  for (const rule of rules) {
    if (!rule.name || rule.name.length > 120 || names.has(rule.name))
      throw new Error("Check names must be unique and nonempty.");
    names.add(rule.name);
    if (
      ![
        "status",
        "duration",
        "bodyContains",
        "bodyNonempty",
        "jsonEquals",
        "headerEquals",
        "headerExists",
        "bodyLength",
        "messageContains",
        "grpcStatus",
      ].includes(rule.kind)
    )
      throw new Error("Unsupported check kind.");
    if (typeof rule.value !== "string" || typeof rule.path !== "string")
      throw new Error("Invalid check value.");
    if (
      ["duration", "status", "grpcStatus", "bodyLength"].includes(rule.kind) &&
      !/^\d+(\.\d+)?$/.test(rule.value)
    )
      throw new Error("This check requires a nonnegative numeric value.");
    if (rule.kind === "jsonEquals") {
      if (!/^[A-Za-z0-9_.]+$/.test(rule.path))
        throw new Error("JSON path: use dot-separated keys.");
      try {
        JSON.parse(rule.value);
      } catch {
        throw new Error("JSON expected value must be valid JSON.");
      }
    }
  }
}
export function checkExpression(rule: CheckRule, protocol: string): string {
  const val = JSON.stringify(rule.value),
    key = JSON.stringify(rule.path);
  switch (rule.kind) {
    case "status":
      return `r.status === ${Number(rule.value)}`;
    case "grpcStatus":
      return `Number(r.status) === ${Number(rule.value)}`;
    case "duration":
      return `r.timings.duration < ${Number(rule.value)}`;
    case "bodyContains":
    case "messageContains":
      return `String(${protocol === "ws" ? "r" : "r.body"} || '').includes(${val})`;
    case "bodyNonempty":
      return `Boolean(r.body && r.body.length)`;
    case "bodyLength":
      return `Boolean(r.body) && r.body.length >= ${Number(rule.value)}`;
    case "headerExists":
      return `r.headers[${key}] !== undefined`;
    case "headerEquals":
      return `String(r.headers[${key}]) === ${val}`;
    case "jsonEquals":
      return `JSON.stringify(jsonPath(${protocol === "grpc" ? "r.message" : "r.json()"}, ${key})) === ${JSON.stringify(JSON.stringify(JSON.parse(rule.value)))}`;
  }
}
