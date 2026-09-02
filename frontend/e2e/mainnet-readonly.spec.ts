import { test, expect } from '@playwright/test'
import { importPublicWallet, PUBLIC_ADDRESS } from './fixtures'

const backend = process.env.WALLET_E2E_MAINNET_READONLY_URL!
if (!backend || !['127.0.0.1', 'localhost'].includes(new URL(backend).hostname)) {
  throw new Error('Read-only MAINNET testing requires an isolated loopback backend with an exact semantic read-only outbound allowlist')
}
const watchAddress = process.env.WALLET_E2E_WATCH_ADDRESS
if (watchAddress && !/^0x[0-9a-fA-F]{40}$/.test(watchAddress)) throw new Error('Invalid public watch address')

// This file never submits a transaction. It is selected exclusively by the
// explicit read-only mode; ordinary synthetic send tests cannot run with it.
test('MAINNET read-only: real token UI, account/history/fees and validation errors', async ({ page, context }, testInfo) => {
  const forwardedMethods: string[] = []
  let submitAttempts = 0
  let suppressedLocalRegistration = 0
  const browserReads: Array<{ path: string; status: number }> = []
  const pwaOrigin = new URL(testInfo.project.use.baseURL as string).origin
  const readPaths = new Set(['tokens', 'token', 'balances', 'transfers', 'next-nonce', 'mempool-recommended-fees'].map(path => `/api/core/v1/wallet/${path}`))
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== pwaOrigin) { await route.abort('blockedbyclient'); return }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return }
    if (url.pathname.endsWith('/wallet/submit-tx')) { submitAttempts++; await route.abort('blockedbyclient'); return }
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (url.pathname.endsWith('/device/register')) {
        suppressedLocalRegistration++
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      } else await route.abort('blockedbyclient')
      return
    }
    if (!readPaths.has(url.pathname)) { await route.abort('blockedbyclient'); return }
    forwardedMethods.push(request.method())
    const response = await route.fetch({ url: new URL(url.pathname + url.search, backend).href })
    browserReads.push({ path: url.pathname, status: response.status() })
    await route.fulfill({ response })
  })

  const get = (path: string) => {
    forwardedMethods.push('GET')
    return page.request.get(new URL(path, backend).href)
  }
  const tokenResponse = await get('/api/core/v1/wallet/tokens')
  expect(tokenResponse.status()).toBe(200)
  const tokens = await tokenResponse.json() as Array<{ address: string; name: string; numberOfDecimals: number }>
  expect(tokens.length).toBeGreaterThan(0)
  const native = tokens.find(token => /^0x0{40}$/i.test(token.address))
  expect(native).toBeTruthy()
  expect(tokens.every(token => Number.isInteger(token.numberOfDecimals) && token.numberOfDecimals >= 0)).toBe(true)

  // Only a public, deterministic empty/test key enters the PWA. A separate
  // watch address below is read by GET and never represented as a owned key.
  await importPublicWallet(page)
  await page.getByRole('switch', { name: 'Show all', exact: true }).check()
  await expect(page.getByText(native!.name, { exact: true }).last()).toBeVisible()
  await page.getByRole('button').filter({ has: page.getByText(native!.name, { exact: true }) }).first().click()
  await expect(page.getByText('Transfer History', { exact: true })).toBeVisible()

  const fees = await get('/api/core/v1/wallet/mempool-recommended-fees')
  expect(fees.status()).toBe(200)
  const feeData = await fees.json() as Record<string, { baseFee?: string; feePerByte?: string; totalForAverageTx?: string }>
  for (const level of ['slow', 'standard', 'fast']) {
    expect(feeData[level]).toBeTruthy()
    for (const value of Object.values(feeData[level])) if (typeof value === 'string') expect(value).toMatch(/^\d+$/)
  }

  const address = watchAddress ?? PUBLIC_ADDRESS
  const balances = await get(`/api/core/v1/wallet/balances?addresses=${address}`)
  expect(balances.status()).toBe(200)
  const balanceData = await balances.json() as Array<{ address: string; balance: string; totalBalance?: string; lockedMiningReward?: string; spendableBalance?: string }>
  for (const balance of balanceData) {
    expect(balance.address.toLowerCase()).toBe(address.toLowerCase())
    for (const name of ['balance', 'totalBalance', 'lockedMiningReward', 'spendableBalance'] as const) {
      if (balance[name] !== undefined) expect(balance[name]).toMatch(/^\d+$/)
    }
  }
  const first = await get(`/api/core/v1/wallet/transfers?addresses=${address}&pageNumber=0&pageSize=2`)
  const second = await get(`/api/core/v1/wallet/transfers?addresses=${address}&pageNumber=1&pageSize=2`)
  expect(first.status()).toBe(200)
  expect(second.status()).toBe(200)
  const firstPage = await first.json() as { content?: unknown[]; totalElements?: number; totalPages?: number }
  const secondPage = await second.json() as { content?: unknown[]; totalElements?: number; totalPages?: number }
  expect(Array.isArray(firstPage.content)).toBe(true)
  expect(Array.isArray(secondPage.content)).toBe(true)
  expect((firstPage.content ?? []).length).toBeLessThanOrEqual(2)
  expect((secondPage.content ?? []).length).toBeLessThanOrEqual(2)

  const invalid = await get('/api/core/v1/wallet/balances?addresses=')
  expect(invalid.status()).toBe(400)
  expect(submitAttempts).toBe(0)
  expect(suppressedLocalRegistration, 'The retired PWA must not attempt device registration').toBe(0)
  const forwardedWrites = forwardedMethods.filter(method => !['GET', 'HEAD'].includes(method)).length
  expect(forwardedWrites).toBe(0)
  expect(browserReads.every(read => read.status === 200)).toBe(true)
  await testInfo.attach('read-only-summary', {
    contentType: 'application/json',
    body: JSON.stringify({ mode: 'MAINNET_READ_ONLY', tokenCount: tokens.length, availableDecimals: [...new Set(tokens.map(token => token.numberOfDecimals))], usedPublicWatchAddress: !!watchAddress, balances: balanceData.length, firstPageCount: firstPage.content!.length, secondPageCount: secondPage.content!.length, browserReadCount: browserReads.length, localRegistrationSuppressed: suppressedLocalRegistration, realTransactions: 0, submitAttempts, forwardedWrites }),
  })
})
