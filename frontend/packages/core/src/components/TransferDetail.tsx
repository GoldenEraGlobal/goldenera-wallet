import { useGetTokensHook, type UnifiedTransferDtoV1 } from '@project/api'
import {
    Badge,
    Button,
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from '@project/ui'
import {
    ArrowDownLeft,
    ArrowUpRight,
    CheckCircle2,
    Clock,
    RefreshCw,
    X
} from 'lucide-react'
import { useWalletStore } from '../store/WalletStore'
import { compareAddress, formatFullTimestamp, formatTransferType, formatWei, isNativeToken, shortenAddress } from '../utils/WalletUtil'
import { DataRow } from './DataRow'

interface TransferDetailProps {
    transfer?: UnifiedTransferDtoV1 | null
    open?: boolean
    onOpenChange?: (open: boolean) => void
    tokenSymbol?: string
    tokenDecimals?: number
    children?: React.ReactNode
}

type TransferDirection = 'received' | 'sent' | 'self'

export function TransferDetail({
    transfer,
    open,
    onOpenChange,
    children,
}: TransferDetailProps) {
    const address = useWalletStore((state) => state.address)
    const { data } = useGetTokensHook()
    const isPending = transfer?.status === 'PENDING'
    const token = data?.find((token) => compareAddress(token.address, transfer?.tokenAddress))
    const nativeToken = data?.find((token) => isNativeToken(token.address))
    const tokenSymbol = token?.smallestUnitName || nativeToken?.smallestUnitName || ''
    const tokenDecimals = token?.numberOfDecimals || nativeToken?.numberOfDecimals || 8
    const tokenName = token?.name || nativeToken?.name || ''
    const nativeTokenSymbol = nativeToken?.smallestUnitName || ''
    const nativeTokenDecimals = nativeToken?.numberOfDecimals || 8
    const nativeTokenName = nativeToken?.name || ''

    // Determine transfer direction
    const getTransferDirection = (): TransferDirection => {
        const userAddr = address?.toLowerCase()
        const fromAddr = transfer?.from?.toLowerCase()
        const toAddr = transfer?.to?.toLowerCase()

        if (fromAddr === userAddr && toAddr === userAddr) return 'self'
        if (toAddr === userAddr) return 'received'
        return 'sent'
    }

    const direction = getTransferDirection()

    const getDirectionStyles = () => {
        switch (direction) {
            case 'received':
                return {
                    amountClass: 'text-green-500',
                    prefix: '+',
                    Icon: ArrowDownLeft,
                    label: 'Received',
                }
            case 'sent':
                return {
                    amountClass: 'text-destructive',
                    prefix: '-',
                    Icon: ArrowUpRight,
                    label: 'Sent',
                }
            default:
                return {
                    amountClass: 'text-blue-500',
                    prefix: '',
                    Icon: RefreshCw,
                    label: 'Self',
                }
        }
    }

    const styles = getDirectionStyles()

    return (
        <Drawer open={open} onOpenChange={onOpenChange}>
            {children}
            <DrawerContent>
                {/* Simple header with status and amount */}
                <DrawerHeader className="relative pb-4">
                    <DrawerClose
                        render={(props) => (
                            <button
                                type="button"
                                className="absolute right-4 -top-2 p-2 rounded-full hover:bg-muted transition-colors"
                                {...props}
                            >
                                <X className="size-4" />
                            </button>
                        )}
                    />

                    <div className="flex items-center gap-2 mb-2 justify-center">
                        <Badge
                            variant={isPending ? 'outline' : 'secondary'}
                            className={isPending ? 'text-yellow-600 border-yellow-600/30' : 'text-green-600 bg-green-500/10'}
                        >
                            {isPending ? (
                                <>
                                    <Clock className="size-3 mr-1" />
                                    Pending
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="size-3 mr-1" />
                                    Confirmed
                                </>
                            )}
                        </Badge>
                        <Badge variant="outline">{styles.label}</Badge>
                    </div>

                    <DrawerTitle className="text-base font-bold">
                        {transfer && (
                            <span className={styles.amountClass}>
                                {styles.prefix}{formatWei(transfer.amount, tokenDecimals)}
                            </span>
                        )}
                        <span className="text-muted-foreground ml-2 text-sm font-normal">{tokenSymbol}</span>
                    </DrawerTitle>
                </DrawerHeader>

                {/* Scrollable key-value list */}
                {transfer && (
                    <div className="px-4 overflow-y-auto max-h-[60vh]">
                        <DataRow label="Type" value={formatTransferType(transfer.transferType)} />
                        {!!transfer.txHash && <DataRow label="Tx hash" value={shortenAddress(transfer.txHash)} copyable />}
                        {direction === 'received' && !!transfer.from && <DataRow label="From" value={shortenAddress(transfer.from)} copyable />}
                        {direction === 'sent' && !!transfer.to && <DataRow label="To" value={shortenAddress(transfer.to)} copyable />}
                        {!!transfer.fee && (<DataRow label="Network fee" value={transfer.fee ? `${formatWei(transfer.fee, nativeTokenDecimals)} ${nativeTokenSymbol}` : undefined} />)}
                        <DataRow label="Timestamp" value={formatFullTimestamp(transfer.timestamp)} />
                        {!!tokenSymbol && (
                            <DataRow label="Token" value={tokenName} />
                        )}
                    </div>
                )}

                <DrawerFooter>
                    <DrawerClose render={(props) => (
                        <Button variant="outline" className="w-full" {...props}>
                            Close
                        </Button>
                    )} />
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
    )
}
