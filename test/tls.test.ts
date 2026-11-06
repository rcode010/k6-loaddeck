import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureServer } from "node:http2";
import { createServer as createHttpsServer } from "node:https";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { WebSocketServer } from "ws";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { K6Runner } from "../src/runner";
import { defaultTest } from "../src/model";
import type { QuickTest } from "../src/model";
import { validateQuickTest } from "../src/definition";

test(
  "real HTTP/2 negotiation and mutual TLS",
  {
    skip:
      !process.env.LOADDECK_TEST_K6 ||
      process.platform === "win32" ||
      (process.platform === "darwin" &&
        process.env.LOADDECK_TEST_SYSTEM_CA !== "1"),
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-tls-"));
    let trusted = false;
    let certificateFingerprint = "";
    const certFile = path.join(directory, "cert.pem");
    try {
      const keyFile = path.join(directory, "key.pem");
      await promisify(execFile)("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyFile,
        "-out",
        certFile,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ]);
      const cert = await readFile(certFile, "utf8"),
        key = await readFile(keyFile, "utf8");
      if (process.platform === "darwin") {
        const result = await promisify(execFile)("openssl", [
          "x509",
          "-in",
          certFile,
          "-noout",
          "-fingerprint",
          "-sha1",
        ]);
        certificateFingerprint = result.stdout
          .split("=")[1]!
          .replaceAll(":", "")
          .trim();
        await promisify(execFile)(
          "sudo",
          [
            "-n",
            "security",
            "add-trusted-cert",
            "-d",
            "-r",
            "trustRoot",
            "-k",
            "/Library/Keychains/System.keychain",
            certFile,
          ],
          { timeout: 10000 },
        );
        trusted = true;
      }
      const server = createSecureServer({
        key,
        cert,
        ca: cert,
        requestCert: true,
        rejectUnauthorized: true,
        allowHTTP1: true,
      });
      let negotiated = false,
        authorized = false;
      server.on("request", (request, response) => {
        negotiated ||= request.httpVersion === "2.0";
        authorized ||=
          "authorized" in request.socket && request.socket.authorized === true;
        response.end("ok");
      });
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
            config: {
              ...defaultTest,
              url: `https://127.0.0.1:${address.port}/`,
              duration: "1s",
              sleep: 0.1,
              expectedStatus: 200,
              thresholds: { checks: ["rate==1"] },
              protocol: {
                kind: "http2",
                message: "",
                sessionMs: 1000,
                grpcMethod: "",
                protoFile: "",
                importPaths: [],
                plaintext: false,
              },
              authentication: {
                mode: "mtls",
                usernameVariable: "",
                secretVariable: "",
                keyName: "",
                placement: "header",
                tokenUrl: "",
                scope: "",
                audience: "",
                certificateVariable: "LD_CERT",
                privateKeyVariable: "LD_KEY",
              },
            },
            environment: {
              LD_CERT: cert,
              LD_KEY: key,
              SSL_CERT_FILE: certFile,
            },
          },
        );
        assert.equal(run.state, "completed", run.logs.join("\n"));
        assert.equal(negotiated, true);
        assert.equal(authorized, true);
        assert.ok(!JSON.stringify(run).includes("BEGIN PRIVATE KEY"));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      const socketServer = createHttpsServer({
        key,
        cert,
        ca: cert,
        requestCert: true,
        rejectUnauthorized: true,
      });
      const websocket = new WebSocketServer({ server: socketServer });
      let wsAuthorized = false;
      websocket.on("connection", (socket, request) => {
        wsAuthorized =
          "authorized" in request.socket && request.socket.authorized === true;
        socket.on("message", (message) => socket.send(message.toString()));
      });
      await new Promise<void>((resolve) =>
        socketServer.listen(0, "127.0.0.1", resolve),
      );
      const wsAddress = socketServer.address();
      assert.ok(wsAddress && typeof wsAddress === "object");
      const proto = path.join(directory, "echo.proto");
      await writeFile(
        proto,
        'syntax="proto3"; package fixture; message Message { string text=1; } service Echo { rpc Send(Message) returns(Message); }',
      );
      const definition = grpc.loadPackageDefinition(
        loadSync(proto),
      ) as unknown as {
        fixture: { Echo: { service: grpc.ServiceDefinition } };
      };
      const rpc = new grpc.Server();
      rpc.addService(definition.fixture.Echo.service, {
        Send: (
          call: grpc.ServerUnaryCall<{ text: string }, { text: string }>,
          callback: grpc.sendUnaryData<{ text: string }>,
        ) => callback(null, call.request),
      });
      const rpcPort = await new Promise<number>((resolve, reject) =>
        rpc.bindAsync(
          "127.0.0.1:0",
          grpc.ServerCredentials.createSsl(
            Buffer.from(cert),
            [{ private_key: Buffer.from(key), cert_chain: Buffer.from(cert) }],
            true,
          ),
          (error, port) => (error ? reject(error) : resolve(port)),
        ),
      );
      const base: QuickTest = {
        ...defaultTest,
        url: `wss://127.0.0.1:${wsAddress.port}/`,
        duration: "1s",
        sleep: 0.1,
        protocol: {
          kind: "ws",
          message: "hello",
          sessionMs: 100,
          expectedMessages: 1,
          grpcMethod: "",
          protoFile: "",
          importPaths: [],
          plaintext: false,
        },
        authentication: {
          mode: "mtls",
          usernameVariable: "",
          secretVariable: "",
          keyName: "",
          placement: "header",
          tokenUrl: "",
          scope: "",
          audience: "",
          certificateVariable: "LD_CERT",
          privateKeyVariable: "LD_KEY",
        },
        thresholds: { checks: ["rate==1"] },
      };
      try {
        for (const config of [
          base,
          {
            ...base,
            url: `grpcs://127.0.0.1:${rpcPort}`,
            protocol: {
              ...base.protocol!,
              kind: "grpc" as const,
              protoFile: proto,
              grpcMethod: "fixture.Echo/Send",
              message: '{"text":"hello"}',
            },
          },
        ]) {
          const run = await new K6Runner().run(
            process.env.LOADDECK_TEST_K6!,
            "fixture",
            () => undefined,
            {
              config: validateQuickTest(config),
              environment: {
                LD_CERT: cert,
                LD_KEY: key,
                SSL_CERT_FILE: certFile,
              },
            },
          );
          assert.equal(run.state, "completed", run.logs.join("\n"));
          assert.ok((run.metrics.checksPassed ?? 0) > 0);
          assert.ok(!JSON.stringify(run).includes("BEGIN PRIVATE KEY"));
        }
        assert.equal(wsAuthorized, true);
      } finally {
        for (const socket of websocket.clients) socket.terminate();
        await new Promise<void>((resolve) => websocket.close(() => resolve()));
        await new Promise<void>((resolve) =>
          socketServer.close(() => resolve()),
        );
        rpc.forceShutdown();
      }
    } finally {
      try {
        if (trusted) {
          await promisify(execFile)(
            "sudo",
            ["-n", "security", "remove-trusted-cert", "-d", certFile],
            { timeout: 10000 },
          );
          await promisify(execFile)(
            "sudo",
            [
              "-n",
              "security",
              "delete-certificate",
              "-Z",
              certificateFingerprint,
              "/Library/Keychains/System.keychain",
            ],
            { timeout: 10000 },
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
