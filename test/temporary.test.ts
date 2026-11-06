import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  recoverTemporaryRuns,
  runDirectory,
  recordEngine,
} from "../src/temporary";

test("temporary recovery removes only marked old runs whose host and engine are gone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "loaddeck-recovery-fixture-"));
  try {
    const orphan = await runDirectory(root);
    await writeFile(
      path.join(orphan, "owner.json"),
      JSON.stringify({
        schemaVersion: 1,
        hostPid: 2147483647,
        enginePid: 2147483647,
        createdAt: 0,
      }),
    );
    await writeFile(path.join(orphan, "secrets.txt"), "private");
    const live = await runDirectory(root);
    await recordEngine(live, process.pid);
    const unknown = path.join(root, "loaddeck-without-marker");
    await mkdir(unknown);
    const incomplete = await runDirectory(root);
    await writeFile(
      path.join(incomplete, "owner.json"),
      JSON.stringify({ schemaVersion: 1, hostPid: 2147483647, createdAt: 0 }),
    );
    assert.equal(await recoverTemporaryRuns(root, 0), 1);
    await assert.rejects(() => stat(orphan));
    assert.ok((await stat(live)).isDirectory());
    assert.ok((await stat(unknown)).isDirectory());
    assert.ok((await stat(incomplete)).isDirectory());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
