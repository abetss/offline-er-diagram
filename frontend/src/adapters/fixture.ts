// Dev/test adapter: lets app.ts ship before any real parser exists (design.md §3).
// Always returns the demo schema; returns ok:false at line 1 if the text contains '!!'
// (a cheap way to exercise the error-bar path without a real parser).

import type { ParseResult } from '../contract';
import type { ParseAdapter } from '../parse-adapter';
import demoSchema from '../../../fixtures/todo.expected';

export const fixtureAdapter: ParseAdapter = {
  async parse(text: string): Promise<ParseResult> {
    if (text.includes('!!')) {
      return {
        ok: false,
        schema: null,
        error: { line: 1, column: 1, message: "Unexpected '!!'" },
      };
    }
    return { ok: true, schema: demoSchema, error: null };
  },
};
