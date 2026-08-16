import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('unified')) return 'markdown';
          if (id.includes('/motion/') || id.includes('framer-motion')) return 'motion';
          if (id.includes('dexie') || id.includes('flexsearch') || id.includes('prompt-compressor')) return 'optimization';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
