import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { viewerHtml } from '../src/html.ts';
import { createParser } from '../src/parser.ts';

const frontendRequire = createRequire(resolve(import.meta.dirname, '../../frontend/package.json'));
const { JSDOM } = frontendRequire('jsdom');
const root = resolve(import.meta.dirname, '..');
const parse = await createParser(await readFile(resolve(root, 'media/parser.wasm')));

async function waitFor(predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for diagram');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('built webview renders DBML, keeps the last valid diagram, and supports its controls', async () => {
  const messages = [];
  let persisted;
  const dom = new JSDOM(viewerHtml({ scriptUri: 'viewer.js', styleUri: 'viewer.css', cspSource: 'https://resources.test', nonce: 'test-nonce' }), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(window) {
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => messages.push(message),
        getState: () => undefined,
        setState: (state) => { persisted = state; },
      });
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.HTMLCanvasElement.prototype.getContext = () => null;
    },
  });
  const { window } = dom;
  try {
    window.eval(await readFile(resolve(root, 'media/viewer/viewer.js'), 'utf8'));
    assert.equal(messages[0].kind, 'ready');
    const send = (version, text) => window.dispatchEvent(new window.MessageEvent('message', {
      data: { kind: 'update', version, result: parse(text) },
    }));
    const demo = await readFile(resolve(root, '../fixtures/demo.dbml'), 'utf8');
    send(1, demo);
    await waitFor(() => window.document.querySelectorAll('g.table').length === 5);
    assert.match(window.document.getElementById('status').textContent, /5 tables/);
    assert.equal(window.document.getElementById('error').hidden, true);
    window.document.getElementById('source').click();
    assert.equal(messages.at(-1).kind, 'openSource');
    const notes = window.document.getElementById('notes');
    notes.checked = true;
    notes.dispatchEvent(new window.Event('change'));
    await waitFor(() => persisted?.notes === true);
    window.document.getElementById('export').click();
    assert.equal(messages.at(-1).kind, 'exportSvg');
    assert.match(messages.at(-1).svg, /<svg/);
    assert.match(messages.at(-1).svg, /users/);
    send(2, 'Table users {\n id int\n');
    assert.equal(window.document.querySelectorAll('g.table').length, 5);
    assert.match(window.document.getElementById('error').textContent, /last valid diagram/);
    send(3, 'Table replacement {\n id int [pk]\n}');
    await waitFor(() => window.document.querySelectorAll('g.table').length === 1);
    assert.equal(window.document.querySelector('g.table').getAttribute('data-name'), 'replacement');
    send(1, demo);
    assert.equal(window.document.querySelectorAll('g.table').length, 1);
    send(4, '');
    await waitFor(() => window.document.querySelectorAll('g.table').length === 0);
    assert.equal(window.document.getElementById('empty').hidden, false);
    assert.equal(window.document.getElementById('export').disabled, true);
  } finally {
    window.close();
  }
});
