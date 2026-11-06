import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { defaultTest } from "../src/model";
import { generateScript } from "../src/generator";
import { discover, K6Runner } from "../src/runner";

test(
  "real k6 secret-source injection authenticates requests and redacts console output",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 10000 },
  async () => {
    const token = "Bearer local-token=with-equals";
    let authenticated = 0;
    const server = createServer((request, response) => {
      const authorized = request.headers.authorization === token;
      if (authorized) authenticated++;
      response.writeHead(authorized ? 200 : 401);
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-secret-fixture-"),
    );
    try {
      const config = {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        duration: "1s",
        sleep: 0.1,
        expectedStatus: 200,
        headers: { Authorization: "${LD_TOKEN}" },
        thresholds: { checks: ["rate==1"] },
      };
      const binary = process.env.LOADDECK_TEST_K6!;
      const installation = await discover(binary);
      const run = await new K6Runner().run(
        binary,
        installation.version,
        () => undefined,
        { config, environment: { LD_TOKEN: token } },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.equal(run.credentialSource, "k6-secret-source");
      assert.ok(authenticated > 0);
      assert.ok(!JSON.stringify(run).includes(token));
      const source = generateScript(config, ["LD_TOKEN"]).replace(
        "await loadProtected();",
        "await loadProtected(); console.log(required('LD_TOKEN'));",
      );
      assert.ok(!source.includes(token));
      const file = path.join(directory, "test.js"),
        secrets = path.join(directory, "secrets.txt");
      await writeFile(file, source, { mode: 0o600 });
      await writeFile(secrets, `LD_TOKEN=${token}`, { mode: 0o600 });
      const result = await promisify(execFile)(
        binary,
        ["run", "--secret-source", `file=${secrets}`, file],
        {
          timeout: 5000,
          env: {
            ...process.env,
            K6_NO_USAGE_REPORT: "true",
            LOADDECK_SUMMARY: path.join(directory, "summary.json"),
            LD_TOKEN: undefined,
          },
        },
      );
      const output = result.stdout + result.stderr;
      assert.ok(!output.includes(token));
      assert.ok(output.includes("SECRET_REDACTED"));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
