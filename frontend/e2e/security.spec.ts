import type { BrowserContext, Page } from '@playwright/test'
import { webcrypto } from 'node:crypto'
import { test, expect, importPublicWallet, openSettings, TEST_PASSWORD, PUBLIC_MNEMONIC } from './fixtures'
import { installPrfAuthenticator } from './webauthn-fixture'
import golden from '../tests/fixtures/crypto-v0.2.0.json' with { type: 'json' }

const vaultKey = 'cap_sec_ge_secure:mnemonic'
const prfKey = 'CapacitorStorage.ge_basic:biometric_prf_v2'
const legacyIdKey = 'CapacitorStorage.ge_basic:biometric_credential_id'
const legacyPasswordKey = 'CapacitorStorage.ge_basic:biometric_encrypted_password'

test('recovery phrase input disables browser text-assistance features', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  const phrase = page.getByPlaceholder('Enter your recovery phrase...')
  await expect(phrase).toHaveAttribute('autocomplete', 'off')
  await expect(phrase).toHaveAttribute('autocapitalize', 'none')
  await expect(phrase).toHaveAttribute('autocorrect', 'off')
  await expect(phrase).toHaveAttribute('spellcheck', 'false')
})

test('browser Back and Forward never cross locked and authenticated realms', async ({ page }) => {
  await importPublicWallet(page)
  await openSettings(page)
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()

  await page.goBack()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await expect(page.getByText('Security', { exact: true })).toHaveCount(0)
  await page.goForward()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()

  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()

  await page.goBack()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  await expect(page.getByText('Welcome Back', { exact: true })).toHaveCount(0)
  await page.goForward()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

test('locking one tab invalidates another unlocked tab', async ({ page, context }) => {
  await importPublicWallet(page)
  const second = await context.newPage()
  await second.goto('/')
  await second.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await second.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(second.getByText('Your Tokens', { exact: true })).toBeVisible()
  await openSettings(page)
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await expect(second.getByText('Welcome Back', { exact: true })).toBeVisible()
  await expect(second.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
})

test('suspended time cannot be reset into a fresh unlocked session on resume', async ({ page }) => {
  await importPublicWallet(page)
  const now = Date.now()
  await page.clock.install({ time: now })
  // Move wall time without delivering expired timer callbacks first.
  await page.clock.setSystemTime(now + 3 * 60 * 1000)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
})

test('storage enumeration failure never opens onboarding over a legacy vault', async ({ page }) => {
  await page.addInitScript(({ encrypted, vaultKey }) => {
    localStorage.setItem(vaultKey, btoa(encrypted))
    const keys = Object.keys
    Object.keys = value => { if (value === localStorage) throw new Error('Synthetic vault unavailable'); return keys(value) }
  }, { encrypted: golden.vaults[0].encrypted, vaultKey })
  await page.goto('/')
  await expect(page.getByText('Wallet storage unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create New Wallet', exact: true })).toHaveCount(0)
  expect(await page.evaluate(key => atob(localStorage.getItem(key)!), vaultKey)).toBe(golden.vaults[0].encrypted)
})

test.describe('wallet deletion storage failure', () => {
  test.use({ serviceWorkers: 'allow' })

  test('failed physical deletion keeps a retryable error and does not report a removed wallet', async ({ page }) => {
  await importPublicWallet(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.evaluate(key => {
    const remove = Storage.prototype.removeItem
    Storage.prototype.removeItem = function (item) {
      if (item === key) throw new Error('Synthetic deletion failure')
      return remove.call(this, item)
    }
  }, vaultKey)
  await openSettings(page)
  await page.getByRole('button', { name: /Delete Wallet Remove wallet/ }).click()
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Continue with Deletion', exact: true }).click()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Delete Wallet Permanently', exact: true }).click()
  await expect(page.getByText('Wallet storage unavailable', { exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), vaultKey)).not.toBeNull()
  await expect(page.getByRole('button', { name: 'Create New Wallet', exact: true })).toHaveCount(0)
  })
})

test('PRF enrollment and unlock work through the browser API fixture', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock navigator.credentials/PRF output; not physical biometrics.' })
  await installPrfAuthenticator(context)
  await importPublicWallet(page)
  await page.waitForFunction(key => localStorage.getItem(key) !== null, prfKey)
  expect(await page.evaluate(() => sessionStorage.getItem('public-webauthn-user-name'))).toBe('GoldenEra Wallet')
  expect(await page.evaluate(() => sessionStorage.getItem('public-webauthn-user-display-name'))).toBe('GoldenEra Wallet')
  await openSettings(page)
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyPasswordKey)).toBeNull()
})

test('an authenticator without PRF preserves password-only import and unlock', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock authenticator explicitly does not support PRF.' })
  await installPrfAuthenticator(context, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await page.getByPlaceholder('Enter your recovery phrase...').fill(PUBLIC_MNEMONIC)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByPlaceholder('Confirm your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await expect(page.getByText(/Secure biometrics could not be enabled or verified/)).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use Biometrics', exact: true })).toHaveCount(0)
  expect(await page.evaluate(key => localStorage.getItem(key), prfKey)).toBeNull()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

async function installLegacyWallet(page: Page, context: BrowserContext, supported = true) {
  await installPrfAuthenticator(context, supported)
  const id = new Uint8Array(32).fill(7)
  const material = await webcrypto.subtle.importKey('raw', id, 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: id.slice(0, 16) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = new Uint8Array(12).fill(9)
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(TEST_PASSWORD))
  await page.addInitScript(({ legacy, id, vault, vaultKey, legacyIdKey, legacyPasswordKey }) => {
    if (localStorage.getItem('public-fixture-installed')) return
    localStorage.setItem(vaultKey, btoa(vault))
    localStorage.setItem('CapacitorStorage.ge_basic:backedup', 'true')
    localStorage.setItem(legacyIdKey, id)
    localStorage.setItem(legacyPasswordKey, JSON.stringify(legacy))
    localStorage.setItem('CapacitorStorage.ge_basic:biometric_enabled', 'true')
    localStorage.setItem('public-fixture-installed', 'true')
  }, { legacy: { iv: Buffer.from(iv).toString('hex'), data: Buffer.from(encrypted).toString('hex') }, id: Buffer.from(id).toString('hex'), vault: golden.vaults[0].encrypted, vaultKey, legacyIdKey, legacyPasswordKey })
}

test('legacy biometric recovery requires verification and persists a new password for the same seed', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock old credential UV response; genuine wrapper derivation/encryption and wallet migration.' })
  await installLegacyWallet(page, context)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Use Biometrics', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Recover legacy biometric access', exact: true }).click()
  const newPassword = 'PUBLIC-Recovered-Password-456!'
  await page.getByPlaceholder('New wallet password', { exact: true }).fill(newPassword)
  await page.getByPlaceholder('Confirm new wallet password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Save new password and upgrade biometrics', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), prfKey)).not.toBeNull()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyPasswordKey)).toBeNull()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyIdKey)).toBeNull()
  await page.reload()
  await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  await openSettings(page)
  await page.getByRole('button', { name: /View Recovery Phrase Backup/ }).click()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  const copyButton = page.getByRole('button', { name: 'Copy', exact: true })
  await expect(copyButton).toBeDisabled()
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(page.getByText(PUBLIC_MNEMONIC.split(' ').at(-1)!, { exact: true })).toHaveCount(1)
  await expect(copyButton).toBeEnabled()
})

test('password unlock upgrades existing legacy biometric intent to PRF', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock old credential plus PRF enrollment; verifies password-authenticated upgrade orchestration.' })
  await installLegacyWallet(page, context)
  await page.goto('/')
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyPasswordKey)).toBeNull()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyIdKey)).toBeNull()
  expect(await page.evaluate(key => localStorage.getItem(key), prfKey)).not.toBeNull()

  await openSettings(page)
  await expect(page.getByText('Enabled', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /Lock Wallet/ }).click()
  await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})

test('password unlock continues with a visible warning when legacy biometric PRF is unsupported', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock authenticator without PRF; verifies single-submit password fallback and visible warning.' })
  await installLegacyWallet(page, context, false)
  await page.goto('/')
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  await expect(page.getByText(/Older biometric access was retired safely, but secure biometric enrollment did not finish because it was cancelled or unavailable/)).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), legacyPasswordKey)).toBeNull()
  expect(await page.evaluate(key => localStorage.getItem(key), prfKey)).toBeNull()
})

test('post-commit legacy recovery enrollment failure clears sensitive migration state', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock legacy UV with unsupported PRF; verifies post-password-commit recovery UI is not retryable with a stale ticket.' })
  await installLegacyWallet(page, context, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'Recover legacy biometric access', exact: true }).click()
  const newPassword = 'PUBLIC-Recovered-No-PRF-456!'
  await page.getByPlaceholder('New wallet password', { exact: true }).fill(newPassword)
  await page.getByPlaceholder('Confirm new wallet password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Save new password and upgrade biometrics', exact: true }).click()

  await expect(page.getByText(/Your new password is saved and older biometric access was retired\. Secure biometric enrollment was cancelled or unavailable/)).toBeVisible()
  await expect(page.getByPlaceholder('New wallet password', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save new password and upgrade biometrics', exact: true })).toHaveCount(0)
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
})


test('legacy recovery secrets expire on resume and require fresh user verification', async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: 'authenticator', description: 'Mock UV/PRF API; verifies actual recovery UI expiry and repeated verification request.' })
  await installLegacyWallet(page, context)
  await page.goto('/')
  await page.evaluate(() => {
    const get = navigator.credentials.get.bind(navigator.credentials)
    navigator.credentials.get = options => {
      sessionStorage.setItem('public-recovery-verifications', String(Number(sessionStorage.getItem('public-recovery-verifications')) + 1))
      return get(options)
    }
  })
  await page.getByRole('button', { name: 'Recover legacy biometric access', exact: true }).click()
  await page.getByPlaceholder('New wallet password', { exact: true }).fill('PUBLIC-Uncommitted-Password-123!')
  const now = Date.now()
  await page.clock.install({ time: now })
  await page.clock.setSystemTime(now + 3 * 60 * 1000)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByPlaceholder('New wallet password', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Legacy verification expired. Verify your authenticator again to continue.', { exact: true })).toBeVisible()
  expect(await page.evaluate(key => atob(localStorage.getItem(key)!), vaultKey)).toBe(golden.vaults[0].encrypted)
  expect(await page.evaluate(key => localStorage.getItem(key), legacyPasswordKey)).not.toBeNull()
  await page.getByRole('button', { name: 'Recover legacy biometric access', exact: true }).click()
  await expect(page.getByPlaceholder('New wallet password', { exact: true })).toHaveValue('')
  expect(await page.evaluate(() => Number(sessionStorage.getItem('public-recovery-verifications')))).toBe(2)
})


test.describe('wallet deletion session fencing', () => {
  test.use({ serviceWorkers: 'allow' })

  test('delete and import in another tab cannot leave an old signing session active', async ({ page, context }) => {
  await importPublicWallet(page)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  const second = await context.newPage()
  await second.goto('/')
  await second.evaluate(async () => { await navigator.serviceWorker.ready })
  await second.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await second.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await second.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(second.getByText('Your Tokens', { exact: true })).toBeVisible()
  await openSettings(second)
  await second.getByRole('button', { name: /Delete Wallet Remove wallet/ }).click()
  await second.getByRole('checkbox').nth(0).check()
  await second.getByRole('checkbox').nth(1).check()
  await second.getByRole('button', { name: 'Continue with Deletion', exact: true }).click()
  await second.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await second.getByRole('button', { name: 'Delete Wallet Permanently', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create New Wallet', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
  await second.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await second.getByPlaceholder('Enter your recovery phrase...').fill(golden.seeds[1].mnemonic)
  await second.getByRole('button', { name: 'Continue', exact: true }).click()
  await second.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await second.getByPlaceholder('Confirm your password', { exact: true }).fill(TEST_PASSWORD)
  await second.getByRole('button', { name: 'Import Wallet', exact: true }).click()
  await expect(second.getByText('Your Tokens', { exact: true })).toBeVisible()
  await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
  await page.getByPlaceholder('Enter your password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  const replacementAddress = golden.seeds[1].address
  await expect(page.getByText(`${replacementAddress.slice(0, 8)}...${replacementAddress.slice(-6)}`, { exact: true })).toBeVisible()
  })
})
