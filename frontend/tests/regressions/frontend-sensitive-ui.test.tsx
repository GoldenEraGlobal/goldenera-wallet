// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mnemonic = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'
const wallet = vi.hoisted(() => ({
  backupWallet: vi.fn(async () => {}),
  backupPhrase: '',
  error: null as string | null,
}))

vi.mock('@project/ui', () => {
  const Container = ({ children }: any) => <div>{children}</div>
  return {
    Alert: Container,
    AlertDescription: Container,
    Button: ({ children, variant: _variant, size: _size, ...props }: any) => <button {...props}>{children}</button>,
    Card: Container,
    CardContent: Container,
    CardDescription: Container,
    CardFooter: Container,
    CardHeader: Container,
    CardTitle: Container,
    Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} {...props} />
    ),
    Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
  }
})
vi.mock('../../packages/core/src/layouts/Layouts', () => ({
  AppLayout: ({ children }: any) => <main>{children}</main>,
  BasicLayout: ({ children }: any) => <main>{children}</main>,
}))
vi.mock('../../packages/core/src/store/WalletStore', () => ({
  useWalletStore: (selector: (state: typeof wallet) => unknown) => selector(wallet),
}))
vi.mock('../../packages/core/src/utils/PrivacyUtil', () => ({ privacyScreen: () => () => undefined }))
vi.mock('../../packages/core/src/components/auth/UnlockCard', () => ({
  UnlockCard: ({ onSuccess }: any) => (
    <button type="button" onClick={() => { void onSuccess({ mnemonic }) }}>
      Authenticate
    </button>
  ),
}))

import { MnemonicGrid } from '../../packages/core/src/components/MnemonicGrid'
import { BackupPhrasePage } from '../../packages/core/src/pages/BackupPhrasePage'
import { ShowPhrasePage } from '../../packages/core/src/pages/ShowPhrasePage'

beforeEach(() => {
  wallet.backupPhrase = mnemonic
  wallet.error = null
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  })
  vi.clearAllMocks()
})

const reveal = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Show', exact: true }))
    await Promise.resolve()
  })
  expect(screen.getByText('alpha')).toBeTruthy()
}

const authenticateAndReveal = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate' }))
    await Promise.resolve()
  })
  await reveal()
}

describe('recovery phrase DOM exposure', () => {
  it('renders placeholders rather than secret words while the grid is hidden', async () => {
    render(<MnemonicGrid mnemonic={mnemonic} />)

    for (const word of mnemonic.split(' ')) expect(screen.queryByText(word)).toBeNull()
    expect(screen.getAllByLabelText(/Recovery word \d+ hidden/)).toHaveLength(12)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reveal Words' }))
    })
    for (const word of mnemonic.split(' ')) expect(screen.getByText(word)).toBeTruthy()
  })

  it('hides the onboarding backup phrase on blur, pagehide, and hidden visibility', async () => {
    render(<BackupPhrasePage params={{}} />)

    await reveal()
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(screen.queryByText('alpha')).toBeNull()

    await reveal()
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    expect(screen.queryByText('alpha')).toBeNull()

    await reveal()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getAllByLabelText(/Recovery word \d+ hidden/)).toHaveLength(12)
  })

  it('clears an authenticated phrase and requires authentication again after exposure loss', async () => {
    render(<ShowPhrasePage params={{}} />)

    await authenticateAndReveal()
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeTruthy()

    await authenticateAndReveal()
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeTruthy()

    await authenticateAndReveal()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByRole('button', { name: 'Authenticate' })).toBeTruthy()
  })
})
