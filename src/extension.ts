import * as vscode from "vscode";
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("loaddeck.open", () =>
      vscode.window.showInformationMessage("LoadDeck is building."),
    ),
  );
}
