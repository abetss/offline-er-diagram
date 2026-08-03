// Schema JSON contract — the single source of truth for parser output = renderer input.
// See docs/data-contract.md §2. Key/field order below matches the canonical declaration order.

export interface Schema {
  tables: Table[];
  refs: Ref[];
  groups: TableGroup[];
}

export interface Table {
  name: string; // canonical table name (never the alias)
  note: string | null; // table-level Note, verbatim after string processing
  columns: Column[];
}

export interface Column {
  name: string;
  type: string; // verbatim source slice incl. params, e.g. "numeric(10,2)"
  pk: boolean;
  notNull: boolean; // true if `not null` OR `pk`
  unique: boolean;
  note: string | null; // full original note text, INCLUDING any "FK -> t.c" prefix
  isFk: boolean; // derived
}

export type Relation = '>' | '<' | '-' | '<>';
export type RefSource = 'explicit' | 'inline' | 'from-note';

export interface Ref {
  fromTable: string;
  fromColumn: string;
  toTable: string; // may name a table NOT present in tables[] (dangling refs are legal)
  toColumn: string;
  relation: Relation; // as written in source; NOT normalized/flipped
  note: string | null;
  source: RefSource;
}

export interface TableGroup {
  name: string;
  tables: string[]; // member names as written; may include undefined tables
}

// ---- Parse envelope (what the parse call returns) ----

export interface ParseError {
  line: number; // 1-based
  column: number; // 1-based
  message: string;
}

export interface ParseResult {
  ok: boolean;
  schema: Schema | null; // present iff ok
  error: ParseError | null; // present iff !ok; parser is fail-fast: first error only
}
