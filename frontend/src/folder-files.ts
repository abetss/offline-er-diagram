export interface FolderFiles {
  path: string;
  files: { path: string; text: string }[];
  errors: string[];
}

export async function readBrowserFolder(files: Iterable<File>): Promise<FolderFiles> {
  const result: FolderFiles = { path: '', files: [], errors: [] };
  const dbmlFiles = Array.from(files).filter((file) => /\.dbml$/i.test(file.name));
  dbmlFiles.sort((a, b) => {
    const first = a.webkitRelativePath || a.name;
    const second = b.webkitRelativePath || b.name;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  for (const file of dbmlFiles) {
    const path = file.webkitRelativePath || file.name;
    if (!result.path && file.webkitRelativePath) result.path = path.split('/')[0];
    try {
      result.files.push({ path, text: await file.text() });
    } catch (error) {
      result.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function folderTabTitle(folder: FolderFiles, path: string): string {
  const prefix = folder.path.replace(/[\\/]+$/, '') + '/';
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith(prefix.replace(/\\/g, '/'))
    ? normalized.slice(prefix.length)
    : normalized;
}
