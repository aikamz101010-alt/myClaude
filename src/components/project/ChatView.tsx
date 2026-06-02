import { useState, useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Send, Paperclip, Play, AlertCircle, X } from 'lucide-react'

interface Props {
  projectId: string
  onStartAgent?: () => void
}

export function ChatView({ projectId, onStartAgent }: Props) {
  const { outputs, statuses, sendMessage } = useAgentStore()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lines = outputs[projectId] ?? []
  const status = statuses[projectId] ?? 'idle'
  const isRunning = status === 'running'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const handleSend = async () => {
    if (!input.trim() || sending) return

    if (!isRunning) {
      setError('Agent is not running. Click Start first.')
      return
    }

    setError('')
    setSending(true)
    try {
      await sendMessage(projectId, input.trim())
      setInput('')
      textareaRef.current?.focus()
    } catch (err) {
      setError(`Failed to send: ${String(err)}`)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            {!isRunning ? (
              <>
                <div className="w-12 h-12 rounded-xl bg-surface2 flex items-center justify-center border border-white/5">
                  <Play className="w-5 h-5 text-muted" />
                </div>
                <div>
                  <p className="text-sm text-text font-mono font-semibold mb-1">Agent not started</p>
                  <p className="text-xs text-muted font-mono">Click <span className="text-accent">Start</span> in the toolbar to launch Claude CLI</p>
                </div>
                {onStartAgent && (
                  <button
                    onClick={onStartAgent}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-bg text-sm font-mono font-semibold cursor-pointer hover:bg-accent/90 transition-colors glow-accent"
                  >
                    <Play className="w-4 h-4" /> Start Agent
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center border border-accent/20">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                </div>
                <p className="text-sm text-muted font-mono">Agent running — send a message below</p>
              </>
            )}
          </div>
        ) : (
          <div className="glass rounded-xl p-4 animate-fade-in">
            <pre className="text-xs font-mono text-text whitespace-pre-wrap leading-relaxed">
              {lines.join('\n')}
            </pre>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-error/10 border border-error/20 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
          <p className="text-xs font-mono text-error flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-error/60 hover:text-error cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="p-3 border-t border-white/5 flex-shrink-0">
        {/* Status indicator */}
        <div className="flex items-center gap-1.5 mb-2 px-1">
          <div className={cn('w-1.5 h-1.5 rounded-full', {
            'bg-accent animate-pulse': isRunning,
            'bg-muted': status === 'idle',
            'bg-error': status === 'error',
          })} />
          <span className="text-xs font-mono text-muted">
            {isRunning ? 'Agent running' : status === 'error' ? 'Agent error' : 'Agent stopped'}
          </span>
        </div>

        <div className="flex items-end gap-2">
          <button className="p-2 text-muted hover:text-text cursor-pointer transition-colors flex-shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isRunning}
            placeholder={isRunning ? 'Message Claude... (Enter to send)' : 'Start agent to send messages'}
            rows={2}
            className={cn(
              'flex-1 bg-surface2 rounded-xl px-3 py-2',
              'text-sm font-mono text-text placeholder-muted',
              'resize-none focus:outline-none focus:ring-1 focus:ring-accent/40',
              'transition-all duration-150',
              !isRunning && 'opacity-50 cursor-not-allowed',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending || !isRunning}
            className={cn(
              'p-2.5 rounded-xl transition-all duration-200 flex-shrink-0',
              input.trim() && !sending && isRunning
                ? 'bg-accent text-bg hover:bg-accent/90 glow-accent cursor-pointer'
                : 'bg-surface2 text-muted cursor-not-allowed',
            )}
          >
            {sending
              ? <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
        <p className="text-xs text-muted/60 font-mono mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
