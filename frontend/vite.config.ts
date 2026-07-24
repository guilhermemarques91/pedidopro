import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend em dev = app PHP servido pelo Docker (docker compose up), porta 8090.
// (8090 porque a 8080 costuma estar ocupada pela Evolution API neste PC.)
// Override: API_PROXY_TARGET=http://127.0.0.1:PORTA npm run dev
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8090';

// Id único por build: embutido no bundle (__BUILD_ID__) E gravado em /version.json.
// O cliente compara os dois em runtime; se divergirem, uma versão nova foi publicada
// e a aba se recarrega sozinha (mata bundle velho em cache — a causa da comanda
// duplicada quando uma aba antiga imprime sem a dedup atual). Ver VersionWatcher.
const buildId = new Date().toISOString();

function emitVersion(): Plugin {
  return {
    name: 'emit-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), tailwindcss(), emitVersion()],
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1 em vez de localhost por causa do Topaz OFD (sequestra o loopback)
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
