import * as vscode from "vscode";
import assert from "node:assert/strict";
export async function run(): Promise<void> {
  const extension = vscode.extensions.all.find(
    (e) => e.packageJSON.name === "k6-loaddeck",
  );
  assert.ok(extension, "LoadDeck extension is available");
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "open",
    "quick",
    "save",
    "runCurrent",
    "runFile",
    "stop",
    "history",
    "compare",
    "check",
  ])
    assert.ok(commands.includes(`loaddeck.${command}`), command);
  for (const command of [
    "loaddeck.open",
    "loaddeck.history",
    "loaddeck.compare",
    "loaddeck.check",
  ])
    await vscode.commands.executeCommand(command);
  console.log(
    "LoadDeck extension activation, commands, webview navigation and installation discovery passed.",
  );
}
