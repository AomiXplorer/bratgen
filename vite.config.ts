import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Absolute root base: the app is served from the domain root on Vercel, and SPA
// rewrites mean a nested URL must still load assets from /assets (a relative base
// would resolve against the nested path and break).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
  },
});
