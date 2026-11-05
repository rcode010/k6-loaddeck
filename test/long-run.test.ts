import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { defaultTest } from "../src/model";
import { K6Runner } from "../src/runner";

test(
  "30-second real load test streams bounded metrics throughout execution",
  {
    skip: !process.env.LOADDECK_TEST_K6 || !process.env.LOADDECK_TEST_LONG,
    timeout: 45000,
  },
  async () => {
    const server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    let updates = 0;
    try {
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        (value) => {
          if (value.state === "running" && value.series.length) updates++;
        },
        {
          config: {
            ...defaultTest,
            url: `http://127.0.0.1:${address.port}/`,
            testKind: "load",
            vus: 2,
            duration: "30s",
            sleep: 0.1,
          },
        },
      );
      assert.equal(run.state, "completed", run.logs.join("\n"));
      assert.ok(updates >= 25);
      assert.ok(run.elapsedMs >= 30000);
      assert.ok(run.series.length <= 600);
      assert.ok(run.metrics.requests! > 100);
      assert.ok(run.metrics.p95 !== undefined);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
