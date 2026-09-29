import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:1234',
        ws: true,
        rewrite: (p) => p.replace(/^\/ws/, ''),
      },
    },
  },
});
