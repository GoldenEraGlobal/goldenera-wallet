import {
    Button,
    Item,
    ItemActions,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemMedia,
    ItemTitle,
    Switch,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@project/ui'
import { ActivityComponentType } from '@stackflow/react'
import {
    ChevronRight,
    Copy,
    Eye, Fingerprint,
    Info,
    Lock,
    Palette,
    Trash2,
    Wallet
} from 'lucide-react'
import { ChangeTheme } from '../components/ChangeTheme'
import { useCopy } from '../hooks/useCopy'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { shortenAddress } from '../utils/WalletUtil'


export const SettingsPage: ActivityComponentType = () => {
    const { copy, copied } = useCopy()
    const { push } = useFlow()
    const lockWallet = useWalletStore((state) => state.lockWallet)
    const address = useWalletStore((state) => state.address)
    const biometric = useWalletStore((state) => state.biometric)

    const handleBiometricToggle = async () => {
        push('ToggleBiometricPage', {})
    }

    const handleDeleteWallet = () => {
        push('DeleteWalletPage', {})
    }

    const copyAddress = () => {
        copy(address!)
    }

    return (
        <AppLayout title="Settings">
            <div className="grid gap-6 w-full">
                {/* Account Info */}
                <ItemGroup className="rounded-xl bg-muted/50 p-1">
                    <Item className="rounded-lg">
                        <ItemMedia variant="icon">
                            <Wallet />
                        </ItemMedia>
                        <ItemContent>
                            <ItemTitle>Wallet</ItemTitle>
                            <ItemDescription>
                                {shortenAddress(address!)}
                            </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                            <Tooltip open={copied}>
                                <TooltipTrigger onClick={copyAddress} render={(props) => (
                                    <Button {...props} variant="outline" size='icon'>
                                        <Copy />
                                    </Button>
                                )} />
                                <TooltipContent>
                                    <p>{copied ? 'Copied!' : 'Copy'}</p>
                                </TooltipContent>
                            </Tooltip>
                        </ItemActions>
                    </Item>
                </ItemGroup>

                {/* Security Section */}
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                        Security
                    </h2>
                    <ItemGroup className="rounded-xl bg-muted/50 p-1 gap-1">
                        <Item onClick={() => push('ShowPhrasePage', {})} className="rounded-lg" render={(props) => (
                            <button {...props} />
                        )}>
                            <ItemMedia variant="icon">
                                <Eye />
                            </ItemMedia>
                            <ItemContent>
                                <ItemTitle>View Recovery Phrase</ItemTitle>
                                <ItemDescription>Backup your 12-word phrase</ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </ItemActions>
                        </Item>
                        {biometric.available && (
                            <Item className="rounded-lg" onClick={handleBiometricToggle} render={(props) => (
                                <button {...props} />
                            )}>
                                <ItemMedia variant="icon">
                                    <Fingerprint />
                                </ItemMedia>
                                <ItemContent>
                                    <ItemTitle>Biometrics</ItemTitle>
                                    <ItemDescription>{biometric.enabled ? 'Enabled' : 'Disabled'}</ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <Switch
                                        checked={biometric.enabled}
                                        readOnly
                                    />
                                </ItemActions>
                            </Item>
                        )}
                        <Item
                            onClick={() => {
                                lockWallet()
                            }}
                            className="rounded-lg"
                            render={(props) => (
                                <button {...props} />
                            )}
                        >
                            <ItemMedia variant="icon">
                                <Lock />
                            </ItemMedia>
                            <ItemContent>
                                <ItemTitle>Lock Wallet</ItemTitle>
                                <ItemDescription>Lock wallet now</ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </ItemActions>
                        </Item>
                    </ItemGroup>
                </div>

                {/* Preferences Section */}
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                        Preferences
                    </h2>
                    <ItemGroup className="rounded-xl bg-muted/50 p-1 flex-col">
                        <ChangeTheme>
                            {(open) => <Item
                                onClick={open}
                                className="rounded-lg"
                                render={(props) => (
                                    <button {...props} />
                                )}
                            >
                                <ItemMedia variant="icon">
                                    <Palette />
                                </ItemMedia>
                                <ItemContent>
                                    <ItemTitle>Theme</ItemTitle>
                                    <ItemDescription>Choose your preferred theme</ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                </ItemActions>
                            </Item>
                            }
                        </ChangeTheme>
                    </ItemGroup>
                </div>

                {/* About Section */}
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                        About
                    </h2>
                    <ItemGroup className="rounded-xl bg-muted/50 p-1">
                        <Item className="rounded-lg">
                            <ItemMedia variant="icon">
                                <Info />
                            </ItemMedia>
                            <ItemContent>
                                <ItemTitle>GoldenEra Wallet</ItemTitle>
                                <ItemDescription>Version 1.0.0</ItemDescription>
                            </ItemContent>
                        </Item>
                    </ItemGroup>
                </div>

                {/* Danger Zone */}
                <div className="space-y-2">
                    <h2 className="text-xs font-semibold text-destructive uppercase tracking-wider px-1">
                        Danger Zone
                    </h2>
                    <ItemGroup className="rounded-xl bg-destructive/5 border border-destructive/10 p-1">
                        <Item
                            onClick={handleDeleteWallet}
                            className="rounded-lg hover:bg-destructive/10 text-destructive"
                            render={(props) => (
                                <button {...props} />
                            )}
                        >
                            <ItemMedia variant="icon" className='bg-destructive/5 text-destructive border-destructive/10'>
                                <Trash2 />
                            </ItemMedia>
                            <ItemContent>
                                <ItemTitle className="text-destructive">Delete Wallet</ItemTitle>
                                <ItemDescription className="text-destructive/80">Remove wallet from this device</ItemDescription>
                            </ItemContent>
                            <ItemActions>
                                <ChevronRight className="h-4 w-4" />
                            </ItemActions>
                        </Item>
                    </ItemGroup>
                </div>

                {/* Spacer for scroll */}
                <div className="h-8" />
            </div>
        </AppLayout >
    )
}
