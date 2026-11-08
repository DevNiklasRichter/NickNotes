import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/frontend'),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/frontend'),
    emptyOutDir: true,
  },
})
