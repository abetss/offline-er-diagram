import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

const require = createRequire(import.meta.url);
const wasm = await readFile(require.resolve('vscode-oniguruma/release/onig.wasm'));
await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const contribution = manifest.contributes.grammars.find((item) => item.language === 'dbml');
assert.ok(contribution, 'DBML must contribute a syntax grammar');
const registry = new textmate.Registry({
  onigLib: Promise.resolve({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (value) => new oniguruma.OnigString(value),
  }),
  loadGrammar: async (scope) => scope === contribution.scopeName
    ? textmate.parseRawGrammar(await readFile(new URL(`../${contribution.path}`, import.meta.url), 'utf8'), contribution.path)
    : null,
});
const grammar = await registry.loadGrammar(contribution.scopeName);
assert.ok(grammar);

function tokenize(source) {
  let stack = textmate.INITIAL;
  const lines = source.split('\n').map((text) => {
    const result = grammar.tokenizeLine(text, stack);
    assert.equal(result.stoppedEarly, false);
    stack = result.ruleStack;
    return { text, tokens: result.tokens };
  });
  return { lines, stack };
}

function expectScope(lines, line, text, scope) {
  const start = lines[line].text.indexOf(text);
  assert.notEqual(start, -1, `Missing ${text} on line ${line}`);
  const token = lines[line].tokens.find((item) => item.startIndex <= start && item.endIndex > start);
  assert.ok(token?.scopes.includes(scope), `${text}: expected ${scope}, got ${token?.scopes.join(', ')}`);
}

test('highlights declarations, quoted columns, types, settings, references, and defaults', () => {
  const { lines, stack } = tokenize([
    'Project demo { database_type: \'PostgreSQL\' }',
    'Table users as U [headercolor: #12abcd] {',
    '  id uuid [pk, increment]',
    '"full name" "double precision" [not null, unique]',
    '  balance numeric(10, 2) [default: -12.5]',
    '  active boolean [default: true]',
    '  created_at timestamptz [default: `now()`]',
    '  status account_status [note: \'Table Ref pk\']',
    '  team_id int [ref: > teams.id]',
    '  indexes {',
    '    (id, team_id) [unique]',
    '  }',
    '  default int [pk]',
    '}',
    'Ref membership: users.id <> teams.id [delete: cascade]',
    'TableGroup Accounts { users }',
    'Enum account_status {',
    '  active [note: \'Active account\']',
    '}',
  ].join('\n'));
  expectScope(lines, 0, 'Project', 'keyword.declaration.dbml');
  expectScope(lines, 1, 'users', 'entity.name.type.dbml');
  expectScope(lines, 1, '#12abcd', 'constant.other.color.dbml');
  expectScope(lines, 2, 'id', 'variable.other.property.dbml');
  expectScope(lines, 2, 'uuid', 'storage.type.dbml');
  expectScope(lines, 2, 'pk', 'keyword.other.setting.dbml');
  expectScope(lines, 3, '"full name"', 'variable.other.property.dbml');
  expectScope(lines, 3, '"double precision"', 'storage.type.dbml');
  expectScope(lines, 3, 'not null', 'keyword.other.setting.dbml');
  expectScope(lines, 4, '10', 'constant.numeric.dbml');
  expectScope(lines, 4, '-12.5', 'constant.numeric.dbml');
  expectScope(lines, 5, 'true', 'constant.language.dbml');
  expectScope(lines, 6, 'now()', 'string.interpolated.dbml');
  expectScope(lines, 7, 'account_status', 'storage.type.dbml');
  expectScope(lines, 7, 'Table Ref pk', 'string.quoted.single.dbml');
  expectScope(lines, 8, '>', 'keyword.operator.relationship.dbml');
  expectScope(lines, 8, 'teams', 'entity.name.type.dbml');
  expectScope(lines, 9, 'indexes', 'keyword.declaration.dbml');
  expectScope(lines, 12, 'default', 'variable.other.property.dbml');
  expectScope(lines, 12, 'int', 'storage.type.dbml');
  expectScope(lines, 14, '<>', 'keyword.operator.relationship.dbml');
  expectScope(lines, 14, 'delete', 'keyword.other.setting.dbml');
  expectScope(lines, 14, 'cascade', 'constant.language.dbml');
  expectScope(lines, 15, 'Accounts', 'entity.name.type.dbml');
  expectScope(lines, 16, 'account_status', 'entity.name.type.dbml');
  expectScope(lines, 17, 'active', 'constant.other.enum.dbml');
  assert.equal(stack.depth, 1);
});

test('keeps comments, multiline notes, and escaped strings separate from code', () => {
  const { lines, stack } = tokenize([
    '/* Table fake {',
    '  id int [pk]',
    '} */',
    'Table users {',
    "  Note: '''",
    '    Table fake { id int [pk] }',
    "  '''",
    "  name text [note: 'it\\'s a Table'] // Ref: fake.id > users.id",
    '  id int [pk]',
    '}',
    'Ref: users.id - teams.id',
  ].join('\n'));
  expectScope(lines, 0, 'Table', 'comment.block.dbml');
  expectScope(lines, 1, 'int', 'comment.block.dbml');
  expectScope(lines, 5, 'Table', 'string.quoted.multi.dbml');
  expectScope(lines, 5, 'pk', 'string.quoted.multi.dbml');
  expectScope(lines, 7, "\\'", 'constant.character.escape.dbml');
  expectScope(lines, 7, 'Table', 'string.quoted.single.dbml');
  expectScope(lines, 7, 'Ref', 'comment.line.double-slash.dbml');
  expectScope(lines, 8, 'int', 'storage.type.dbml');
  expectScope(lines, 10, '-', 'keyword.operator.relationship.dbml');
  assert.equal(stack.depth, 1);
});

test('highlights single-line tables and recovers after an unfinished single-quoted string', () => {
  const { lines, stack } = tokenize("Table users { id int [pk] }\nNote: 'unfinished\nTable teams { id uuid }");
  expectScope(lines, 0, 'int', 'storage.type.dbml');
  expectScope(lines, 1, 'unfinished', 'string.quoted.single.dbml');
  expectScope(lines, 2, 'Table', 'keyword.declaration.dbml');
  expectScope(lines, 2, 'uuid', 'storage.type.dbml');
  assert.equal(stack.depth, 1);
});

test('tokenizes every shipped DBML fixture without leaving an open grammar context', async () => {
  const fixtures = new URL('../../fixtures/', import.meta.url);
  for (const name of await readdir(fixtures)) {
    if (!name.endsWith('.dbml')) continue;
    const { lines, stack } = tokenize(await readFile(new URL(name, fixtures), 'utf8'));
    assert.equal(stack.depth, 1, name);
    assert.ok(lines.some((line) => line.tokens.some((token) => token.scopes.includes('storage.type.dbml'))), name);
  }
});
