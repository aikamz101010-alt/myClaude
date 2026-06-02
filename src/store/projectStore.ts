import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface Project {
  id: string
  name: string
  path: string
  contract_path: string
  created_at: number   // unix secs
  last_opened: number  // unix secs, 0 = never opened
}

interface ProjectStore {
  projects: Project[]
  load: () => Promise<void>
  create: (name: string, path: string) => Promise<Project>
  touch: (id: string) => Promise<Project>
  remove: (id: string) => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],

  load: async () => {
    const projects = await invoke<Project[]>('get_projects')
    set({ projects })
  },

  create: async (name, path) => {
    const project = await invoke<Project>('create_project', { name, path })
    // New project goes to top
    set((s) => ({ projects: [project, ...s.projects] }))
    return project
  },

  touch: async (id) => {
    const updated = await invoke<Project>('touch_project', { id })
    // Move to top + update timestamp
    set((s) => ({
      projects: [updated, ...s.projects.filter((p) => p.id !== id)],
    }))
    return updated
  },

  remove: async (id) => {
    await invoke('delete_project', { id })
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
  },
}))
