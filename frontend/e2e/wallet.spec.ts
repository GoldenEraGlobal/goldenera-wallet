import { createRequire } from 'node:module'
import { test, expect, importPublicWallet, openSettings, TEST_PASSWORD, PUBLIC_ADDRESS, RECIPIENT, backendOrigin } from './fixtures'

const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { decodeTx } = require('@goldenera/cryptoj') as { decodeTx: (hex: string) => { amount: bigint; nonce: bigint; recipient: string; sender: string } }

test('centers the create/import wallet card in the full welcome viewport', async ({ page }) => {
  await page.goto('/')
  const card = page.getByText('GoldenEra Wallet', { exact: true }).locator('xpath=ancestor::*[@data-slot="card"]')
  await expect(card).toBeVisible()

  const position = await card.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return {
      cardCenterX: bounds.left + bounds.width / 2,
      cardCenterY: bounds.top + bounds.height / 2,
      viewportCenterX: window.innerWidth / 2,
      viewportCenterY: window.innerHeight / 2,
    }
  })
  expect(Math.abs(position.cardCenterX - position.viewportCenterX)).toBeLessThanOrEqual(1)
  expect(Math.abs(position.cardCenterY - position.viewportCenterY)).toBeLessThanOrEqual(1)
})

test('creates a wallet, requires backup, and persists it across a page reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Create New Wallet', exact: true }).click()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByPlaceholder('Confirm your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Set Password', exact: true }).click()
  await expect(page.getByText('Backup Recovery Phrase', { exact: true })).toBeVisible()
  const continueButton = page.getByRole('button', { name: 'Continue to Wallet', exact: true })
  await expect(continueButton).toBeDisabled()
  await page.getByRole('checkbox').check()
  await continueButton.click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

test('imports, locks, rejects a wrong password and unlocks again', async ({ page }) => {
  await importPublicWallet(page)
  await openSettings(page)
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(`${TEST_PASSWORD}-incorrect`)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Invalid password', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

test('navigates dashboard → token → history → back without losing the session', async ({ page, api }) => {
  await importPublicWallet(page)
  await page.getByRole('button').filter({ hasText: 'GoldenEra Test' }).click()
  await expect(page.getByText('Transfer History', { exact: true })).toBeVisible()
  await expect(page.getByText(backendOrigin ? 'No transactions yet' : 'received', { exact: true })).toBeVisible()
  expect(api.requested.some(path => path.endsWith('/wallet/transfers'))).toBe(true)
  await page.goBack()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

test('reviews and signs a payment exactly once against a local mock API', async ({ page, api }) => {
  await importPublicWallet(page)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: /GoldenEra Test/ }).click()
  await page.getByPlaceholder('0x...').fill(RECIPIENT)
  await page.locator('input[inputmode="decimal"]').fill('1')
  await page.getByRole('button', { name: 'Submit', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Transaction' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => api.submitted.length).toBe(1)
  const tx = decodeTx(api.submitted[0].hexData as `0x${string}`)
  expect(tx.amount).toBe(100000000n)
  expect(tx.nonce).toBe(1n)
  expect(tx.recipient.toLowerCase()).toBe(RECIPIENT)
  expect(tx.sender.toLowerCase()).toBe(PUBLIC_ADDRESS.toLowerCase())
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})
