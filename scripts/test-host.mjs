import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-vscode-"));
const binary = process.env.LOADDECK_TEST_VSCODE;
if (!binary)
  throw new Error(
    "Set LOADDECK_TEST_VSCODE to the desktop VS Code executable.",
  );
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(
    binary,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir",
      path.join(directory, "user"),
      "--extensions-dir",
      path.join(directory, "extensions"),
      `--extensionDevelopmentPath=${process.cwd()}`,
      `--extensionTestsPath=${path.join(process.cwd(), "dist", "vscode-test.js")}`,
      "--skip-welcome",
      "--skip-release-notes",
    ],
    { env: environment, stdio: "inherit", shell: false },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
