import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { cn } from '@/lib/utils'
import { useLibraryStore, type SkillItem } from '@/store/libraryStore'
import { buildClassifier, tagPrefix, useTagColors, type TagType } from '@/lib/tagColors'
import { Plus, Slash, Mic, Square, ArrowUp, X, FileText, Loader2, Cpu, Check, CornerDownLeft, Shield, Zap, Boxes } from 'lucide-react'

export interface AttachedFile {
  path: string
  name: string
}

export const MODELS = [
  { value: '',                          label: 'Default'    },
  { value: 'claude-opus-4-8',           label: 'Opus 4.8'   },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5'  },
]

export const PERMISSION_MODES = [
  { value: 'default',           label: 'Default',      desc: 'Ask per CLI policy' },
  { value: 'plan',              label: 'Plan',         desc: 'Read-only, plan first' },
  { value: 'acceptEdits',       label: 'Accept Edits', desc: 'Auto-accept file edits' },
  { value: 'dontAsk',           label: "Don't Ask",    desc: 'Run without prompts' },
  { value: 'bypassPermissions', label: 'Bypass All',   desc: 'Run everything (risky)' },
]

interface Props {
  onSend: (text: string, files: AttachedFile[]) => void
  onStop?: () => void
  streaming: boolean
  slashCommands?: string[]
  model?: string
  onModelChange?: (model: string) => void
  permissionMode?: string
  onPermissionModeChange?: (mode: string) => void
  yolo?: boolean
  onYoloChange?: (v: boolean) => void
  injectText?: string          // external text to append (click-to-tag)
  onInjectConsumed?: () => void
}

// Common Claude Code slash commands (fallback list)
const DEFAULT_COMMANDS = [
  'init', 'review', 'security-review', 'compact', 'clear', 'context',
  'cost', 'help', 'model', 'agents', 'mcp', 'memory', 'resume',
]

// ── Voice (Web Speech API) ────────────────────────────────────────
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): SpeechRecognitionLike | null {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) return null
  try {
    const r = new SR() as SpeechRecognitionLike
    r.lang = 'id-ID'
    r.continuous = true
    r.interimResults = true
    return r
  } catch {
    return null
  }
}

export function ChatInput({ onSend, onStop, streaming, slashCommands, model = '', onModelChange, permissionMode = 'default', onPermissionModeChange, yolo = false, onYoloChange, injectText, onInjectConsumed }: Props) {
  const [text, setText]           = useState('')
  const [files, setFiles]         = useState<AttachedFile[]>([])
  const [dragOver, setDragOver]   = useState(false)
  const [showCmds, setShowCmds]   = useState(false)
  const [cmdFilter, setCmdFilter] = useState('')
  const [showModels, setShowModels] = useState(false)
  const [showPerms, setShowPerms] = useState(false)
  const [showLib, setShowLib]     = useState(false)
  const [libFilter, setLibFilter] = useState('')
  const [listening, setListening] = useState(false)
  const [enterNewline, setEnterNewline] = useState(false)  // toggle: Enter = newline
  const [voiceSupported] = useState(() => getSpeechRecognition() !== null)

  const currentModel = MODELS.find(m => m.value === model) ?? MODELS[0]
  const currentPerm = PERMISSION_MODES.find(p => p.value === permissionMode) ?? PERMISSION_MODES[0]

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const recogRef    = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')   // text before voice started

  // Classify /name & @name tokens by library type → color
  const { items } = useLibraryStore()
  const classify = useMemo(() => buildClassifier(items), [items])
  const TAG_COLORS = useTagColors()

  const commands = slashCommands && slashCommands.length > 0 ? slashCommands : DEFAULT_COMMANDS
  const filteredCmds = commands.filter(c =>
    c.toLowerCase().includes(cmdFilter.toLowerCase())
  ).slice(0, 8)

  // ── Library picker (insert /skill, @agent, @plugin tokens) ─────
  const itemToType = (t: string): TagType | null =>
    t === 'skill' ? 'skill'
    : t === 'agent' ? 'agent'
    : (t === 'plugin' || t === 'mcp') ? 'plugin'
    : null

  const libGroups = useMemo(() => {
    const q = libFilter.trim().toLowerCase()
    const groups: { type: TagType; label: string; items: SkillItem[] }[] = [
      { type: 'skill',  label: 'Skills',  items: [] },
      { type: 'agent',  label: 'Agents',  items: [] },
      { type: 'plugin', label: 'Plugins', items: [] },
    ]
    for (const it of items) {
      const ty = itemToType(it.item_type)
      if (!ty) continue
      if (q && !it.name.toLowerCase().includes(q) && !it.description.toLowerCase().includes(q)) continue
      groups.find(g => g.type === ty)!.items.push(it)
    }
    return groups.filter(g => g.items.length > 0)
  }, [items, libFilter])

  const insertTag = (item: SkillItem) => {
    const ty = itemToType(item.item_type) ?? 'skill'
    const token = tagPrefix(ty) + item.name
    setText(prev => {
      const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
      return prev + sep + token + ' '
    })
    setShowLib(false)
    textareaRef.current?.focus()
  }

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    if (backdropRef.current) backdropRef.current.style.height = el.style.height
  }, [])

  useEffect(() => { autoResize() }, [text, autoResize])

  // Sync backdrop scroll with textarea
  const syncScroll = () => {
    if (backdropRef.current && textareaRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  // Consume externally-injected tag (click-to-tag) → insert as colored text
  useEffect(() => {
    if (injectText) {
      setText(prev => {
        const sep = prev && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : ''
        return prev + sep + injectText + ' '
      })
      onInjectConsumed?.()
      textareaRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectText])

  // Detect "/" at start → show command list
  const handleChange = (v: string) => {
    setText(v)
    if (v.startsWith('/')) {
      setShowCmds(true)
      setCmdFilter(v.slice(1))
    } else {
      setShowCmds(false)
    }
  }

  // ── File attach ──────────────────────────────────────────────
  const addFiles = (paths: string[]) => {
    setFiles(prev => {
      const next = [...prev]
      for (const p of paths) {
        if (!next.some(f => f.path === p)) {
          next.push({ path: p, name: p.split('/').pop() ?? p })
        }
      }
      return next
    })
  }

  const handlePickFiles = async () => {
    try {
      const sel = await openDialog({ multiple: true, directory: false })
      if (Array.isArray(sel)) addFiles(sel)
      else if (typeof sel === 'string') addFiles([sel])
    } catch { /* cancelled */ }
  }

  const removeFile = (path: string) =>
    setFiles(prev => prev.filter(f => f.path !== path))

  // Drag & drop (HTML5 — file paths via Tauri)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    // Tauri exposes dropped paths via the file list
    const dropped: string[] = []
    if (e.dataTransfer?.files) {
      for (const f of Array.from(e.dataTransfer.files)) {
        // @ts-expect-error — Tauri adds .path on dropped files
        const p = f.path || f.name
        if (p) dropped.push(p)
      }
    }
    if (dropped.length) addFiles(dropped)
  }

  // ── Voice ─────────────────────────────────────────────────────
  const toggleVoice = () => {
    if (listening) {
      recogRef.current?.stop()
      return
    }
    const recog = getSpeechRecognition()
    if (!recog) return
    recogRef.current = recog
    baseTextRef.current = text ? text + ' ' : ''

    recog.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript
      }
      setText(baseTextRef.current + transcript)
    }
    recog.onerror = () => setListening(false)
    recog.onend = () => setListening(false)

    try {
      recog.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }

  // ── Slash command select ──────────────────────────────────────
  const selectCommand = (cmd: string) => {
    setText(`/${cmd} `)
    setShowCmds(false)
    textareaRef.current?.focus()
  }

  // ── Submit ────────────────────────────────────────────────────
  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed && files.length === 0) return
    if (streaming) return
    onSend(trimmed, files)
    setText('')
    setFiles([])
    setShowCmds(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCmds && e.key === 'Tab' && filteredCmds.length > 0) {
      e.preventDefault()
      selectCommand(filteredCmds[0])
      return
    }
    // Backspace deletes a whole /token or @token at once
    if (e.key === 'Backspace') {
      const el = textareaRef.current
      if (el && el.selectionStart === el.selectionEnd) {
        const pos = el.selectionStart
        const before = text.slice(0, pos)
        const m = before.match(/[/@][^\s/@]+$/)
        if (m && m[0].length > 1) {
          e.preventDefault()
          const start = pos - m[0].length
          const next = text.slice(0, start) + text.slice(pos)
          setText(next)
          requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start })
          return
        }
      }
    }
    if (e.key === 'Enter') {
      if (enterNewline) {
        // Enter = newline; Cmd/Ctrl+Enter sends
        if (e.metaKey || e.ctrlKey) { e.preventDefault(); handleSubmit() }
        // else: allow default newline
      } else {
        // Enter = send; Shift+Enter = newline
        if (!e.shiftKey) { e.preventDefault(); handleSubmit() }
      }
    }
    if (e.key === 'Escape') setShowCmds(false)
  }

  const canSend = (text.trim().length > 0 || files.length > 0) && !streaming

  // Build highlighted segments for the backdrop
  const segments = useMemo(() => {
    const out: { text: string; color?: string }[] = []
    const regex = /[/@][^\s/@]+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) })
      const tok = m[0]
      const name = tok.slice(1)
      const type = classify(name)
      out.push({ text: tok, color: type ? TAG_COLORS[type] : undefined })
      last = regex.lastIndex
    }
    if (last < text.length) out.push({ text: text.slice(last) })
    return out
  }, [text, classify, TAG_COLORS])

  return (
    <div className="relative px-3 pb-3">
      {/* Library picker popup (skill / agent / plugin) */}
      {showLib && (
        <div className="absolute bottom-full left-3 right-3 mb-2 glass rounded-xl border border-white/10 shadow-2xl overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-2">
            <Boxes className="w-3 h-3 text-accent/60 flex-shrink-0" />
            <span className="text-xs font-mono text-muted">Library</span>
            <input
              autoFocus
              value={libFilter}
              onChange={e => setLibFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setShowLib(false) }}
              placeholder="Search…"
              className="ml-auto bg-transparent text-xs font-mono text-text placeholder-muted/50 focus:outline-none w-28"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {libGroups.length === 0 && (
              <p className="px-2.5 py-2 text-xs font-mono text-muted/60">Tidak ada item — install dari Hub › Library.</p>
            )}
            {libGroups.map(g => (
              <div key={g.type} className="mb-1">
                <p className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted/50">{g.label}</p>
                {g.items.map(it => (
                  <button
                    key={it.id}
                    onClick={() => insertTag(it)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-surface2/60 cursor-pointer transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TAG_COLORS[g.type] }} />
                    <span className="text-xs font-mono flex-shrink-0" style={{ color: TAG_COLORS[g.type] }}>
                      {tagPrefix(g.type)}{it.name}
                    </span>
                    {it.description && (
                      <span className="text-[11px] font-mono text-muted/50 truncate">{it.description}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Slash command popup */}
      {showCmds && filteredCmds.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 glass rounded-xl border border-white/10 shadow-2xl overflow-hidden z-20">
          <div className="px-3 py-1.5 border-b border-white/5">
            <span className="text-xs font-mono text-muted">Commands</span>
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {filteredCmds.map(cmd => (
              <button
                key={cmd}
                onClick={() => selectCommand(cmd)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-surface2/60 cursor-pointer transition-colors"
              >
                <Slash className="w-3 h-3 text-accent/60 flex-shrink-0" />
                <span className="text-xs font-mono text-text">/{cmd}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Model picker popup */}
      {showModels && (
        <div className="absolute bottom-full right-3 mb-2 glass rounded-xl border border-white/10 shadow-2xl overflow-hidden z-20 min-w-[160px]">
          <div className="px-3 py-1.5 border-b border-white/5">
            <span className="text-xs font-mono text-muted">Model</span>
          </div>
          <div className="p-1">
            {MODELS.map(m => (
              <button
                key={m.value}
                onClick={() => { onModelChange?.(m.value); setShowModels(false) }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-surface2/60 cursor-pointer transition-colors"
              >
                <Cpu className="w-3 h-3 text-accent/60 flex-shrink-0" />
                <span className="text-xs font-mono text-text flex-1">{m.label}</span>
                {m.value === model && <Check className="w-3 h-3 text-accent flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Permission mode popup */}
      {showPerms && (
        <div className="absolute bottom-full right-3 mb-2 glass rounded-xl border border-white/10 shadow-2xl overflow-hidden z-20 min-w-[200px]">
          <div className="px-3 py-1.5 border-b border-white/5">
            <span className="text-xs font-mono text-muted">Permission mode</span>
          </div>
          <div className="p-1">
            {PERMISSION_MODES.map(p => (
              <button
                key={p.value}
                onClick={() => { onPermissionModeChange?.(p.value); setShowPerms(false) }}
                className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-surface2/60 cursor-pointer transition-colors"
              >
                <Shield className={cn('w-3 h-3 flex-shrink-0 mt-0.5',
                  p.value === 'bypassPermissions' ? 'text-error/70' : 'text-accent/60')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-mono text-text">{p.label}</span>
                    {p.value === permissionMode && <Check className="w-3 h-3 text-accent" />}
                  </div>
                  <p className="text-xs font-mono text-muted/60 leading-tight">{p.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input container */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-2xl border bg-surface/40 transition-all duration-150',
          dragOver ? 'border-accent/60 bg-accent/5' : 'border-white/10',
        )}
      >
        {/* File chips (above input) */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-1">
            {files.map(f => (
              <div key={f.path}
                className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-surface2/70 border border-white/10">
                <FileText className="w-3 h-3 text-accent/70 flex-shrink-0" />
                <span className="text-xs font-mono text-text max-w-[140px] truncate" title={f.path}>
                  {f.name}
                </span>
                <button onClick={() => removeFile(f.path)}
                  className="text-muted hover:text-error cursor-pointer transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea with colored-token backdrop overlay */}
        <div className="relative">
          {/* Backdrop: renders the same text with colored /skill @agent tokens */}
          <div
            ref={backdropRef}
            aria-hidden
            className="absolute inset-0 w-full px-4 pt-3 pb-1 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
            style={{ minHeight: 44, maxHeight: 200 }}
          >
            {segments.map((seg, i) =>
              seg.color
                ? <span key={i} style={{ color: seg.color, fontWeight: 600 }}>{seg.text}</span>
                : <span key={i} className="text-text">{seg.text}</span>
            )}
            {/* trailing newline guard */}
            {text.endsWith('\n') && <span>{'​'}</span>}
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            placeholder={dragOver ? 'Drop files here…' : 'Queue another message…  (/ skill, @ agent)'}
            rows={1}
            spellCheck={false}
            className={cn(
              'relative w-full bg-transparent px-4 pt-3 pb-1',
              'text-sm font-mono leading-relaxed',
              'text-transparent caret-accent placeholder-muted/60',
              'resize-none focus:outline-none',
            )}
            style={{ minHeight: 44, maxHeight: 200 }}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center gap-1 px-2 py-2">
          {/* Attach */}
          <button
            onClick={handlePickFiles}
            className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-lg hover:bg-surface2/50"
            title="Attach files"
          >
            <Plus className="w-4 h-4" />
          </button>

          {/* Slash commands */}
          <button
            onClick={() => { setShowCmds(s => !s); setCmdFilter(''); setShowLib(false) }}
            className={cn(
              'p-1.5 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
              showCmds ? 'text-accent' : 'text-muted hover:text-text',
            )}
            title="Slash commands"
          >
            <Slash className="w-4 h-4" />
          </button>

          {/* Library picker — insert skill / agent / plugin */}
          <button
            onClick={() => { setShowLib(s => !s); setLibFilter(''); setShowCmds(false) }}
            className={cn(
              'p-1.5 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
              showLib ? 'text-accent' : 'text-muted hover:text-text',
            )}
            title="Insert skill / agent / plugin"
          >
            <Boxes className="w-4 h-4" />
          </button>

          {/* Enter ↔ newline toggle */}
          <button
            onClick={() => setEnterNewline(v => !v)}
            className={cn(
              'p-1.5 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
              enterNewline ? 'text-accent' : 'text-muted hover:text-text',
            )}
            title={enterNewline ? 'Enter = new line (⌘/Ctrl+Enter to send)' : 'Enter = send (Shift+Enter for new line)'}
          >
            <CornerDownLeft className="w-4 h-4" />
          </button>

          {/* File chip count separator */}
          {files.length > 0 && (
            <div className="flex items-center gap-1 px-1 text-muted/50">
              <div className="w-px h-4 bg-white/10" />
              <FileText className="w-3 h-3" />
              <span className="text-xs font-mono">{files.length}</span>
            </div>
          )}

          <div className="flex-1" />

          {/* YOLO toggle */}
          <button
            onClick={() => onYoloChange?.(!yolo)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors rounded-lg',
              yolo ? 'text-warning bg-warning/10 hover:bg-warning/20' : 'text-muted hover:text-text hover:bg-surface2/50',
            )}
            title={yolo ? 'YOLO ON — auto-approve all tools' : 'YOLO — skip all confirmations'}
          >
            <Zap className={cn('w-3.5 h-3.5', yolo && 'fill-current')} />
            <span className="text-xs font-mono">YOLO</span>
          </button>

          {/* Permission mode (hidden when YOLO) */}
          {!yolo && (
            <button
              onClick={() => setShowPerms(s => !s)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
                showPerms ? 'text-accent' : 'text-muted hover:text-text',
              )}
              title={`Permission: ${currentPerm.desc}`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="text-xs font-mono">{currentPerm.label}</span>
            </button>
          )}

          {/* Model switcher */}
          <button
            onClick={() => setShowModels(s => !s)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
              showModels ? 'text-accent' : 'text-muted hover:text-text',
            )}
            title="Switch model"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="text-xs font-mono">{currentModel.label}</span>
          </button>

          {/* Voice */}
          {voiceSupported && (
            <button
              onClick={toggleVoice}
              className={cn(
                'p-1.5 cursor-pointer transition-colors rounded-lg hover:bg-surface2/50',
                listening ? 'text-error animate-pulse' : 'text-muted hover:text-text',
              )}
              title={listening ? 'Stop recording' : 'Voice input (Bahasa Indonesia)'}
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {/* Submit / Stop */}
          {streaming ? (
            <button
              onClick={onStop}
              className="p-2 rounded-xl bg-surface2 text-text hover:bg-surface2/70 cursor-pointer transition-colors"
              title="Stop"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              className={cn(
                'p-2 rounded-xl transition-all duration-200',
                canSend
                  ? 'bg-accent text-bg hover:bg-accent/90 glow-accent cursor-pointer'
                  : 'bg-surface2/60 text-muted cursor-not-allowed',
              )}
              title="Send (Enter)"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Listening hint */}
      {listening && (
        <div className="flex items-center gap-1.5 mt-1.5 px-1">
          <Loader2 className="w-3 h-3 text-error animate-spin" />
          <span className="text-xs font-mono text-muted">Mendengarkan… (Bahasa Indonesia)</span>
        </div>
      )}
    </div>
  )
}
