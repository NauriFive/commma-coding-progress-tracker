import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const signIn = vscode.commands.registerCommand("commma.signIn", async () => {
    vscode.window.showInformationMessage("commma: sign-in not implemented yet");
  });

  context.subscriptions.push(signIn);
}

export function deactivate() {}
