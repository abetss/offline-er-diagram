/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADAPTER?: 'fixture' | 'tauri';
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
