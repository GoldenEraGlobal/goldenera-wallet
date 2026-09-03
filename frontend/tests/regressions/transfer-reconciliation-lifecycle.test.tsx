// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reconcileTransfers: vi.fn(async () => []),
  subscribeTransferJournal: vi.fn(),
  journalHintHandler: null as (() => void) | null,
  unsubscribeJournal: vi.fn(),
  addNativeListener: vi.fn(),
  appStateHandler: null as ((event: { isActive: boolean }) => void) | null,
  removeNativeListener: vi.fn(async () => undefined),
}))

vi.mock('../../packages/core/src/services/TransferCoordinatorService', () => ({
  reconcileTransfers: mocks.reconcileTransfers,
}))
vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addNativeListener },
}))
vi.mock('../../packages/core/src/services/TransferJournalService', () => ({
  subscribeTransferJournal: mocks.subscribeTransferJournal,
}))

import { TransferReconciliationLifecycle } from '../../packages/core/src/components/TransferReconciliationLifecycle'
import { useWalletStore } from '../../packages/core/src/store/WalletStore'

const originalState = useWalletStore.getState()
let visibility: 'hidden' | 'visible'

beforeEach(() => {
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mocks.subscribeTransferJournal.mockImplementation((handler: () => void) => {
    mocks.journalHintHandler = handler
    return mocks.unsubscribeJournal
  })
  mocks.addNativeListener.mockImplementation(async (
    _event: string,
    handler: (event: { isActive: boolean }) => void,
  ) => {
    mocks.appStateHandler = handler
    return { remove: mocks.removeNativeListener }
  })
  useWalletStore.setState({ status: 'locked' })
})

afterEach(() => {
  cleanup()
  useWalletStore.setState(originalState, true)
  mocks.appStateHandler = null
  mocks.journalHintHandler = null
  vi.clearAllMocks()
})

describe('TransferReconciliationLifecycle', () => {
  it('reconciles on startup, each unlock, focus, visible, online, and native resume', async () => {
    render(<TransferReconciliationLifecycle />)
    await waitFor(() => expect(mocks.reconcileTransfers).toHaveBeenCalledWith('startup'))
    expect(mocks.reconcileTransfers).not.toHaveBeenCalledWith('unlock')

    act(() => useWalletStore.setState({ status: 'unlocked' }))
    await waitFor(() => expect(mocks.reconcileTransfers).toHaveBeenCalledWith('unlock'))
    act(() => useWalletStore.setState({ status: 'locked' }))
    await waitFor(() => expect(useWalletStore.getState().status).toBe('locked'))
    act(() => useWalletStore.setState({ status: 'unlocked' }))
    await waitFor(() => {
      expect(mocks.reconcileTransfers.mock.calls.filter(([trigger]) => trigger === 'unlock')).toHaveLength(2)
    })
    await waitFor(() => expect(mocks.addNativeListener).toHaveBeenCalledWith('appStateChange', expect.any(Function)))
    await waitFor(() => expect(mocks.appStateHandler).not.toBeNull())

    act(() => window.dispatchEvent(new Event('focus')))
    act(() => window.dispatchEvent(new Event('online')))
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => mocks.appStateHandler?.({ isActive: false }))
    act(() => mocks.appStateHandler?.({ isActive: true }))

    await waitFor(() => {
      expect(mocks.reconcileTransfers.mock.calls.filter(([trigger]) => trigger === 'focus')).toHaveLength(3)
      expect(mocks.reconcileTransfers).toHaveBeenCalledWith('online')
    })
  })

  it('reconciles a cross-tab journal hint only while focused, visible, and online', async () => {
    render(<TransferReconciliationLifecycle />)
    await waitFor(() => expect(mocks.subscribeTransferJournal).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.journalHintHandler).not.toBeNull())
    mocks.reconcileTransfers.mockClear()

    act(() => mocks.journalHintHandler?.())
    await waitFor(() => expect(mocks.reconcileTransfers).toHaveBeenCalledWith('journal'))

    mocks.reconcileTransfers.mockClear()
    visibility = 'hidden'
    act(() => mocks.journalHintHandler?.())
    expect(mocks.reconcileTransfers).not.toHaveBeenCalled()
  })

  it('removes browser and native listeners when the root lifecycle owner unmounts', async () => {
    const rendered = render(<TransferReconciliationLifecycle />)
    await waitFor(() => expect(mocks.addNativeListener).toHaveBeenCalledWith('appStateChange', expect.any(Function)))
    await waitFor(() => expect(mocks.appStateHandler).not.toBeNull())
    await waitFor(() => expect(mocks.journalHintHandler).not.toBeNull())
    const nativeHandler = mocks.appStateHandler
    const journalHandler = mocks.journalHintHandler
    rendered.unmount()
    await waitFor(() => expect(mocks.removeNativeListener).toHaveBeenCalledTimes(1))
    expect(mocks.unsubscribeJournal).toHaveBeenCalledTimes(1)
    mocks.reconcileTransfers.mockClear()

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    nativeHandler?.({ isActive: true })
    journalHandler?.()
    expect(mocks.reconcileTransfers).not.toHaveBeenCalled()
  })
})
