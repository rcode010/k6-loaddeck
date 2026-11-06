import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const binary = process.env.LOADDECK_TEST_VSCODE,
  k6 = process.env.LOADDECK_TEST_K6;
if (!binary || !k6)
  throw new Error("Set LOADDECK_TEST_VSCODE and LOADDECK_TEST_K6.");
const directory = await mkdtemp(path.join(tmpdir(), "loaddeck-ui-host-"));
const restricted = process.argv.includes("--restricted");
const workspace = path.join(directory, "workspace");
await mkdir(workspace);
let requests = 0,
  authenticated = 0;
const fixture = createServer((request, response) => {
  requests++;
  if (request.url === "/fail") response.statusCode = 500;
  if (request.url === "/protected") {
    if (request.headers.authorization === "Bearer desktop-secret")
      authenticated++;
    else response.statusCode = 401;
  }
  response.end("ok");
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const target = `http://127.0.0.1:${fixture.address().port}/`;
const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
await mkdir(path.join(directory, "user", "User"), { recursive: true });
await writeFile(
  path.join(directory, "user", "User", "settings.json"),
  JSON.stringify({
    "loaddeck.binaryPath": k6,
    "workbench.startupEditor": "none",
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "window.commandCenter": false,
    "window.dialogStyle": "custom",
    "security.workspace.trust.enabled": true,
  }),
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.DESKTOP_TOKEN;
const child = spawn(
  binary,
  [
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    "--user-data-dir",
    path.join(directory, "user"),
    "--extensions-dir",
    path.join(directory, "extensions"),
    `--extensionDevelopmentPath=${process.cwd()}`,
    "--skip-welcome",
    "--skip-release-notes",
    ...(restricted ? [workspace] : []),
  ],
  {
    env: environment,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let diagnostic = "";
for (const stream of [child.stdout, child.stderr])
  stream.on(
    "data",
    (chunk) => (diagnostic = (diagnostic + chunk.toString()).slice(-16000)),
  );
async function activateButton(frame, name) {
  const control = frame.getByRole("button", { name, exact: true });
  await control.focus();
  await control.press("Enter");
}
async function command(page, name) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+P");
  await page.locator(".quick-input-widget input").fill(">" + name);
  await page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: name })
    .first()
    .click();
}
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!ready) throw new Error(diagnostic);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 100; i++) {
    page = context.pages().find((p) => p.url().includes("workbench"));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(page, "VS Code workbench page exists");
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".monaco-workbench").waitFor();
  if (restricted) {
    const rejectTrust = page.getByRole("button", { name: /No, I don't trust/ });
    if (await rejectTrust.isVisible()) {
      await rejectTrust.focus();
      await rejectTrust.press("Enter");
    }
    await page
      .getByText(/Restricted Mode is intended for safe code browsing/)
      .first()
      .waitFor();
  }
  await page.keyboard.press("Control+Shift+P");
  await page
    .locator(".quick-input-widget input")
    .fill(">LoadDeck: Open Performance Dashboard");
  await page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: "LoadDeck: Open Performance Dashboard" })
    .first()
    .click();
  let frame;
  for (let i = 0; i < 100; i++) {
    frame = undefined;
    for (const candidate of page.frames())
      if (await candidate.locator("#app input").count()) {
        frame = candidate;
        break;
      }
    if (frame) break;
    frame = undefined;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!frame)
    throw new Error(
      `LoadDeck webview not found. Frames: ${page
        .frames()
        .map((f) => f.url())
        .join("\n")}\n${diagnostic}`,
    );
  if (restricted) {
    await frame.getByLabel("Target URL", { exact: true }).fill(target);
    await activateButton(frame, "Run Test");
    await frame
      .getByText("Trust this workspace before executing tests.", {
        exact: true,
      })
      .waitFor();
    assert.equal(requests, 0);
    console.log(
      "Actual VS Code Restricted Mode rejects execution before any target request.",
    );
  } else {
    await frame.getByLabel("Target URL", { exact: true }).fill(target);
    await frame.getByLabel("Duration", { exact: true }).fill("2s");
    await activateButton(frame, "Run Test");
    await frame
      .getByText("Completed · no thresholds", { exact: true })
      .waitFor({ timeout: 20000 });
    assert.ok(
      await frame
        .getByText("Final percentiles come from k6", { exact: false })
        .isVisible(),
    );
    await frame.getByRole("button", { name: "Run Again", exact: true }).focus();
    await frame
      .getByRole("button", { name: "Run Again", exact: true })
      .press("Enter");
    await frame
      .getByRole("button", { name: "Stop Test", exact: true })
      .waitFor();
    await frame
      .getByText("Completed · no thresholds", { exact: true })
      .waitFor({ timeout: 20000 });
    await mkdir("docs/screenshots", { recursive: true });
    await frame.evaluate(() => globalThis.scrollTo(0, 0));
    await page
      .locator(".part.editor")
      .screenshot({ path: "docs/screenshots/vscode-results.png" });
    await page.keyboard.press("Control+Shift+P");
    await page
      .locator(".quick-input-widget input")
      .fill(">Developer: Reload Window");
    const reloaded = page.waitForEvent("domcontentloaded", { timeout: 20000 });
    await page
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: "Developer: Reload Window" })
      .first()
      .click();
    await reloaded;
    await page.locator(".monaco-workbench").waitFor();
    await page.keyboard.press("Control+Shift+P");
    await page
      .locator(".quick-input-widget input")
      .fill(">LoadDeck: Open Performance Dashboard");
    await page
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: "LoadDeck: Open Performance Dashboard" })
      .first()
      .click();
    frame = undefined;
    for (let i = 0; i < 100; i++) {
      for (const candidate of page.frames())
        if (await candidate.locator("#app input").count()) {
          frame = candidate;
          break;
        }
      if (frame) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(frame, "Webview reopened after extension host reload");
    await activateButton(frame, "History");
    await frame.getByRole("heading", { name: "Test history" }).waitFor();
    assert.equal(await frame.getByRole("checkbox").count(), 2);
    for (const checkbox of await frame.getByRole("checkbox").all()) {
      await checkbox.focus();
      await checkbox.press("Space");
    }
    await activateButton(frame, "Compare Selected (2/2)");
    await frame.getByText("Comparable conditions.", { exact: false }).waitFor();
    await frame
      .getByLabel("Comparison scenario", { exact: true })
      .selectOption("main");
    assert.equal(
      await frame
        .getByRole("row")
        .filter({ hasText: "p95 latency" })
        .locator("td")
        .nth(1)
        .innerText(),
      "N/A",
    );
    await frame
      .getByLabel("Comparison chart", { exact: true })
      .selectOption("requests");
    const charts = frame.locator(".chart svg");
    assert.equal(await charts.count(), 2);
    assert.equal(
      await charts.nth(0).getAttribute("data-axis-max"),
      await charts.nth(1).getAttribute("data-axis-max"),
    );
    assert.equal(
      await charts.nth(0).getAttribute("data-axis-end"),
      await charts.nth(1).getAttribute("data-axis-end"),
    );
    await frame.evaluate(() => globalThis.scrollTo(0, 0));
    await page
      .locator(".part.editor")
      .screenshot({ path: "docs/screenshots/vscode-comparison.png" });
    await activateButton(frame, "New test");
    await frame.getByLabel("Target URL", { exact: true }).fill(target);
    await frame.getByLabel("Duration", { exact: true }).fill("20s");
    await activateButton(frame, "Run Test");
    await frame
      .getByRole("button", { name: "Stop Test", exact: true })
      .waitFor();
    await activateButton(frame, "Stop Test");
    await frame.getByText("Cancelled", { exact: true }).first().waitFor();
    await activateButton(frame, "New test");
    await frame.getByLabel("Target URL", { exact: true }).fill(target + "fail");
    await frame.getByLabel("Duration", { exact: true }).fill("1s");
    await frame.getByText("Advanced request options", { exact: true }).click();
    await frame.getByLabel("Expected status", { exact: true }).fill("200");
    await frame
      .getByLabel("Thresholds (JSON object)", { exact: true })
      .fill('{"checks":["rate==1"]}');
    await activateButton(frame, "Run Test");
    await frame
      .getByText("Threshold failed", { exact: true })
      .first()
      .waitFor();
    await activateButton(frame, "New test");
    await frame
      .getByLabel("Target URL", { exact: true })
      .fill(target + "protected");
    await frame.getByText("Advanced request options", { exact: true }).click();
    await frame.getByText("Authentication", { exact: true }).first().click();
    await frame
      .getByLabel("Authentication mode", { exact: true })
      .selectOption("bearer");
    await frame
      .getByLabel("Secret variable", { exact: true })
      .fill("DESKTOP_TOKEN");
    await frame.getByLabel("Secret variable", { exact: true }).blur();
    await activateButton(frame, "Store secret securely");
    await page
      .locator(".quick-input-widget input[type=password]")
      .fill("desktop-secret");
    await page
      .locator(".quick-input-widget input[type=password]")
      .press("Enter");
    await activateButton(frame, "Save test configuration");
    await page.locator(".quick-input-widget input").fill("Protected fixture");
    await page.locator(".quick-input-widget input").press("Enter");
    await activateButton(frame, "Saved tests");
    await frame
      .getByRole("heading", { name: "Protected fixture", exact: true })
      .waitFor();
    await activateButton(frame, "Run saved test");
    const sendCredentials = page.getByRole("button", {
      name: "Send credentials",
      exact: true,
    });
    await sendCredentials.focus();
    await sendCredentials.press("Enter");
    await frame
      .getByText("Completed · thresholds met", { exact: true })
      .first()
      .waitFor();
    assert.ok(authenticated > 0);
    const histories = (
      await readdir(path.join(directory, "user"), { recursive: true })
    ).filter((file) => file.endsWith("history-v1.json"));
    assert.ok(histories.length);
    for (const file of histories) {
      const history = await readFile(
        path.join(directory, "user", file),
        "utf8",
      );
      assert.ok(!history.includes("desktop-secret"));
      assert.ok(
        JSON.parse(history).runs.some(
          (run) =>
            run.templateId && run.credentialSource === "k6-secret-source",
        ),
      );
    }
    const previousAuthenticated = authenticated;
    const reload = page.waitForEvent("domcontentloaded", { timeout: 20000 });
    await command(page, "Developer: Reload Window");
    await reload;
    await page.locator(".monaco-workbench").waitFor();
    await command(page, "LoadDeck: Open Performance Dashboard");
    frame = undefined;
    for (let i = 0; i < 100; i++) {
      for (const candidate of page.frames())
        if (await candidate.locator("#app input").count()) {
          frame = candidate;
          break;
        }
      if (frame) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(frame);
    await activateButton(frame, "Saved tests");
    await frame
      .getByRole("heading", { name: "Protected fixture", exact: true })
      .waitFor();
    await activateButton(frame, "Run saved test");
    await sendCredentials.focus();
    await sendCredentials.press("Enter");
    await frame
      .getByText("Completed · thresholds met", { exact: true })
      .first()
      .waitFor();
    assert.ok(authenticated > previousAuthenticated);
    await command(page, "LoadDeck: Manage Runtime Credentials");
    await page.locator(".quick-input-widget input").fill("DESKTOP_TOKEN");
    await page.locator(".quick-input-widget input").press("Enter");
    await page.locator(".quick-input-widget input").fill("Delete stored value");
    await page.locator(".quick-input-widget input").press("Enter");
    const removeSecret = page.getByRole("button", {
      name: "Delete stored value",
      exact: true,
    });
    await removeSecret.focus();
    await removeSecret.press("Enter");
    await activateButton(frame, "Saved tests");
    await activateButton(frame, "Run saved test");
    await sendCredentials.focus();
    await sendCredentials.press("Enter");
    await frame
      .getByText("Execution failed", { exact: true })
      .first()
      .waitFor();
    const customFile = path.join(directory, "custom.js");
    const customSource = `import http from 'k6/http'; export const options = {vus:1,duration:'1s'}; export default function(){http.get(${JSON.stringify(target)});}`;
    await writeFile(customFile, customSource);
    await page.keyboard.press("Control+p");
    await page.locator(".quick-input-widget input").fill(customFile);
    await page.locator(".quick-input-widget input").press("Enter");
    await page.locator(".quick-input-widget").waitFor({ state: "hidden" });
    await page.getByRole("tab", { name: /custom.js/ }).waitFor();
    await command(page, "LoadDeck: Run Current Test File");
    const runScript = page.getByRole("button", {
      name: "Run script",
      exact: true,
    });
    await runScript.focus();
    await runScript.press("Enter");
    await frame
      .getByText("Completed · threshold results unavailable", { exact: true })
      .first()
      .waitFor();
    await frame
      .getByRole("button", { name: "Open script", exact: true })
      .waitFor();
    await writeFile(customFile, customSource + "\n");
    await activateButton(frame, "Run Again");
    const changedScript = page.getByRole("button", {
      name: "Run current script",
      exact: true,
    });
    await changedScript.focus();
    await changedScript.press("Enter");
    await runScript.focus();
    await runScript.press("Enter");
    await frame
      .getByRole("button", { name: "Stop Test", exact: true })
      .waitFor();
    await frame
      .getByText("Completed · threshold results unavailable", { exact: true })
      .first()
      .waitFor();
    assert.equal(await readFile(customFile, "utf8"), customSource + "\n");
    console.log(
      "Actual VS Code runs, history/comparison, Stop, failures, protected-template reload, credential deletion and changed-script rerun passed.",
    );
  }
} catch (error) {
  await mkdir(".test-artifacts", { recursive: true });
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page
          .screenshot({ path: ".test-artifacts/vscode-ui-failure.png" })
          .catch(() => undefined);
  throw error;
} finally {
  if (browser)
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill();
  } catch {
    child.kill();
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
process.exit(0);
