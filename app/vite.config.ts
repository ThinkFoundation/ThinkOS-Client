import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);

// Resolve pdfjs-dist worker path dynamically (works with pnpm)
const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjsWorkerPath = path.join(pdfjsDistPath, 'build', 'pdf.worker.min.mjs');

// Copy worker to public folder for dev mode (vite serves public folder as-is)
// Always copy to ensure it stays up-to-date when pdfjs-dist updates
const publicWorkerPath = path.resolve(__dirname, 'public', 'pdf.worker.min.mjs');
fs.copyFileSync(pdfjsWorkerPath, publicWorkerPath);

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: pdfjsWorkerPath,
          dest: '.',
        },
      ],
    }),
  ],
  base: './',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    outDir: 'dist',
  },
});
