import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface Project {
  id: string
  name: string
  path: string
  contract_path: string
}

interface ProjectStore {
  projects: Project[]
  load: () => Promise<void>
  create: (name: string, path: string) => Promise<Project>
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
    set((s) => ({ projects: [...s.projects, project] }))
    return project
  },
  remove: async (id) => {
    await invoke('delete_project', { id })
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
  },
}))
