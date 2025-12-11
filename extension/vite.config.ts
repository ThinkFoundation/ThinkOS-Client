import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Main config for popup
export default defineConfig({
  plugins: [
    react(),
    // Custom plugin to build content script and background script after main build
    {
      name: 'build-extension-scripts',
      closeBundle: async () => {
        // Build content script as IIFE (content scripts can't use ES modules)
        await build({
          configFile: false,
          define: {
            'process.env.NODE_ENV': JSON.stringify('production'),
          },
          css: {
            postcss: path.resolve(__dirname, 'postcss.config.js'),
          },
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: path.resolve(__dirname, 'src/content.tsx'),
              name: 'ThinkContent',
              formats: ['iife'],
              fileName: () => 'content.js',
            },
            rollupOptions: {
              output: {
                extend: true,
              },
            },
          },
          resolve: {
            alias: {
              "@": path.resolve(__dirname, "./src"),
            },
          },
        });

        // Build background service worker as IIFE
        await build({
          configFile: false,
          define: {
            'process.env.NODE_ENV': JSON.stringify('production'),
          },
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry: path.resolve(__dirname, 'src/background.ts'),
              name: 'ThinkBackground',
              formats: ['iife'],
              fileName: () => 'background.js',
            },
            rollupOptions: {
              output: {
                extend: true,
              },
            },
          },
          resolve: {
            alias: {
              "@": path.resolve(__dirname, "./src"),
            },
          },
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
