// Pure SVG renderer (docs/layout-and-render.md §7–§10). Builds the full SVG for (schema, options)
// and exposes fast-path updaters (moveTable, setViewport). No event listeners, no mutable app state.

import type { Schema, Ref, Column } from './contract';
import { sizeCard } from './layout';
import type { MeasureFn, LayoutResult, CardSize } from './layout';
import {
  FONT,
  headerH,
  rowH,
  padX,
  cardRadius,
  cardFill,
  cardStroke,
  nameColor,
  typeColor,
  noteColor,
  canvasBg,
  edgeStroke,
  edgeWidth,
  fromNoteDash,
  sideGapMin,
  ctrlOffMin,
  ctrlOffMax,
  sameSideOff,
  groupPad,
  PALETTE,
  noteFont,
  edgeLabelFont,
} from './theme';

const SVGNS = 'http://www.w3.org/2000/svg';

export interface RenderOptions {
  showNotes: boolean;
  markerStyle?: 'crowsfoot' | 'simple';
  measure?: MeasureFn;
}

export interface TableGeom {
  x: number;
  y: number;
  w: number;
  h: number; // world-space, includes note block when showNotes
  rowY(colName: string): number; // world-space attach y for a column (or header center)
}

export interface RenderHandle {
  svg: SVGSVGElement;
  geometry: Record<string, TableGeom>;
  setViewport(tx: number, ty: number, k: number): void;
  moveTable(name: string, x: number, y: number): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, tag);
}
function attr(node: Element, a: Record<string, string | number>): void {
  for (const k of Object.keys(a)) node.setAttribute(k, String(a[k]));
}

// ---- Default measure: hidden-canvas measureText ----
let _ctx: CanvasRenderingContext2D | null = null;
export function canvasMeasure(text: string, font: string): number {
  if (!_ctx) {
    const c = document.createElement('canvas');
    _ctx = c.getContext('2d');
  }
  if (!_ctx) return 7.2 * text.length; // headless fallback
  _ctx.font = font;
  return _ctx.measureText(text).width;
}

// ---- Note wrapping (docs §3 noteH / §8.5) ----
function wrapWords(text: string, maxW: number, measure: MeasureFn, font: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (measure(test, font) <= maxW || cur === '') {
      cur = test;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

// ---- PK / FK / note icons (docs §8.4) ----
function pkIcon(): SVGGElement {
  const g = el('g');
  attr(g, { stroke: '#B45309', 'stroke-width': 1.5, fill: 'none' });
  const c = el('circle');
  attr(c, { cx: 3.5, cy: 6, r: 2.2 });
  const p = el('path');
  attr(p, { d: 'M5.7 6H11M8.8 6v2.2M11 6v2.2' });
  g.append(c, p);
  return g;
}
function fkIcon(): SVGGElement {
  const g = el('g');
  attr(g, { stroke: '#2563EB', 'stroke-width': 1.5, fill: 'none' });
  const p = el('path');
  attr(p, {
    d: 'M7.2 3.2l1-1a2.05 2.05 0 0 1 2.9 2.9l-1 1M4.8 8.8l-1 1a2.05 2.05 0 0 1-2.9-2.9l1-1M4.4 7.6l3.2-3.2',
  });
  g.append(p);
  return g;
}
function noteBadge(noteText: string): SVGGElement {
  const g = el('g');
  const c = el('circle');
  attr(c, { r: 5.5, fill: '#E5E7EB', stroke: '#9CA3AF' });
  const t = el('text');
  attr(t, {
    'font-size': 7,
    fill: '#4B5563',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': FONT,
  });
  t.textContent = 'N';
  const title = el('title');
  title.textContent = noteText;
  g.append(c, t, title);
  return g;
}

// ---- Card drawing (docs §8) ----
interface CardBuild {
  group: SVGGElement;
  h: number; // full height incl. notes
  rowCy: (i: number) => number; // local y-center of row i's attach line
}

function buildCard(
  table: Schema['tables'][number],
  size: CardSize,
  colorIdx: number,
  showNotes: boolean,
  measure: MeasureFn
): CardBuild {
  const g = el('g');
  g.classList.add('table');
  attr(g, { 'data-name': table.name });

  const w = size.w;
  const color = PALETTE[colorIdx % 8];

  // note block height
  let noteLines: string[] = [];
  let noteH = 0;
  if (showNotes && table.note) {
    noteLines = wrapWords(table.note, w - 2 * padX, measure, noteFont);
    noteH = 14 * noteLines.length + 14;
  }
  const h = size.baseH + noteH;

  // 1. body
  const body = el('rect');
  attr(body, {
    width: w,
    height: h,
    rx: cardRadius,
    fill: cardFill,
    stroke: cardStroke,
    'stroke-width': 1,
  });
  g.append(body);

  // 2. header (top corners rounded)
  const r = cardRadius;
  const header = el('path');
  attr(header, {
    d: `M0,${r} A${r},${r} 0 0 1 ${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${headerH} H0 Z`,
    fill: color,
  });
  g.append(header);

  // 3. header text
  const htext = el('text');
  attr(htext, {
    x: padX,
    y: headerH / 2,
    'dominant-baseline': 'central',
    'font-family': FONT,
    'font-weight': 600,
    'font-size': 13,
    fill: '#FFF',
  });
  htext.textContent = table.name;
  g.append(htext);

  // 4. rows
  table.columns.forEach((col: Column, i: number) => {
    const rowG = el('g');
    rowG.classList.add('row');
    attr(rowG, { transform: `translate(0 ${headerH + i * rowH})` });

    const nameText = el('text');
    attr(nameText, {
      x: padX,
      y: rowH / 2,
      'dominant-baseline': 'central',
      'font-family': FONT,
      'font-weight': col.pk ? 600 : 400,
      'font-size': 13,
      fill: nameColor,
    });
    nameText.textContent = col.name;
    rowG.append(nameText);

    // icons after the name, left-to-right, 4px gaps, each in a 12×12 box.
    let iconX = padX + measure(col.name, col.pk ? `600 13px ${FONT}` : `400 13px ${FONT}`) + 4;
    const placeIcon = (icon: SVGGElement) => {
      // icon local coords use a 12-unit box; center it vertically at rowH/2.
      attr(icon, { transform: `translate(${iconX} ${rowH / 2 - 6})` });
      rowG.append(icon);
      iconX += 16;
    };
    if (col.pk) placeIcon(pkIcon());
    if (col.isFk) placeIcon(fkIcon());
    // Column-note badge (hover tooltip) — only when Notes is on and the note isn't already shown
    // inline in the comment column.
    if (showNotes && col.note && size.commentColW === 0) {
      const badge = noteBadge(col.note);
      // badge is drawn around its own center; nudge into the 12-box center.
      attr(badge, { transform: `translate(${iconX + 6} ${rowH / 2})` });
      rowG.append(badge);
      iconX += 16;
    }

    const typeText = el('text');
    attr(typeText, {
      x: size.typeRightX,
      y: rowH / 2,
      'text-anchor': 'end',
      'dominant-baseline': 'central',
      'font-family': FONT,
      'font-weight': 400,
      'font-size': 12,
      fill: typeColor,
    });
    typeText.textContent = size.typeText[i];
    rowG.append(typeText);

    // Inline comment column (Comments toggle). Text is pre-truncated in sizeCard; full note on hover.
    if (size.commentColW > 0 && size.noteText[i]) {
      const noteEl = el('text');
      attr(noteEl, {
        x: size.commentX,
        y: rowH / 2,
        'dominant-baseline': 'central',
        'font-family': FONT,
        'font-style': 'italic',
        'font-weight': 400,
        'font-size': 11,
        fill: noteColor,
      });
      noteEl.textContent = size.noteText[i];
      if (col.note && size.noteText[i] !== col.note) {
        // Truncated: stash the full note in a data-attr so the app layer can show a hover tooltip.
        // (A custom HTML tooltip — SVG <title> is unreliable in the app's WebKit webview.)
        attr(noteEl, { 'data-note': col.note });
        noteEl.style.cursor = 'help';
      }
      rowG.append(noteEl);
    }

    g.append(rowG);
  });

  // Vertical divider between the type column and the inline comment column.
  if (size.commentColW > 0) {
    const div = el('line');
    attr(div, {
      x1: size.typeRightX + padX,
      y1: headerH,
      x2: size.typeRightX + padX,
      y2: size.baseH,
      stroke: '#E5E7EB',
      'stroke-width': 1,
    });
    g.append(div);
  }

  // 5. table note block
  if (showNotes && table.note) {
    const line = el('line');
    attr(line, {
      x1: 0,
      y1: size.baseH,
      x2: w,
      y2: size.baseH,
      stroke: '#E5E7EB',
      'stroke-width': 1,
    });
    g.append(line);
    noteLines.forEach((ln, i) => {
      const t = el('text');
      attr(t, {
        x: padX,
        y: size.baseH + 18 + i * 14,
        'font-family': FONT,
        'font-style': 'italic',
        'font-weight': 400,
        'font-size': 11,
        fill: noteColor,
      });
      t.textContent = ln;
      g.append(t);
    });
  }

  const rowCy = (i: number) => headerH + (i + 0.5) * rowH;
  return { group: g, h, rowCy };
}

// ---- Edge geometry (docs §9) ----
interface Attach {
  x: number;
  y: number;
  n: number; // +1 right, -1 left (outward side sign)
}

function rectOf(geom: TableGeom) {
  return { left: geom.x, right: geom.x + geom.w, top: geom.y, bottom: geom.y + geom.h };
}

function attachY(geom: TableGeom, colName: string): number {
  return geom.rowY(colName);
}

/** Decide sides + compute attach points for a ref (docs §9). */
function edgeAttach(
  sGeom: TableGeom,
  sCol: string,
  tGeom: TableGeom,
  tCol: string
): { p0: Attach; p3: Attach } {
  const S = rectOf(sGeom);
  const T = rectOf(tGeom);
  const sy = attachY(sGeom, sCol);
  const ty = attachY(tGeom, tCol);

  let sSide: 1 | -1;
  let tSide: 1 | -1;
  if (T.left >= S.right + sideGapMin) {
    sSide = 1; // S right
    tSide = -1; // T left
  } else if (S.left >= T.right + sideGapMin) {
    sSide = -1; // S left
    tSide = 1; // T right
  } else {
    sSide = 1; // both right (C curve)
    tSide = 1;
  }
  const p0: Attach = { x: sSide === 1 ? S.right : S.left, y: sy, n: sSide };
  const p3: Attach = { x: tSide === 1 ? T.right : T.left, y: ty, n: tSide };
  return { p0, p3 };
}

function ctrlOffset(p0: Attach, p3: Attach): number {
  if (p0.n === p3.n) {
    // same-side (both-right / both-left) C curve
    return sameSideOff + Math.min(0.1 * Math.abs(p3.y - p0.y), 60);
  }
  return Math.max(ctrlOffMin, Math.min(ctrlOffMax, 0.5 * Math.abs(p3.x - p0.x)));
}

function bezierPath(p0: Attach, p3: Attach): string {
  const d = ctrlOffset(p0, p3);
  const p1x = p0.x + p0.n * d;
  const p2x = p3.x + p3.n * d;
  return `M ${p0.x} ${p0.y} C ${p1x} ${p0.y} ${p2x} ${p3.y} ${p3.x} ${p3.y}`;
}

/** Point on cubic at parameter t (docs §9.2 label at t=0.5). */
function cubicPoint(p0: Attach, p3: Attach, t: number): { x: number; y: number } {
  const d = ctrlOffset(p0, p3);
  const p1x = p0.x + p0.n * d;
  const p1y = p0.y;
  const p2x = p3.x + p3.n * d;
  const p2y = p3.y;
  const mt = 1 - t;
  const x =
    mt * mt * mt * p0.x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3.x;
  const y =
    mt * mt * mt * p0.y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3.y;
  return { x, y };
}

// ---- Markers (docs §9.1) ----
function markerPath(kind: 'many' | 'one' | 'simpleMany'): string {
  if (kind === 'many') return 'M16 0L0 6M16 0L0 0M16 0L0 -6';
  if (kind === 'one') return 'M10 -6V6';
  return 'M10 -5L0 0L10 5'; // simple-style many (open arrow)
}

function endMarkers(
  relation: Ref['relation'],
  markerStyle: 'crowsfoot' | 'simple'
): { from: 'many' | 'one' | 'simpleMany' | null; to: 'many' | 'one' | 'simpleMany' | null } {
  if (markerStyle === 'simple') {
    // many ends → open arrow; one ends → nothing
    switch (relation) {
      case '>':
        return { from: 'simpleMany', to: null };
      case '<':
        return { from: null, to: 'simpleMany' };
      case '-':
        return { from: null, to: null };
      case '<>':
        return { from: 'simpleMany', to: 'simpleMany' };
    }
  }
  switch (relation) {
    case '>':
      return { from: 'many', to: 'one' };
    case '<':
      return { from: 'one', to: 'many' };
    case '-':
      return { from: 'one', to: 'one' };
    case '<>':
      return { from: 'many', to: 'many' };
  }
}

function drawMarker(kind: 'many' | 'one' | 'simpleMany', at: Attach): SVGGElement {
  const g = el('g');
  // local frame: translate(attach) scale(n,1) so +x points away from the card.
  attr(g, { transform: `translate(${at.x} ${at.y}) scale(${at.n} 1)` });
  const p = el('path');
  attr(p, { d: markerPath(kind), stroke: edgeStroke, 'stroke-width': edgeWidth, fill: 'none' });
  g.append(p);
  return g;
}

interface EdgeRec {
  ref: Ref;
  from: string;
  to: string;
  g: SVGGElement; // <g class="edge">
}

// ---- Group boxes (docs §10) ----
interface GroupRec {
  index: number;
  members: string[]; // defined member table names
  g: SVGGElement;
}

function groupBox(
  members: string[],
  geometry: Record<string, TableGeom>
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const m of members) {
    const geom = geometry[m];
    if (!geom) continue;
    any = true;
    minX = Math.min(minX, geom.x);
    minY = Math.min(minY, geom.y);
    maxX = Math.max(maxX, geom.x + geom.w);
    maxY = Math.max(maxY, geom.y + geom.h);
  }
  if (!any) return null;
  return {
    x: minX - groupPad,
    y: minY - groupPad,
    w: maxX - minX + 2 * groupPad,
    h: maxY - minY + 2 * groupPad,
  };
}

export function render(
  container: HTMLElement,
  schema: Schema,
  lay: LayoutResult,
  opts: RenderOptions
): RenderHandle {
  const measure = opts.measure ?? canvasMeasure;
  const showNotes = opts.showNotes;
  const markerStyle = opts.markerStyle ?? 'crowsfoot';

  container.innerHTML = '';
  const svg = el('svg');
  svg.classList.add('erd');
  attr(svg, { 'data-notes': showNotes ? 'on' : 'off' });
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.background = canvasBg;
  svg.style.userSelect = 'none';

  const viewport = el('g');
  viewport.classList.add('viewport');
  const layerGroups = el('g');
  layerGroups.classList.add('layer-groups');
  const layerEdges = el('g');
  layerEdges.classList.add('layer-edges');
  const layerTables = el('g');
  layerTables.classList.add('layer-tables');
  viewport.append(layerGroups, layerEdges, layerTables);
  svg.append(viewport);
  container.append(svg);

  // ---- geometry + cards ----
  const geometry: Record<string, TableGeom> = {};
  const cardGroups: Record<string, SVGGElement> = {};

  schema.tables.forEach((table, idx) => {
    const size = lay.sizes[table.name];
    const pos = lay.positions[table.name];
    const built = buildCard(table, size, idx, showNotes, measure);
    attr(built.group, { transform: `translate(${pos.x} ${pos.y})` });
    layerTables.append(built.group);
    cardGroups[table.name] = built.group;

    const colIndex: Record<string, number> = {};
    table.columns.forEach((c, i) => (colIndex[c.name] = i));
    const captured = { x: pos.x, y: pos.y };
    geometry[table.name] = {
      get x() {
        return captured.x;
      },
      get y() {
        return captured.y;
      },
      w: size.w,
      h: built.h,
      rowY(colName: string): number {
        const i = colIndex[colName];
        if (i === undefined) return captured.y + headerH / 2; // unknown col → header center
        return captured.y + built.rowCy(i);
      },
    };
    // stash the mutable pos so moveTable can update it.
    (geometry[table.name] as unknown as { _pos: { x: number; y: number } })._pos = captured;
  });

  // ---- edges ----
  const defined = new Set(schema.tables.map((t) => t.name));
  const edgeRecs: EdgeRec[] = [];

  function drawEdge(rec: EdgeRec): void {
    rec.g.innerHTML = '';
    const sGeom = geometry[rec.from];
    const tGeom = geometry[rec.to];
    const { p0, p3 } = edgeAttach(sGeom, rec.ref.fromColumn, tGeom, rec.ref.toColumn);
    const path = el('path');
    attr(path, {
      d: bezierPath(p0, p3),
      stroke: edgeStroke,
      'stroke-width': edgeWidth,
      fill: 'none',
    });
    if (rec.ref.source === 'from-note') attr(path, { 'stroke-dasharray': fromNoteDash });
    rec.g.append(path);

    const { from: fromM, to: toM } = endMarkers(rec.ref.relation, markerStyle);
    // marker endpoints: from = ref.fromTable side, to = ref.toTable side.
    // p0 corresponds to fromTable, p3 to toTable (edgeAttach ordered by from,to).
    if (fromM) rec.g.append(drawMarker(fromM, p0));
    if (toM) rec.g.append(drawMarker(toM, p3));

    // edge label
    if (showNotes && rec.ref.note) {
      const mid = cubicPoint(p0, p3, 0.5);
      const label = el('text');
      let txt = rec.ref.note;
      if (txt.length > 40) txt = txt.slice(0, 40) + '…';
      attr(label, {
        x: mid.x,
        y: mid.y,
        dy: -8,
        'text-anchor': 'middle',
        'font-family': FONT,
        'font-style': 'italic',
        'font-weight': 400,
        'font-size': 10,
        fill: noteColor,
      });
      label.style.paintOrder = 'stroke';
      label.style.stroke = '#FFF';
      label.style.strokeWidth = '3';
      void edgeLabelFont;
      label.textContent = txt;
      rec.g.append(label);
    }
  }

  for (const ref of schema.refs) {
    if (!defined.has(ref.fromTable) || !defined.has(ref.toTable)) continue; // dangling → skip
    const g = el('g');
    g.classList.add('edge');
    const rec: EdgeRec = { ref, from: ref.fromTable, to: ref.toTable, g };
    edgeRecs.push(rec);
    layerEdges.append(g);
    drawEdge(rec);
  }

  // ---- group boxes ----
  const groupRecs: GroupRec[] = [];
  schema.groups.forEach((grp, gi) => {
    const members = grp.tables.filter((m) => defined.has(m));
    if (members.length < 1) return; // skip whole group if no defined member
    const g = el('g');
    g.classList.add('group');
    layerGroups.append(g);
    const rec: GroupRec = { index: gi, members, g };
    groupRecs.push(rec);
    drawGroup(rec, grp.name);
  });

  function drawGroup(rec: GroupRec, name: string): void {
    rec.g.innerHTML = '';
    const box = groupBox(rec.members, geometry);
    if (!box) return;
    const color = PALETTE[rec.index % 8];
    const rect = el('rect');
    attr(rect, {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: cardRadius,
      fill: color,
      'fill-opacity': 0.08,
      stroke: color,
      'stroke-opacity': 0.4,
      'stroke-dasharray': '4 3',
    });
    rec.g.append(rect);
    const label = el('text');
    attr(label, {
      x: box.x + 4,
      y: box.y - 6,
      'font-family': FONT,
      'font-weight': 600,
      'font-size': 12,
      fill: color,
    });
    label.textContent = name;
    rec.g.append(label);
  }

  // group names by index for redraw
  const groupNameByIndex: Record<number, string> = {};
  schema.groups.forEach((g, i) => (groupNameByIndex[i] = g.name));

  // ---- handle ----
  let vTx = 0;
  let vTy = 0;
  let vK = 1;
  function applyViewport(): void {
    attr(viewport, { transform: `translate(${vTx} ${vTy}) scale(${vK})` });
  }
  applyViewport();

  const handle: RenderHandle = {
    svg,
    geometry,
    setViewport(tx: number, ty: number, k: number): void {
      vTx = tx;
      vTy = ty;
      vK = k;
      applyViewport();
    },
    moveTable(name: string, x: number, y: number): void {
      const card = cardGroups[name];
      if (!card) return;
      attr(card, { transform: `translate(${x} ${y})` });
      const geom = geometry[name] as unknown as { _pos: { x: number; y: number } };
      geom._pos.x = x;
      geom._pos.y = y;
      // redraw edges touching this table
      for (const rec of edgeRecs) {
        if (rec.from === name || rec.to === name) drawEdge(rec);
      }
      // redraw group boxes containing this table
      for (const rec of groupRecs) {
        if (rec.members.includes(name)) drawGroup(rec, groupNameByIndex[rec.index]);
      }
    },
  };

  return handle;
}

// Re-export so preview/tests can size cards directly.
export { sizeCard };
