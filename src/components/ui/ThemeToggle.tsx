import { Moon, Sun, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useThemeStore, type Theme } from '@/store/themeStore'

const OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
  { value: 'dark',   icon: Moon,    label: 'Dark'   },
  { value: 'light',  icon: Sun,     label: 'Light'  },
  { value: 'system', icon: Monitor, label: 'System' },
]

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="flex items-center gap-0.5 bg-surface2/60 rounded-lg p-0.5">
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          className={cn(
            'p-1.5 rounded cursor-pointer transition-all duration-150',
            theme === value
              ? 'bg-accent/15 text-accent'
              : 'text-muted hover:text-text',
          )}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  )
}
