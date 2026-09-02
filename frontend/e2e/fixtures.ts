import { test as base, expect, type Page } from '@playwright/test'
import golden from '../tests/fixtures/crypto-v0.2.0.json' with { type: 'json' }

export const PUBLIC_MNEMONIC = golden.seeds[0].mnemonic
export const PUBLIC_ADDRESS = golden.seeds[0].address
export const TEST_PASSWORD = golden.vaults[0].password
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
export const backendOrigin = process.env.WALLET_E2E_BACKEND_URL
if (backendOrigin && !['127.0.0.1', 'localhost'].includes(new URL(backendOrigin).hostname)) {
  throw new Error('E2E backend must be an explicitly configured loopback test server')
}
export const RECIPIENT = '0x2222222222222222222222222222222222222222'
export const tokens = [
  { address: NATIVE_TOKEN, name: 'GoldenEra Test', smallestUnitName: 'GE', numberOfDecimals: 8, userBurnable: true },
  { address: '0x3333333333333333333333333333333333333333', name: 'Whole Units Test', smallestUnitName: 'WHOLE', numberOfDecimals: 0, userBurnable: true },
  { address: '0x4444444444444444444444444444444444444444', name: 'High Precision Test', smallestUnitName: 'HIGH', numberOfDecimals: 18, userBurnable: true },
]
export const GOVERNANCE_BIP_HASH = `0x${'aa'.repeat(32)}`
export const governanceBip = {
  bipHash: GOVERNANCE_BIP_HASH,
  status: 'PENDING',
  actionExecuted: false,
  type: 'AUTHORITY_ADD',
  numberOfRequiredVotes: '2',
  approvers: [RECIPIENT],
  disapprovers: ['0x5555555555555555555555555555555555555555'],
  executedAtTimestamp: null,
  expirationTimestamp: '2026-09-10T12:00:00Z',
  createdAtBlockHeight: '100',
  createdAtTimestamp: '2026-09-01T12:00:00Z',
  updatedAtBlockHeight: '101',
  updatedAtTimestamp: '2026-09-01T12:01:00Z',
  updatedByTxHash: GOVERNANCE_BIP_HASH,
  metadata: {
    txVersion: 'V1',
    derivedTokenAddress: null,
    txPayload: { payloadType: 'BIP_AUTHORITY_ADD', payloadVersion: 'V1', authorityAddress: RECIPIENT },
  },
}

export interface MockApi {
  submitted: Array<{ hexData: string }>
  requested: string[]
  unexpected: string[]
}

export const test = base.extend<{ api: MockApi }>({
  api: [async ({ context }, use) => {
    const api: MockApi = { submitted: [], requested: [], unexpected: [] }
    // Every test gets an isolated browser profile; block outbound origins so no
    // secret, registration or signed transfer can reach any live service.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
        await route.abort('blockedbyclient')
        return
      }
      if (!url.pathname.startsWith('/api/')) {
        await route.continue()
        return
      }
      api.requested.push(url.pathname)
      if (url.pathname.endsWith('/device/register')) {
        api.unexpected.push(url.pathname)
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'The retired PWA must not attempt device registration' }),
        })
        return
      }
      if (backendOrigin) {
        if (url.pathname.endsWith('/wallet/submit-tx')) api.submitted.push(route.request().postDataJSON() as { hexData: string })
        const response = await route.fetch({ url: new URL(url.pathname + url.search, backendOrigin).href })
        await route.fulfill({ response })
        return
      }
      const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname.endsWith('/governance/authority-status')) {
        return reply({ address: url.searchParams.get('address'), authority: false })
      }
      if (url.pathname.endsWith('/governance/bips')) {
        const pageNumber = Number(url.searchParams.get('pageNumber') ?? 0)
        const pageSize = Number(url.searchParams.get('pageSize') ?? 20)
        return reply({ content: [governanceBip], pageNumber, pageSize, totalElements: '1', totalPages: 1, first: true, last: true })
      }
      if (url.pathname.endsWith('/governance/bip')) return reply(governanceBip)
      if (url.pathname.endsWith('/governance/options')) {
        return reply({
          authorities: [PUBLIC_ADDRESS, RECIPIENT],
          addressAliases: [{ alias: 'treasury', address: RECIPIENT }],
          validators: [{ address: RECIPIENT, miningLimitMode: 'LIMITED', maxMiningShareBps: '2500' }],
          addressAliasesTruncated: false,
        })
      }
      if (url.pathname.endsWith('/wallet/tokens')) return reply(tokens)
      if (url.pathname.endsWith('/wallet/token')) {
        return reply(tokens.find(token => token.address === url.searchParams.get('address')) ?? tokens[0])
      }
      if (url.pathname.endsWith('/wallet/balances')) {
        return reply(tokens.map((token, index) => {
          const holdings = index === 0 ? '100000000000' : index === 1 ? '100' : '100000000000000000000'
          return { address: PUBLIC_ADDRESS, tokenAddress: token.address, balance: holdings, totalBalance: holdings, pending: '0' }
        }))
      }
      if (url.pathname.endsWith('/wallet/next-nonce')) return reply(String(api.submitted.length + 1))
      if (url.pathname.endsWith('/wallet/mempool-recommended-fees')) {
        const fee = { baseFee: '1000', feePerByte: '10', totalForAverageTx: '2500' }
        return reply({ fast: fee, standard: fee, slow: fee })
      }
      if (url.pathname.endsWith('/wallet/transfers')) {
        return reply({ content: [{ status: 'CONFIRMED', txHash: `0x${'11'.repeat(32)}`, transferType: 'TRANSFER', from: RECIPIENT, to: PUBLIC_ADDRESS, tokenAddress: NATIVE_TOKEN, amount: '100000000', fee: '2500', nonce: '1', timestamp: '2026-08-31T12:00:00Z', confirmations: '10' }], pageNumber: 0, pageSize: 15, totalPages: 1, totalElements: '1', pendingCount: '0', confirmedCount: '1', first: true, last: true })
      }
      if (url.pathname.endsWith('/wallet/submit-tx')) {
        api.submitted.push(route.request().postDataJSON() as { hexData: string })
        return reply({ status: 'SUCCESS' })
      }
      api.unexpected.push(url.pathname)
      return reply({ error: `Unexpected local mock endpoint: ${url.pathname}` }, 500)
    })
    await use(api)
    expect(api.unexpected, 'Every API request must hit an explicit local fixture').toEqual([])
  }, { auto: true }],
})

export async function importPublicWallet(
  page: Page,
  initialURL = '/',
  enableBiometric = true,
) {
  await page.goto(initialURL)
  await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await page.getByPlaceholder('Enter your recovery phrase...').fill(PUBLIC_MNEMONIC)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByPlaceholder('Confirm your password', { exact: true }).fill(TEST_PASSWORD)
  if (!enableBiometric) {
    const biometricToggle = page.getByRole('switch', { name: 'Enable Biometric' })
    if (await biometricToggle.isChecked()) await biometricToggle.click()
  }
  await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
}

export async function openSettings(page: Page) {
  // Icon buttons presently have no accessible names; locate the Settings icon
  // explicitly until accessibility labels are added by the UI owner.
  await page.locator('button').filter({ has: page.locator('svg.lucide-settings') }).click()
  await expect(page.getByText('Security', { exact: true })).toBeVisible()
}

export { expect }
