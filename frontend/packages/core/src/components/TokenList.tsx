import {
    useGetBalancesHook,
    useGetTokensHook,
    type TokenDtoV1,
    type WalletBalanceDtoV1,
} from '@project/api'
import {
    Avatar,
    AvatarFallback,
    AvatarImage,
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
    Label,
    Skeleton,
    Switch,
    useOnRefresh
} from '@project/ui'
import { Coins } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { formatWei } from '../utils/WalletUtil'

interface TokenDisplayItem {
    tokenAddress: string
    token: TokenDtoV1
    balance: string | undefined
}

function TokenItem({
    item,
    onClick,
}: {
    item: TokenDisplayItem
    onClick: () => void
}) {
    const tokenName = item.token.name || 'Token'
    const tokenSymbol = item.token.smallestUnitName || 'TKN'
    const tokenDecimals = item.token.numberOfDecimals || 8
    const logoUrl = item.token.logoUrl

    return (
        <Item onClick={onClick} render={(props) => <button {...props} />} variant='muted'>
            <ItemMedia>
                <Avatar className='after:border-none'>
                    <AvatarImage src={logoUrl} alt={tokenName} />
                    <AvatarFallback>{tokenSymbol.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
            </ItemMedia>
            <ItemContent className="gap-0.5">
                <div className="flex flex-row justify-between items-center gap-2">
                    <ItemTitle className="truncate">{tokenSymbol}</ItemTitle>
                    <ItemTitle className="truncate text-right shrink-0">{formatWei(item.balance, tokenDecimals)}</ItemTitle>
                </div>
                <div className="flex flex-row justify-between items-center gap-2">
                    <ItemDescription className="truncate">{tokenName}</ItemDescription>
                    <ItemDescription className="truncate text-right shrink-0">$0.00</ItemDescription>
                </div>
            </ItemContent>
        </Item>
    )
}

export function TokenList() {
    const { push } = useFlow()
    const address = useWalletStore((state) => state.address)
    const [showAllTokens, setShowAllTokens] = useState(false)

    // Fetch all tokens (always fetch)
    const { data: tokensData, isLoading: isLoadingTokens, refetch: refetchTokens } = useGetTokensHook(
        {
            query: {
                refetchInterval: 20000
            },
        }
    )

    // Fetch balances (always fetch to show owned tokens)
    const { data: balances, isLoading: isLoadingBalances, refetch: refetchBalances } = useGetBalancesHook(
        {
            addresses: address ? [address] : []
        },
        {
            query: {
                enabled: !!address,
                refetchInterval: 5000
            },
        }
    )

    useOnRefresh(async () => {
        await Promise.all([
            refetchTokens(),
            refetchBalances(),
        ])
        await new Promise(resolve => setTimeout(resolve, 500))
    })

    // Create a map of token address (lowercase) to balance for quick lookup
    const balanceMap = useMemo(() => {
        const map = new Map<string, WalletBalanceDtoV1>()
        if (balances) {
            for (const balance of balances) {
                if (balance.tokenAddress) {
                    map.set(balance.tokenAddress.toLowerCase(), balance)
                }
            }
        }
        return map
    }, [balances])

    // Construct display items based on the toggle
    // Always iterate over tokensData, filter by balance when showAllTokens is false
    const displayItems = useMemo<TokenDisplayItem[]>(() => {
        const items: TokenDisplayItem[] = []

        // Add tokens from the tokens list
        if (tokensData) {
            for (const token of tokensData) {
                if (token.address) {
                    const tokenAddrLower = token.address.toLowerCase()
                    const balance = balanceMap.get(tokenAddrLower)
                    const hasBalance = balance?.balance && BigInt(balance.balance) > 0n

                    // Only add if showing all OR has balance > 0
                    if (showAllTokens || hasBalance) {
                        items.push({
                            tokenAddress: token.address,
                            token,
                            balance: balance?.balance,
                        })
                    }
                }
            }
        }

        return items
    }, [showAllTokens, tokensData, balanceMap])

    const handleTokenClick = (tokenAddress: string) => {
        push('TokenDetailPage', { tokenAddress })
    }

    const isLoading = isLoadingTokens || isLoadingBalances

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
                <h3 className="font-semibold text-sm">
                    {showAllTokens ? 'All Tokens' : 'Your Tokens'}
                </h3>
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">
                        {displayItems.length} tokens
                    </Badge>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="show-all-tokens" className="text-xs text-muted-foreground">
                            Show all
                        </Label>
                        <Switch
                            id="show-all-tokens"
                            checked={showAllTokens}
                            onCheckedChange={setShowAllTokens}
                            size="sm"
                        />
                    </div>
                </div>
            </div>

            {isLoading ? (
                <ItemGroup className="gap-4">
                    {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-16" />
                    ))}
                </ItemGroup>
            ) : displayItems.length === 0 ? (
                <Empty className="border border-dashed">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Coins />
                        </EmptyMedia>
                        <EmptyTitle>No tokens found</EmptyTitle>
                        <EmptyDescription>
                            {showAllTokens
                                ? 'No tokens available on the network'
                                : 'Receive tokens to see them here'}
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                <ItemGroup className="gap-4">
                    {displayItems.map((item) => (
                        <TokenItem
                            key={item.tokenAddress}
                            item={item}
                            onClick={() => handleTokenClick(item.tokenAddress)}
                        />
                    ))}
                </ItemGroup>
            )}
        </div>
    )
}
