import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultTest, type Run } from "../src/model";
import { K6Runner, discover } from "../src/runner";
import { HistoryStore } from "../src/history";
import { compareRuns } from "../src/comparison";

const binary = process.env.LOADDECK_TEST_K6;
test(
  "real k6 GET, POST, thresholds, cancellation, persistence and comparison",
  { skip: !binary, timeout: 60000 },
  async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ method: request.method, body }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(
      path.join(tmpdir(), "loaddeck-history-test-"),
    );
    try {
      const installation = await discover(binary!);
      assert.equal(installation.ready, true);
      const runner = new K6Runner();
      let updates = 0;
      const config = {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        duration: "2s",
        sleep: 0.05,
        expectedStatus: 200,
        thresholds: { http_req_duration: ["p(95)<500"] },
      };
      const first = await runner.run(
        binary!,
        installation.version,
        () => updates++,
        { config },
      );
      assert.equal(first.state, "completed", first.logs.join("\n"));
      assert.ok(first.metrics.requests! > 0);
      assert.ok(first.metrics.p95 !== undefined);
      assert.equal(first.summarySource, "k6-summary");
      assert.ok(first.series.length > 0);
      assert.ok(updates > 2);
      assert.equal(first.thresholds[0]?.ok, true);
      const second = await runner.run(
        binary!,
        installation.version,
        () => undefined,
        {
          config: {
            ...config,
            method: "POST",
            bodyMode: "json",
            body: '{"ok":true}',
          },
        },
      );
      assert.equal(second.state, "completed", second.logs.join("\n"));
      assert.ok(second.metrics.checksPassed! > 0);
      const failure = await runner.run(
        binary!,
        installation.version,
        () => undefined,
        {
          config: { ...config, thresholds: { http_req_duration: ["p(95)<0"] } },
        },
      );
      assert.equal(failure.state, "threshold_failed", failure.logs.join("\n"));
      assert.equal(failure.exitCode, 99);
      const cancellation = runner.run(
        binary!,
        installation.version,
        () => undefined,
        { config: { ...config, duration: "20s" } },
      );
      setTimeout(() => runner.stop(), 1200);
      const stopped = await cancellation;
      assert.equal(stopped.state, "cancelled");
      const store = new HistoryStore(
        directory,
        () => 2,
        () => undefined,
      );
      await store.save(first);
      await store.save(second);
      await store.save(failure);
      const reopened = await new HistoryStore(
        directory,
        () => 2,
        () => undefined,
      ).list();
      assert.equal(reopened.length, 2);
      assert.equal(reopened[0]?.id, failure.id);
      assert.ok(reopened[0]?.series.length);
      const comparison = compareRuns(first, {
        ...first,
        id: "candidate",
        metrics: { ...first.metrics, avg: first.metrics.avg! * 2 },
      });
      assert.equal(comparison.rows[0]?.percent, 100);
      assert.equal(compareRuns(first, second).comparable, false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test("comparison rejects different kinds, unrelated scripts, missing values and handles zero baseline", () => {
  const run = {
    id: "a",
    testKind: "smoke",
    fingerprint: "same",
    state: "completed",
    metrics: { requests: 0, failureRate: 0, avg: 10 },
  } as Run;
  const other = {
    ...run,
    id: "b",
    metrics: { requests: 10, failureRate: 0.1, avg: 5 },
  };
  const comparison = compareRuns(run, other);
  assert.equal(
    comparison.rows.find((r) => r.key === "failureRate")?.percent,
    undefined,
  );
  assert.equal(comparison.rows[0]?.interpretation, "Improved");
  assert.throws(() => compareRuns(run, { ...other, testKind: "load" }));
  assert.throws(() =>
    compareRuns(
      { ...run, testKind: "custom" },
      { ...other, testKind: "custom" },
    ),
  );
  assert.throws(() =>
    compareRuns({ ...run, metrics: {} }, { ...other, metrics: {} }),
  );
  assert.equal(
    compareRuns(run, { ...other, fingerprint: "different" }).rows[0]
      ?.interpretation,
    "Context only",
  );
});
