import { LogBuffer } from "../src/logs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultTest } from "../src/model";
import {
  generateScript,
  safeConfig,
  safeTarget,
  validateQuickTest,
  durationSeconds,
} from "../src/definition";
import { Aggregator, JsonLines, readSummary } from "../src/metrics";
import { redactLog } from "../src/runner";
import { defaultScenario } from "../src/workload";
import type { Authentication, ProtocolConfig } from "../src/integrations";

test("scenario targets validate protocol families and protected query values", () => {
  const valid = { ...defaultTest, url: "http://localhost/" };
  const scenario = defaultScenario(valid);
  assert.doesNotThrow(() =>
    validateQuickTest({
      ...valid,
      scenarios: [{ ...scenario, url: "https://localhost/" }],
    }),
  );
  for (const url of [
    "https://localhost/?token=literal-secret",
    "https://user:pass@localhost/",
    "file:///tmp/test",
    "ws://localhost/",
  ])
    assert.throws(() =>
      validateQuickTest({ ...valid, scenarios: [{ ...scenario, url }] }),
    );
  assert.doesNotThrow(() =>
    validateQuickTest({
      ...valid,
      scenarios: [
        { ...scenario, url: "https://localhost/?token=${API_TOKEN}" },
      ],
    }),
  );
  const protocol: ProtocolConfig = {
    kind: "ws",
    message: "hello",
    sessionMs: 100,
    grpcMethod: "",
    protoFile: "",
    importPaths: [],
    plaintext: true,
  };
  const websocket = { ...valid, url: "ws://localhost/", protocol };
  assert.doesNotThrow(() =>
    validateQuickTest({
      ...websocket,
      scenarios: [{ ...scenario, url: "wss://localhost/" }],
    }),
  );
  const authentication: Authentication = {
    mode: "digest",
    usernameVariable: "USER",
    secretVariable: "PASSWORD",
    keyName: "",
    placement: "header",
    tokenUrl: "",
    scope: "",
    audience: "",
    certificateVariable: "",
    privateKeyVariable: "",
  };
  assert.throws(
    () => validateQuickTest({ ...websocket, authentication }),
    /Digest.*HTTP/,
  );
});

test("request validation rejects unsafe input and accepts JSON POST", () => {
  const valid = { ...defaultTest, url: "http://127.0.0.1:8080" };
  assert.equal(validateQuickTest(valid).method, "GET");
  for (const patch of [
    { url: "file:///etc/passwd" },
    { url: "https://user:pass@example.com" },
    { url: "http://{{host}}/" },
    { url: "http://${HOST}/" },
    { vus: 0 },
    { duration: "tomorrow" },
    { method: "BOGUS" },
    { headers: { Authorization: "literal-secret" } },
    { thresholds: { http_req_failed: ["p(95)<3"] } },
  ])
    assert.throws(() => validateQuickTest({ ...valid, ...patch }));
  assert.equal(
    validateQuickTest({
      ...valid,
      method: "POST",
      bodyMode: "json",
      body: '{"a":1}',
    }).bodyMode,
    "json",
  );
  assert.throws(() =>
    validateQuickTest({
      ...valid,
      method: "POST",
      bodyMode: "json",
      body: "{",
    }),
  );
  assert.equal(durationSeconds("1m30s"), 90);
});
test("generator serializes input without executable interpolation or comments", () => {
  const script = generateScript({
    ...defaultTest,
    url: "http://localhost/",
    method: "POST",
    body: '"; throw new Error("injected");',
    headers: { Authorization: "${API_TOKEN}" },
    expectedStatus: 200,
  });
  assert.ok(script.includes('required("API_TOKEN")'));
  assert.ok(script.includes(JSON.stringify('"; throw new Error("injected");')));
  assert.ok(script.includes("handleSummary"));
});
test("history excludes query, header and body configurations", () => {
  assert.equal(
    safeTarget("https://a:b@example.com/path?token=abc#secret"),
    "https://example.com/path",
  );
  assert.equal(
    safeConfig({ ...defaultTest, url: "http://localhost/?token=abc" }),
    undefined,
  );
  assert.equal(
    safeConfig({ ...defaultTest, url: "http://localhost/", body: "private" }),
    undefined,
  );
});
test("JSON parser buffers partial lines and rejects malformed records", () => {
  const parser = new JsonLines();
  const values: unknown[] = [];
  parser.push('{"type":', (v) => values.push(v));
  parser.push('"Metric"}\ninvalid\n{"ok":true}\n', (v) => values.push(v));
  assert.equal(values.length, 2);
  assert.equal(parser.malformed, 1);
});
test("aggregator keeps bounded buckets and never invents percentiles", () => {
  const collector = new Aggregator(0);
  for (let i = 0; i < 2000; i++)
    collector.add({
      type: "Point",
      metric: "http_req_duration",
      data: { value: 10, time: new Date(i * 1000).toISOString() },
    });
  const snapshot = collector.snapshot(2000000);
  assert.equal(snapshot.metrics.avg, 10);
  assert.equal(snapshot.metrics.p95, undefined);
  assert.ok(snapshot.series.length <= 600);
});
test("summary adapter uses authoritative percentile and threshold outcomes", () => {
  const result = readSummary({
    metrics: {
      http_req_duration: {
        values: { avg: 4, "p(95)": 8, "p(99)": 9 },
        thresholds: { "p(95)<5": { ok: false } },
      },
    },
  });
  assert.equal(result.metrics.p95, 8);
  assert.equal(result.thresholds[0]?.ok, false);
  assert.equal(result.metrics.failureRate, undefined);
});
test("logs redact environment secrets and URL queries", () => {
  const output = redactLog("Bearer abc123 https://example.com/?token=abc123", [
    "abc123",
  ]);
  assert.ok(!output.includes("abc123"));
  assert.ok(!output.includes("?token"));
  assert.ok(
    !redactLog("wss://user:private@localhost/path?token=private").includes(
      "private",
    ),
  );
});

test("streaming logs redact split credentials and omit oversized records", () => {
  const lines: string[] = [];
  const logs = new LogBuffer((line) =>
    lines.push(redactLog(line, ["secret-token"])),
  );
  logs.write(Buffer.from("Bearer secret-"));
  assert.equal(lines.length, 0);
  logs.write(Buffer.from("token\nnext\n"));
  logs.end();
  assert.ok(!lines.join("").includes("secret-token"));
  assert.ok(lines[0]?.includes("[redacted]"));
  const oversized = new LogBuffer((line) => lines.push(line));
  oversized.write(Buffer.alloc(70000, 120));
  oversized.write(Buffer.from("private remainder\n"));
  oversized.end();
  assert.ok(lines.includes("[Oversized log record omitted]"));
  assert.ok(!lines.join("").includes("private remainder"));
});

test("observed zeros and live protocol counter totals retain their real meaning", () => {
  const collector = new Aggregator(0);
  collector.add({
    type: "Metric",
    metric: "ws_msgs_received",
    data: { type: "counter" },
  });
  for (let i = 0; i < 3; i++)
    collector.add({
      type: "Point",
      metric: "ws_msgs_received",
      data: { value: 1, time: new Date(0).toISOString() },
    });
  collector.add({
    type: "Point",
    metric: "http_reqs",
    data: { value: 0, time: new Date(0).toISOString() },
  });
  const result = collector.snapshot(1000);
  assert.equal(result.protocolMetrics["ws_msgs_received.count"], 3);
  assert.equal(result.metrics.requests, 0);
  assert.equal(result.metrics.rps, 0);
});
