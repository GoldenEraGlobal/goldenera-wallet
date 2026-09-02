// @vitest-environment jsdom
import React from 'react'
import type * as ProjectApi from '@project/api'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => { window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), media: '', onchange: null })) })

const state = vi.hoisted(() => ({ address: '0x1111111111111111111111111111111111111111', pages: 3, calls: [] as any[], error: false, noData: false, missingCounts: false }))
vi.mock('../../packages/core/src/store/WalletStore', () => ({ useWalletStore: (select: any) => select({ address: state.address }) }))
vi.mock('../../packages/core/src/components/TransferDetail', () => ({ TransferDetail: () => null }))
vi.mock('scroll-into-view-if-needed', () => ({ default: vi.fn() }))
vi.mock('@project/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectApi>()
  return {
    normalizeApiInteger: actual.normalizeApiInteger,
    useGetTransfersHook: ({ query }: any) => {
      state.calls.push(query)
      const totalPages = query.transferType ? 1 : state.pages
      return { isLoading: false, isError: state.error, isPlaceholderData: false, refetch: vi.fn(async () => {}), data: state.noData ? undefined : {
        content: query.pageNumber < totalPages ? [{ txHash: `hash-${query.pageNumber}`, status: 'CONFIRMED', transferType: query.transferType ?? 'TRANSFER', from: '0x2222222222222222222222222222222222222222', to: state.address, amount: '100', tokenAddress: query.tokenAddresses[0], timestamp: '2026-08-31T12:00:00Z' }] : [],
        totalPages, totalElements: String(totalPages), pendingCount: state.missingCounts ? undefined : '0', confirmedCount: String(totalPages),
      } }
    },
  }
})
import { TransferList } from '../../packages/core/src/components/TransferList'

beforeEach(() => { state.pages = 3; state.calls = []; state.error = false; state.noData = false; state.missingCounts = false; state.address = '0x1111111111111111111111111111111111111111' })
afterEach(() => cleanup())
const next = () => fireEvent.click(screen.getByLabelText('Go to next page'))

describe('F8 history page identity', () => {
  it('starts a changed filter on page zero, without requesting a stale later page', () => {
    const view = render(<TransferList tokenDecimals={0} />)
    next(); next()
    expect(state.calls.at(-1).pageNumber).toBe(2)
    view.rerender(<TransferList tokenDecimals={0} transferType="BURN" />)
    expect(state.calls.at(-1)).toMatchObject({ transferType: 'BURN', pageNumber: 0 })
    expect(state.calls.filter(call => call.transferType === 'BURN').every(call => call.pageNumber === 0)).toBe(true)
    expect(screen.queryByText('No transactions yet')).toBeNull()
  })
  it('resets when wallet or token changes', () => {
    const view = render(<TransferList />)
    next(); next()
    state.address = '0x3333333333333333333333333333333333333333'
    view.rerender(<TransferList />)
    expect(state.calls.at(-1).pageNumber).toBe(0)
    next()
    view.rerender(<TransferList tokenAddress="0x4444444444444444444444444444444444444444" />)
    expect(state.calls.at(-1).pageNumber).toBe(0)
  })
  it('recovers automatically when polling shrinks total pages', () => {
    const view = render(<TransferList />)
    next(); next()
    state.pages = 1
    view.rerender(<TransferList />)
    expect(state.calls.at(-1).pageNumber).toBe(0)
    expect(screen.queryByText('No transactions yet')).toBeNull()
  })

  it('shows an initial API failure instead of a legitimate empty-history state', () => {
    state.error = true
    state.noData = true
    render(<TransferList />)
    expect(screen.getByText(/Transfer history could not be refreshed/)).toBeTruthy()
    expect(screen.queryByText('No transactions yet')).toBeNull()
  })

  it('keeps stale history visible while reporting a refresh failure', () => {
    state.error = true
    render(<TransferList />)
    expect(screen.getByText(/Transfer history could not be refreshed/)).toBeTruthy()
    expect(screen.getByText('received')).toBeTruthy()
  })

  it('fails closed when required transfer totals are missing', () => {
    state.missingCounts = true
    render(<TransferList />)
    expect(screen.getByText(/Transfer history could not be refreshed/)).toBeTruthy()
    expect(screen.queryByText('No transactions yet')).toBeNull()
    expect(screen.queryByText(/ total$/)).toBeNull()
  })
})
