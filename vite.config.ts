import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync, rmdirSync, renameSync } from 'fs';

const copyManifest = () => {
  return {
    name: 'copy-manifest',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json')
      );
      
      const demoSrcPath = resolve(__dirname, 'demo.html');
      const demoDestPath = resolve(__dirname, 'dist/demo.html');
      if (existsSync(demoSrcPath)) {
        copyFileSync(demoSrcPath, demoDestPath);
      }
      
      const popupSrcPath = resolve(__dirname, 'dist/src/popup.html');
      const popupDestPath = resolve(__dirname, 'dist/popup.html');
      if (existsSync(popupSrcPath)) {
        renameSync(popupSrcPath, popupDestPath);
      }
      
      const offscreenSrcPath = resolve(__dirname, 'dist/src/offscreen.html');
      const offscreenDestPath = resolve(__dirname, 'dist/offscreen.html');
      if (existsSync(offscreenSrcPath)) {
        renameSync(offscreenSrcPath, offscreenDestPath);
      }
      
      const iconsSrcDir = resolve(__dirname, 'src/assets/icons');
      const iconsDestDir = resolve(__dirname, 'dist/assets');
      
      if (existsSync(iconsSrcDir)) {
        if (!existsSync(iconsDestDir)) {
          mkdirSync(iconsDestDir, { recursive: true });
        }
        
        const iconFiles = readdirSync(iconsSrcDir);
        iconFiles.forEach((file) => {
          copyFileSync(
            resolve(iconsSrcDir, file),
            resolve(iconsDestDir, file)
          );
        });
      }
      
      const pdfWorkerSrc = resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
      const pdfWorkerDest = resolve(__dirname, 'dist/pdf.worker.min.mjs');
      if (existsSync(pdfWorkerSrc)) {
        copyFileSync(pdfWorkerSrc, pdfWorkerDest);
      }
      
      const distSrcDir = resolve(__dirname, 'dist/src');
      if (existsSync(distSrcDir)) {
        try {
          const files = readdirSync(distSrcDir);
          if (files.length === 0) {
            rmdirSync(distSrcDir);
          }
        } catch (error) {
        }
      }
    },
  };
};

export default defineConfig({
  plugins: [react(), copyManifest()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.html'),
        offscreen: resolve(__dirname, 'src/offscreen.html'),
        content: resolve(__dirname, 'src/content.ts'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'content' || chunkInfo.name === 'background' || chunkInfo.name === 'offscreen'
            ? '[name].js'
            : 'assets/[name].js';
        },
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) => {
          const fileName = assetInfo.names?.[0] ?? '';
          if (fileName.includes('popup.html')) {
            return 'popup.html';
          }
          if (fileName.includes('offscreen.html')) {
            return 'offscreen.html';
          }
          if (fileName.endsWith('.css')) {
            return '[name].[ext]';
          }
          return 'assets/[name].[ext]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});

