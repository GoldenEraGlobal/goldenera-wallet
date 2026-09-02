import {
  normalizeApiInteger,
  useGetBalancesHook,
  useGetTokensHook,
  type TokenDtoV1,
  type WalletBalanceDtoV1,
} from '@project/api'
import {
  Alert,
  AlertDescription,
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
  useOnRefresh,
} from '@project/ui'
import { AlertCircle, Coins } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { formatWei } from '../utils/WalletUtil'

interface TokenDisplayItem {
  tokenAddress: string
  token: TokenDtoV1
  holdings: string | undefined
}

interface ParsedBalances {
  map: Map<string, WalletBalanceDtoV1> | null
  malformed: boolean
}

const EMPTY_BALANCE_MAP = new Map<string, WalletBalanceDtoV1>()

const parseBalances = (value: unknown): ParsedBalances => {
  if (value === undefined) return { map: null, malformed: false }
  if (!Array.isArray(value)) return { map: null, malformed: true }

  const map = new Map<string, WalletBalanceDtoV1>()
  try {
    for (const row of value) {
      if (!row || typeof row !== 'object') throw new TypeError('Balance row is missing')
      const balance = row as WalletBalanceDtoV1
      if (typeof balance.tokenAddress !== 'string' || balance.tokenAddress.length === 0) {
        throw new TypeError('Balance token address is missing')
      }
      const tokenAddress = balance.tokenAddress.toLowerCase()
      if (map.has(tokenAddress)) throw new TypeError('Balance token is duplicated')
      map.set(tokenAddress, {
        ...balance,
        totalBalance: normalizeApiInteger(balance.totalBalance, 'totalBalance'),
      })
    }
  } catch {
    return { map: null, malformed: true }
  }
  return { map, malformed: false }
}

function TokenItem({ item, onClick }: { item: TokenDisplayItem; onClick: () => void }) {
  const tokenName = item.token.name || 'Token'
  const tokenSymbol = item.token.smallestUnitName || 'TKN'
  const tokenDecimals = item.token.numberOfDecimals
  const logoUrl = item.token.logoUrl

  return (
    <Item onClick={onClick} render={(props) => <button {...props} />} variant="muted">
      <ItemMedia>
        <Avatar className="after:border-none">
          <AvatarImage src={logoUrl} alt={tokenName} />
          <AvatarFallback>{tokenSymbol.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <div className="flex flex-row justify-between items-center gap-2">
          <ItemTitle className="truncate">{tokenSymbol}</ItemTitle>
          <ItemTitle className="truncate text-right shrink-0">
            {item.holdings === undefined ? (
              <span className="text-muted-foreground">Balance unavailable</span>
            ) : tokenDecimals === undefined ? (
              <span className="text-muted-foreground">Token details unavailable</span>
            ) : (
              formatWei(item.holdings, tokenDecimals)
            )}
          </ItemTitle>
        </div>
        <div className="flex flex-row justify-between items-center gap-2">
          <ItemDescription className="truncate">{tokenName}</ItemDescription>
          <ItemDescription className="truncate text-right shrink-0">
            USD valuation unavailable
          </ItemDescription>
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
  const {
    data: tokensData,
    isLoading: isLoadingTokens,
    isError: isTokensError,
    refetch: refetchTokens,
  } = useGetTokensHook({
    query: {
      refetchInterval: 20000,
    },
  })

  // Fetch balances (always fetch to show owned tokens)
  const {
    data: balances,
    isLoading: isLoadingBalances,
    isError: isBalancesError,
    refetch: refetchBalances,
  } = useGetBalancesHook(
    {
      query: {
        addresses: address ? [address] : [],
      },
    },
    {
      query: {
        enabled: !!address,
        refetchInterval: 5000,
      },
    }
  )

  useOnRefresh(async () => {
    await Promise.all([refetchTokens(), refetchBalances()])
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  const parsedBalances = useMemo(() => parseBalances(balances), [balances])
  const [lastGoodBalanceMap, setLastGoodBalanceMap] = useState<Map<
    string,
    WalletBalanceDtoV1
  > | null>(null)
  useEffect(() => {
    if (parsedBalances.map !== null) setLastGoodBalanceMap(parsedBalances.map)
  }, [parsedBalances.map])
  const balanceMap = parsedBalances.map ?? lastGoodBalanceMap ?? EMPTY_BALANCE_MAP
  const hasCompleteBalanceDataset = parsedBalances.map !== null || lastGoodBalanceMap !== null

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
          // A completed balance dataset can legitimately omit a zero
          // holding. If the initial request failed and no dataset exists,
          // keep the value unknown instead of fabricating a zero.
          const holdings = balance?.totalBalance ?? (hasCompleteBalanceDataset ? '0' : undefined)
          const hasHoldings = holdings !== undefined && BigInt(holdings) > 0n

          // Ownership is based on confirmed holdings. `balance` is the
          // amount currently available to send after pending reservations.
          if (showAllTokens || hasHoldings) {
            items.push({
              tokenAddress: token.address,
              token,
              holdings,
            })
          }
        }
      }
    }

    return items
  }, [showAllTokens, tokensData, balanceMap, hasCompleteBalanceDataset])

  const handleTokenClick = (tokenAddress: string) => {
    push('TokenDetailPage', { tokenAddress })
  }

  const isLoading = isLoadingTokens || isLoadingBalances
  const hasLoadError = isTokensError || isBalancesError || parsedBalances.malformed

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="font-semibold text-sm">{showAllTokens ? 'All Tokens' : 'Your Tokens'}</h3>
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

      {hasLoadError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            Token balances could not be refreshed. Check your connection and retry.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <ItemGroup className="gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </ItemGroup>
      ) : displayItems.length === 0 && !hasLoadError ? (
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
