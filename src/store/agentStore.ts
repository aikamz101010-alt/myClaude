import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface AgentStore {
  outputs: Record<string, string[]>
  statuses: Record<string, 'running' | 'idle' | 'error'>
  // One-shot chat via claude --print (no "Start" needed)
  chat: (projectId: string, message: string, workingDir: string) => Promise<void>
  // Persistent agent session (for terminal view)
  spawnAgent: (projectId: string, workingDir: string) => Promise<void>
  stopAgent: (projectId: string) => Promise<void>
  sendToAgent: (projectId: string, message: string) => Promise<void>
  clearOutput: (projectId: string) => void
  subscribeOutput: (projectId: string) => () => void
}

export const useAgentStore = create<AgentStore>((set) => ({
  outputs: {},
  statuses: {},

  chat: async (projectId, message, workingDir) => {
    // Optimistically set running — backend will emit status events too
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'running' } }))
    try {
      await invoke('chat_message', { projectId, message, workingDir })
    } catch (err) {
      // Append error to output
      set((s) => ({
        outputs: {
          ...s.outputs,
          [projectId]: [...(s.outputs[projectId] ?? []), `\n[Error] ${String(err)}`],
        },
        statuses: { ...s.statuses, [projectId]: 'error' },
      }))
      return
    }
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'idle' } }))
  },

  spawnAgent: async (projectId, workingDir) => {
    await invoke('spawn_agent', { projectId, workingDir })
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'running' } }))
  },

  stopAgent: async (projectId) => {
    await invoke('stop_agent', { projectId })
    set((s) => ({ statuses: { ...s.statuses, [projectId]: 'idle' } }))
  },

  sendToAgent: async (projectId, message) => {
    await invoke('send_to_agent', { projectId, message })
  },

  clearOutput: (projectId) => {
    set((s) => ({ outputs: { ...s.outputs, [projectId]: [] } }))
  },

  subscribeOutput: (projectId) => {
    const unlisteners: Array<() => void> = []

    // Subscribe to output lines
    listen<string>(`agent:output:${projectId}`, (event) => {
      set((s) => ({
        outputs: {
          ...s.outputs,
          [projectId]: [...(s.outputs[projectId] ?? []), event.payload].slice(-2000),
        },
      }))
    }).then((fn) => unlisteners.push(fn))

    // Subscribe to status changes from backend
    listen<string>(`agent:status:${projectId}`, (event) => {
      const status = event.payload as 'running' | 'idle' | 'error'
      set((s) => ({ statuses: { ...s.statuses, [projectId]: status } }))
    }).then((fn) => unlisteners.push(fn))

    return () => { unlisteners.forEach((fn) => fn()) }
  },
}))
