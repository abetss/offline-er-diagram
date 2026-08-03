# DBML Grammar (Supported Subset)

Defines exactly what both parsers accept and how each construct maps to the `Schema` contract
(`data-contract.md`). Anything not listed here is out of scope; §9 lists constructs that must
produce a *clean error* and §7 lists constructs that are *recognized and skipped*.

Parsing is a single pass: tokenizer → recursive-descent parser → post-passes
(alias resolution, from-note dedup, `isFk` computation). Fail-fast: first error aborts with
`ParseError {line, column, message}` (1-based).

## 1. Tokenization

Input is UTF-8 text. Tokens (with line/column of their first character):

| Token | Rule |
|---|---|
| `COMMENT` | `//` to end of line. Discarded. (`/* */` block comments: also discard, non-nesting — trivial and appears in the wild.) |
| `STRING` | See §1.1. |
| `IDENT` | `[A-Za-z_][A-Za-z0-9_]*`, OR double-quoted: `"..."` (any chars except `"` and newline; no escapes; value is the inner text). Keywords (`Table`, `Ref`, `Note`, `TableGroup`, `Project`, `Enum`, `Indexes`, `as`) are matched case-insensitively but only where grammar expects them; elsewhere they are ordinary IDENTs. |
| `FUNCEXPR` | Backtick expression `` `...` `` (for `default:` values). Discarded after parse. |
| `NUMBER` | `-?[0-9]+(\.[0-9]+)?` (only used in `default:` values and type params). |
| Symbols | `{ } [ ] ( ) : , .` and relation ops `>` `<` `-` `<>` (longest-match: `<>` before `<`). |
| `NEWLINE` | Significant **inside** `Table`, `TableGroup`, and `Ref { }` block bodies (statement separator). Ignored everywhere else, and ignored inside `[...]` and `(...)` groups. Blank lines collapse. |
| Whitespace | Spaces/tabs separate tokens, otherwise discarded. |

### 1.1 Strings
- **Single-quoted** `'...'`: backslash escapes `\'` → `'` and `\\` → `\`; any other backslash is a
  literal backslash. May not contain a raw newline.
- **Triple-quoted** `'''...'''`: spans lines, terminates at the first `'''`, no escapes. Post-process:
  1. If the first character is `\n`, drop it.
  2. Compute the minimum count of leading spaces over all non-empty lines; strip that many
     leading spaces from every line (dedent).
  3. Trim trailing whitespace/newlines from the end.
- **Double-quoted** `"..."`: primarily a quoted `IDENT` (name/type/alias — see §1 table), but dbdiagram
  also accepts it as a **string value** in `note:`/`Note:`/`default:` positions. In a string-value
  position its value is the inner text (`"` terminates; no escapes), same as a quoted-ident value.

## 2. Top-level grammar

```
document      := (table | ref_stmt | ref_block | table_group | skipped_block)*
skipped_block := project_block | enum_block | sticky_note        // see §7
```

## 3. `Table`

```
table       := "Table" name alias? settings? "{" NEWLINE table_body "}"
name        := IDENT                       // 2-part "schema.table" → error (§9)
alias       := "as" IDENT
settings    := "[" ... "]"                 // accepted, contents ignored (headercolor etc.)
table_body  := (column_line | table_note | indexes_block | NEWLINE)*
```

- `alias` registers `alias → name` in an alias map. Post-pass rewrites every ref endpoint through
  this map, so `Schema` only ever contains canonical table names. Duplicate table name or alias → error.
- **`table_note`** := `"Note" ":" STRING` on its own line. Maps to `Table.note`. Second table note → error.
- **`indexes_block`** := `"Indexes" "{" ... "}"` (case-insensitive) — recognized, contents skipped
  to the matching `}`.

### 3.1 Column line

```
column_line := col_name col_type col_settings? NEWLINE
col_name    := IDENT
col_type    := IDENT ( "(" type_params ")" )?
type_params := anything up to the matching ")" (idents, numbers, commas; no nesting)
```

`Column.type` is the **verbatim source slice** from the start of the type ident through the closing
`)` (whitespace as written, e.g. `numeric(10, 2)` keeps its space). Multi-word unquoted types
(`double precision`) are not supported — quote them (`"double precision"`); the quoted value is the type.

### 3.2 Column settings

```
col_settings := "[" setting ("," setting)* "]"
setting      := "pk" | "primary" "key" | "not" "null" | "null" | "unique" | "increment"
              | "default" ":" (STRING | NUMBER | IDENT | FUNCEXPR)   // parsed, discarded
              | "note" ":" STRING                                    // → Column.note
              | "ref" ":" relation qualified                         // inline ref
relation     := ">" | "<" | "-" | "<>"
qualified    := IDENT "." IDENT                                      // table.column
```

Mapping: `pk`/`primary key` → `pk: true`; `not null` → `notNull: true` (also implied by pk,
contract §4.2); `null` → no-op; `unique` → `unique: true`; `increment` → discarded.
Unknown setting word → error. Duplicate settings are idempotent (no error).

**Inline ref** emits `Ref { fromTable: <current table canonical name>, fromColumn: <this column>,
toTable, toColumn, relation, note: null, source: "inline" }` at this source position.

## 4. Standalone `Ref`

```
ref_stmt   := "Ref" IDENT? ":" ref_body ref_settings?
ref_block  := "Ref" IDENT? "{" NEWLINE (ref_body ref_settings? NEWLINE)* "}"
ref_body   := qualified relation qualified
ref_settings := "[" rs ("," rs)* "]"
rs         := "note" ":" STRING            // → Ref.note
            | ("delete" | "update") ":" IDENT   // cascade etc.; parsed, discarded
```

The optional ref name (IDENT) is parsed and discarded. Each `ref_body` emits a `Ref` with
`source: "explicit"`, `note` from settings or `null`. 3-part qualified names (`schema.table.col`)
and composite refs (`(a,b) > (c,d)`) → error (§9).

## 5. `TableGroup`

```
table_group := "TableGroup" IDENT settings? "{" NEWLINE (IDENT NEWLINE?)* "}"
```

Members are whitespace/newline-separated table names → `TableGroup { name, tables }` in written
order. Members may name tables not defined in the document (kept in output; renderer skips unknowns).
`settings` accepted and ignored.

## 6. FK-in-note extraction (the critical custom rule)

Applies to **column notes only** (`note: '...'` in column settings) — never to table, group, or ref
notes. After string processing, run this regex (first match only, case-insensitive `FK`):

```
/(?:^|[^A-Za-z0-9_])[Ff][Kk]\s*(?:->|→)\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/
```

- Group 1 = target table (resolved through the alias map), group 2 = target column.
- Emits `Ref { fromTable: <current table>, fromColumn: <this column>, toTable, toColumn,
  relation: ">", note: <remainder>, source: "from-note" }` at the column's source position,
  where `<remainder>` = the note text after the matched `<table>.<column>`, trimmed;
  `null` if empty. E.g. `'FK -> users.id (the seeker)'` → ref note `"(the seeker)"`.
- The column's `note` field keeps the **full original text** (the FK pattern is not stripped).
- The word-boundary guard prevents matches inside words (e.g. `RFK ->` does not match). A note
  merely *mentioning* "FK" without the `-> table.col` shape emits nothing.
- Dedup against explicit/inline refs per contract §4.3.

## 7. Recognized-and-skipped constructs

Parsed only far enough to skip cleanly (balanced `{ }`); nothing emitted:

- `Project IDENT? { ... }`
- `Enum IDENT { ... }` (columns typed with the enum just carry the enum name as `type`)
- Sticky notes: top-level `Note IDENT { ... }`
- Table settings `[...]`, TableGroup settings `[...]`, `Indexes { ... }` inside tables

## 8. Dangling references (MUST NOT error)

Refs, from-note refs, and group members may name tables/columns that are not defined in the
document (users paste partial schemas). The parser keeps them verbatim in `Schema`; the renderer
skips edges with a missing endpoint table and skips unknown group members
(`layout-and-render.md` §7). Column existence is never validated, even on defined tables.

## 9. Explicit errors (fail-fast, with message text)

| Input | Error message |
|---|---|
| Unknown top-level construct | `Unexpected '<word>' at top level` |
| `schema.table` qualified table names (2-part in Table, 3-part in refs) | `Schema-qualified names are not supported` |
| Composite refs `(a,b) > (c,d)` | `Composite foreign keys are not supported` |
| Unknown column setting | `Unknown column setting '<word>'` |
| Unterminated string / `'''` / `{` / `[` | `Unterminated <thing> (opened at line N)` |
| Duplicate table name/alias | `Duplicate table name '<name>'` |
| Column line without a type | `Column '<name>' is missing a type` |

## 10. Golden fixture: `fixtures/sample.dbml`

The verbatim sample from the product brief (subscriptions/boosts/Ref/TableGroup — full text in
`task-breakdown.md` Appendix A.1; task S1 copies it into `fixtures/sample.dbml`). **Expected parse** (`fixtures/sample.expected.json`,
pretty-printed; canonical form is compact per contract §1):

```json
{
  "tables": [
    {
      "name": "subscriptions",
      "note": "[DESIGNED] (F6+, DORMANT at launch) Seeker Stripe Billing subscription. Entitlement is a FUNCTION not a table: can_message(seeker) = !PAYWALL_ENABLED || has_active_subscription(seeker) — hence no entitlements table exists. Flag lives in app_config.",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": "UUIDv7", "isFk": false },
        { "name": "user_id", "type": "uuid", "pk": false, "notNull": true, "unique": false, "note": "FK -> users.id (the seeker)", "isFk": true },
        { "name": "stripe_subscription_id", "type": "text", "pk": false, "notNull": false, "unique": true, "note": null, "isFk": false },
        { "name": "plan", "type": "text", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "status", "type": "text", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "current_period_end", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "created_at", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "updated_at", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false }
      ]
    },
    {
      "name": "boosts",
      "note": "[DESIGNED] (dark seam, v1.1) Caregiver-paid featured placement. Adds one ranking term when active; table pre-wired, feature dark at MVP.",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": "UUIDv7", "isFk": false },
        { "name": "caregiver_id", "type": "uuid", "pk": false, "notNull": true, "unique": false, "note": "FK -> caregiver_profiles.user_id", "isFk": true },
        { "name": "starts_at", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "ends_at", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false }
      ]
    }
  ],
  "refs": [
    { "fromTable": "subscriptions", "fromColumn": "user_id", "toTable": "users", "toColumn": "id", "relation": ">", "note": "(the seeker)", "source": "from-note" },
    { "fromTable": "boosts", "fromColumn": "caregiver_id", "toTable": "caregiver_profiles", "toColumn": "user_id", "relation": ">", "note": null, "source": "from-note" },
    { "fromTable": "caregiver_profiles", "fromColumn": "organization_id", "toTable": "organization", "toColumn": "id", "relation": ">", "note": null, "source": "explicit" }
  ],
  "groups": [
    { "name": "Billing", "tables": ["subscriptions", "boosts", "reviews", "organization"] }
  ]
}
```

Points executors commonly get wrong, all visible above: `pk` forces `notNull: true`; the FK note
stays verbatim on the column while also emitting a dashed-renderable `from-note` ref; ref note is
the trimmed remainder `"(the seeker)"`; all three refs and two group members are dangling and are
**kept**; ref order = column position, column position, explicit statement; em dash `—` in the table
note survives verbatim as raw UTF-8.

A second fixture (`demo.dbml` / `demo.expected.json`) exercising inline refs, `Ref` settings notes,
aliases-free happy path, and *renderable* edges lives in `task-breakdown.md` Appendix A.
