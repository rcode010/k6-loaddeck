import { build } from "esbuild";
await Promise.all([
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
