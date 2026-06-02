import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface SkillItem {
  id: string
  name: string
  description: string
  version: string
  source_path: string
  item_type: string // 'skill' | 'agent' | 'mcp'
  model: string     // e.g. 'claude-sonnet-4-6' for agents
}

interface LibraryStore {
  items: SkillItem[]
  claudeBinary: string | null
  load: () => Promise<void>
  rescan: () => Promise<void>
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  items: [],
  claudeBinary: null,
  load: async () => {
    const [items, claudeBinary] = await Promise.all([
      invoke<SkillItem[]>('get_library'),
      invoke<string | null>('get_claude_binary'),
    ])
    set({ items, claudeBinary })
  },
  rescan: async () => {
    const items = await invoke<SkillItem[]>('rescan_library')
    set({ items })
  },
}))
