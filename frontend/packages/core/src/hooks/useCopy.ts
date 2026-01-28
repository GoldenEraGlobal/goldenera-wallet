import { useCallback, useEffect, useRef, useState } from "react"
import { useCopyToClipboard } from "usehooks-ts"

export const useCopy = () => {
    const [_, _copy] = useCopyToClipboard()
    const [copied, setCopied] = useState(false)
    const copiedTimeout = useRef<NodeJS.Timeout | null>(null)

    useEffect(() => {
        return () => {
            if (copiedTimeout.current) {
                clearTimeout(copiedTimeout.current)
            }
        }
    }, [])

    const copy = useCallback(async (value: string) => {
        const result = await _copy(value)
        if (!result) {
            return
        }
        setCopied(true)
        if (copiedTimeout.current) {
            clearTimeout(copiedTimeout.current)
        }
        copiedTimeout.current = setTimeout(() => {
            setCopied(false)
            copiedTimeout.current = null
        }, 2000)
    }, [])

    return {
        copy,
        copied
    }
}   