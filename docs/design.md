# Design: Local DBML ER-Diagram Tool

A native-Mac desktop app: left pane = DBML text editor, right pane = live SVG ER diagram.
Local clone of dbdiagram.io's core. Final stack is Option A (Tauri v2, Rust parser) or
Option B (Electron, TS parser); **everything except the parser host is identical**, so the
design fixes stack-neutral cores first and confines stack choice to one seam.

Companion docs: `data-contract.md` (Schema JSON), `dbml-grammar.md` (parser spec + golden),
`layout-and-render.md` (layout/SVG/interaction), `task-breakdown.md` (executor tasks).

## 1. Architecture principle: pure renderer behind a hard data seam

```
DBML text ──parser (Rust or TS)──► ParseResult{Schema} ──► render(container, schema, options)
```

- The **parser** is the only stack-variant component. Its output is the canonical `Schema` JSON
  (`data-contract.md`), byte-identical across both implementations, locked by shared golden
  fixtures in `fixtures/`.
- The **renderer is a pure function** `render(container, schema, options) → RenderHandle`:
  same `(schema, options)` in, same SVG DOM out. It never parses, fetches, or holds hidden state.
  Consequence: the whole right pane is verifiable standalone in a plain browser via
  `frontend/preview.html`, which inlines a hardcoded parsed fixture (`demo.expected.json`) and
  calls `render` — no app shell, no parser, no Tauri/Electron needed. This is the primary
  verification vehicle for all frontend tasks.
- **Layout** is likewise pure: `layout(schema, measure) → Layout` with an injectable text-measure
  function, so it unit-tests headlessly with a char-count stub (`layout-and-render.md` §12).

## 2. Repository layout

```
db-diagrams/
  docs/                      # these design docs
  fixtures/                  # SHARED golden fixtures (contract lock)
    sample.dbml  sample.expected.json      # the user's real-world sample (grammar doc §10)
    demo.dbml    demo.expected.json        # renderable fixture (task-breakdown Appendix A)
  frontend/                  # stack-neutral: 100% shared between A and B
    preview.html             # standalone renderer harness (open directly in a browser)
    src/contract.ts          # Schema types (data-contract.md §2)
    src/layout.ts            # pure auto-layout
    src/render.ts            # pure SVG renderer
    src/interaction.ts       # pan/zoom/drag controller (owns view state, calls render/fast-paths)
    src/app.ts               # two-pane shell: editor, toolbar (Notes toggle, Fit), error bar
    src/parse-adapter.ts     # interface ParseAdapter { parse(text): Promise<ParseResult> }
    src/adapters/fixture.ts  # dev/test adapter returning a fixture (lets app.ts ship before any parser)
    src/adapters/tauri.ts    # Option A impl
    src/adapters/electron.ts # Option B impl
  parser-rs/                 # Option A only: pure Rust parser crate (no Tauri imports; testable with cargo alone)
  src-tauri/                 # Option A only: Tauri v2 app shell; path-depends on parser-rs
  electron/                  # Option B only: main.ts, preload.ts
  parser-ts/                 # Option B only: pure TS parser package (no Electron imports)
```

Frontend builds with Vite + TypeScript. No UI framework — the app shell is a static two-pane HTML
layout and the diagram is hand-built SVG; React/Vue would add nothing but weight here. Editor is a
`<textarea>` (monospace) in v1; CodeMirror is a possible later upgrade, deliberately out of scope.

## 3. Component responsibilities

| Component | Owns | Must not |
|---|---|---|
| parser (Rust or TS) | DBML → `ParseResult`; all derivations (isFk, notNull, dedup, alias resolution) | know about layout/SVG |
| `layout.ts` | table sizing + positions, group boxes (pure, deterministic) | touch the DOM (measure fn is injected) |
| `render.ts` | build full SVG for `(schema, options)`; expose fast-path updaters (move table, set viewport) | own event listeners or mutable app state |
| `interaction.ts` | pan/zoom/drag state, pointer/wheel events, dragged-position map, re-parse position persistence | build SVG nodes itself |
| `app.ts` | textarea, 250 ms debounce, calls `ParseAdapter.parse`, error bar, last-good-schema policy, Notes toggle & Fit button | parse or lay out anything |
| adapters | one `parse(text)` each | contain parsing logic (Electron adapter just re-exports parser-ts) |

## 4. Parse flow per stack

**Option A — Tauri v2.** Rust hosts the parser as a command:
`#[tauri::command] fn parse_dbml(text: String) -> ParseResult` (serde-serialized).
Frontend: `adapters/tauri.ts` calls `invoke('parse_dbml', { text })`. Flow:
keystroke → debounce 250 ms → `invoke` → `ParseResult` → on `ok` re-layout/render, else error bar +
keep last good diagram. Parser is synchronous and fast (single-pass); no streaming/cancellation
needed — debounce is the backpressure.

**Option B — Electron.** The parser is plain TypeScript (`parser-ts`), so **no IPC is needed at
all**: `adapters/electron.ts` simply imports `parseDbml` from `parser-ts` and runs it in the
renderer process. `main.ts` only creates the `BrowserWindow` (contextIsolation on,
nodeIntegration off); `preload.ts` is empty in v1. Same debounce flow.

**The only per-stack differences:** parser language + test runner (`cargo test` vs `vitest`),
which adapter file is bundled, app packaging (`tauri build` vs electron-builder), and Option A's
serde/invoke hop. Everything in `frontend/` is byte-for-byte shared.

## 5. Verification strategy

1. **Contract lock (first, blocking):** `fixtures/` golden files are written by hand from the docs
   (task S1) *before* parser or renderer work starts. Both tracks build against them in parallel.
2. **Parser goldens:** each parser deep-equals both fixtures' expected JSON; negative tests for
   grammar §9 errors. Rust: `cargo test`; TS: `vitest`. Cross-parser canonical-byte test if both
   stacks get built (contract §6).
3. **Renderer standalone:** open `frontend/preview.html` in a browser — zero app dependencies.
   Each frontend task extends preview.html and its visual checklist (tables → edges → notes toggle
   → groups → pan/zoom → drag). Layout has headless unit tests (determinism, no-overlap).
4. **Integration smoke (per stack):** launch app, paste `sample.dbml`, verify: 2 tables render,
   1 group box, **no edges** (all sample refs are dangling — this is the intended behavior),
   no errors; then paste `demo.dbml` and verify 5 tables + 5 edges incl. dashed from-note edges.
5. **Error path:** type garbage mid-edit → error bar shows line/col, previous diagram stays.

## 6. Key decisions (summary)

- Renderer and layout are pure functions; `preview.html` is the contract-level test harness.
- One parse seam (`ParseAdapter`), three adapters (fixture/tauri/electron); Electron needs no IPC.
- Fail-fast parser + last-good-schema keeps live typing pleasant without error-tolerant parsing complexity.
- Dangling refs/groups are legal parse output; the renderer, not the parser, decides to skip them.
- Layered deterministic auto-layout, no physics/iteration (`layout-and-render.md` §5); dragged
  positions override layout and persist across re-parses by table name.
- No UI framework, textarea editor, single SVG element — minimum surface that meets requirements.
