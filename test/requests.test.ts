import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultTest, type QuickTest } from "../src/model";
import { K6Runner } from "../src/runner";
import { validateQuickTest } from "../src/definition";

test(
  "real form encoding, multipart upload, runtime query and Digest authentication",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 30000 },
  async () => {
    const token = "local-fixture-password";
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-requests-"));
    const file = path.join(directory, "payload.txt");
    await writeFile(file, "upload fixture");
    const md5 = (value: string) =>
      createHash("md5").update(value).digest("hex");
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        let valid = false;
        if (request.url === "/form")
          valid =
            body === "name=Alice" &&
            Boolean(
              request.headers["content-type"]?.includes(
                "application/x-www-form-urlencoded",
              ),
            );
        if (request.url === "/multipart")
          valid =
            body.includes("upload fixture") &&
            body.includes('name="file"') &&
            Boolean(
              request.headers["content-type"]?.includes("multipart/form-data"),
            );
        if (request.url?.startsWith("/query"))
          valid =
            new URL(request.url, "http://localhost").searchParams.get(
              "token",
            ) === token;
        if (request.url === "/digest") {
          const parts = Object.fromEntries(
            [
              ...String(request.headers.authorization ?? "").matchAll(
                /(\w+)=(?:"([^"]*)"|([^, ]+))/g,
              ),
            ].map((m) => [m[1], m[2] ?? m[3]]),
          );
          const ha1 = md5(`user:LoadDeck:${token}`),
            ha2 = md5(`${request.method}:${parts.uri}`);
          const expected = md5(
            `${ha1}:fixture-nonce:${parts.nc}:${parts.cnonce}:${parts.qop}:${ha2}`,
          );
          valid = parts.username === "user" && parts.response === expected;
          if (!valid)
            response.setHeader(
              "WWW-Authenticate",
              'Digest realm="LoadDeck", nonce="fixture-nonce", qop="auth", algorithm=MD5',
            );
        }
        response.statusCode = valid ? 200 : 401;
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const target = `http://127.0.0.1:${address.port}`;
    const base = {
      ...defaultTest,
      duration: "1s",
      sleep: 0.1,
      expectedStatus: 200,
      thresholds: { checks: ["rate==1"] },
    };
    const configs: QuickTest[] = [
      {
        ...base,
        url: `${target}/form`,
        method: "POST",
        bodyMode: "form",
        body: '{"name":"Alice"}',
      },
      {
        ...base,
        url: `${target}/multipart`,
        method: "POST",
        bodyMode: "multipart",
        body: "{}",
        upload: {
          path: file,
          field: "file",
          filename: "payload.txt",
          contentType: "text/plain",
        },
      },
      { ...base, url: target + "/query?token=${LD_SECRET}" },
      {
        ...base,
        url: `${target}/digest`,
        authentication: {
          mode: "digest",
          usernameVariable: "LD_USER",
          secretVariable: "LD_SECRET",
          keyName: "",
          placement: "header",
          tokenUrl: "",
          scope: "",
          audience: "",
          certificateVariable: "",
          privateKeyVariable: "",
        },
      },
    ];
    try {
      for (const config of configs) {
        const run = await new K6Runner().run(
          process.env.LOADDECK_TEST_K6!,
          "fixture",
          () => undefined,
          {
            config: validateQuickTest(config),
            environment: { LD_USER: "user", LD_SECRET: token },
          },
        );
        assert.equal(run.state, "completed", run.logs.join("\n"));
        assert.ok(!JSON.stringify(run).includes(token));
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
