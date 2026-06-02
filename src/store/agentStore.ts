import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface AgentStore {
  outputs: Record<string, string[]>
  statuses: Record<string, 'running' | 'idle' | 'error'>
  spawnAgent: (projectId: string, workingDir: string) => Promise<void>
  sendMessage: (projectId: string, msg: string) => Promise<void>
  stopAgent: (projectId: string) => Promise<void>
  subscribeOutput: (projectId: string) => () => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  outputs: {},
  statuses: {},
  spawnAgent: async (projectId, workingDir) => {
    await invoke('spawn_agent', { projectId, workingDir })
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'running' as const } }))
  },
  sendMessage: async (projectId, message) => {
    await invoke('send_to_agent', { projectId, message })
  },
  stopAgent: async (projectId) => {
    await invoke('stop_agent', { projectId })
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'idle' as const } }))
  },
  subscribeOutput: (projectId) => {
    let unlisten: (() => void) | null = null
    listen<string>(`agent:output:${projectId}`, (event) => {
      set((s) => ({
        outputs: {
          ...s.outputs,
          [projectId]: [...(s.outputs[projectId] ?? []), event.payload].slice(-1000),
        },
      }))
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  },
}))
