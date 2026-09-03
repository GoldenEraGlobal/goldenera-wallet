import { BarcodeFormat, BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Button, Spinner } from '@project/ui'
import { Flashlight, FlashlightOff, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { stringToQrData } from '../utils/QrUtil'

const isNative = Capacitor.isNativePlatform()
export const SCANNER_OPERATION_TIMEOUT_MS = 8000

class ScannerOperationTimeoutError extends Error {
    constructor(operation: string, options?: ErrorOptions) {
        super(`${operation} timed out. Go back and retry.`, options)
        this.name = 'ScannerOperationTimeoutError'
    }
}

class ScannerReloadRequiredError extends ScannerOperationTimeoutError {
    constructor(operation: string, options?: ErrorOptions) {
        super(operation, options)
        this.message = `${operation} timed out. Reload this page to use the camera again, or go back.`
        this.name = 'ScannerReloadRequiredError'
    }
}

class ScannerUnavailableError extends Error {
    constructor() {
        super('The camera is still in use by another scanner. Go back and retry.')
        this.name = 'ScannerUnavailableError'
    }
}

const setScannerActive = (active: boolean) => {
    document.documentElement.classList.toggle('barcode-scanner-active', active)
    document.body.classList.toggle('barcode-scanner-active', active)
}

const stopVideoTracks = (video: HTMLVideoElement | null) => {
    const stream = video?.srcObject as MediaStream | null
    stream?.getTracks().forEach(track => track.stop())
    if (video) video.srcObject = null
}

function withDeadline<T>(
    operation: Promise<T>,
    label: string,
    onLateSuccess?: (value: T) => void | Promise<void>,
): Promise<T> {
    let timedOut = false
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            timedOut = true
            reject(new ScannerOperationTimeoutError(label))
        }, SCANNER_OPERATION_TIMEOUT_MS)

        void operation.then(
            value => {
                if (timedOut) {
                    if (onLateSuccess) void Promise.resolve(onLateSuccess(value)).catch(() => undefined)
                    return
                }
                clearTimeout(timeout)
                resolve(value)
            },
            error => {
                if (timedOut) return
                clearTimeout(timeout)
                reject(error)
            },
        )
    })
}

const settleWithDeadline = async <T,>(
    operation: Promise<T> | undefined,
    label: string,
    onLateSuccess?: (value: T) => void | Promise<void>,
) => {
    if (!operation) return
    await withDeadline(operation, label, onLateSuccess).catch(() => undefined)
}

interface ScannerMutationOptions<T> {
    onTimeout?: (error: ScannerReloadRequiredError) => void
    onLateSuccess?: (value: T) => void | Promise<void>
}

// The plugin owns one camera globally. A mutation deadline means its native state
// is unknowable, so the queue is released but permanently poisoned until reload.
let scannerLifecycle: Promise<void> = Promise.resolve()
let scannerOwner: symbol | null = null
let scannerPoisoned: ScannerReloadRequiredError | null = null

const poisonScanner = (operation: string) => {
    scannerPoisoned ??= new ScannerReloadRequiredError(operation)
    return scannerPoisoned
}

const ensureScannerAvailable = () => {
    if (scannerPoisoned) throw scannerPoisoned
}

const serializeScanner = (operation: () => Promise<void>) => {
    const run = () => {
        ensureScannerAvailable()
        return operation()
    }
    const result = scannerLifecycle.then(run, run)
    scannerLifecycle = result.then(() => undefined, () => undefined)
    return result
}

const runBestEffort = (operation: () => void | Promise<unknown>) => {
    try {
        void Promise.resolve(operation()).catch(() => undefined)
    } catch {
        // Cleanup is deliberately detached from the lifecycle queue.
    }
}

const removeListenerBestEffort = (listener: PluginListenerHandle | null) => {
    if (listener) runBestEffort(() => listener.remove())
}

/**
 * Reject the serialized mutation at its deadline instead of awaiting an
 * untrusted plugin promise forever. The raw promise remains observed only so a
 * late success can run detached, owner-fenced cleanup.
 */
function awaitScannerMutation<T>(
    operation: () => Promise<T>,
    label: string,
    { onTimeout, onLateSuccess }: ScannerMutationOptions<T> = {},
): Promise<T> {
    try {
        ensureScannerAvailable()
    } catch (failure) {
        return Promise.reject(failure)
    }

    let rawOperation: Promise<T>
    try {
        rawOperation = operation()
    } catch (failure) {
        return Promise.reject(failure)
    }

    let timedOut = false
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            timedOut = true
            const failure = poisonScanner(label)
            reject(failure)
            try {
                onTimeout?.(failure)
            } catch {
                // Poisoning and queue release must not depend on UI cleanup.
            }
        }, SCANNER_OPERATION_TIMEOUT_MS)

        void rawOperation.then(
            value => {
                if (timedOut) {
                    if (onLateSuccess) runBestEffort(() => onLateSuccess(value))
                    return
                }
                clearTimeout(timeout)
                resolve(value)
            },
            failure => {
                if (timedOut) return
                clearTimeout(timeout)
                reject(failure)
            },
        )
    })
}

const ensureScannerOwnerAvailable = (owner: symbol) => {
    ensureScannerAvailable()
    if (scannerOwner !== null && scannerOwner !== owner) throw new ScannerUnavailableError()
}

const cleanupAfterLateMutation = (owner: symbol, video: HTMLVideoElement | null) => {
    // The poison gate prevents a newer scanner, but keep the owner fence so this
    // detached callback can never touch a scanner from another generation.
    if (scannerOwner !== owner) return
    stopVideoTracks(video)
    setScannerActive(false)
    if (isNative) runBestEffort(() => BarcodeScanner.disableTorch())
    runBestEffort(() => BarcodeScanner.stopScan())
}

async function stopOwnedScanner(owner: symbol, video: HTMLVideoElement | null): Promise<boolean> {
    stopVideoTracks(video)
    if (scannerOwner !== owner) return true
    setScannerActive(false)

    if (isNative) {
        // A rejected light cleanup can still fall through to the authoritative
        // camera stop. A timeout poisons the gate, so no later mutation is run.
        try {
            await awaitScannerMutation(
                () => BarcodeScanner.disableTorch(),
                'Camera light cleanup',
                { onLateSuccess: () => cleanupAfterLateMutation(owner, video) },
            )
        } catch {
            if (scannerPoisoned) throw scannerPoisoned
        }
    }

    try {
        await awaitScannerMutation(() => BarcodeScanner.stopScan(), 'Camera stop')
        if (scannerOwner === owner) scannerOwner = null
        return true
    } catch {
        if (scannerPoisoned) throw scannerPoisoned
        // A settled stop rejection (including a dismissed prompt) is known,
        // unlike a timeout. Best-effort teardown has completed, so release the
        // owner and let the next scanner acquire the plugin.
        if (scannerOwner === owner) scannerOwner = null
        return false
    }
}

export const ScanQrCodePage = () => {
    const { pop, replace } = useFlow()
    const [isScanning, setIsScanning] = useState(false)
    const [torchEnabled, setTorchEnabled] = useState(false)
    const [torchAvailable, setTorchAvailable] = useState(false)
    const [error, setError] = useState<string | null>(() => scannerPoisoned?.message ?? null)
    const [isLoading, setIsLoading] = useState(() => scannerPoisoned === null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const listenerRef = useRef<PluginListenerHandle | null>(null)
    const mounted = useRef(false)
    const generation = useRef(0)
    const owner = useRef(Symbol('goldenera-wallet-scanner'))
    const hasNavigated = useRef(false)

    const stopScan = useCallback(() => {
        generation.current++
        if (scannerOwner === owner.current) setScannerActive(false)
        setIsScanning(false)
        setTorchEnabled(false)
        const video = videoRef.current
        stopVideoTracks(video)
        return serializeScanner(async () => {
            const listener = listenerRef.current
            listenerRef.current = null
            await settleWithDeadline(listener?.remove(), 'Scanner listener cleanup')
            await stopOwnedScanner(owner.current, video)
        })
    }, [])

    const onScan = useCallback((data: string) => {
        if (!mounted.current || hasNavigated.current) return
        let qrData
        try {
            qrData = stringToQrData(data)
        } catch {
            setError('This is not a valid wallet QR code. Scan another code or go back.')
            return
        }
        // Validation must succeed before claiming this page's single navigation.
        hasNavigated.current = true
        void stopScan().catch(() => undefined)
        replace('TxSubmitPage', { data: { recipient: qrData.address, amount: qrData.amount, tokenAddress: qrData.tokenAddress } })
    }, [replace, stopScan])

    const initScanner = useCallback(async () => {
        const currentGeneration = generation.current
        const currentOwner = owner.current
        const isCurrent = () => mounted.current && !hasNavigated.current && currentGeneration === generation.current
        const expireCurrent = (failure: ScannerOperationTimeoutError) => {
            if (!isCurrent()) return
            generation.current++
            setScannerActive(false)
            stopVideoTracks(videoRef.current)
            setIsScanning(false)
            setTorchEnabled(false)
            setIsLoading(false)
            setError(failure.message)
        }

        if (scannerPoisoned) {
            setIsLoading(false)
            setError(scannerPoisoned.message)
            return
        }

        setIsLoading(true)
        setError(null)
        try {
            const { supported } = await withDeadline(BarcodeScanner.isSupported(), 'Scanner support check')
            if (!isCurrent()) return
            if (!supported) throw new Error('Scanner not supported on this device.')

            let permission = await withDeadline(BarcodeScanner.checkPermissions(), 'Camera permission check')
            if (!isCurrent()) return
            if (permission.camera !== 'granted') {
                // This is a user-controlled browser/OS prompt. Do not abandon it
                // after the short plugin-operation deadline; mount/generation
                // checks fence any completion after navigation or unmount.
                permission = await BarcodeScanner.requestPermissions()
            }
            if (!isCurrent()) return
            if (permission.camera !== 'granted') throw new Error('Camera permission denied.')

            await serializeScanner(async () => {
                if (!isCurrent()) return
                ensureScannerOwnerAvailable(currentOwner)
                const video = videoRef.current
                let listener: PluginListenerHandle | null = null
                try {
                    try {
                        listener = await withDeadline(
                            BarcodeScanner.addListener('barcodesScanned', event => {
                                const value = event.barcodes[0]?.displayValue
                                if (value && isCurrent()) onScan(value)
                            }),
                            'Scanner listener setup',
                            lateListener => settleWithDeadline(lateListener.remove(), 'Late listener cleanup'),
                        )
                    } catch (failure) {
                        if (failure instanceof ScannerOperationTimeoutError) expireCurrent(failure)
                        throw failure
                    }
                    if (!isCurrent()) {
                        await settleWithDeadline(listener.remove(), 'Scanner listener cleanup')
                        return
                    }
                    listenerRef.current = listener
                    scannerOwner = currentOwner
                    setScannerActive(true)

                    await awaitScannerMutation(
                        () => BarcodeScanner.startScan({
                            formats: [BarcodeFormat.QrCode],
                            lensFacing: LensFacing.Back,
                            videoElement: !isNative && video ? video : undefined,
                        }),
                        'Camera start',
                        {
                            onTimeout: expireCurrent,
                            onLateSuccess: () => cleanupAfterLateMutation(currentOwner, video),
                        },
                    )
                    if (!isCurrent()) {
                        if (listenerRef.current === listener) listenerRef.current = null
                        await settleWithDeadline(listener.remove(), 'Scanner listener cleanup')
                        await stopOwnedScanner(currentOwner, video)
                        return
                    }

                    if (isNative) {
                        const { available } = await withDeadline(BarcodeScanner.isTorchAvailable(), 'Camera light check')
                        if (isCurrent()) setTorchAvailable(available)
                    } else {
                        const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]
                        const capabilities = track?.getCapabilities() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
                        if (isCurrent()) setTorchAvailable(!!capabilities?.torch)
                    }
                    if (isCurrent()) setIsScanning(true)
                } catch (failure) {
                    if (listenerRef.current === listener) listenerRef.current = null
                    if (scannerPoisoned) {
                        removeListenerBestEffort(listener)
                        stopVideoTracks(video)
                        if (scannerOwner === currentOwner) setScannerActive(false)
                    } else {
                        await settleWithDeadline(listener?.remove(), 'Scanner listener cleanup')
                        await stopOwnedScanner(currentOwner, video)
                    }
                    throw failure
                }
            })
        } catch (failure) {
            if (isCurrent()) {
                if (scannerOwner === currentOwner) setScannerActive(false)
                stopVideoTracks(videoRef.current)
                const reportedFailure = scannerPoisoned ?? failure
                setError(reportedFailure instanceof Error ? reportedFailure.message : 'Failed to start camera.')
                setIsScanning(false)
            }
        } finally {
            if (isCurrent()) setIsLoading(false)
        }
    }, [onScan])

    useEffect(() => {
        mounted.current = true
        const timer = setTimeout(() => { void initScanner() }, 300)
        return () => {
            mounted.current = false
            clearTimeout(timer)
            void stopScan().catch(() => undefined)
        }
    }, [initScanner, stopScan])

    const onCancel = () => {
        if (hasNavigated.current) return
        hasNavigated.current = true
        void stopScan().catch(() => undefined)
        pop()
    }

    const toggleTorch = async () => {
        const currentGeneration = generation.current
        const currentOwner = owner.current
        const video = videoRef.current
        const isCurrent = () => mounted.current && currentGeneration === generation.current && scannerOwner === currentOwner
        if (!isCurrent()) return
        const next = !torchEnabled
        try {
            await serializeScanner(async () => {
                if (!isCurrent()) return
                const expireCurrent = (failure: ScannerOperationTimeoutError) => {
                    if (!isCurrent()) return
                    generation.current++
                    const listener = listenerRef.current
                    listenerRef.current = null
                    removeListenerBestEffort(listener)
                    setScannerActive(false)
                    stopVideoTracks(video)
                    setIsScanning(false)
                    setTorchEnabled(false)
                    setIsLoading(false)
                    setError(failure.message)
                }

                if (isNative) {
                    await awaitScannerMutation(
                        () => BarcodeScanner.toggleTorch(),
                        'Camera light change',
                        {
                            onTimeout: expireCurrent,
                            onLateSuccess: () => cleanupAfterLateMutation(currentOwner, video),
                        },
                    )
                } else {
                    const track = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]
                    if (!track) throw new Error('Camera light is unavailable.')
                    await awaitScannerMutation(
                        () => track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }),
                        'Camera light change',
                        {
                            onTimeout: expireCurrent,
                            onLateSuccess: () => cleanupAfterLateMutation(currentOwner, video),
                        },
                    )
                }
                if (isCurrent()) setTorchEnabled(next)
            })
        } catch {
            if (isCurrent()) setError('Could not change the camera light.')
        }
    }

    return (
        <AppLayout title="Scan QR Code" transparent={isNative && isScanning} swipeBack={false} padding={false} backButton={{ onClick: onCancel }}>
            <div className="h-full w-full relative overflow-hidden">
                {!isNative && <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted autoPlay />}
                <div className="relative z-10 w-full h-full pointer-events-none">
                    {isLoading && <div className="absolute inset-0 flex items-center justify-center"><Spinner className="size-10" /></div>}
                    {error && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 pointer-events-auto">
                            <p role="alert" className="text-white text-center mb-4">{error}</p>
                            {isScanning && <Button onClick={() => setError(null)} variant="white">Continue scanning</Button>}
                            <Button onClick={onCancel} variant="white">Back</Button>
                        </div>
                    )}
                    {isScanning && !isLoading && !error && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <div className="w-64 h-64 border-2 border-white/30 rounded-lg" />
                            <p className="text-white/80 mt-8 font-medium">Position the camera over the QR code</p>
                        </div>
                    )}
                    {isScanning && (
                        <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-4 pointer-events-auto">
                            <Button aria-label="Toggle camera light" size="icon-xl" variant="white" onClick={toggleTorch} style={{ display: torchAvailable ? 'flex' : 'none' }}>
                                {torchEnabled ? <FlashlightOff /> : <Flashlight />}
                            </Button>
                            <Button aria-label="Cancel scanning" size="icon-xl" variant="white" onClick={onCancel}><XIcon /></Button>
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    )
}
