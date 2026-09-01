import { createServer } from 'node:http'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CDPSession } from '@playwright/test'
import { test, expect, importPublicWallet, TEST_PASSWORD, PUBLIC_ADDRESS } from './fixtures'

test.use({ serviceWorkers: 'allow' })

type UpgradeCase = { name: string; previousRoot: string; authentication: 'password' | 'prf' | 'legacy'; fixedVault?: boolean }
const cases: UpgradeCase[] = [{ name: 'previous release, password', previousRoot: process.env.WALLET_E2E_BASELINE_DIST!, authentication: 'password' }]
if (process.env.WALLET_E2E_PREVIOUS_FIXED_DIST) {
  cases.push(
    { name: 'original legacy biometrics, explicit migration', previousRoot: process.env.WALLET_E2E_BASELINE_DIST!, authentication: 'legacy' },
    { name: 'previous fixed v2 vault, password', previousRoot: process.env.WALLET_E2E_PREVIOUS_FIXED_DIST, authentication: 'password', fixedVault: true },
    { name: 'previous fixed v2 vault and genuine PRF credential', previousRoot: process.env.WALLET_E2E_PREVIOUS_FIXED_DIST, authentication: 'prf', fixedVault: true },
  )
}

for (const scenario of cases) test(`forward upgrade preserves access: ${scenario.name}`, async ({ page, context }, testInfo) => {
  const previousRoot = resolve(scenario.previousRoot)
  const currentRoot = fileURLToPath(new URL('../apps/web/dist', import.meta.url))
  const previousWorker = await readFile(resolve(previousRoot, 'sw.js'))
  const currentWorker = await readFile(resolve(currentRoot, 'sw.js'))
  const changed = createHash('sha256').update(previousWorker).digest('hex') !== createHash('sha256').update(currentWorker).digest('hex')
  const currentIndex = await readFile(resolve(currentRoot, 'index.html'), 'utf8')
  const currentEntry = currentIndex.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1]
  expect(currentEntry).toBeTruthy()
  let activeRoot = previousRoot
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname)
      let filename = resolve(activeRoot, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (filename !== activeRoot && !filename.startsWith(activeRoot + sep)) { response.writeHead(403).end(); return }
      try { if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html') } catch { response.writeHead(404).end(); return }
      response.writeHead(200, { 'Content-Type': types[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      response.end(await readFile(filename))
    } catch { response.writeHead(500).end() }
  })
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready))
  const origin = `http://localhost:${(server.address() as { port: number }).port}`
  let cdp: CDPSession | undefined
  let authenticatorId: string | undefined
  let assertions = 0
  if (scenario.authentication !== 'password') {
    cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      hasPrf: scenario.authentication === 'prf',
    } })
    authenticatorId = authenticator.authenticatorId
    cdp.on('WebAuthn.credentialAsserted', () => { assertions++ })
  }
  testInfo.annotations.push({ type: 'release-update', description: `${scenario.name}; same isolated origin; native browser WebAuthn with virtual CTAP2 where enabled; physical hardware not tested; changed SW=${changed}` })
  const vaultKey = 'cap_sec_ge_secure:mnemonic'
  const prfKey = 'CapacitorStorage.ge_basic:biometric_prf_v2'
  const legacyKey = 'CapacitorStorage.ge_basic:biometric_encrypted_password'
  try {
    await importPublicWallet(page, origin)
    if (scenario.authentication === 'prf') await page.waitForFunction(key => localStorage.getItem(key) !== null, prfKey)
    if (scenario.authentication === 'legacy') await page.waitForFunction(key => localStorage.getItem(key) !== null, legacyKey)
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    const originalVault = await page.evaluate(key => localStorage.getItem(key), vaultKey)
    expect(originalVault).not.toBeNull()
    const originalRecord = JSON.parse(Buffer.from(originalVault!, 'base64').toString('utf8'))
    if (scenario.fixedVault) expect(originalRecord.version).toBe(2)
    if (scenario.authentication === 'legacy') expect(originalRecord.v).toBe(1)
    const originalPrf = await page.evaluate(key => localStorage.getItem(key), prfKey)
    if (scenario.fixedVault && scenario.authentication === 'password' && process.env.WALLET_CAPTURE_PREVIOUS_VAULT) {
      await writeFile(process.env.WALLET_CAPTURE_PREVIOUS_VAULT, JSON.stringify({ warning: 'PUBLIC test wallet, captured from the previous approved production build. Never fund this key.', sourceBuild: previousRoot, password: TEST_PASSWORD, address: PUBLIC_ADDRESS, record: originalRecord }, null, 2) + '\n', { flag: 'wx' })
    }
    await page.evaluate(() => {
      sessionStorage.setItem('public-update-controller-count', '0')
      navigator.serviceWorker.addEventListener('controllerchange', () => sessionStorage.setItem('public-update-controller-count', String(Number(sessionStorage.getItem('public-update-controller-count')) + 1)))
    })
    activeRoot = currentRoot
    if (changed) {
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
      await expect.poll(async () => page.evaluate(() => Number(sessionStorage.getItem('public-update-controller-count'))), { timeout: 20000 }).toBeGreaterThan(0)
    } else {
      // A compiler-only update may produce byte-identical runtime assets.
      // Explicitly reload the current release; do not claim a controller change.
      await page.reload()
    }
    await expect(page.locator(`script[src="${currentEntry}"]`)).toHaveCount(1)
    await expect(page.getByText('Welcome Back', { exact: true })).toBeVisible()
    let password = TEST_PASSWORD
    if (scenario.authentication === 'prf') {
      const before = assertions
      await page.getByRole('button', { name: 'Use Biometrics', exact: true }).click()
      await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
      expect(assertions).toBeGreaterThan(before)
      expect(await page.evaluate(key => localStorage.getItem(key), prfKey)).toBe(originalPrf)
    } else if (scenario.authentication === 'legacy') {
      const before = assertions
      await expect(page.getByRole('button', { name: 'Use Biometrics', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Recover legacy biometric access', exact: true }).click()
      password = 'PUBLIC-Upgraded-Password-456!'
      await page.getByPlaceholder('New wallet password', { exact: true }).fill(password)
      await page.getByPlaceholder('Confirm new wallet password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Save new password and remove old biometrics', exact: true }).click()
      await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
      expect(assertions).toBeGreaterThan(before)
      expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).toBeNull()
    } else {
      await page.getByPlaceholder('Enter your password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    }
    await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
    await expect(page.getByText(`${PUBLIC_ADDRESS.slice(0, 8)}...${PUBLIC_ADDRESS.slice(-6)}`, { exact: true })).toBeVisible()
    if (scenario.authentication !== 'legacy') expect(await page.evaluate(key => localStorage.getItem(key), vaultKey)).toBe(originalVault)
    // Verify a fresh startup can still decrypt the persisted wallet password.
    await page.reload()
    await page.getByPlaceholder('Enter your password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Unlock', exact: true }).click()
    await expect(page.getByText(`${PUBLIC_ADDRESS.slice(0, 8)}...${PUBLIC_ADDRESS.slice(-6)}`, { exact: true })).toBeVisible()
  } finally {
    if (cdp && authenticatorId) {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
      await cdp.send('WebAuthn.disable')
      await cdp.detach()
    }
    server.closeAllConnections()
    await new Promise<void>(closed => server.close(() => closed()))
  }
})
