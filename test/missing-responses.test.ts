import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { K6Runner } from "../src/runner";
import { defaultTest, type QuickTest } from "../src/model";
import { validateQuickTest } from "../src/definition";

test(
  "silent WebSockets fail content checks while actual empty messages can match",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 20000 },
  async () => {
    const silent = new WebSocketServer({ host: "127.0.0.1", port: 0 }),
      empty = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await Promise.all([
      new Promise<void>((resolve) => silent.once("listening", resolve)),
      new Promise<void>((resolve) => empty.once("listening", resolve)),
    ]);
    empty.on("connection", (socket) =>
      socket.on("message", () => socket.send("")),
    );
    const a = silent.address(),
      b = empty.address();
    assert.ok(a && typeof a === "object" && b && typeof b === "object");
    const config: QuickTest = {
      ...defaultTest,
      url: `ws://127.0.0.1:${a.port}/`,
      duration: "1s",
      sleep: 0,
      protocol: {
        kind: "ws",
        message: "hello",
        sessionMs: 100,
        grpcMethod: "",
        protoFile: "",
        importPaths: [],
        plaintext: true,
      },
      checks: [
        {
          name: "message received",
          kind: "messageRegex",
          value: "^$",
          path: "",
          enabled: true,
          group: "exchange",
        },
      ],
    };
    try {
      const missing = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(config) },
      );
      assert.equal(missing.state, "completed", missing.logs.join("\n"));
      assert.ok(missing.metrics.checksFailed! > 0);
      assert.ok(
        missing.checkResults?.some(
          (check) =>
            check.name === "message received" &&
            check.group === "::exchange" &&
            check.fails > 0,
        ),
      );
      const enforced = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            thresholds: { checks: ["rate==1"] },
          }),
        },
      );
      assert.equal(enforced.state, "threshold_failed");
      const present = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...config,
            url: `ws://127.0.0.1:${b.port}/`,
            thresholds: { checks: ["rate==1"] },
          }),
        },
      );
      assert.equal(present.state, "completed", present.logs.join("\n"));
      assert.equal(present.metrics.checksFailed, 0);
    } finally {
      for (const server of [silent, empty])
        for (const socket of server.clients) socket.terminate();
      await Promise.all([
        new Promise<void>((resolve) => silent.close(() => resolve())),
        new Promise<void>((resolve) => empty.close(() => resolve())),
      ]);
    }
  },
);
test(
  "zero minimum response length and UTF-8 bytes accept an actual empty response",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 10000 },
  async () => {
    const server = createServer((_, response) => response.end(""));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        {
          config: validateQuickTest({
            ...defaultTest,
            url: `http://127.0.0.1:${address.port}/`,
            duration: "1s",
            sleep: 0.05,
            checks: [
              {
                name: "empty string length",
                kind: "bodyLength",
                value: "0",
                path: "",
                enabled: true,
              },
              {
                name: "empty string bytes",
                kind: "bodyBytes",
                value: "0",
                path: "",
                enabled: true,
              },
            ],
            thresholds: { checks: ["rate==1"] },
          }),
        },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.equal(run.metrics.checksFailed, 0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
