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
const viewerScript = await readFile(resolve(root, 'media/viewer/viewer.js'), 'utf8');

async function waitFor(predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for diagram');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function createViewer(savedState) {
  const messages = [];
  let persisted;
  const dom = new JSDOM(viewerHtml({ scriptUri: 'viewer.js', styleUri: 'viewer.css', cspSource: 'https://resources.test', nonce: 'test-nonce' }), {
    runScripts: 'outside-only', pretendToBeVisual: true,
    beforeParse(window) {
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => messages.push(message),
        getState: () => savedState,
        setState: (state) => { persisted = JSON.parse(JSON.stringify(state)); },
      });
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.HTMLCanvasElement.prototype.getContext = () => null;
      window.SVGElement.prototype.setPointerCapture = () => {};
      window.SVGElement.prototype.releasePointerCapture = () => {};
    },
  });
  const { window } = dom;
  window.eval(viewerScript);
  return { window, messages, getState: () => persisted, close: () => window.close() };
}

test('built webview renders DBML, keeps the last valid diagram, and supports its controls', async () => {
  const { window, messages, getState, close } = createViewer();
  try {
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
    await waitFor(() => getState()?.notes === true);
    const users = () => window.document.querySelector('g.table[data-name="users"]');
    const widthBeforeComments = Number(users().querySelector('rect').getAttribute('width'));
    const comments = window.document.getElementById('comments');
    assert.equal(comments.checked, false);
    comments.checked = true;
    comments.dispatchEvent(new window.Event('change'));
    await waitFor(() => Array.from(users().querySelectorAll('g.row text')).some((text) => text.textContent === 'UUIDv7'));
    assert.equal(getState().comments, true);
    assert.ok(Number(users().querySelector('rect').getAttribute('width')) > widthBeforeComments);
    window.document.getElementById('export').click();
    assert.equal(messages.at(-1).kind, 'exportSvg');
    assert.match(messages.at(-1).svg, /<svg/);
    assert.match(messages.at(-1).svg, /users/);
    assert.match(messages.at(-1).svg, /UUIDv7/);
    comments.checked = false;
    comments.dispatchEvent(new window.Event('change'));
    await waitFor(() => Number(users().querySelector('rect').getAttribute('width')) === widthBeforeComments);
    assert.equal(getState().comments, false);
    assert.equal(Array.from(users().querySelectorAll('g.row text')).some((text) => text.textContent === 'UUIDv7'), false);
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
    close();
  }
});

test('Comments restores its setting and keeps separate dragged layouts for each display mode', async () => {
  const plainPosition = { x: 500, y: 600 };
  const viewer = createViewer({ notes: false, positions: { users: plainPosition } });
  let restored;
  const demo = await readFile(resolve(root, '../fixtures/demo.dbml'), 'utf8');
  function send(window) {
    window.dispatchEvent(new window.MessageEvent('message', { data: { kind: 'update', version: 1, result: parse(demo) } }));
  }
  function table(window) {
    return window.document.querySelector('g.table[data-name="users"]');
  }
  try {
    const { window } = viewer;
    send(window);
    await waitFor(() => window.document.querySelectorAll('g.table').length === 5);
    assert.deepEqual(viewer.getState().positions.users, plainPosition);
    const plainTransform = table(window).getAttribute('transform');
    const comments = window.document.getElementById('comments');
    assert.equal(comments.checked, false);
    comments.checked = true;
    comments.dispatchEvent(new window.Event('change'));
    await waitFor(() => table(window).querySelector('line'));
    const stage = window.document.getElementById('stage');
    table(window).dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    stage.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30 }));
    stage.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30 }));
    assert.ok(viewer.getState().commentPositions.users);
    assert.deepEqual(viewer.getState().positions.users, plainPosition);
    const commentTransform = table(window).getAttribute('transform');
    const commentState = viewer.getState();
    comments.checked = false;
    comments.dispatchEvent(new window.Event('change'));
    await waitFor(() => table(window).getAttribute('transform') === plainTransform);
    restored = createViewer(commentState);
    send(restored.window);
    await waitFor(() => restored.window.document.querySelectorAll('g.table').length === 5);
    assert.equal(restored.window.document.getElementById('comments').checked, true);
    assert.equal(table(restored.window).getAttribute('transform'), commentTransform);
    assert.ok(Array.from(table(restored.window).querySelectorAll('g.row text')).some((text) => text.textContent === 'UUIDv7'));
    restored.window.document.getElementById('reset').click();
    assert.deepEqual(restored.getState().commentPositions, {});
    assert.deepEqual(restored.getState().positions.users, plainPosition);
    assert.equal(restored.getState().notes, false);
    await waitFor(() => table(restored.window).getAttribute('transform') !== commentTransform);
  } finally {
    viewer.close();
    restored?.close();
  }
});
