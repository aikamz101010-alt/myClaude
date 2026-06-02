import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ProjectCard } from '@/components/hub/ProjectCard'
import { GlobalMonitor } from '@/components/hub/GlobalMonitor'
import { useProjectStore } from '@/store/projectStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useAgentStore } from '@/store/agentStore'
import { useSessionStore } from '@/store/sessionStore'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Cpu, Terminal, FolderOpen, FolderInput, X, Settings, CheckCircle, AlertTriangle, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { Project } from '@/store/projectStore'
import type { SkillItem } from '@/store/libraryStore'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { InstallModal } from '@/components/library/InstallModal'
import { useTagColors, type TagType } from '@/lib/tagColors'

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
const PROFILE_PRESETS = [
  '~/.bash_profile',
  '~/.bashrc',
  '~/.zshrc',
  '~/.zprofile',
  '~/.profile',
]

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { authStatus, claudeBinary: claudeBinaryForDisplay, load: reloadLibrary } = useLibraryStore()
  const isAuthOk = authStatus.startsWith('✅')

  // Auth location state
  const [editingLocation, setEditingLocation] = useState(false)
  const [profilePath, setProfilePath] = useState('~/.bash_profile')
  const [showPresets, setShowPresets] = useState(false)

  // API key state
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [reloading, setReloading] = useState(false)

  const setFeedbackTemp = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 3000)
  }

  // Save API key → set in runtime + append to profile file
  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    setSaving(true)
    try {
      // 1. Apply immediately for this session
      await invoke('set_api_key', { key: apiKey.trim() })

      // 2. Append export line to profile file (backend expands ~ automatically)
      const existing = await invoke<string>('read_contract', { contractPath: profilePath }).catch(() => '')
      const exportLine = `\nexport ANTHROPIC_API_KEY="${apiKey.trim()}"\n`
      if (!existing.includes(apiKey.trim())) {
        await invoke('write_contract', {
          contractPath: profilePath,
          content: existing + exportLine,
        })
      }

      setFeedbackTemp('✅ Key saved — active immediately, persisted to profile')
      setApiKey('')
      await reloadLibrary()
    } catch (e) {
      setFeedbackTemp(`❌ ${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  // Re-scan environment to pick up any changes
  const handleReload = async () => {
    setReloading(true)
    await reloadLibrary()
    setReloading(false)
    setFeedbackTemp('🔄 Auth re-checked')
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass rounded-2xl w-[500px] p-5 border border-white/10 shadow-2xl animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-mono font-bold text-text">Settings</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-text cursor-pointer rounded-lg hover:bg-surface2/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Auth Status ─────────────────────────── */}
        <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono font-semibold text-muted">Authentication</p>
            <button
              onClick={handleReload}
              className="flex items-center gap-1 text-xs font-mono text-muted hover:text-accent cursor-pointer transition-colors"
            >
              <RefreshCw className={cn('w-3 h-3', reloading && 'animate-spin')} />
              Re-check
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isAuthOk
              ? <CheckCircle className="w-4 h-4 text-accent flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />}
            <p className={cn('text-xs font-mono', isAuthOk ? 'text-accent' : 'text-warning')}>
              {authStatus || 'Checking...'}
            </p>
          </div>
        </div>

        {/* ── Auth Location ───────────────────────── */}
        <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono font-semibold text-muted">Auth Location</p>
            <button
              onClick={() => { setEditingLocation(e => !e); setShowPresets(false) }}
              className="flex items-center gap-1 text-xs font-mono text-accent hover:text-accent/80 cursor-pointer transition-colors"
            >
              {editingLocation ? 'Done' : 'Edit'}
            </button>
          </div>

          {!editingLocation ? (
            <p className="text-xs font-mono text-text">{profilePath}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={profilePath}
                  onChange={e => setProfilePath(e.target.value)}
                  placeholder="~/.bash_profile"
                  className="flex-1 bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
                  autoFocus
                />
                <button
                  onClick={() => setShowPresets(p => !p)}
                  className="px-2 py-1.5 bg-surface rounded-lg text-xs font-mono text-muted hover:text-text cursor-pointer border border-white/10 transition-colors"
                >
                  Presets
                </button>
              </div>

              {showPresets && (
                <div className="bg-surface rounded-xl border border-white/10 overflow-hidden">
                  {PROFILE_PRESETS.map(p => (
                    <button
                      key={p}
                      onClick={() => { setProfilePath(p); setShowPresets(false) }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-xs font-mono cursor-pointer transition-colors',
                        profilePath === p ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2/50 hover:text-text'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted/70 font-mono">
                App reads <span className="text-text">ANTHROPIC_API_KEY</span> from this file on startup
              </p>
            </div>
          )}
        </div>

        {/* ── API Key Entry ───────────────────────── */}
        <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <p className="text-xs font-mono font-semibold text-muted mb-2">
            {isAuthOk ? 'Update API Key' : 'Set API Key'}
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-api03-..."
              className="flex-1 bg-surface2 rounded-xl px-3 py-2.5 text-sm font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <button
              onClick={() => setShowKey(s => !s)}
              className="px-3 py-2 rounded-lg text-xs font-mono text-muted hover:text-text cursor-pointer bg-surface2 border border-white/10 transition-colors flex-shrink-0"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={!apiKey.trim() || saving}
            className="w-full py-2.5 rounded-xl text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed glow-accent"
          >
            {saving ? 'Saving...' : `Save to ${profilePath}`}
          </button>
          {feedback && (
            <p className="text-xs font-mono mt-2 text-center" style={{ color: feedback.startsWith('✅') ? '#22C55E' : '#EF4444' }}>
              {feedback}
            </p>
          )}
        </div>

        {/* ── Claude CLI Binary ───────────────────── */}
        <div className="p-3 rounded-xl bg-surface2/30 border border-white/5">
          <p className="text-xs font-mono font-semibold text-muted mb-1">Claude CLI Binary</p>
          <p className="text-xs font-mono text-text break-all">
            {claudeBinaryForDisplay ?? '❌ Not detected — install: npm i -g @anthropic-ai/claude-code'}
          </p>
        </div>
      </div>
    </div>
  )
}
// ────────────────────────────────────────────────────────────────

// ── LocalLibrary panel ──────────────────────────────────────────
type LibTab = 'skill' | 'plugin' | 'agent'

function LocalLibraryPanel({ onRescan, scanning }: { onRescan: () => void; scanning: boolean }) {
  const { items } = useLibraryStore()
  const [tab, setTab]           = useState<LibTab>('skill')
  const [query, setQuery]       = useState('')
  const [showInstall, setShowInstall] = useState(false)

  const q = query.toLowerCase().trim()

  const applySearch = (list: typeof items) =>
    q ? list.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.model.toLowerCase().includes(q)
    ) : list

  const skills  = applySearch(items.filter(i => i.item_type === 'skill'))
  const plugins = applySearch(items.filter(i => i.item_type === 'plugin' || i.item_type === 'mcp'))
  const agents  = applySearch(items.filter(i => i.item_type === 'agent'))

  const tabData: { key: LibTab; label: string; list: typeof items }[] = [
    { key: 'skill',  label: 'Skills',  list: skills  },
    { key: 'plugin', label: 'Plugins', list: plugins },
    { key: 'agent',  label: 'Agents',  list: agents  },
  ]
  const active = tabData.find(t => t.key === tab)!

  return (
    <div className="glass rounded-xl flex flex-col border border-white/5 overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
        <span className="text-xs font-mono font-bold text-text">Local Machine</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onRescan}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-colors',
              scanning ? 'text-accent' : 'text-muted hover:text-accent'
            )}
            title="Re-scan Claude CLI data"
          >
            <RefreshCw className={cn('w-3 h-3', scanning && 'animate-spin')} />
            {scanning && <span>Scanning…</span>}
          </button>
          <button
            onClick={() => setShowInstall(true)}
            className="p-1 text-muted hover:text-accent cursor-pointer transition-colors rounded"
            title="Add plugin / skill / agent"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showInstall && (
        <InstallModal
          onClose={() => setShowInstall(false)}
          onDone={() => { setShowInstall(false); onRescan() }}
        />
      )}

      {/* Search */}
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search skills, plugins, agents…"
            className={cn(
              'w-full bg-surface2/60 rounded-lg pl-7 pr-6 py-1.5',
              'text-xs font-mono text-text placeholder-muted/60',
              'focus:outline-none focus:ring-1 focus:ring-accent/40',
              'transition-all duration-150',
            )}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
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
                ? 'text-accent border-b-2 border-accent bg-accent/5'
                : 'text-muted hover:text-text',
            )}
          >
            {t.label}
            <span className="ml-1 opacity-50">({t.list.length})</span>
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
        {active.list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 gap-1">
            {q ? (
              <>
                <p className="text-xs text-muted font-mono">No match for "{query}"</p>
                <button onClick={() => setQuery('')} className="text-xs text-accent/70 font-mono cursor-pointer hover:text-accent">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted font-mono">No {active.label.toLowerCase()} found</p>
                <p className="text-xs text-muted/50 font-mono">Click ↻ to refresh</p>
              </>
            )}
          </div>
        ) : (
          active.list.map(item => (
            <LibraryItem key={item.id} item={item} tab={tab} />
          ))
        )}
      </div>
    </div>
  )
}

function LibraryItem({ item, tab }: { item: SkillItem; tab: LibTab }) {
  const TAG_COLORS = useTagColors()
  const color = TAG_COLORS[(tab === 'plugin' ? 'plugin' : tab) as TagType]
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface2/60 transition-colors group">
      {/* Type dot + icon */}
      <span className="flex items-center gap-1 flex-shrink-0 mt-0.5 leading-none">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-xs">
          {tab === 'skill'  && '⚡'}
          {tab === 'plugin' && (item.item_type === 'mcp' ? '🔌' : '📦')}
          {tab === 'agent'  && '🤖'}
        </span>
      </span>

      <div className="min-w-0 flex-1">
        {/* Name */}
        <p className="text-xs font-mono truncate leading-snug" style={{ color }}>{item.name}</p>

        {/* Description */}
        {item.description && (
          <p className="text-xs text-muted/70 truncate leading-tight">{item.description}</p>
        )}

        {/* Badges row */}
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {/* Plugin version */}
          {tab === 'plugin' && item.version && (
            <span className="text-xs font-mono text-muted/60 bg-surface2 px-1 rounded">
              v{item.version}
            </span>
          )}
          {/* Plugin publisher (stored in model field) */}
          {tab === 'plugin' && item.model && (
            <span className="text-xs font-mono text-muted/40 truncate max-w-[100px]">
              {item.model}
            </span>
          )}
          {/* Skill source: which plugin it came from */}
          {tab === 'skill' && item.version && item.version !== 'personal' && (
            <span className="text-xs font-mono text-muted/50 bg-surface2/60 px-1 rounded truncate max-w-[120px]">
              {item.version}
            </span>
          )}
          {tab === 'skill' && item.version === 'personal' && (
            <span className="text-xs font-mono text-accent/50 bg-accent/5 px-1 rounded">personal</span>
          )}
          {/* Agent model */}
          {tab === 'agent' && item.model && (
            <span className="text-xs font-mono text-accent/60 bg-accent/10 px-1 rounded">
              {item.model.replace('claude-', '').replace('-latest', '')}
            </span>
          )}
        </div>
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
  const { chatsByProject, chats, ptyStatus } = useSessionStore()

  // A project is "active" if it has a PTY session running OR any chat with messages
  const isProjectActive = (projectId: string) => {
    if (ptyStatus[projectId] === 'running') return true
    const ids = chatsByProject[projectId] ?? []
    return ids.some(id => (chats[id]?.messages.length ?? 0) > 0)
  }

  const [scanning, setScanning] = useState(false)
  const [modal, setModal] = useState<'new' | 'open' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'added' | 'name' | 'activity'>('added')
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

  const searchedProjects = search.trim()
    ? projects.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.path.toLowerCase().includes(search.toLowerCase())
      )
    : projects

  const filteredProjects = [...searchedProjects].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'activity') return (b.last_opened ?? 0) - (a.last_opened ?? 0)
    return (b.created_at ?? 0) - (a.created_at ?? 0) // added (default)
  })

  const agentRows = Object.entries(statuses).map(([id, status]) => ({
    id,
    projectName: projects.find((p) => p.id === id)?.name ?? id,
    status,
    tokensIn: 0,
    tokensOut: 0,
    runtimeSecs: 0,
  }))

  const getAgentCount = (projectId: string) => {
    const legacy = statuses[projectId] === 'running' ? 1 : 0
    return legacy + (isProjectActive(projectId) ? 1 : 0)
  }

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
          <span className="font-mono text-sm font-bold text-text">Claude X</span>
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-muted" />
            <span className="text-xs text-muted font-mono">
              {claudeBinary ? 'CLI ready' : 'CLI not detected'}
            </span>
            {claudeBinary && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
          </div>
        </div>

        <div className="titlebar-no-drag flex items-center gap-2">
          {/* Theme toggle */}
          <ThemeToggle />

          {/* Auth status badge */}
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-mono',
              isAuthOk ? 'text-accent' : 'text-warning'
            )}
            title={authStatus}
          >
            {isAuthOk
              ? <CheckCircle className="w-3 h-3" />
              : <AlertTriangle className="w-3 h-3" />}
            <span className="hidden sm:inline text-xs">
              {isAuthOk ? 'Auth OK' : 'No auth'}
            </span>
          </div>

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
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-sm font-mono font-bold text-text">
              Projects
              <span className="ml-1.5 text-muted font-normal">
                ({filteredProjects.length}{search ? `/${projects.length}` : ''})
              </span>
            </h1>
            <div className="flex items-center gap-2">
              {/* Sort selector */}
              <div className="flex items-center gap-1 bg-surface2/60 rounded-lg p-0.5">
                {([
                  { v: 'added' as const,    label: 'Added'    },
                  { v: 'activity' as const, label: 'Activity' },
                  { v: 'name' as const,     label: 'Name'     },
                ]).map(s => (
                  <button key={s.v} onClick={() => setSortBy(s.v)}
                    className={cn('px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors',
                      sortBy === s.v ? 'bg-surface text-text' : 'text-muted hover:text-text')}>
                    {s.label}
                  </button>
                ))}
              </div>
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
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..."
              className={cn(
                'w-full bg-surface2/60 rounded-xl pl-8 pr-3 py-2',
                'text-xs font-mono text-text placeholder-muted',
                'focus:outline-none focus:ring-1 focus:ring-accent/40',
                'transition-all duration-150',
              )}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
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
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <Search className="w-8 h-8 text-muted/40" />
                <p className="text-xs text-muted font-mono">No projects match "{search}"</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredProjects.map((p) => (
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
