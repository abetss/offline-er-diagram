import { Registry, INITIAL, parseRawGrammar } from 'vscode-textmate';
import type { IGrammar } from 'vscode-textmate';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import onigUrl from 'vscode-oniguruma/release/onig.wasm?url';
import grammarSource from '../../vscode-extension/syntaxes/dbml.tmLanguage.json?raw';

const dbmlGrammar = parseRawGrammar(grammarSource, 'dbml.tmLanguage.json');

export async function loadDbmlGrammar(wasm: ArrayBuffer): Promise<IGrammar> {
  await loadWASM(wasm);
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new OnigScanner(patterns),
      createOnigString: (value) => new OnigString(value),
    }),
    loadGrammar: async (scope) => scope === dbmlGrammar.scopeName ? dbmlGrammar : null,
  });
  const grammar = await registry.loadGrammar(dbmlGrammar.scopeName);
  if (!grammar) throw new Error('DBML grammar could not be loaded');
  return grammar;
}

const scopeClasses = [
  ['comment.', 'dbml-comment'],
  ['string.', 'dbml-string'],
  ['keyword.', 'dbml-keyword'],
  ['entity.name.', 'dbml-name'],
  ['storage.type.', 'dbml-type'],
  ['constant.', 'dbml-constant'],
] as const;

function tokenClass(scopes: string[]): string | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    for (const [prefix, className] of scopeClasses) {
      if (scopes[i].startsWith(prefix)) return className;
    }
  }
  return null;
}

export function renderDbmlHighlight(target: HTMLElement, text: string, grammar: IGrammar): void {
  const fragment = document.createDocumentFragment();
  let stack = INITIAL;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    for (const token of result.tokens) {
      const value = line.slice(token.startIndex, token.endIndex);
      const className = tokenClass(token.scopes);
      if (className) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = value;
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(value));
      }
    }
    if (index < lines.length - 1) fragment.appendChild(document.createTextNode('\n'));
  });
  // Keep the final empty line the same height as the textarea without adding editable content.
  fragment.appendChild(document.createTextNode('\u200b'));
  target.replaceChildren(fragment);
}

export function createDbmlHighlighter(editor: HTMLTextAreaElement, layer: HTMLElement) {
  let grammar: IGrammar | null = null;
  let frame: number | undefined;

  function syncViewport(): void {
    layer.style.width = `${editor.clientWidth}px`;
    layer.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  }

  function refresh(): void {
    if (grammar) renderDbmlHighlight(layer, editor.value, grammar);
    syncViewport();
  }

  function input(): void {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      refresh();
    });
  }

  editor.addEventListener('input', input);
  editor.addEventListener('scroll', syncViewport);
  const resize = new ResizeObserver(syncViewport);
  resize.observe(editor);
  const ready = (async () => {
    const response = await fetch(onigUrl);
    if (!response.ok) throw new Error(`Syntax highlighting asset failed to load (${response.status})`);
    grammar = await loadDbmlGrammar(await response.arrayBuffer());
    refresh();
    editor.parentElement?.classList.add('syntax-ready');
  })();

  return {
    ready,
    setText(text: string): void {
      editor.value = text;
      refresh();
    },
    destroy(): void {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize.disconnect();
      editor.removeEventListener('input', input);
      editor.removeEventListener('scroll', syncViewport);
    },
  };
}
