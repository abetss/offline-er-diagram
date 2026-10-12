import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { createParser } from './parser';
import { viewerHtml } from './html';
import { viewerMessageSchema } from './protocol';
import type { HostMessage } from './protocol';
import { openSourceEditor } from './source-editor';

const viewType = 'dbmlDiagrams.diagram';

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('dbml');
  const output = vscode.window.createOutputChannel('DBML Diagrams');
  const parserUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'parser.wasm');
  let parser: ReturnType<typeof createParser> | undefined;
  const getParser = () => {
    parser ??= Promise.resolve(vscode.workspace.fs.readFile(parserUri)).then(createParser).catch((error: unknown) => {
      parser = undefined;
      throw error;
    });
    return parser;
  };

  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, panel) {
      const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');
      panel.webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
      let disposed = false;
      let ready = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const post = (message: HostMessage) => panel.webview.postMessage(message);
      const reportError = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`${document.uri.toString()}: ${message}`);
        if (!disposed) void post({ kind: 'error', message: `Could not display DBML: ${message}` });
      };

      async function update(): Promise<void> {
        if (!ready || disposed) return;
        const version = document.version;
        const text = document.getText();
        try {
          const parse = await getParser();
          if (disposed || document.version !== version) return;
          const result = parse(text);
          if (result.ok) {
            diagnostics.delete(document.uri);
          } else {
            const line = Math.min(result.error.line - 1, document.lineCount - 1);
            const column = Math.min(result.error.column - 1, document.lineAt(line).text.length);
            const range = new vscode.Range(line, column, line, column + 1);
            const diagnostic = new vscode.Diagnostic(range, result.error.message, vscode.DiagnosticSeverity.Error);
            diagnostic.source = 'DBML';
            diagnostics.set(document.uri, [diagnostic]);
          }
          await post({ kind: 'update', version, result });
        } catch (error) {
          reportError(error);
        }
      }

      const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) return;
        clearTimeout(timer);
        timer = setTimeout(() => void update(), 150);
      });
      const messageSubscription = panel.webview.onDidReceiveMessage(async (data: unknown) => {
        const parsed = viewerMessageSchema.safeParse(data);
        if (!parsed.success || disposed) return;
        const message = parsed.data;
        try {
          switch (message.kind) {
            case 'ready':
              ready = true;
              await update();
              break;
            case 'openSource':
              panel.reveal(panel.viewColumn);
              await openSourceEditor(document);
              break;
            case 'exportSvg': {
              const destination = await vscode.window.showSaveDialog({
                defaultUri: document.uri.with({ path: document.uri.path.replace(/\.dbml$/i, '.svg') }),
                filters: { 'SVG diagram': ['svg'] },
                saveLabel: 'Export diagram',
              });
              if (destination) await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(message.svg));
              break;
            }
            default: {
              const exhaustive: never = message;
              return exhaustive;
            }
          }
        } catch (error) {
          reportError(error);
        }
      });
      panel.onDidDispose(() => {
        disposed = true;
        clearTimeout(timer);
        changeSubscription.dispose();
        messageSubscription.dispose();
      });
      panel.webview.html = viewerHtml({
        scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'viewer', 'viewer.js')).toString(),
        styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'viewer', 'viewer.css')).toString(),
        cspSource: panel.webview.cspSource,
        nonce: randomBytes(16).toString('hex'),
      });
    },
  };

  context.subscriptions.push(
    diagnostics,
    output,
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.window.registerCustomEditorProvider(viewType, provider, { supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand('dbmlDiagrams.openDiagram', async (resource?: vscode.Uri) => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const activeUri = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
      let uri = resource ?? activeUri;
      if (!uri || !/\.dbml$/i.test(uri.path)) {
        [uri] = await vscode.window.showOpenDialog({
          canSelectMany: false, filters: { DBML: ['dbml'] }, openLabel: 'Open diagram',
        }) ?? [];
      }
      if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, viewType, { preview: false });
    }),
  );
}
