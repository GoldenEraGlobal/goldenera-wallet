import {
    Alert, AlertDescription,
    Button,
    Card, CardContent
} from '@project/ui'
import type { ActivityComponentType } from '@stackflow/react'
import { AlertTriangle, Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { UnlockCard } from '../components/auth/UnlockCard'
import { MnemonicGrid } from '../components/MnemonicGrid'
import { useCopy } from '../hooks/useCopy'
import { AppLayout } from '../layouts/Layouts'
import { privacyScreen } from '../utils/PrivacyUtil'

export const ShowPhrasePage: ActivityComponentType<'ShowPhrasePage'> = () => {
    const [mnemonic, setMnemonic] = useState<string | null>(null)
    const [showMnemonic, setShowMnemonic] = useState(false)
    const { copy, copied, copyFailed } = useCopy()

    useEffect(() => {
        return privacyScreen()
    }, [])

    useEffect(() => {
        const clearPhrase = () => {
            setShowMnemonic(false)
            setMnemonic(null)
        }
        const onVisibilityChange = () => {
            if (document.visibilityState !== 'visible') clearPhrase()
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('pagehide', clearPhrase)
        window.addEventListener('blur', clearPhrase)
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener('pagehide', clearPhrase)
            window.removeEventListener('blur', clearPhrase)
            clearPhrase()
        }
    }, [])

    // If we have mnemonic, show the backup
    if (mnemonic) {
        return (
            <AppLayout title='View Recovery Phrase' centered>
                <Card className="w-full">
                    <CardContent className="space-y-4">
                        <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
                            <AlertTriangle />
                            <AlertDescription className="text-xs">
                                <strong className="font-bold">Never share</strong> your recovery phrase. Anyone with these words can steal your funds.
                            </AlertDescription>
                        </Alert>
                        <MnemonicGrid mnemonic={mnemonic} show={showMnemonic} onChangeShow={setShowMnemonic} />
                        <div className="flex gap-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                onClick={() => setShowMnemonic(!showMnemonic)}
                            >
                                {showMnemonic ? (
                                    <>
                                        <EyeOff className="h-4 w-4" />
                                        Hide
                                    </>
                                ) : (
                                    <>
                                        <Eye className="h-4 w-4" />
                                        Show
                                    </>
                                )}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="flex-1"
                                disabled={!showMnemonic}
                                onClick={() => void copy(mnemonic)}
                            >
                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                {copyFailed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </AppLayout>
        )
    }

    return (
        <AppLayout title='View Recovery Phrase' centered>
            <UnlockCard
                description="Enter your password to reveal your recovery phrase"
                onSuccess={async (result) => setMnemonic(result.mnemonic)}
            />
        </AppLayout>
    )
}
