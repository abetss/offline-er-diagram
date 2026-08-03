# Task Breakdown (Executor Handoff)

Ordered, self-contained tasks. Every task names its inputs (docs sections + prior task outputs),
outputs (files), and verification. **S-tasks are shared** by both stacks; A-tasks are Tauri-only,
B-tasks Electron-only. After S1 the parser lane (A1/B1) and the frontend lane (S2→S9) run in
parallel — the fixtures ARE the contract.

Dependency graph:

```
S1 ─┬─► S2 ─► S3 ─► S4 ─┬─► S5 ─► S6 ─► S7 ─► S8 ─► S9
    │                   └─► S10 (parallel with S5..S9)
    ├─► A1 ─► A2 ─► A3 ─► A4        (Option A lane; A2 also needs S10)
    └─► B1 ─► B2 ─► B3 ─► B4        (Option B lane; B2 also needs S10)
```

## Shared tasks

### S1 — Fixtures (contract lock) — BLOCKING, do first
- **Input:** Appendix A below; `dbml-grammar.md` §10; `data-contract.md` §1.
- **Output:** `fixtures/sample.dbml`, `fixtures/sample.expected.json` (from grammar §10),
  `fixtures/demo.dbml`, `fixtures/demo.expected.json` (from Appendix A). Copy verbatim.
- **Verify:** both `.json` files pass `python3 -m json.tool`; content diffs clean against the docs.

### S2 — Frontend scaffold + contract types
- **Input:** `data-contract.md` §2; `layout-and-render.md` §1; `design.md` §2.
- **Output:** `frontend/` Vite+TS project; `src/contract.ts`; `src/theme.ts` (all §1 constants);
  vitest configured; a test that imports `fixtures/demo.expected.json` typed as `Schema`.
- **Verify:** `npm run build` and `npx tsc --noEmit` pass; vitest green.

### S3 — Pure layout
- **Input:** `layout-and-render.md` §2–§5, §12.
- **Output:** `src/layout.ts` (`layout(schema, measure)` + card sizing helpers).
- **Verify:** vitest with stub measure `7.2 × len`: layout-doc §12 assertions — sample: both tables
  layer 0, subscriptions above boosts, no overlaps; demo: layers `[users,organization] /
  [subscriptions,caregiver_profiles] / [reviews]`; positions unaffected by `showNotes`.

### S4 — Static card rendering + preview harness
- **Input:** `layout-and-render.md` §3, §7, §8; `design.md` §1.
- **Output:** `src/render.ts` (cards only, notes off, no edges); `frontend/preview.html` —
  standalone page (works via `file://` or vite dev) that inlines BOTH expected-JSON fixtures with a
  switcher and calls `render`.
- **Verify (browser, demo fixture):** 5 cards, distinct header colors, rounded headers; pk rows
  bold + key icon; link icon on all 5 FK columns; types right-aligned; `geography(Point,4326)`
  visible or cleanly `…`-truncated; sample fixture shows 2 cards.

### S5 — Edges: splines + markers
- **Input:** `layout-and-render.md` §4, §9.
- **Output:** edge rendering in `src/render.ts`; preview gains a "scramble positions" button (cycles
  a few hardcoded `positions` presets to exercise left/right/same-side routing).
- **Verify (browser, demo):** 5 edges; 2 dashed (`subscriptions.user_id→users.id`,
  `reviews.author_id→users.id`); crow's foot on many ends, tick on one ends; the `-` ref
  (caregiver_profiles↔users) has ticks both ends; same-side C-curve appears in a scrambled preset;
  sample fixture: **zero** edges (all dangling). Unit test: side-selection cases (layout doc §12.3).

### S6 — Notes toggle
- **Input:** `layout-and-render.md` §8.5, §9.2, §11.
- **Output:** `showNotes` plumbed through render (table note blocks, column badges + `<title>`,
  edge labels); preview checkbox.
- **Verify (browser, demo):** toggle ON → users' table note text, badges on noted columns with
  hover tooltip, edge labels `(the seeker)` and `employer`; OFF → none of it; card x/y unchanged
  either way (compare transforms).

### S7 — Group boxes
- **Input:** `layout-and-render.md` §10.
- **Verify (browser):** demo: tinted dashed box + "Billing" label around subscriptions+reviews only,
  under edges/tables; sample: box around its 2 defined members (unknown members skipped).

### S8 — Pan / zoom / fit
- **Input:** `layout-and-render.md` §6, §11.
- **Output:** `src/interaction.ts` (viewport state, wheel/pointer handlers, `setViewport` fast path);
  preview wires it + Fit button.
- **Verify (browser):** ctrl/cmd-wheel and pinch zoom anchored at cursor; plain wheel pans;
  background drag pans; dbl-click + Fit button fit content; zoom clamps at 0.1/4.

### S9 — Table drag
- **Input:** `layout-and-render.md` §11; `moveTable` fast path.
- **Verify (browser):** dragging a card re-routes only its edges live and moves its group box;
  <3px click doesn't move; drag works correctly while zoomed (no drift); positions survive a notes
  toggle and a fixture re-render (persistence map).

### S10 — App shell (uses fixture adapter; no real parser needed)
- **Input:** `design.md` §3–§4; `layout-and-render.md` §11.
- **Output:** `frontend/index.html` + `src/app.ts` (left textarea 40%, right diagram; toolbar:
  Notes toggle, Fit; bottom error bar), `src/parse-adapter.ts`,
  `src/adapters/fixture.ts` (returns demo schema; returns `ok:false, line 1` if text contains `!!`),
  adapter chosen via `import.meta.env.VITE_ADAPTER` (default `fixture`).
- **Verify:** `npm run dev` → typing (anything) renders demo after 250 ms debounce; typing `!!`
  shows error bar and keeps last diagram; toggle + Fit work.

## Option A — Tauri v2

### A1 — Rust parser crate (parallel with S2–S10)
- **Input:** `dbml-grammar.md` (all); `data-contract.md` §1, §3–§4; `fixtures/`.
- **Output:** `parser-rs/` cargo lib: `model.rs` (contract §3 verbatim), `tokenizer.rs`,
  `parser.rs`, `pub fn parse_dbml(&str) -> ParseResult`; bin target `parse` that prints canonical
  compact JSON for a file argument.
- **Verify:** `cargo test`: both goldens deep-equal via `serde_json::Value` against fixture files;
  negative tests for every grammar §9 row (assert `ok:false` + line); from-note dedup and alias
  resolution unit tests.

### A2 — Tauri scaffold + command
- **Input:** `design.md` §4; A1; S10. Fetch current Tauri v2 scaffolding docs before starting.
- **Output:** `src-tauri/` app depending on `parser-rs` (path dep); `#[tauri::command] parse_dbml`;
  `src/adapters/tauri.ts` (`invoke('parse_dbml', {text})`); config pointing at `frontend/`.
- **Verify:** `cargo tauri dev` opens the S10 UI; devtools:
  `await invoke('parse_dbml',{text:'Table t {\n id int\n}'})` returns `ok:true` with 1 table.

### A3 — Integration
- **Verify (in `cargo tauri dev`, `VITE_ADAPTER=tauri`):** paste `sample.dbml` → 2 tables, 1 group
  box, **0 edges**, no error; paste `demo.dbml` → 5 tables, 5 edges (2 dashed), Billing box; notes
  toggle shows all three note kinds; introduce a typo → error bar with correct line, last-good
  diagram retained; drag + zoom still work after re-parse.

### A4 — Package
- **Verify:** `cargo tauri build` produces a launchable `.app`; A3 smoke passes in the built app.

## Option B — Electron

### B1 — TS parser package (parallel with S2–S10)
- **Input:** same as A1.
- **Output:** `parser-ts/` package: `tokenizer.ts`, `parser.ts`, `export function
  parseDbml(text: string): ParseResult`; canonical `stringify` helper (contract §1).
- **Verify:** vitest mirror of A1's verification (goldens deep-equal, §9 negatives, dedup/alias
  tests) plus: canonical bytes of demo output round-trip `JSON.parse` to the golden value.

### B2 — Electron scaffold
- **Input:** `design.md` §4; B1; S10. Fetch current Electron + electron-builder docs before starting.
- **Output:** `electron/main.ts` (BrowserWindow, `contextIsolation:true`, `nodeIntegration:false`,
  loads Vite dev/build), empty `preload.ts`; `src/adapters/electron.ts` = re-export of
  `parser-ts/parseDbml` (runs in renderer; **no IPC**).
- **Verify:** app window opens the S10 UI; parse works with devtools network/IPC silent.

### B3 — Integration
- **Verify:** identical checklist to A3 (run with `VITE_ADAPTER=electron`).

### B4 — Package
- **Verify:** electron-builder `.dmg`/`.app` launches; B3 smoke passes in the built app.

### X1 — Cross-parser conformance (only if BOTH stacks get built)
- **Verify:** script runs `parser-rs` bin and `parser-ts` on each fixture; canonical bytes equal.

---

## Appendix A — Fixture sources (S1 copies these verbatim)

### A.1 `fixtures/sample.dbml`

```
Table subscriptions {
  id uuid [pk, note: 'UUIDv7']
  user_id uuid [not null, note: 'FK -> users.id (the seeker)']
  stripe_subscription_id text [unique]
  plan text
  status text
  current_period_end timestamptz
  created_at timestamptz
  updated_at timestamptz

  Note: '[DESIGNED] (F6+, DORMANT at launch) Seeker Stripe Billing subscription. Entitlement is a FUNCTION not a table: can_message(seeker) = !PAYWALL_ENABLED || has_active_subscription(seeker) — hence no entitlements table exists. Flag lives in app_config.'
}

Table boosts {
  id uuid [pk, note: 'UUIDv7']
  caregiver_id uuid [not null, note: 'FK -> caregiver_profiles.user_id']
  starts_at timestamptz
  ends_at timestamptz

  Note: '[DESIGNED] (dark seam, v1.1) Caregiver-paid featured placement. Adds one ranking term when active; table pre-wired, feature dark at MVP.'
}

Ref: caregiver_profiles.organization_id > organization.id

TableGroup Billing {
  subscriptions
  boosts
  reviews
  organization
}
```

`fixtures/sample.expected.json` = `dbml-grammar.md` §10 verbatim.

### A.2 `fixtures/demo.dbml` (renderable fixture: real edges, all ref sources, all note kinds)

```
Project upliv_demo {
  database_type: 'PostgreSQL'
}

Table users {
  id uuid [pk, note: 'UUIDv7']
  email varchar(200) [not null, unique]
  display_name text
  created_at timestamptz [default: `now()`]

  Note: 'All humans in the system.'
}

Table caregiver_profiles {
  user_id uuid [pk, ref: - users.id]
  organization_id uuid
  bio text
  hourly_rate numeric(10,2)
  location geography(Point,4326)
}

Table organization {
  id uuid [pk]
  name text [not null]
}

Table subscriptions {
  id uuid [pk]
  user_id uuid [not null, note: 'FK -> users.id (the seeker)']
  status text
  current_period_end timestamptz
}

Table reviews {
  id uuid [pk]
  author_id uuid [not null, note: 'FK -> users.id']
  caregiver_id uuid [not null]
  rating int
  body text [note: 'Free-text review body']
}

Ref: caregiver_profiles.organization_id > organization.id [note: 'employer']
Ref: reviews.caregiver_id > caregiver_profiles.user_id

TableGroup Billing {
  subscriptions
  reviews
}
```

### A.3 `fixtures/demo.expected.json`

```json
{
  "tables": [
    {
      "name": "users",
      "note": "All humans in the system.",
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": "UUIDv7", "isFk": false },
        { "name": "email", "type": "varchar(200)", "pk": false, "notNull": true, "unique": true, "note": null, "isFk": false },
        { "name": "display_name", "type": "text", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "created_at", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false }
      ]
    },
    {
      "name": "caregiver_profiles",
      "note": null,
      "columns": [
        { "name": "user_id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": true },
        { "name": "organization_id", "type": "uuid", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": true },
        { "name": "bio", "type": "text", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "hourly_rate", "type": "numeric(10,2)", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "location", "type": "geography(Point,4326)", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false }
      ]
    },
    {
      "name": "organization",
      "note": null,
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false },
        { "name": "name", "type": "text", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": false }
      ]
    },
    {
      "name": "subscriptions",
      "note": null,
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false },
        { "name": "user_id", "type": "uuid", "pk": false, "notNull": true, "unique": false, "note": "FK -> users.id (the seeker)", "isFk": true },
        { "name": "status", "type": "text", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "current_period_end", "type": "timestamptz", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false }
      ]
    },
    {
      "name": "reviews",
      "note": null,
      "columns": [
        { "name": "id", "type": "uuid", "pk": true, "notNull": true, "unique": false, "note": null, "isFk": false },
        { "name": "author_id", "type": "uuid", "pk": false, "notNull": true, "unique": false, "note": "FK -> users.id", "isFk": true },
        { "name": "caregiver_id", "type": "uuid", "pk": false, "notNull": true, "unique": false, "note": null, "isFk": true },
        { "name": "rating", "type": "int", "pk": false, "notNull": false, "unique": false, "note": null, "isFk": false },
        { "name": "body", "type": "text", "pk": false, "notNull": false, "unique": false, "note": "Free-text review body", "isFk": false }
      ]
    }
  ],
  "refs": [
    { "fromTable": "caregiver_profiles", "fromColumn": "user_id", "toTable": "users", "toColumn": "id", "relation": "-", "note": null, "source": "inline" },
    { "fromTable": "subscriptions", "fromColumn": "user_id", "toTable": "users", "toColumn": "id", "relation": ">", "note": "(the seeker)", "source": "from-note" },
    { "fromTable": "reviews", "fromColumn": "author_id", "toTable": "users", "toColumn": "id", "relation": ">", "note": null, "source": "from-note" },
    { "fromTable": "caregiver_profiles", "fromColumn": "organization_id", "toTable": "organization", "toColumn": "id", "relation": ">", "note": "employer", "source": "explicit" },
    { "fromTable": "reviews", "fromColumn": "caregiver_id", "toTable": "caregiver_profiles", "toColumn": "user_id", "relation": ">", "note": null, "source": "explicit" }
  ],
  "groups": [
    { "name": "Billing", "tables": ["subscriptions", "reviews"] }
  ]
}
```
