// Standalone renderer harness (design.md §1, §5; tasks S4–S9). Inlines BOTH expected-JSON fixtures,
// switches between them, toggles notes, scrambles drag positions, and wires pan/zoom/fit/drag.

import type { Schema } from './contract';
import { render, canvasMeasure } from './render';
import type { RenderHandle } from './render';
import { computeLayout } from './layout';
import { createInteraction } from './interaction';
import demoJson from '../../fixtures/demo.expected.json';
import sampleJson from '../../fixtures/sample.expected.json';

const fixtures: Record<string, Schema> = {
  demo: demoJson as Schema,
  sample: sampleJson as Schema,
};

const stage = document.getElementById('stage') as HTMLDivElement;
const fixtureSel = document.getElementById('fixture') as HTMLSelectElement;
const notesChk = document.getElementById('notes') as HTMLInputElement;
const scrambleBtn = document.getElementById('scramble') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const fitBtn = document.getElementById('fit') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

const interaction = createInteraction(stage);

// Preset drag-position scrambles to exercise left/right/same-side routing (task S5).
const scrambles: Record<string, { x: number; y: number }>[] = [
  {}, // pristine layout
  // pull children to the LEFT of parents → exit-left / enter-right routing
  {
    users: { x: 600, y: 0 },
    organization: { x: 600, y: 260 },
    subscriptions: { x: 0, y: 0 },
    caregiver_profiles: { x: 0, y: 200 },
    reviews: { x: 0, y: 460 },
  },
  // stack everything in one column → x-overlap → both-right C curves
  {
    users: { x: 200, y: 0 },
    organization: { x: 200, y: 200 },
    subscriptions: { x: 200, y: 340 },
    caregiver_profiles: { x: 200, y: 480 },
    reviews: { x: 200, y: 700 },
  },
];
let scrambleIdx = 0;

let handle: RenderHandle | null = null;

async function draw(): Promise<void> {
  const schema = fixtures[fixtureSel.value];
  const lay = await computeLayout(schema, canvasMeasure, interaction.positions);
  handle = render(stage, schema, lay, { showNotes: notesChk.checked });
  interaction.attach(handle);
  statusEl.textContent = `${schema.tables.length} tables, notes ${
    notesChk.checked ? 'ON' : 'OFF'
  }`;
}

async function drawAndFit(): Promise<void> {
  await draw();
  interaction.fit();
}

fixtureSel.addEventListener('change', () => {
  // clear drag overrides when switching fixtures
  for (const k of Object.keys(interaction.positions)) delete interaction.positions[k];
  scrambleIdx = 0;
  void drawAndFit();
});

notesChk.addEventListener('change', () => void draw()); // no re-fit → proves x/y unchanged on toggle

scrambleBtn.addEventListener('click', () => {
  scrambleIdx = (scrambleIdx + 1) % scrambles.length;
  for (const k of Object.keys(interaction.positions)) delete interaction.positions[k];
  Object.assign(interaction.positions, scrambles[scrambleIdx]);
  void drawAndFit();
});

resetBtn.addEventListener('click', () => {
  for (const k of Object.keys(interaction.positions)) delete interaction.positions[k];
  scrambleIdx = 0;
  void drawAndFit();
});

fitBtn.addEventListener('click', () => interaction.fit());

void drawAndFit();

// Expose for headless assertions from browser automation.
(window as unknown as { __handle: () => RenderHandle | null }).__handle = () => handle;
