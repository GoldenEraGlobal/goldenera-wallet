// @vitest-environment jsdom
import React, { forwardRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sender = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const native = '0x0000000000000000000000000000000000000000'
const token = '0x3333333333333333333333333333333333333333'

const mocks = vi.hoisted(() => {
  class DurableUnknownError extends Error {}
  return {
    DurableUnknownError,
    prepare: vi.fn(),
    confirm: vi.fn(),
    reconcileTransfers: vi.fn(async () => []),
    balanceResult: {} as Record<string, unknown>,
    pop: vi.fn(),
    wallet: {
      address: '0x1111111111111111111111111111111111111111',
      getSessionSnapshot: vi.fn(),
      isSessionCurrent: vi.fn(),
    },
  }
})

vi.mock('@project/api', () => ({
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  normalizeApiInteger: (value: unknown) => {
    if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value
    throw new Error('invalid API integer')
  },
  useGetBalancesHook: () => mocks.balanceResult,
  useGetMempoolRecommendedFeesHook: () => ({ data: undefined }),
  useGetTokensHook: () => ({
    data: [
      { address: native, name: 'Golden', smallestUnitName: 'GLD', numberOfDecimals: 8 },
      { address: token, name: 'Token', smallestUnitName: 'TOK', numberOfDecimals: 8 },
    ],
    isLoading: false,
  }),
}))

vi.mock('@project/ui', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Input = forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'>>(
    (props, ref) => <input ref={ref} {...props} />
  )
  return {
    Alert: Container,
    AlertDescription: Container,
    Button: ({ children, ...props }: React.ComponentPropsWithoutRef<'button'>) => (
      <button {...props}>{children}</button>
    ),
    Card: Container,
    CardContent: Container,
    CardDescription: Container,
    CardFooter: Container,
    CardHeader: Container,
    CardTitle: Container,
    Drawer: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
      open ? <div>{children}</div> : null,
    DrawerClose: ({ render: renderClose }: { render: (props: object) => React.ReactNode }) => (
      <>{renderClose({})}</>
    ),
    DrawerContent: Container,
    DrawerFooter: Container,
    DrawerHeader: Container,
    DrawerTitle: Container,
    Field: Container,
    FieldError: Container,
    FieldLabel: Container,
    Input,
    Select: Container,
    SelectContent: Container,
    SelectGroup: Container,
    SelectItem: Container,
    SelectLabel: Container,
    SelectTrigger: Container,
    SelectValue: Container,
    Spinner: () => <span>Loading</span>,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  }
})

vi.mock('react-number-format', () => ({
  NumericFormat: ({
    customInput: Input,
    onValueChange: _onValueChange,
    ...props
  }: {
    customInput: React.ComponentType<React.ComponentPropsWithoutRef<'input'>>
    onValueChange: unknown
  }) => <Input {...props} />,
}))
vi.mock('../../packages/core/src/components/TokenSelect', () => ({ TokenSelect: () => null }))
vi.mock('../../packages/core/src/router/useFlow', () => ({ useFlow: () => ({ pop: mocks.pop }) }))
vi.mock('../../packages/core/src/store/WalletStore', () => ({
  useWalletStore: Object.assign(
    <T,>(selector: (state: typeof mocks.wallet) => T) => selector(mocks.wallet),
    { getState: () => mocks.wallet, subscribe: () => () => undefined }
  ),
}))
vi.mock('../../packages/core/src/services/TransferCoordinator', () => ({
  TransferDurableUnknownError: mocks.DurableUnknownError,
}))
vi.mock('../../packages/core/src/services/TransferCoordinatorService', () => ({
  transferCoordinator: { prepare: mocks.prepare, confirm: mocks.confirm },
  reconcileTransfers: mocks.reconcileTransfers,
}))

import { TxSubmitCard } from '../../packages/core/src/components/TxSubmitCard'

const review = {
  version: 1,
  reviewId: '00000000-0000-4000-8000-000000000001',
  network: 'MAINNET',
  walletId: 'wallet-test',
  vaultRevision: 1,
  walletGeneration: 1,
  walletStorageToken: 'session-token',
  sender,
  recipient,
  tokenAddress: token,
  amount: '100',
  feeLevel: 'standard',
  fee: '2500',
  nonce: '7',
  nodeNextNonce: '7',
  acceptedNonceHighWater: null,
  timestamp: '1700000000000',
  estimatedSignedSize: 137,
  recommendation: {
    baseFee: '1000', feePerByte: '10', minimumTotalFee: '2500', miningFeePerByte: '0', totalForAverageTx: '2500',
  },
  balanceFingerprint: `${sender}|${native}=1000000|${token}=1000000`,
  preparedAt: 1_700_000_000_000,
} as const

beforeEach(() => {
  mocks.balanceResult = {
    data: [],
    error: null,
    isError: false,
    isLoading: false,
    isSuccess: true,
  }
  mocks.wallet.getSessionSnapshot.mockReturnValue({ address: sender })
  mocks.wallet.isSessionCurrent.mockReturnValue(true)
  mocks.prepare.mockResolvedValue(review)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TxSubmitCard balance availability display', () => {
  const renderSelectedToken = () => render(<TxSubmitCard initialData={{ tokenAddress: token }} />)

  it('shows loading rather than a fabricated zero while the selected balance loads', () => {
    mocks.balanceResult = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      isSuccess: false,
    }
    renderSelectedToken()

    expect(screen.getByRole('status').textContent).toBe('Balance: Loading balance…')
    expect(screen.queryByText('Balance: 0.00000000 TOK')).toBeNull()
  })

  it('shows a safe error and unavailable balance after an initial balance query error', () => {
    mocks.balanceResult = {
      data: undefined,
      error: new Error('Balance service unavailable'),
      isError: true,
      isLoading: false,
      isSuccess: false,
    }
    renderSelectedToken()

    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Balance service unavailable')
    expect(screen.getByText('Balance will be verified before transaction review.')).toBeTruthy()
    expect(screen.queryByText('Balance: 0.00000000 TOK')).toBeNull()
  })

  it('renders an explicit successful zero balance', () => {
    mocks.balanceResult.data = [{ tokenAddress: token, balance: '0' }]
    renderSelectedToken()

    expect(screen.getByText('Balance: 0.00000000 TOK')).toBeTruthy()
    expect(screen.queryByText('Balance unavailable')).toBeNull()
  })

  it('renders a successful nonzero balance exactly', () => {
    mocks.balanceResult.data = [{ tokenAddress: token, balance: '123456789' }]
    renderSelectedToken()

    expect(screen.getByText('Balance: 1.23456789 TOK')).toBeTruthy()
  })

  it('fails closed for absent or malformed successful balance responses', () => {
    const view = renderSelectedToken()
    expect(screen.getByText('Balance unavailable')).toBeTruthy()

    mocks.balanceResult = {
      data: [{ tokenAddress: token, balance: 'not-a-canonical-integer' }],
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    view.rerender(<TxSubmitCard initialData={{ tokenAddress: token }} />)

    expect(screen.getByText('Balance unavailable')).toBeTruthy()
    expect(screen.queryByText('Balance: 0.00000000 TOK')).toBeNull()
  })

  it('keeps valid stale data visible while reporting a refresh error', () => {
    mocks.balanceResult = {
      data: [{ tokenAddress: token, balance: '100' }],
      error: new Error('Balance refresh failed'),
      isError: true,
      isLoading: false,
      isSuccess: false,
    }
    renderSelectedToken()

    expect(screen.getByText('Balance: 0.00000100 TOK')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Balance refresh failed')
  })
})

describe('TxSubmitCard ambiguous submission reconciliation', () => {
  const renderPreparedReview = async () => {
    render(
      <TxSubmitCard
        initialData={{ tokenAddress: token, recipient, amount: '0.000001', fee: 'standard' }}
      />
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    })
    return screen.findByRole('button', { name: 'Confirm' })
  }

  it('starts detached reconciliation and closes the review for a returned unknown outcome', async () => {
    mocks.confirm.mockResolvedValue({ kind: 'unknown', record: {} })
    fireEvent.click(await renderPreparedReview())

    await waitFor(() => expect(mocks.reconcileTransfers).toHaveBeenCalledWith('submission'))
    expect(mocks.reconcileTransfers).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(mocks.pop).not.toHaveBeenCalled()
  })

  it('closes an accepted review so the user cannot retry the same submission', async () => {
    mocks.confirm.mockResolvedValue({
      kind: 'accepted',
      record: { hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    })
    fireEvent.click(await renderPreparedReview())

    await waitFor(() => expect(mocks.pop).toHaveBeenCalledTimes(1))
    expect(mocks.reconcileTransfers).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })

  it('starts detached reconciliation and closes the review for a typed durable unknown error', async () => {
    mocks.confirm.mockRejectedValue(new mocks.DurableUnknownError('durable unknown'))
    fireEvent.click(await renderPreparedReview())

    await waitFor(() => expect(mocks.reconcileTransfers).toHaveBeenCalledWith('submission'))
    expect(mocks.reconcileTransfers).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(mocks.pop).not.toHaveBeenCalled()
  })

  it('keeps a pre-dispatch failure retryable without starting reconciliation', async () => {
    mocks.confirm.mockRejectedValue(new Error('wallet session changed'))
    fireEvent.click(await renderPreparedReview())

    await waitFor(() => expect(screen.getByText('wallet session changed')).toBeTruthy())
    expect(mocks.reconcileTransfers).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(mocks.pop).not.toHaveBeenCalled()
  })
})
