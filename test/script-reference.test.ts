import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { ScriptReferences } from "../src/script-reference";
import { fingerprint } from "../src/definition";

test("protected script references detect changes and follow history retention", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "loaddeck-script-reference-"),
  );
  const values = new Map<string, string>();
  let ids: string[] = [];
  const provider = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  const refs = new ScriptReferences(provider, "workspace", {
    get: () => ids,
    set: async (value) => {
      ids = value;
    },
  });
  try {
    const file = path.join(directory, "test.js"),
      id = randomUUID();
    await writeFile(file, "original source");
    await refs.save(id, file, fingerprint("original source"));
    assert.equal((await refs.load(id)).changed, false);
    assert.ok(!JSON.stringify(ids).includes(file));
    assert.ok(![...values.values()].join("").includes("original source"));
    await writeFile(file, "changed source");
    assert.equal((await refs.load(id)).changed, true);
    assert.equal((await refs.load(id)).file, file);
    await refs.retain([]);
    assert.equal(ids.length, 0);
    assert.equal(values.size, 0);
    await assert.rejects(() => refs.load(id), /unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
