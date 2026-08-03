import { describe, it, expect, beforeEach } from 'vitest';
import type { Schema } from './contract';
import { render } from './render';
import { computeLayout, sizeCard } from './layout';
import type { LayoutResult } from './layout';
import demoJson from '../../fixtures/demo.expected.json';
import sampleJson from '../../fixtures/sample.expected.json';

const demo = demoJson as Schema;
const sample = sampleJson as Schema;
const measure = (text: string) => 7.2 * text.length;

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

function transformXY(g: Element): { x: number; y: number } {
  const t = g.getAttribute('transform') || '';
  const m = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(t);
  return { x: Number(m?.[1]), y: Number(m?.[2]) };
}

describe('demo edges', () => {
  it('renders exactly 5 drawable edges', async () => {
    const lay = await computeLayout(demo, measure);
    const h = render(container, demo, lay, { showNotes: false, measure });
    expect(h.svg.querySelectorAll('g.edge').length).toBe(5);
  });
  it('exactly 2 edges are dashed (the two from-note refs)', async () => {
    const lay = await computeLayout(demo, measure);
    const h = render(container, demo, lay, { showNotes: false, measure });
    const dashed = Array.from(h.svg.querySelectorAll('g.edge path[stroke-dasharray]'));
    expect(dashed.length).toBe(2);
  });
  it('renders 5 table cards', async () => {
    const lay = await computeLayout(demo, measure);
    const h = render(container, demo, lay, { showNotes: false, measure });
    expect(h.svg.querySelectorAll('g.table').length).toBe(5);
  });
});

describe('sample (all dangling)', () => {
  it('renders 2 cards and 0 edges', async () => {
    const lay = await computeLayout(sample, measure);
    const h = render(container, sample, lay, { showNotes: false, measure });
    expect(h.svg.querySelectorAll('g.table').length).toBe(2);
    expect(h.svg.querySelectorAll('g.edge').length).toBe(0);
  });
  it('renders a Billing group box (2 defined members)', async () => {
    const lay = await computeLayout(sample, measure);
    const h = render(container, sample, lay, { showNotes: false, measure });
    expect(h.svg.querySelectorAll('g.group').length).toBe(1);
  });
});

describe('showNotes changes only heights/labels, never (x,y) (docs §12.4)', () => {
  it('card transforms identical with notes off vs on (same layout)', async () => {
    // Render twice with the SAME lay: notes must not move a card.
    const lay = await computeLayout(demo, measure);
    const off = render(container, demo, lay, { showNotes: false, measure });
    const posOff: Record<string, { x: number; y: number }> = {};
    off.svg.querySelectorAll('g.table').forEach((g) => {
      posOff[g.getAttribute('data-name')!] = transformXY(g);
    });
    const on = render(container, demo, lay, { showNotes: true, measure });
    on.svg.querySelectorAll('g.table').forEach((g) => {
      const name = g.getAttribute('data-name')!;
      expect(transformXY(g)).toEqual(posOff[name]);
    });
  });
  it('edge labels appear only with showNotes on', async () => {
    const lay = await computeLayout(demo, measure);
    const off = render(container, demo, lay, { showNotes: false, measure });
    const labelsOff = off.svg.querySelectorAll('g.edge text').length;
    expect(labelsOff).toBe(0);
    const on = render(container, demo, lay, { showNotes: true, measure });
    const labelTexts = Array.from(on.svg.querySelectorAll('g.edge text')).map(
      (t) => t.textContent
    );
    // '(the seeker)' from-note ref + 'employer' explicit-note ref
    expect(labelTexts).toContain('(the seeker)');
    expect(labelTexts).toContain('employer');
  });
});

describe('inline comment column (Comments toggle)', () => {
  it('renders the column note text inline when laid out with comments on', async () => {
    const lay = await computeLayout(demo, measure, undefined, true);
    const h = render(container, demo, lay, { showNotes: false, measure });
    const texts = Array.from(h.svg.querySelectorAll('g.table text')).map((t) => t.textContent);
    expect(texts).toContain('UUIDv7'); // users.id note, shown inline
    expect(texts).toContain('Free-text review body'); // reviews.body note, shown inline
  });

  it('does not render inline comments when laid out compact', async () => {
    const lay = await computeLayout(demo, measure); // comments off
    const h = render(container, demo, lay, { showNotes: false, measure });
    const texts = Array.from(h.svg.querySelectorAll('g.table text')).map((t) => t.textContent);
    expect(texts).not.toContain('UUIDv7');
  });

  it('truncates a long comment but keeps the full text in data-note (for the hover tooltip)', async () => {
    const longNote = 'RESERVED / DORMANT until semantic matching ships in a later milestone';
    const schema: Schema = {
      tables: [
        {
          name: 'embeddings',
          note: null,
          columns: [
            { name: 'vec', type: 'vector(1024)', pk: false, notNull: false, unique: false, note: longNote, isFk: false },
          ],
        },
      ],
      refs: [],
      groups: [],
    };
    const lay = await computeLayout(schema, measure, undefined, true);
    const h = render(container, schema, lay, { showNotes: false, measure });
    const noteEl = h.svg.querySelector('g.table text[data-note]')!;
    expect(noteEl.getAttribute('data-note')).toBe(longNote); // full text preserved for the tooltip
    expect(noteEl.textContent!.endsWith('…')).toBe(true); // visible text is truncated
    expect(noteEl.textContent!.length).toBeLessThan(longNote.length);
  });

  it('suppresses the hover note-badge for columns already shown inline', async () => {
    const lay = await computeLayout(demo, measure, undefined, true); // widened for comments
    const h = render(container, demo, lay, { showNotes: true, measure }); // Notes ON too
    const badges = Array.from(h.svg.querySelectorAll('g.table text')).filter(
      (t) => t.textContent === 'N'
    );
    expect(badges.length).toBe(0);
  });
});

describe('bezier side selection (docs §12.3)', () => {
  // Build a minimal 2-table schema with a ref, and pin positions to force each geometry case.
  const twoTable: Schema = {
    tables: [
      {
        name: 't1',
        note: null,
        columns: [{ name: 'a', type: 'int', pk: false, notNull: false, unique: false, note: null, isFk: true }],
      },
      {
        name: 't2',
        note: null,
        columns: [{ name: 'b', type: 'int', pk: false, notNull: false, unique: false, note: null, isFk: false }],
      },
    ],
    refs: [
      { fromTable: 't1', fromColumn: 'a', toTable: 't2', toColumn: 'b', relation: '>', note: null, source: 'explicit' },
    ],
    groups: [],
  };
  const t1 = twoTable.tables[0];
  const t2 = twoTable.tables[1];

  // Hand-built layout with exact pinned coords (no ELK) so the geometry case is deterministic.
  function pinnedLayout(positions: Record<string, { x: number; y: number }>): LayoutResult {
    return {
      sizes: { t1: sizeCard(t1, measure), t2: sizeCard(t2, measure) },
      positions,
      layers: [],
    };
  }

  function edgePathD(positions: Record<string, { x: number; y: number }>): string {
    const h = render(container, twoTable, pinnedLayout(positions), { showNotes: false, measure });
    const p = h.svg.querySelector('g.edge path');
    return p!.getAttribute('d')!;
  }

  it('T right of S → exit S right, enter T left', () => {
    // S(t1) at x=0, T(t2) far right → source control point goes right (+d), target goes right of T.left... enter left (control −d).
    const d = edgePathD({ t1: { x: 0, y: 0 }, t2: { x: 500, y: 0 } });
    const nums = d.match(/[-\d.]+/g)!.map(Number);
    // M P0x P0y C P1x P1y P2x P3y P3x P3y  (P0 at S.right, P1 = P0+d to the right)
    const [p0x, , p1x, , p2x, , p3x] = nums;
    expect(p1x).toBeGreaterThan(p0x); // exits right
    expect(p2x).toBeLessThan(p3x); // enters T from its left (control offset points left/away = -1 at T.left)
  });

  it('S right of T → exit S left, enter T right', () => {
    const d = edgePathD({ t1: { x: 500, y: 0 }, t2: { x: 0, y: 0 } });
    const nums = d.match(/[-\d.]+/g)!.map(Number);
    const [p0x, , p1x, , p2x, , p3x] = nums;
    expect(p1x).toBeLessThan(p0x); // exits S left
    expect(p2x).toBeGreaterThan(p3x); // enters T right
  });

  it('overlapping x → both right (C curve)', () => {
    const d = edgePathD({ t1: { x: 0, y: 0 }, t2: { x: 20, y: 200 } });
    const nums = d.match(/[-\d.]+/g)!.map(Number);
    const [p0x, , p1x, , p2x, , p3x] = nums;
    expect(p1x).toBeGreaterThan(p0x); // both control points push right
    expect(p2x).toBeGreaterThan(p3x);
  });
});
