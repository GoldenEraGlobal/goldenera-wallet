import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false, // Disable DTS for now - dev mode works with source imports
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', '@tanstack/react-query', '@project/ui', '@project/api', 'wouter', 'zustand'],
})
