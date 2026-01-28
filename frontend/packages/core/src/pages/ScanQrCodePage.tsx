import {
    BarcodeFormat,
    BarcodeScanner,
    LensFacing,
    type BarcodesScannedEvent
} from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import { Button, Spinner } from '@project/ui';
import { Flashlight, FlashlightOff, XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppLayout } from '../layouts/Layouts';
import { useFlow } from '../router/useFlow';
import { stringToQrData } from '../utils/QrUtil';

const isNative = Capacitor.isNativePlatform();

// Helper to toggle body classes for scanner transparency
const setScannerActive = (active: boolean) => {
    if (active) {
        document.documentElement.classList.add('barcode-scanner-active');
        document.body.classList.add('barcode-scanner-active');
    } else {
        document.documentElement.classList.remove('barcode-scanner-active');
        document.body.classList.remove('barcode-scanner-active');
    }
};

export const ScanQrCodePage = () => {
    const { pop, replace } = useFlow();

    const [isScanning, setIsScanning] = useState(false);
    const [torchEnabled, setTorchEnabled] = useState(false);
    const [torchAvailable, setTorchAvailable] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const videoRef = useRef<HTMLVideoElement>(null);
    const isMounted = useRef(false);
    const didInit = useRef(false); // Prevents double init in Strict Mode
    const isRequestingPermission = useRef(false);

    const onScan = useCallback(async (data: string) => {
        const qrData = stringToQrData(data)
        await stopScan();
        replace('TxSubmitPage', {
            data: {
                recipient: qrData.address,
                amount: qrData.amount,
                tokenAddress: qrData.tokenAddress
            }
        })
    }, [replace]);

    const stopScan = useCallback(async () => {
        setScannerActive(false);
        try {
            await BarcodeScanner.removeAllListeners();
            await BarcodeScanner.stopScan();
            if (isNative) {
                try { await BarcodeScanner.disableTorch(); } catch { }
            }
        } catch (e) {
            console.warn('Cleanup error:', e);
        }
        didInit.current = false;
    }, []);

    const initScanner = useCallback(async () => {
        if (didInit.current || isRequestingPermission.current) return;
        didInit.current = true;

        try {
            setIsLoading(true);
            setError(null);

            const { supported } = await BarcodeScanner.isSupported();
            if (!supported) throw new Error('Scanner not supported on this device.');

            let status = await BarcodeScanner.checkPermissions();
            if (status.camera !== 'granted') {
                isRequestingPermission.current = true;
                try {
                    status = await BarcodeScanner.requestPermissions();
                } finally {
                    isRequestingPermission.current = false;
                }
            }
            if (status.camera !== 'granted') throw new Error('Camera permission denied.');

            await BarcodeScanner.addListener('barcodesScanned', async (event: BarcodesScannedEvent) => {
                const barcode = event.barcodes[0];
                if (barcode && isMounted.current) {
                    if (!barcode.displayValue) return;
                    await onScan(barcode.displayValue)
                }
            });

            setScannerActive(true);

            await BarcodeScanner.startScan({
                formats: [BarcodeFormat.QrCode],
                lensFacing: LensFacing.Back,
                videoElement: (!isNative && videoRef.current) ? videoRef.current : undefined
            });

            if (isNative) {
                const { available } = await BarcodeScanner.isTorchAvailable();
                if (isMounted.current) setTorchAvailable(available);
            } else if (videoRef.current) {
                // Web stream takes a moment to load capabilities
                await new Promise((resolve) => setTimeout(resolve, 150));
                if (!isMounted.current) return;
                try {
                    const track = (videoRef.current?.srcObject as MediaStream)?.getVideoTracks()[0];
                    const caps = track?.getCapabilities() as any;
                    setTorchAvailable(!!caps?.torch);
                } catch (e) {
                    console.log('Torch check failed', e);
                }
            }

            if (isMounted.current) {
                setIsScanning(true);
                setIsLoading(false);
            }

        } catch (e: any) {
            console.error('Start scan error:', e);
            if (isMounted.current) {
                setScannerActive(false);
                setError(e.message || 'Failed to start camera.');
                setIsLoading(false);
            }
        }
    }, [pop, stopScan]);

    const toggleTorch = async () => {
        if (!isMounted.current) return;

        const nextState = !torchEnabled;

        if (isNative) {
            await BarcodeScanner.toggleTorch();
            if (isMounted.current) setTorchEnabled(nextState);
        } else {
            const video = videoRef.current;
            if (video && video.srcObject) {
                const track = (video.srcObject as MediaStream).getVideoTracks()[0];
                try {
                    await track.applyConstraints({
                        advanced: [{ torch: nextState } as any]
                    });
                    if (isMounted.current) setTorchEnabled(nextState);
                } catch (e) {
                    console.error('Web torch error', e);
                }
            }
        }
    };

    useEffect(() => {
        isMounted.current = true;

        // Delay start by 250ms for smoother transition
        const timer = setTimeout(() => {
            if (isMounted.current) {
                initScanner();
            }
        }, 300);

        return () => {
            isMounted.current = false;
            clearTimeout(timer);
            stopScan();
        };
    }, []);

    return (
        <AppLayout title="Scan QR Code" transparent={isNative && isScanning} swipeBack={false} padding={false}>
            <div className='h-full w-full relative overflow-hidden'>
                {!isNative && (
                    <div className="absolute inset-0 z-0">
                        <video
                            ref={videoRef}
                            className="w-full h-full object-cover"
                            playsInline
                            muted
                            autoPlay
                        />
                    </div>
                )}

                <div className="relative z-10 w-full h-full pointer-events-none">
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Spinner className='size-10' />
                        </div>
                    )}

                    {error && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 pointer-events-auto">
                            <p className="text-white text-center mb-4">{error}</p>
                            <Button onClick={() => pop()} variant="white">Back</Button>
                        </div>
                    )}

                    {isScanning && !isLoading && !error && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <div className="relative w-64 h-64 border-2 border-white/30 rounded-lg">
                                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />
                            </div>
                            <p className="text-white/80 mt-8 font-medium">
                                Position the camera over the QR code
                            </p>
                        </div>
                    )}

                    {isScanning && (
                        <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-4 pointer-events-auto">
                            <Button size='icon-xl' variant="white" onClick={toggleTorch} style={{ display: torchAvailable ? 'flex' : 'none' }}>
                                {torchEnabled ? <FlashlightOff /> : <Flashlight />}
                            </Button>
                            <Button size='icon-xl' variant="white" onClick={() => pop()}>
                                <XIcon />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </AppLayout>
    );
};