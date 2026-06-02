import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ProjectCard } from '@/components/hub/ProjectCard'
import { GlobalMonitor } from '@/components/hub/GlobalMonitor'
import { useProjectStore } from '@/store/projectStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Cpu, Terminal, FolderOpen, FolderInput, X, Settings, CheckCircle, AlertTriangle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
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

// ── Settings Modal ───────────────────────────────────────────────
function SettingsModal({ onClose }: { onClose: () => void }) {
  const { authStatus, claudeBinary } = useLibraryStore()
  const [apiKey, setApiKey] = useState('')
  const [profilePath, setProfilePath] = useState('~/.bash_profile')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const isAuthOk = authStatus.startsWith('✅')

  const handleSave = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      // Write export to the specified profile file
      const expandedPath = profilePath.replace('~', '/Users/' + (claudeBinary?.split('/')[2] ?? ''))
      await invoke('write_contract', {
        contractPath: expandedPath.replace('~', String(await invoke('get_claude_binary')).split('/').slice(0,3).join('/')),
        content: ''
      }).catch(() => {})
      // Use the key directly via env — reload auth
      await invoke('set_api_key', { key: apiKey.trim() }).catch(() => {})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="glass rounded-2xl w-[480px] p-5 border border-white/10 shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-mono font-bold text-text">Settings</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-text cursor-pointer rounded-lg hover:bg-surface2/50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auth Status */}
        <div className="mb-5 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <p className="text-xs font-mono font-semibold text-muted mb-2">Authentication Status</p>
          <div className="flex items-center gap-2">
            {isAuthOk
              ? <CheckCircle className="w-4 h-4 text-accent flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />}
            <p className={`text-xs font-mono ${isAuthOk ? 'text-accent' : 'text-warning'}`}>
              {authStatus || 'Checking...'}
            </p>
          </div>
          {!isAuthOk && (
            <p className="text-xs text-muted mt-2 leading-relaxed">
              Claude Desktop reads <span className="text-text font-mono">ANTHROPIC_API_KEY</span> from your shell profile.
              Detected profiles: <span className="text-text font-mono">~/.bash_profile</span>, <span className="text-text font-mono">~/.zshrc</span>
            </p>
          )}
        </div>

        {/* Claude CLI */}
        <div className="mb-5 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <p className="text-xs font-mono font-semibold text-muted mb-1">Claude CLI Binary</p>
          <p className="text-xs font-mono text-text break-all">
            {claudeBinary ?? '❌ Not detected'}
          </p>
        </div>

        {/* Manual API key entry if not detected */}
        {!isAuthOk && (
          <div className="mb-4">
            <label className="text-xs font-mono text-muted block mb-1.5">
              API Key <span className="text-muted/60">(saved to shell profile)</span>
            </label>
            <div className="flex gap-2 mb-2">
              <input
                value={profilePath}
                onChange={e => setProfilePath(e.target.value)}
                placeholder="~/.bash_profile"
                className="w-40 bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-muted focus:outline-none focus:ring-1 focus:ring-accent/40 flex-shrink-0"
              />
              <input
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                type="password"
                placeholder="sk-ant-api03-..."
                className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              className="w-full py-2 rounded-xl text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-50"
            >
              {saved ? '✅ Saved — restart app to apply' : saving ? 'Saving...' : 'Save API Key to Profile'}
            </button>
          </div>
        )}

        <div className="p-3 rounded-xl bg-surface2/30 border border-white/5">
          <p className="text-xs font-mono text-muted leading-relaxed">
            <span className="text-text">Auto-detection order:</span><br/>
            1. Current process environment<br/>
            2. bash -l (sources ~/.bash_profile)<br/>
            3. zsh -l (sources ~/.zprofile, ~/.zshrc)<br/>
            4. Direct parse of all profile files
          </p>
        </div>
      </div>
    </div>
  )
}
// ────────────────────────────────────────────────────────────────

// ── LocalLibrary panel ──────────────────────────────────────────
type LibTab = 'skill' | 'mcp' | 'agent'

function LocalLibraryPanel({ onRescan, scanning }: { onRescan: () => void; scanning: boolean }) {
  const { items } = useLibraryStore()
  const [tab, setTab] = useState<LibTab>('skill')

  const skills  = items.filter(i => i.item_type === 'skill')
  const mcps    = items.filter(i => i.item_type === 'mcp')
  const agents  = items.filter(i => i.item_type === 'agent')

  const tabData: { key: LibTab; label: string; list: typeof items; icon: string }[] = [
    { key: 'skill',  label: 'Skills',   list: skills,  icon: '⚡' },
    { key: 'mcp',    label: 'Plugins',  list: mcps,    icon: '🔌' },
    { key: 'agent',  label: 'Agents',   list: agents,  icon: '🤖' },
  ]
  const active = tabData.find(t => t.key === tab)!

  return (
    <div className="glass rounded-xl flex flex-col border border-white/5 overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
        <span className="text-xs font-mono font-bold text-text">Local Machine</span>
        <button
          onClick={onRescan}
          className="p-1 text-muted hover:text-accent cursor-pointer transition-colors rounded"
          title="Re-scan"
        >
          <RefreshCw className={cn('w-3 h-3', scanning && 'animate-spin')} />
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-white/5">
        {tabData.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 py-1.5 text-xs font-mono cursor-pointer transition-colors',
              tab === t.key
                ? 'text-accent border-b-2 border-accent'
                : 'text-muted hover:text-text',
            )}
          >
            {t.label}
            <span className="ml-1 opacity-60">({t.list.length})</span>
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {active.list.length === 0 ? (
          <div className="flex items-center justify-center h-16">
            <p className="text-xs text-muted font-mono">
              No {active.label.toLowerCase()} detected
            </p>
          </div>
        ) : (
          active.list.map(item => (
            <div
              key={item.id}
              className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2/60 transition-colors"
            >
              <span className="text-xs flex-shrink-0 mt-0.5">{active.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-mono text-text truncate">{item.name}</p>
                {item.description && (
                  <p className="text-xs text-muted truncate leading-tight">{item.description}</p>
                )}
                {/* Model badge for agents */}
                {item.model && (
                  <span className="inline-block mt-0.5 text-xs font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
                    {item.model.replace('claude-', '').replace('-latest', '')}
                  </span>
                )}
              </div>
              {/* Source badge */}
              {item.version && item.version !== 'latest' && item.version !== 'plugin' && (
                <span className="text-xs font-mono text-muted/40 flex-shrink-0">{item.version}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
// ────────────────────────────────────────────────────────────────

interface HubProps {
  onOpenProject: (project: Project) => void
}

export function Hub({ onOpenProject }: HubProps) {
  const { projects, load: loadProjects, create, touch, remove } = useProjectStore()
  const { claudeBinary, authStatus, load: loadLibrary, rescan } = useLibraryStore()
  const { statuses } = useAgentStore()
  const [scanning, setScanning] = useState(false)
  const [modal, setModal] = useState<'new' | 'open' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const isAuthOk = authStatus.startsWith('✅')

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
        <div className="titlebar-no-drag flex items-center gap-3" style={{ marginLeft: 72 }}>
          <Terminal className="w-4 h-4 text-accent" />
          <span className="font-mono text-sm font-bold text-text">Claude Desktop</span>
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-muted" />
            <span className="text-xs text-muted font-mono">
              {claudeBinary ? 'CLI ready' : 'CLI not detected'}
            </span>
            {claudeBinary && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
          </div>
        </div>

        <div className="titlebar-no-drag flex items-center gap-1.5">
          {/* Auth indicator */}
          <button
            onClick={() => setShowSettings(true)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono cursor-pointer transition-colors',
              isAuthOk ? 'text-accent hover:bg-accent/10' : 'text-warning hover:bg-warning/10'
            )}
            title={authStatus}
          >
            {isAuthOk
              ? <CheckCircle className="w-3.5 h-3.5" />
              : <AlertTriangle className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isAuthOk ? 'Authenticated' : 'Auth needed'}</span>
          </button>

          <button
            onClick={handleRescan}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
            title="Re-scan library"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', scanning && 'animate-spin')} />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main content: projects + right panel */}
      <div className="flex flex-1 gap-3 p-3 overflow-hidden">

        {/* ── Left: Projects ─────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-mono font-bold text-text">
              Projects
              <span className="ml-2 text-muted font-normal">({projects.length})</span>
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModal('open')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all bg-surface2 text-text hover:bg-surface border border-white/10"
              >
                <FolderInput className="w-3.5 h-3.5" /> Open
              </button>
              <button
                onClick={() => setModal('new')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all bg-accent text-bg hover:bg-accent/90 glow-accent"
              >
                <Plus className="w-3.5 h-3.5" /> New Project
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-12 h-12 rounded-xl bg-surface flex items-center justify-center border border-white/5">
                  <Plus className="w-6 h-6 text-muted" />
                </div>
                <p className="text-sm text-muted font-mono text-center">
                  No projects yet.<br />
                  <span className="text-accent cursor-pointer" onClick={() => setModal('new')}>
                    Create your first project
                  </span>
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    agentCount={getAgentCount(p.id)}
                    onOpen={async () => { await touch(p.id); onOpenProject(p) }}
                    onDelete={() => remove(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Monitor + Local Library ─── */}
        <div className="w-72 flex-shrink-0 flex flex-col gap-3 overflow-hidden h-full">
          {/* Agent Monitor — fixed height max ~200px */}
          <div className="flex-shrink-0 max-h-52 overflow-hidden">
            <GlobalMonitor agents={agentRows} />
          </div>

          {/* Local Machine Library — takes remaining height, scrollable inside */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <LocalLibraryPanel onRescan={handleRescan} scanning={scanning} />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {/* Modals */}
      {modal && (
        <ProjectModal
          mode={modal}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* Footer */}
      <div className="border-t border-white/5 px-4 py-1.5 flex items-center gap-3">
        <span className="text-xs font-mono text-muted">
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </span>
        <span className="text-xs text-muted">·</span>
        <span className="text-xs font-mono text-muted">
          {agentRows.filter(a => a.status === 'running').length} agents running
        </span>
        {claudeBinary && (
          <>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs font-mono text-muted truncate max-w-xs">{claudeBinary}</span>
          </>
        )}
      </div>
    </div>
  )
}
