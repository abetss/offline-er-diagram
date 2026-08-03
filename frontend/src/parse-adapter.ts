// The single parse seam. app.ts talks only to this interface; the concrete adapter is chosen at
// build time via VITE_ADAPTER (default 'fixture'). See design.md §3–§4.

import type { ParseResult } from './contract';
import { fixtureAdapter } from './adapters/fixture';

export interface ParseAdapter {
  parse(text: string): Promise<ParseResult>;
}

// A thin proxy that forwards to the real tauri adapter, imported dynamically on first parse so the
// default fixture build never bundles @tauri-apps/api.
let realTauri: ParseAdapter | null = null;
const tauriAdapterProxy: ParseAdapter = {
  async parse(text: string): Promise<ParseResult> {
    if (!realTauri) {
      const mod = await import('./adapters/tauri');
      realTauri = mod.tauriAdapter;
    }
    return realTauri.parse(text);
  },
};

export function selectAdapter(): ParseAdapter {
  const which = import.meta.env.VITE_ADAPTER ?? 'fixture';
  return which === 'tauri' ? tauriAdapterProxy : fixtureAdapter;
}
