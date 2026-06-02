import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'

interface ThemeStore {
  theme: Theme
  setTheme: (t: Theme) => void
}

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')

  if (theme === 'system') {
    root.classList.add(getSystemDark() ? 'theme-dark' : 'theme-light')
  } else {
    root.classList.add(`theme-${theme}`)
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
    }),
    { name: 'claude-desktop-theme' }
  )
)
