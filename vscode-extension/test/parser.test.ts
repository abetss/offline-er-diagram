import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createParser } from '../src/parser';
import { hostMessageSchema, viewerMessageSchema } from '../src/protocol';

const root = resolve(__dirname, '..');
const parser = readFile(resolve(root, 'media/parser.wasm')).then(createParser);

for (const fixture of ['sample', 'demo']) {
  test(`bundled Rust WebAssembly parser matches the ${fixture} golden fixture`, async () => {
    const parse = await parser;
    const text = await readFile(resolve(root, `../fixtures/${fixture}.dbml`), 'utf8');
    const expected: unknown = JSON.parse(await readFile(resolve(root, `../fixtures/${fixture}.expected.json`), 'utf8'));
    const result = parse(text);
    assert.equal(result.ok, true);
    assert.deepEqual(result.schema, expected);
  });
}

test('reports parse errors and recovers on the next edit', async () => {
  const parse = await parser;
  const invalid = parse('Table users {\n id int [pk]\n');
  assert.equal(invalid.ok, false);
  if (invalid.ok) assert.fail('Expected a parse error');
  assert.ok(invalid.error.line > 0);
  assert.ok(invalid.error.column > 0);
  assert.ok(invalid.error.message.length > 0);
  const valid = parse('Table users {\n id int [pk]\n}');
  assert.equal(valid.ok, true);
  assert.equal(valid.schema?.tables[0].name, 'users');
});

test('round trips UTF-8 notes, memory growth, and repeated parses', async () => {
  const parse = await parser;
  const note = 'café 日本語 🗄️ '.repeat(10_000);
  const text = `Table users {\n id int [pk, note: '${note}']\n}`;
  const first = parse(text);
  assert.equal(first.ok, true);
  assert.equal(first.schema?.tables[0].columns[0].note, note);
  for (let index = 0; index < 100; index++) {
    const result = parse('Table items {\n id int\n}');
    assert.equal(result.ok, true);
    assert.equal(result.schema?.tables[0].name, 'items');
  }
});

test('message boundaries reject malformed results and unsupported commands', () => {
  assert.equal(hostMessageSchema.safeParse({ kind: 'update', version: 1, result: { ok: true, schema: null, error: null } }).success, false);
  assert.equal(viewerMessageSchema.safeParse({ kind: 'execute', command: 'anything' }).success, false);
  assert.equal(viewerMessageSchema.safeParse({ kind: 'exportSvg', svg: 3 }).success, false);
});
