import { cn } from '@/lib/utils'
import { FolderOpen, Trash2, Clock, Zap } from 'lucide-react'
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
  return new Date(unixSecs * 1000).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function ProjectCard({ project, agentCount, onOpen, onDelete }: Props) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        'glass rounded-xl p-4 group animate-fade-in',
        'border border-white/5 cursor-pointer',
        'hover:border-accent/40 hover:bg-[rgba(34,197,94,0.04)]',
        'transition-all duration-200',
        'hover:shadow-[0_0_24px_rgba(34,197,94,0.10)]',
        'flex flex-col gap-2.5 relative',
        agentCount > 0 && 'border-accent/20 shadow-[0_0_12px_rgba(34,197,94,0.07)]',
      )}
    >
      {/* Delete button — top-right, visible on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-error transition-all duration-150 cursor-pointer rounded"
        title="Remove from list"
      >
        <Trash2 className="w-3 h-3" />
      </button>

      {/* Icon + Name */}
      <div className="flex items-center gap-2 pr-6">
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
          agentCount > 0 ? 'bg-accent/15' : 'bg-surface2 group-hover:bg-accent/10'
        )}>
          <FolderOpen className={cn(
            'w-3.5 h-3.5 transition-colors',
            agentCount > 0 ? 'text-accent' : 'text-muted group-hover:text-accent'
          )} />
        </div>
        <span className="font-mono text-sm font-semibold text-text truncate">
          {project.name}
        </span>
      </div>

      {/* Path */}
      <p className="text-xs text-muted font-mono truncate leading-tight">{project.path}</p>

      {/* Meta */}
      <div className="flex items-center gap-2 text-xs font-mono text-muted">
        <Clock className="w-3 h-3 flex-shrink-0" />
        <span>{formatRelativeTime(project.last_opened)}</span>
        {agentCount > 0 && (
          <>
            <span className="text-muted/40">·</span>
            <Zap className="w-3 h-3 text-accent flex-shrink-0" />
            <span className="text-accent font-semibold">{agentCount} active</span>
          </>
        )}
      </div>
    </div>
  )
}
