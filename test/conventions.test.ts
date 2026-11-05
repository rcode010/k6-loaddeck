import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { generateScript } from "../src/generator";
import { defaultTest } from "../src/model";
function comments(text: string, file: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ranges = new Set<string>();
  const collect = (start: number, end: number) => ranges.add(`${start}:${end}`);
  const visit = (node: ts.Node) => {
    ts.forEachLeadingCommentRange(text, node.pos, collect);
    ts.forEachTrailingCommentRange(text, node.end, collect);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return ranges.size;
}
async function files(directory: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}
test("authored source and generated scripts contain no comments", async () => {
  for (const file of (
    await Promise.all(["src", "webview", "test", "scripts", "media"].map(files))
  ).flat()) {
    const text = await readFile(file, "utf8");
    if (/\.(ts|mjs|js)$/.test(file))
      assert.equal(comments(text, file), 0, file);
    if (file.endsWith(".css")) assert.ok(!text.includes("/*"), file);
  }
  assert.equal(
    comments(
      generateScript({ ...defaultTest, url: "http://localhost/" }),
      "generated.js",
    ),
    0,
  );
});
