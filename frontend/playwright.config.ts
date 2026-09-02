import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.WALLET_E2E_PORT ?? 4173)
const baseURL = `http://127.0.0.1:${port}`
const production = process.env.WALLET_E2E_PRODUCTION === '1'

export default defineConfig({
  testDir: './e2e',
  ...(process.env.WALLET_E2E_MAINNET_READONLY_URL ? { testMatch: '**/mainnet-readonly.spec.ts' } : process.env.WALLET_E2E_CROSS_BROWSER === '1' ? { testMatch: '**/cross-browser.spec.ts' } : {}),
  testIgnore: [
    ...(!process.env.WALLET_E2E_MAINNET_READONLY_URL ? ['**/mainnet-readonly.spec.ts'] : []),
    ...(process.env.WALLET_E2E_CROSS_BROWSER !== '1' ? ['**/cross-browser.spec.ts'] : []),
    ...(!production || process.env.WALLET_E2E_BACKEND_URL ? ['**/pwa-offline.spec.ts', '**/pwa-update.spec.ts'] : []),
    ...(!process.env.WALLET_E2E_BASELINE_DIST ? ['**/pwa-update.spec.ts'] : []),
    ...(process.env.WALLET_E2E_BACKEND_URL ? ['**/frontend-regressions.spec.ts', '**/frontend-scanner.spec.ts'] : []),
  ],
  metadata: { readOnlyMainnet: !!process.env.WALLET_E2E_MAINNET_READONLY_URL, pwa: production ? 'fresh apps/web/dist via Vite preview' : 'apps/web source via Vite', api: process.env.WALLET_E2E_BACKEND_URL ? 'loopback Boot4 with synthetic node/disposable PostgreSQL' : 'isolated route fixtures' },
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['json', { outputFile: join(tmpdir(), 'goldenera-wallet-e2e-results.json') }],
  ],
  outputDir: join(tmpdir(), 'goldenera-wallet-e2e-artifacts'),
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 430, height: 932 },
  },
  projects: process.env.WALLET_E2E_CROSS_BROWSER === '1'
    ? [
      { name: 'firefox-current', use: { ...devices['Desktop Firefox'], browserName: 'firefox' } },
      ...(process.env.WALLET_E2E_WEBKIT === '1' ? [{ name: 'webkit-current', use: { ...devices['Desktop Safari'], browserName: 'webkit' as const } }] : []),
    ]
    : [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js ${production ? 'preview ' : ''}--host 127.0.0.1 --port ${port} --strictPort`,
    cwd: fileURLToPath(new URL('./apps/web', import.meta.url)),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60000,
  },
})
