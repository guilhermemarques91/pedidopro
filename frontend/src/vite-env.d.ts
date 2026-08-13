/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // Portais embutidos no dock. Vazio = usa o padrão de config/webapps.ts.
  readonly VITE_IFOOD_URL?: string;
  readonly VITE_99FOOD_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Id do build injetado pelo Vite (define). Comparado com /version.json em runtime
// para forçar reload quando sai versão nova. Ver VersionWatcher.tsx.
declare const __BUILD_ID__: string;
