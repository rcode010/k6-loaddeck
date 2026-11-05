import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureServer } from "node:http2";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { K6Runner } from "../src/runner";
import { defaultTest } from "../src/model";

test(
  "real HTTP/2 negotiation and mutual TLS",
  {
    skip: !process.env.LOADDECK_TEST_K6 || process.platform === "win32",
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-tls-"));
    try {
      const keyFile = path.join(directory, "key.pem"),
        certFile = path.join(directory, "cert.pem");
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
