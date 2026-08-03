import { describe, it, expect } from 'vitest';
import type { Schema } from './contract';
import { computeLayout, drawableEdges, sizeCard } from './layout';
import type { LayoutResult } from './layout';
import sampleJson from '../../fixtures/sample.expected.json';
import demoJson from '../../fixtures/demo.expected.json';
import careJson from '../../fixtures/care_marketplace.parsed.json';

const sample = sampleJson as Schema;
const demo = demoJson as Schema;
const care = (careJson as { schema: Schema }).schema;

// Stub measure per docs §12: 7.2 × text length.
const measure = (text: string) => 7.2 * text.length;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function cardRect(res: LayoutResult, name: string): Rect {
  return {
    x: res.positions[name].x,
    y: res.positions[name].y,
    w: res.sizes[name].w,
    h: res.sizes[name].baseH,
  };
}

function noOverlaps(schema: Schema, res: LayoutResult): void {
  const names = schema.tables.map((t) => t.name);
  const rects = names.map((n) => cardRect(res, n));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(overlaps(rects[i], rects[j]), `${names[i]} overlaps ${names[j]}`).toBe(false);
    }
  }
}

// Bounding box of a group's defined members (matches render's member-bbox group box).
function groupBbox(schema: Schema, res: LayoutResult, members: string[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const defined = new Set(schema.tables.map((t) => t.name));
  for (const m of members) {
    if (!defined.has(m)) continue;
    const r = cardRect(res, m);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function pointInRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

describe('drawable edges (sync, unchanged)', () => {
  it('sample has 0 drawable edges (all refs dangling)', () => {
    expect(drawableEdges(sample).length).toBe(0);
  });
  it('demo has 5 drawable edges', () => {
    expect(drawableEdges(demo).length).toBe(5);
  });
});

describe('computeLayout produces non-overlapping cards', () => {
  it('sample: zero card overlaps', async () => {
    const res = await computeLayout(sample, measure);
    noOverlaps(sample, res);
  });
  it('demo: zero card overlaps', async () => {
    const res = await computeLayout(demo, measure);
    noOverlaps(demo, res);
  });
  // The core fix: the real 17-table schema must lay out with zero overlapping table rects.
  it('care_marketplace (17 tables): zero card overlaps', async () => {
    const res = await computeLayout(care, measure);
    noOverlaps(care, res);
  });
});

describe('computeLayout clusters groups into disjoint boxes', () => {
  // The 8 group member-bounding-boxes must not overlap each other — ELK's nested compound nodes
  // put each group's members in a disjoint container, so the bboxes come out disjoint too.
  it('care_marketplace: no two group bounding boxes overlap', async () => {
    const res = await computeLayout(care, measure);
    const boxes = care.groups.map((g) => groupBbox(care, res, g.tables));
    expect(care.groups.length).toBe(8);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          overlaps(boxes[i], boxes[j]),
          `group ${care.groups[i].name} overlaps group ${care.groups[j].name}`
        ).toBe(false);
      }
    }
  });

  // Strong clustering invariant: no group's bbox contains the center of a table that is not
  // a member of that group. This proves members are grouped tightly, not scattered.
  it('care_marketplace: no group bbox contains a non-member table center', async () => {
    const res = await computeLayout(care, measure);
    for (const g of care.groups) {
      const box = groupBbox(care, res, g.tables);
      const members = new Set(g.tables);
      for (const t of care.tables) {
        if (members.has(t.name)) continue;
        expect(
          pointInRect(center(cardRect(res, t.name)), box),
          `group ${g.name} bbox contains non-member ${t.name}`
        ).toBe(false);
      }
    }
  });
});

describe('computeLayout is deterministic', () => {
  it('two runs on demo produce deeply-equal positions', async () => {
    const a = await computeLayout(demo, measure);
    const b = await computeLayout(demo, measure);
    expect(b.positions).toEqual(a.positions);
  });
  it('two runs on demo (comments on) produce deeply-equal positions', async () => {
    const a = await computeLayout(demo, measure, undefined, true);
    const b = await computeLayout(demo, measure, undefined, true);
    expect(b.positions).toEqual(a.positions);
  });
});

describe('comment column sizing (Comments toggle)', () => {
  it('widens a table that has a column note when comments are on', () => {
    const users = demo.tables.find((t) => t.name === 'users')!;
    const compact = sizeCard(users, measure, false);
    const withComments = sizeCard(users, measure, true);
    // Only "id" carries a note ("UUIDv7"); the comment column is that note's measured width.
    const noteW = measure('UUIDv7'); // stub: 7.2 * 6
    expect(compact.commentColW).toBe(0);
    expect(withComments.commentColW).toBe(noteW);
    // widened width = compact + commentGap(20) + commentColW + padX(12)
    expect(withComments.w).toBe(compact.w + 20 + noteW + 12);
    expect(withComments.noteText).toContain('UUIDv7');
  });

  it('does not widen a table with no column notes even when comments are on', () => {
    const org = demo.tables.find((t) => t.name === 'organization')!;
    const compact = sizeCard(org, measure, false);
    const withComments = sizeCard(org, measure, true);
    expect(withComments.commentColW).toBe(0);
    expect(withComments.w).toBe(compact.w);
  });
});

describe('computeLayout keeps cards disjoint in comments mode', () => {
  // Comments widen most cards; ELK re-lays-out from the new widths, so the 17-table schema must
  // still produce zero overlapping rects (this is the whole point of re-layout on toggle).
  it('care_marketplace (17 tables), comments on: zero card overlaps', async () => {
    const res = await computeLayout(care, measure, undefined, true);
    noOverlaps(care, res);
  });
});
