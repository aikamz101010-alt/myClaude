import { useState, useEffect, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useLibraryStore, type SkillItem } from '@/store/libraryStore'
import { useSessionStore, type Message } from '@/store/sessionStore'
import { cn } from '@/lib/utils'
import { useTagColors, type TagType } from '@/lib/tagColors'
import { RefreshCw, CheckCircle, Circle, FileText, Loader2, ArrowRight, Bot, Clock, Search, X, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { AddFromURL } from '@/components/library/AddFromURL'

type Tab = 'skill' | 'agent' | 'plugin'

interface Props {
  contractPath: string
  activeChatId: string | null
}

// Parse CONTRACT.md → { skill, agent, mcp } sets
function parseContract(md: string): Record<'skill' | 'agent' | 'mcp', Set<string>> {
  const result = { skill: new Set<string>(), agent: new Set<string>(), mcp: new Set<string>() }
  let current: 'skill' | 'agent' | 'mcp' | null = null
  for (const line of md.split('\n')) {
    const t = line.trim()
    const lower = t.toLowerCase()
    if (t.startsWith('#')) {
      if (lower.includes('skill')) current = 'skill'
      else if (lower.includes('agent')) current = 'agent'
      else if (lower.includes('mcp') || lower.includes('plugin')) current = 'mcp'
      else current = null
      continue
    }
    if (current && (t.startsWith('-') || t.startsWith('*'))) {
      const name = t.replace(/^[-*]\s*/, '').trim()
      if (name) result[current].add(name.toLowerCase())
    }
  }
  return result
}

// Relative time
function relTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// Build searchable text from a message's tools (blocks + legacy toolUses)
function messageToolText(m: Message): string {
  let parts: string[] = []
  if (m.blocks) {
    for (const b of m.blocks) {
      if (b.type === 'tool') parts.push(`${b.name} ${b.input}`)
    }
  }
  if (m.toolUses) {
    for (const t of m.toolUses) parts.push(`${t.name} ${t.input_summary}`)
  }
  return parts.join(' ').toLowerCase()
}

export function ContractPanel({ contractPath, activeChatId }: Props) {
  const { items, rescan } = useLibraryStore()
  const { chats, chatsByProject, pushInsert } = useSessionStore()
  const TAG_COLORS = useTagColors()
  const [contract, setContract] = useState<Record<'skill' | 'agent' | 'mcp', Set<string>>>({
    skill: new Set(), agent: new Set(), mcp: new Set(),
  })
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'active' | 'list'>('active')
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [, forceTick] = useState(0)
  const toggleCollapse = (t: string) => setCollapsed(p => ({ ...p, [t]: !p[t] }))

  const activeChat = activeChatId ? chats[activeChatId] : undefined
  const isStreaming = activeChat?.status === 'streaming'
  const projectId = activeChat?.projectId

  // Re-render every 30s so "last run" stays fresh
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // In-progress tool text (working detection)
  const workingText = useMemo(() => {
    if (!activeChat || !isStreaming) return ''
    const msg = activeChat.messages.find(m => m.id === activeChat.streamingMsgId)
    if (!msg?.blocks) return ''
    return msg.blocks
      .filter(b => b.type === 'tool' && b.result === undefined)
      .map(b => b.type === 'tool' ? `${b.name} ${b.input}` : '')
      .join(' ')
      .toLowerCase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.messages, isStreaming])

  // Last-run map: item-name(lowercase) → latest timestamp it was referenced
  const lastRunMap = useMemo(() => {
    const map: Record<string, number> = {}
    const ids = projectId ? (chatsByProject[projectId] ?? []) : (activeChatId ? [activeChatId] : [])
    for (const cid of ids) {
      const c = chats[cid]
      if (!c) continue
      for (const m of c.messages) {
        if (m.role !== 'assistant') continue
        const text = messageToolText(m)
        if (!text) continue
        for (const it of items) {
          const key = it.name.toLowerCase()
          if (text.includes(key)) {
            if (!map[key] || m.timestamp > map[key]) map[key] = m.timestamp
          }
        }
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, chatsByProject, projectId, activeChatId, items])

  const loadContract = useCallback(() => {
    invoke<string>('read_contract', { contractPath })
      .then(md => setContract(parseContract(md)))
      .catch(() => setContract({ skill: new Set(), agent: new Set(), mcp: new Set() }))
  }, [contractPath])

  useEffect(() => { loadContract() }, [loadContract])

  const handleRefresh = async () => {
    setLoading(true)
    await rescan()
    loadContract()
    setLoading(false)
  }

  // Running subagent names from SDK SubagentStart/Stop hooks
  const activeAgentSet = useMemo(() => {
    const s = new Set<string>()
    for (const a of activeChat?.activeAgents ?? []) s.add(a.toLowerCase())
    return s
  }, [activeChat?.activeAgents])

  const isWorking = (item: SkillItem) => {
    const name = item.name.toLowerCase()
    // 1) running subagent (Task tool → SubagentStart hook), or
    // 2) name referenced by an in-progress tool/skill call
    return activeAgentSet.has(name) || (workingText.length > 0 && workingText.includes(name))
  }
  const lastRun = (item: SkillItem) => lastRunMap[item.name.toLowerCase()]

  // Main Claude agent state
  const mainModel = activeChat?.model
    ? activeChat.model.replace('claude-', '').replace(/-\d{8}$/, '')
    : 'default'
  const lastAssistant = activeChat?.messages?.filter(m => m.role === 'assistant').pop()

  // ── helpers ──
  const setForType = (t: Tab): Set<string> => (t === 'plugin' ? contract.mcp : contract[t as 'skill' | 'agent'])
  // in-contract items of a type (Active view)
  const itemsForType = (t: Tab): SkillItem[] => {
    const lt = t === 'plugin' ? ['plugin', 'mcp'] : [t]
    const cs = setForType(t)
    return items
      .filter(i => lt.includes(i.item_type) && cs.has(i.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  // all library items of a type, filtered by search (List view)
  const allOfType = (t: Tab): SkillItem[] => {
    const lt = t === 'plugin' ? ['plugin', 'mcp'] : [t]
    const q = search.toLowerCase().trim()
    return items
      .filter(i => lt.includes(i.item_type))
      .filter(i => !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // Render a single item row (used by both views)
  const renderItem = (item: SkillItem, t: Tab) => {
    const tagColor = TAG_COLORS[(t === 'plugin' ? 'plugin' : t) as TagType]
    const active = setForType(t).has(item.name.toLowerCase())
    const working = isWorking(item)
    const ran = lastRun(item)
    return (
      <button key={item.id}
        onClick={() => handleInsert2(item, t)}
        disabled={!activeChatId}
        title={activeChatId ? 'Click to add as tag in chat' : undefined}
        className={cn(
          'group/item w-full flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors text-left cursor-pointer',
          working ? 'ring-1' : active ? 'hover:bg-accent/5' : 'hover:bg-surface2/40 opacity-85 hover:opacity-100',
        )}
        style={working ? { backgroundColor: `${tagColor}1a`, boxShadow: `inset 0 0 0 1px ${tagColor}55` } : undefined}>
        {working
          ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 animate-spin" style={{ color: tagColor }} />
          : active
          ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: tagColor }} />
          : <Circle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: tagColor, opacity: 0.5 }} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="text-xs font-mono truncate"
              style={{ color: tagColor, fontWeight: working ? 600 : undefined }}>
              {item.name}
            </p>
            {working && <span className="text-xs font-mono flex-shrink-0" style={{ color: tagColor }}>running…</span>}
          </div>
          {item.description && <p className="text-xs text-muted/60 truncate leading-tight">{item.description}</p>}
          {ran && !working && (
            <div className="flex items-center gap-1 mt-0.5">
              <Clock className="w-2.5 h-2.5 text-muted/40" />
              <span className="text-xs font-mono text-muted/40">last run {relTime(ran)}</span>
            </div>
          )}
        </div>
        <ArrowRight className="w-3 h-3 text-muted/40 flex-shrink-0 mt-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity" />
      </button>
    )
  }

  // insert tag with explicit type (combined view knows the type per group)
  const handleInsert2 = (item: SkillItem, t: Tab) => {
    if (!activeChatId) return
    const tag = t === 'skill' ? `/${item.name}` : `@${item.name}`
    pushInsert(activeChatId, tag)
  }

  const groups: { t: Tab; label: string }[] = [
    { t: 'skill',  label: 'Skills'  },
    { t: 'agent',  label: 'Agents'  },
    { t: 'plugin', label: 'Plugins' },
  ]
  const totalInContract = groups.reduce((n, g) => n + setForType(g.t).size, 0)

  // Main Claude agent card (reused)
  const mainAgentCard = (
    <div className={cn('flex items-start gap-2 px-2 py-2 rounded-lg border',
      isStreaming ? 'bg-accent/10 border-accent/30' : 'bg-surface2/40 border-white/5')}>
      {isStreaming
        ? <Loader2 className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5 animate-spin" />
        : <Bot className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className={cn('text-xs font-mono font-semibold truncate', isStreaming ? 'text-accent' : 'text-text')}>Claude</p>
          <span className="text-xs font-mono text-accent/60 bg-accent/10 px-1 rounded flex-shrink-0">{mainModel}</span>
          {isStreaming && <span className="text-xs font-mono text-accent/70 flex-shrink-0">running…</span>}
        </div>
        <p className="text-xs text-muted/60 font-mono leading-tight">Main agent (orchestrator)</p>
        {lastAssistant && !isStreaming && (
          <div className="flex items-center gap-1 mt-0.5">
            <Clock className="w-2.5 h-2.5 text-muted/40" />
            <span className="text-xs font-mono text-muted/40">last run {relTime(lastAssistant.timestamp)}</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="w-64 flex flex-col bg-surface border-l border-white/5 flex-shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-mono font-bold text-text">Active</span>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setShowAdd(true)}
              className="p-1 text-muted hover:text-accent cursor-pointer rounded-md hover:bg-surface2/50 transition-colors"
              title="Add plugin / skill / agent from URL">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleRefresh}
              className="p-1 text-muted hover:text-accent cursor-pointer rounded-md hover:bg-surface2/50 transition-colors"
              title="Refresh from contract & library">
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted/60 font-mono">From CONTRACT.md</p>
      </div>

      {/* View tabs: Active | List */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5">
        <button onClick={() => setView('active')}
          className={cn('flex-1 py-1 rounded-md text-xs font-mono cursor-pointer transition-colors',
            view === 'active' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text')}>
          Active
        </button>
        <button onClick={() => setView('list')}
          className={cn('flex-1 py-1 rounded-md text-xs font-mono cursor-pointer transition-colors',
            view === 'list' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text')}>
          List
        </button>
      </div>

      {/* Search (List view only) */}
      {view === 'list' && (
        <div className="px-2 py-1.5 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search skills, plugins, agents…"
              className="w-full bg-surface2/60 rounded-lg pl-7 pr-6 py-1.5 text-xs font-mono text-text placeholder-muted/60 focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {view === 'active' ? (
          <>
            {/* Main agent (orchestrator) always on top */}
            {mainAgentCard}

            {/* Running subagents (from SDK hooks) — shown even if not in the contract */}
            {(activeChat?.activeAgents?.length ?? 0) > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-1 mb-1">
                  <Loader2 className="w-3 h-3 animate-spin" style={{ color: TAG_COLORS.agent }} />
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: TAG_COLORS.agent }}>
                    Running now
                  </span>
                  <span className="text-xs font-mono text-muted/40">({activeChat!.activeAgents.length})</span>
                </div>
                <div className="space-y-0.5">
                  {activeChat!.activeAgents.map(name => (
                    <div key={name}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg ring-1"
                      style={{ backgroundColor: `${TAG_COLORS.agent}1a`, boxShadow: `inset 0 0 0 1px ${TAG_COLORS.agent}55` }}>
                      <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" style={{ color: TAG_COLORS.agent }} />
                      <span className="text-xs font-mono font-semibold truncate" style={{ color: TAG_COLORS.agent }}>{name}</span>
                      <span className="text-xs font-mono ml-auto flex-shrink-0" style={{ color: TAG_COLORS.agent }}>running…</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {totalInContract === 0 && (activeChat?.activeAgents?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 gap-2 text-center px-3">
                <p className="text-xs text-muted font-mono">No active items</p>
                <p className="text-xs text-muted/50 font-mono">Add skills/agents/plugins in the Contract tab</p>
              </div>
            ) : (
              groups.map(g => {
                const list = itemsForType(g.t)
                if (list.length === 0) return null
                const color = TAG_COLORS[(g.t === 'plugin' ? 'plugin' : g.t) as TagType]
                return (
                  <div key={g.t}>
                    <div className="flex items-center gap-1.5 px-1 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color }}>{g.label}</span>
                      <span className="text-xs font-mono text-muted/40">({list.length})</span>
                    </div>
                    <div className="space-y-0.5">{list.map(item => renderItem(item, g.t))}</div>
                  </div>
                )
              })
            )}
          </>
        ) : (
          // List view: all library items grouped & colored, collapsible, click to insert tag
          groups.map(g => {
            const list = allOfType(g.t)
            if (list.length === 0) return null
            const color = TAG_COLORS[(g.t === 'plugin' ? 'plugin' : g.t) as TagType]
            const isCollapsed = collapsed[g.t]
            return (
              <div key={g.t}>
                <button onClick={() => toggleCollapse(g.t)}
                  className="w-full flex items-center gap-1.5 px-1 mb-1 cursor-pointer group/hdr">
                  {isCollapsed
                    ? <ChevronRight className="w-3 h-3 text-muted/50 flex-shrink-0" />
                    : <ChevronDown className="w-3 h-3 text-muted/50 flex-shrink-0" />}
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color }}>{g.label}</span>
                  <span className="text-xs font-mono text-muted/40">({list.length})</span>
                </button>
                {!isCollapsed && <div className="space-y-0.5">{list.map(item => renderItem(item, g.t))}</div>}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5">
        <p className="text-xs text-muted font-mono">
          {view === 'active' ? `${totalInContract} active in contract` : `${items.length} items · click to add to prompt`}
        </p>
      </div>

      {/* Add plugin / skill / agent from a GitHub URL — rescan on close so it appears */}
      {showAdd && <AddFromURL onClose={() => { setShowAdd(false); rescan() }} />}
    </div>
  )
}
