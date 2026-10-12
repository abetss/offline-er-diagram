---
name: dbml-db-schema
description: Present or document a database schema with the local DBML Diagrams tool. Use when the user wants to (a) view/open/see a DB schema or ER diagram visually, or (b) document a database — generate a Mermaid ER diagram to embed in a markdown doc. Input is DBML.
---

# Present or document a DB schema

Uses the local **DBML Diagrams** tool via its `dbml` CLI. When running it yourself, use the **full
path** (non-interactive shells don't have it on PATH):

```sh
DBML=/Users/abtinghods/Ork/tools/db-diagrams/bin/dbml
```

Run `"$DBML" help` to see all commands. (In the user's own terminal, plain `dbml` also works.)

## Step 1 — get the DBML

- If the user points at a `.dbml` file, use that path.
- If the user gives DBML text (or asks you to write/derive the schema), save it to a `.dbml` file
  first (e.g. `schema.dbml` in the working directory), then use that path below.

## To VIEW / present it → open the desktop app

```sh
"$DBML" open path/to/schema.dbml
```

Launches the native diagram window seeded with the schema. If the app is already open, the file
opens in a new tab (named after the file) instead of a second window. Confirm to the user that it's
open.

## To DOCUMENT it → Mermaid ER diagram in the doc

```sh
"$DBML" mermaid path/to/schema.dbml
```

Take stdout (a Mermaid `erDiagram`) and embed it in the target markdown document inside a fenced
**mermaid** code block, i.e. put the output between a line reading ` ```mermaid ` and a closing
` ``` `. Then keep writing the surrounding documentation. On a parse error the CLI prints
`error (line L:C): message` to stderr (exit 1) — fix the DBML and re-run.
