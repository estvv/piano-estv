import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1100 },
  worker: { format: 'es' },
  test: {
    // Some read whole keyboards or pieces: slow when the machine is busy.
    testTimeout: 30_000, environment: 'happy-dom', retry: process.env.CI ? 2 : 0 },
  server: {
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:3015', changeOrigin: true },
    },
  },
});
