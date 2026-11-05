import { defaultScenario } from "../src/workload";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { K6Runner } from "../src/runner";
import { defaultTest, type QuickTest } from "../src/model";
import { validateQuickTest } from "../src/definition";

test(
  "real JSON requests, dataset bindings and check names preserve own properties",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 15000 },
  async () => {
    const received: unknown[] = [];
    const server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const data = JSON.parse(text);
        received.push(data);
        response.statusCode = request.rawHeaders.some(
          (name, index) =>
            index % 2 === 0 &&
            name.toLowerCase() === "__proto__" &&
            request.rawHeaders[index + 1] === "literal-header",
        )
          ? 200
          : 400;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(data));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-json-"));
    const dataset = path.join(directory, "data.json");
    await writeFile(dataset, '[{"__proto__":{"actual":true}}]');
    const config: QuickTest = {
      ...defaultTest,
      url: `http://127.0.0.1:${address.port}/`,
      method: "POST",
      bodyMode: "json",
      body: '{"__proto__":{"actual":true}}',
      headers: JSON.parse('{"__proto__":"literal-header"}'),
      duration: "1s",
      sleep: 0.1,
      expectedStatus: 200,
      checks: [
        {
          name: "__proto__",
          kind: "jsonEquals",
          value: "true",
          path: "__proto__.actual",
          enabled: true,
        },
      ],
      thresholds: { checks: ["rate==1"] },
    };
    try {
      const direct = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(config) },
      );
      assert.equal(
        direct.state,
        "completed",
        JSON.stringify({ checks: direct.checkResults, body: received[0] }) +
          direct.logs.join("\n"),
      );
      assert.ok(
        direct.checkResults?.some(
          (check) => check.name === "__proto__" && check.passes > 0,
        ),
      );
      assert.ok(
        received.every((value) => Object.hasOwn(value as object, "__proto__")),
      );
      const tagged = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            checks: config.checks!.map((check) => ({
              ...check,
              tags: JSON.parse('{"__proto__":"api"}'),
            })),
            scenarios: [
              {
                ...defaultScenario(config),
                tags: JSON.parse('{"__proto__":"load"}'),
              },
            ],
            thresholdRules: [
              {
                metric: "checks",
                aggregation: "rate",
                operator: "==",
                value: 1,
                scope: "__proto__:api",
                abortOnFail: false,
                delayAbortEval: "",
              },
              {
                metric: "http_req_duration",
                aggregation: "p(95)",
                operator: "<",
                value: 500,
                scope: "__proto__:load",
                abortOnFail: false,
                delayAbortEval: "",
              },
            ],
          }),
        },
      );
      assert.equal(tagged.state, "completed", tagged.logs.join("\n"));
      assert.ok(
        tagged.thresholds.some(
          (rule) => rule.metric === "checks{__proto__:api}" && rule.ok,
        ),
      );
      const authenticated = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            headers: {},
            authentication: {
              mode: "apiKey",
              usernameVariable: "",
              secretVariable: "LD_PROTO",
              keyName: "__proto__",
              placement: "header",
              tokenUrl: "",
              scope: "",
              audience: "",
              certificateVariable: "",
              privateKeyVariable: "",
            },
          }),
          environment: { LD_PROTO: "literal-header" },
        },
      );
      assert.equal(
        authenticated.state,
        "completed",
        authenticated.logs.join("\n"),
      );
      const mapped = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            body: '{"bound":"{{__proto__.actual}}"}',
            dataset: {
              file: dataset,
              format: "json",
              strategy: "round-robin",
              exhaustion: "repeat",
              variables: {},
            },
            checks: [
              {
                name: "bound own property",
                kind: "jsonEquals",
                value: "true",
                path: "bound",
                enabled: true,
              },
            ],
          }),
        },
      );
      assert.equal(mapped.state, "completed", mapped.logs.join("\n"));
      assert.ok(
        received.some((value) => (value as { bound?: boolean }).bound === true),
      );
      const inherited = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            body: "{}",
            checks: [
              {
                name: "absent inherited field",
                kind: "jsonEquals",
                value: "{}",
                path: "constructor.prototype",
                enabled: true,
              },
            ],
          }),
        },
      );
      assert.equal(
        inherited.state,
        "threshold_failed",
        inherited.logs.join("\n"),
      );
      assert.ok(inherited.metrics.checksFailed! > 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
