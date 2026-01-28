import { Share } from "@capacitor/share";
import { useEffect, useRef, useState } from "react";

export const useShareSupported = () => {
    const isMounted = useRef(true)
    const [supported, setSupported] = useState(false)

    useEffect(() => {
        isMounted.current = true

        const checkSupported = async () => {
            const canShare = await Share.canShare();
            if (isMounted.current) {
                setSupported(canShare.value);
            }
        };
        checkSupported();

        return () => {
            isMounted.current = false
        }
    }, []);


    return supported
}