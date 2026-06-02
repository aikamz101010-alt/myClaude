import { useEffect, useState } from 'react'
import { ProjectCard } from '@/components/hub/ProjectCard'
import { GlobalMonitor } from '@/components/hub/GlobalMonitor'
import { useProjectStore } from '@/store/projectStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Cpu, Terminal } from 'lucide-react'

export function Hub() {
  const { projects, load: loadProjects, create, remove } = useProjectStore()
  const { claudeBinary, load: loadLibrary, rescan } = useLibraryStore()
  const { statuses } = useAgentStore()
  const [scanning, setScanning] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadProjects()
    loadLibrary()
  }, [])

  const handleNewProject = async () => {
    // Simple prompt-based creation (no native dialog yet)
    const name = prompt('Project name:')
    if (!name?.trim()) return
    const path = prompt('Project folder path (absolute):')
    if (!path?.trim()) return
    setCreating(true)
    try {
      await create(name.trim(), path.trim())
    } finally {
      setCreating(false)
    }
  }

  const handleRescan = async () => {
    setScanning(true)
    await rescan()
    setScanning(false)
  }

  // Build agent rows from store statuses
  const agentRows = Object.entries(statuses).map(([id, status]) => ({
    id,
    projectName: projects.find((p) => p.id === id)?.name ?? id,
    status,
    tokensIn: 0,
    tokensOut: 0,
    runtimeSecs: 0,
  }))

  const getAgentCount = (projectId: string) =>
    statuses[projectId] === 'running' ? 1 : 0

  return (
    <div className="flex flex-col h-screen bg-bg select-none overflow-hidden">
      {/* Titlebar */}
      <div
        className="titlebar-drag flex items-center justify-between px-4 border-b border-white/5"
        style={{ height: 40 }}
        data-tauri-drag-region
      >
        {/* Traffic lights space (macOS puts them at ~70px) */}
        <div className="titlebar-no-drag flex items-center gap-3" style={{ marginLeft: 72 }}>
          <Terminal className="w-4 h-4 text-accent" />
          <span className="font-mono text-sm font-bold text-text">Claude Desktop</span>
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-muted" />
            <span className="text-xs text-muted font-mono">
              {claudeBinary ? 'CLI ready' : 'CLI not detected'}
            </span>
            {claudeBinary && (
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            )}
          </div>
        </div>

        <div className="titlebar-no-drag flex items-center gap-1">
          <button
            onClick={handleRescan}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
            title="Re-scan library"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', scanning && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Projects grid — scrollable */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-sm font-mono font-bold text-text">
              Projects
              <span className="ml-2 text-muted font-normal">({projects.length})</span>
            </h1>
            <button
              onClick={handleNewProject}
              disabled={creating}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
                'bg-accent text-bg hover:bg-accent/90 glow-accent',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {creating ? 'Creating...' : 'New Project'}
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center border border-white/5">
                <Plus className="w-6 h-6 text-muted" />
              </div>
              <p className="text-sm text-muted font-mono text-center">
                No projects yet.
                <br />
                <span className="text-accent">Create your first project</span> to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  agentCount={getAgentCount(p.id)}
                  onOpen={() => alert(`Open project: ${p.name}\n(Project windows in Phase 6)`)}
                  onDelete={() => {
                    if (confirm(`Delete "${p.name}"?`)) remove(p.id)
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Global Monitor (fixed width) */}
        <div className="w-72 flex-shrink-0">
          <GlobalMonitor agents={agentRows} />
        </div>
      </div>

      {/* Footer stats bar */}
      <div className="border-t border-white/5 px-4 py-2 flex items-center gap-4">
        <span className="text-xs font-mono text-muted">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <span className="text-xs font-mono text-muted">·</span>
        <span className="text-xs font-mono text-muted">
          {agentRows.filter((a) => a.status === 'running').length} agents running
        </span>
        {claudeBinary && (
          <>
            <span className="text-xs font-mono text-muted">·</span>
            <span className="text-xs font-mono text-muted truncate max-w-48">{claudeBinary}</span>
          </>
        )}
      </div>
    </div>
  )
}
