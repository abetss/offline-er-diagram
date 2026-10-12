# DBML Diagrams for VS Code

View DBML as interactive database diagrams, offline.

## VS Code

Search **DBML Diagrams** by **Abidghods** in Extensions, or install `dbml-diagrams-0.1.2.vsix` from the repo root using **Extensions → … → Install from VSIX…**:

```sh
code --install-extension dbml-diagrams-0.1.2.vsix
```

Click a `.dbml` file to open its diagram. **Edit source** opens syntax-highlighted DBML beside it; the diagram follows unsaved edits. Drag tables, toggle **Notes** or **Comments**, or **Export SVG**. **Comments** shows column notes beside their types.

## Install the app

From the repo root on macOS, with Node.js 22.12+, Rust, and Xcode Command Line Tools installed:

```sh
npm ci
npm ci --prefix frontend
./bin/dbml build
cp -R "src-tauri/target/release/bundle/macos/DBML Diagrams.app" /Applications/
```

Open **DBML Diagrams** from Applications. Paste DBML, open a file, or choose **Open Folder** to open every DBML file, including subfolders. Export SVG, PNG, or Mermaid.

## CLI and agent skill

From the repo root (Rust required; the parser builds automatically on first use):

```sh
./bin/dbml open fixtures/todo.dbml
./bin/dbml mermaid fixtures/todo.dbml > schema.mmd
./bin/dbml json fixtures/todo.dbml
./bin/dbml help
```

`open` requires the app built above. `mermaid` and `json` also accept DBML on stdin.

Install the agent skill for Codex:

```sh
mkdir -p ~/.codex/skills
cp -R skills/dbml-db-schema ~/.codex/skills/
```

For Claude Code, use `~/.claude/skills` instead. Set `DBML=` in the copied `SKILL.md` to this repo's absolute `bin/dbml` path, then restart your agent.

Example prompt: “Use dbml-db-schema to open schema.dbml and generate a Mermaid diagram for my docs.”
