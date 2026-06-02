import { cn } from '@/lib/utils'
import { Zap, Bot, Plug, Lock } from 'lucide-react'
import { useTagColors } from '@/lib/tagColors'
import type { SkillItem } from '@/store/libraryStore'
import { useState } from 'react'

interface Props {
  item: SkillItem
  onAdd?: (item: SkillItem) => void
}

const iconFor = (t: string) => (t === 'agent' ? Bot : (t === 'plugin' || t === 'mcp') ? Plug : Zap)

// Only SKILLS sourced from a plugin package are "locked" (they belong to the plugin).
// Plugin packages, MCP servers, and agents themselves remain clickable.
function isLockedByPlugin(item: SkillItem): boolean {
  if (item.item_type !== 'skill') return false
  return item.version === 'plugin' || item.source_path.includes('/plugins/cache/')
}

export function SkillCard({ item, onAdd }: Props) {
  const locked = isLockedByPlugin(item)
  const [showTooltip, setShowTooltip] = useState(false)
  const TAG_COLORS = useTagColors()
  const tagKey = item.item_type === 'agent' ? 'agent' : (item.item_type === 'plugin' || item.item_type === 'mcp') ? 'plugin' : 'skill'
  const cfg = { Icon: iconFor(item.item_type), color: TAG_COLORS[tagKey] }

  return (
    <div className="relative">
      <button
        onClick={() => { if (!locked) onAdd?.(item) }}
        disabled={locked}
        onMouseEnter={() => locked && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={cn(
          'group/card w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left',
          'transition-all duration-150 select-none',
          locked
            ? 'border-white/5 bg-surface2/30 opacity-70 cursor-not-allowed'
            : 'border-white/5 bg-surface2/50 hover:bg-surface2 hover:border-accent/30 cursor-pointer',
        )}
      >
        {locked && <Lock className="w-3 h-3 text-muted/40 flex-shrink-0" />}

        <div className="p-1 rounded flex-shrink-0" style={{ backgroundColor: `${cfg.color}1a` }}>
          <cfg.Icon className="w-3 h-3" style={{ color: cfg.color }} />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn('text-xs font-mono font-semibold truncate', locked ? 'text-text/60' : 'text-text')}>
            {item.name}
          </p>
          {item.description && (
            <p className="text-xs text-muted/70 truncate leading-tight">{item.description}</p>
          )}
          {item.model && (
            <span className="inline-block mt-0.5 text-xs font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
              {item.model.replace('claude-', '').replace('-latest', '')}
            </span>
          )}
        </div>
      </button>

      {/* Tooltip for locked skills */}
      {showTooltip && locked && (
        <div className={cn(
          'absolute left-0 bottom-full mb-1.5 z-50',
          'bg-surface border border-white/15 rounded-lg px-3 py-2',
          'shadow-xl text-xs font-mono text-muted w-52 animate-fade-in pointer-events-none',
        )}>
          <div className="flex items-center gap-1.5 mb-1">
            <Lock className="w-3 h-3 text-warning" />
            <span className="text-warning font-semibold">Locked by Plugin</span>
          </div>
          <p className="text-muted/80 leading-relaxed">
            Managed by a plugin package. Use <span className="text-text">+ Add from URL</span> for a custom copy.
          </p>
        </div>
      )}
    </div>
  )
}
