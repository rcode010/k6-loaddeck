import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { inspectScenarios, supportsScenarioSelection } from "../src/scripts";
import { K6Runner, discover } from "../src/runner";
import { compareRuns } from "../src/comparison";

test(
  "real existing-script selection preserves source and each selected workload",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 10000 },
  async () => {
    const counts = new Map<string, number>();
    const server = createServer((request, response) => {
      counts.set(request.url!, (counts.get(request.url!) ?? 0) + 1);
      response.end("ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-selection-"));
    try {
      const file = path.join(directory, "test.js");
      const target = `http://127.0.0.1:${address.port}`;
      const source = `import http from 'k6/http'; export const options = { scenarios: { first: {executor:'shared-iterations',vus:1,iterations:2,exec:'first'}, second: {executor:'shared-iterations',vus:1,iterations:3,exec:'second'} } }; export function first(){http.get('${target}/first');} export function second(){http.get('${target}/second');}`;
      await writeFile(file, source);
      const binary = process.env.LOADDECK_TEST_K6!;
      const installation = await discover(binary);
      assert.equal(supportsScenarioSelection(installation.version), true);
      assert.equal(supportsScenarioSelection("k6 v1.0.0"), false);
      assert.deepEqual(await inspectScenarios(binary, file), [
        "first",
        "second",
      ]);
      const selected = await new K6Runner().run(
        binary,
        installation.version,
        () => undefined,
        { script: file, scenarios: ["second"] },
      );
      assert.equal(selected.state, "completed", selected.logs.join("\n"));
      assert.equal(counts.get("/first"), undefined);
      assert.equal(counts.get("/second"), 3);
      const all = await new K6Runner().run(
        binary,
        installation.version,
        () => undefined,
        { script: file },
      );
      assert.equal(all.state, "completed", all.logs.join("\n"));
      assert.equal(counts.get("/first"), 2);
      assert.equal(counts.get("/second"), 6);
      assert.equal(compareRuns(selected, all).comparable, false);
      assert.equal(await readFile(file, "utf8"), source);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
