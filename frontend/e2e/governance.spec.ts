import type { Page } from '@playwright/test'
import {
  test,
  expect,
  importPublicWallet,
  PUBLIC_ADDRESS,
  RECIPIENT,
} from './fixtures'

async function confirmAuthority(page: Page) {
  await page.route('**/api/core/v1/governance/authority-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ address: PUBLIC_ADDRESS, authority: true }),
  }))
}

async function openGovernance(page: Page) {
  await confirmAuthority(page)
  await importPublicWallet(page)
  await page.getByRole('button', { name: 'Governance', exact: true }).click()
}

test('governance stays hidden when the wallet address is not an authority', async ({ page }) => {
  await importPublicWallet(page)

  await expect(page.getByRole('button', { name: 'Governance', exact: true })).toHaveCount(0)
})

test('a confirmed authority sees equal-sized controls and automatic/manual BIP refresh', async ({ page, api }) => {
  await openGovernance(page)

  const createButton = page.getByRole('button', { name: 'Create BIP', exact: true })
  const statusSelector = page.getByRole('combobox')
  await expect(page.getByText('Add authority', { exact: true })).toBeVisible()
  const createBounds = await createButton.boundingBox()
  const selectorBounds = await statusSelector.boundingBox()
  expect(createBounds).not.toBeNull()
  expect(selectorBounds).not.toBeNull()
  expect(Math.abs(createBounds!.height - selectorBounds!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(createBounds!.width - selectorBounds!.width)).toBeLessThanOrEqual(1)

  const bipRequestCount = () => api.requested.filter(path => path.endsWith('/governance/bips')).length
  await expect.poll(bipRequestCount).toBeGreaterThanOrEqual(1)
  const initialRequests = bipRequestCount()
  await page.waitForTimeout(5_200)
  await expect.poll(bipRequestCount).toBeGreaterThan(initialRequests)
  const afterAutomaticRefresh = bipRequestCount()
  await page.getByRole('button', { name: 'Refresh BIPs', exact: true }).click()
  await expect.poll(bipRequestCount).toBeGreaterThan(afterAutomaticRefresh)
})

test('BIP detail lists authority votes, refreshes, and hides vote actions after submit', async ({ page, api }) => {
  await openGovernance(page)
  await page.getByText('Add authority', { exact: true }).click()

  await expect(page.getByText(RECIPIENT, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('0x5555555555555555555555555555555555555555', { exact: true })).toBeVisible()
  const detailRequestCount = () => api.requested.filter(path => path.endsWith('/governance/bip')).length
  await expect.poll(detailRequestCount).toBeGreaterThanOrEqual(1)
  const beforeRefresh = detailRequestCount()
  await page.getByRole('button', { name: 'Refresh BIP', exact: true }).click()
  await expect.poll(detailRequestCount).toBeGreaterThan(beforeRefresh)

  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Review vote transaction', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText(/Vote submitted:/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Disapprove', exact: true })).toHaveCount(0)
  expect(api.submitted).toHaveLength(1)
})

test('BIP creation uses full-height entity selectors and formatted percentages', async ({ page }) => {
  await openGovernance(page)
  await page.getByRole('button', { name: 'Create BIP', exact: true }).click()

  const bipType = page.getByRole('combobox').first()
  await bipType.click()
  await page.getByRole('option', { name: 'Mint tokens', exact: true }).click()
  const tokenSelector = page.getByRole('combobox').nth(1)
  await tokenSelector.click()
  await page.getByRole('option', { name: /GoldenEra Test/ }).click()
  const recipientInput = page.getByPlaceholder('0x…')
  const amountInput = page.locator('input[inputmode="decimal"]')
  const selectorBounds = await tokenSelector.boundingBox()
  const inputBounds = await recipientInput.boundingBox()
  expect(selectorBounds).not.toBeNull()
  expect(inputBounds).not.toBeNull()
  expect(Math.abs(selectorBounds!.height - inputBounds!.height)).toBeLessThanOrEqual(1)
  await expect(amountInput).toHaveAttribute('placeholder', '0.00000000')
  await amountInput.fill('1234.5678')
  await expect(amountInput).toHaveValue('1,234.5678')

  await bipType.click()
  await page.getByRole('option', { name: 'Create token', exact: true }).click()
  const decimalsInput = page.getByText('Decimals', { exact: true }).locator('..').locator('input')
  const maximumSupply = page.getByText(/Maximum supply/).locator('..').locator('input')
  await expect(maximumSupply).toBeDisabled()
  await decimalsInput.fill('2')
  await expect(maximumSupply).toBeEnabled()
  await maximumSupply.fill('1000000.25')
  await expect(maximumSupply).toHaveValue('1,000,000.25')

  await bipType.click()
  await page.getByRole('option', { name: 'Update network parameters', exact: true }).click()
  const blockReward = page.getByText(/Block reward/).locator('..').locator('input').first()
  const baseFee = page.getByText(/Minimum transaction base fee/).locator('..').locator('input')
  const byteFee = page.getByText(/Minimum transaction byte fee/).locator('..').locator('input')
  for (const input of [blockReward, baseFee, byteFee]) {
    await expect(input).toHaveAttribute('placeholder', '0.00000000')
  }
  await blockReward.fill('2500.00000001')
  await expect(blockReward).toHaveValue('2,500.00000001')

  await bipType.click()
  await page.getByRole('option', { name: 'Remove authority', exact: true }).click()
  await page.getByRole('combobox').nth(1).click()
  await expect(page.getByRole('option', { name: /0x222222…222222/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await bipType.click()
  await page.getByRole('option', { name: 'Remove address alias', exact: true }).click()
  await page.getByRole('combobox').nth(1).click()
  await expect(page.getByRole('option', { name: /treasury/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await bipType.click()
  await page.getByRole('option', { name: 'Update token', exact: true }).click()
  await page.getByRole('combobox').nth(1).click()
  await expect(page.getByRole('option', { name: /GoldenEra Test/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await bipType.click()
  await page.getByRole('option', { name: 'Update validator mining policy', exact: true }).click()
  await page.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: /0x222222…222222/ }).click()
  await expect(page.getByPlaceholder('e.g. 25.00 %')).toHaveValue('25 %')

  await bipType.click()
  await page.getByRole('option', { name: 'Add validator', exact: true }).click()
  const percentage = page.getByPlaceholder('e.g. 25.00 %')
  await percentage.fill('25.5')
  await expect(percentage).toHaveValue('25.5 %')
})
