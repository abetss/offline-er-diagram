import { expect, it, vi } from 'vitest';
import appHtml from '../index.html?raw';

it('opens folder DBML files as independent tabs and leaves tabs intact for a folder without DBML', async () => {
  document.body.innerHTML = appHtml;
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  await import('./app');
  await vi.waitFor(() => expect(document.querySelector('svg.erd')).not.toBeNull());

  const folderInput = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .find((input) => input.webkitdirectory);
  if (!folderInput) throw new Error('Missing folder picker');
  function file(path: string, text: string): File {
    const picked = new File([text], path.split('/').pop() || path);
    Object.defineProperties(picked, {
      webkitRelativePath: { value: path },
      text: { value: async () => text },
    });
    return picked;
  }
  Object.defineProperty(folderInput, 'files', {
    configurable: true,
    value: [
      file('schemas/users.dbml', 'Table users {\n id int [pk]\n}'),
      file('schemas/nested/users.DBML', 'Table nested_users {\n id int [pk]\n}'),
      file('schemas/empty.dbml', ''),
      file('schemas/notes.txt', 'notes'),
    ],
  });
  folderInput.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(document.getElementById('toast')?.textContent).toBe('Opened 3 DBML files.'));
  const titles = () => Array.from(document.querySelectorAll('.tab-title')).map((tab) => tab.textContent);
  expect(titles()).toEqual(['Demo', 'empty.dbml', 'nested/users.DBML', 'users.dbml']);
  const editor = document.querySelector<HTMLTextAreaElement>('#editor');
  expect(editor?.value).toBe('');
  expect(document.querySelector('svg.erd')).toBeNull();

  const nestedTab = Array.from(document.querySelectorAll<HTMLElement>('.tab'))
    .find((tab) => tab.textContent?.startsWith('nested/users.DBML'));
  nestedTab?.click();
  await vi.waitFor(() => expect(document.querySelector('svg.erd')).not.toBeNull());
  expect(editor?.value).toBe('Table nested_users {\n id int [pk]\n}');
  const recents: unknown = JSON.parse(localStorage.getItem('dbml.recentFiles') || '[]');
  expect(recents).toEqual([
    expect.objectContaining({ title: 'users.dbml', path: 'schemas/users.dbml' }),
    expect.objectContaining({ title: 'nested/users.DBML', path: 'schemas/nested/users.DBML' }),
  ]);

  Object.defineProperty(folderInput, 'files', { value: [file('empty/notes.txt', 'notes')] });
  folderInput.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(document.getElementById('toast')?.textContent).toBe('No DBML files found in this folder.'));
  expect(titles()).toEqual(['Demo', 'empty.dbml', 'nested/users.DBML', 'users.dbml']);
  expect(editor?.value).toBe('Table nested_users {\n id int [pk]\n}');
  vi.restoreAllMocks();
});
