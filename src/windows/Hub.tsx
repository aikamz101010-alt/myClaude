import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ProjectCard } from '@/components/hub/ProjectCard'
import { GlobalMonitor } from '@/components/hub/GlobalMonitor'
import { useProjectStore } from '@/store/projectStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Cpu, Terminal, FolderOpen, FolderInput, X } from 'lucide-react'
import type { Project } from '@/store/projectStore'

// ── Project Modal (New + Open) ───────────────────────────────────
type ModalMode = 'new' | 'open'

interface ProjectModalProps {
  mode: ModalMode
  onClose: () => void
  onSubmit: (name: string, path: string) => Promise<void>
}

function ProjectModal({ mode, onClose, onSubmit }: ProjectModalProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const isNew = mode === 'new'

  useEffect(() => {
    if (isNew) nameRef.current?.focus()
  }, [isNew])

  // Auto-fill name from folder when path is picked
  const handleBrowse = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false })
      if (typeof selected === 'string' && selected) {
        setPath(selected)
        if (!name.trim()) {
          setName(selected.split('/').pop() ?? '')
        }
      }
    } catch {
      // dialog cancelled — no-op
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Project name is required'); return }
    if (!path.trim()) { setError('Project path is required'); return }
    setError('')
    setLoading(true)
    try {
      await onSubmit(name.trim(), path.trim())
      onClose()
    } catch (err) {
      setError(String(err))
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="glass rounded-2xl w-[440px] p-5 shadow-2xl border border-white/10 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              {isNew
                ? <FolderOpen className="w-3.5 h-3.5 text-accent" />
                : <FolderInput className="w-3.5 h-3.5 text-accent" />}
            </div>
            <h2 className="text-sm font-mono font-bold text-text">
              {isNew ? 'New Project' : 'Open Project'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Folder picker — primary action */}
          <div>
            <label className="text-xs font-mono text-muted block mb-1.5">
              Project Folder
            </label>
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/projects/my-project"
                className={cn(
                  'flex-1 bg-surface2 rounded-xl px-3 py-2.5',
                  'text-sm font-mono text-text placeholder-muted',
                  'focus:outline-none focus:ring-1 focus:ring-accent/50',
                  'transition-all duration-150',
                )}
              />
              <button
                type="button"
                onClick={handleBrowse}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl',
                  'text-xs font-mono text-text bg-surface2 hover:bg-surface',
                  'border border-white/10 hover:border-white/20',
                  'cursor-pointer transition-all duration-150 flex-shrink-0',
                )}
              >
                <FolderOpen className="w-3.5 h-3.5 text-accent" />
                Browse
              </button>
            </div>
            {!isNew && (
              <p className="text-xs text-muted/60 font-mono mt-1.5">
                Select an existing folder — CONTRACT.md will be added if missing.
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label className="text-xs font-mono text-muted block mb-1.5">
              Project Name
            </label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path ? path.split('/').pop() : 'My Project'}
              className={cn(
                'w-full bg-surface2 rounded-xl px-3 py-2.5',
                'text-sm font-mono text-text placeholder-muted',
                'focus:outline-none focus:ring-1 focus:ring-accent/50',
                'transition-all duration-150',
              )}
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-error font-mono bg-error/10 px-3 py-2 rounded-lg border border-error/20">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-mono bg-surface2 text-muted hover:text-text cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !path.trim()}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-mono font-semibold',
                'cursor-pointer transition-all duration-200 glow-accent',
                'bg-accent text-bg hover:bg-accent/90',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {loading ? 'Loading...' : isNew ? 'Create Project' : 'Open Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
// ────────────────────────────────────────────────────────────────

interface HubProps {
  onOpenProject: (project: Project) => void
}

export function Hub({ onOpenProject }: HubProps) {
  const { projects, load: loadProjects, create, remove } = useProjectStore()
  const { claudeBinary, load: loadLibrary, rescan } = useLibraryStore()
  const { statuses } = useAgentStore()
  const [scanning, setScanning] = useState(false)
  const [modal, setModal] = useState<'new' | 'open' | null>(null)

  useEffect(() => {
    loadProjects()
    loadLibrary()
  }, [])

  const handleSubmit = async (name: string, path: string) => {
    await create(name, path)
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
            onClick={() => setModal('open')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono text-muted hover:text-text cursor-pointer transition-colors hover:bg-surface2/50"
            title="Open existing project"
          >
            <FolderInput className="w-3.5 h-3.5" />
            Open
          </button>
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
              onClick={() => setModal('new')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
                'text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
                'bg-accent text-bg hover:bg-accent/90 glow-accent',
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              New Project
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
                  onOpen={() => onOpenProject(p)}
                  onDelete={() => remove(p.id)}
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

      {/* Modals */}
      {modal && (
        <ProjectModal
          mode={modal}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

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
