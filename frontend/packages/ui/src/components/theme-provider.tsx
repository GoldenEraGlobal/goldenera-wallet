import { createContext, useContext, useEffect, useState } from 'react'

export const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export type Theme = 'dark' | 'light' | 'system'

export interface ThemeStorage {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  storage?: ThemeStorage
}

type ThemeProviderState = {
  theme: Theme
  computedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

const isTheme = (value: unknown): value is Theme =>
  value === 'dark' || value === 'light' || value === 'system'

const initialState: ThemeProviderState = {
  theme: 'system',
  computedTheme: getSystemTheme(),
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'ui-theme',
  storage,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [computedTheme, setComputedTheme] = useState<'light' | 'dark'>(getSystemTheme())
  const [isLoaded, setIsLoaded] = useState(!storage)

  useEffect(() => {
    let active = true
    if (!storage) {
      setIsLoaded(true)
      return () => { active = false }
    }

    setIsLoaded(false)
    void (async () => {
      try {
        const savedTheme = await storage.getItem(storageKey)
        if (active && isTheme(savedTheme)) {
          setThemeState(savedTheme)
        }
      } catch {
        // Theme storage is optional. A failed preference read must not hide the app.
      } finally {
        if (active) setIsLoaded(true)
      }
    })()

    return () => { active = false }
  }, [storage, storageKey])

  useEffect(() => {
    if (!isLoaded) return

    const root = window.document.documentElement
    const media = theme === 'system' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
    const applyTheme = () => {
      const nextTheme = theme === 'system'
        ? media?.matches ? 'dark' : 'light'
        : theme
      root.classList.remove('light', 'dark')
      root.classList.add(nextTheme)
      setComputedTheme(nextTheme)
    }

    applyTheme()
    if (!media) return

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', applyTheme)
      return () => media.removeEventListener('change', applyTheme)
    }

    // Safari versions used by older cached PWAs expose only the legacy API.
    media.addListener?.(applyTheme)
    return () => media.removeListener?.(applyTheme)
  }, [theme, isLoaded])

  const value = {
    theme,
    setTheme: (nextTheme: Theme) => {
      setThemeState(nextTheme)
      if (storage) {
        void storage.setItem(storageKey, nextTheme).catch(() => {
          // Keep the in-memory preference usable even when persistence is unavailable.
        })
      }
    },
    computedTheme,
  }

  if (!isLoaded) {
    return <div style={{ visibility: 'hidden' }}>{children}</div>
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
