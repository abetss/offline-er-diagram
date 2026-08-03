import { describe, it, expect } from 'vitest';
import type { Schema } from './contract';
import demoJson from '../../fixtures/demo.expected.json';

// Compile-time check: the fixture must satisfy the Schema type. Runtime check: shape sanity.
const demo: Schema = demoJson as Schema;

describe('contract types', () => {
  it('demo fixture conforms to Schema', () => {
    expect(demo.tables.length).toBe(5);
    expect(demo.refs.length).toBe(5);
    expect(demo.groups.length).toBe(1);
    // pk implies notNull (contract §4.2)
    for (const t of demo.tables) {
      for (const c of t.columns) {
        if (c.pk) expect(c.notNull).toBe(true);
      }
    }
  });
});
