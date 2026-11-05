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
    if (
      s.executor === "constant-vus" ||
      s.executor === "constant-arrival-rate"
    ) {
      duration(s.duration, "Scenario duration");
      if (durationSeconds(s.duration!) < 1)
        throw new Error("Scenario duration must be at least 1 second.");
    }
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
export {
  validateChecks,
  checkExpression,
  parseStatuses,
  checkStatements,
  checkKinds,
} from "./checks";
export type { CheckRule } from "./checks";

export { compileThresholds } from "./thresholds";
export type { ThresholdRule } from "./thresholds";
