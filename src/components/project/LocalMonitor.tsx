import { useState } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { ChevronUp, ChevronDown } from 'lucide-react'

interface Props {
  projectId: string
}

export function LocalMonitor({ projectId }: Props) {
  const { statuses, outputs } = useAgentStore()
  const [expanded, setExpanded] = useState(false)
  const status = statuses[projectId] ?? 'idle'
  const lines = outputs[projectId] ?? []
  const lastLine = lines[lines.length - 1] ?? 'No output'

  const dotClass = {
    running: 'bg-accent animate-pulse',
    idle:    'bg-muted',
    error:   'bg-error',
  }[status]

  return (
    <div
      className={cn(
        'border-t border-white/5 bg-surface transition-all duration-200 flex-shrink-0',
        expanded ? 'h-40' : 'h-9',
      )}
    >
      {/* Strip header — always visible */}
      <div
        className="flex items-center gap-2.5 px-3 h-9 cursor-pointer hover:bg-surface2/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', dotClass)} />
        <span className="text-xs font-mono text-muted flex-1 truncate">{lastLine}</span>
        <span className="text-xs font-mono text-muted flex-shrink-0">
          {status}
        </span>
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted flex-shrink-0" />
          : <ChevronUp   className="w-3 h-3 text-muted flex-shrink-0" />}
      </div>

      {/* Expanded log */}
      {expanded && (
        <div className="px-3 pb-2 h-[calc(100%-36px)] overflow-y-auto">
          <div className="space-y-0.5">
            {lines.slice(-100).map((line, i) => (
              <div key={i} className="text-xs font-mono text-muted leading-5">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
