// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  recover: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../../packages/core/src/store/WalletStore', () => {
  class LegacyRecoveryCompletionError extends Error {
    code: string
    authorityConsumed: boolean
    passwordCommit: string
    nextAction: string
    constructor(code: string, message: string, authorityConsumed: boolean, passwordCommit: string, nextAction: string) {
      super(message)
      this.code = code
      this.authorityConsumed = authorityConsumed
      this.passwordCommit = passwordCommit
      this.nextAction = nextAction
    }
  }
  const state = {
    biometric: { legacy: true },
    sessionRevision: 1,
    recoverLegacyAccess: handlers.recover,
    completeLegacyRecovery: handlers.complete,
    cancelLegacyRecovery: handlers.cancel,
  }
  return {
    LegacyRecoveryCompletionError,
    useWalletStore: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

import { LegacyRecoveryCompletionError } from '../../packages/core/src/store/WalletStore'
import { WalletVaultCorruptionError } from '../../packages/core/src/services/WalletVaultService'
import { LegacyBiometricMigration } from '../../packages/core/src/components/auth/LegacyBiometricMigration'

const recovery = Object.freeze({ ticketId: 'opaque-ticket', expiresAt: Date.now() + 60_000 })

async function openCompletionForm() {
  handlers.recover.mockResolvedValue(recovery)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recover legacy biometric access' })) })
  fireEvent.change(screen.getByLabelText('New wallet password'), { target: { value: 'PUBLIC-New-Password-456!' } })
  fireEvent.change(screen.getByLabelText('Confirm new wallet password'), { target: { value: 'PUBLIC-New-Password-456!' } })
}

beforeEach(() => {
  handlers.recover.mockReset()
  handlers.complete.mockReset()
  handlers.cancel.mockReset()
})
afterEach(cleanup)

describe('LegacyBiometricMigration completion outcomes', () => {
  it('shows corruption recovery guidance instead of a generic legacy-authentication failure', async () => {
    const corruption = new WalletVaultCorruptionError()
    handlers.recover.mockRejectedValue(corruption)
    render(<LegacyBiometricMigration />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recover legacy biometric access' })) })

    expect(screen.getByText(corruption.message)).toBeTruthy()
    expect(screen.queryByText(/Legacy verification is unavailable/i)).toBeNull()
  })

  it('keeps the form only for a typed pre-redemption password validation failure', async () => {
    handlers.complete.mockRejectedValue(new LegacyRecoveryCompletionError(
      'PASSWORD_INVALID', 'Choose a stronger password.', false, 'not-started', 'edit-password',
    ))
    render(<LegacyBiometricMigration />)
    await openCompletionForm()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save new password and upgrade biometrics' })) })

    expect((screen.getByLabelText('New wallet password') as HTMLInputElement).value).toBe('PUBLIC-New-Password-456!')
  })

  it('clears the form and gives reload guidance for an uncertain password commit', async () => {
    handlers.complete.mockRejectedValue(new LegacyRecoveryCompletionError(
      'COMMIT_UNCERTAIN', 'Readback was interrupted.', true, 'uncertain', 'reload-and-check-new-password',
    ))
    render(<LegacyBiometricMigration />)
    await openCompletionForm()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save new password and upgrade biometrics' })) })

    expect(screen.queryByLabelText('New wallet password')).toBeNull()
    expect(screen.getByText(/Reload the wallet and check the new password/i)).toBeTruthy()
  })

  it('clears the form and gives new-password unlock guidance after a verified postcommit failure', async () => {
    handlers.complete.mockRejectedValue(new LegacyRecoveryCompletionError(
      'POSTCOMMIT_FAILED', 'Biometric cleanup needs a retry.', true, 'verified', 'unlock-with-new-password',
    ))
    render(<LegacyBiometricMigration />)
    await openCompletionForm()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save new password and upgrade biometrics' })) })

    expect(screen.queryByLabelText('New wallet password')).toBeNull()
    expect(screen.getByText(/The new password is saved\. Unlock the wallet/i)).toBeTruthy()
  })

  it('fails closed for an unknown completion error rather than retaining the form', async () => {
    handlers.complete.mockRejectedValue(new Error('unexpected failure'))
    render(<LegacyBiometricMigration />)
    await openCompletionForm()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save new password and upgrade biometrics' })) })

    expect(screen.queryByLabelText('New wallet password')).toBeNull()
    expect(screen.getByText(/Verify your authenticator again/i)).toBeTruthy()
    expect(handlers.cancel).toHaveBeenCalled()
  })
})
