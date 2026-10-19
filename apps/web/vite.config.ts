import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const appDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: resolve(appDirectory, '../..'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:10001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:10001', changeOrigin: true },
    },
  },
});
