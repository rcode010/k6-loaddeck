import type { Run, ThresholdResult } from "./model";
export function thresholdText(result: ThresholdResult): string {
  return result.ok === null ? "Not evaluated" : result.ok ? "Met" : "Failed";
}
export function outcomeText(run: Run): string {
  if (run.state === "completed") {
    if (run.thresholds.length) {
      if (run.thresholds.some((rule) => rule.ok === false))
        return "Completed · threshold failed";
      if (run.thresholds.every((rule) => rule.ok === true))
        return "Completed · thresholds met";
      return "Completed · threshold results unavailable";
    }
    if (
      run.thresholdsConfigured === false ||
      (run.thresholdsConfigured === undefined &&
        run.summarySource === "k6-summary")
    )
      return "Completed · no thresholds";
    return "Completed · threshold results unavailable";
  }
  if (
    run.state === "threshold_failed" &&
    run.observation === "threshold-aborted"
  )
    return "Threshold failed · aborted early";
  return {
    starting: "Starting",
    running: "Running",
    stopping: "Stopping",
    threshold_failed: "Threshold failed",
    execution_failed: "Execution failed",
    cancelled: "Cancelled",
  }[run.state];
}
