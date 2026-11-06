import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const [, extension] = await Promise.all([
  build({
    entryPoints: ["test/vscode/index.ts"],
    outfile: "dist/vscode-test.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  }),
  build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    sourcemap: "external",
    minify: true,
    legalComments: "none",
    metafile: true,
  }),
  build({
    entryPoints: ["webview/main.ts"],
    outfile: "dist/webview.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    sourcemap: "external",
    minify: true,
    legalComments: "none",
  }),
]);
const packages = new Set();
for (const file of Object.keys(extension.metafile.inputs)) {
  const parts = file.replaceAll("\\", "/").split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index >= 0)
    packages.add(
      parts
        .slice(0, index + (parts[index + 1].startsWith("@") ? 3 : 2))
        .join("/"),
    );
}
const notices = [];
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const files = (await readdir(directory)).filter((file) =>
    /^(licen[sc]e|notice)([._-]|$)/i.test(file),
  );
  if (!files.length)
    throw new Error(`Missing third-party license notice for ${metadata.name}.`);
  notices.push(
    `${metadata.name} ${metadata.version}\n${files.join(", ")}\n${(await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))).join("\n")}`,
  );
}
await writeFile(
  "dist/THIRD_PARTY_NOTICES.txt",
  notices.join("\n\n========================================\n\n"),
);
