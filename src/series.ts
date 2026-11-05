import type { Run } from "./model";
export type ChartMetric = "requests" | "latency" | "failures" | "vus";
export interface ChartPoint {
  x: number;
  y: number;
}
export interface ChartScale {
  end: number;
  maximum: number;
}
export function seriesPoints(
  run: Pick<Run, "series" | "metrics">,
  metric: ChartMetric,
): ChartPoint[] {
  if (metric === "requests" && run.metrics.requests === undefined) return [];
  return run.series
    .map((bucket) => {
      const width = bucket.widthSeconds;
      const y =
        metric === "requests"
          ? width !== undefined && Number.isFinite(width) && width > 0
            ? bucket.requests / width
            : undefined
          : metric === "latency"
            ? bucket.latencyCount
              ? bucket.latencySum / bucket.latencyCount
              : undefined
            : metric === "failures"
              ? bucket.failureCount
                ? (bucket.failures / bucket.failureCount) * 100
                : undefined
              : bucket.vus;
      return { x: bucket.elapsed, y };
    })
    .filter(
      (point): point is ChartPoint =>
        point.y !== undefined &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.x),
    );
}
export function sharedChartScale(
  runs: Pick<Run, "series" | "metrics" | "elapsedMs">[],
  metric: ChartMetric,
): ChartScale {
  const points = runs.flatMap((run) => seriesPoints(run, metric));
  return {
    end: Math.max(
      1,
      ...runs.map((run) => run.elapsedMs / 1000).filter(Number.isFinite),
      ...points.map((point) => point.x),
    ),
    maximum: Math.max(1, ...points.map((point) => point.y)),
  };
}
