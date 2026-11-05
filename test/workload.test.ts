import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultTest } from "../src/model";
import {
  executors,
  defaultScenario,
  scenarioOptions,
  validateScenarios,
  compileThresholds,
} from "../src/workload";
import { generateScript } from "../src/definition";
import { K6Runner } from "../src/runner";

test("all executors validate required fields and omit unrelated options", () => {
  for (const executor of executors) {
    const scenario = {
      ...defaultScenario({ ...defaultTest, url: "http://localhost/" }),
      executor,
      iterations: 2,
      startVUs: 0,
      rate: 2,
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: 1,
      maxVUs: 2,
      stages: [{ duration: "1s", target: 1 }],
    };
    validateScenarios([scenario]);
    const options = scenarioOptions(scenario, 0);
    assert.equal(options.executor, executor);
    assert.equal(options.exec, "scenario_0");
    if (executor.includes("arrival-rate")) assert.equal(options.vus, undefined);
  }
  assert.throws(() =>
    validateScenarios([{ ...defaultScenario(defaultTest), vus: undefined }]),
  );
  assert.throws(() =>
    compileThresholds([
      {
        metric: "checks",
        aggregation: "avg",
        operator: ">",
        value: 1,
        scope: "",
        abortOnFail: false,
        delayAbortEval: "",
      },
    ]),
  );
});
test(
  "real k6 executes all six executors and staggered scenarios",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 60000 },
  async () => {
    const server = createServer((_, response) => response.end('{"ok":true}'));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const config = {
      ...defaultTest,
      url: `http://127.0.0.1:${address.port}/`,
      sleep: 0,
      duration: "1s",
    };
    try {
      for (const executor of executors) {
        const scenario = {
          ...defaultScenario(config),
          executor,
          iterations: 2,
          startVUs: 0,
          rate: 2,
          startRate: 1,
          timeUnit: "1s",
          preAllocatedVUs: 1,
          maxVUs: 2,
          stages: [{ duration: "1s", target: 2 }],
          gracefulStop: "1s",
        };
        const testConfig = { ...config, scenarios: [scenario] };
        if (executor.includes("arrival-rate"))
          assert.ok(!generateScript(testConfig).includes("  sleep("));
        const run = await new K6Runner().run(
          process.env.LOADDECK_TEST_K6!,
          "test",
          () => undefined,
          { config: testConfig },
        );
        assert.equal(
          run.state,
          "completed",
          `${executor}: ${run.logs.join("\n")}`,
        );
        assert.ok(run.metrics.requests! > 0, executor);
      }
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "test",
        () => undefined,
        {
          config: {
            ...config,
            scenarios: [
              { ...defaultScenario(config), name: "first" },
              { ...defaultScenario(config), name: "second", startTime: "1s" },
            ],
            checks: [
              {
                name: "json value",
                kind: "jsonEquals",
                path: "ok",
                value: "true",
                enabled: true,
              },
            ],
            thresholdRules: [
              {
                metric: "http_req_duration",
                aggregation: "p(95)",
                operator: "<",
                value: 500,
                scope: "scenario:second",
                abortOnFail: false,
                delayAbortEval: "",
              },
            ],
          },
        },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.ok(run.metrics.checksPassed! > 0);
      assert.ok(
        run.thresholds.some((t) => t.metric.includes("scenario:second")),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
