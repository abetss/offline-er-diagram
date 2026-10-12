import { z } from 'zod';
import type { Schema } from '../../frontend/src/contract';

const schema = z.object({
  tables: z.array(z.object({
    name: z.string(),
    note: z.string().nullable(),
    columns: z.array(z.object({
      name: z.string(), type: z.string(), pk: z.boolean(), notNull: z.boolean(),
      unique: z.boolean(), note: z.string().nullable(), isFk: z.boolean(),
    })),
  })),
  refs: z.array(z.object({
    fromTable: z.string(), fromColumn: z.string(), toTable: z.string(), toColumn: z.string(),
    relation: z.enum(['>', '<', '-', '<>']), note: z.string().nullable(),
    source: z.enum(['explicit', 'inline', 'from-note']),
  })),
  groups: z.array(z.object({ name: z.string(), tables: z.array(z.string()) })),
}) satisfies z.ZodType<Schema>;

export const parseResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), schema, error: z.null() }),
  z.object({
    ok: z.literal(false), schema: z.null(),
    error: z.object({ line: z.number().int().positive(), column: z.number().int().positive(), message: z.string() }),
  }),
]);
export type ParsedDbml = z.infer<typeof parseResultSchema>;

export const viewerMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('openSource') }),
  z.object({ kind: z.literal('exportSvg'), svg: z.string().max(50_000_000) }),
]);
export type ViewerMessage = z.infer<typeof viewerMessageSchema>;

export const hostMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('update'), version: z.number().int(), result: parseResultSchema }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;

export const viewerStateSchema = z.object({
  notes: z.boolean(),
  positions: z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() })),
});
export type ViewerState = z.infer<typeof viewerStateSchema>;
