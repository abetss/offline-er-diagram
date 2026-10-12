import * as vscode from 'vscode';

export async function openSourceEditor(document: vscode.TextDocument): Promise<vscode.TextEditor> {
  const diagramColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
  await vscode.commands.executeCommand('workbench.action.focusLeftGroup');
  if (vscode.window.tabGroups.activeTabGroup.viewColumn === diagramColumn) {
    await vscode.commands.executeCommand('workbench.action.newGroupLeft');
  }
  return vscode.window.showTextDocument(document, {
    viewColumn: vscode.window.tabGroups.activeTabGroup.viewColumn,
    preview: false,
  });
}
