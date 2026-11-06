import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { K6Runner } from "../src/runner";

test(
  "real Unicode console output retains at most 64 KiB per run",
  { skip: !process.env.LOADDECK_TEST_K6, timeout: 10000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-log-limit-"));
    const script = path.join(directory, "logs.js");
    await writeFile(
      script,
      "export const options = {vus:1,iterations:1};\nexport default function () { for (let index=0;index<120;index++) console.log(index + ': ' + '🙂'.repeat(1024)); }\n",
    );
    try {
      const run = await new K6Runner().run(
        process.env.LOADDECK_TEST_K6!,
        "fixture",
        () => undefined,
        { script },
      );
      assert.equal(run.state, "completed", run.logs.slice(-3).join("\n"));
      assert.ok(run.logs.some((line) => line.includes("119:")));
      assert.ok(run.logs.length <= 200);
      assert.ok(Buffer.byteLength(run.logs.join(""), "utf8") <= 65536);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
