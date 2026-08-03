// Pure, deterministic auto-layout (docs/layout-and-render.md §2–§5).
// No DOM: text width comes from the injected `measure` function.

import type { Schema, Table } from './contract';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  headerFont,
  nameFontPk,
  nameFontPlain,
  typeFont,
  noteFont,
  headerH,
  rowH,
  padX,
  cardWidthMin,
  cardWidthMax,
  commentGap,
  commentColMax,
} from './theme';

const elk = new ELK();

export type MeasureFn = (text: string, font: string) => number;

export interface CardSize {
  w: number; // total width (widened to include the comment column when showComments)
  baseH: number; // notes-independent height used by layout
  /** Per-column truncated type text (…) so it fits within w; parallel to table.columns. */
  typeText: string[];
  /** x to right-align the type text at (the compact card's right edge). */
  typeRightX: number;
  /** Width of the inline comment column; 0 when comments are off or no column has a note. */
  commentColW: number;
  /** Left x of the comment column (valid when commentColW > 0). */
  commentX: number;
  /** Per-column truncated comment text (…); parallel to table.columns; '' when a column has none. */
  noteText: string[];
}

export interface Placement {
  x: number;
  y: number;
}

export interface LayoutResult {
  sizes: Record<string, CardSize>; // by table name
  positions: Record<string, Placement>; // by table name (layout-computed; overrides applied)
  layers: string[][]; // table names per layer, in within-layer order
}

function clamp(min: number, v: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Size a single card (docs §3). Notes are excluded from height (baseH is notes-independent).
 * When `showComments` is on and at least one column has a note, the card widens to fit an inline
 * comment column on the right (the name/type layout of the compact card is unchanged).
 */
export function sizeCard(table: Table, measure: MeasureFn, showComments = false): CardSize {
  const headerW = measure(table.name, headerFont) + 2 * padX;
  let maxRowW = 0;
  const rowWs: number[] = [];
  for (const col of table.columns) {
    const nameFont = col.pk ? nameFontPk : nameFontPlain;
    const nameW = measure(col.name, nameFont);
    // Note badge width is a showNotes concern; baseH sizing excludes it (docs §3 iconsW note).
    const iconsW = 16 * (col.pk ? 1 : 0) + 16 * (col.isFk ? 1 : 0);
    const typeW = measure(col.type, typeFont);
    const rowW = padX + nameW + 4 + iconsW + 16 + typeW + padX;
    rowWs.push(rowW);
    if (rowW > maxRowW) maxRowW = rowW;
  }
  const wCompact = clamp(cardWidthMin, Math.max(headerW, maxRowW), cardWidthMax);

  // Truncate type text with … until the row fits wCompact (names never truncate).
  const typeText: string[] = [];
  table.columns.forEach((col, i) => {
    if (rowWs[i] <= wCompact) {
      typeText.push(col.type);
      return;
    }
    // available px for the type text within wCompact.
    const overflow = rowWs[i] - wCompact;
    let t = col.type;
    const targetTypeW = measure(col.type, typeFont) - overflow;
    while (t.length > 0 && measure(t + '…', typeFont) > targetTypeW) {
      t = t.slice(0, -1);
    }
    typeText.push(t.length > 0 ? t + '…' : '…');
  });

  // Inline comment column (only when toggled on AND some column carries a note).
  let commentColW = 0;
  let commentX = 0;
  const noteText: string[] = [];
  if (showComments) {
    let maxNoteW = 0;
    for (const col of table.columns) {
      const nw = col.note ? measure(col.note, noteFont) : 0;
      if (nw > maxNoteW) maxNoteW = nw;
    }
    if (maxNoteW > 0) {
      commentColW = Math.min(maxNoteW, commentColMax);
      commentX = wCompact + commentGap;
      for (const col of table.columns) {
        if (!col.note) {
          noteText.push('');
          continue;
        }
        if (measure(col.note, noteFont) <= commentColW) {
          noteText.push(col.note);
          continue;
        }
        let t = col.note;
        while (t.length > 0 && measure(t + '…', noteFont) > commentColW) {
          t = t.slice(0, -1);
        }
        noteText.push(t.length > 0 ? t + '…' : '…');
      }
    }
  }

  const w = commentColW > 0 ? commentX + commentColW + padX : wCompact;
  const typeRightX = wCompact - padX;
  const baseH = headerH + table.columns.length * rowH;
  return { w, baseH, typeText, typeRightX, commentColW, commentX, noteText };
}

/** Build drawable edges (docs §4): child = FK-side table, parent = the other side. */
export function drawableEdges(schema: Schema): { child: string; parent: string }[] {
  const defined = new Set(schema.tables.map((t) => t.name));
  const out: { child: string; parent: string }[] = [];
  for (const ref of schema.refs) {
    if (!defined.has(ref.fromTable) || !defined.has(ref.toTable)) continue; // dangling
    let child: string;
    let parent: string;
    if (ref.relation === '<') {
      child = ref.toTable;
      parent = ref.fromTable;
    } else {
      // '>', '-', '<>' → FK side is `from`
      child = ref.fromTable;
      parent = ref.toTable;
    }
    out.push({ child, parent });
  }
  return out;
}

interface ElkChild {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkChild[];
}

/**
 * Async auto-layout via ELK (elkjs), using nested compound nodes for TableGroups so table cards AND
 * group boxes never overlap. Group containers cluster their members into disjoint boxes; ungrouped
 * tables are direct children of root. Parents render on the left (direction RIGHT with parent as edge
 * source). Node heights use baseH (notes-independent), so toggling notes never moves a card.
 */
export async function computeLayout(
  schema: Schema,
  measure: MeasureFn,
  positions?: Record<string, Placement>,
  showComments = false
): Promise<LayoutResult> {
  const sizes: Record<string, CardSize> = {};
  for (const t of schema.tables) sizes[t.name] = sizeCard(t, measure, showComments);

  // Group membership: each table → index of the FIRST group listing it, else "ungrouped". Only
  // groups with ≥1 defined member become containers. A table belongs to at most one container.
  const defined = new Set(schema.tables.map((t) => t.name));
  const containerOf: Record<string, number> = {}; // table name → group index (only for grouped)
  for (const t of schema.tables) {
    for (let g = 0; g < schema.groups.length; g++) {
      if (schema.groups[g].tables.includes(t.name)) {
        containerOf[t.name] = g;
        break;
      }
    }
  }

  const tableNode = (name: string): ElkChild => ({
    id: name,
    width: sizes[name].w,
    height: sizes[name].baseH, // baseH (notes-independent) so toggling notes never moves cards
  });

  // Bucket grouped tables by container; ungrouped become direct root children.
  const containers = new Map<number, ElkChild>();
  const ungrouped: ElkChild[] = [];
  for (const t of schema.tables) {
    const gi = containerOf[t.name];
    if (gi === undefined) {
      ungrouped.push(tableNode(t.name));
      continue;
    }
    let container = containers.get(gi);
    if (!container) {
      container = {
        id: 'grp:' + gi,
        layoutOptions: { 'elk.padding': '[top=16,left=16,bottom=16,right=16]' },
        children: [],
      };
      containers.set(gi, container);
    }
    container.children!.push(tableNode(t.name));
  }

  const edges = drawableEdges(schema);
  // sources = parent, targets = child → parents go LEFT under direction RIGHT (parents-left convention).
  const elkEdges = edges.map((e, i) => ({
    id: 'e' + i,
    sources: [e.parent],
    targets: [e.child],
  }));

  const root: ElkChild & { edges: typeof elkEdges } = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.spacing.nodeNode': '40',
      'elk.spacing.componentComponent': '60',
      'elk.layered.spacing.baseValue': '40',
      'elk.randomSeed': '1',
    },
    children: [...containers.values(), ...ungrouped],
    edges: elkEdges,
  };

  const res = (await elk.layout(root)) as ElkChild;

  // Absolute positions: ELK child coords are relative to their parent container.
  const computed: Record<string, Placement> = {};
  for (const node of res.children ?? []) {
    if (node.children) {
      const cx = node.x ?? 0;
      const cy = node.y ?? 0;
      for (const child of node.children) {
        if (!defined.has(child.id)) continue;
        computed[child.id] = { x: cx + (child.x ?? 0), y: cy + (child.y ?? 0) };
      }
    } else {
      computed[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
    }
  }

  // layers: bucket by rounded absolute x into columns (left→right), within a column order by y.
  const byColumn = new Map<number, string[]>();
  for (const name of Object.keys(computed)) {
    const col = Math.round(computed[name].x);
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(name);
  }
  const layers: string[][] = [...byColumn.keys()]
    .sort((a, b) => a - b)
    .map((col) =>
      byColumn.get(col)!.sort((a, b) => computed[a].y - computed[b].y)
    );

  // Apply overrides (docs §5.5): pinned (user-dragged) tables use their override position.
  const finalPositions: Record<string, Placement> = { ...computed };
  if (positions) {
    for (const name of Object.keys(positions)) {
      if (finalPositions[name]) finalPositions[name] = positions[name];
    }
  }

  return { sizes, positions: finalPositions, layers };
}
