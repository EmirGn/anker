import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 3000, sourcemap: false },
  server: { port: 5173, host: true },
});
