import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTagColors, type TagType } from '@/lib/tagColors'
import { cn } from '@/lib/utils'
import { Zap, Bot, Plug, X, Save, Code, Check, MessageSquareText, FileText, FileCode, Crown } from 'lucide-react'

export interface ContractItem {
  id: string
  name: string
  item_type: string
}

export interface ContractEditorHandle {
  addItem: (zone: string, item: { id: string; name: string; item_type: string }) => void
}

type Zone = 'skill' | 'agent' | 'mcp'

interface ZoneViewProps {
  zone: Zone
  label: string
  items: ContractItem[]
  onRemove: (id: string) => void
}

function ZoneView({ zone, label, items, onRemove }: ZoneViewProps) {
  const iconMap: Record<string, React.ElementType> = { skill: Zap, agent: Bot, mcp: Plug }
  const TAG_COLORS = useTagColors()
  const color = TAG_COLORS[(zone === 'mcp' ? 'plugin' : zone) as TagType]

  return (
    <div className="mb-5">
      <h3 className="text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">{label}</h3>
      <div className="min-h-12 p-2 rounded-xl border border-white/10 flex flex-wrap gap-2 items-start content-start">
        {items.map((item) => {
          const Icon = iconMap[item.item_type] ?? Zap
          return (
            <div key={item.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface2 border border-white/10 group/chip">
              <Icon className="w-3 h-3 flex-shrink-0" style={{ color }} />
              <span className="text-xs font-mono" style={{ color }}>{item.name}</span>
              <button onClick={() => onRemove(item.id)}
                className="opacity-0 group-hover/chip:opacity-100 cursor-pointer text-muted hover:text-error transition-all ml-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {items.length === 0 && (
          <p className="text-xs text-muted/60 font-mono self-center w-full text-center py-1">
            Click {label.toLowerCase()} in the Library → to add
          </p>
        )}
      </div>
    </div>
  )
}

interface Props {
  contractPath: string
  onGenerateDoc?: (type: 'PRD' | 'TRD') => void
}

let cidCounter = 0
const cid = () => `ci-${Date.now()}-${++cidCounter}`

export interface DocsConfig { prd: boolean; trd: boolean }
export type OrchScope = 'none' | 'project' | 'personal'

// Parse CONTRACT.md → items per zone + custom rules + docs config + orchestrator scope
function parseContractMd(md: string): {
  items: Record<Zone, ContractItem[]>; rules: string; docs: DocsConfig; orch: OrchScope
} {
  const items: Record<Zone, ContractItem[]> = { skill: [], agent: [], mcp: [] }
  const rulesLines: string[] = []
  const docs: DocsConfig = { prd: false, trd: false }
  let orch: OrchScope = 'none'
  let current: Zone | 'rules' | 'docs' | 'orch' | null = null

  for (const line of md.split('\n')) {
    const t = line.trim()
    const lower = t.toLowerCase()
    if (t.startsWith('#')) {
      if (lower.includes('orchestrator')) current = 'orch'
      else if (lower.includes('document')) current = 'docs'
      else if (lower.includes('skill')) current = 'skill'
      else if (lower.includes('agent')) current = 'agent'
      else if (lower.includes('mcp') || lower.includes('plugin')) current = 'mcp'
      else if (lower.includes('rule') || lower.includes('arahan') || lower.includes('instruction')) current = 'rules'
      else current = null
      continue
    }
    if (current === 'orch') {
      if (lower.includes('project')) orch = 'project'
      else if (lower.includes('personal')) orch = 'personal'
    } else if (current === 'docs') {
      if (lower.includes('prd.md')) docs.prd = true
      if (lower.includes('trd.md')) docs.trd = true
    } else if (current === 'rules') {
      rulesLines.push(line)
    } else if (current && (t.startsWith('-') || t.startsWith('*'))) {
      const name = t.replace(/^[-*]\s*/, '').trim()
      if (name) items[current].push({ id: cid(), name, item_type: current })
    }
  }
  return { items, rules: rulesLines.join('\n').trim(), docs, orch }
}

export const ContractEditor = forwardRef<ContractEditorHandle, Props>(({ contractPath, onGenerateDoc }, ref) => {
  const TAG_COLORS = useTagColors()
  const [items, setItems] = useState<Record<Zone, ContractItem[]>>({ skill: [], agent: [], mcp: [] })
  const [rules, setRules] = useState('')
  const [docs, setDocs] = useState<DocsConfig>({ prd: false, trd: false })
  const [orch, setOrch] = useState<OrchScope>('none')
  const [rawMode, setRawMode] = useState(false)
  const [rawContent, setRawContent] = useState('')
  const [saved, setSaved] = useState(false)

  // @-mention autocomplete for the rules textarea — ONLY items already added to the contract
  const rulesRef = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ query: string; pos: number } | null>(null)
  // Track last-saved docs so Save only auto-generates newly-enabled ones
  const savedDocsRef = useRef<DocsConfig>({ prd: false, trd: false })

  const mentionMatches = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const contractItems = [...items.skill, ...items.agent, ...items.mcp]
    return contractItems
      .filter(i => i.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [mention, items])

  // Load + parse contract on mount
  useEffect(() => {
    invoke<string>('read_contract', { contractPath })
      .then(md => {
        setRawContent(md)
        const parsed = parseContractMd(md)
        setItems(parsed.items)
        setRules(parsed.rules)
        setDocs(parsed.docs)
        setOrch(parsed.orch)
        savedDocsRef.current = parsed.docs   // existing docs won't re-generate
      })
      .catch(() => { setRawContent(''); setItems({ skill: [], agent: [], mcp: [] }); setRules(''); setDocs({ prd: false, trd: false }); setOrch('none'); savedDocsRef.current = { prd: false, trd: false } })
  }, [contractPath])

  // Expose addItem for drag-drop from ProjectWindow
  useImperativeHandle(ref, () => ({
    addItem: (zone, item) => {
      if (!['skill', 'agent', 'mcp'].includes(zone)) return
      const z = zone as Zone
      setItems(prev => {
        if (prev[z].some(i => i.name === item.name)) return prev
        return { ...prev, [z]: [...prev[z], { id: cid(), name: item.name, item_type: z }] }
      })
    },
  }), [])

  const removeItem = (zone: Zone, id: string) =>
    setItems(prev => ({ ...prev, [zone]: prev[zone].filter(i => i.id !== id) }))

  // Rules textarea: detect "@query" right before the cursor
  const handleRulesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setRules(val)
    const pos = e.target.selectionStart
    const before = val.slice(0, pos)
    const m = before.match(/@([\w-]*)$/)
    if (m) setMention({ query: m[1], pos })
    else setMention(null)
  }

  const insertMention = (name: string) => {
    if (!mention) return
    setRules(prev => {
      // Replace the "@query" right before mention.pos with "@name "
      const start = mention.pos - (mention.query.length + 1) // include '@'
      const next = prev.slice(0, start) + `@${name} ` + prev.slice(mention.pos)
      return next
    })
    setMention(null)
    requestAnimationFrame(() => rulesRef.current?.focus())
  }

  const colorForType = (t: string) =>
    TAG_COLORS[(t === 'mcp' ? 'plugin' : t) as TagType] ?? undefined

  // Color @tokens in the rules textarea by their contract-item type
  const rulesBackdropRef = useRef<HTMLDivElement>(null)
  const classifyRuleToken = (name: string): TagType | null => {
    const n = name.toLowerCase()
    if (items.skill.some(i => i.name.toLowerCase() === n)) return 'skill'
    if (items.agent.some(i => i.name.toLowerCase() === n)) return 'agent'
    if (items.mcp.some(i => i.name.toLowerCase() === n)) return 'plugin'
    return null
  }
  const rulesSegments = useMemo(() => {
    const out: { text: string; color?: string }[] = []
    const regex = /@[^\s@/]+/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(rules)) !== null) {
      if (m.index > last) out.push({ text: rules.slice(last, m.index) })
      const type = classifyRuleToken(m[0].slice(1))
      out.push({ text: m[0], color: type ? TAG_COLORS[type] : undefined })
      last = regex.lastIndex
    }
    if (last < rules.length) out.push({ text: rules.slice(last) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, items])

  const buildContractMd = () => {
    const lines = (zone: Zone) => items[zone].map(i => `- ${i.name}`).join('\n')
    const out = [
      '# Allowed Skills',
      lines('skill'),
      '',
      '# Active Agents',
      lines('agent'),
      '',
      '# Plugins',
      lines('mcp'),
      '',
    ]
    // Lead Orchestrator scope
    if (orch !== 'none') {
      out.push('# Lead Orchestrator')
      out.push(`Scope: ${orch}`)
      out.push('Each session, act as lead orchestrator and keep all work aligned with this contract, CLAUDE.md, and MEMORY.md.')
      out.push('')
    }
    // Only emit Documents section when at least one is enabled
    if (docs.prd || docs.trd) {
      out.push('# Documents')
      out.push('Keep these documents created and up to date whenever features or logic change:')
      if (docs.prd) out.push('- PRD.md')
      if (docs.trd) out.push('- TRD.md')
      out.push('')
    }
    out.push('# Custom Rules')
    out.push(rules.trim())
    out.push('')
    return out.join('\n')
  }

  const handleSave = async () => {
    const content = rawMode ? rawContent : buildContractMd()
    try {
      await invoke('write_contract', { contractPath, content })

      // Re-sync structured view if saved from raw
      let effectiveOrch = orch
      if (rawMode) {
        const parsed = parseContractMd(content)
        setItems(parsed.items)
        setRules(parsed.rules)
        setDocs(parsed.docs)
        setOrch(parsed.orch)
        effectiveOrch = parsed.orch
      } else {
        setRawContent(content)
      }

      // Auto-create the lead-orchestrator agent at the chosen scope (if missing)
      if (effectiveOrch !== 'none') {
        const projectPath = contractPath.replace(/\/CONTRACT\.md$/i, '')
        await invoke('ensure_lead_orchestrator', { scope: effectiveOrch, projectPath }).catch(() => {})
      }

      // Auto-generate newly-enabled docs (PRD/TRD) — only those toggled ON since last save
      const prev = savedDocsRef.current
      const toGen: ('PRD' | 'TRD')[] = []
      if (docs.prd && !prev.prd) toGen.push('PRD')
      if (docs.trd && !prev.trd) toGen.push('TRD')
      savedDocsRef.current = { ...docs }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)

      // Fire generation after save state settles (switches to chat)
      if (toGen.length > 0 && onGenerateDoc) {
        toGen.forEach((t, i) => setTimeout(() => onGenerateDoc(t), i * 300))
      }
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-sm font-mono font-bold text-text">CONTRACT.md</h2>
          <p className="text-xs text-muted font-mono truncate max-w-md">{contractPath}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setRawMode(m => !m)}
            className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors',
              rawMode ? 'bg-accent/10 text-accent border border-accent/20' : 'text-muted hover:text-text hover:bg-surface2/50')}>
            <Code className="w-3 h-3" /> Raw
          </button>
          <button onClick={handleSave}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
              saved ? 'bg-accent text-bg' : 'bg-surface2 text-text hover:bg-surface border border-white/10')}>
            {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {rawMode ? (
          <textarea
            value={rawContent}
            onChange={e => setRawContent(e.target.value)}
            className={cn('w-full h-full min-h-64 bg-surface2 rounded-xl p-3',
              'text-xs font-mono text-text resize-none focus:outline-none focus:ring-1 focus:ring-accent/40')}
            placeholder="# Allowed Skills&#10;- skill-name&#10;&#10;# Custom Rules&#10;Your instructions…"
          />
        ) : (
          <>
            {/* Purpose banner */}
            <div className="mb-4 p-3 rounded-xl bg-accent/5 border border-accent/15">
              <p className="text-xs font-mono text-text leading-relaxed">
                <span className="text-accent font-semibold">CONTRACT.md</span> = arahan & kesepakatan pengembangan project ini.
                Saat <span className="text-accent">Lead Orchestrator</span> aktif, tiap session otomatis menjaga main agent, subagent, skill & plugin bekerja sesuai contract ini (+ CLAUDE.md & MEMORY.md jika ada).
              </p>
            </div>

            {/* Lead Orchestrator scope */}
            <div className="mb-5">
              <h3 className="flex items-center gap-1.5 text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">
                <Crown className="w-3 h-3" /> Lead Orchestrator
              </h3>
              <div className="flex gap-1.5">
                {([
                  { v: 'none' as const,     label: 'Off',      desc: 'Plain Claude Code' },
                  { v: 'project' as const,  label: 'Project',  desc: 'agent di .claude/ project' },
                  { v: 'personal' as const, label: 'Personal', desc: 'agent di ~/.claude/' },
                ]).map(o => (
                  <button key={o.v} onClick={() => setOrch(o.v)} title={o.desc}
                    className={cn('flex-1 py-2 px-2 rounded-xl border text-xs font-mono cursor-pointer transition-all',
                      orch === o.v ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 bg-surface2/40 text-muted hover:text-text')}>
                    <div className="font-semibold">{o.label}</div>
                    <div className="text-[10px] opacity-60 truncate">{o.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted/50 font-mono mt-1.5">
                {orch === 'none'
                  ? 'Off → chat berperilaku seperti Claude Code biasa.'
                  : `On → tiap session aktifkan lead orchestrator. Save akan buat agent lead-orchestrator (${orch === 'project' ? 'project' : 'personal'}) jika belum ada.`}
              </p>
            </div>

            <ZoneView zone="skill" label="Skills" items={items.skill} onRemove={id => removeItem('skill', id)} />
            <ZoneView zone="agent" label="Agents" items={items.agent} onRemove={id => removeItem('agent', id)} />
            <ZoneView zone="mcp"   label="Plugins" items={items.mcp} onRemove={id => removeItem('mcp', id)} />

            {/* Custom Rules / Arahan — with @ mention */}
            <div className="mb-5">
              <h3 className="flex items-center gap-1.5 text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">
                <MessageSquareText className="w-3 h-3" /> Arahan / Custom Rules
              </h3>
              <div className="relative bg-surface2 rounded-xl focus-within:ring-1 focus-within:ring-accent/40">
                {/* Colored-token backdrop (behind, shows through transparent textarea) */}
                <div
                  ref={rulesBackdropRef}
                  aria-hidden
                  className="absolute inset-0 w-full p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words overflow-auto pointer-events-none"
                >
                  {rulesSegments.map((seg, i) =>
                    seg.color
                      ? <span key={i} style={{ color: seg.color, fontWeight: 600 }}>{seg.text}</span>
                      : <span key={i} className="text-text">{seg.text}</span>
                  )}
                  {rules.endsWith('\n') && <span>{'​'}</span>}
                </div>
                <textarea
                  ref={rulesRef}
                  value={rules}
                  onChange={handleRulesChange}
                  onKeyDown={e => { if (e.key === 'Escape') setMention(null) }}
                  onBlur={() => setTimeout(() => setMention(null), 150)}
                  onScroll={e => { if (rulesBackdropRef.current) rulesBackdropRef.current.scrollTop = e.currentTarget.scrollTop }}
                  rows={6}
                  spellCheck={false}
                  placeholder="Tulis arahan… (@ untuk skill/agent/plugin)"
                  className={cn('relative w-full bg-transparent rounded-xl p-3',
                    'text-xs font-mono text-transparent caret-accent placeholder-muted/50 resize-y',
                    'focus:outline-none leading-relaxed')}
                />
                {/* @ mention popup */}
                {mention && mentionMatches.length > 0 && (
                  <div className="absolute left-3 bottom-2 glass rounded-xl border border-white/10 shadow-2xl overflow-hidden z-20 min-w-[200px]">
                    <div className="px-3 py-1.5 border-b border-white/5">
                      <span className="text-xs font-mono text-muted">Insert skill / agent / plugin</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto p-1">
                      {mentionMatches.map(it => (
                        <button key={it.id}
                          onMouseDown={e => { e.preventDefault(); insertMention(it.name) }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-surface2/60 cursor-pointer transition-colors">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: colorForType(it.item_type) }} />
                          <span className="text-xs font-mono text-text flex-1 truncate">{it.name}</span>
                          <span className="text-xs font-mono text-muted/50 flex-shrink-0">{it.item_type}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted/50 font-mono mt-1">
                Disimpan ke <span className="text-text">CONTRACT.md</span> → dibaca tiap chat session baru. Ketik <span className="text-text">@</span> untuk sisipkan skill/agent/plugin.
              </p>
            </div>

            {/* Documents (PRD / TRD) — optional auto-maintain toggles */}
            <div className="mb-5">
              <h3 className="text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">
                Documents <span className="text-muted/40 normal-case">(optional)</span>
              </h3>
              <div className="space-y-2">
                {([
                  { key: 'prd' as const, type: 'PRD' as const, label: 'Product Requirements', Icon: FileText, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                  { key: 'trd' as const, type: 'TRD' as const, label: 'Technical Requirements', Icon: FileCode, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                ]).map(d => {
                  const enabled = docs[d.key]
                  return (
                    <div key={d.key}
                      className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border transition-all',
                        enabled ? 'border-accent/30 bg-accent/5' : 'border-white/10 bg-surface2/40')}>
                      {/* Toggle */}
                      <button
                        onClick={() => setDocs(prev => ({ ...prev, [d.key]: !prev[d.key] }))}
                        className={cn('relative w-8 h-4 rounded-full transition-colors flex-shrink-0 cursor-pointer',
                          enabled ? 'bg-accent' : 'bg-surface2 border border-white/15')}
                        title={enabled ? 'Auto-maintain enabled' : 'Enable auto-maintain'}>
                        <span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                          enabled ? 'left-4' : 'left-0.5')} />
                      </button>
                      <div className={cn('p-1 rounded flex-shrink-0', d.bg)}>
                        <d.Icon className={cn('w-3.5 h-3.5', d.color)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono font-semibold text-text">{d.type}.md</p>
                        <p className="text-xs text-muted/60 font-mono truncate">{d.label}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-muted/50 font-mono mt-1.5">
                Toggle ON → dicatat di <span className="text-text">CONTRACT.md</span> & otomatis di-generate saat <span className="text-text">Save</span> (kalau baru diaktifkan). Lalu Claude jaga dokumen tetap update.
              </p>
            </div>

            {/* Preview */}
            <div className="mt-4">
              <h3 className="text-xs font-mono font-semibold text-muted uppercase tracking-wider mb-2">Output Preview</h3>
              <pre className="bg-surface2 rounded-xl p-3 text-xs font-mono text-muted whitespace-pre-wrap">
                {buildContractMd()}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
})

ContractEditor.displayName = 'ContractEditor'
