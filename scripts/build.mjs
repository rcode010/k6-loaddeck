import { build } from "esbuild";
await Promise.all([
  build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["webview/main.ts"],
    outfile: "dist/webview.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    sourcemap: true,
  }),
]);
