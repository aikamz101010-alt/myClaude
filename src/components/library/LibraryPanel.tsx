import { useState } from 'react'
import { useLibraryStore } from '@/store/libraryStore'
import { SkillCard } from './SkillCard'
import { Search, Plus, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'skill' | 'agent' | 'mcp'

const tabs: { key: Tab; label: string }[] = [
  { key: 'skill', label: 'Skills' },
  { key: 'agent', label: 'Agents' },
  { key: 'mcp',   label: 'MCP'    },
]

interface Props {
  onAddFromURL?: () => void
}

export function LibraryPanel({ onAddFromURL }: Props) {
  const { items, rescan } = useLibraryStore()
  const [activeTab, setActiveTab] = useState<Tab>('skill')
  const [search, setSearch] = useState('')

  const counts = {
    skill: items.filter((i) => i.item_type === 'skill').length,
    agent: items.filter((i) => i.item_type === 'agent').length,
    mcp:   items.filter((i) => i.item_type === 'mcp').length,
  }

  const filtered = items.filter(
    (i) =>
      i.item_type === activeTab &&
      i.name.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="w-64 flex flex-col bg-surface border-l border-white/5 flex-shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-xs font-mono font-bold text-text">Library</span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onAddFromURL}
              className="p-1.5 text-muted hover:text-accent cursor-pointer transition-colors rounded-md hover:bg-surface2/50"
              title="Add skill from URL"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={rescan}
              className="p-1.5 text-muted hover:text-text cursor-pointer transition-colors rounded-md hover:bg-surface2/50"
              title="Re-scan"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className={cn(
              'w-full bg-surface2 rounded-lg pl-7 pr-3 py-1.5',
              'text-xs font-mono text-text placeholder-muted',
              'focus:outline-none focus:ring-1 focus:ring-accent/40',
              'transition-all duration-150',
            )}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex-1 py-2 text-xs font-mono transition-colors cursor-pointer',
              activeTab === t.key
                ? 'text-accent border-b-2 border-accent'
                : 'text-muted hover:text-text',
            )}
          >
            {t.label}
            <span className="ml-1 text-muted">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <p className="text-xs text-muted text-center font-mono">
              {search ? `No "${search}" found` : `No ${activeTab}s detected`}
            </p>
            {!search && (
              <button
                onClick={rescan}
                className="text-xs text-accent font-mono cursor-pointer hover:underline"
              >
                Re-scan
              </button>
            )}
          </div>
        ) : (
          filtered.map((item) => <SkillCard key={item.id} item={item} />)
        )}
      </div>

      {/* Footer: total count */}
      <div className="px-3 py-2 border-t border-white/5">
        <p className="text-xs text-muted font-mono">
          {items.length} items detected
        </p>
      </div>
    </div>
  )
}
