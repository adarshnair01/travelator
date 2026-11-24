import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages skips files whose names start with "_" (a Jekyll rule), so build
// output must never use such names. public/.nojekyll turns the rule off as well;
// this keeps things working even if that file is ever lost.
const clean = (name) => (name || 'chunk').replace(/^_+/, '') || 'chunk'

// Served from adarshnair.in/travelator/ (the travel blog's deploy builds this repo into that folder).
export default defineConfig({
  base: '/travelator/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: (chunk) => `assets/${clean(chunk.name)}-[hash].js`,
        assetFileNames: (asset) => {
          const base = clean(asset.names?.[0] || asset.name || 'asset')
          return `assets/${base.replace(/\.[^.]+$/, '')}-[hash][extname]`
        },
      },
    },
  },
})
