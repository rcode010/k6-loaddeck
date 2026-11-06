import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultTest, type QuickTest } from "../src/model";
import { K6Runner } from "../src/runner";
import { validateQuickTest } from "../src/definition";
import { protoMethods } from "../src/proto";

test("schema discovery exposes only declared unary gRPC methods", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-schema-"));
  try {
    const file = path.join(directory, "echo.proto");
    await writeFile(
      file,
      'syntax="proto3"; package fixture; message Message { string text=1; } service Echo { rpc Send(Message) returns (Message); rpc Stream(stream Message) returns (stream Message); }',
    );
    assert.deepEqual(await protoMethods(file), ["fixture.Echo/Send"]);
    await assert.rejects(() =>
      protoMethods(path.join(directory, "missing.proto")),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "real HTTP redirect/timeout controls and scheduled WebSocket receive deadlines",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 15000 },
  async () => {
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/ok" });
        response.end();
      } else if (request.url === "/slow")
        setTimeout(() => response.end("ok"), 100);
      else response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const ws = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => ws.once("listening", resolve));
    ws.on("connection", (socket) =>
      socket.on("message", (message) => socket.send(message.toString())),
    );
    const wsAddress = ws.address();
    assert.ok(wsAddress && typeof wsAddress === "object");
    const base: QuickTest = {
      ...defaultTest,
      url: `http://127.0.0.1:${address.port}/redirect`,
      duration: "1s",
      sleep: 0.1,
      expectedStatus: 302,
      thresholds: { checks: ["rate==1"] },
      protocol: {
        kind: "http",
        redirects: 0,
        timeout: "1s",
        message: "",
        sessionMs: 1000,
        grpcMethod: "",
        protoFile: "",
        importPaths: [],
        plaintext: true,
      },
    };
    const run = (config: QuickTest) =>
      new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(config) },
      );
    try {
      assert.equal((await run(base)).state, "completed");
      assert.equal(
        (
          await run({
            ...base,
            url: `http://127.0.0.1:${address.port}/slow`,
            expectedStatus: 200,
            protocol: { ...base.protocol!, timeout: "20ms" },
          })
        ).state,
        "threshold_failed",
      );
      const socket: QuickTest = {
        ...base,
        url: `ws://127.0.0.1:${wsAddress.port}/`,
        expectedStatus: undefined,
        protocol: {
          ...base.protocol!,
          kind: "ws",
          messages: [
            { text: "first", delayMs: 0 },
            { text: "second", delayMs: 150 },
          ],
          sessionMs: 250,
          expectedMessages: 2,
          receiveDeadlineMs: 225,
        },
      };
      assert.equal((await run(socket)).state, "completed");
      const late = await run({
        ...socket,
        protocol: { ...socket.protocol!, receiveDeadlineMs: 100 },
      });
      assert.equal(late.state, "threshold_failed", late.logs.join("\n"));
      assert.ok(
        late.checkResults?.some(
          (check) =>
            check.name === "WebSocket receive expectation" && check.fails > 0,
        ),
      );
    } finally {
      for (const socket of ws.clients) socket.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
