import {
    GetTransfersQueryParamsTransferTypeEnumKey,
    useGetBalancesHook,
    useGetTokenByAddressHook
} from '@project/api'
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
    Badge,
    Button,
    Card,
    CardContent,
    Separator,
    Skeleton,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import {
    ArrowDownLeft,
    ArrowUpRight,
    CopyIcon,
    Filter,
    QrCode
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { ReceiveTransfer } from '../components/ReceiveTransfer'
import { TransferFilter } from '../components/TransferFilter'
import { TransferList } from '../components/TransferList'
import { useBarcodeIsSupported } from '../hooks/useBarcodeIsSupported'
import { useCopy } from '../hooks/useCopy'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { formatWei, shortenAddress } from '../utils/WalletUtil'

export interface TokenDetailPageProps {
    tokenAddress: string
}

export const TokenDetailPage: ActivityComponentType<TokenDetailPageProps> = ({ params }) => {
    const { push } = useFlow()
    const { copy, copied } = useCopy()
    const { tokenAddress } = params
    const address = useWalletStore((state) => state.address)
    const [transferFilter, setTransferFilter] = useState<GetTransfersQueryParamsTransferTypeEnumKey | undefined>(undefined)
    const supportedScan = useBarcodeIsSupported()

    // Fetch token info
    const { data: tokenInfo, refetch: refetchTokenInfo } = useGetTokenByAddressHook(
        { address: tokenAddress },
        {
            query: {
                enabled: !!tokenAddress,
                refetchInterval: 20000
            },
        }
    )

    // Fetch balance for this token
    const { data: balances, isLoading: isLoadingBalance, refetch: refetchBalances } = useGetBalancesHook(
        {
            addresses: address ? [address] : [],
            tokenAddresses: [tokenAddress]
        },
        {
            query: {
                enabled: !!address,
                refetchInterval: 5000
            },
        }
    )

    const copyAddress = async () => {
        if (address) {
            copy(address)
        }
    }

    // Get token details
    const tokenName = tokenInfo?.name || 'Token'
    const tokenSymbol = tokenInfo?.smallestUnitName || 'TKN'
    const tokenDecimals = tokenInfo?.numberOfDecimals || 8

    // Get balance
    const balance = balances?.[0]?.balance || '0'

    const renderTransferFilter = () => {
        return (
            <TransferFilter filter={transferFilter} onFilterChange={setTransferFilter}>
                {(open) => (
                    <Button variant="ghost" size="icon" onClick={open}>
                        <Filter className="h-5 w-5" />
                    </Button>
                )}
            </TransferFilter>
        )
    }

    const onRefresh = useCallback(async () => {
        await refetchTokenInfo()
        await refetchBalances()
        await new Promise((resolve) => setTimeout(resolve, 500))
    }, [refetchTokenInfo, refetchBalances])

    return (
        <AppLayout title={tokenName} actionButton={renderTransferFilter()} onRefresh={onRefresh}>
            {/* Main Content */}
            <div className="flex-1 space-y-6">
                {/* Token Balance Card */}
                <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
                    <CardContent className="text-center space-y-4">
                        <Avatar className="h-14 w-14 mx-auto after:border-none">
                            <AvatarImage src={tokenInfo?.logoUrl} alt={tokenName} />
                            <AvatarFallback>{tokenSymbol.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>

                        <div className="space-y-1">
                            <h2 className="text-lg font-bold tracking-tight">
                                {isLoadingBalance ? (
                                    <Skeleton className="h-9 w-32 mx-auto" />
                                ) : (
                                    <>
                                        {formatWei(balance, tokenDecimals)}
                                        <span className="text-sm text-muted-foreground ml-2">{tokenSymbol}</span>
                                    </>
                                )}
                            </h2>
                            <p className="text-muted-foreground text-sm">≈ $0.00 USD</p>
                        </div>

                        <div className="flex items-center justify-center gap-2">
                            <Tooltip open={copied}>
                                <TooltipTrigger onClick={copyAddress} render={(props) => (
                                    <Badge className="font-mono" {...props}>
                                        {shortenAddress(address!)}
                                        <CopyIcon />
                                    </Badge>
                                )} />
                                <TooltipContent>
                                    <p>{copied ? 'Copied!' : 'Copy'}</p>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                    </CardContent>
                </Card>

                {/* Action Buttons */}
                <div className="flex items-center w-full gap-3">
                    <Button size="lg" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={() => {
                        push('TxSubmitPage', {
                            data: {
                                tokenAddress: tokenAddress
                            }
                        })
                    }}>
                        <ArrowUpRight className="h-5 w-5" />
                        <span className="text-xs">Send</span>
                    </Button>
                    <ReceiveTransfer>
                        {(open) => (
                            <Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={() => open(tokenAddress)}>
                                <ArrowDownLeft className="h-5 w-5" />
                                <span className="text-xs">Receive</span>
                            </Button>
                        )}
                    </ReceiveTransfer>
                    {supportedScan && (
                        <Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={() => push('ScanQrCodePage', {})}>
                            <QrCode className="h-5 w-5" />
                            <span className="text-xs">Scan</span>
                        </Button>
                    )}
                </div>

                <Separator />

                {/* Transactions */}
                <TransferList
                    tokenAddress={tokenAddress}
                    tokenDecimals={tokenDecimals}
                    transferType={transferFilter}
                />
            </div>
        </AppLayout>
    )
}
