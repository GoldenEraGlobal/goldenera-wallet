import {
    Alert, AlertDescription,
    Button,
    Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
    Checkbox,
    Label,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import { AlertTriangle, Copy, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MnemonicGrid } from '../components/MnemonicGrid'
import { useCopy } from '../hooks/useCopy'
import { BasicLayout } from '../layouts/Layouts'
import { useWalletStore } from '../store/WalletStore'
import { privacyScreen } from '../utils/PrivacyUtil'

export const BackupPhrasePage: ActivityComponentType = () => {
    const { copy, copied } = useCopy()
    const backup = useWalletStore(state => state.backupWallet)
    const backupPhrase = useWalletStore(state => state.backupPhrase)
    const [hasBackedUp, setHasBackedUp] = useState(false)
    const [showMnemonic, setShowMnemonic] = useState(false)

    useEffect(() => {
        return privacyScreen()
    }, [])

    const handleCopyMnemonic = async () => {
        if (backupPhrase) {
            await copy(backupPhrase)
        }
    }

    const handleContinue = () => {
        backup()
    }

    return (
        <BasicLayout>
            <Card className="w-full">
                <CardHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <ShieldCheck className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle>Backup Recovery Phrase</CardTitle>
                    <CardDescription>
                        Write down these 12 words in order and store them safely
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
                        <AlertTriangle />
                        <AlertDescription className="text-sm">
                            <strong className="font-bold">Never share</strong> your recovery phrase. Anyone with these words can steal your funds.
                        </AlertDescription>
                    </Alert>
                    {backupPhrase && (
                        <MnemonicGrid mnemonic={backupPhrase} show={showMnemonic} onChangeShow={setShowMnemonic} />
                    )}
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
                    <Label className="hover:bg-accent/50 flex items-start gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
                        <Checkbox
                            id="backup-confirm"
                            checked={hasBackedUp}
                            onCheckedChange={setHasBackedUp}
                            className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
                        />
                        <div className="grid gap-1.5 font-normal">
                            <p className="text-sm leading-none font-medium">
                                I have written down my recovery phrase and stored it in a safe place
                            </p>
                        </div>
                    </Label>
                </CardContent>
                <CardFooter className="flex flex-col gap-3">
                    <Button
                        size="lg"
                        className="w-full"
                        disabled={!hasBackedUp}
                        onClick={handleContinue}
                    >
                        Continue to Wallet
                    </Button>
                </CardFooter>
            </Card>
        </BasicLayout>
    )

}
