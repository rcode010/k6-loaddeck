import { credentialVariables } from "./integrations";
import { datasetRows, datasetPreview } from "./data";
import { exportRun } from "./reports";
import { readFile, stat, rm } from "node:fs/promises";
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
import { generateScript, validateQuickTest } from "./definition";
import { discover, K6Runner } from "./runner";
import { HistoryStore } from "./history";
import { activeRequests } from "./requests";
import { workloadLoad } from "./load";
import { protoMethods } from "./proto";
import { savedScript } from "./saved-script";
import { TestTemplates, type SavedTest } from "./templates";
import { fingerprint } from "./definition";
import { inspectScenarios, supportsScenarioSelection } from "./scripts";

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
      ["Saved Tests", "saved", "save"],
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
let shutdown: (() => Promise<void>) | undefined;
export async function deactivate(): Promise<void> {
  await shutdown?.();
}
export function activate(context: vscode.ExtensionContext): void {
  const runner = new K6Runner();
  shutdown = async () => {
    runner.dispose();
    const deadline = Date.now() + 4000;
    while (runner.busy && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
  };
  const output = vscode.window.createOutputChannel("LoadDeck");
  const settings = () => vscode.workspace.getConfiguration("loaddeck");
  const templateScope = fingerprint(context.storageUri?.toString() ?? "global");
  const templateIndex = `savedTests:${templateScope}`;
  const templates = new TestTemplates(
    context.secrets,
    {
      get: () => context.globalState.get<SavedTest[]>(templateIndex, []),
      set: (tests) => context.globalState.update(templateIndex, tests),
    },
    templateScope,
  );
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
    state.templates = templates.list();
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
      const requests = activeRequests(config);
      const targets = requests
        .flatMap((r) => [
          r.url,
          ...(r.authentication?.mode === "oauth2"
            ? [r.authentication.tokenUrl]
            : []),
        ])
        .filter(Boolean);
      for (const value of [...new Set(targets)]) {
        const target = new URL(value);
        const origin = `${target.protocol}//${target.host}`;
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
          !acknowledged.includes(origin)
        ) {
          const response = await vscode.window.showWarningMessage(
            `Run performance tests against ${origin}? Confirm you are authorized to test this service and accept its load impact.`,
            { modal: true },
            "Authorize target",
          );
          if (response !== "Authorize target") return false;
          await context.globalState.update("authorizedHosts", [
            ...acknowledged,
            origin,
          ]);
        }
      }
      if (
        requests.some(
          (r) => r.authentication && r.authentication.mode !== "none",
        )
      ) {
        if (
          (await vscode.window.showWarningMessage(
            "Credentials will be sent to the selected targets and OAuth endpoint, where configured. Confirm these services are authorized. Plain HTTP and WS do not encrypt credentials.",
            { modal: true },
            "Send credentials",
          )) !== "Send credentials"
        )
          return false;
      }
      if (
        config.outputs?.length &&
        (await vscode.window.showWarningMessage(
          "Raw k6 outputs may contain sensitive metric tags and consume substantial disk space. These files are retained at your selected paths.",
          { modal: true },
          "Write raw outputs",
        )) !== "Write raw outputs"
      )
        return false;
      if (config.externalOutput?.enabled) {
        if (
          (await vscode.window.showWarningMessage(
            `Send metrics to ${config.externalOutput.endpoint}? Metrics leave this machine and may include scenario tags and dataset values. Ensure this backend is authorized and already configured.`,
            { modal: true },
            "Send metrics",
          )) !== "Send metrics"
        )
          return false;
      }
      const load = workloadLoad(config);
      if (settings().get("confirmHighLoad", true) && load.high) {
        if (
          (await vscode.window.showWarningMessage(
            `This schedule may use up to ${load.peakVus} concurrent VUs for ${Math.ceil(load.duration)} seconds including graceful stop${load.peakRate ? `, with up to ${load.peakRate.toFixed(1)} iteration starts/s` : ""}. Continue only if the targets can accept this load.`,
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
  const execute = async (
    input:
      | { config: QuickTest; templateId?: string }
      | { script: string; selectScenarios?: boolean },
  ) => {
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
      const environment: Record<string, string> = {};
      const variables = config
        ? credentialVariables(config)
        : settings().get<string[]>("scriptEnvironment", []);
      for (const name of variables) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name))
          throw new Error(
            "Runtime variable names must be uppercase identifiers.",
          );
        const value = await context.secrets.get(`variable:${name}`);
        if (value) environment[name] = value;
      }
      let scenarios: string[] | undefined;
      if ("script" in input && input.selectScenarios) {
        if (!supportsScenarioSelection(state.installation.version))
          throw new Error(
            "Scenario selection is verified for k6 2.3.x. Use Run Test File to run every original scenario on other binaries.",
          );
        const names = await inspectScenarios(
          binary(),
          input.script,
          environment,
        );
        if (!names.length)
          throw new Error(
            "This script has no named scenarios. Use Run Test File for its original default workload.",
          );
        const chosen = await vscode.window.showQuickPick(
          names.map((label) => ({ label, picked: true })),
          {
            canPickMany: true,
            placeHolder:
              "Run only these scenarios; executor, timing, environment and load stay unchanged",
          },
        );
        if (!chosen) return;
        if (!chosen.length) throw new Error("Select at least one scenario.");
        scenarios = chosen.map((item) => item.label);
      }
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
        config ? { config, environment } : { ...input, scenarios, environment },
      );
      if ("templateId" in input && input.templateId) {
        result.templateId = input.templateId;
        result.rerunnable = true;
      }
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
    if (uri) {
      if (uri.scheme !== "file")
        throw new Error("Save scripts on the extension host filesystem.");
      const bundle = await savedScript(c, uri.fsPath);
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(bundle.source));
      } catch (error) {
        if (bundle.assets)
          await rm(bundle.assets, { recursive: true, force: true });
        throw error;
      }
    }
  };
  const runFile = async (uri?: vscode.Uri, selectScenarios = false) => {
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
    await execute({ script: uri.fsPath, selectScenarios });
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
    if (message.type === "inspectProto") {
      if (
        typeof message.file !== "string" ||
        !Array.isArray(message.importPaths) ||
        message.importPaths.some((p) => typeof p !== "string")
      )
        throw new Error("Select a gRPC schema and valid import paths.");
      const methods = await protoMethods(message.file, message.importPaths);
      await panel?.webview.postMessage({
        type: "protoMethods",
        methods,
        scenario: message.scenario,
      });
      return;
    }
    if (message.type === "credential" || message.type === "deleteCredential") {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(message.name))
        throw new Error("Use an uppercase runtime variable name.");
      const names = context.globalState.get<string[]>("credentialNames", []);
      if (message.type === "deleteCredential") {
        if (
          (await vscode.window.showWarningMessage(
            `Delete the protected value for ${message.name}? Environment-variable fallback remains available.`,
            { modal: true },
            "Delete stored value",
          )) === "Delete stored value"
        ) {
          await context.secrets.delete(`variable:${message.name}`);
          await context.globalState.update(
            "credentialNames",
            names.filter((name) => name !== message.name),
          );
        }
        return;
      }
      const secret = await vscode.window.showInputBox({
        prompt: `Protected value for ${message.name}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (secret !== undefined) {
        await context.secrets.store(`variable:${message.name}`, secret);
        await context.globalState.update(
          "credentialNames",
          [...new Set([...names, message.name])].sort(),
        );
      }
      return;
    }
    if (message.type === "chooseFile") {
      if (
        !["dataset", "proto", "jsonOutput", "csvOutput", "upload"].includes(
          message.purpose,
        )
      )
        throw new Error("Invalid file selection.");
      const isOutput = message.purpose.endsWith("Output");
      const extension =
        message.purpose === "proto"
          ? "proto"
          : message.purpose === "csvOutput"
            ? "csv"
            : (message.format ?? "json");
      const uri = isOutput
        ? await vscode.window.showSaveDialog({
            filters: { [extension]: [extension] },
          })
        : (
            await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters:
                message.purpose === "upload"
                  ? undefined
                  : { [extension]: [extension] },
            })
          )?.[0];
      if (uri) {
        let columns: string[] = [];
        let rowCount = 0;
        let schema: { name: string; type: string }[] = [];
        if (message.purpose === "dataset") {
          if ((await stat(uri.fsPath)).size > 20 * 1024 * 1024)
            throw new Error("Dataset exceeds the 20 MiB limit.");
          const text = await readFile(uri.fsPath, "utf8");
          const preview = datasetPreview(
            datasetRows(text, { format: extension === "csv" ? "csv" : "json" }),
          );
          schema = preview.columns;
          columns = schema.map((column) => column.name);
          rowCount = preview.rowCount;
        }
        await panel?.webview.postMessage({
          type: "fileChosen",
          purpose: message.purpose,
          scenario: message.scenario,
          path: uri.fsPath,
          format: extension,
          columns,
          rowCount,
          schema,
          methods:
            message.purpose === "proto"
              ? await protoMethods(uri.fsPath)
              : undefined,
        });
      }
      return;
    }
    state.error = undefined;
    if (message.type === "saveTemplate") {
      const config = validateQuickTest(message.config);
      const name = await vscode.window.showInputBox({
        prompt:
          "Saved-test name. Request settings are protected by VS Code SecretStorage; names remain visible in the saved-test list.",
        value: config.name || "My performance test",
      });
      if (name) {
        await templates.save(name, config);
        await refresh();
      }
      return;
    }
    if (
      ["openTemplate", "runTemplate", "deleteTemplate"].includes(
        message.type,
      ) &&
      "id" in message
    ) {
      if (message.type === "deleteTemplate") {
        if (
          (await vscode.window.showWarningMessage(
            "Delete this saved test and its protected configuration? Run history is retained.",
            { modal: true },
            "Delete saved test",
          )) === "Delete saved test"
        ) {
          await templates.delete(message.id);
          await refresh();
        }
      } else {
        const config = await templates.load(message.id);
        if (message.type === "runTemplate")
          await execute({ config, templateId: message.id });
        else {
          draft = config;
          await open("home");
          await panel?.webview.postMessage({ type: "loadConfig", config });
        }
      }
      return;
    }
    if (message.type === "ready") {
      await refresh();
      await check();
      return;
    }
    if (message.type === "navigate") {
      if (
        !["home", "run", "history", "compare", "saved"].includes(message.screen)
      )
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
      if (message.id !== state.active?.id)
        throw new Error("This stop request refers to an earlier run.");
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
      if (run.templateId) {
        await execute({
          config: await templates.load(run.templateId),
          templateId: run.templateId,
        });
        return;
      }
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
      const format = message.format ?? "json";
      if (!["json", "csv", "html"].includes(format))
        throw new Error("Invalid export format.");
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(requireHome(), `loaddeck-${run.id}.${format}`),
        ),
        filters: { [format]: [format] },
      });
      if (uri)
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(exportRun(run, format)),
        );
    }
  };
  const register = (id: string, action: (...args: never[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: never[]) =>
        Promise.resolve(action(...args)).catch(report),
      ),
    );
  register("loaddeck.credential", async () => {
    const name = await vscode.window.showInputBox({
      prompt: "Runtime variable name",
      placeHolder: "API_TOKEN",
      validateInput: (value) =>
        /^[A-Z_][A-Z0-9_]*$/.test(value)
          ? undefined
          : "Use an uppercase variable name.",
    });
    if (name) await handle({ type: "credential", name });
  });
  register("loaddeck.manageCredentials", async () => {
    const names = context.globalState.get<string[]>("credentialNames", []);
    if (!names.length) {
      await vscode.window.showInformationMessage(
        "No protected LoadDeck values are stored yet.",
      );
      return;
    }
    const name = await vscode.window.showQuickPick(names, {
      placeHolder: "Select a protected variable to update or delete",
    });
    if (!name) return;
    const action = await vscode.window.showQuickPick(
      ["Update value", "Delete stored value"],
      { placeHolder: name },
    );
    if (action)
      await handle({
        type: action === "Update value" ? "credential" : "deleteCredential",
        name,
      });
  });
  register("loaddeck.open", () => open());
  register("loaddeck.quick", () => open());
  register("loaddeck.navigate", (screen: Screen) => open(screen));
  register("loaddeck.history", () => open("history"));
  register("loaddeck.compare", () => open("compare"));
  register("loaddeck.saved", async () => {
    await refresh();
    await open("saved");
  });
  register("loaddeck.save", () => save(draft));
  register("loaddeck.stop", () => runner.stop());
  register("loaddeck.check", async () => {
    await open();
    await check();
  });
  register("loaddeck.runFile", () => runFile());
  register("loaddeck.runScenarios", () => runFile(undefined, true));
  register("loaddeck.runCurrent", (uri?: vscode.Uri) =>
    runFile(uri ?? vscode.window.activeTextEditor?.document.uri),
  );
  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider(
      "loaddeck.navigation",
      new Navigation(),
    ),
    { dispose: () => runner.dispose() },
  );
}
function requireHome(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
}
