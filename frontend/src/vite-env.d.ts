/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Id do build injetado pelo Vite (define). Comparado com /version.json em runtime
// para forçar reload quando sai versão nova. Ver VersionWatcher.tsx.
declare const __BUILD_ID__: string;
