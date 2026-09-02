import { test, expect, importPublicWallet, PUBLIC_ADDRESS } from './fixtures'

test('governance stays hidden when the wallet address is not an authority', async ({ page }) => {
  await importPublicWallet(page)

  await expect(page.getByRole('button', { name: 'Governance', exact: true })).toHaveCount(0)
})

test('a confirmed authority can open the governance section', async ({ page }) => {
  await page.route('**/api/core/v1/governance/authority-status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ address: PUBLIC_ADDRESS, authority: true }),
  }))
  await importPublicWallet(page)

  await page.getByRole('button', { name: 'Governance', exact: true }).click()
  await expect(page.getByText('No BIPs match this filter.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create BIP', exact: true })).toBeVisible()
})
