import { cn } from '@/lib/utils'

export interface AgentRow {
  id: string
  projectName: string
  status: 'running' | 'idle' | 'error'
  tokensIn: number
  tokensOut: number
  runtimeSecs: number
}

interface Props {
  agents: AgentRow[]
}

const statusConfig = {
  running: { dot: 'bg-accent animate-pulse', label: 'running', color: 'text-accent' },
  idle:    { dot: 'bg-muted',                label: 'idle',    color: 'text-muted'   },
  error:   { dot: 'bg-error',               label: 'error',   color: 'text-error'   },
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatTokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function GlobalMonitor({ agents }: Props) {
  const running = agents.filter((a) => a.status === 'running').length
  const total = agents.length

  return (
    <div className="glass rounded-xl p-4 flex flex-col h-full border border-white/5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-mono font-bold text-text">Agent Monitor</h2>
        <div className="flex items-center gap-2">
          {running > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-xs font-mono text-accent">{running} running</span>
            </div>
          )}
          <span className="text-xs font-mono text-muted">{total} total</span>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted font-mono text-center">
            No agents yet.
            <br />
            Open a project to start.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {agents.map((agent) => {
            const cfg = statusConfig[agent.status]
            return (
              <div
                key={agent.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg',
                  'bg-surface2/50 hover:bg-surface2 transition-colors duration-150',
                )}
              >
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-text truncate">{agent.projectName}</p>
                  <p className={cn('text-xs font-mono', cfg.color)}>{cfg.label}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <span className="text-xs font-mono text-muted">
                    ↑{formatTokens(agent.tokensIn)} ↓{formatTokens(agent.tokensOut)}
                  </span>
                  <span className="text-xs font-mono text-muted">
                    {formatTime(agent.runtimeSecs)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Stats footer */}
      {agents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="flex justify-between text-xs font-mono text-muted">
            <span>
              Total ↑{formatTokens(agents.reduce((sum, a) => sum + a.tokensIn, 0))}
            </span>
            <span>
              ↓{formatTokens(agents.reduce((sum, a) => sum + a.tokensOut, 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
