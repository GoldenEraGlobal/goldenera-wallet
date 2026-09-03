// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clipboard = vi.hoisted(() => ({ copy: vi.fn() }))

import { DataRow } from '../../packages/core/src/components/DataRow'
import { useCopy } from '../../packages/core/src/hooks/useCopy'
import { ThemeProvider, useTheme } from '../../packages/ui/src/components/theme-provider'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('light', 'dark')
})
beforeEach(() => {
  clipboard.copy.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard.copy },
  })
})

function ThemeProbe() {
  const { theme, setTheme } = useTheme()
  return <button onClick={() => setTheme('dark')}>{theme}</button>
}

function ComputedThemeProbe() {
  const { computedTheme } = useTheme()
  return <span>{computedTheme}</span>
}

function CopyProbe() {
  const { copy, copied, copyFailed } = useCopy()
  return <button onClick={() => { void copy('private-value-that-must-not-be-echoed') }}>
    {copied ? 'copied' : copyFailed ? 'failed' : 'idle'}
  </button>
}

describe('theme storage failures', () => {
  it('reveals the app with the default theme when preference loading fails', async () => {
    const storage = {
      getItem: vi.fn(async () => { throw new Error('storage unavailable') }),
      setItem: vi.fn(async () => {}),
    }
    render(<ThemeProvider storage={storage}><ThemeProbe /></ThemeProvider>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'system' })).toBeTruthy())
  })

  it('ignores invalid stored values and contains persistence rejection', async () => {
    const storage = {
      getItem: vi.fn(async () => 'untrusted-theme-value'),
      setItem: vi.fn(async () => { throw new Error('write failed') }),
    }
    render(<ThemeProvider storage={storage}><ThemeProbe /></ThemeProvider>)
    const button = await screen.findByRole('button', { name: 'system' })
    await act(async () => { fireEvent.click(button); await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'dark' })).toBeTruthy()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('tracks live system-theme changes and removes its listener on unmount', async () => {
    let matches = false
    const listeners = new Set<() => void>()
    const media = {
      get matches() { return matches },
      addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))

    const view = render(<ThemeProvider><ComputedThemeProbe /></ThemeProvider>)
    expect(screen.getByText('light')).toBeTruthy()
    expect(document.documentElement.classList.contains('light')).toBe(true)

    await act(async () => {
      matches = true
      listeners.forEach(listener => listener())
    })
    expect(screen.getByText('dark')).toBeTruthy()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    const registeredListener = media.addEventListener.mock.calls[0]?.[1]
    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', registeredListener)
    expect(listeners.size).toBe(0)
  })
})

describe('copy failure handling', () => {
  it('returns a generic failure state without echoing clipboard content', async () => {
    clipboard.copy.mockRejectedValue(new Error('private-value-that-must-not-be-echoed'))
    render(<CopyProbe />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'idle' }))
      await Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'failed' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('private-value-that-must-not-be-echoed')
  })

  it('announces a consumer copy failure accessibly', async () => {
    clipboard.copy.mockRejectedValue(new Error('clipboard denied'))
    render(<DataRow label="Transaction hash" value="0xpublichash" copyable />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy Transaction hash' }))
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Copy Transaction hash failed' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Copy failed')
    expect(document.body.textContent).not.toContain('clipboard denied')
  })
})
