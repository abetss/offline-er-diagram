import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { createDbmlHighlighter, loadDbmlGrammar, renderDbmlHighlight } from './dbml-highlight';

const require = createRequire(import.meta.url);
const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
const wasmBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);

it('renders DBML scopes with the actual VS Code grammar and treats note HTML as text', async () => {
  const grammar = await loadDbmlGrammar(wasmBuffer);
  const target = document.createElement('pre');
  const source = "Table users {\n id uuid [pk]\n Note: '''\n Table Ref <img src=x onerror=alert(1)>\n '''\n balance numeric [default: -12.5]\n // Ref: users.id > teams.id\n}";
  renderDbmlHighlight(target, source, grammar);
  expect(target.textContent?.replace(/\u200b$/, '')).toBe(source);
  expect(target.querySelector('.dbml-name')?.textContent).toBe('users');
  expect(target.querySelector('.dbml-type')?.textContent).toBe('uuid');
  expect(Array.from(target.querySelectorAll('.dbml-keyword')).map((span) => span.textContent)).toContain('pk');
  expect(Array.from(target.querySelectorAll('.dbml-string')).map((span) => span.textContent).join('')).toContain('Table Ref <img');
  expect(target.querySelector('img')).toBeNull();
  expect(Array.from(target.querySelectorAll('.dbml-comment')).map((span) => span.textContent).join('')).toContain('// Ref:');
  expect(target.querySelector('.dbml-constant')?.textContent).toBe('-12.5');
});

it('updates highlights while typing and switching text, and follows the editor scroll and width', async () => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(wasmBuffer));
  const host = document.createElement('div');
  const layer = document.createElement('pre');
  const editor = document.createElement('textarea');
  host.append(layer, editor);
  Object.defineProperty(editor, 'clientWidth', { value: 320 });
  const highlighter = createDbmlHighlighter(editor, layer);
  try {
    highlighter.setText('Table users {\n id int [pk]\n}');
    await highlighter.ready;
    expect(host.classList.contains('syntax-ready')).toBe(true);
    expect(layer.style.width).toBe('320px');
    editor.value = 'Table teams {\n id uuid\n}';
    editor.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(layer.querySelector('.dbml-type')?.textContent).toBe('uuid'));
    highlighter.setText('');
    expect(layer.querySelector('span')).toBeNull();
    highlighter.setText('Table users {\n name text\n}');
    expect(editor.value).toContain('name text');
    expect(layer.querySelector('.dbml-type')?.textContent).toBe('text');
    editor.scrollTop = 45;
    editor.scrollLeft = 12;
    editor.dispatchEvent(new Event('scroll'));
    expect(layer.style.transform).toBe('translate(-12px, -45px)');
  } finally {
    highlighter.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
