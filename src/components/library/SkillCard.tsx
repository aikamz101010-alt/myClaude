import { useDraggable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { Zap, Bot, Plug, GripVertical, Lock } from 'lucide-react'
import type { SkillItem } from '@/store/libraryStore'
import { useState } from 'react'

interface Props {
  item: SkillItem
}

const typeConfig = {
  skill: { Icon: Zap,  colorClass: 'text-yellow-400', bgClass: 'bg-yellow-400/10' },
  agent: { Icon: Bot,  colorClass: 'text-blue-400',   bgClass: 'bg-blue-400/10'  },
  mcp:   { Icon: Plug, colorClass: 'text-purple-400', bgClass: 'bg-purple-400/10' },
}

// Skills that come from a plugin package are "locked" — they belong to
// the plugin and shouldn't be moved; only personal (~/.claude/skills/) are free.
function isLockedByPlugin(item: SkillItem): boolean {
  return item.version === 'plugin' ||
    item.source_path.includes('/plugins/cache/')
}

export function SkillCard({ item }: Props) {
  const locked = isLockedByPlugin(item)
  const [showTooltip, setShowTooltip] = useState(false)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
    disabled: locked,
  })

  const cfg = typeConfig[item.item_type as keyof typeof typeConfig] ?? typeConfig.skill

  return (
    <div className="relative">
      <div
        ref={setNodeRef}
        style={
          transform
            ? {
                transform: `translate3d(${transform.x}px,${transform.y}px,0)`,
                zIndex: 1000,
                position: 'relative',
              }
            : undefined
        }
        className={cn(
          'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border',
          'transition-all duration-150 select-none',
          locked
            ? 'border-white/5 bg-surface2/30 opacity-70 cursor-not-allowed'
            : isDragging
            ? 'opacity-40 scale-95 border-accent/40 bg-surface2'
            : 'border-white/5 bg-surface2/50 hover:bg-surface2 hover:border-white/15 cursor-grab active:cursor-grabbing',
        )}
        {...(!locked ? listeners : {})}
        {...(!locked ? attributes : {})}
        onMouseEnter={() => locked && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {/* Drag handle or locked icon */}
        {locked
          ? <Lock className="w-3 h-3 text-muted/40 flex-shrink-0" />
          : <GripVertical className="w-3 h-3 text-muted/50 flex-shrink-0" />
        }

        <div className={cn('p-1 rounded flex-shrink-0', cfg.bgClass)}>
          <cfg.Icon className={cn('w-3 h-3', cfg.colorClass)} />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn(
            'text-xs font-mono font-semibold truncate',
            locked ? 'text-text/60' : 'text-text',
          )}>
            {item.name}
          </p>
          {item.description && (
            <p className="text-xs text-muted/70 truncate leading-tight">{item.description}</p>
          )}
          {/* Model badge for agents */}
          {item.model && (
            <span className="inline-block mt-0.5 text-xs font-mono text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
              {item.model.replace('claude-', '').replace('-latest', '')}
            </span>
          )}
        </div>
      </div>

      {/* Tooltip for locked skills */}
      {showTooltip && locked && (
        <div className={cn(
          'absolute left-0 bottom-full mb-1.5 z-50',
          'bg-surface border border-white/15 rounded-lg px-3 py-2',
          'shadow-xl text-xs font-mono text-muted w-52',
          'animate-fade-in pointer-events-none',
        )}>
          <div className="flex items-center gap-1.5 mb-1">
            <Lock className="w-3 h-3 text-warning" />
            <span className="text-warning font-semibold">Locked by Plugin</span>
          </div>
          <p className="text-muted/80 leading-relaxed">
            This skill is managed by a plugin package and cannot be dragged to contracts.
            Use <span className="text-text">+ Add from URL</span> to add a custom copy.
          </p>
        </div>
      )}
    </div>
  )
}
