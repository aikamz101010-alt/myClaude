import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { X, Package, Zap, Bot, CheckCircle, AlertCircle, Loader2, Link2 } from 'lucide-react'

type Tab = 'github' | 'plugin' | 'agent'

interface Props {
  onClose: () => void
  onDone: () => void
}

// ── Quick presets ─────────────────────────────────────────────────
const GITHUB_PRESETS = [
  { label: 'taste-skill',  url: 'https://github.com/Leonxlnx/taste-skill' },
  { label: 'impeccable',   url: 'https://github.com/pbakaus/impeccable'   },
  { label: 'skill',        url: 'https://github.com/emilkowalski/skill'    },
]

// ── Shared helpers ────────────────────────────────────────────────
function Feedback({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={cn(
      'flex items-start gap-1.5 px-3 py-2 rounded-lg text-xs font-mono border',
      ok ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-error/10 border-error/20 text-error',
    )}>
      {ok ? <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />}
      <pre className="whitespace-pre-wrap break-all leading-relaxed">{msg}</pre>
    </div>
  )
}

function Btn({ loading, label, disabled, onClick, type = 'submit', variant = 'accent' }: {
  loading?: boolean; label: string; disabled?: boolean
  onClick?: () => void; type?: 'button' | 'submit'; variant?: 'accent' | 'ghost'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'px-3 py-2 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'accent'
          ? 'bg-accent text-bg hover:bg-accent/90 glow-accent'
          : 'bg-surface2 text-muted hover:text-text',
      )}
    >
      {loading
        ? <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Working…</span>
        : label}
    </button>
  )
}

// ── Main modal ────────────────────────────────────────────────────
export function InstallModal({ onClose, onDone }: Props) {
  const [tab, setTab] = useState<Tab>('github')

  const TABS: { key: Tab; icon: typeof Zap; label: string }[] = [
    { key: 'github', icon: Link2,    label: 'GitHub'  },
    { key: 'plugin', icon: Package,  label: 'Plugin'  },
    { key: 'agent',  icon: Bot,      label: 'Agent'   },
  ]

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass rounded-xl w-[420px] shadow-2xl border border-white/10 animate-slide-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <span className="text-xs font-mono font-bold text-text">Add to Local Machine</span>
          <div className="flex items-center gap-2">
            {/* Tab pills */}
            <div className="flex gap-0.5 bg-surface2/50 rounded-lg p-0.5">
              {TABS.map(({ key, icon: Icon, label }) => (
                <button key={key} onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors',
                    tab === key ? 'bg-surface text-text' : 'text-muted hover:text-text',
                  )}>
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-muted hover:text-text cursor-pointer transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-4">
          {tab === 'github' && <GithubTab onClose={onClose} onDone={onDone} />}
          {tab === 'plugin' && <PluginTab onClose={onClose} onDone={onDone} />}
          {tab === 'agent'  && <AgentTab  onClose={onClose} onDone={onDone} />}
        </div>
      </div>
    </div>
  )
}

// ── GitHub tab ────────────────────────────────────────────────────
function GithubTab({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl]           = useState('')
  const [skills, setSkills]     = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fetched, setFetched]   = useState(false)
  const [isPlugin, setIsPlugin] = useState(false)  // true = is a Claude plugin marketplace
  const [fetching, setFetching] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null)

  const reset = () => {
    setSkills([]); setSelected(new Set()); setFetched(false)
    setIsPlugin(false); setResult(null)
  }

  const handleSetUrl = (v: string) => { setUrl(v); reset() }

  const handleFetch = async () => {
    if (!url.trim()) return
    setFetching(true); setResult(null); setFetched(false)
    try {
      const list = await invoke<string[]>('list_github_skills', { githubUrl: url.trim() })
      setSkills(list)
      // Pre-select all
      setSelected(new Set(list))
      setFetched(true)
      setIsPlugin(false)
    } catch (err) {
      const msg = String(err)
      // If marketplace add might work, suggest plugin tab
      if (msg.includes('marketplace') || msg.includes('plugin')) {
        setIsPlugin(true); setFetched(true)
      } else {
        setResult({ ok: false, msg })
      }
    } finally {
      setFetching(false)
    }
  }

  const toggleAll = () => {
    if (selected.size === skills.length) setSelected(new Set())
    else setSelected(new Set(skills))
  }

  const handleInstall = async () => {
    setInstalling(true); setResult(null)
    try {
      const toInstall = skills.length > 0 ? Array.from(selected) : []
      const msg = await invoke<string>('install_github_skill', {
        githubUrl: url.trim(),
        skills: toInstall,
      })
      setResult({ ok: true, msg })
      onDone()
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div>
        <p className="text-xs font-mono text-muted mb-1.5">Quick install</p>
        <div className="flex flex-wrap gap-1.5">
          {GITHUB_PRESETS.map(p => (
            <button key={p.url} onClick={() => handleSetUrl(p.url)}
              className={cn(
                'px-2 py-1 rounded text-xs font-mono cursor-pointer transition-colors border',
                url === p.url
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'text-muted border-white/10 hover:text-text hover:border-white/20',
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* URL input */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={e => handleSetUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="flex-1 bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetch() } }}
        />
        <Btn type="button" loading={fetching} label="Fetch" variant="ghost" onClick={handleFetch} disabled={!url.trim()} />
      </div>

      {/* Skills list */}
      {fetched && !isPlugin && skills.length > 0 && (
        <div className="bg-surface2/40 rounded-lg border border-white/5 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
            <span className="text-xs font-mono text-muted">{skills.length} skills found</span>
            <button onClick={toggleAll} className="text-xs font-mono text-accent hover:text-accent/80 cursor-pointer">
              {selected.size === skills.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="max-h-36 overflow-y-auto p-1.5 space-y-0.5">
            {skills.map(s => (
              <label key={s} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface2/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s)}
                  onChange={() => setSelected(prev => {
                    const n = new Set(prev)
                    n.has(s) ? n.delete(s) : n.add(s)
                    return n
                  })}
                  className="accent-accent w-3 h-3"
                />
                <span className="text-xs font-mono text-text">{s}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Repo is itself a skill (no skills/ subfolder) */}
      {fetched && !isPlugin && skills.length === 0 && (
        <p className="text-xs font-mono text-muted bg-surface2/40 px-3 py-2 rounded-lg">
          Repo is a single skill — will be installed as <code className="text-text">{url.split('/').pop()}</code>
        </p>
      )}

      {/* Repo is a Claude plugin */}
      {fetched && isPlugin && (
        <p className="text-xs font-mono text-muted bg-surface2/40 px-3 py-2 rounded-lg">
          This looks like a Claude plugin — use the Plugin tab to install it.
        </p>
      )}

      {result && <Feedback ok={result.ok} msg={result.msg} />}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Btn type="button" label="Cancel" variant="ghost" onClick={onClose} />
        <div className="flex-1" />
        {fetched && !isPlugin && (
          <Btn
            loading={installing}
            label={`Install${selected.size > 0 ? ` (${selected.size})` : ''}`}
            disabled={skills.length > 0 && selected.size === 0}
            onClick={handleInstall}
          />
        )}
      </div>
    </div>
  )
}

// ── Plugin tab ────────────────────────────────────────────────────
function PluginTab({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [target, setTarget]   = useState('')
  const [ghUrl, setGhUrl]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setResult(null)
    try {
      if (ghUrl.trim()) {
        await invoke('add_marketplace', { url: ghUrl.trim() })
      }
      if (target.trim()) {
        const msg = await invoke<string>('install_plugin', { target: target.trim() })
        setResult({ ok: true, msg })
        onDone()
      } else if (ghUrl.trim()) {
        setResult({ ok: true, msg: 'Marketplace added. Now enter plugin name to install.' })
      }
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-mono text-muted block mb-1">GitHub marketplace URL <span className="opacity-50">(optional)</span></label>
        <input value={ghUrl} onChange={e => setGhUrl(e.target.value)} placeholder="https://github.com/owner/repo"
          className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40" />
      </div>
      <div>
        <label className="text-xs font-mono text-muted block mb-1">Plugin name</label>
        <input value={target} onChange={e => setTarget(e.target.value)} placeholder="superpowers@marketplace"
          className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40" />
      </div>
      {result && <Feedback ok={result.ok} msg={result.msg} />}
      <div className="flex gap-2 pt-1">
        <Btn type="button" label="Cancel" variant="ghost" onClick={onClose} />
        <div className="flex-1" />
        <Btn loading={loading} label="Install Plugin" />
      </div>
    </form>
  )
}

// ── Agent tab ─────────────────────────────────────────────────────
const MODELS = ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001']

function AgentTab({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName]       = useState('')
  const [desc, setDesc]       = useState('')
  const [model, setModel]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setResult(null)
    try {
      await invoke('create_agent', { name: name.trim(), description: desc.trim(), model })
      setResult({ ok: true, msg: `Agent "${name}" created at ~/.claude/agents/${name}.md` })
      onDone()
    } catch (err) {
      setResult({ ok: false, msg: String(err) })
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-mono text-muted block mb-1">Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="my-agent"
          pattern="[a-zA-Z0-9_-]+" required autoFocus
          className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40" />
      </div>
      <div>
        <label className="text-xs font-mono text-muted block mb-1">Description <span className="opacity-50">(optional)</span></label>
        <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What this agent does…"
          className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent/40" />
      </div>
      <div>
        <label className="text-xs font-mono text-muted block mb-1">Model <span className="opacity-50">(optional)</span></label>
        <select value={model} onChange={e => setModel(e.target.value)}
          className="w-full bg-surface2 rounded-lg px-3 py-2 text-xs font-mono text-text focus:outline-none focus:ring-1 focus:ring-accent/40 cursor-pointer">
          <option value="">Default model</option>
          {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      {result && <Feedback ok={result.ok} msg={result.msg} />}
      <div className="flex gap-2 pt-1">
        <Btn type="button" label="Cancel" variant="ghost" onClick={onClose} />
        <div className="flex-1" />
        <Btn loading={loading} label="Create Agent" />
      </div>
    </form>
  )
}
