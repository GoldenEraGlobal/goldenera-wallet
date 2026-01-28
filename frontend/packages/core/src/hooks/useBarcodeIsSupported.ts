import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";
import { useEffect, useRef, useState } from "react";
import { isMobile } from "../utils/PlatformUtil";

export const useBarcodeIsSupported = () => {
    const isMounted = useRef(true)
    const [supported, setSupported] = useState(false)

    useEffect(() => {
        isMounted.current = true

        const checkSupported = async () => {
            const { supported } = await BarcodeScanner.isSupported();
            if (isMounted.current) {
                setSupported(supported && isMobile());
            }
        };
        checkSupported();

        return () => {
            isMounted.current = false
        }
    }, []);


    return supported
}