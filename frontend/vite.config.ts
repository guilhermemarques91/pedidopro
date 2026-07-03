import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend em dev = app PHP servido pelo Docker (docker compose up), porta 8090.
// (8090 porque a 8080 costuma estar ocupada pela Evolution API neste PC.)
// Override: API_PROXY_TARGET=http://127.0.0.1:PORTA npm run dev
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
