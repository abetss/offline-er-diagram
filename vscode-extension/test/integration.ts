import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { openSourceEditor } from '../src/source-editor';

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the DBML custom editor');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'Integration test workspace is required');
  const uri = vscode.Uri.joinPath(folder.uri, 'integration.dbml');
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('Table users {\n id int [pk]\n'));

  // Opening a normal resource must select the contributed default custom editor.
  await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
  await waitFor(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) =>
    tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'dbmlDiagrams.diagram'
    && tab.input.uri.toString() === uri.toString(),
  )));
  // A diagnostic proves the webview loaded its script, sent ready, and ran the bundled parser.
  await waitFor(() => vscode.languages.getDiagnostics(uri).some((item) => item.source === 'DBML'));
  const document = await vscode.workspace.openTextDocument(uri);
  assert.equal(document.languageId, 'dbml', 'DBML source must select its contributed language');
  const sourceEditor = await openSourceEditor(document);
  assert.equal(sourceEditor.document.languageId, 'dbml');
  const diagramGroup = () => vscode.window.tabGroups.all.find((group) => group.tabs.some((tab) =>
    tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === uri.toString(),
  ));
  assert.equal(sourceEditor.viewColumn, vscode.ViewColumn.One, 'Edit source must open on the left');
  assert.equal(diagramGroup()?.viewColumn, vscode.ViewColumn.Two, 'Diagram must remain on the right');
  assert.equal(vscode.window.tabGroups.all.length, 2);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'dbmlDiagrams.diagram', {
    viewColumn: diagramGroup()?.viewColumn, preview: false,
  });
  const reopenedSource = await openSourceEditor(document);
  assert.equal(reopenedSource.viewColumn, vscode.ViewColumn.One, 'Repeated clicks must reuse the left source group');
  assert.equal(vscode.window.tabGroups.all.length, 2, 'Repeated clicks must not create more groups');
  const originalText = document.getText();
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(originalText.length)), 'Table users {\n id int [pk]\n}\n');
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  await waitFor(() => vscode.languages.getDiagnostics(uri).length === 0);
  assert.equal(document.isDirty, true, 'Preview must follow unsaved source edits');
  const secondUri = vscode.Uri.joinPath(folder.uri, 'second.DBML');
  await vscode.workspace.fs.writeFile(secondUri, new TextEncoder().encode('Table teams {\n id int\n}'));
  await vscode.commands.executeCommand('dbmlDiagrams.openDiagram', secondUri);
  assert.equal((await vscode.workspace.openTextDocument(secondUri)).languageId, 'dbml');
  await waitFor(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) =>
    tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === secondUri.toString(),
  )));
  assert.equal(document.getText(), 'Table users {\n id int [pk]\n}\n');
  await document.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  process.stdout.write('VS Code integration passed: default file opening, source on the left, repeated source opening, DBML source language, live unsaved updates, error recovery, multiple DBML tabs.\n');
}
