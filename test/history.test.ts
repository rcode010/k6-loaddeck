import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { HistoryStore } from "../src/history";
import type { Run } from "../src/model";

test("history recovers corruption, serializes writes and marks interrupted runs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-storage-"));
  let warnings = 0;
  const run = {
    schemaVersion: 1,
    id: "one",
    startedAt: new Date().toISOString(),
    state: "running",
    metrics: {},
    series: [],
    logs: [],
  } as unknown as Run;
  try {
    await writeFile(path.join(directory, "history-v1.json"), "{broken");
    const store = new HistoryStore(
      directory,
      () => 50,
      () => warnings++,
    );
    assert.deepEqual(await store.list(), []);
    assert.equal(warnings, 1);
    await Promise.all([
      store.save(run),
      store.save({ ...run, id: "two" }),
      store.save({ ...run, id: "three" }),
    ]);
    const list = await store.list();
    assert.equal(list.length, 3);
    assert.ok(list.every((r) => r.state === "execution_failed"));
    assert.ok(
      (await readdir(directory)).some((name) =>
        name.startsWith("history-damaged-"),
      ),
    );
    await store.delete("two");
    assert.equal((await store.list()).length, 2);
    await store.clear();
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
