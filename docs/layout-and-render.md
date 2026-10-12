# Layout & Rendering Spec

Consumes `Schema` (`data-contract.md`); produces SVG. Two pure functions plus one controller:

```ts
layout(schema: Schema, measure: MeasureFn): LayoutResult          // positions & base sizes
render(container: HTMLElement, schema: Schema, opts: RenderOptions): RenderHandle
// interaction.ts: owns pan/zoom/drag state, calls render + fast-path updaters

type MeasureFn = (text: string, font: string) => number;          // px width
interface RenderOptions {
  showNotes: boolean;
  markerStyle?: 'crowsfoot' | 'simple';        // default 'crowsfoot'
  positions?: Record<string, {x: number; y: number}>;  // drag overrides, by table name
  measure?: MeasureFn;                          // default: hidden-canvas measureText
}
interface RenderHandle {
  svg: SVGSVGElement;
  geometry: Record<string, TableGeom>;          // world-space {x,y,w,h, rowY(colName): number}
  setViewport(tx: number, ty: number, k: number): void;   // fast path
  moveTable(name: string, x: number, y: number): void;    // fast path
}
```

## 1. Constants (single source of truth — implement as `frontend/src/theme.ts`)

```
FONT        = '-apple-system, "Helvetica Neue", Arial, sans-serif'
headerH=36  rowH=28  padX=12  cardRadius=8  cardWidthMin=200  cardWidthMax=360
gapX=120    gapY=40  groupPad=16  groupTransitionGap=24
zoomMin=0.1 zoomMax=4  fitPadding=40  dragThreshold=3px  wheelZoomK=0.005
edgeStroke='#64748B' edgeWidth=1.5  fromNoteDash='6 4'  sideGapMin=16
ctrlOffMin=40 ctrlOffMax=160 sameSideOff=60
PALETTE = ['#2563EB','#DC2626','#059669','#D97706','#7C3AED','#DB2777','#0D9488','#EA580C']
canvasBg='#F8FAFC' cardFill='#FFFFFF' cardStroke='#D1D5DB'
nameColor='#111827' typeColor='#6B7280' noteColor='#6B7280'
```

Header color of table *i* (0-based document order) = `PALETTE[i % 8]`. Group tint color of group
*j* = `PALETTE[j % 8]` at 8% fill-opacity. All colors support white header text.

## 2. Text measurement

Default `measure` = 2D-canvas `measureText(text).width` with the exact font string used to render
(e.g. `"600 13px " + FONT`). Tests inject `(text) => 7.2 * text.length` — layout must be correct for
ANY monotone measure, so all sizing math goes through it. Fonts used:
header `600 13px`, column name `400|600 13px` (600 when pk), type `400 12px`, notes `italic 400 11px`,
group label `600 12px`, edge label `italic 400 10px`.

## 3. Card geometry (per table)

- `nameW = measure(col.name, nameFont)`, `iconsW = 16 * (pk?1:0) + 16 * (isFk?1:0) + (showNotes && note ? 16 : 0)`
  (each icon 12px + 4px gap), `typeW = measure(col.type, typeFont)`.
- `rowW = padX + nameW + 4 + iconsW + 16 + typeW + padX`.
- `w = clamp(cardWidthMin, max(measure(table.name, headerFont) + 2*padX, max(rowW over columns)), cardWidthMax)`.
  If a row overflows `w`, truncate the **type** text with `…` until it fits (names never truncate).
- `baseH = headerH + columns.length * rowH`  ← used by layout (notes-independent).
- `noteH` (only when `showNotes` and `table.note`): wrap note text to `w - 2*padX` via greedy
  word-wrap using `measure`; `noteH = 14 * lines + 14`. Final card height `h = baseH + noteH`.
- Row *i* vertical center (attach line): `rowCy(i) = y + headerH + (i + 0.5) * rowH`. Note areas sit
  **below** all rows and badges are inline, so `rowCy` is independent of the notes toggle.

## 4. Edge graph (shared by layout & renderer)

For each ref where **both** `fromTable` and `toTable` are defined in `schema.tables`:
child = FK-side table, parent = other side (FK side per contract §4.1: `>`/`-`/`<>` → from, `<` → to).
Graph edge `child → parent`. Refs with a missing endpoint table produce no edge and are not drawn
(dangling, grammar §8). Refs naming a missing **column** on a defined table are drawn, attaching at
the header's vertical center instead of a row.

## 5. Auto-layout

ELK uses a deterministic layered layout with direction `RIGHT`, a fixed random seed, and
compound nodes for table groups. Parent tables are edge sources and appear to the left of
their children. Each table belongs to the first group listing it; ungrouped tables sit at the root.
Group containers have 16px padding, and child coordinates are converted to absolute positions.

Both the root and each group explicitly use `gapX=120` as the minimum spacing between layers.
Group spacing does not inherit this root option automatically. Vertical spacing stays at 40px
at the root and ELK's existing 20px default inside groups. Wider cards can increase horizontal
gaps beyond the minimum. Comments mode recalculates layout using the widened card sizes.

Layout uses `baseH`, which excludes notes, so toggling Notes never moves cards.
User-dragged positions override computed positions after layout. With no overrides, tests check
that cards and group bounding boxes do not overlap.

## 6. Coordinate model, zoom & pan

World space is y-down with layout origin (0,0). One viewport group carries the whole view:
`<g class="viewport" transform="translate(tx ty) scale(k)">`; `screen = world * k + (tx, ty)`.

- **Zoom** (ctrl/cmd + wheel, incl. macOS pinch which arrives as ctrlKey wheel):
  `k' = clamp(k * exp(-deltaY * wheelZoomK), zoomMin, zoomMax)`; keep cursor `(cx, cy)`
  (container-relative px) fixed: `tx' = cx - (cx - tx) * k'/k`, same for `ty'`.
- **Pan**: plain wheel → `(tx, ty) -= (deltaX, deltaY)`; or pointer-drag on empty canvas.
- **Fit** (initial render, Fit button, dbl-click background): bbox of all cards + group boxes;
  `k = clamp(min((cw - 2*fitPadding)/bboxW, (ch - 2*fitPadding)/bboxH), zoomMin, 1)`; center bbox.
- Fast path: zoom/pan only rewrite the viewport `transform` attribute (`setViewport`) — no re-render.

## 7. SVG structure

```html
<svg class="erd" style="width:100%;height:100%;background:#F8FAFC" data-notes="on|off">
  <g class="viewport" transform="...">
    <g class="layer-groups"><!-- one <g.group> per TableGroup --></g>
    <g class="layer-edges"><!-- one <g.edge> per drawable ref --></g>
    <g class="layer-tables"><!-- one <g.table data-name> per table --></g>
  </g>
</svg>
```

Z-order: groups under edges under tables. Every `g.table` positions via
`transform="translate(x y)"` so drag is one attribute write.

## 8. Drawing a table card (local coords, origin = card top-left)

1. Body: `<rect width=w height=h rx=8 fill=cardFill stroke=cardStroke stroke-width=1>`.
2. Header (top corners rounded only):
   `M0,{r} A{r},{r} 0 0 1 {r},0 H{w-r} A{r},{r} 0 0 1 {w},{r} V{headerH} H0 Z`, fill = palette color.
3. Header text: table name, `600 13px`, fill `#FFF`, x=padX, y=headerH/2, `dominant-baseline=central`.
4. Per column *i*, a `<g class="row">` at `y = headerH + i*rowH`:
   - name at x=padX, y=rowH/2 (baseline central), `600` weight if `pk` else `400`, fill nameColor;
   - icons follow the name left-to-right with 4px gaps, each in a 12×12 viewBox `<g>`:
     - **PK key** (when `pk`): `<g stroke="#B45309" stroke-width="1.5" fill="none">
       <circle cx="3.5" cy="6" r="2.2"/><path d="M5.7 6H11M8.8 6v2.2M11 6v2.2"/></g>`
     - **FK link** (when `isFk`): `<g stroke="#2563EB" stroke-width="1.5" fill="none">
       <path d="M7.2 3.2l1-1a2.05 2.05 0 0 1 2.9 2.9l-1 1M4.8 8.8l-1 1a2.05 2.05 0 0 1-2.9-2.9l1-1M4.4 7.6l3.2-3.2"/></g>`
     - **Note badge** (when `showNotes && col.note`): `<circle r="5.5" fill="#E5E7EB" stroke="#9CA3AF"/>`
       `<text ... font-size="7" fill="#4B5563">N</text>` and a child `<title>{col.note}</title>`
       (native tooltip).
   - type text right-aligned: `text-anchor=end`, x=w-padX, `400 12px`, fill typeColor, truncated per §3.
5. Table note (when `showNotes && table.note`): 1px line `#E5E7EB` at y=baseH, then wrapped
   `italic 11px` noteColor text lines at x=padX, first baseline y=baseH+18, line height 14.

## 9. Edges (relationship splines)

For each drawable ref (§4): attach source = `(fromTable, fromColumn)` row, target = `(toTable,
toColumn)` row; attach y per §3 `rowCy` (or header center if column unknown); attach x = the card's
left or right edge per side selection. With `S` = source card rect, `T` = target card rect:

- `T.left ≥ S.right + sideGapMin` → exit S **right**, enter T **left**;
- `S.left ≥ T.right + sideGapMin` → exit S **left**, enter T **right**;
- otherwise (x-overlap or self-reference) → **both right** (C-shaped curve).

Cubic bezier `M P0 C P1 P2 P3` where `P0/P3` = attach points, `n0/n3 ∈ {+1,-1}` = outward side sign
(+1 right, −1 left), `d = clamp(0.5 * |P3.x − P0.x|, ctrlOffMin, ctrlOffMax)` — for the both-right
case `d = sameSideOff + min(0.1 * |P3.y − P0.y|, 60)` — and `P1 = P0 + (n0·d, 0)`,
`P2 = P3 + (n3·d, 0)`. Stroke edgeStroke/edgeWidth, `fill=none`;
**`source === 'from-note'` → add `stroke-dasharray="6 4"`** (implicit relationships read as dashed).

### 9.1 End markers
Drawn per endpoint in a local frame `translate(attach) scale(n, 1)` so +x always points away from
the card. Same stroke as the edge, `fill=none`:

| marker | path |
|---|---|
| many (crow's foot) | `M16 0L0 6M16 0L0 0M16 0L0 -6` |
| one (tick) | `M10 -6V6` |
| simple-style many | `M10 -5L0 0L10 5` |

Assignment by `relation`: `>` → from=many, to=one; `<` → from=one, to=many; `-` → tick both ends;
`<>` → crow's foot both ends. `markerStyle:'simple'`: many ends get the open arrow, one ends get
nothing. Multiple refs between the same pair render independently (no fanning in v1).

### 9.2 Edge note label
When `showNotes && ref.note`: text at the bezier point `t = 0.5` (evaluate the cubic), dy −8,
`text-anchor=middle`, `italic 10px` noteColor, truncated at 40 chars + `…`, with a white halo:
`paint-order: stroke; stroke: #FFF; stroke-width: 3`.

## 10. Group boxes

Per `TableGroup` (skipping member names with no defined table; skip the whole group if <1 defined
member): world-space bounding box of member cards expanded by `groupPad` →
`<rect rx=8 fill={color} fill-opacity=0.08 stroke={color} stroke-opacity=0.4 stroke-dasharray="4 3">`
plus label `<text>` (`600 12px`, fill = color) at `(box.x + 4, box.y - 6)`. Boxes recompute on any
member move (drag fast path re-runs this). A table in multiple groups belongs to all boxes; boxes
may overlap non-members when members are scattered — accepted v1 limitation, mitigated by §5.2
clustering.

## 11. Notes toggle & interaction

- **Notes toggle**: `app.ts` re-invokes `render` with flipped `showNotes` (full rebuild; trivial at
  this scale). Card positions identical (§5); heights, badges, note blocks, and edge labels change.
- **Drag table**: `pointerdown` on a `g.table` → `setPointerCapture`; ignore as click if total
  movement < dragThreshold. Else `pos = start + (Δscreen)/k` (divide by zoom), call
  `handle.moveTable(name, x, y)` each move — fast path: rewrite that card's `transform`, recompute
  `d` only for edges touching it, recompute its group box(es). On `pointerup`, commit into
  `interaction`'s `positions` map (keyed by table name).
- **Re-parse persistence**: on every successful parse, `app.ts` re-renders passing
  `positions` — tables that still exist keep their dragged spot, new tables get layout spots.
  Stale entries are retained harmlessly (a rename-back restores its position).
- **Pan/zoom**: §6; empty-canvas `pointerdown` pans; `setViewport` fast path.
- Text selection is disabled on the SVG (`user-select: none`); cursor: `grab/grabbing` on
  background, `move` on cards.

## 12. Determinism & tests

Same `(schema, positions, measure)` ⇒ identical layout and SVG (no randomness, no Date, no
iteration-order dependence — only arrays and document order are ever iterated). Headless unit tests
(vitest, stub measure `7.2 × len`):

1. `sample.expected.json`: both tables layer 0; subscriptions above boosts; zero card overlaps;
   zero drawable edges (all refs dangling).
2. `demo.expected.json` (task-breakdown Appendix A): layers = `[users, organization]`,
   `[subscriptions, caregiver_profiles]`, `[reviews]` (subscriptions before caregiver_profiles —
   group clustering); 5 drawable edges; the two from-note + one explicit-note labels appear only
   when `showNotes`; no overlaps.
3. Bezier side selection: T right of S → right/left sides; S right of T → left/right; overlapping →
   right/right.
4. Toggling `showNotes` changes only heights/labels, never `(x, y)`.

Visual verification runs in `frontend/preview.html` (see `design.md` §5 and task S4).
