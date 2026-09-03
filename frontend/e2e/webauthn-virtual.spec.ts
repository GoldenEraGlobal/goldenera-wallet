import { test, expect, importPublicWallet, openSettings, TEST_PASSWORD } from './fixtures'

// WebAuthn RP IDs use domain hosts; use localhost rather than the default IP origin.
test.use({ baseURL: 'http://localhost:4173' })

const wrapperKey = 'CapacitorStorage.ge_basic:biometric_prf_v2'

test('Chromium virtual authenticator executes real WebAuthn PRF enrollment and unlock', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Chromium CDP virtual CTAP2 authenticator; genuine navigator.credentials/PRF pipeline, no injected JS credentials, no physical biometric claim.' })
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true, hasPrf: true,
  } })
  let added = 0
  let asserted = 0
  cdp.on('WebAuthn.credentialAdded', () => { added++ })
  cdp.on('WebAuthn.credentialAsserted', () => { asserted++ })
  try {
    await importPublicWallet(page)
    await expect.poll(async () => page.evaluate(key => localStorage.getItem(key) !== null, wrapperKey)).toBe(true)
    expect(added).toBe(1)
    const beforeUnlock = asserted
    await openSettings(page)
    await page.getByRole('button', { name: /Lock Wallet/ }).click()
    await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
    await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
    expect(asserted).toBeGreaterThan(beforeUnlock)

    // An authenticator that does not report successful UV cannot unlock.
    await openSettings(page)
    await page.getByRole('button', { name: /Lock Wallet/ }).click()
    await cdp.send('WebAuthn.setResponseOverrideBits', { authenticatorId, isBadUV: true })
    await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
    await expect(page.getByText('Biometric authentication failed. Use your password.', { exact: true })).toBeVisible()
    await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
    await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    await cdp.send('WebAuthn.disable')
    await cdp.detach()
  }
})

test('Chromium authenticator without PRF keeps the password-only fallback', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Chromium CDP virtual authenticator with PRF disabled; browser capability fallback, not physical hardware.' })
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: false,
  } })
  try {
    await importPublicWallet(page, '/', false)
    await openSettings(page)
    await page.getByRole('button', { name: /Lock Wallet/ }).click()
    expect(await page.evaluate(key => localStorage.getItem(key), wrapperKey)).toBeNull()
    await expect(page.getByRole('button', { name: 'Use Biometrics', exact: true })).toHaveCount(0)
    await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
    await cdp.send('WebAuthn.disable')
    await cdp.detach()
  }
})
