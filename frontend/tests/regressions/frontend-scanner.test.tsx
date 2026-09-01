// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pop: vi.fn(), replace: vi.fn(), remove: vi.fn(async () => {}), stopTrack: vi.fn(),
  isSupported: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn(),
  addListener: vi.fn(), startScan: vi.fn(), stopScan: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeFormat: { QrCode: 'QR_CODE' }, LensFacing: { Back: 'back' }, BarcodeScanner: mocks,
}))
vi.mock('../../packages/core/src/router/useFlow', () => ({ useFlow: () => ({ pop: mocks.pop, replace: mocks.replace }) }))
vi.mock('../../packages/core/src/layouts/Layouts', () => ({ AppLayout: ({ children, backButton }: any) => <div><button onClick={backButton.onClick}>Go back</button>{children}</div> }))
vi.mock('@project/ui', () => ({
  Spinner: () => <span>Loading</span>,
  Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button {...props}>{children}</button>,
}))
import { ScanQrCodePage } from '../../packages/core/src/pages/ScanQrCodePage'

let listener: (event: { barcodes: Array<{ displayValue: string }> }) => void
beforeEach(() => {
  mocks.isSupported.mockResolvedValue({ supported: true })
  mocks.checkPermissions.mockResolvedValue({ camera: 'granted' })
  mocks.requestPermissions.mockResolvedValue({ camera: 'granted' })
  mocks.addListener.mockImplementation(async (_event, callback) => { listener = callback; return { remove: mocks.remove } })
  mocks.stopScan.mockResolvedValue(undefined)
  mocks.startScan.mockImplementation(async ({ videoElement }) => {
    if (videoElement) videoElement.srcObject = { getTracks: () => [{ stop: mocks.stopTrack }], getVideoTracks: () => [{ getCapabilities: () => ({}) }] }
  })
})
afterEach(async () => {
  cleanup()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  vi.clearAllMocks()
})
const begin = async () => { render(<ScanQrCodePage />); await waitFor(() => expect(mocks.addListener).toHaveBeenCalled()) }
const scan = async (displayValue: string) => { await act(async () => { listener({ barcodes: [{ displayValue }] }) }) }

describe('F5 scanner lifecycle', () => {
  it('survives an invalid QR and navigates exactly once for the next valid QR', async () => {
    await begin()
    await scan('https://example.invalid')
    expect(screen.getByRole('alert').textContent).toContain('not a valid wallet QR')
    expect(mocks.replace).not.toHaveBeenCalled()
    await scan('0x0000000000000000000000000000000000000000:0x2222222222222222222222222222222222222222:1')
    expect(mocks.replace).toHaveBeenCalledTimes(1)
    expect(mocks.replace).toHaveBeenCalledWith('TxSubmitPage', { data: { recipient: '0x2222222222222222222222222222222222222222', tokenAddress: '0x0000000000000000000000000000000000000000', amount: '1' } })
    expect(mocks.stopTrack).toHaveBeenCalled()
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(false)
  })
  it('keeps Cancel usable after an invalid QR and cleans up camera/listener', async () => {
    await begin()
    await scan('not a wallet QR')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true })) })
    expect(mocks.pop).toHaveBeenCalledTimes(1)
    expect(mocks.remove).toHaveBeenCalled()
    expect(mocks.stopScan).toHaveBeenCalled()
    expect(document.documentElement.classList.contains('barcode-scanner-active')).toBe(false)
  })
  it('does not start a camera after unmount while permission is outstanding', async () => {
    let permit!: (value: { camera: string }) => void
    mocks.checkPermissions.mockReturnValueOnce(new Promise(resolve => { permit = resolve }))
    render(<ScanQrCodePage />)
    await waitFor(() => expect(mocks.checkPermissions).toHaveBeenCalled())
    cleanup()
    await act(async () => { permit({ camera: 'granted' }); await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(mocks.startScan).not.toHaveBeenCalled()
    expect(mocks.addListener).not.toHaveBeenCalled()
  })
})
