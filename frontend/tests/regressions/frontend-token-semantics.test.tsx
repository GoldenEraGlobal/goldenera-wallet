// @vitest-environment jsdom
import React from 'react'
import type * as ProjectApi from '@project/api'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  push: vi.fn(),
  tokensResult: {} as any,
  balancesResult: {} as any,
  tokenInfoResult: {} as any,
  authorityResult: { data: { authority: false }, isLoading: false, isError: false } as any,
}))

vi.mock('@project/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectApi>()
  return {
    normalizeApiInteger: actual.normalizeApiInteger,
    useGetTokensHook: () => state.tokensResult,
    useGetBalancesHook: () => state.balancesResult,
    useGetTokenByAddressHook: () => state.tokenInfoResult,
    useGetAuthorityStatusHook: () => state.authorityResult,
  }
})
vi.mock('@project/ui', () => {
  const Container = ({ children }: any) => <div>{children}</div>
  return {
    Alert: Container,
    AlertDescription: Container,
    Avatar: Container,
    AvatarFallback: Container,
    AvatarImage: () => null,
    Badge: ({ children }: any) => <span>{children}</span>,
    Button: ({ children, variant: _variant, size: _size, ...props }: any) => (
      <button {...props}>{children}</button>
    ),
    Card: Container,
    CardContent: Container,
    Empty: Container,
    EmptyDescription: Container,
    EmptyHeader: Container,
    EmptyMedia: Container,
    EmptyTitle: Container,
    Item: ({ children, onClick }: any) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    ItemContent: Container,
    ItemDescription: Container,
    ItemGroup: Container,
    ItemMedia: Container,
    ItemTitle: Container,
    Label: ({ children }: any) => <span>{children}</span>,
    Separator: () => <hr />,
    Skeleton: () => <span data-testid="skeleton">Loading value</span>,
    Switch: ({ checked, onCheckedChange }: any) => (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
      >
        toggle
      </button>
    ),
    Tooltip: Container,
    TooltipContent: Container,
    TooltipTrigger: ({ onClick, render }: any) =>
      typeof render === 'function' ? render({ onClick }) : render,
    useOnRefresh: () => undefined,
  }
})
vi.mock('../../packages/core/src/router/useFlow', () => ({ useFlow: () => ({ push: state.push }) }))
vi.mock('../../packages/core/src/store/WalletStore', () => ({
  useWalletStore: (selector: (wallet: { address: string }) => unknown) =>
    selector({ address: '0x1111111111111111111111111111111111111111' }),
}))
vi.mock('../../packages/core/src/hooks/useBarcodeIsSupported', () => ({
  useBarcodeIsSupported: () => false,
}))
vi.mock('../../packages/core/src/hooks/useCopy', () => ({
  useCopy: () => ({ copy: vi.fn(), copied: false, copyFailed: false }),
}))
vi.mock('../../packages/core/src/layouts/Layouts', () => ({
  AppLayout: ({ children }: any) => <main>{children}</main>,
}))
vi.mock('../../packages/core/src/components/ReceiveTransfer', () => ({
  ReceiveTransfer: ({ children }: any) => children(() => undefined),
}))
vi.mock('../../packages/core/src/components/TransferFilter', () => ({
  TransferFilter: ({ children }: any) => children(() => undefined),
}))
vi.mock('../../packages/core/src/components/TransferList', () => ({
  TransferList: ({ tokenDecimals }: { tokenDecimals: number }) => (
    <div>Transfers use {tokenDecimals} decimals</div>
  ),
}))

import { TokenList } from '../../packages/core/src/components/TokenList'
import { DashboardPage } from '../../packages/core/src/pages/DashboardPage'
import { TokenDetailPage } from '../../packages/core/src/pages/TokenDetailPage'

const refetch = vi.fn(async () => ({}))
const tokenAddress = '0x2222222222222222222222222222222222222222'

beforeEach(() => {
  state.authorityResult = { data: { authority: false }, isLoading: false, isError: false }
  state.tokensResult = {
    data: [
      {
        address: tokenAddress,
        name: 'Precise Token',
        smallestUnitName: 'P18',
        numberOfDecimals: 18,
      },
    ],
    isLoading: false,
    isError: false,
    refetch,
  }
  state.balancesResult = {
    data: [],
    isLoading: false,
    isError: false,
    refetch,
  }
  state.tokenInfoResult = {
    data: {
      address: tokenAddress,
      name: 'Precise Token',
      smallestUnitName: 'P18',
      numberOfDecimals: 18,
    },
    isLoading: false,
    isError: false,
    refetch,
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('token amount semantics', () => {
  it('hides governance from wallets that are not authorities', () => {
    state.authorityResult = { data: { authority: false }, isLoading: false, isError: false }
    render(<DashboardPage />)

    expect(screen.queryByRole('button', { name: /Governance/ })).toBeNull()
  })

  it('shows governance only after current authority membership is confirmed', () => {
    state.authorityResult = { data: { authority: true }, isLoading: false, isError: false }
    render(<DashboardPage />)

    fireEvent.click(screen.getByRole('button', { name: /Governance/ }))
    expect(state.push).toHaveBeenCalledWith('GovernancePage', {})
  })

  it('does not fabricate a zero USD total for nonzero dashboard holdings without pricing', () => {
    state.balancesResult.data = [
      {
        tokenAddress,
        totalBalance: '1000000000000000000',
      },
    ]
    render(<DashboardPage />)

    expect(screen.getByText('1.000000000000000000')).toBeTruthy()
    expect(screen.getAllByText('USD valuation unavailable').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.queryByRole('heading', { name: /\$0\.00 USD/ })).toBeNull()
  })

  it('renders the dashboard total as unavailable when authoritative pricing is missing', () => {
    render(<DashboardPage />)

    expect(screen.getByRole('heading', { name: 'Unavailable' })).toBeTruthy()
    expect(screen.getAllByText('USD valuation unavailable').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('heading', { name: /\$0\.00 USD/ })).toBeNull()
  })

  it('shows an unknown balance instead of fabricating zero after the initial balance request fails', async () => {
    state.balancesResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }
    render(<TokenList />)

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })

    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.queryByText(/^0(?:\.0+)?$/)).toBeNull()
  })

  it('fails closed instead of treating a present balance without totalBalance as zero', async () => {
    state.balancesResult.data = [{ tokenAddress, balance: '100' }]
    render(<TokenList />)

    expect(screen.getByText(/Token balances could not be refreshed/)).toBeTruthy()
    expect(screen.queryByText('No tokens found')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('switch'))
    })
    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.queryByText(/^0(?:\.0+)?$/)).toBeNull()
  })

  it('preserves last-good holdings when a later balance payload violates the contract', () => {
    state.balancesResult.data = [{ tokenAddress, totalBalance: '1000000000000000000' }]
    const view = render(<TokenList />)
    expect(screen.getByText('1.000000000000000000')).toBeTruthy()

    state.balancesResult = {
      ...state.balancesResult,
      data: [{ tokenAddress, balance: '100' }],
    }
    view.rerender(<TokenList />)

    expect(screen.getByText(/Token balances could not be refreshed/)).toBeTruthy()
    expect(screen.getByText('1.000000000000000000')).toBeTruthy()
    expect(screen.queryByText('No tokens found')).toBeNull()
  })

  it('refuses to format holdings when token decimal metadata is missing', () => {
    state.tokensResult.data[0].numberOfDecimals = undefined
    state.balancesResult.data = [{ tokenAddress, totalBalance: '100000000' }]
    render(<TokenList />)

    expect(screen.getByText('Token details unavailable')).toBeTruthy()
    expect(screen.queryByText('1')).toBeNull()
  })

  it('formats an 18-decimal balance exactly and passes the same metadata to transfer history', () => {
    state.balancesResult.data = [
      {
        tokenAddress,
        totalBalance: '1000000000000000001',
      },
    ]
    render(<TokenDetailPage params={{ tokenAddress }} />)

    expect(screen.getByText('1.000000000000000001')).toBeTruthy()
    expect(screen.getByText('Transfers use 18 decimals')).toBeTruthy()
  })

  it('fails closed on token detail when a present balance violates the contract', () => {
    state.balancesResult.data = [{ tokenAddress, balance: '100' }]
    render(<TokenDetailPage params={{ tokenAddress }} />)

    expect(screen.getByText(/Token details could not be refreshed/)).toBeTruthy()
    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.queryByText(/^0(?:\.0+)?$/)).toBeNull()
  })

  it('does not treat an empty balance payload as authoritative when the request failed', () => {
    state.balancesResult = {
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    }
    render(<TokenDetailPage params={{ tokenAddress }} />)

    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.queryByText(/^0(?:\.0+)?$/)).toBeNull()
  })

  it('keeps amounts in a loading state until token decimal metadata arrives', () => {
    state.tokenInfoResult = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch,
    }
    render(<TokenDetailPage params={{ tokenAddress }} />)

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/Transfers use/)).toBeNull()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows explicit unavailable states rather than an 8-decimal fallback on metadata failure', () => {
    state.tokenInfoResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }
    render(<TokenDetailPage params={{ tokenAddress }} />)

    expect(screen.getByText('Token details unavailable')).toBeTruthy()
    expect(
      screen.getByText('Transfer amounts are unavailable until token details load.')
    ).toBeTruthy()
    expect(screen.queryByText(/0\.00000000/)).toBeNull()
    expect(screen.queryByText(/Transfers use/)).toBeNull()
  })
})
