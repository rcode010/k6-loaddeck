import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { defaultTest } from "../src/model";
import { K6Runner } from "../src/runner";
import { validateQuickTest } from "../src/definition";

test(
  "real NTLMv2 HTTP handshake verifies the protected password proof",
  {
    skip: !process.env.LOADDECK_TEST_K6 || process.platform === "win32",
    timeout: 10000,
  },
  async () => {
    const password = "local-ntlm-password";
    const hash = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        "openssl",
        ["dgst", "-md4", "-binary", "-provider", "legacy"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks))
          : reject(new Error("OpenSSL legacy MD4 fixture unavailable")),
      );
      child.stdin.end(Buffer.from(password, "utf16le"));
    });
    const nonce = randomBytes(8);
    const domain = Buffer.from("FIXTURE", "utf16le");
    const av = Buffer.alloc(4 + domain.length + 4);
    av.writeUInt16LE(2, 0);
    av.writeUInt16LE(domain.length, 2);
    domain.copy(av, 4);
    const challenge = Buffer.alloc(48 + domain.length + av.length);
    challenge.write("NTLMSSP\0", 0, "ascii");
    challenge.writeUInt32LE(2, 8);
    challenge.writeUInt16LE(domain.length, 12);
    challenge.writeUInt16LE(domain.length, 14);
    challenge.writeUInt32LE(48, 16);
    challenge.writeUInt32LE(0xa0888205, 20);
    nonce.copy(challenge, 24);
    challenge.writeUInt16LE(av.length, 40);
    challenge.writeUInt16LE(av.length, 42);
    challenge.writeUInt32LE(48 + domain.length, 44);
    domain.copy(challenge, 48);
    av.copy(challenge, 48 + domain.length);
    let authenticated = 0;
    const server = createServer((request, response) => {
      const token = request.headers.authorization?.split(" ")[1];
      const message = token ? Buffer.from(token, "base64") : undefined;
      const type =
        message &&
        message.length > 12 &&
        message.subarray(0, 8).toString("ascii") === "NTLMSSP\0"
          ? message.readUInt32LE(8)
          : 0;
      if (type === 1) {
        response.writeHead(401, {
          "WWW-Authenticate": `NTLM ${challenge.toString("base64")}`,
        });
        response.end();
        return;
      }
      if (type === 3 && message && message.length >= 64) {
        const field = (offset: number) =>
          message.subarray(
            message.readUInt32LE(offset + 4),
            message.readUInt32LE(offset + 4) + message.readUInt16LE(offset),
          );
        const user = field(36).toString("utf16le");
        const userDomain = field(28).toString("utf16le");
        const nt = field(20);
        const key = createHmac("md5", hash)
          .update(Buffer.from(user.toUpperCase() + userDomain, "utf16le"))
          .digest();
        const proof = createHmac("md5", key)
          .update(Buffer.concat([nonce, nt.subarray(16)]))
          .digest();
        if (
          user === "tester" &&
          nt.length >= 32 &&
          timingSafeEqual(proof, nt.subarray(0, 16))
        ) {
          authenticated++;
          response.end("ok");
          return;
        }
      }
      response.writeHead(401, { "WWW-Authenticate": "NTLM" });
      response.end();
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
          config: validateQuickTest({
            ...defaultTest,
            url: `http://127.0.0.1:${address.port}/`,
            duration: "1s",
            sleep: 0.1,
            expectedStatus: 200,
            thresholds: { checks: ["rate==1"] },
            authentication: {
              mode: "ntlm",
              usernameVariable: "NTLM_USER",
              secretVariable: "NTLM_PASSWORD",
              keyName: "",
              placement: "header",
              tokenUrl: "",
              scope: "",
              audience: "",
              certificateVariable: "",
              privateKeyVariable: "",
            },
          }),
          environment: {
            NTLM_USER: "FIXTURE\\tester",
            NTLM_PASSWORD: password,
          },
        },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.ok(authenticated > 0);
      assert.ok(!JSON.stringify(run).includes(password));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
