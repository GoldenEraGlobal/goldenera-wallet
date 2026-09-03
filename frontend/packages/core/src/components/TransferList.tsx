import { NATIVE_TOKEN } from '@goldenera/cryptoj'
import type {
    GetTransfersTransferTypeKey} from '@project/api'
import {
    normalizeApiInteger,
    useGetTransfersHook,
    type UnifiedTransferDtoV1,
} from '@project/api'
import {
    Alert,
    AlertDescription,
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
import { AlertCircle, ArrowDownLeft, ArrowUpRight, Clock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
    transferType?: GetTransfersTransferTypeKey
}

interface TransferPageMetadata {
    content: UnifiedTransferDtoV1[]
    totalPages: number
    totalElements: string
    pendingCount: string
    confirmedCount: string
}

const parseTransferPageMetadata = (value: unknown): TransferPageMetadata => {
    if (!value || typeof value !== 'object') throw new TypeError('Transfer page is missing')
    const page = value as Record<string, unknown>
    if (!Array.isArray(page.content)) throw new TypeError('Transfer page content is missing')
    if (typeof page.totalPages !== 'number' || !Number.isSafeInteger(page.totalPages) || page.totalPages < 0) {
        throw new TypeError('totalPages must be a non-negative safe integer')
    }
    const totalElements = normalizeApiInteger(page.totalElements, 'totalElements')
    const pendingCount = normalizeApiInteger(page.pendingCount, 'pendingCount')
    const confirmedCount = normalizeApiInteger(page.confirmedCount, 'confirmedCount')
    if (BigInt(pendingCount) + BigInt(confirmedCount) !== BigInt(totalElements)) {
        throw new TypeError('Transfer page counts are inconsistent')
    }
    if (page.totalPages === 0 && totalElements !== '0') {
        throw new TypeError('Transfer page count is inconsistent')
    }
    return {
        content: page.content as UnifiedTransferDtoV1[],
        totalPages: page.totalPages,
        totalElements,
        pendingCount,
        confirmedCount,
    }
}

const transferPollingInterval = (value: unknown): number | false => {
    if (value == null) return 30_000
    try {
        const { pendingCount } = parseTransferPageMetadata(value)
        return BigInt(pendingCount) > 0n ? 15_000 : 60_000
    } catch {
        return false
    }
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

export function TransferList(props: TransferListProps) {
    const address = useWalletStore(state => state.address)
    const identity = JSON.stringify([address?.toLowerCase(), (props.tokenAddress ?? NATIVE_TOKEN).toLowerCase(), props.transferType ?? null, props.pageSize ?? 15])
    return <TransferListPage key={identity} {...props} address={address} />
}

function TransferListPage({
    tokenAddress = NATIVE_TOKEN,
    tokenDecimals = 8,
    pageSize = 15,
    transferType,
    address,
}: TransferListProps & { address: string | null }) {
    const [pageNumber, setPageNumber] = useState(0)
    const topEl = useRef<HTMLDivElement>(null)
    const [openedTransfer, setOpenedTransfer] = useState<UnifiedTransferDtoV1 | null>(null)

    // Fetch transfers
    const {
        data: transfersPage,
        isLoading,
        isError,
        isPlaceholderData,
        refetch,
    } = useGetTransfersHook(
        { query: {
            addresses: address ? [address] : [],
            tokenAddresses: [tokenAddress],
            pageNumber,
            pageSize,
            transferType
        } },
        {
            query: {
                enabled: !!address,
                placeholderData: keepPreviousData,
                refetchInterval: query => transferPollingInterval(query.state.data)
            },
        }
    )

    const handleRefresh = useCallback(async () => {
        await refetch()
        await new Promise(resolve => setTimeout(resolve, 500))
    }, [refetch])

    useOnRefresh(handleRefresh)

    const parsedPage = useMemo(() => {
        if (!transfersPage) return { metadata: null, malformed: false }
        try {
            return { metadata: parseTransferPageMetadata(transfersPage), malformed: false }
        } catch {
            return { metadata: null, malformed: true }
        }
    }, [transfersPage])
    const transfers = parsedPage.metadata?.content ?? []
    const totalPages = parsedPage.metadata?.totalPages ?? 0
    const totalElements = parsedPage.metadata?.totalElements
    const pendingCount = parsedPage.metadata?.pendingCount
    const responseError = isError || parsedPage.malformed

    // Polling may shrink the result set while the user is on a later page.
    const lastPage = Math.max(0, totalPages - 1)
    const isOutOfRange = !isPlaceholderData && !!parsedPage.metadata && pageNumber > lastPage
    useEffect(() => {
        if (isOutOfRange) setPageNumber(lastPage)
    }, [isOutOfRange, lastPage])

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
            if (topEl.current) scrollIntoView(topEl.current, {
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
                    {pendingCount && pendingCount !== '0' && (
                        <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-600/30">
                            {pendingCount} pending
                        </Badge>
                    )}
                    {totalElements && (
                        <Badge variant="outline" className="text-xs">
                            {totalElements} total
                        </Badge>
                    )}
                </div>
            </div>


            {responseError && (
                <Alert variant="destructive">
                    <AlertCircle />
                    <AlertDescription>
                        Transfer history could not be refreshed. Check your connection and retry.
                    </AlertDescription>
                </Alert>
            )}

            {isLoading || isOutOfRange ? (
                <ItemGroup className="gap-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </ItemGroup>
            ) : transfers.length === 0 && !responseError ? (
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


                </>
            )}

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
