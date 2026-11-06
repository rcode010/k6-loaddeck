import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";
import { K6Runner, discover } from "../src/runner";
import { defaultTest, type ViewState } from "../src/model";

test(
  "webview URL flow, advanced controls, history, comparison, themes and accessibility",
  {
    skip: !process.env.LOADDECK_TEST_BROWSER || !process.env.LOADDECK_TEST_K6,
    timeout: 60000,
  },
  async () => {
    const server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const binary = process.env.LOADDECK_TEST_K6!;
    const run = await new K6Runner().run(binary, "fixture", () => undefined, {
      config: {
        ...defaultTest,
        url: `http://127.0.0.1:${address.port}/`,
        duration: "1s",
        sleep: 0.1,
      },
    });
    const secondRun = await new K6Runner().run(
      binary,
      "fixture",
      () => undefined,
      {
        config: {
          ...defaultTest,
          url: `http://127.0.0.1:${address.port}/`,
          duration: "1s",
          sleep: 0.1,
        },
      },
    );
    const browser = await chromium.launch({
      executablePath: process.env.LOADDECK_TEST_BROWSER,
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const browserContext = await browser.newContext();
      const page = await browserContext.newPage();
      await page.setViewportSize({
        width: 1280,
        height: 1000,
      });
      page.setDefaultTimeout(4000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const css = await readFile("media/webview.css", "utf8");
      await page.setContent(
        '<!DOCTYPE html><html lang="en"><head><title>LoadDeck webview test</title></head><body><div id="app"></div></body></html>',
      );
      await page.addStyleTag({ content: css });
      await page.addStyleTag({
        content:
          ":root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-editor-font-family:monospace;--vscode-editor-background:#1e1e1e;--vscode-editor-foreground:#d4d4d4;--vscode-foreground:#d4d4d4;--vscode-sideBar-background:#252526;--vscode-panel-border:#525252;--vscode-descriptionForeground:#b0b0b0;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#383838;--vscode-button-secondaryForeground:#fff;--vscode-input-background:#313131;--vscode-input-foreground:#fff;--vscode-input-border:#737373;--vscode-textLink-foreground:#75beff;--vscode-focusBorder:#007fd4;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#fff;--vscode-charts-blue:#75beff}",
      });
      await page.addScriptTag({ content: "window.__name = (fn) => fn" });
      await page.evaluate(() => {
        const host = window as unknown as {
          messages: unknown[];
          acquireVsCodeApi: () => unknown;
        };
        host.messages = [];
        host.acquireVsCodeApi = () => ({
          postMessage: (message: unknown) => host.messages.push(message),
          getState: () => undefined,
          setState: () => undefined,
        });
      });
      await page.addScriptTag({ path: "dist/webview.js" });
      const view: ViewState = {
        screen: "home",
        installation: await discover(binary),
        runs: [run, secondRun],
        defaults: { testKind: "smoke", vus: 1, duration: "10s" },
      };
      const send = async () =>
        page.evaluate(
          (state) => window.postMessage({ type: "state", state }, "*"),
          view,
        );
      await send();
      await page
        .waitForFunction(() => document.querySelector("input"), undefined, {
          timeout: 3000,
        })
        .catch(async () => {
          throw new Error(
            JSON.stringify({
              errors,
              html: await page.locator("#app").innerHTML(),
            }),
          );
        });
      await page
        .getByLabel("Target URL", { exact: true })
        .fill(`http://127.0.0.1:${address.port}/`);
      await page.getByRole("button", { name: "Run Test", exact: true }).click();
      const messages = await page.evaluate(
        () =>
          (
            window as unknown as {
              messages: { type: string; config?: { url: string } }[];
            }
          ).messages,
      );
      assert.ok(
        messages.some(
          (m) => m.type === "run" && m.config?.url.includes("127.0.0.1"),
        ),
      );
      await page.getByText("Advanced request options", { exact: true }).click();
      await page.getByText("Scenarios & executors", { exact: true }).click();
      await page
        .getByRole("button", { name: "Use advanced scenarios" })
        .click();
      await page
        .getByRole("button", { name: "Customize scenario request" })
        .click();
      const scenarioEditor = page.getByRole("group", {
        name: "Scenario 1",
        exact: true,
      });
      await scenarioEditor
        .getByText("Independent request", { exact: true })
        .click();
      await scenarioEditor
        .getByLabel("Request method", { exact: true })
        .selectOption("POST");
      await scenarioEditor
        .getByLabel("Request payload", { exact: true })
        .fill("scenario payload");
      await page
        .getByRole("button", { name: "Preview script", exact: true })
        .click();
      const independent = await page.evaluate(() =>
        (
          window as unknown as {
            messages: {
              type: string;
              config?: {
                scenarios?: { request?: { method: string; body: string } }[];
              };
            }[];
          }
        ).messages
          .filter((m) => m.type === "preview")
          .at(-1),
      );
      assert.equal(
        independent?.config?.scenarios?.[0]?.request?.method,
        "POST",
      );
      assert.equal(
        independent?.config?.scenarios?.[0]?.request?.body,
        "scenario payload",
      );
      await page
        .getByRole("button", { name: "Use shared request", exact: true })
        .click();
      await page
        .getByLabel("Executor", { exact: true })
        .selectOption("constant-arrival-rate")
        .catch(async () => {
          throw new Error(
            JSON.stringify({
              errors,
              form: await page.locator("form").innerText(),
            }),
          );
        });
      await page.getByLabel("Iteration starts per time unit").fill("2");
      await page.getByText("Protocol", { exact: true }).first().click();
      await page.getByLabel("Protocol", { exact: true }).selectOption("ws");
      await page.getByLabel("Message to send").fill("hello");
      await page.getByText("Checks", { exact: true }).click();
      await page
        .getByRole("button", { name: "Add check", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Condition", { exact: true }).inputValue(),
        "messageContains",
      );
      await page
        .getByLabel("Condition", { exact: true })
        .selectOption("messageRegex");
      await page.getByLabel("Regex flags", { exact: true }).fill("i");
      await page.getByLabel("Check group", { exact: true }).fill("messages");
      await page
        .getByRole("button", { name: "Preview script", exact: true })
        .click();
      const preview = await page.evaluate(() =>
        (
          window as unknown as {
            messages: {
              type: string;
              config?: {
                checks?: { kind: string; flags: string; group: string }[];
              };
            }[];
          }
        ).messages
          .filter((message) => message.type === "preview")
          .at(-1),
      );
      assert.equal(preview?.config?.checks?.[0]?.kind, "messageRegex");
      assert.equal(preview?.config?.checks?.[0]?.flags, "i");
      assert.equal(preview?.config?.checks?.[0]?.group, "messages");
      await page.getByText("Threshold rules", { exact: true }).click();
      await page
        .getByRole("button", { name: "Add threshold", exact: true })
        .click();
      await page.getByLabel("Metric", { exact: true }).selectOption("checks");
      assert.equal(
        await page.getByLabel("Aggregation", { exact: true }).inputValue(),
        "rate",
      );
      assert.deepEqual(
        await page
          .getByLabel("Aggregation", { exact: true })
          .locator("option")
          .allTextContents(),
        ["rate"],
      );
      await page
        .getByLabel("Metric", { exact: true })
        .selectOption("http_req_duration");
      await page
        .getByLabel("Aggregation", { exact: true })
        .selectOption("p(99)");
      await page
        .getByLabel("Percentile (0–100)", { exact: true })
        .fill("99.99");
      await page
        .getByRole("button", { name: "Preview script", exact: true })
        .click();
      const thresholds = await page.evaluate(() =>
        (
          window as unknown as {
            messages: {
              type: string;
              config?: { thresholdRules?: { aggregation: string }[] };
            }[];
          }
        ).messages
          .filter((m) => m.type === "preview")
          .at(-1),
      );
      assert.equal(
        thresholds?.config?.thresholdRules?.[0]?.aggregation,
        "p(99.99)",
      );
      view.screen = "home";
      view.installation = {
        ready: false,
        version: "Unavailable",
        error: "Install k6 in your extension host.",
      };
      await send();
      await page
        .getByText("Install k6 in your extension host.")
        .waitFor({ state: "visible" });
      view.installation = await discover(binary);
      await send();
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        accessibility.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      await mkdir("docs/screenshots", { recursive: true });
      await page.screenshot({
        path: "docs/screenshots/home-dark.png",
        fullPage: true,
      });
      view.screen = "history";
      await send();
      await page.getByRole("checkbox").nth(0).check();
      await page.getByRole("checkbox").nth(1).check();
      await page
        .getByRole("button", { name: "Compare Selected (2/2)" })
        .click();
      view.screen = "compare";
      await send();
      await page
        .getByText("Comparable conditions.", { exact: false })
        .waitFor({ state: "visible" });
      await page
        .getByLabel("Comparison scenario", { exact: true })
        .selectOption("main");
      const percentile = page
        .getByRole("row")
        .filter({ hasText: "p95 latency" });
      assert.equal(await percentile.locator("td").nth(1).innerText(), "N/A");
      await page
        .getByLabel("Comparison chart", { exact: true })
        .selectOption("requests");
      const charts = page.locator(".chart svg");
      assert.equal(await charts.count(), 2);
      assert.equal(
        await charts.nth(0).getAttribute("data-axis-max"),
        await charts.nth(1).getAttribute("data-axis-max"),
      );
      assert.equal(
        await charts.nth(0).getAttribute("data-axis-end"),
        await charts.nth(1).getAttribute("data-axis-end"),
      );
      view.screen = "run";
      view.selected = run;
      await send();
      await page
        .getByRole("heading", { name: run.name, exact: true })
        .waitFor();
      await page.screenshot({
        path: "docs/screenshots/results-dark.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      view.screen = "home";
      await send();
      await page
        .getByRole("heading", { name: "Test your API’s performance" })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page.addStyleTag({
        content:
          ":root{--vscode-editor-background:#fff;--vscode-editor-foreground:#202020;--vscode-foreground:#202020;--vscode-sideBar-background:#f3f3f3;--vscode-descriptionForeground:#555;--vscode-input-background:#fff;--vscode-input-foreground:#202020;--vscode-button-secondaryBackground:#ddd;--vscode-button-secondaryForeground:#202020;--vscode-textLink-foreground:#005a9e}",
      });
      await page.screenshot({
        path: "docs/screenshots/home-light-narrow.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
