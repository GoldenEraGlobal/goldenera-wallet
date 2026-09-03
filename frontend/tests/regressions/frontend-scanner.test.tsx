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
let ScanQrCodePage: React.ComponentType
let SCANNER_OPERATION_TIMEOUT_MS: number
let listener: (event: { barcodes: Array<{ displayValue: string }> }) => void
beforeEach(async () => {
  vi.resetModules()
  ;({ ScanQrCodePage, SCANNER_OPERATION_TIMEOUT_MS } = await import('../../packages/core/src/pages/ScanQrCodePage'))
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
  vi.useRealTimers()
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

  it('releases ownership after a settled stop rejection so a new page can scan', async () => {
    vi.useFakeTimers()
    mocks.stopScan.mockRejectedValueOnce(new Error('Camera stop prompt was dismissed'))

    const first = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)

    first.unmount()
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.stopScan).toHaveBeenCalledTimes(1)

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Position the camera over the QR code')).toBeTruthy()
  })

  it('does not let a hung permission preflight own the global camera queue', async () => {
    vi.useFakeTimers()
    mocks.checkPermissions.mockReturnValueOnce(new Promise(() => {}))
    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.checkPermissions).toHaveBeenCalledTimes(1)

    cleanup()
    await act(async () => {
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    mocks.checkPermissions.mockResolvedValue({ camera: 'granted' })
    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.addListener).toHaveBeenCalledTimes(1)
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
  })

  it('waits for a user-controlled permission prompt without an operation deadline', async () => {
    vi.useFakeTimers()
    let grantPermission!: () => void
    mocks.checkPermissions.mockResolvedValueOnce({ camera: 'prompt' })
    mocks.requestPermissions.mockReturnValueOnce(new Promise(resolve => {
      grantPermission = () => resolve({ camera: 'granted' })
    }))

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS * 2)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.queryByText(/permission.*timed out/i)).toBeNull()
    expect(mocks.startScan).not.toHaveBeenCalled()

    await act(async () => {
      grantPermission()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Position the camera over the QR code')).toBeTruthy()
  })

  it('does not let a stale owner stop or hide a newer active scanner', async () => {
    vi.useFakeTimers()
    let finishOldPermission!: () => void
    mocks.checkPermissions
      .mockResolvedValueOnce({ camera: 'prompt' })
      .mockResolvedValueOnce({ camera: 'granted' })
    mocks.requestPermissions.mockReturnValueOnce(new Promise(resolve => {
      finishOldPermission = () => resolve({ camera: 'granted' })
    }))

    const stale = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1)

    const active = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(true)

    stale.unmount()
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.stopScan).not.toHaveBeenCalled()
    expect(document.body.classList.contains('barcode-scanner-active')).toBe(true)

    await act(async () => {
      finishOldPermission()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    active.unmount()
  })

  it('fences a listener that completes after its setup deadline', async () => {
    vi.useFakeTimers()
    let finishListener!: () => void
    let lateCallback!: (event: { barcodes: Array<{ displayValue: string }> }) => void
    mocks.addListener.mockImplementationOnce((_event, callback) => {
      lateCallback = callback
      return new Promise(resolve => {
        finishListener = () => resolve({ remove: mocks.remove })
      })
    })

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.getByText(/scanner listener setup timed out/i)).toBeTruthy()

    await act(async () => {
      lateCallback({ barcodes: [{ displayValue: '0x0000000000000000000000000000000000000000:0x2222222222222222222222222222222222222222:1' }] })
      finishListener()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalled()
  })

  it('poisons and releases the queue when camera start never settles', async () => {
    vi.useFakeTimers()
    mocks.startScan.mockReturnValueOnce(new Promise(() => {}))

    const first = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    first.unmount()
    expect(screen.getByRole('alert').textContent).toMatch(/camera start timed out.*reload.*go back/i)
    expect(screen.queryByText('Loading')).toBeNull()
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(mocks.stopScan).not.toHaveBeenCalled()
  })

  it('best-effort stops a start that completes after the scanner is poisoned', async () => {
    vi.useFakeTimers()
    let finishStart!: () => void
    mocks.startScan.mockReturnValueOnce(new Promise(resolve => {
      finishStart = () => resolve(undefined)
    }))

    const first = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    first.unmount()
    render(<ScanQrCodePage />)

    await act(async () => {
      finishStart()
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    expect(mocks.stopScan).toHaveBeenCalledTimes(1)
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toMatch(/reload.*go back/i)
  })

  it('poisons and releases the queue when camera stop never settles', async () => {
    vi.useFakeTimers()
    mocks.stopScan.mockReturnValueOnce(new Promise(() => {}))

    const first = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    first.unmount()
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.stopScan).toHaveBeenCalledTimes(1)

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toMatch(/camera stop timed out.*reload.*go back/i)
    expect(screen.queryByText('Loading')).toBeNull()
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(mocks.stopScan).toHaveBeenCalledTimes(1)
  })

  it('poisons and releases the queue when a torch change never settles', async () => {
    vi.useFakeTimers()
    const applyConstraints = vi.fn(() => new Promise<void>(() => {}))
    const stopTrack = vi.fn()
    const track = {
      applyConstraints,
      getCapabilities: () => ({ torch: true }),
      stop: stopTrack,
    }
    mocks.startScan.mockImplementation(async ({ videoElement }) => {
      if (videoElement) {
        videoElement.srcObject = {
          getTracks: () => [track],
          getVideoTracks: () => [track],
        }
      }
    })

    const first = render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle camera light' }))
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    render(<ScanQrCodePage />)
    await act(async () => {
      vi.advanceTimersByTime(300)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mocks.startScan).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(SCANNER_OPERATION_TIMEOUT_MS + 1)
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    first.unmount()
    expect(screen.getByRole('alert').textContent).toMatch(/camera light change timed out.*reload.*go back/i)
    expect(screen.queryByText('Loading')).toBeNull()
    expect(stopTrack).toHaveBeenCalled()
    expect(mocks.startScan).toHaveBeenCalledTimes(1)
    expect(mocks.stopScan).not.toHaveBeenCalled()
  })
})
