import { NATIVE_TOKEN } from '@goldenera/cryptoj'
import {
    GetTransfersQueryParamsTransferTypeEnumKey,
    useGetTransfersHook,
    type UnifiedTransferDtoV1,
} from '@project/api'
import {
    Badge,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Item,
    ItemContent,
    ItemDescription,
    ItemGroup,
    ItemMedia,
    ItemTitle,
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationNext,
    PaginationPrevious,
    Skeleton,
    useOnRefresh
} from '@project/ui'
import { keepPreviousData } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Clock, RefreshCw } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import scrollIntoView from 'scroll-into-view-if-needed'
import { useWalletStore } from '../store/WalletStore'
import { formatTransferType, formatWei } from '../utils/WalletUtil'
import { TransferDetail } from './TransferDetail'

// Format timestamp
const formatTimestamp = (timestamp: string | undefined): string => {
    if (!timestamp) return 'Unknown'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

// Shorten address
const shortenAddress = (addr: string | null | undefined): string => {
    if (!addr) return ''
    return `${addr.slice(0, 5)}...${addr.slice(-4)}`
}

interface TransferListProps {
    tokenAddress?: string
    tokenDecimals?: number
    pageSize?: number
    transferType?: GetTransfersQueryParamsTransferTypeEnumKey
}

type TransferDirection = 'received' | 'sent' | 'self'

function TransferItem({
    transfer,
    direction,
    tokenDecimals,
    onClick,
}: {
    transfer: UnifiedTransferDtoV1
    direction: TransferDirection
    tokenDecimals: number
    onClick?: (transfer: UnifiedTransferDtoV1) => void
}) {
    const isPending = transfer.status === 'PENDING'

    const getDirectionStyles = () => {
        switch (direction) {
            case 'received':
                return {
                    bgClass: 'bg-green-500/10',
                    iconClass: 'text-green-500',
                    amountClass: 'text-green-500',
                    prefix: '+',
                    Icon: ArrowDownLeft,
                }
            case 'sent':
                return {
                    bgClass: 'bg-destructive/10',
                    iconClass: 'text-destructive',
                    amountClass: 'text-destructive',
                    prefix: '-',
                    Icon: ArrowUpRight,
                }
            default:
                return {
                    bgClass: 'bg-blue-500/10',
                    iconClass: 'text-blue-500',
                    amountClass: 'text-blue-500',
                    prefix: '',
                    Icon: RefreshCw,
                }
        }
    }

    const styles = getDirectionStyles()
    const Icon = styles.Icon

    return (
        <Item variant="muted" render={<button type="button" />} className="w-full cursor-pointer" onClick={() => onClick?.(transfer)}>
            <ItemMedia>
                <div className={`flex items-center justify-center size-8 rounded-full ${styles.bgClass}`}>
                    <Icon className={`size-4 ${styles.iconClass}`} />
                </div>
            </ItemMedia>
            <ItemContent className="gap-0.5">
                <div className="flex flex-row justify-between items-center gap-2">
                    <ItemTitle className="capitalize truncate text-xs">
                        {direction}
                        {isPending && (
                            <Badge
                                variant="outline"
                                className="text-xs py-0 px-1.5 text-yellow-600 border-yellow-600/30"
                            >
                                Pending
                            </Badge>
                        )}
                    </ItemTitle>
                    <ItemTitle className={`truncate text-right shrink-0 ${styles.amountClass} text-sm`}>
                        {styles.prefix}{formatWei(transfer.amount, tokenDecimals)}
                    </ItemTitle>
                </div>
                <div className="flex flex-row justify-between items-center gap-2">
                    <ItemDescription className="truncate">
                        {direction === 'received'
                            ? `${transfer.from ? shortenAddress(transfer.from) : formatTransferType(transfer.transferType)}`
                            : `${transfer.to ? shortenAddress(transfer.to) : formatTransferType(transfer.transferType)}`}
                    </ItemDescription>
                    <ItemDescription className="truncate text-right shrink-0">
                        {formatTimestamp(transfer.timestamp)}
                    </ItemDescription>
                </div>
            </ItemContent>
        </Item>
    )
}

export function TransferList({
    tokenAddress = NATIVE_TOKEN,
    tokenDecimals = 8,
    pageSize = 15,
    transferType,
}: TransferListProps) {
    const address = useWalletStore((state) => state.address)
    const [pageNumber, setPageNumber] = useState(0)
    const topEl = useRef<HTMLDivElement>(null)
    const [openedTransfer, setOpenedTransfer] = useState<UnifiedTransferDtoV1 | null>(null)

    // Fetch transfers
    const { data: transfersPage, isLoading, refetch } = useGetTransfersHook(
        {
            addresses: address ? [address] : [],
            tokenAddresses: [tokenAddress],
            pageNumber,
            pageSize,
            transferType
        },
        {
            query: {
                enabled: !!address,
                placeholderData: keepPreviousData,
                refetchInterval: 5000
            },
        }
    )

    const handleRefresh = useCallback(async () => {
        await refetch()
        await new Promise(resolve => setTimeout(resolve, 500))
    }, [refetch])

    useOnRefresh(handleRefresh)

    const transfers = transfersPage?.content || []
    const totalPages = transfersPage?.totalPages || 0
    const totalElements = transfersPage?.totalElements || 0
    const pendingCount = transfersPage?.pendingCount || 0

    // Determine if transfer is incoming or outgoing
    const getTransferDirection = (transfer: UnifiedTransferDtoV1): TransferDirection => {
        const userAddr = address?.toLowerCase()
        const fromAddr = transfer.from?.toLowerCase()
        const toAddr = transfer.to?.toLowerCase()

        if (fromAddr === userAddr && toAddr === userAddr) return 'self'
        if (toAddr === userAddr) return 'received'
        return 'sent'
    }

    const handlePageChange = (newPage: number) => {
        if (newPage >= 0 && newPage < totalPages) {
            setPageNumber(newPage)
            scrollIntoView(topEl.current!, {
                scrollMode: 'always',
                block: 'start',
                inline: 'start',
                behavior: 'smooth',
            })
        }
    }


    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between px-1" ref={topEl}>
                <h3 className="font-semibold text-sm">Transfer History</h3>
                <div className="flex items-center gap-2">
                    {pendingCount > 0 && (
                        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600/30">
                            {pendingCount} pending
                        </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                        {totalElements} total
                    </Badge>
                </div>
            </div>


            {isLoading ? (
                <ItemGroup className="gap-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </ItemGroup>
            ) : transfers.length === 0 ? (
                <Empty className="border border-dashed">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Clock />
                        </EmptyMedia>
                        <EmptyTitle>No transactions yet</EmptyTitle>
                        <EmptyDescription>
                            Your transaction history will appear here
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <>
                    <ItemGroup className="gap-4">
                        {transfers.map((tx, i) => (
                            <TransferItem
                                key={tx.txHash || i}
                                transfer={tx}
                                direction={getTransferDirection(tx)}
                                tokenDecimals={tokenDecimals}
                                onClick={setOpenedTransfer}
                            />
                        ))}
                    </ItemGroup>

                    {totalPages > 1 && (
                        <Pagination className="mt-4">
                            <PaginationContent className="gap-1">
                                <PaginationItem>
                                    <PaginationPrevious
                                        onClick={() => handlePageChange(pageNumber - 1)}
                                        className={pageNumber === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                    />
                                </PaginationItem>

                                <PaginationItem>
                                    <span className="text-sm text-muted-foreground px-2 whitespace-nowrap">
                                        {pageNumber + 1} / {totalPages}
                                    </span>
                                </PaginationItem>

                                <PaginationItem>
                                    <PaginationNext
                                        onClick={() => handlePageChange(pageNumber + 1)}
                                        className={pageNumber >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                                    />
                                </PaginationItem>
                            </PaginationContent>
                        </Pagination>
                    )}
                </>
            )}

            <TransferDetail
                transfer={openedTransfer}
                open={!!openedTransfer}
                onOpenChange={(open) => {
                    if (!open) {
                        setOpenedTransfer(null)
                    }
                }}
            />
        </div>
    )
}
