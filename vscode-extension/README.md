# DBML Diagrams for VS Code

Click a `.dbml` file in VS Code's Explorer to view its database diagram. The extension uses the same Rust parser, table cards, relationship lines, and layout as the DBML Diagrams desktop app. It runs offline and includes its parser, so users do not need Rust or the desktop app.

## Install

In VS Code's Extensions view, select **… > Install from VSIX…** and choose `dbml-diagrams-0.1.0.vsix` from this folder. You can also install it from a terminal:

```sh
code --install-extension vscode-extension/dbml-diagrams-0.1.0.vsix
```

Open a `.dbml` file. If you previously chose another default editor for DBML, right-click the tab and select **Reopen Editor With… > DBML Diagram**. Use **Configure default editor** in that picker to make diagrams the default.

## Use

- **Edit source** opens the DBML text beside the diagram. The diagram follows unsaved edits.
- Drag a table to move it. Drag the background or scroll to pan. Ctrl/Cmd + scroll zooms.
- **Fit**, double-clicking the canvas, or pressing **F** while the canvas has focus fits the diagram.
- **Reset layout** removes manual table positions. **Notes** displays table and column notes.
- **Export SVG** saves the current diagram view to a file you choose.
- Invalid DBML displays its line and column and adds a VS Code problem. The last valid diagram stays visible until the source is fixed.

Open multiple files to get separate VS Code diagram tabs. Manual table positions and the Notes setting survive hiding a tab. They do not change the DBML file.

The parser supports the same DBML subset as the desktop app. See `docs/dbml-grammar.md` in the source repository for supported constructs.

## Build from source

From the repository root:

```sh
npm ci --prefix frontend
npm ci --prefix vscode-extension
rustup target add wasm32-unknown-unknown
npm run extension:package
```

This compiles the Rust parser to WebAssembly, bundles the shared frontend renderer and the extension host, and creates `vscode-extension/dbml-diagrams-0.1.0.vsix`. Building needs Rust and Node.js 22 or later. The package itself works on macOS, Linux, and Windows in VS Code 1.96 or later. The build script detects this repo's Homebrew Rust installation on macOS; set `DBML_CARGO` to select another Cargo executable.

Open the repository in VS Code and press **F5** with **Run DBML Diagrams extension** selected to launch a separate Extension Development Host. The build task runs first and the `fixtures` folder opens for testing.

## Verify

```sh
npm run extension:build
npm --prefix vscode-extension test
npm --prefix frontend test
npm --prefix vscode-extension run test:integration
```

The integration command launches a temporary VS Code profile and workspace. Set `DBML_VSCODE_EXECUTABLE` to the VS Code executable to use an existing installation. Otherwise the test runner downloads VS Code. On macOS:

```sh
DBML_VSCODE_EXECUTABLE="/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  npm --prefix vscode-extension run test:integration
```
