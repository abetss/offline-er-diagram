// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { folderTabTitle, readBrowserFolder } from './folder-files';

function folderFile(path: string, text: string): File {
  const file = new File([text], path.split('/').pop() || path);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('opening a browser folder', () => {
  it('reads every DBML file in path order, including nested and empty files', async () => {
    const folder = await readBrowserFolder([
      folderFile('schemas/schema.dbml', 'Table top {\n id int\n}'),
      folderFile('schemas/notes.txt', 'notes'),
      folderFile('schemas/nested/schema.DBML', 'Table child {\n id int\n}'),
      folderFile('schemas/empty.dbml', ''),
      folderFile('schemas/schema.dbml.bak', 'backup'),
    ]);
    expect(folder.path).toBe('schemas');
    expect(folder.files).toEqual([
      { path: 'schemas/empty.dbml', text: '' },
      { path: 'schemas/nested/schema.DBML', text: 'Table child {\n id int\n}' },
      { path: 'schemas/schema.dbml', text: 'Table top {\n id int\n}' },
    ]);
    expect(folder.errors).toEqual([]);
    expect(folder.files.map((file) => folderTabTitle(folder, file.path))).toEqual([
      'empty.dbml', 'nested/schema.DBML', 'schema.dbml',
    ]);
  });

  it('keeps readable files when another file cannot be read', async () => {
    const bad = folderFile('schemas/bad.dbml', '');
    Object.defineProperty(bad, 'text', { value: () => Promise.reject(new Error('Read failed')) });
    const folder = await readBrowserFolder([bad, folderFile('schemas/good.dbml', 'good')]);
    expect(folder.files).toEqual([{ path: 'schemas/good.dbml', text: 'good' }]);
    expect(folder.errors).toEqual(['schemas/bad.dbml: Read failed']);
  });

  it('returns no files when the folder has no DBML', async () => {
    expect((await readBrowserFolder([folderFile('schemas/notes.txt', 'notes')])).files).toEqual([]);
    expect((await readBrowserFolder([])).files).toEqual([]);
  });

  it('uses relative paths for native folders on macOS and Windows', () => {
    const folder = { path: '/Users/me/schemas/', files: [], errors: [] };
    expect(folderTabTitle(folder, '/Users/me/schemas/nested/schema.dbml')).toBe('nested/schema.dbml');
    expect(folderTabTitle({ ...folder, path: 'C:\\schemas' }, 'C:\\schemas\\nested\\schema.dbml'))
      .toBe('nested/schema.dbml');
  });
});
