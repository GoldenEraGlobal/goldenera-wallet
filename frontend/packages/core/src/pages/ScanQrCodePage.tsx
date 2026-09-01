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
const setScannerActive = (active: boolean) => {
    document.documentElement.classList.toggle('barcode-scanner-active', active)
    document.body.classList.toggle('barcode-scanner-active', active)
}

// The plugin owns one camera globally. Serialize late permission/start responses
// with teardown so leaving and reopening the page cannot revive an old scan.
let scannerLifecycle: Promise<void> = Promise.resolve()
const serializeScanner = (operation: () => Promise<void>) => {
    const result = scannerLifecycle.then(operation, operation)
    scannerLifecycle = result.catch(() => undefined)
    return result
}

export const ScanQrCodePage = () => {
    const { pop, replace } = useFlow()
    const [isScanning, setIsScanning] = useState(false)
    const [torchEnabled, setTorchEnabled] = useState(false)
    const [torchAvailable, setTorchAvailable] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const videoRef = useRef<HTMLVideoElement>(null)
    const listenerRef = useRef<PluginListenerHandle | null>(null)
    const mounted = useRef(false)
    const generation = useRef(0)
    const hasNavigated = useRef(false)

    const stopScan = useCallback(() => {
        generation.current++
        setScannerActive(false)
        const stream = videoRef.current?.srcObject as MediaStream | null
        stream?.getTracks().forEach(track => track.stop())
        if (videoRef.current) videoRef.current.srcObject = null
        return serializeScanner(async () => {
            const listener = listenerRef.current
            listenerRef.current = null
            // Do not remove listeners belonging to another component.
            await Promise.allSettled([
                listener?.remove(),
                BarcodeScanner.stopScan(),
                ...(isNative ? [BarcodeScanner.disableTorch()] : []),
            ])
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
        void stopScan()
        replace('TxSubmitPage', { data: { recipient: qrData.address, amount: qrData.amount, tokenAddress: qrData.tokenAddress } })
    }, [replace, stopScan])

    const initScanner = useCallback(() => {
        const currentGeneration = generation.current
        const isCurrent = () => mounted.current && !hasNavigated.current && currentGeneration === generation.current
        return serializeScanner(async () => {
            if (!isCurrent()) return
            setIsLoading(true)
            setError(null)
            try {
                const { supported } = await BarcodeScanner.isSupported()
                if (!isCurrent()) return
                if (!supported) throw new Error('Scanner not supported on this device.')
                let permission = await BarcodeScanner.checkPermissions()
                if (!isCurrent()) return
                if (permission.camera !== 'granted') permission = await BarcodeScanner.requestPermissions()
                if (!isCurrent()) return
                if (permission.camera !== 'granted') throw new Error('Camera permission denied.')
                const listener = await BarcodeScanner.addListener('barcodesScanned', event => {
                    const value = event.barcodes[0]?.displayValue
                    if (value && isCurrent()) onScan(value)
                })
                listenerRef.current = listener
                if (!isCurrent()) { await listener.remove(); listenerRef.current = null; return }
                setScannerActive(true)
                await BarcodeScanner.startScan({
                    formats: [BarcodeFormat.QrCode],
                    lensFacing: LensFacing.Back,
                    videoElement: !isNative && videoRef.current ? videoRef.current : undefined,
                })
                if (!isCurrent()) return // queued teardown runs immediately after this task
                if (isNative) {
                    const { available } = await BarcodeScanner.isTorchAvailable()
                    if (isCurrent()) setTorchAvailable(available)
                } else {
                    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
                    const capabilities = track?.getCapabilities() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
                    setTorchAvailable(!!capabilities?.torch)
                }
                if (isCurrent()) setIsScanning(true)
            } catch (failure) {
                await listenerRef.current?.remove().catch(() => undefined)
                listenerRef.current = null
                await BarcodeScanner.stopScan().catch(() => undefined)
                if (isCurrent()) {
                    setScannerActive(false)
                    setError(failure instanceof Error ? failure.message : 'Failed to start camera.')
                    setIsScanning(false)
                }
            } finally {
                if (isCurrent()) setIsLoading(false)
            }
        })
    }, [onScan])

    useEffect(() => {
        mounted.current = true
        const timer = setTimeout(() => { void initScanner() }, 300)
        return () => {
            mounted.current = false
            clearTimeout(timer)
            void stopScan()
        }
    }, [initScanner, stopScan])

    const onCancel = () => {
        if (hasNavigated.current) return
        hasNavigated.current = true
        void stopScan()
        pop()
    }

    const toggleTorch = async () => {
        if (!mounted.current) return
        const next = !torchEnabled
        try {
            if (isNative) await BarcodeScanner.toggleTorch()
            else {
                const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]
                await track?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
            }
            if (mounted.current) setTorchEnabled(next)
        } catch { if (mounted.current) setError('Could not change the camera light.') }
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
