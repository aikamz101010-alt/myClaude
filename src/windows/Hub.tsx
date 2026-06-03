import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { ProjectCard } from '@/components/hub/ProjectCard'
import { GlobalMonitor } from '@/components/hub/GlobalMonitor'
import { useProjectStore } from '@/store/projectStore'
import { useLibraryStore } from '@/store/libraryStore'
import { useSessionStore } from '@/store/sessionStore'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Cpu, Terminal, FolderOpen, FolderInput, X, Settings, CheckCircle, AlertTriangle, Search, Globe, LogIn, LogOut, KeyRound, Copy, ExternalLink, Check } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
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
  const { claudeBinary: claudeBinaryForDisplay, load: reloadLibrary } = useLibraryStore()

  // API-key save location
  const [editingLocation, setEditingLocation] = useState(false)
  const [profilePath, setProfilePath] = useState('~/.bash_profile')

  // API key state
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [reloading, setReloading] = useState(false)

  // Auth method tabs + browser-login state
  const [method, setMethod] = useState<'browser' | 'apikey'>('browser')
  const [authInfo, setAuthInfo] = useState<{ loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string } | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginLog, setLoginLog] = useState<string[]>([])
  const [loginUrl, setLoginUrl] = useState('')      // OAuth login URL from the CLI
  const [urlCopied, setUrlCopied] = useState(false)
  const [authCode, setAuthCode] = useState('')      // code pasted back from the browser
  const [submittingCode, setSubmittingCode] = useState(false)

  const setFeedbackTemp = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 3000)
  }

  // Load rich auth status (claude auth status --json)
  const loadAuthInfo = async () => {
    try {
      const raw = await invoke<string>('auth_status_json')
      setAuthInfo(JSON.parse(raw))
    } catch { setAuthInfo(null) }
  }
  useEffect(() => { loadAuthInfo() }, [])

  // Browser OAuth login — subscribe to streamed events
  const handleBrowserLogin = async (mode: 'claudeai' | 'console') => {
    setLoggingIn(true)
    setLoginLog([])
    setLoginUrl('')
    setAuthCode('')
    setUrlCopied(false)
    const unlistenEvt = await listen<string>('auth:event', e => {
      setLoginLog(prev => [...prev, e.payload].slice(-8))
    })
    const unlistenUrl = await listen<string>('auth:url', e => {
      // Show the link with copy/open controls — user opens it when ready.
      setLoginUrl(e.payload)
    })
    const unlistenDone = await listen<{ success: boolean; error?: string }>('auth:done', async e => {
      unlistenEvt(); unlistenUrl(); unlistenDone()
      setLoggingIn(false)
      setLoginUrl('')
      setAuthCode('')
      if (e.payload.success) {
        setFeedbackTemp('✅ Signed in via subscription')
        await loadAuthInfo()
        await reloadLibrary()
      } else {
        setFeedbackTemp(`❌ Login failed${e.payload.error ? ': ' + e.payload.error : ''}`)
      }
    })
    try {
      await invoke('auth_login', { mode })
    } catch (err) {
      unlistenEvt(); unlistenUrl(); unlistenDone()
      setLoggingIn(false)
      setFeedbackTemp(`❌ ${String(err)}`)
    }
  }

  // Copy the OAuth login URL to the clipboard
  const handleCopyUrl = async () => {
    if (!loginUrl) return
    try {
      await navigator.clipboard.writeText(loginUrl)
      setUrlCopied(true)
      setTimeout(() => setUrlCopied(false), 1500)
    } catch { setFeedbackTemp('❌ Could not copy') }
  }

  // Send the pasted authorization code back to the waiting CLI
  const handleSubmitCode = async () => {
    if (!authCode.trim()) return
    setSubmittingCode(true)
    try {
      await invoke('auth_submit_code', { code: authCode.trim() })
      setFeedbackTemp('⏳ Verifying code…')
    } catch (err) {
      setFeedbackTemp(`❌ ${String(err)}`)
    } finally {
      setSubmittingCode(false)
    }
  }

  const handleLogout = async () => {
    try {
      await invoke('auth_logout')
      setFeedbackTemp('Logged out')
      await loadAuthInfo()
      await reloadLibrary()
    } catch (e) { setFeedbackTemp(`❌ ${String(e)}`) }
  }

  // ── App update ──────────────────────────────────────────────
  const [currentVersion, setCurrentVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')
  const [installing, setInstalling] = useState(false)
  const updateRef = useRef<Update | null>(null)

  useEffect(() => { getVersion().then(setCurrentVersion).catch(() => {}) }, [])

  const handleCheckUpdate = async () => {
    setChecking(true); setUpdateMsg(''); setNewVersion(null); updateRef.current = null
    try {
      const upd = await check()
      if (upd) {
        updateRef.current = upd
        setNewVersion(upd.version)
      } else {
        setUpdateMsg('✅ Sudah versi terbaru')
      }
    } catch (e) {
      setUpdateMsg(`❌ ${String(e)}`)
    } finally {
      setChecking(false)
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateRef.current) return
    setInstalling(true); setUpdateMsg('Downloading…')
    try {
      await updateRef.current.downloadAndInstall()
      setUpdateMsg('Installed — restarting…')
      await relaunch()
    } catch (e) {
      setUpdateMsg(`❌ ${String(e)}`)
      setInstalling(false)
    }
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
            <div className="flex items-center gap-2">
              {authInfo?.loggedIn && (
                <button onClick={handleLogout}
                  className="flex items-center gap-1 text-xs font-mono text-muted hover:text-error cursor-pointer transition-colors">
                  <LogOut className="w-3 h-3" /> Logout
                </button>
              )}
              <button onClick={() => { handleReload(); loadAuthInfo() }}
                className="flex items-center gap-1 text-xs font-mono text-muted hover:text-accent cursor-pointer transition-colors">
                <RefreshCw className={cn('w-3 h-3', reloading && 'animate-spin')} /> Re-check
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {authInfo?.loggedIn
              ? <CheckCircle className="w-4 h-4 text-accent flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />}
            <div className="min-w-0">
              {authInfo?.loggedIn ? (
                <p className="text-xs font-mono text-accent truncate">
                  {authInfo.email ?? 'Signed in'}
                  {authInfo.subscriptionType && <span className="text-accent/60"> · {authInfo.subscriptionType}</span>}
                  {authInfo.authMethod && <span className="text-muted/50"> · {authInfo.authMethod}</span>}
                </p>
              ) : (
                <p className="text-xs font-mono text-warning">Not signed in — choose a method below</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Method tabs ─────────────────────────── */}
        <div className="flex items-center gap-1 mb-3 bg-surface2/50 rounded-xl p-1">
          <button onClick={() => setMethod('browser')}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors',
              method === 'browser' ? 'bg-surface text-text' : 'text-muted hover:text-text')}>
            <Globe className="w-3.5 h-3.5" /> Browser login
          </button>
          <button onClick={() => setMethod('apikey')}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors',
              method === 'apikey' ? 'bg-surface text-text' : 'text-muted hover:text-text')}>
            <KeyRound className="w-3.5 h-3.5" /> API key
          </button>
        </div>

        {/* ── Browser login ───────────────────────── */}
        {method === 'browser' && (
          <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
            <p className="text-xs font-mono text-muted/70 mb-2">
              Sign in via your browser — opens Claude's login page. One-time per machine.
            </p>
            <div className="flex gap-2">
              <button onClick={() => handleBrowserLogin('claudeai')} disabled={loggingIn}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed glow-accent">
                {loggingIn ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                Claude subscription
              </button>
              <button onClick={() => handleBrowserLogin('console')} disabled={loggingIn}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-mono font-semibold bg-surface2 text-text hover:bg-surface border border-white/10 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <LogIn className="w-3.5 h-3.5" /> API billing
              </button>
            </div>
            {/* OAuth login URL — shown + copyable, opens automatically */}
            {loginUrl && (
              <div className="mt-3 p-2.5 rounded-lg bg-surface border border-accent/20">
                <p className="text-xs font-mono font-semibold text-accent mb-1.5">Login link</p>
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    value={loginUrl}
                    onFocus={e => e.currentTarget.select()}
                    className="flex-1 min-w-0 bg-surface2 rounded-md px-2 py-1.5 text-xs font-mono text-muted truncate outline-none border border-white/5"
                  />
                  <button onClick={handleCopyUrl} title="Copy link"
                    className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-mono bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors flex-shrink-0">
                    {urlCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {urlCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button onClick={() => openUrl(loginUrl)} title="Open in browser"
                    className="flex items-center justify-center px-2 py-1.5 rounded-md text-xs font-mono bg-surface2 text-text hover:bg-surface border border-white/10 cursor-pointer transition-colors flex-shrink-0">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs font-mono text-muted/60 mt-2 mb-1">
                  Authorize in the browser, copy the code shown, paste it here:
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    value={authCode}
                    onChange={e => setAuthCode(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSubmitCode() }}
                    placeholder="Paste authentication code…"
                    className="flex-1 min-w-0 bg-surface2 rounded-md px-2 py-1.5 text-xs font-mono text-text outline-none border border-white/5 focus:border-accent/40"
                  />
                  <button onClick={handleSubmitCode} disabled={!authCode.trim() || submittingCode}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
                    {submittingCode ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    Submit
                  </button>
                </div>
              </div>
            )}
            {loginLog.length > 0 && (
              <pre className="mt-2 max-h-28 overflow-y-auto bg-surface rounded-lg p-2 text-xs font-mono text-muted/80 whitespace-pre-wrap break-all">
                {loginLog.join('\n')}
              </pre>
            )}
            {loggingIn && !loginUrl && (
              <p className="text-xs font-mono text-muted/60 mt-2">Opening Claude's login page…</p>
            )}
          </div>
        )}

        {/* ── API Key Entry ───────────────────────── */}
        {method === 'apikey' && (
        <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono font-semibold text-muted">API Key</p>
            <button onClick={() => setEditingLocation(e => !e)}
              className="text-xs font-mono text-accent hover:text-accent/80 cursor-pointer">
              {editingLocation ? 'Done' : `Save to: ${profilePath}`}
            </button>
          </div>
          {editingLocation && (
            <div className="space-y-2 mb-2">
              <input value={profilePath} onChange={e => setProfilePath(e.target.value)} placeholder="~/.bash_profile"
                className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50" autoFocus />
              <div className="flex flex-wrap gap-1">
                {PROFILE_PRESETS.map(p => (
                  <button key={p} onClick={() => setProfilePath(p)}
                    className={cn('px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors',
                      profilePath === p ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-surface2/50 hover:text-text')}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 mb-2">
            <input
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-api03-..."
              className="flex-1 bg-surface2 rounded-xl px-3 py-2.5 text-sm font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
            <button onClick={() => setShowKey(s => !s)}
              className="px-3 py-2 rounded-lg text-xs font-mono text-muted hover:text-text cursor-pointer bg-surface2 border border-white/10 transition-colors flex-shrink-0">
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <button onClick={handleSaveKey} disabled={!apiKey.trim() || saving}
            className="w-full py-2.5 rounded-xl text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed glow-accent">
            {saving ? 'Saving...' : 'Save API Key'}
          </button>
        </div>
        )}

        {feedback && (
          <p className="text-xs font-mono mb-3 text-center" style={{ color: feedback.startsWith('✅') ? '#22C55E' : feedback.startsWith('❌') ? '#EF4444' : '#94A3B8' }}>
            {feedback}
          </p>
        )}

        {/* ── App Updates ─────────────────────────── */}
        <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-mono font-semibold text-muted">App Update</p>
            <button onClick={handleCheckUpdate} disabled={checking || installing}
              className="flex items-center gap-1 text-xs font-mono text-accent hover:text-accent/80 cursor-pointer transition-colors disabled:opacity-40">
              <RefreshCw className={cn('w-3 h-3', checking && 'animate-spin')} />
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted/70">Current</span>
            <span className="text-text">v{currentVersion || '—'}</span>
          </div>

          {newVersion && (
            <>
              <div className="flex items-center justify-between text-xs font-mono mt-1">
                <span className="text-muted/70">Available</span>
                <span className="text-accent font-semibold">v{newVersion}</span>
              </div>
              <button onClick={handleInstallUpdate} disabled={installing}
                className="w-full mt-2 py-2 rounded-xl text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed glow-accent">
                {installing ? 'Installing…' : `Download & install v${newVersion}`}
              </button>
            </>
          )}

          {updateMsg && (
            <p className="text-xs font-mono mt-2" style={{ color: updateMsg.startsWith('✅') ? '#22C55E' : updateMsg.startsWith('❌') ? '#EF4444' : '#94A3B8' }}>
              {updateMsg}
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
  const { chatsByProject, chats, ptyStatus } = useSessionStore()

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

  // Agent monitor rows — built from chat sessions (each chat with activity = one agent row)
  const agentRows = Object.entries(chatsByProject).flatMap(([pid, ids]) => {
    const proj = projects.find(p => p.id === pid)
    return (ids ?? [])
      .map(id => chats[id])
      .filter((c): c is NonNullable<typeof c> =>
        !!c && (c.messages.length > 0 || c.status === 'streaming'))
      .map(c => ({
        id: c.id,
        projectName: `${proj?.name ?? 'project'} · ${c.title}`,
        status: (c.status === 'streaming' ? 'running' : c.status === 'error' ? 'error' : 'idle') as 'running' | 'idle' | 'error',
        tokensIn: c.totalInputTokens,
        tokensOut: c.totalOutputTokens,
        runtimeSecs: 0,
      }))
  })

  // Per-project aggregate totals (cost + tokens in/out) across all its chats
  const projectTotals = (projectId: string) => {
    const ids = chatsByProject[projectId] ?? []
    let cost = 0, tokensIn = 0, tokensOut = 0
    for (const id of ids) {
      const c = chats[id]
      if (c) { cost += c.totalCost; tokensIn += c.totalInputTokens; tokensOut += c.totalOutputTokens }
    }
    return { cost, tokensIn, tokensOut }
  }

  const getAgentCount = (projectId: string) => {
    const ids = chatsByProject[projectId] ?? []
    const running = ids.filter(id => chats[id]?.status === 'streaming').length
    return running + (ptyStatus[projectId] === 'running' ? 1 : 0)
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
                {filteredProjects.map((p) => {
                  const totals = projectTotals(p.id)
                  return (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      agentCount={getAgentCount(p.id)}
                      tokensIn={totals.tokensIn}
                      tokensOut={totals.tokensOut}
                      totalCost={totals.cost}
                      onOpen={async () => { await touch(p.id); onOpenProject(p) }}
                      onDelete={() => remove(p.id)}
                    />
                  )
                })}
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
