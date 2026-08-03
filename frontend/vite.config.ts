/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base so bundled assets resolve under the Tauri asset protocol in the packaged app.
  base: process.env.VITE_ADAPTER === 'tauri' ? './' : '/',
  server: {
    fs: { allow: ['..'] }, // allow importing ../fixtures/*.json
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'preview.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
