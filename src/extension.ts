import * as vscode from "vscode";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  defaultTest,
  type ClientMessage,
  type QuickTest,
  type Screen,
  type ViewState,
} from "./model";
import {
  durationSeconds,
  generateScript,
  validateQuickTest,
} from "./definition";
import { discover, K6Runner } from "./runner";
import { HistoryStore } from "./history";

class Navigation implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
  getChildren(): vscode.TreeItem[] {
    return [
      ["Home", "home", "home"],
      ["Running Test", "run", "pulse"],
      ["History", "history", "history"],
      ["Compare", "compare", "diff"],
      ["Run Saved Script", "file", "file-code"],
    ].map(([label, screen, icon]) => {
      const item = new vscode.TreeItem(label!);
      item.iconPath = new vscode.ThemeIcon(icon!);
      item.command = {
        command: screen === "file" ? "loaddeck.runFile" : "loaddeck.navigate",
        title: label!,
        arguments: [screen],
      };
      return item;
    });
  }
}
export function activate(context: vscode.ExtensionContext): void {
  const runner = new K6Runner();
  const output = vscode.window.createOutputChannel("LoadDeck");
  const settings = () => vscode.workspace.getConfiguration("loaddeck");
  const history = new HistoryStore(
    (context.storageUri ?? context.globalStorageUri).fsPath,
    () => settings().get<number>("historyLimit", 50),
    (message) => void vscode.window.showWarningMessage(message),
  );
  const binary = () => settings().get<string>("binaryPath", "") || "k6";
  let panel: vscode.WebviewPanel | undefined;
  let draft: QuickTest = { ...defaultTest };
  let busy = false;
  const state: ViewState = {
    screen: "home",
    installation: { ready: false, version: "Not checked" },
    runs: [],
    defaults: {
      testKind: settings().get<"smoke" | "load">("defaultTestKind", "smoke"),
      vus: settings().get<number>("defaultVus", 1),
      duration: settings().get<string>("defaultDuration", "10s"),
    },
  };
  const send = () => panel?.webview.postMessage({ type: "state", state });
  const refresh = async () => {
    state.runs = await history.list();
    send();
  };
  const check = async () => {
    state.installation = await discover(binary());
    send();
  };
  const report = (error: unknown) => {
    state.error =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    send();
  };
  const open = async (screen: Screen = "home") => {
    state.screen = screen;
    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        "loaddeck.dashboard",
        "LoadDeck",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "dist"),
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );
      const nonce = randomBytes(18).toString("base64");
      const script = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
      );
      const style = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "media", "webview.css"),
      );
      panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${panel.webview.cspSource} data:;"><link rel="stylesheet" href="${style}"><title>LoadDeck</title></head><body><div id="app"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
      panel.onDidDispose(
        () => {
          panel = undefined;
        },
        undefined,
        context.subscriptions,
      );
      panel.webview.onDidReceiveMessage(
        (message: unknown) => void handle(message).catch(report),
        undefined,
        context.subscriptions,
      );
    } else panel.reveal();
    send();
  };
  const authorized = async (config?: QuickTest): Promise<boolean> => {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before executing tests.");
    if (config) {
      const target = new URL(config.url);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(
        target.hostname,
      );
      const acknowledged = context.globalState.get<string[]>(
        "authorizedHosts",
        [],
      );
      if (
        !local &&
        settings().get("confirmExternalTargets", true) &&
        !acknowledged.includes(target.origin)
      ) {
        const response = await vscode.window.showWarningMessage(
          `Run performance tests against ${target.origin}? Confirm you are authorized to test this service and accept its load impact.`,
          { modal: true },
          "Authorize target",
        );
        if (response !== "Authorize target") return false;
        await context.globalState.update("authorizedHosts", [
          ...acknowledged,
          target.origin,
        ]);
      }
      if (
        settings().get("confirmHighLoad", true) &&
        (config.vus > 50 ||
          durationSeconds(config.duration) > 300 ||
          ["stress", "spike", "soak"].includes(config.testKind))
      ) {
        if (
          (await vscode.window.showWarningMessage(
            `This test uses ${config.vus} VUs for ${config.duration}${config.testKind === "stress" ? " per stage, peaking at twice the configured VUs" : ""}. Continue only if the target can accept this load.`,
            { modal: true },
            "Run test",
          )) !== "Run test"
        )
          return false;
      }
    } else if (
      (await vscode.window.showWarningMessage(
        "Run this k6 script? It can access files, environment variables and network services with extension host permissions. Its load and outputs follow the original script.",
        { modal: true },
        "Run script",
      )) !== "Run script"
    )
      return false;
    return true;
  };
  const execute = async (input: { config: QuickTest } | { script: string }) => {
    if (busy || runner.busy)
      throw new Error("A test is already running or awaiting confirmation.");
    busy = true;
    try {
      state.error = undefined;
      const config =
        "config" in input ? validateQuickTest(input.config) : undefined;
      if (!(await authorized(config))) return;
      await check();
      if (!state.installation.ready) throw new Error(state.installation.error);
      await open("run");
      let persisted = false;
      const result = await runner.run(
        binary(),
        state.installation.version,
        (run) => {
          state.active = run;
          state.selected = run;
          send();
          if (!persisted) {
            persisted = true;
            void history.save({ ...run }).catch(report);
          }
        },
        config ? { config } : input,
      );
      output.appendLine(
        `${result.name} · ${result.state}\n${result.logs.join("\n")}`,
      );
      await history.save(result);
      state.active = undefined;
      state.selected = result;
      await refresh();
    } finally {
      busy = false;
      send();
    }
  };
  const save = async (config: QuickTest, preview = false) => {
    const c = validateQuickTest(config);
    draft = c;
    const source = generateScript(c);
    if (preview) {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument({
          language: "javascript",
          content: source,
        }),
      );
      return;
    }
    const base = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: base
        ? vscode.Uri.joinPath(base, "performance-tests", "loaddeck-test.js")
        : undefined,
      filters: { "k6 JavaScript": ["js"] },
      saveLabel: "Save k6 Script",
    });
    if (uri) await vscode.workspace.fs.writeFile(uri, Buffer.from(source));
  };
  const runFile = async (uri?: vscode.Uri) => {
    if (!uri) {
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "k6 JavaScript": ["js"] },
      });
      uri = selected?.[0];
    }
    if (!uri) return;
    if (uri.scheme !== "file")
      throw new Error(
        "Select a file available on the extension host filesystem.",
      );
    const document = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri!.toString(),
    );
    if (document?.isDirty && !(await document.save()))
      throw new Error("Save the script before running it.");
    await execute({ script: uri.fsPath });
  };
  const handle = async (raw: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("type" in raw) ||
      typeof raw.type !== "string"
    )
      throw new Error("Invalid dashboard message.");
    const message = raw as ClientMessage;
    state.error = undefined;
    if (message.type === "ready") {
      await refresh();
      await check();
      return;
    }
    if (message.type === "navigate") {
      if (!["home", "run", "history", "compare"].includes(message.screen))
        throw new Error("Invalid destination.");
      state.screen = message.screen;
      send();
      return;
    }
    if (message.type === "check") {
      await check();
      return;
    }
    if (message.type === "stop") {
      runner.stop();
      send();
      return;
    }
    if (message.type === "run") {
      draft = validateQuickTest(message.config);
      await execute({ config: draft });
      return;
    }
    if (message.type === "save" || message.type === "preview") {
      await save(message.config, message.type === "preview");
      return;
    }
    if (message.type === "runFile") {
      await runFile();
      return;
    }
    if (message.type === "logs") {
      output.show();
      return;
    }
    if (message.type === "clear") {
      if (
        (await vscode.window.showWarningMessage(
          "Permanently clear all LoadDeck history?",
          { modal: true },
          "Clear history",
        )) === "Clear history"
      ) {
        await history.clear();
        await refresh();
      }
      return;
    }
    if (!("id" in message) || typeof message.id !== "string")
      throw new Error("Invalid run selection.");
    const run = state.runs.find((r) => r.id === message.id);
    if (!run) throw new Error("Run no longer exists.");
    if (message.type === "open") {
      state.selected = run;
      state.screen = "run";
      send();
    } else if (message.type === "rerun") {
      if (!run.config || !run.rerunnable)
        throw new Error(
          "Re-enter sensitive request settings in Home, or select the original script.",
        );
      await execute({ config: run.config });
    } else if (message.type === "delete") {
      if (
        (await vscode.window.showWarningMessage(
          "Delete this test result?",
          { modal: true },
          "Delete",
        )) === "Delete"
      ) {
        await history.delete(run.id);
        await refresh();
      }
    } else if (message.type === "export") {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(requireHome(), `loaddeck-${run.id}.json`),
        ),
        filters: { JSON: ["json"] },
      });
      if (uri)
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(
            JSON.stringify(
              {
                format: "loaddeck-result-v1",
                units: {
                  avg: "ms",
                  p95: "ms",
                  p99: "ms",
                  failureRate: "ratio",
                  rps: "requests/second",
                },
                run: { ...run, logs: [] },
              },
              null,
              2,
            ),
          ),
        );
    }
  };
  const register = (id: string, action: (...args: never[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: never[]) =>
        Promise.resolve(action(...args)).catch(report),
      ),
    );
  register("loaddeck.open", () => open());
  register("loaddeck.quick", () => open());
  register("loaddeck.navigate", (screen: Screen) => open(screen));
  register("loaddeck.history", () => open("history"));
  register("loaddeck.compare", () => open("compare"));
  register("loaddeck.save", () => save(draft));
  register("loaddeck.stop", () => runner.stop());
  register("loaddeck.check", async () => {
    await open();
    await check();
  });
  register("loaddeck.runFile", () => runFile());
  register("loaddeck.runCurrent", (uri?: vscode.Uri) =>
    runFile(uri ?? vscode.window.activeTextEditor?.document.uri),
  );
  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider(
      "loaddeck.navigation",
      new Navigation(),
    ),
    { dispose: () => runner.stop() },
  );
}
function requireHome(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}
