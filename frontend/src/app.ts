// Two-pane app shell (design.md §3–§4): left textarea editor, right diagram pane, a toolbar
// (Notes toggle, Fit) and a bottom error bar. Owns debounce, error bar, and last-good-schema policy.
// Parses/lays out nothing itself — it calls the ParseAdapter and the pure render/interaction.
//
// Documents live as tabs: each tab owns its own DBML text, last-good schema, and dragged positions.
// The editor + diagram always reflect the active tab; switching tabs swaps them and re-fits.

import './app.css';
import type { Schema } from './contract';
import { render, canvasMeasure } from './render';
import type { RenderHandle } from './render';
import { computeLayout } from './layout';
import { createInteraction } from './interaction';
import { selectAdapter } from './parse-adapter';

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!('__TAURI_INTERNALS__' in window)) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<T>(cmd, args);
}

const adapter = selectAdapter();

const editor = document.getElementById('editor') as HTMLTextAreaElement;
const diagram = document.getElementById('diagram') as HTMLDivElement;
const panes = document.getElementById('panes') as HTMLDivElement;
const divider = document.getElementById('divider') as HTMLDivElement;
const editorToggle = document.getElementById('editor-toggle') as HTMLButtonElement;
const errorBar = document.getElementById('error-bar') as HTMLDivElement;
const notesToggle = document.getElementById('notes-toggle') as HTMLInputElement;
const commentsToggle = document.getElementById('comments-toggle') as HTMLInputElement;
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement;
const exportSvgBtn = document.getElementById('export-svg-btn') as HTMLButtonElement;
const exportPngBtn = document.getElementById('export-png-btn') as HTMLButtonElement;
const exportMermaidBtn = document.getElementById('export-mermaid-btn') as HTMLButtonElement;
const tabsEl = document.getElementById('tabs') as HTMLDivElement;
const newTabBtn = document.getElementById('new-tab') as HTMLButtonElement;
const toast = document.getElementById('toast') as HTMLDivElement;

const interaction = createInteraction(diagram);

type Pins = Record<string, { x: number; y: number }>;

interface Tab {
  id: string;
  title: string;
  text: string; // editor content (source of truth for this tab)
  lastGood: Schema | null; // last successfully-parsed schema
  // Dragged pins, kept separately per display mode: comments-on cards are wider, so a manual
  // arrangement in one mode shouldn't disturb the other (toggling restores each mode's layout).
  pins: { plain: Pins; comments: Pins };
}

const tabs: Tab[] = [];
let activeId = '';
let idSeq = 0;
let untitledSeq = 0;
let showNotes = false;
let showComments = false;
let handle: RenderHandle | null = null;
let fitNext = true; // fit the diagram after the next successful draw (set on tab switch / first paint)

function activeTab(): Tab {
  return tabs.find((t) => t.id === activeId)!;
}

// The pin set for the current display mode (comments-on cards are wider → their own arrangement).
function activePins(): Pins {
  return activeTab().pins[showComments ? 'comments' : 'plain'];
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

async function draw(): Promise<void> {
  const at = activeTab();
  if (!at || !at.lastGood) {
    diagram.innerHTML = ''; // blank/new tab: clear any stale diagram from the previous tab
    return;
  }
  const lay = await computeLayout(at.lastGood, canvasMeasure, activePins(), showComments);
  handle = render(diagram, at.lastGood, lay, { showNotes });
  interaction.attach(handle);
  if (fitNext) {
    interaction.fit();
    fitNext = false;
  }
}

function showError(line: number, column: number, message: string): void {
  errorBar.textContent = `Error (line ${line}:${column}): ${message}`;
  errorBar.classList.add('visible');
}
function clearError(): void {
  errorBar.textContent = '';
  errorBar.classList.remove('visible');
}

async function reparse(): Promise<void> {
  const at = activeTab();
  if (!at) return;
  at.text = editor.value;
  if (!editor.value.trim()) {
    at.lastGood = null;
    clearError();
    await draw(); // clears the diagram for an empty tab
    return;
  }
  const result = await adapter.parse(editor.value);
  if (result.ok && result.schema) {
    clearError();
    at.lastGood = result.schema;
    await draw();
  } else if (result.error) {
    showError(result.error.line, result.error.column, result.error.message);
    // keep last good diagram (do not redraw)
  }
}

// ---- Tabs & State Persistence --------------------------------------------

function saveState(): void {
  try {
    const serializableTabs = tabs.map((t) => ({
      id: t.id,
      title: t.title,
      text: t.text,
      pins: t.pins,
    }));
    localStorage.setItem('dbml.tabs', JSON.stringify(serializableTabs));
    localStorage.setItem('dbml.activeId', activeId);
    localStorage.setItem('dbml.idSeq', String(idSeq));
    localStorage.setItem('dbml.untitledSeq', String(untitledSeq));
    localStorage.setItem('dbml.showNotes', showNotes ? '1' : '0');
    localStorage.setItem('dbml.showComments', showComments ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
}

function restoreState(): boolean {
  try {
    const rawTabs = localStorage.getItem('dbml.tabs');
    if (!rawTabs) return false;
    const parsedTabs = JSON.parse(rawTabs);
    if (!Array.isArray(parsedTabs) || parsedTabs.length === 0) return false;

    tabs.length = 0;
    for (const pt of parsedTabs) {
      if (pt && typeof pt.id === 'string' && typeof pt.title === 'string' && typeof pt.text === 'string') {
        tabs.push({
          id: pt.id,
          title: pt.title,
          text: pt.text,
          lastGood: null,
          pins: pt.pins && typeof pt.pins === 'object' ? pt.pins : { plain: {}, comments: {} },
        });
      }
    }
    if (tabs.length === 0) return false;

    const savedActiveId = localStorage.getItem('dbml.activeId');
    activeId = savedActiveId && tabs.some((t) => t.id === savedActiveId) ? savedActiveId : tabs[0].id;

    const savedIdSeq = Number(localStorage.getItem('dbml.idSeq'));
    if (!isNaN(savedIdSeq) && savedIdSeq > idSeq) idSeq = savedIdSeq;

    const savedUntitledSeq = Number(localStorage.getItem('dbml.untitledSeq'));
    if (!isNaN(savedUntitledSeq) && savedUntitledSeq > untitledSeq) untitledSeq = savedUntitledSeq;

    showNotes = localStorage.getItem('dbml.showNotes') === '1';
    showComments = localStorage.getItem('dbml.showComments') === '1';
    notesToggle.checked = showNotes;
    commentsToggle.checked = showComments;

    return true;
  } catch {
    return false;
  }
}

function renderTabBar(): void {
  tabsEl.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = t.id === activeId ? 'tab active' : 'tab';
    el.title = t.title;

    const label = document.createElement('span');
    label.className = 'tab-title';
    label.textContent = t.title;
    el.appendChild(label);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      void closeTab(t.id);
    });
    el.appendChild(close);

    el.addEventListener('click', () => void activate(t.id));
    tabsEl.appendChild(el);
  }
}

function createTab(title: string, text: string): Tab {
  const tab: Tab = {
    id: 'tab' + ++idSeq,
    title,
    text,
    lastGood: null,
    pins: { plain: {}, comments: {} },
  };
  tabs.push(tab);
  saveState();
  return tab;
}

async function activate(id: string): Promise<void> {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeId = id;
  editor.value = tab.text;
  interaction.setPositions(activePins());
  fitNext = true; // re-fit the incoming tab's diagram
  renderTabBar();
  saveState();
  await reparse();
}

async function openInNewTab(title: string, text: string, path?: string): Promise<void> {
  const tab = createTab(title, text);
  addRecentFile(title, text, path);
  await activate(tab.id);
}

async function closeTab(id: string): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const wasActive = activeId === id;
  tabs.splice(idx, 1);
  saveState();
  if (tabs.length === 0) {
    const t = createTab(`Untitled ${++untitledSeq}`, '');
    await activate(t.id);
    return;
  }
  if (wasActive) {
    const neighbor = tabs[Math.min(idx, tabs.length - 1)];
    await activate(neighbor.id);
  } else {
    renderTabBar();
  }
}

newTabBtn.addEventListener('click', () => {
  const t = createTab(`Untitled ${++untitledSeq}`, '');
  void activate(t.id);
  editor.focus();
});

// ---- Editor / toolbar wiring --------------------------------------------

let debounceTimer: number | undefined;
editor.addEventListener('input', () => {
  const at = activeTab();
  if (at) at.text = editor.value; // keep the tab in sync immediately (before debounce fires)
  saveState();
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void reparse(), 250);
});

notesToggle.addEventListener('change', () => {
  showNotes = notesToggle.checked;
  saveState();
  void draw();
});

commentsToggle.addEventListener('change', () => {
  showComments = commentsToggle.checked;
  interaction.setPositions(activePins()); // swap to this mode's pin set
  saveState();
  fitNext = true; // card widths change → reflow + re-fit
  void draw();
});

fitBtn.addEventListener('click', () => interaction.fit());
diagram.addEventListener('pointerup', () => saveState());

const savedWidth = localStorage.getItem('dbml.editorWidth');
if (savedWidth) {
  panes.style.setProperty('--editor-width', savedWidth);
}

let dragging = false;
divider.addEventListener('pointerdown', (e) => {
  dragging = true;
  divider.setPointerCapture(e.pointerId);
});
divider.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const panesRect = panes.getBoundingClientRect();
  let width = e.clientX - panesRect.left;
  const max = panesRect.width - 320;
  width = Math.max(160, Math.min(width, max));
  panes.style.setProperty('--editor-width', `${width}px`);
});
divider.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  divider.releasePointerCapture(e.pointerId);
  const width = panes.style.getPropertyValue('--editor-width');
  if (width) localStorage.setItem('dbml.editorWidth', width);
});

function applyCollapsed(collapsed: boolean): void {
  panes.classList.toggle('editor-collapsed', collapsed);
  editorToggle.textContent = collapsed ? '⟩' : '⟨';
  editorToggle.title = collapsed ? 'Show editor' : 'Collapse editor';
}
applyCollapsed(localStorage.getItem('dbml.editorCollapsed') === '1');
editorToggle.addEventListener('click', () => {
  const collapsed = !panes.classList.contains('editor-collapsed');
  applyCollapsed(collapsed);
  localStorage.setItem('dbml.editorCollapsed', collapsed ? '1' : '0');
});

// ---- Recent Files --------------------------------------------------------

interface RecentFile {
  title: string;
  text: string;
  path?: string;
  timestamp: number;
}

function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem('dbml.recentFiles');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addRecentFile(title: string, text: string, path?: string): void {
  if (!text || !text.trim()) return;
  const list = getRecentFiles();
  const filtered = list.filter((item) => (path && item.path ? item.path !== path : item.title !== title));
  filtered.unshift({
    title,
    text,
    path,
    timestamp: Date.now(),
  });
  const trimmed = filtered.slice(0, 50); // Keep max 50 recent files
  try {
    localStorage.setItem('dbml.recentFiles', JSON.stringify(trimmed));
  } catch {
    /* ignore storage errors */
  }
  void updateNativeMenu();
}

function clearRecentFiles(): void {
  localStorage.removeItem('dbml.recentFiles');
  void updateNativeMenu();
}

async function updateNativeMenu(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');

    // App Menu
    const appMenu = await Submenu.new({
      text: 'DBML Diagrams',
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Services' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Hide' }),
        await PredefinedMenuItem.new({ item: 'HideOthers' }),
        await PredefinedMenuItem.new({ item: 'ShowAll' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Quit' }),
      ],
    });

    // Open Recent Submenu
    const recentItems = getRecentFiles();
    const recentSubmenuItems = [];

    if (recentItems.length === 0) {
      recentSubmenuItems.push(
        await MenuItem.new({
          text: 'No Recent Files',
          enabled: false,
        })
      );
    } else {
      for (const item of recentItems) {
        const menuItem = await MenuItem.new({
          text: item.title,
          action: () => {
            const existing = tabs.find((tab) => tab.title === item.title || tab.text === item.text);
            if (existing) {
              void activate(existing.id);
            } else {
              void openInNewTab(item.title, item.text, item.path);
            }
          },
        });
        recentSubmenuItems.push(menuItem);
      }
      recentSubmenuItems.push(await PredefinedMenuItem.new({ item: 'Separator' }));
      recentSubmenuItems.push(
        await MenuItem.new({
          text: 'Clear Menu',
          action: () => {
            clearRecentFiles();
          },
        })
      );
    }

    const recentSubmenu = await Submenu.new({
      text: 'Open Recent',
      items: recentSubmenuItems,
    });

    // File Menu
    const fileMenu = await Submenu.new({
      text: 'File',
      items: [
        await MenuItem.new({
          text: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          action: () => {
            fileInput.click();
          },
        }),
        recentSubmenu,
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'CloseWindow' }),
      ],
    });

    // Edit Menu
    const editMenu = await Submenu.new({
      text: 'Edit',
      items: [
        await PredefinedMenuItem.new({ item: 'Undo' }),
        await PredefinedMenuItem.new({ item: 'Redo' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Cut' }),
        await PredefinedMenuItem.new({ item: 'Copy' }),
        await PredefinedMenuItem.new({ item: 'Paste' }),
        await PredefinedMenuItem.new({ item: 'SelectAll' }),
      ],
    });

    // View Menu
    const viewMenu = await Submenu.new({
      text: 'View',
      items: [
        await MenuItem.new({
          text: 'Toggle Notes',
          action: () => {
            notesToggle.checked = !notesToggle.checked;
            showNotes = notesToggle.checked;
            saveState();
            void draw();
          },
        }),
        await MenuItem.new({
          text: 'Toggle Comments',
          action: () => {
            commentsToggle.checked = !commentsToggle.checked;
            showComments = commentsToggle.checked;
            interaction.setPositions(activePins());
            saveState();
            fitNext = true;
            void draw();
          },
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          text: 'Fit Diagram',
          action: () => {
            interaction.fit();
          },
        }),
      ],
    });

    // Window Menu
    const windowMenu = await Submenu.new({
      text: 'Window',
      items: [
        await PredefinedMenuItem.new({ item: 'Minimize' }),
        await PredefinedMenuItem.new({ item: 'Maximize' }),
      ],
    });

    const menu = await Menu.new({
      items: [appMenu, fileMenu, editMenu, viewMenu, windowMenu],
    });

    await menu.setAsAppMenu();
  } catch (err) {
    console.error('Failed to update native app menu:', err);
  }
}

// A custom HTML tooltip because SVG <title> tooltips are unreliable in the app's WebKit webview.
const noteTip = document.createElement('div');
noteTip.id = 'note-tooltip';
document.body.appendChild(noteTip);
diagram.addEventListener('mousemove', (e) => {
  const t = (e.target as Element).closest?.('[data-note]');
  if (t) {
    noteTip.textContent = t.getAttribute('data-note') || '';
    noteTip.style.left = `${e.clientX + 12}px`;
    noteTip.style.top = `${e.clientY + 14}px`;
    noteTip.classList.add('visible');
  } else if (noteTip.classList.contains('visible')) {
    noteTip.classList.remove('visible');
  }
});
diagram.addEventListener('mouseleave', () => noteTip.classList.remove('visible'));

let toastTimer: number | undefined;
function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000);
}

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.dbml,.txt,text/plain';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const text = await f.text();
  await openInNewTab(f.name, text, f.name); // opening a file adds a new tab named after the file
  fileInput.value = '';
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    fileInput.click();
  }
});

function currentSvgString(): string | null {
  const svg = document.querySelector('svg.erd') as SVGSVGElement | null;
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(rect.width)));
  clone.setAttribute('height', String(Math.round(rect.height)));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', '#F8FAFC');
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportSvgBtn.addEventListener('click', async () => {
  interaction.fit();
  const svg = currentSvgString();
  if (!svg) return;
  const path = await tauriInvoke<string>('save_export', { name: 'diagram', kind: 'svg', data: svg });
  if (path) {
    showToast(`Saved to ${path}`);
  } else {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'diagram.svg');
  }
});

exportPngBtn.addEventListener('click', async () => {
  interaction.fit();
  const svg = currentSvgString();
  const el = document.querySelector('svg.erd') as SVGSVGElement | null;
  if (!svg || !el) return;
  const rect = el.getBoundingClientRect();
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  await img.decode();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, rect.width, rect.height);
  const dataUrl = canvas.toDataURL('image/png');
  const path = await tauriInvoke<string>('save_export', {
    name: 'diagram',
    kind: 'png',
    data: dataUrl.split(',')[1],
  });
  if (path) {
    showToast(`Saved to ${path}`);
  } else {
    const a = document.createElement('a');
    a.download = 'diagram.png';
    a.href = dataUrl;
    a.click();
  }
});

exportMermaidBtn.addEventListener('click', async () => {
  try {
    const mmd = await tauriInvoke<string>('to_mermaid', { text: editor.value });
    if (mmd === null) {
      showToast('Mermaid export is available in the desktop app.');
      return;
    }
    const path = await tauriInvoke<string>('save_export', { name: 'diagram', kind: 'mmd', data: mmd });
    if (path) {
      showToast(`Saved to ${path}`);
    }
  } catch (err) {
    showToast(`Mermaid export failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ---- Boot ----------------------------------------------------------------

// Seed the first tab with the demo schema so first paint renders tables AND relationship splines
// through the real parser (the fixture adapter ignores this text; the tauri adapter parses it).
const demoText = `Project upliv_demo {
  database_type: 'PostgreSQL'
}

Table users {
  id uuid [pk, note: 'UUIDv7']
  email varchar(200) [not null, unique]
  display_name text
  created_at timestamptz [default: \`now()\`]

  Note: 'All humans in the system.'
}

Table caregiver_profiles {
  user_id uuid [pk, ref: - users.id]
  organization_id uuid
  bio text
  hourly_rate numeric(10,2)
  location geography(Point,4326)
}

Table organization {
  id uuid [pk]
  name text [not null]
}

Table subscriptions {
  id uuid [pk]
  user_id uuid [not null, note: 'FK -> users.id (the seeker)']
  status text
  current_period_end timestamptz
}

Table reviews {
  id uuid [pk]
  author_id uuid [not null, note: 'FK -> users.id']
  caregiver_id uuid [not null]
  rating int
  body text [note: 'Free-text review body']
}

Ref: caregiver_profiles.organization_id > organization.id [note: 'employer']
Ref: reviews.caregiver_id > caregiver_profiles.user_id

TableGroup Billing {
  subscriptions
  reviews
}
`;

const restored = restoreState();
if (!restored) {
  const first = createTab('Demo', demoText);
  activeId = first.id;
  editor.value = first.text;
  interaction.setPositions(activePins());
  renderTabBar();
  void reparse();
} else {
  const at = activeTab();
  editor.value = at.text;
  interaction.setPositions(activePins());
  renderTabBar();
  void reparse();
}

void updateNativeMenu();

// If launched via the CLI with a file (`dbml open schema.dbml`), open it or update first tab.
void (async () => {
  const cli = await tauriInvoke<{ path: string; text: string } | null>('cli_schema');
  if (cli && typeof cli.text === 'string' && cli.text.trim()) {
    const title = basename(cli.path);
    const at = activeTab();
    if (!restored && tabs.length === 1 && at.title === 'Demo') {
      at.title = title;
      at.text = cli.text;
      editor.value = cli.text;
      fitNext = true;
      renderTabBar();
      await reparse();
      saveState();
    } else {
      await openInNewTab(title, cli.text, cli.path);
    }
    addRecentFile(title, cli.text, cli.path);
  }
})();

// A second `dbml open <file>` while the app is running forwards the file here (single-instance
// plugin) instead of opening a second window — open it as a new tab named after the file.
void (async () => {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ path: string; text: string }>('open-file', (e) => {
    const { path, text } = e.payload;
    if (typeof text === 'string') void openInNewTab(basename(path), text, path);
  });
})();
