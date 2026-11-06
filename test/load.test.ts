import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultTest, type QuickTest } from "../src/model";
import {
  defaultScenario,
  changeExecutor,
  type Executor,
  type Scenario,
} from "../src/workload";
import { scenarioLoad, workloadLoad } from "../src/load";
import { K6Runner } from "../src/runner";
import { validateQuickTest } from "../src/definition";

test("workload estimates use executor units, overlapping schedules and graceful stop", () => {
  const base = { ...defaultTest, url: "http://localhost/" };
  const rate: Scenario = {
    ...defaultScenario(base),
    executor: "ramping-arrival-rate",
    startRate: 0,
    timeUnit: "1m",
    preAllocatedVUs: 2,
    maxVUs: 3,
    stages: [{ duration: "10s", target: 120 }],
    gracefulStop: "0s",
  };
  assert.equal(scenarioLoad(rate).rate, 2);
  assert.equal(scenarioLoad(rate).vus, 3);
  assert.equal(workloadLoad({ ...base, scenarios: [rate] }).high, false);
  const fifty = { ...defaultScenario(base), vus: 50, gracefulStop: "5s" };
  assert.equal(
    workloadLoad({
      ...base,
      scenarios: [fifty, { ...fifty, name: "next", startTime: "14s" }],
    }).peakVus,
    100,
  );
  assert.equal(
    workloadLoad({
      ...base,
      scenarios: [fifty, { ...fifty, name: "next", startTime: "15s" }],
    }).peakVus,
    50,
  );
  assert.equal(
    workloadLoad({ ...base, scenarios: [{ ...rate, timeUnit: "1ms" }] }).high,
    true,
  );
  assert.equal(
    scenarioLoad({ ...fifty, executor: "per-vu-iterations", iterations: 10 })
      .iterations,
    500,
  );
  assert.equal(
    workloadLoad({ ...base, testKind: "stress", vus: 30 }).peakVus,
    60,
  );
});

test("switching executors preserves independent shared fields and ramp stages", () => {
  const scenario = defaultScenario(defaultTest);
  const drafts = new Map<Executor, Partial<Scenario>>();
  scenario.vus = 7;
  changeExecutor(scenario, "ramping-vus", drafts);
  scenario.stages = [{ duration: "3s", target: 15 }];
  changeExecutor(scenario, "ramping-arrival-rate", drafts);
  scenario.stages = [{ duration: "2s", target: 100 }];
  changeExecutor(scenario, "ramping-vus", drafts);
  assert.deepEqual(scenario.stages, [{ duration: "3s", target: 15 }]);
  changeExecutor(scenario, "constant-vus", drafts);
  assert.equal(scenario.vus, 7);
  changeExecutor(scenario, "ramping-arrival-rate", drafts);
  assert.deepEqual(scenario.stages, [{ duration: "2s", target: 100 }]);
});

test(
  "all five named presets execute their actual k6 schedules",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 20000 },
  async () => {
    const server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      for (const testKind of [
        "smoke",
        "load",
        "stress",
        "spike",
        "soak",
      ] as const) {
        const config: QuickTest = validateQuickTest({
          ...defaultTest,
          url: `http://127.0.0.1:${address.port}/`,
          duration: "1s",
          sleep: 0.1,
          testKind,
        });
        const run = await new K6Runner().run(
          process.env.LOADDECK_TEST_K6!,
          "fixture",
          () => undefined,
          { config },
        );
        assert.equal(
          run.state,
          "completed",
          `${testKind}: ${run.logs.join("\n")}`,
        );
        assert.equal(run.testKind, testKind);
        assert.ok((run.metrics.requests ?? 0) > 0);
        assert.equal(
          run.plannedDurationMs,
          ["stress", "spike"].includes(testKind) ? 3000 : 1000,
        );
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
