import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/frontend'),
  cacheDir: process.env.NICKNOTES_VITE_CACHE_DIR || undefined,
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/frontend'),
    emptyOutDir: true,
  },
})
