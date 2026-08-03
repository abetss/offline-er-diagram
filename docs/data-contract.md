# Data Contract: `Schema` JSON

This is the single source of truth for the parser output = renderer input. The Rust parser (Option A)
and the TS parser (Option B) MUST produce **byte-identical canonical JSON** for the same input.
The renderer consumes only this shape; it never sees DBML text.

## 1. Canonical JSON rules (required for byte-identity)

1. **Key order** is exactly the declaration order given below (serde emits struct order; TS must
   construct object literals in the same order).
2. **Optional fields are always present**, emitted as `null` when absent. Never omit keys.
   (Rust: no `skip_serializing_if`. TS: assign `null` explicitly.)
3. **Booleans are always present** (`pk`, `notNull`, `unique`, `isFk` — never omitted, never null).
4. Canonical bytes = compact serialization, no whitespace: `JSON.stringify(schema)` /
   `serde_json::to_string(&schema)`. UTF-8, non-ASCII characters emitted raw (both defaults do this).
5. There are no numbers in `Schema` (only in `ParseError`), so no float-formatting divergence exists.
6. Arrays preserve the deterministic ordering rules in §5.

Checked-in golden files (`fixtures/*.expected.json`) are pretty-printed for readability; tests
compare **parsed-value deep equality** against the golden file AND (cross-parser) **byte equality**
of the canonical compact form.

## 2. TypeScript definitions (`frontend/src/contract.ts`)

```ts
export interface Schema {
  tables: Table[];
  refs: Ref[];
  groups: TableGroup[];
}

export interface Table {
  name: string;          // canonical table name (never the alias)
  note: string | null;   // table-level Note, verbatim after string processing
  columns: Column[];
}

export interface Column {
  name: string;
  type: string;          // verbatim source slice incl. params, e.g. "numeric(10,2)", "geography(Point,4326)"
  pk: boolean;
  notNull: boolean;      // true if `not null` OR `pk` (normalized; see §4.2)
  unique: boolean;
  note: string | null;   // full original note text, INCLUDING any "FK -> t.c" prefix
  isFk: boolean;         // derived; see §4.1
}

export type Relation = '>' | '<' | '-' | '<>';
export type RefSource = 'explicit' | 'inline' | 'from-note';

export interface Ref {
  fromTable: string;
  fromColumn: string;
  toTable: string;       // may name a table NOT present in tables[] (dangling refs are legal)
  toColumn: string;
  relation: Relation;    // as written in source; NOT normalized/flipped
  note: string | null;
  source: RefSource;
}

export interface TableGroup {
  name: string;
  tables: string[];      // member names as written; may include undefined tables
}

// ---- Parse envelope (what the parse call returns) ----

export interface ParseError {
  line: number;          // 1-based
  column: number;        // 1-based
  message: string;
}

export interface ParseResult {
  ok: boolean;
  schema: Schema | null;     // present iff ok
  error: ParseError | null;  // present iff !ok; parser is fail-fast: first error only
}
```

## 3. Rust definitions (Option A, `parser-rs/src/model.rs`)

```rust
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Schema {
    pub tables: Vec<Table>,
    pub refs: Vec<Ref>,
    pub groups: Vec<TableGroup>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Table {
    pub name: String,
    pub note: Option<String>,
    pub columns: Vec<Column>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    pub pk: bool,
    pub not_null: bool,    // serializes as "notNull"
    pub unique: bool,
    pub note: Option<String>,
    pub is_fk: bool,       // serializes as "isFk"
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ref {
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub relation: String,  // ">", "<", "-", "<>"
    pub note: Option<String>,
    pub source: String,    // "explicit" | "inline" | "from-note"
}

#[derive(Serialize, Debug, PartialEq)]
pub struct TableGroup {
    pub name: String,
    pub tables: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ParseError {
    pub line: u32,
    pub column: u32,
    pub message: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ParseResult {
    pub ok: bool,
    pub schema: Option<Schema>,
    pub error: Option<ParseError>,
}
```

`relation` and `source` are plain `String` in Rust (not enums) so serialization is trivially
identical to TS; the parser guarantees only the four/three legal values are ever produced.
`Option::None` serializes as `null` (rule 2 satisfied by default — do NOT add `skip_serializing_if`).

## 4. Derivation rules (parser-side, so the renderer stays dumb)

### 4.1 `isFk`
A column's `isFk` is `true` iff it is the **FK-side** endpoint of at least one ref in `refs`:

| relation | FK side |
|---|---|
| `>`  | `fromTable.fromColumn` |
| `<`  | `toTable.toColumn` |
| `-`  | `fromTable.fromColumn` (convention) |
| `<>` | both sides |

The referenced ("one") side does **not** get `isFk`. `isFk` is set even when the ref's other
endpoint names a table that is not defined in the document (dangling refs — see grammar doc §8).

### 4.2 `notNull` normalization
`notNull = true` if the column has `not null` OR is `pk` (`pk`/`primary key` implies NOT NULL).
No other normalization: `unique` is NOT inferred from `pk`.

### 4.3 From-note dedup
After parsing, drop any `source: "from-note"` ref whose 4-tuple
`(fromTable, fromColumn, toTable, toColumn)` equals that of an existing `explicit` or `inline` ref
(relation ignored in the comparison). The explicit/inline ref wins.

### 4.4 Ordering (deterministic output)
- `tables`: document order. `columns`: document order within the table. `groups`: document order;
  `groups[].tables`: order written in the group body.
- `refs`: source order of the construct that created each ref — inline (`[ref: ...]`) and
  from-note refs are emitted at the position of their column definition; explicit `Ref`
  statements/blocks at their statement position. Dedup (§4.3) removes entries without reordering.

## 5. Deviations from the brief (and why)

| Change | Justification |
|---|---|
| **Dropped** `table.group?` | Redundant with `groups[]`; two sources of truth invite drift. Renderer builds a `table → group` lookup in one line. |
| **Added** `'<>'` to `Relation` | Standard DBML many-to-many; 3 extra spec lines vs. a hard parse failure on real-world schemas. Renderer: crow's foot both ends. |
| **Added** `ParseResult` envelope | Live typing produces broken intermediate states constantly; the app needs `{line, column, message}` to show an error bar and keep the last good schema rendered. Fail-fast single error keeps both parsers simple. |
| **Dropped** ref names (`Ref name: ...`, `Ref name { }`) | Parsed and discarded; never rendered. |
| **Parsed-and-discarded**: `increment`, `default:`, table settings, `delete:`/`update:` ref settings, `Indexes` blocks, `Enum`/`Project`/sticky-`Note` blocks | Accepted so real schemas don't error, but not in the contract because nothing renders them. Adding dead fields violates minimality. |

Byte-identity is required for the `Schema` object. For `ParseResult` errors, cross-parser tests
require matching `ok` and `error.line` only — hand-matching error prose across languages is busywork.

## 6. Conformance testing

1. **Golden tests (per parser):** parse `fixtures/sample.dbml` → deep-equal `fixtures/sample.expected.json`;
   parse `fixtures/demo.dbml` → deep-equal `fixtures/demo.expected.json`. (Expected JSON is authored
   in `dbml-grammar.md` §10 and `task-breakdown.md` Appendix A; task S1 extracts them to `fixtures/`.)
2. **Cross-parser byte test (only if both stacks are built):** for each fixture,
   `rust_canonical_bytes == ts_canonical_bytes`.
3. **Negative tests:** each unsupported construct in grammar doc §9 yields `ok: false` with the
   specified error line.
