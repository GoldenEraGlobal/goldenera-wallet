import { useCallback, useEffect, useRef, useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

export const useCopy = () => {
    const [copyState, setCopyState] = useState<CopyState>('idle')
    const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
    const mounted = useRef(true)

    const clearCopyState = useCallback(() => {
        if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
        copiedTimeout.current = setTimeout(() => {
            if (mounted.current) setCopyState('idle')
            copiedTimeout.current = null
        }, 2000)
    }, [])

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
        }
    }, [])

    const copy = useCallback(async (value: string): Promise<boolean> => {
        let copied = false
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
            await navigator.clipboard.writeText(value)
            copied = true
        } catch {
            // Never echo clipboard content or browser error detail: callers may be
            // copying addresses, hashes, or other sensitive values.
        }

        if (mounted.current) {
            setCopyState(copied ? 'copied' : 'failed')
            clearCopyState()
        }
        return copied
    }, [clearCopyState])

    return {
        copy,
        copied: copyState === 'copied',
        copyFailed: copyState === 'failed',
    }
}
