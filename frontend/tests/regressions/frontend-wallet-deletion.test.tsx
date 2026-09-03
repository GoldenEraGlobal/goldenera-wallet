// @vitest-environment jsdom
import React, { forwardRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flow = vi.hoisted(() => ({
  pop: vi.fn(),
  push: vi.fn(),
}))
const wallet = vi.hoisted(() => ({
  backupPhrase: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
  resetWallet: vi.fn(async (_password: string) => undefined),
  unlockWithPassword: vi.fn(async (_password: string) => false),
  unlockWithBiometric: vi.fn(async () => ({ password: '', mnemonic: '' })),
  biometric: { type: 'none' as const, enabled: true, available: true, legacy: false },
}))

vi.mock('@project/ui', () => {
  type ContainerProps = React.HTMLAttributes<HTMLDivElement>
  type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }
  type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onCheckedChange?: (checked: boolean) => void
  }
  const Container = ({ children, ...props }: ContainerProps) => <div {...props}>{children}</div>
  const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} type="password" {...props} />,
  )
  PasswordInput.displayName = 'PasswordInput'
  return {
    Alert: Container,
    AlertDescription: Container,
    Button: ({ children, variant: _variant, size: _size, ...props }: ButtonProps) => <button {...props}>{children}</button>,
    Card: Container,
    CardContent: Container,
    CardDescription: Container,
    CardFooter: Container,
    CardHeader: Container,
    CardTitle: Container,
    cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' '),
    Checkbox: ({ checked, onCheckedChange, ...props }: CheckboxProps) => (
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onCheckedChange?.(event.target.checked)}
        {...props}
      />
    ),
    Field: Container,
    FieldError: Container,
    FieldLabel: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
    Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
    PasswordInput,
    Spinner: () => <span>Loading</span>,
  }
})
vi.mock('../../packages/core/src/layouts/Layouts', () => ({
  AppLayout: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
}))
vi.mock('../../packages/core/src/router/useFlow', () => ({
  useFlow: () => flow,
}))
vi.mock('../../packages/core/src/store/WalletStore', () => ({
  useWalletStore: (selector: (state: typeof wallet) => unknown) => selector(wallet),
}))

import { DeleteWalletPage } from '../../packages/core/src/pages/DeleteWalletPage'
import { UnlockCard } from '../../packages/core/src/components/auth/UnlockCard'
import { WalletResetBarrierError } from '../../packages/core/src/services/WalletResetBarrierService'
import { WalletVaultCorruptionError } from '../../packages/core/src/services/WalletVaultService'

beforeEach(() => {
  wallet.resetWallet.mockReset().mockResolvedValue(undefined)
  wallet.unlockWithPassword.mockReset().mockResolvedValue(false)
  wallet.unlockWithBiometric.mockReset().mockResolvedValue({ password: '', mnemonic: '' })
  flow.pop.mockReset()
  flow.push.mockReset()
})

afterEach(() => cleanup())

describe('wallet deletion confirmation', () => {
  it('uses distinct acknowledgement controls and opens the authenticated phrase screen', () => {
    render(<DeleteWalletPage params={{}} />)

    const backedUp = screen.getByRole('checkbox', { name: /I have backed up my 12-word recovery phrase/i })
    const understandsRisk = screen.getByRole('checkbox', { name: /I understand that without my recovery phrase/i })
    expect(backedUp.id).toBe('recovery-phrase-backed-up')
    expect(understandsRisk.id).toBe('deletion-risk-understood')
    expect(backedUp.id).not.toBe(understandsRisk.id)
    expect(screen.getByText(/Non-secret transaction recovery records may remain/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View Recovery Phrase First' }))
    expect(flow.push).toHaveBeenCalledWith('ShowPhrasePage', {})
    expect(flow.pop).not.toHaveBeenCalled()
    for (const word of wallet.backupPhrase.split(' ')) expect(screen.queryByText(word)).toBeNull()
  })

  it('passes the entered password to the authoritative reset action', async () => {
    render(<DeleteWalletPage params={{}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /I have backed up my 12-word recovery phrase/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand that without my recovery phrase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Deletion' }))

    const passwordInput = screen.getByPlaceholderText('Enter your password')
    fireEvent.change(passwordInput, { target: { value: 'PUBLIC-Deletion-Password-123!' } })
    const deleteButton = screen.getByRole('button', { name: 'Delete Wallet Permanently' })
    await waitFor(() => expect(deleteButton.hasAttribute('disabled')).toBe(false))
    await act(async () => fireEvent.click(deleteButton))

    await waitFor(() => expect(wallet.resetWallet).toHaveBeenCalledWith('PUBLIC-Deletion-Password-123!'))
  })

  it('tells the user to close stale PWA windows when the update gate fails', async () => {
    wallet.resetWallet.mockRejectedValue(new WalletResetBarrierError('2 open wallet windows could not be updated. Close other wallet tabs and retry.'))
    render(<DeleteWalletPage params={{}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /I have backed up my 12-word recovery phrase/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand that without my recovery phrase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Deletion' }))
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'PUBLIC-Deletion-Password-123!' } })
    const deleteButton = screen.getByRole('button', { name: 'Delete Wallet Permanently' })
    await waitFor(() => expect(deleteButton.hasAttribute('disabled')).toBe(false))
    await act(async () => fireEvent.click(deleteButton))

    await waitFor(() => expect(screen.getByText('2 open wallet windows could not be updated. Close other wallet tabs and retry.')).toBeTruthy())
  })

  it('shows vault corruption recovery guidance instead of an incorrect-password error', async () => {
    const corruption = new WalletVaultCorruptionError()
    wallet.resetWallet.mockRejectedValue(corruption)
    render(<DeleteWalletPage params={{}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /I have backed up my 12-word recovery phrase/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand that without my recovery phrase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Deletion' }))
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'PUBLIC-Deletion-Password-123!' } })
    const deleteButton = screen.getByRole('button', { name: 'Delete Wallet Permanently' })
    await waitFor(() => expect(deleteButton.hasAttribute('disabled')).toBe(false))
    await act(async () => fireEvent.click(deleteButton))

    await waitFor(() => expect(screen.getByText(corruption.message)).toBeTruthy())
    expect(screen.queryByText('Incorrect password')).toBeNull()
  })
})

describe('unlock corruption messaging', () => {
  it('shows typed vault recovery guidance after biometric unlock finds corrupted storage', async () => {
    const corruption = new WalletVaultCorruptionError()
    wallet.unlockWithBiometric.mockRejectedValue(corruption)
    render(<UnlockCard onSuccess={async () => undefined} />)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use Biometrics' })))

    await waitFor(() => expect(screen.getByText(corruption.message)).toBeTruthy())
    expect(screen.queryByText('Biometric authentication failed. Use your password.')).toBeNull()
  })
})
