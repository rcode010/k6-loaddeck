import { test } from "node:test";
import assert from "node:assert/strict";
import { Aggregator } from "../src/metrics";
import { compareRuns, scopedRun, commonScenarios } from "../src/comparison";
import { seriesPoints, sharedChartScale } from "../src/series";
import type { Run, Bucket } from "../src/model";
const bucket = (extra: Partial<Bucket> = {}): Bucket => ({
  elapsed: 0,
  widthSeconds: 1,
  requests: 1,
  latencySum: 10,
  latencyCount: 1,
  failures: 0,
  failureCount: 1,
  ...extra,
});
const run = (id: string, extra: Partial<Run> = {}): Run => ({
  schemaVersion: 1,
  id,
  name: id,
  testKind: "load",
  target: "http://localhost/",
  method: "GET",
  fingerprint: "same",
  rerunnable: false,
  startedAt: new Date(0).toISOString(),
  elapsedMs: 10000,
  state: "completed",
  exitCode: 0,
  k6Version: "fixture",
  metrics: { avg: 100, p95: 200, requests: 100 },
  series: [bucket()],
  thresholds: [],
  summarySource: "k6-summary",
  logs: [],
  ...extra,
});
test("scenario comparison never substitutes global percentiles or mutates stored runs", () => {
  const first = run("first", {
    scenarioMetrics: { second: { avg: 20, requests: 5 } },
    scenarioSeries: { second: [bucket({ elapsed: 3, latencySum: 20 })] },
  });
  const second = run("second", {
    scenarioMetrics: { second: { avg: 10, requests: 5 } },
    scenarioSeries: { second: [bucket({ elapsed: 3 })] },
  });
  const before = JSON.stringify([first, second]);
  const comparison = compareRuns(first, second, "second");
  assert.equal(comparison.rows.find((r) => r.key === "avg")?.percent, -50);
  assert.equal(
    comparison.rows.find((r) => r.key === "p95")?.baseline,
    undefined,
  );
  assert.deepEqual(commonScenarios(first, second), ["second"]);
  assert.equal(scopedRun(first, "second").series[0]?.elapsed, 3);
  assert.throws(() => compareRuns(first, second, "missing"));
  assert.equal(JSON.stringify([first, second]), before);
});
test("chart axes share elapsed duration and value scale without inventing missing rate widths", () => {
  const first = run("first", {
    elapsedMs: 2000,
    series: [bucket({ widthSeconds: 2, requests: 10, latencySum: 100 })],
  });
  const second = run("second", {
    elapsedMs: 5000,
    series: [bucket({ elapsed: 3, latencySum: 200 })],
  });
  assert.deepEqual(sharedChartScale([first, second], "latency"), {
    end: 5,
    maximum: 200,
  });
  assert.equal(seriesPoints(first, "requests")[0]?.y, 5);
  assert.deepEqual(
    seriesPoints(
      { ...first, series: [bucket({ widthSeconds: undefined })] },
      "requests",
    ),
    [],
  );
  assert.equal(
    seriesPoints(
      { ...first, series: [bucket({ widthSeconds: undefined })] },
      "latency",
    )[0]?.y,
    10,
  );
  assert.deepEqual(seriesPoints({ ...first, metrics: {} }, "requests"), []);
  assert.deepEqual(
    seriesPoints(
      { ...first, series: [bucket({ latencyCount: 0 })] },
      "latency",
    ),
    [],
  );
});
test("scoped time series stay bounded while preserving observed totals and protocol counters", () => {
  const collector = new Aggregator(0);
  collector.add({
    type: "Metric",
    metric: "ws_msgs_received",
    data: { type: "counter" },
  });
  for (let i = 0; i < 2000; i++)
    for (const [metric, value] of [
      ["http_reqs", 1],
      ["http_req_duration", 10],
      ["ws_msgs_received", 1],
    ] as const)
      collector.add({
        type: "Point",
        metric,
        data: {
          value,
          time: new Date(i * 1000).toISOString(),
          tags: { scenario: i % 2 ? "odd" : "even" },
        },
      });
  const snapshot = collector.snapshot(2000000);
  assert.ok(snapshot.series.length <= 600);
  for (const name of ["odd", "even"]) {
    const series = snapshot.scenarioSeries[name]!;
    assert.ok(series.length <= 120);
    assert.equal(
      series.reduce((sum, b) => sum + b.requests, 0),
      1000,
    );
    assert.ok(series.every((b) => b.widthSeconds! >= 1));
    assert.equal(
      snapshot.scenarioProtocolMetrics[name]?.["ws_msgs_received.count"],
      1000,
    );
  }
});
test("protocol comparisons show native metrics and keep session counts contextual", () => {
  const first = run("first", {
    protocol: "ws",
    metrics: {},
    protocolMetrics: { "ws_msgs_received.count": 4, "ws_connecting.avg": 10 },
  });
  const second = run("second", {
    protocol: "ws",
    metrics: {},
    protocolMetrics: { "ws_msgs_received.count": 8, "ws_connecting.avg": 5 },
  });
  const comparison = compareRuns(first, second);
  assert.equal(comparison.rows.length, 2);
  assert.equal(
    comparison.rows.find((r) => r.key === "ws_msgs_received.count")
      ?.interpretation,
    "Context only",
  );
  assert.equal(
    comparison.rows.find((r) => r.key === "ws_connecting.avg")?.interpretation,
    "Improved",
  );
});
