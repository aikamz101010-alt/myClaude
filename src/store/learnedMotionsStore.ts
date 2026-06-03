import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MotionChannel } from '@/lib/liveAssistant'

/** Motions the live assistant has composed and saved (persisted, reusable). */
interface LearnedMotions {
  motions: Record<string, MotionChannel[]>
  save: (name: string, channels: MotionChannel[]) => string  // returns the slug key used
  remove: (name: string) => void
}

/** Normalize a motion name into a gesture-key (lowercase, hyphenated). */
export function motionSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'motion'
}

export const useLearnedMotions = create<LearnedMotions>()(
  persist(
    set => ({
      motions: {},
      save: (name, channels) => {
        const key = motionSlug(name)
        set(s => ({ motions: { ...s.motions, [key]: channels } }))
        return key
      },
      remove: name => set(s => {
        const m = { ...s.motions }
        delete m[name]
        return { motions: m }
      }),
    }),
    { name: 'claudex-learned-motions' },
  ),
)
