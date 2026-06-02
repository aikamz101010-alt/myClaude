import { cn } from '@/lib/utils'
import { FolderOpen, Play, Trash2, Users, Clock } from 'lucide-react'
import type { Project } from '@/store/projectStore'

interface Props {
  project: Project
  agentCount: number
  onOpen: () => void
  onDelete: () => void
}

function formatRelativeTime(unixSecs: number): string {
  if (!unixSecs) return 'never'
  const diffSecs = Math.floor(Date.now() / 1000) - unixSecs
  if (diffSecs < 60)  return 'just now'
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`
  if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)}d ago`
  // Older — show date
  return new Date(unixSecs * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function ProjectCard({ project, agentCount, onOpen, onDelete }: Props) {
  const lastOpenedLabel = formatRelativeTime(project.last_opened)

  return (
    <div
      className={cn(
        'glass rounded-xl p-4 group animate-fade-in',
        'border border-white/5',
        'hover:border-accent/40 transition-all duration-200',
        'hover:shadow-[0_0_24px_rgba(34,197,94,0.12)]',
        'flex flex-col gap-3',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="font-mono text-sm font-semibold text-text truncate">
            {project.name}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-error transition-all duration-150 cursor-pointer flex-shrink-0 rounded"
          title="Remove from list"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Path */}
      <p className="text-xs text-muted font-mono truncate -mt-1">{project.path}</p>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs font-mono text-muted">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{lastOpenedLabel}</span>
        </div>
        {agentCount > 0 && (
          <>
            <span>·</span>
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3 text-accent" />
              <span className="text-accent font-semibold">{agentCount} running</span>
            </div>
          </>
        )}
      </div>

      {/* Open button */}
      <button
        onClick={onOpen}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg',
          'text-xs font-mono font-semibold cursor-pointer transition-all duration-200',
          'bg-accent/10 text-accent hover:bg-accent hover:text-bg',
          'border border-accent/20 hover:border-accent',
        )}
      >
        <Play className="w-3 h-3" />
        Open Project
      </button>
    </div>
  )
}
