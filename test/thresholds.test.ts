import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaultTest, type Run } from "../src/model";
import {
  compileThresholds,
  thresholdOptions,
  reconcileThresholds,
  type ThresholdRule,
} from "../src/thresholds";
import { readSummary } from "../src/summary";
import { outcomeText, thresholdText } from "../src/outcome";
import { defaultScenario } from "../src/workload";
import { plannedDurationMs, observation } from "../src/observation";
import { compareRuns } from "../src/comparison";
import { K6Runner } from "../src/runner";
import { validateQuickTest } from "../src/definition";
import { HistoryStore } from "../src/history";

const rule = (extra: Partial<ThresholdRule> = {}): ThresholdRule => ({
  metric: "http_req_duration",
  aggregation: "p(95)",
  operator: "<",
  value: 500,
  scope: "",
  abortOnFail: false,
  delayAbortEval: "",
  ...extra,
});
test("threshold rules respect actual metric types and preserve both form sources", () => {
  for (const invalid of [
    rule({ metric: "checks", aggregation: "avg" }),
    rule({ metric: "vus", aggregation: "max" }),
    rule({ metric: "custom_duration" }),
    rule({ aggregation: "p(100.01)" }),
    rule({ metric: "checks", aggregation: "rate", value: 99 }),
    rule({ delayAbortEval: "1s" }),
  ])
    assert.throws(() => compileThresholds([invalid]));
  assert.ok(
    compileThresholds([
      rule({
        metric: "custom_duration",
        metricType: "gauge",
        aggregation: "value",
        value: -3,
      }),
    ]).custom_duration,
  );
  const options = thresholdOptions({
    thresholds: { http_req_duration: ["avg<100"] },
    thresholdRules: [rule({ aggregation: "p(99.99)" })],
  });
  assert.equal(options.http_req_duration?.length, 2);
  assert.ok(options.http_req_duration?.some((r) => r.threshold === "avg<100"));
  assert.ok(
    options.http_req_duration?.some((r) => r.threshold === "p(99.99)<500"),
  );
  assert.ok(
    compileThresholds([rule({ scope: "scenario:main, group:::contract" })])[
      "http_req_duration{scenario:main,group:::contract}"
    ],
  );
});
test("missing threshold outcomes remain unevaluated and truncated runs suppress verdicts", () => {
  const parsed = readSummary({
    metrics: {
      http_req_duration: {
        type: "trend",
        contains: "time",
        values: { "p(95)": 23 },
        thresholds: { "p(95)<500": { ok: true }, "avg<50": {} },
      },
    },
  });
  assert.equal(parsed.thresholds[0]?.observedValue, 23);
  assert.equal(parsed.thresholds[1]?.ok, null);
  assert.equal(thresholdText(parsed.thresholds[1]!), "Not evaluated");
  const missing = reconcileThresholds(
    { thresholds: { checks: ["rate==1"] } },
    [],
  );
  assert.equal(missing[0]?.ok, null);
  const run = {
    id: "first",
    state: "completed",
    thresholds: missing,
    thresholdsConfigured: true,
    metrics: { avg: 10 },
    fingerprint: "same",
    testKind: "load",
    summarySource: "observed",
  } as Run;
  assert.equal(outcomeText(run), "Completed · threshold results unavailable");
  const comparison = compareRuns(run, {
    ...run,
    id: "second",
    state: "threshold_failed",
    observation: "threshold-aborted",
    metrics: { avg: 5 },
  });
  assert.equal(comparison.rows[0]?.interpretation, "Context only");
  assert.ok(comparison.notes.some((note) => note.includes("stopped early")));
  const config = { ...defaultTest, url: "http://localhost/", duration: "10s" };
  assert.equal(plannedDurationMs(config), 10000);
  assert.equal(
    plannedDurationMs({
      ...config,
      scenarios: [
        {
          ...defaultScenario(config),
          executor: "shared-iterations",
          iterations: 1,
        },
      ],
    }),
    undefined,
  );
  assert.equal(
    observation(
      { ...run, state: "threshold_failed", engineElapsedMs: 4000 },
      { ...config, thresholdRules: [rule({ abortOnFail: true })] },
    ),
    "threshold-aborted",
  );
});
test(
  "real decimal percentiles, delay-before-abort, unknown metric results and catalog persistence",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 30000 },
  async () => {
    const server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-thresholds-"),
    );
    const binary = process.env.LOADDECK_TEST_K6!;
    const config = {
      ...defaultTest,
      url: `http://127.0.0.1:${address.port}/`,
      duration: "1s",
      sleep: 0.05,
    };
    try {
      const normal = await new K6Runner().run(
        binary,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            thresholds: { http_req_duration: ["avg<500"] },
            thresholdRules: [rule({ aggregation: "p(99.99)" })],
          }),
        },
      );
      assert.equal(normal.state, "completed", normal.logs.join("\n"));
      assert.equal(normal.thresholds.length, 2);
      assert.ok(
        normal.thresholds.every((t) => t.ok && t.observedValue !== undefined),
      );
      const aborted = await new K6Runner().run(
        binary,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            duration: "12s",
            thresholdRules: [
              rule({ value: 0, abortOnFail: true, delayAbortEval: "3s" }),
            ],
          }),
        },
      );
      assert.equal(aborted.state, "threshold_failed", aborted.logs.join("\n"));
      assert.equal(aborted.observation, "threshold-aborted");
      assert.ok(aborted.engineElapsedMs! >= 2900, JSON.stringify(aborted));
      assert.ok(aborted.engineElapsedMs! < 10000);
      assert.equal(aborted.plannedDurationMs, 12000);
      assert.equal(aborted.thresholds[0]?.abortOnFail, true);
      const unknown = await new K6Runner().run(
        binary,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            thresholdRules: [
              rule({ metric: "not_emitted", metricType: "trend" }),
            ],
          }),
        },
      );
      assert.equal(unknown.state, "execution_failed");
      assert.equal(unknown.thresholds[0]?.ok, null);
      const script = path.join(directory, "custom.js");
      await writeFile(
        script,
        `import { Trend } from 'k6/metrics';\nimport http from 'k6/http';\nconst timing = new Trend('fixture_timing', true);\nexport const options = {vus:1,iterations:2};\nexport default function () { timing.add(http.get(${JSON.stringify(config.url)}).timings.duration); }\n`,
      );
      const custom = await new K6Runner().run(
        binary,
        "fixture",
        () => undefined,
        { script },
      );
      assert.equal(custom.state, "completed", custom.logs.join("\n"));
      const metric = custom.metricCatalog?.find(
        (m) => m.name === "fixture_timing",
      );
      assert.equal(metric?.type, "trend");
      assert.equal(metric?.unit, "ms");
      assert.equal(metric?.source, "k6-json");
      const store = new HistoryStore(
        path.join(directory, "history"),
        () => 50,
        () => undefined,
      );
      await store.save(aborted);
      await store.save(custom);
      const reopened = await new HistoryStore(
        path.join(directory, "history"),
        () => 50,
        () => undefined,
      ).list();
      assert.equal(
        reopened.find((r) => r.id === aborted.id)?.observation,
        "threshold-aborted",
      );
      assert.equal(
        reopened
          .find((r) => r.id === custom.id)
          ?.metricCatalog?.find((m) => m.name === "fixture_timing")?.type,
        "trend",
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
