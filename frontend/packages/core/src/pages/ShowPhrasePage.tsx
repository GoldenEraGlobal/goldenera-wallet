import {
    Alert, AlertDescription,
    Button,
    Card, CardContent,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import { AlertTriangle, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { UnlockCard } from '../components/auth/UnlockCard'
import { MnemonicGrid } from '../components/MnemonicGrid'
import { useCopy } from '../hooks/useCopy'
import { AppLayout } from '../layouts/Layouts'
import { privacyScreen } from '../utils/PrivacyUtil'

export const ShowPhrasePage: ActivityComponentType = () => {
    const { copy, copied } = useCopy()
    const [mnemonic, setMnemonic] = useState<string | null>(null)
    const [showMnemonic, setShowMnemonic] = useState(false)

    useEffect(() => {
        return privacyScreen()
    }, [])

    const handleCopyMnemonic = async () => {
        if (mnemonic) {
            await copy(mnemonic)
        }
    }

    useEffect(() => {
        return () => {
            setMnemonic(null)
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
                            <Tooltip open={copied}>
                                <TooltipTrigger onClick={handleCopyMnemonic} render={(props) => (
                                    <Button
                                        {...props}
                                        className='flex-1'
                                        variant="outline"
                                        size="sm"
                                    >
                                        <Copy />
                                        Copy
                                    </Button>
                                )} />
                                <TooltipContent>
                                    <p>{copied ? 'Copied!' : 'Copy'}</p>
                                </TooltipContent>
                            </Tooltip>
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
