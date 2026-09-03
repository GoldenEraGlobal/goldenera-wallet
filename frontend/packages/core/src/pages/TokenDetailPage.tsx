import type { GetTransfersTransferTypeKey } from '@project/api'
import {
    normalizeApiInteger,
    useGetBalancesHook,
    useGetTokenByAddressHook
} from '@project/api'
import {
    Alert,
    AlertDescription,
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
import type { ActivityComponentType } from '@stackflow/react'
import {
    AlertCircle,
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

interface ParsedTokenHoldings {
    holdings: string | null
    malformed: boolean
}

const parseTokenHoldings = (value: unknown, tokenAddress: string): ParsedTokenHoldings => {
    if (value === undefined) return { holdings: null, malformed: false }
    if (!Array.isArray(value)) return { holdings: null, malformed: true }
    if (value.length === 0) return { holdings: '0', malformed: false }
    if (value.length !== 1) return { holdings: null, malformed: true }

    const row = value[0]
    if (!row || typeof row !== 'object') return { holdings: null, malformed: true }
    const balance = row as Record<string, unknown>
    if (typeof balance.tokenAddress !== 'string' ||
        balance.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
        return { holdings: null, malformed: true }
    }

    try {
        return {
            holdings: normalizeApiInteger(balance.totalBalance, 'totalBalance'),
            malformed: false,
        }
    } catch {
        return { holdings: null, malformed: true }
    }
}

export const TokenDetailPage: ActivityComponentType<'TokenDetailPage'> = ({ params }) => {
    const { push } = useFlow()
    const { copy, copied, copyFailed } = useCopy()
    const { tokenAddress } = params
    const address = useWalletStore((state) => state.address)
    const [transferFilter, setTransferFilter] = useState<GetTransfersTransferTypeKey | undefined>(undefined)
    const supportedScan = useBarcodeIsSupported()

    // Fetch token info
    const {
        data: tokenInfo,
        isLoading: isLoadingTokenInfo,
        isError: isTokenInfoError,
        refetch: refetchTokenInfo,
    } = useGetTokenByAddressHook(
        { query: { address: tokenAddress } },
        {
            query: {
                enabled: !!tokenAddress,
                refetchInterval: 20000
            },
        }
    )

    // Fetch balance for this token
    const {
        data: balances,
        isLoading: isLoadingBalance,
        isError: isBalanceError,
        refetch: refetchBalances,
    } = useGetBalancesHook(
        { query: {
            addresses: address ? [address] : [],
            tokenAddresses: [tokenAddress]
        } },
        {
            query: {
                enabled: !!address,
                refetchInterval: 5000
            },
        }
    )

    const copyAddress = async () => {
        if (address) {
            await copy(address)
        }
    }

    // Get token details
    const tokenName = tokenInfo?.name || 'Token'
    const tokenSymbol = tokenInfo?.smallestUnitName || 'TKN'
    const tokenDecimals = tokenInfo?.numberOfDecimals

    // A token's decimal count is required to interpret every raw amount. Never
    // substitute a plausible-looking value while metadata is unavailable.
    const isTokenMetadataLoading = tokenDecimals === undefined && isLoadingTokenInfo
    const isTokenMetadataUnavailable = tokenDecimals === undefined && !isLoadingTokenInfo

    // Get balance
    const parsedHoldings = parseTokenHoldings(balances, tokenAddress)
    const holdings = isBalanceError && balances?.length === 0 ? null : parsedHoldings.holdings
    const hasLoadError = isTokenInfoError || isBalanceError || parsedHoldings.malformed

    const renderTransferFilter = () => {
        return (
            <TransferFilter filter={transferFilter} onFilterChange={setTransferFilter}>
                {(open) => (
                    <Button aria-label="Filter transfers" variant="ghost" size="icon" onClick={open}>
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
                {hasLoadError && (
                    <Alert variant="destructive">
                        <AlertCircle />
                        <AlertDescription>
                            Token details could not be refreshed. Check your connection and retry.
                        </AlertDescription>
                    </Alert>
                )}

                {/* Token Balance Card */}
                <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
                    <CardContent className="text-center space-y-4">
                        <Avatar className="h-14 w-14 mx-auto after:border-none">
                            <AvatarImage src={tokenInfo?.logoUrl} alt={tokenName} />
                            <AvatarFallback>{tokenSymbol.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>

                        <div className="space-y-1">
                            <h2 className="text-lg font-bold tracking-tight">
                                {isLoadingBalance || isTokenMetadataLoading ? (
                                    <Skeleton className="h-9 w-32 mx-auto" />
                                ) : isTokenMetadataUnavailable ? (
                                    <span className="text-base text-muted-foreground">Token details unavailable</span>
                                ) : holdings === null ? (
                                    <span className="text-base text-muted-foreground">Balance unavailable</span>
                                ) : (
                                    <>
                                        {formatWei(holdings, tokenDecimals)}
                                        <span className="text-sm text-muted-foreground ml-2">{tokenSymbol}</span>
                                    </>
                                )}
                            </h2>
                            <p className="text-muted-foreground text-sm">≈ $0.00 USD</p>
                        </div>

                        <div className="flex items-center justify-center gap-2">
                            <Tooltip open={copied || copyFailed}>
                                <TooltipTrigger onClick={copyAddress} render={(props) => (
                                    <Badge className="font-mono" {...props}>
                                        {shortenAddress(address!)}
                                        <CopyIcon />
                                    </Badge>
                                )} />
                                <TooltipContent>
                                    <p role="status">{copyFailed ? 'Copy failed' : copied ? 'Copied!' : 'Copy'}</p>
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
                {tokenDecimals === undefined ? (
                    isTokenMetadataLoading
                        ? <Skeleton className="h-28 w-full" />
                        : <p className="text-sm text-muted-foreground text-center py-6">Transfer amounts are unavailable until token details load.</p>
                ) : (
                    <TransferList
                        tokenAddress={tokenAddress}
                        tokenDecimals={tokenDecimals}
                        transferType={transferFilter}
                    />
                )}
            </div>
        </AppLayout>
    )
}
