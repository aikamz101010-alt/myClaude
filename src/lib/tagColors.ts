// Shared tag color scheme for skill / agent / plugin.
// Theme-aware: brighter on dark, deeper on light for good contrast.

import { useThemeStore } from '@/store/themeStore'

export type TagType = 'skill' | 'agent' | 'plugin'

const PALETTE: Record<'dark' | 'light', Record<TagType, string>> = {
  dark: {
    skill:  '#22C55E', // green
    agent:  '#3B82F6', // blue
    plugin: '#A855F7', // purple
  },
  light: {
    skill:  '#15803D', // green-700
    agent:  '#1D4ED8', // blue-700
    plugin: '#7E22CE', // purple-700
  },
}

// Static default (dark) — for non-reactive contexts.
export const TAG_COLORS: Record<TagType, string> = PALETTE.dark

function resolveIsLight(theme: string): boolean {
  if (theme === 'light') return true
  if (theme === 'dark') return false
  // system
  return typeof window !== 'undefined'
    && !window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Reactive palette — re-renders when the theme changes. */
export function useTagColors(): Record<TagType, string> {
  const theme = useThemeStore(s => s.theme)
  return resolveIsLight(theme) ? PALETTE.light : PALETTE.dark
}

// Prefix used in the text: skills use "/", agents & plugins use "@"
export function tagPrefix(type: TagType): string {
  return type === 'skill' ? '/' : '@'
}

// Build a name(lowercase) → type classifier from library items
export function buildClassifier(
  items: { name: string; item_type: string }[]
): (name: string) => TagType | null {
  const map = new Map<string, TagType>()
  for (const it of items) {
    const key = it.name.toLowerCase()
    if (it.item_type === 'skill') map.set(key, 'skill')
    else if (it.item_type === 'agent') map.set(key, 'agent')
    else if (it.item_type === 'plugin' || it.item_type === 'mcp') map.set(key, 'plugin')
  }
  return (name: string) => map.get(name.toLowerCase()) ?? null
}
