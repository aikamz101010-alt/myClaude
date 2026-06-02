import { useDraggable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { Zap, Bot, Plug, GripVertical } from 'lucide-react'
import type { SkillItem } from '@/store/libraryStore'

interface Props {
  item: SkillItem
}

const typeConfig = {
  skill: { Icon: Zap,  colorClass: 'text-yellow-400', bgClass: 'bg-yellow-400/10' },
  agent: { Icon: Bot,  colorClass: 'text-blue-400',   bgClass: 'bg-blue-400/10'  },
  mcp:   { Icon: Plug, colorClass: 'text-purple-400', bgClass: 'bg-purple-400/10' },
}

export function SkillCard({ item }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
  })

  const cfg = typeConfig[item.item_type as keyof typeof typeConfig] ?? typeConfig.skill

  return (
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
        isDragging
          ? 'opacity-40 scale-95 border-accent/40 bg-surface2'
          : 'border-white/5 bg-surface2/50 hover:bg-surface2 hover:border-white/15 cursor-grab active:cursor-grabbing',
      )}
      {...listeners}
      {...attributes}
    >
      <GripVertical className="w-3 h-3 text-muted/50 flex-shrink-0" />
      <div className={cn('p-1 rounded flex-shrink-0', cfg.bgClass)}>
        <cfg.Icon className={cn('w-3 h-3', cfg.colorClass)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-mono font-semibold text-text truncate">{item.name}</p>
        {item.description && (
          <p className="text-xs text-muted truncate leading-tight">{item.description}</p>
        )}
      </div>
    </div>
  )
}
