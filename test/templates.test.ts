import { test } from "node:test";
import assert from "node:assert/strict";
import { TestTemplates, type SavedTest } from "../src/templates";
import { defaultTest } from "../src/model";

test("saved configurations use protected storage while the index contains names and IDs only", async () => {
  const values = new Map<string, string>();
  let index: SavedTest[] = [];
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  const metadata = {
    get: () => index,
    set: async (tests: SavedTest[]) => {
      index = tests;
    },
  };
  const templates = new TestTemplates(secrets, metadata, "workspace-a");
  const config = {
    ...defaultTest,
    url: "http://localhost/?account=private",
    method: "POST",
    body: "private request payload",
  };
  const [first, second] = await Promise.all([
    templates.save("First", config),
    templates.save("Second", config),
  ]);
  assert.equal(index.length, 2);
  assert.ok(!JSON.stringify(index).includes("private"));
  assert.ok(!JSON.stringify(index).includes("localhost"));
  const reopened = new TestTemplates(secrets, metadata, "workspace-a");
  assert.equal((await reopened.load(first.id)).body, config.body);
  await assert.rejects(
    () => new TestTemplates(secrets, metadata, "workspace-b").load(first.id),
    /unavailable/,
  );
  await assert.rejects(
    () =>
      reopened.save("Invalid", {
        ...config,
        headers: { Authorization: "literal-secret" },
      }),
    /Sensitive headers/,
  );
  await reopened.delete(first.id);
  assert.equal(index.length, 1);
  await assert.rejects(() => reopened.load(first.id), /unavailable/);
  assert.equal((await reopened.load(second.id)).url, config.url);
});
