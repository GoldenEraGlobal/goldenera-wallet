import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreRequire = createRequire(new URL('./packages/core/package.json', import.meta.url))
const local = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@goldenera/cryptoj': coreRequire.resolve('@goldenera/cryptoj'),
      '@tanstack/react-query': coreRequire.resolve('@tanstack/react-query'),
      '@capacitor/preferences': coreRequire.resolve('@capacitor/preferences'),
      '@capacitor/core': coreRequire.resolve('@capacitor/core'),
      '@capacitor-mlkit/barcode-scanning': coreRequire.resolve('@capacitor-mlkit/barcode-scanning'),
      'scroll-into-view-if-needed': coreRequire.resolve('scroll-into-view-if-needed'),
      'capacitor-secure-storage-plugin': coreRequire.resolve('capacitor-secure-storage-plugin'),
      '@project/api': local('./packages/api/src/index.ts'),
      '@project/ui': local('./packages/ui/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    clearMocks: true,
    restoreMocks: true,
  },
})
