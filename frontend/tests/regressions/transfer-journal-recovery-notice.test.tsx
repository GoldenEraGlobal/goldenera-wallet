// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRecovery: vi.fn(),
  recover: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}))

vi.mock('@project/ui', () => ({
  Alert: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDescription: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Button: ({ children, ...props }: React.ComponentPropsWithoutRef<'button'>) => <button {...props}>{children}</button>,
}))
vi.mock('../../packages/core/src/services/TransferCoordinatorService', () => ({
  getTransferJournalRecoveryState: mocks.getRecovery,
  recoverTransferJournal: mocks.recover,
}))
vi.mock('../../packages/core/src/services/TransferJournalService', () => ({
  subscribeTransferJournal: mocks.subscribe,
}))

import { TransferJournalRecoveryNotice } from '../../packages/core/src/components/TransferJournalRecoveryNotice'

const actionRequired = {
  status: 'action-required' as const,
  issues: [{ category: 'malformed-record' as const, count: 1, network: 'MAINNET' as const, sender: '0x1111111111111111111111111111111111111111' }],
  detectedAt: 1,
  recoveredAt: null,
  globalBlocked: false,
  blockedSenders: ['0x1111111111111111111111111111111111111111'],
}

beforeEach(() => {
  mocks.getRecovery.mockResolvedValue(actionRequired)
  mocks.recover.mockResolvedValue({ ...actionRequired, status: 'blocked', recoveredAt: 2 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TransferJournalRecoveryNotice', () => {
  it('renders only public recovery language and requires an explicit acknowledgement', async () => {
    render(<TransferJournalRecoveryNotice />)

    expect(await screen.findByText(/Transaction state is unreadable/i)).toBeTruthy()
    expect(screen.getByText(/Do not send or retry/i)).toBeTruthy()
    expect(screen.queryByText(/hexData|signedBytes|mnemonic|password|privateKey/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge transaction recovery' }))

    await waitFor(() => expect(mocks.recover).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/remains ambiguous/i)).toBeTruthy())
  })

  it('refreshes state from a secret-free cross-tab hint without performing recovery itself', async () => {
    let hint: (() => void) | null = null
    mocks.subscribe.mockImplementation((listener: () => void) => {
      hint = listener
      return () => undefined
    })
    mocks.getRecovery.mockResolvedValueOnce({
      status: 'clear', issues: [], detectedAt: null, recoveredAt: null, globalBlocked: false, blockedSenders: [],
    }).mockResolvedValueOnce(actionRequired)
    render(<TransferJournalRecoveryNotice />)

    await waitFor(() => expect(mocks.getRecovery).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Acknowledge transaction recovery' })).toBeNull()
    act(() => hint?.())
    expect(await screen.findByRole('button', { name: 'Acknowledge transaction recovery' })).toBeTruthy()
    expect(mocks.recover).not.toHaveBeenCalled()
  })
})
