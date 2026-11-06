import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { defaultTest } from "../src/model";
import { defaultScenario } from "../src/workload";
import { requestConfig } from "../src/requests";
import { savedScript } from "../src/saved-script";
import { K6Runner } from "../src/runner";

test(
  "saved scripts retain copied datasets and imported schemas after originals disappear",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 10000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-portable-"));
    const source = path.join(directory, "source"),
      output = path.join(directory, "output");
    await mkdir(source);
    await mkdir(output);
    const dataset = path.join(source, "rows.json"),
      proto = path.join(source, "echo.proto");
    await writeFile(dataset, '[{"id":42}]');
    await writeFile(
      path.join(source, "common.proto"),
      'syntax="proto3"; package fixture; message Message { string text=1; }',
    );
    await writeFile(
      proto,
      'syntax="proto3"; package fixture; import "common.proto"; service Echo { rpc Send(Message) returns(Message); }',
    );
    const definition = grpc.loadPackageDefinition(
      loadSync(proto),
    ) as unknown as { fixture: { Echo: { service: grpc.ServiceDefinition } } };
    const rpc = new grpc.Server();
    let calls = 0;
    rpc.addService(definition.fixture.Echo.service, {
      Send: (
        call: grpc.ServerUnaryCall<{ text: string }, { text: string }>,
        callback: grpc.sendUnaryData<{ text: string }>,
      ) => {
        calls++;
        callback(null, call.request);
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      rpc.bindAsync(
        "127.0.0.1:0",
        grpc.ServerCredentials.createInsecure(),
        (error, port) => (error ? reject(error) : resolve(port)),
      ),
    );
    let posts = 0;
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        if (JSON.parse(body).id === 42) posts++;
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    try {
      const base = {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        duration: "1s",
        method: "POST",
        bodyMode: "json" as const,
        body: '{"id":"{{id}}"}',
        sleep: 0.1,
        expectedStatus: 200,
        dataset: {
          file: dataset,
          format: "json" as const,
          strategy: "round-robin" as const,
          exhaustion: "repeat" as const,
          variables: {},
        },
        thresholds: { checks: ["rate==1"] },
      };
      const rpcRequest = {
        ...defaultTest,
        url: `grpc://127.0.0.1:${port}`,
        duration: "1s",
        sleep: 0.1,
        protocol: {
          kind: "grpc" as const,
          protoFile: proto,
          importPaths: [],
          grpcMethod: "fixture.Echo/Send",
          message: '{"text":"hello"}',
          sessionMs: 1000,
          plaintext: true,
        },
      };
      const config = {
        ...base,
        scenarios: [
          { ...defaultScenario(base), name: "http" },
          {
            ...defaultScenario(base),
            name: "rpc",
            request: requestConfig(rpcRequest),
          },
        ],
      };
      const file = path.join(output, "test.js");
      const bundle = await savedScript(config, file);
      assert.ok(bundle.assets);
      assert.ok(!bundle.source.includes(source));
      await writeFile(file, bundle.source);
      await rm(source, { recursive: true, force: true });
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { script: file },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.ok(posts > 0);
      assert.ok(calls > 0);
      assert.equal(run.metrics.checksFailed, 0);
    } finally {
      rpc.forceShutdown();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
