import type { QuickTest, Run } from "./model";
import { defaultScenario } from "./workload";
import { durationSeconds } from "./duration";
import { configuredThresholds } from "./thresholds";
export function plannedDurationMs(config: QuickTest): number | undefined {
  const scenarios = (config.scenarios ?? [defaultScenario(config)]).filter(
    (s) => s.enabled,
  );
  let end = 0;
  for (const s of scenarios) {
    if (
      s.executor === "shared-iterations" ||
      s.executor === "per-vu-iterations"
    )
      return undefined;
    const duration = s.executor.startsWith("ramping-")
      ? (s.stages ?? []).reduce(
          (total, stage) => total + durationSeconds(stage.duration),
          0,
        )
      : durationSeconds(s.duration ?? "");
    const offset = durationSeconds(s.startTime);
    if (!Number.isFinite(duration) || !Number.isFinite(offset))
      return undefined;
    end = Math.max(end, offset + duration);
  }
  return end * 1000;
}
export function observation(
  run: Run,
  config?: QuickTest,
): NonNullable<Run["observation"]> {
  if (run.state === "cancelled") return "cancelled";
  if (run.state === "execution_failed") return "incomplete";
  if (
    run.state === "threshold_failed" &&
    config &&
    configuredThresholds(config).some((rule) => rule.abortOnFail)
  ) {
    const planned = plannedDurationMs(config),
      elapsed = run.engineElapsedMs ?? run.elapsedMs;
    if (planned === undefined) return "threshold-abort-possible";
    if (elapsed + 500 < planned) return "threshold-aborted";
  }
  return "complete";
}
