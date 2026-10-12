import './vscode.css';
import type { Schema } from './contract';
import { canvasMeasure, render } from './render';
import type { RenderHandle } from './render';
import { computeLayout } from './layout';
import { createInteraction } from './interaction';
import { hostMessageSchema, viewerStateSchema } from '../../vscode-extension/src/protocol';
import type { ViewerMessage, ViewerState } from '../../vscode-extension/src/protocol';

declare function acquireVsCodeApi(): {
  postMessage(message: ViewerMessage): void;
  getState(): unknown;
  setState(state: ViewerState): void;
};

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing diagram element: ${id}`);
  return found;
}

function input(id: string): HTMLInputElement {
  const found = element(id);
  if (!(found instanceof HTMLInputElement)) throw new Error(`Invalid input: ${id}`);
  return found;
}

function button(id: string): HTMLButtonElement {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Invalid button: ${id}`);
  return found;
}

const vscode = acquireVsCodeApi();
const stage = element('stage');
const errorBar = element('error');
const status = element('status');
const empty = element('empty');
const notes = input('notes');
const comments = input('comments');
const exportButton = button('export');
const interaction = createInteraction(stage);
const state = viewerStateSchema.safeParse(vscode.getState());
const positions: Pick<ViewerState, 'positions' | 'commentPositions'> = state.success
  ? state.data
  : { positions: {}, commentPositions: {} };

function activePositions(): ViewerState['positions'] {
  return comments.checked ? positions.commentPositions : positions.positions;
}

if (state.success) {
  notes.checked = state.data.notes;
  comments.checked = state.data.comments;
}
interaction.setPositions(activePositions());

let schema: Schema | null = null;
let handle: RenderHandle | null = null;
let version = -1;
let drawSequence = 0;
let fitNext = true;

function persist(): void {
  vscode.setState({
    notes: notes.checked,
    comments: comments.checked,
    positions: positions.positions,
    commentPositions: positions.commentPositions,
  });
}

function showError(message: string): void {
  errorBar.textContent = message;
  errorBar.hidden = false;
}

async function draw(): Promise<void> {
  if (!schema) return;
  const sequence = ++drawSequence;
  const current = schema;
  try {
    const layout = await computeLayout(current, canvasMeasure, interaction.positions, comments.checked);
    if (sequence !== drawSequence) return;
    handle = render(stage, current, layout, { showNotes: notes.checked });
    interaction.attach(handle);
    if (fitNext) {
      interaction.fit();
      fitNext = false;
    }
    empty.hidden = current.tables.length > 0;
    exportButton.disabled = current.tables.length === 0;
    status.textContent = `${current.tables.length} tables · ${current.refs.length} relationships`;
    persist();
  } catch (error) {
    if (sequence === drawSequence) showError(`Could not lay out diagram: ${error instanceof Error ? error.message : String(error)}`);
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = hostMessageSchema.safeParse(event.data);
  if (!message.success) return;
  const data = message.data;
  switch (data.kind) {
    case 'error':
      showError(data.message);
      status.textContent = 'Diagram unavailable';
      break;
    case 'update':
      if (data.version < version) return;
      version = data.version;
      if (!data.result.ok) {
        const error = data.result.error;
        ++drawSequence;
        showError(`Line ${error.line}, column ${error.column}: ${error.message}${handle ? ' Showing the last valid diagram.' : ''}`);
        status.textContent = 'DBML contains an error';
        return;
      }
      errorBar.hidden = true;
      schema = data.result.schema;
      for (const pins of [positions.positions, positions.commentPositions]) {
        for (const name of Object.keys(pins)) {
          if (!schema.tables.some((table) => table.name === name)) delete pins[name];
        }
      }
      void draw();
      break;
    default: {
      const exhaustive: never = data;
      return exhaustive;
    }
  }
});

element('source').addEventListener('click', () => vscode.postMessage({ kind: 'openSource' }));
element('fit').addEventListener('click', () => interaction.fit());
element('reset').addEventListener('click', () => {
  if (comments.checked) positions.commentPositions = {};
  else positions.positions = {};
  interaction.setPositions(activePositions());
  persist();
  fitNext = true;
  void draw();
});
notes.addEventListener('change', () => {
  persist();
  void draw();
});
comments.addEventListener('change', () => {
  interaction.setPositions(activePositions());
  fitNext = true;
  persist();
  void draw();
});
stage.addEventListener('pointerup', persist);
stage.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'f') interaction.fit();
});
exportButton.addEventListener('click', () => {
  if (!handle) return;
  const svg = handle.svg.cloneNode(true);
  if (!(svg instanceof SVGSVGElement)) return;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(stage.clientWidth));
  svg.setAttribute('height', String(stage.clientHeight));
  vscode.postMessage({ kind: 'exportSvg', svg: new XMLSerializer().serializeToString(svg) });
});
new ResizeObserver(() => interaction.fit()).observe(stage);
vscode.postMessage({ kind: 'ready' });
