import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultTest, type QuickTest } from "../src/model";
import { K6Runner } from "../src/runner";
import { validateQuickTest, generateScript } from "../src/definition";
import { parseCsv } from "../src/integrations";
import { exportRun } from "../src/reports";

const binary = process.env.LOADDECK_TEST_K6;
test("CSV handles quoted commas, newlines and escaped quotes", () => {
  assert.deepEqual(
    parseCsv('name,note\r\nAlice,"a,b"\r\nBob,"two\nlines"\r\n'),
    [
      { name: "Alice", note: "a,b" },
      { name: "Bob", note: "two\nlines" },
    ],
  );
  assert.throws(() => parseCsv("a,a\n1,2"));
  assert.throws(() => parseCsv('a\n"unclosed'));
});
test(
  "real WebSocket and unary gRPC builders",
  { skip: !binary, timeout: 30000 },
  async () => {
    const websocket = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => websocket.once("listening", resolve));
    websocket.on("connection", (socket) =>
      socket.on("message", (data) => socket.send(data.toString())),
    );
    const address = websocket.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-protocol-"));
    const proto = path.join(directory, "echo.proto");
    await writeFile(
      proto,
      'syntax = "proto3"; package fixture; service Echo { rpc Send (Message) returns (Message); } message Message { string text = 1; }',
    );
    const definition = grpc.loadPackageDefinition(
      loadSync(proto),
    ) as unknown as { fixture: { Echo: { service: grpc.ServiceDefinition } } };
    const server = new grpc.Server();
    server.addService(definition.fixture.Echo.service, {
      Send: (
        call: grpc.ServerUnaryCall<{ text: string }, { text: string }>,
        callback: grpc.sendUnaryData<{ text: string }>,
      ) => callback(null, call.request),
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        "127.0.0.1:0",
        grpc.ServerCredentials.createInsecure(),
        (error, port) => (error ? reject(error) : resolve(port)),
      ),
    );
    try {
      const wsConfig: QuickTest = {
        ...defaultTest,
        url: `ws://127.0.0.1:${address.port}/`,
        duration: "1s",
        sleep: 0,
        protocol: {
          kind: "ws",
          message: "hello",
          sessionMs: 200,
          grpcMethod: "",
          protoFile: "",
          importPaths: [],
          plaintext: true,
        },
        checks: [
          {
            name: "echo received",
            kind: "messageContains",
            value: "hello",
            path: "",
            enabled: true,
          },
        ],
      };
      const wsRun = await new K6Runner().run(
        binary!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(wsConfig) },
      );
      assert.equal(wsRun.state, "completed", wsRun.logs.join("\n"));
      assert.ok(wsRun.metrics.checksPassed! > 0);
      assert.ok(
        Object.keys(wsRun.protocolMetrics ?? {}).some((k) =>
          k.startsWith("ws_"),
        ),
      );
      const grpcConfig: QuickTest = {
        ...defaultTest,
        url: `grpc://127.0.0.1:${port}`,
        duration: "1s",
        sleep: 0.1,
        protocol: {
          kind: "grpc",
          message: '{"text":"hello"}',
          sessionMs: 1000,
          grpcMethod: "fixture.Echo/Send",
          protoFile: proto,
          importPaths: [],
          plaintext: true,
        },
        checks: [
          {
            name: "status OK",
            kind: "grpcStatus",
            value: "0",
            path: "",
            enabled: true,
          },
          {
            name: "response text",
            kind: "jsonEquals",
            value: '"hello"',
            path: "text",
            enabled: true,
          },
        ],
      };
      const grpcRun = await new K6Runner().run(
        binary!,
        "fixture",
        () => undefined,
        { config: validateQuickTest(grpcConfig) },
      );
      assert.equal(grpcRun.state, "completed", grpcRun.logs.join("\n"));
      assert.ok(grpcRun.metrics.checksPassed! > 0);
      assert.equal(
        grpcRun.metrics.checksFailed,
        0,
        JSON.stringify(grpcRun.checkResults) + grpcRun.logs.join("\n"),
      );
      assert.ok(
        Object.keys(grpcRun.protocolMetrics ?? {}).some((k) =>
          k.startsWith("grpc_"),
        ),
      );
    } finally {
      for (const socket of websocket.clients) socket.terminate();
      await new Promise<void>((resolve) => websocket.close(() => resolve()));
      server.forceShutdown();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test(
  "real Basic, Bearer, API key, cookies, OAuth, datasets and concurrent outputs",
  { skip: !binary, timeout: 60000 },
  async () => {
    const token = "fixture-secret-value";
    const seen: string[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        const pathname = request.url!.split("?")[0];
        if (pathname === "/token") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ access_token: token, expires_in: 60 }));
          return;
        }
        const valid =
          pathname === "/basic"
            ? request.headers.authorization ===
              `Basic ${Buffer.from(`user:${token}`).toString("base64")}`
            : pathname === "/key"
              ? request.headers["x-api-key"] === token
              : pathname === "/cookie"
                ? request.headers.cookie === `session=${token}`
                : pathname === "/data"
                  ? true
                  : request.headers.authorization === `Bearer ${token}`;
        if (pathname === "/data") seen.push(body);
        response.statusCode = valid ? 200 : 401;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: valid }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const target = `http://127.0.0.1:${address.port}`;
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-auth-"));
    const auth = {
      mode: "bearer" as const,
      usernameVariable: "LD_USER",
      secretVariable: "LD_SECRET",
      keyName: "X-API-Key",
      placement: "header" as const,
      tokenUrl: `${target}/token`,
      scope: "read",
      audience: "",
      certificateVariable: "LD_CERT",
      privateKeyVariable: "LD_KEY",
    };
    try {
      for (const mode of [
        "basic",
        "bearer",
        "apiKey",
        "cookie",
        "oauth2",
      ] as const) {
        const endpoint =
          mode === "apiKey" ? "key" : mode === "oauth2" ? "bearer" : mode;
        const config: QuickTest = {
          ...defaultTest,
          url: `${target}/${endpoint}`,
          duration: "1s",
          sleep: 0.1,
          expectedStatus: 200,
          thresholds: { checks: ["rate==1"] },
          authentication: {
            ...auth,
            mode,
            keyName: mode === "cookie" ? "session" : "X-API-Key",
          },
        };
        const run = await new K6Runner().run(
          binary!,
          "fixture",
          () => undefined,
          {
            config: validateQuickTest(config),
            environment: { LD_USER: "user", LD_SECRET: token },
          },
        );
        assert.equal(run.state, "completed", `${mode}: ${run.logs.join("\n")}`);
        assert.ok(!generateScript(config).includes(token));
        assert.ok(!JSON.stringify(run).includes(token));
      }
      for (const format of ["json", "csv"] as const) {
        const dataset = path.join(directory, `rows.${format}`);
        await writeFile(
          dataset,
          format === "json"
            ? '[{"name":"Alice"},{"name":"Bob"}]'
            : "name\nAlice\nBob\n",
        );
        const jsonOutput = path.join(directory, `${format}-points.json`),
          csvOutput = path.join(directory, `${format}-points.csv`);
        const config: QuickTest = {
          ...defaultTest,
          url: `${target}/data`,
          method: "POST",
          bodyMode: "json",
          body: '{"name":"{{name}}"}',
          duration: "1s",
          sleep: 0.1,
          dataset: {
            file: dataset,
            format,
            strategy: "round-robin",
            exhaustion: "repeat",
            variables: {},
          },
          outputs: [
            { format: "json", path: jsonOutput },
            { format: "csv", path: csvOutput },
          ],
        };
        const run = await new K6Runner().run(
          binary!,
          "fixture",
          () => undefined,
          { config: validateQuickTest(config) },
        );
        assert.equal(run.state, "completed", run.logs.join("\n"));
        assert.ok(run.metrics.requests! > 0);
        assert.ok((await readFile(jsonOutput, "utf8")).includes("http_reqs"));
        assert.ok((await readFile(csvOutput, "utf8")).includes("http_reqs"));
        assert.equal(run.config, undefined);
        assert.ok(exportRun(run, "csv").includes("ms"));
        assert.ok(
          exportRun(
            { ...run, name: "<script>alert(1)</script>" },
            "html",
          ).includes("&lt;script&gt;"),
        );
        assert.ok(!JSON.stringify(run).includes("Alice"));
      }
      assert.ok(seen.some((body) => body.includes("Alice")));
      assert.ok(seen.some((body) => body.includes("Bob")));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
