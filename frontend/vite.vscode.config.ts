import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: '../vscode-extension/media/viewer',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/vscode.ts'),
      name: 'DBMLDiagram',
      formats: ['iife'],
      fileName: () => 'viewer.js',
      cssFileName: 'viewer',
    },
  },
});
