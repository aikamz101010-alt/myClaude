import { cn } from '@/lib/utils'
import { FolderOpen, Play, Trash2, Users } from 'lucide-react'

interface Props {
  project: { id: string; name: string; path: string }
  agentCount: number
  onOpen: () => void
  onDelete: () => void
}

export function ProjectCard({ project, agentCount, onOpen, onDelete }: Props) {
  return (
    <div
      className={cn(
        'glass rounded-xl p-4 group animate-fade-in',
        'hover:border-accent/40 transition-all duration-200',
        'hover:shadow-[0_0_24px_rgba(34,197,94,0.12)]',
        'border border-white/5'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="font-mono text-sm font-semibold text-text truncate">
            {project.name}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-error transition-all duration-150 cursor-pointer flex-shrink-0"
          title="Delete project"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-xs text-muted font-mono truncate mb-4">{project.path}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-muted" />
          {agentCount > 0 ? (
            <span className="text-xs text-accent font-mono font-semibold">
              {agentCount} running
            </span>
          ) : (
            <span className="text-xs text-muted font-mono">no agents</span>
          )}
        </div>
        <button
          onClick={onOpen}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
            'text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
            'bg-accent/10 text-accent hover:bg-accent hover:text-bg',
            'border border-accent/20 hover:border-accent',
          )}
        >
          <Play className="w-3 h-3" />
          Open
        </button>
      </div>
    </div>
  )
}
