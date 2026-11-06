import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaultTest, type QuickTest } from "../src/model";
import { defaultScenario } from "../src/workload";
import { requestConfig } from "../src/requests";
import { validateQuickTest, safeConfig } from "../src/definition";
import { credentialVariables } from "../src/integrations";
import { K6Runner } from "../src/runner";
import { scopedRun } from "../src/comparison";

test("independent scenarios validate their own requests and protect credentials", () => {
  const base = { ...defaultTest, url: "http://localhost/" };
  const scenario = {
    ...defaultScenario(base),
    request: requestConfig(base),
    env: { REGION: "local" },
  };
  const config = { ...base, scenarios: [scenario] };
  assert.doesNotThrow(() => validateQuickTest(config));
  assert.ok(safeConfig(config));
  scenario.request.headers = { Authorization: "${SCENARIO_TOKEN}" };
  assert.deepEqual(credentialVariables(config), ["SCENARIO_TOKEN"]);
  assert.equal(safeConfig(config), undefined);
  scenario.request.headers = { Authorization: "literal-secret" };
  assert.throws(() => validateQuickTest(config), /Sensitive headers/);
  scenario.request.headers = {};
  Object.assign(scenario.env, { K6_OUT: "json=unrequested.json" });
  assert.throws(() => validateQuickTest(config), /Scenario environment/);
});

test(
  "real independent HTTP and WebSocket scenarios keep auth, data, env and metrics separate",
  {
    skip: !process.env.LOADDECK_TEST_K6,
    timeout: 20000,
  },
  async () => {
    const bodies: unknown[] = [];
    const http = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        assert.equal(request.method, "POST");
        assert.equal(
          request.headers.authorization,
          "Bearer local-scenario-secret",
        );
        bodies.push(JSON.parse(body));
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    assert.ok(address && typeof address === "object");
    const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => ws.once("listening", resolve));
    ws.on("connection", (socket) =>
      socket.on("message", (message) => socket.send(message.toString())),
    );
    const wsAddress = ws.address();
    assert.ok(wsAddress && typeof wsAddress === "object");
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-independent-"),
    );
    try {
      const file = path.join(directory, "rows.json");
      await writeFile(file, '[{"id":1},{"id":2}]');
      const base: QuickTest = {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        duration: "1s",
        sleep: 0.1,
      };
      const posting: QuickTest = {
        ...base,
        method: "POST",
        bodyMode: "json",
        body: '{"id":"{{id}}","region":"${REGION}"}',
        authentication: {
          mode: "bearer",
          secretVariable: "SCENARIO_TOKEN",
          usernameVariable: "",
          keyName: "",
          placement: "header",
          tokenUrl: "",
          scope: "",
          audience: "",
          certificateVariable: "",
          privateKeyVariable: "",
        },
        dataset: {
          file,
          format: "json",
          strategy: "round-robin",
          exhaustion: "repeat",
          variables: {},
        },
        checks: [
          {
            name: "post works",
            kind: "jsonEquals",
            path: "ok",
            value: "true",
            enabled: true,
          },
        ],
      };
      const socket: QuickTest = {
        ...base,
        url: `ws://127.0.0.1:${wsAddress.port}/`,
        protocol: {
          kind: "ws",
          message: "echo",
          sessionMs: 100,
          grpcMethod: "",
          protoFile: "",
          importPaths: [],
          plaintext: true,
        },
        checks: [
          {
            name: "echo works",
            kind: "messageContains",
            value: "echo",
            path: "",
            enabled: true,
          },
        ],
      };
      const config = validateQuickTest({
        ...base,
        scenarios: [
          {
            ...defaultScenario(base),
            name: "posting",
            env: { REGION: "local" },
            request: requestConfig(posting),
          },
          {
            ...defaultScenario(base),
            name: "socket",
            startTime: "1s",
            request: requestConfig(socket),
          },
        ],
      });
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { config, environment: { SCENARIO_TOKEN: "local-scenario-secret" } },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.equal(run.metrics.checksFailed, 0);
      assert.ok(bodies.some((body) => (body as { id: number }).id === 1));
      assert.ok(bodies.some((body) => (body as { id: number }).id === 2));
      assert.ok(
        bodies.every((body) => (body as { region: string }).region === "local"),
      );
      assert.equal(run.protocol, "mixed");
      assert.equal(scopedRun(run, "socket").protocol, "ws");
      assert.ok(
        (run.scenarioProtocolMetrics?.socket?.["ws_msgs_received.count"] ?? 0) >
          0,
      );
      assert.ok((run.scenarioMetrics?.posting?.requests ?? 0) > 0);
      assert.equal(run.config, undefined);
      assert.ok(!JSON.stringify(run).includes("local-scenario-secret"));
      assert.ok(!JSON.stringify(run).includes(file));
    } finally {
      for (const socket of ws.clients) socket.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
