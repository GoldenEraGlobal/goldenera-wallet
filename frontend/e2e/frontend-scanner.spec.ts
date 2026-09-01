import { test, expect, importPublicWallet, NATIVE_TOKEN, RECIPIENT } from './fixtures'

test.use({
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36',
  isMobile: true,
  hasTouch: true,
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __walletScannerValue: string; __walletScannerTracks: MediaStreamTrack[] }
    state.__walletScannerValue = ''
    state.__walletScannerTracks = []
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints)
      state.__walletScannerTracks.push(...stream.getTracks())
      return stream
    }
    // Deterministic decoded camera payloads; Chromium supplies real fake-media tracks.
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class {
      static async getSupportedFormats() { return ['qr_code'] }
      async detect() {
        return state.__walletScannerValue ? [{ rawValue: state.__walletScannerValue, format: 'qr_code', cornerPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }] : []
      }
    } })
  })
})

test('F5: invalid camera QR remains recoverable and the next wallet QR stops the stream', async ({ page }) => {
  await importPublicWallet(page)
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await expect(page.getByText('Position the camera over the QR code')).toBeVisible()
  await page.evaluate(() => { (window as any).__walletScannerValue = 'https://example.invalid' })
  await expect(page.getByRole('alert')).toContainText('not a valid wallet QR')
  await page.evaluate(value => { (window as any).__walletScannerValue = value }, `${NATIVE_TOKEN}:${RECIPIENT}:1`)
  await expect(page.getByPlaceholder('0x...')).toHaveValue(RECIPIENT)
  await expect.poll(() => page.evaluate(() => {
    const tracks = (window as any).__walletScannerTracks as MediaStreamTrack[]
    return tracks.length > 0 && tracks.every(track => track.readyState === 'ended')
  })).toBe(true)
  expect(await page.evaluate(() => document.body.classList.contains('barcode-scanner-active'))).toBe(false)
})

test('F5: cancel after an invalid camera QR releases tracks and returns to the wallet', async ({ page }) => {
  await importPublicWallet(page)
  await page.getByRole('button', { name: 'Scan', exact: true }).click()
  await expect(page.getByText('Position the camera over the QR code')).toBeVisible()
  await page.evaluate(() => { (window as any).__walletScannerValue = 'not a wallet QR' })
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByText('Your Tokens', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => ((window as any).__walletScannerTracks as MediaStreamTrack[]).every(track => track.readyState === 'ended'))).toBe(true)
})
