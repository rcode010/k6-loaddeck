import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultTest } from "../src/model";
import { defaultScenario } from "../src/workload";
import { validateChecks, parseStatuses, type CheckRule } from "../src/checks";
import { validateQuickTest, generateScript } from "../src/definition";
import { K6Runner } from "../src/runner";

const rule = (
  kind: CheckRule["kind"],
  value: string,
  extra: Partial<CheckRule> = {},
): CheckRule => ({
  name: kind,
  kind,
  value,
  path: "",
  enabled: true,
  ...extra,
});
test("assertions reject malformed status lists, regex flags and misleading scopes", () => {
  assert.deepEqual(parseStatuses("200, 201, 204, 200"), [200, 201, 204]);
  for (const value of ["200-299", "99", "600", "200,", "200.5"])
    assert.throws(() => parseStatuses(value));
  for (const check of [
    rule("status", "200.5"),
    rule("grpcStatus", "17"),
    rule("bodyRegex", "["),
    rule("bodyRegex", "x", { flags: "ii" }),
    rule("bodyRegex", "x", { flags: "g" }),
    rule("status", "200", { tags: { scenario: "pretend" } }),
  ])
    assert.throws(() => validateChecks([check]));
  validateChecks([rule("bodyRegex", "^hello$", { flags: "im" })]);
  assert.throws(() =>
    validateQuickTest({
      ...defaultTest,
      url: "http://localhost/",
      checks: [rule("status", "200", { scenarios: ["missing"] })],
    }),
  );
});
test(
  "real scoped check groups, regex, allowed statuses and UTF-8 byte semantics",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 30000 },
  async () => {
    const server = createServer((_, response) => {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("X-Check-Value", "Ready42");
      response.end("é🙂");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const config = {
      ...defaultTest,
      url: `http://127.0.0.1:${address.port}/`,
      duration: "1s",
      sleep: 0.05,
    };
    const checks = [
      rule("statuses", "200, 204"),
      rule("bodyRegex", "^É🙂$", { flags: "iu" }),
      rule("bodyBytes", "6"),
      rule("bodyLength", "3"),
      rule("headerRegex", "^ready\\d+$", { flags: "i", path: "x-check-value" }),
      rule("headerEquals", "Ready42", { path: "X-CHECK-VALUE" }),
      rule("status", "200", { name: "second only", scenarios: ["second"] }),
    ].map((check) => ({ ...check, group: "contract", tags: { tier: "api" } }));
    try {
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            checks,
            scenarios: [
              { ...defaultScenario(config), name: "first" },
              { ...defaultScenario(config), name: "second", startTime: "1s" },
            ],
            thresholdRules: [
              {
                metric: "checks",
                aggregation: "rate",
                operator: "==",
                value: 1,
                scope: "tier:api",
                abortOnFail: false,
                delayAbortEval: "",
              },
            ],
          }),
        },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.equal(run.metrics.checksFailed, 0);
      assert.ok(run.checkResults?.length);
      assert.ok(
        run.checkResults.every(
          (check) =>
            check.group === "::contract" && check.request === check.scenario,
        ),
      );
      assert.ok(
        run.checkResults
          .filter((check) => check.name === "second only")
          .every((check) => check.scenario === "second"),
      );
      assert.equal(
        run.checkResults.reduce((sum, check) => sum + check.passes, 0),
        run.metrics.checksPassed,
      );
      const failing = {
        ...config,
        checks: [
          rule("bodyBytes", "7"),
          rule("bodyRegex", "never"),
          rule("jsonEquals", "true", { path: "ok" }),
        ],
      };
      const observed = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(failing) },
      );
      assert.equal(observed.state, "completed");
      assert.ok(observed.metrics.checksFailed! > 0);
      assert.ok(observed.checkResults?.every((check) => check.fails > 0));
      const enforced = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...failing,
            thresholds: { checks: ["rate==1"] },
          }),
        },
      );
      assert.equal(enforced.state, "threshold_failed");
      assert.equal(enforced.exitCode, 99);
      assert.ok(
        generateScript({ ...config, checks }).includes('group("contract"'),
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
