import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = await mkdtemp(join(tmpdir(), 'dbml-vscode-test-'));
await build({
  entryPoints: [join(root, 'test/integration.ts')],
  outfile: join(root, 'dist/integration.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'],
});
await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, 'dist/integration.cjs'),
  ...(process.env.DBML_VSCODE_EXECUTABLE ? { vscodeExecutablePath: process.env.DBML_VSCODE_EXECUTABLE } : {}),
  launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes',
    '--user-data-dir', join(workspace, 'user-data'), '--extensions-dir', join(workspace, 'extensions')],
});
