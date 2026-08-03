// Option A adapter: calls the Rust parser command over Tauri IPC (design.md §4).
// Selected via VITE_ADAPTER=tauri; not bundled in the default fixture build.

import { invoke } from '@tauri-apps/api/core';
import type { ParseResult } from '../contract';
import type { ParseAdapter } from '../parse-adapter';

export const tauriAdapter: ParseAdapter = {
  async parse(text: string): Promise<ParseResult> {
    return invoke<ParseResult>('parse_dbml', { text });
  },
};
