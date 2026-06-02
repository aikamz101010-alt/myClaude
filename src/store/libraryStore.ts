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
  authStatus: string
  load: () => Promise<void>
  rescan: () => Promise<void>
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  items: [],
  claudeBinary: null,
  authStatus: '',
  load: async () => {
    const [items, claudeBinary, authStatus] = await Promise.all([
      invoke<SkillItem[]>('get_library'),
      invoke<string | null>('get_claude_binary'),
      invoke<string>('get_auth_status'),
    ])
    set({ items, claudeBinary, authStatus })
  },
  rescan: async () => {
    // rescan_library also re-detects the binary as a side effect
    const items = await invoke<SkillItem[]>('rescan_library')
    // Then refresh binary path and auth status in parallel
    const [claudeBinary, authStatus] = await Promise.all([
      invoke<string | null>('get_claude_binary'),
      invoke<string>('get_auth_status'),
    ])
    set({ items, claudeBinary, authStatus })
  },
}))
