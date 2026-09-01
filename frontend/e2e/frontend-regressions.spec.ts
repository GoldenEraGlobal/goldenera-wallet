import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { test, expect, importPublicWallet, RECIPIENT, PUBLIC_ADDRESS, tokens, NATIVE_TOKEN, backendOrigin } from './fixtures'

const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { decodeTx } = require('@goldenera/cryptoj') as { decodeTx: (hex: string) => { amount: bigint; nonce: bigint } }

test.skip(!!backendOrigin, 'These controlled race fixtures complement the separate real-backend suite')

async function review(page: Page, token = 'GoldenEra Test', amount = '1') {
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: new RegExp(token) }).click()
  await page.getByPlaceholder('0x...').fill(RECIPIENT)
  await page.locator('input[inputmode="decimal"]').fill(amount)
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Transaction' })).toBeVisible()
}

async function holdNonce(page: Page) {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let count = 0
  await page.route('**/api/core/v1/wallet/next-nonce**', async route => {
    const nonce = ++count
    await gate
    await route.fulfill({ status: 200, contentType: 'application/json', body: String(nonce) }).catch(() => {})
  })
  return { release, count: () => count }
}

test('F1: two confirmations while nonce is pending produce one payment', async ({ page, api }) => {
  await importPublicWallet(page)
  await review(page)
  const nonce = await holdNonce(page)
  await page.getByRole('button', { name: 'Confirm', exact: true }).evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect.poll(nonce.count).toBe(1)
  expect(api.submitted).toHaveLength(0)
  nonce.release()
  await expect.poll(() => api.submitted.length).toBe(1)
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  expect(api.submitted).toHaveLength(1)
})

test('F1: cancel during preflight invalidates the review before signing and POST', async ({ page, api }) => {
  await importPublicWallet(page)
  await review(page)
  const nonce = await holdNonce(page)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(nonce.count).toBe(1)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Transaction' })).not.toBeVisible()
  nonce.release()
  await page.waitForTimeout(150)
  expect(api.submitted).toHaveLength(0)
})

test('F1: auto-lock while nonce is pending prevents a late signed submission', async ({ page, api }) => {
  await page.clock.install()
  await importPublicWallet(page)
  await review(page)
  const nonce = await holdNonce(page)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(nonce.count).toBe(1)
  await page.clock.fastForward(121000)
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  nonce.release()
  await page.waitForTimeout(150)
  expect(api.submitted).toHaveLength(0)
})

test('F6: zero-decimal token balances stay whole in the list and detail', async ({ page }) => {
  await page.route('**/api/core/v1/wallet/balances**', async route => {
    const addresses = new URL(route.request().url()).searchParams.getAll('tokenAddresses')
    const balances = tokens.filter(token => !addresses.length || addresses.includes(token.address)).map(token => ({ address: PUBLIC_ADDRESS, tokenAddress: token.address, balance: token.numberOfDecimals === 0 ? '100' : '100000000000' }))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(balances) })
  })
  await importPublicWallet(page)
  const whole = page.getByRole('button').filter({ hasText: 'Whole Units Test' })
  await expect(whole.getByText('100', { exact: true })).toBeVisible()
  await whole.click()
  await expect(page.getByText('100', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('0.00000100', { exact: true })).not.toBeVisible()
})

test('F7: an 18-decimal amount below one 8-decimal unit is accepted and signed exactly', async ({ page, api }) => {
  await importPublicWallet(page)
  await review(page, 'High Precision Test', '0.000000001')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => api.submitted.length).toBe(1)
  expect(decodeTx(api.submitted[0].hexData).amount).toBe(1000000000n)
})

test('F8: switching the history filter from page three requests page one', async ({ page }) => {
  const requests: Array<{ page: number; filter: string | null }> = []
  await page.route('**/api/core/v1/wallet/transfers**', async route => {
    const params = new URL(route.request().url()).searchParams
    const pageNumber = Number(params.get('pageNumber') ?? 0)
    const filter = params.get('transferType')
    const totalPages = filter ? 1 : 3
    requests.push({ page: pageNumber, filter })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      content: pageNumber < totalPages ? [{ status: 'CONFIRMED', txHash: `0x${String(pageNumber + 1).repeat(64)}`, transferType: filter ?? 'TRANSFER', from: RECIPIENT, to: PUBLIC_ADDRESS, tokenAddress: NATIVE_TOKEN, amount: '100000000', fee: '2500', timestamp: '2026-08-31T12:00:00Z' }] : [],
      pageNumber, pageSize: 15, totalPages, totalElements: totalPages, pendingCount: 0,
    }) })
  })
  await importPublicWallet(page)
  await page.getByRole('button').filter({ hasText: 'GoldenEra Test' }).click()
  await page.getByLabel('Go to next page').click()
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  await page.getByLabel('Go to next page').click()
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Filter transfers', exact: true }).click()
  await page.getByRole('button', { name: 'Burn', exact: true }).click()
  await expect.poll(() => requests.filter(request => request.filter === 'BURN').length).toBeGreaterThan(0)
  expect(requests.filter(request => request.filter === 'BURN').every(request => request.page === 0)).toBe(true)
  await expect(page.getByText('No transactions yet', { exact: true })).not.toBeVisible()
})

test('F7: excess precision remains visible and is rejected instead of silently rounded', async ({ page, api }) => {
  await importPublicWallet(page)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: /Whole Units Test/ }).click()
  await page.getByPlaceholder('0x...').fill(RECIPIENT)
  const amount = page.locator('input[inputmode="decimal"]')
  await amount.fill('1.1')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(amount).toHaveValue('1.1')
  await expect(page.getByText('Amount supports at most 0 decimal places', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review Transaction' })).not.toBeVisible()
  expect(api.submitted).toHaveLength(0)
})
