import type { QuickTest } from "./model";
import { defaultScenario, type Scenario } from "./workload";
import { durationSeconds } from "./duration";

export function scenarioLoad(s: Scenario) {
  const start = durationSeconds(s.startTime);
  const finite = s.executor.includes("iterations");
  const ramp = s.executor.startsWith("ramping-");
  const arrival = s.executor.includes("arrival-rate");
  const duration = finite
    ? durationSeconds(s.maxDuration || "10m")
    : ramp
      ? (s.stages ?? []).reduce(
          (total, stage) => total + durationSeconds(stage.duration),
          0,
        )
      : durationSeconds(s.duration ?? "");
  const maxTarget = Math.max(
    0,
    ...(s.stages ?? []).map((stage) => stage.target),
  );
  const vus = arrival
    ? (s.maxVUs ?? s.preAllocatedVUs ?? 0)
    : s.executor === "ramping-vus"
      ? Math.max(s.startVUs ?? 0, maxTarget)
      : (s.vus ?? 0);
  const rate = arrival
    ? Math.max(s.rate ?? s.startRate ?? 0, ramp ? maxTarget : 0) /
      durationSeconds(s.timeUnit ?? "1s")
    : undefined;
  const iterations = finite
    ? (s.iterations ?? 0) *
      (s.executor === "per-vu-iterations" ? (s.vus ?? 1) : 1)
    : rate !== undefined
      ? Math.ceil(rate * duration)
      : undefined;
  return {
    start,
    duration,
    end: start + duration,
    stop: start + duration + durationSeconds(s.gracefulStop),
    finite,
    arrival,
    vus,
    rate,
    iterations,
  };
}
export function workloadLoad(c: QuickTest) {
  const scenarios = (c.scenarios ?? [defaultScenario(c)])
    .filter((s) => s.enabled)
    .map(scenarioLoad);
  const events = scenarios
    .flatMap((s) => [
      { time: s.start, vus: s.vus, rate: s.rate ?? 0 },
      { time: s.stop, vus: -s.vus, rate: -(s.rate ?? 0) },
    ])
    .sort((a, b) => a.time - b.time || a.vus - b.vus);
  let vus = 0,
    rate = 0,
    peakVus = 0,
    peakRate = 0;
  for (const event of events) {
    vus += event.vus;
    rate += event.rate;
    peakVus = Math.max(peakVus, vus);
    peakRate = Math.max(peakRate, rate);
  }
  const duration = Math.max(0, ...scenarios.map((s) => s.stop));
  const iterationBound = scenarios.reduce(
    (total, s) => total + (s.iterations ?? 0),
    0,
  );
  return {
    peakVus,
    peakRate,
    duration,
    iterationBound,
    high:
      peakVus > 50 ||
      peakRate > 100 ||
      duration > 300 ||
      iterationBound > 10000,
  };
}
