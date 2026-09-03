import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    compilerOptions: {
      composite: false,
      // tsup 8.5.1 injects baseUrl internally. Source tsconfigs no longer use it;
      // keep this compatibility option limited to its declaration worker.
      ignoreDeprecations: '6.0',
    },
  },
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  esbuildOptions(options) {
    options.banner = {
      js: '"use client"',
    }
  },
})
