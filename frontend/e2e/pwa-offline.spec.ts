import { test, expect, importPublicWallet, openSettings, TEST_PASSWORD, backendOrigin } from './fixtures'

test.use({ serviceWorkers: 'allow' })

test('installed production service worker reloads and unlocks the local vault offline', async ({ page, context }) => {
  test.skip(process.env.WALLET_E2E_PRODUCTION !== '1', 'A production service-worker build is required')
  test.skip(!!backendOrigin, 'Offline behavior is tested independently of the full-stack server fixture')
  await importPublicWallet(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await openSettings(page)
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()

  // Real network failure, not a successful mock response, during local unlock.
  await page.route('**/api/**', route => route.abort('internetdisconnected'))
  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
    await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
