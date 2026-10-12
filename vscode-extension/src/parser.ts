import { parseResultSchema } from './protocol';
import type { ParsedDbml } from './protocol';

export async function createParser(bytes: Uint8Array): Promise<(text: string) => ParsedDbml> {
  const { instance } = await WebAssembly.instantiate(Uint8Array.from(bytes), {});
  const { memory, dbml_alloc: alloc, dbml_free: free, dbml_parse: parse } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function'
      || typeof free !== 'function' || typeof parse !== 'function') {
    throw new Error('The bundled DBML parser has an incompatible WebAssembly interface.');
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return (text) => {
    const input = encoder.encode(text);
    const pointer: unknown = alloc(input.length);
    if (typeof pointer !== 'number') throw new Error('Invalid parser allocation.');
    try {
      new Uint8Array(memory.buffer, pointer, input.length).set(input);
      const output: unknown = parse(pointer, input.length);
      if (typeof output !== 'bigint') throw new Error('Invalid parser response.');
      const resultPointer = Number(output & 0xffff_ffffn);
      const resultLength = Number(output >> 32n);
      try {
        const json: unknown = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, resultPointer, resultLength)));
        return parseResultSchema.parse(json);
      } finally {
        free(resultPointer, resultLength);
      }
    } finally {
      free(pointer, input.length);
    }
  };
}
