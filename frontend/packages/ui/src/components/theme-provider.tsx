
import { createContext, useContext, useEffect, useState } from "react"

export const getSystemTheme = (): 'light' | 'dark' => {
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
    .matches
    ? "dark"
    : "light"

  return systemTheme
}

export type Theme = "dark" | "light" | "system"

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

const initialState: ThemeProviderState = {
  theme: "system",
  computedTheme: getSystemTheme(),
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "ui-theme",
  storage,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [computedTheme, setComputedTheme] = useState<'light' | 'dark'>(getSystemTheme())
  const [isLoaded, setIsLoaded] = useState(!storage)

  useEffect(() => {
    if (storage) {
      console.log('Loading theme from storage')
      storage.getItem(storageKey).then((savedTheme) => {
        if (savedTheme) {
          setTheme(savedTheme as Theme)
        }
        setIsLoaded(true)
      })
    }
  }, [storage, storageKey])

  useEffect(() => {
    if (!isLoaded) return

    const root = window.document.documentElement
    root.classList.remove("light", "dark")

    if (theme === "system") {
      root.classList.add(getSystemTheme())
      setComputedTheme(getSystemTheme())
      return
    }

    root.classList.add(theme)
    setComputedTheme(theme)
  }, [theme, isLoaded])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      if (storage) {
        storage.setItem(storageKey, theme)
      }
      setTheme(theme)
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
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}