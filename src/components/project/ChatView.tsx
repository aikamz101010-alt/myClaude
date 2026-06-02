import { useState, useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Send, Paperclip, Trash2, AlertCircle, X } from 'lucide-react'

interface Props {
  projectId: string
  workingDir: string
}

export function ChatView({ projectId, workingDir }: Props) {
  const { outputs, statuses, chat, clearOutput } = useAgentStore()
  const [input, setInput] = useState('')
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
    if (!input.trim() || isRunning) return
    setError('')
    const msg = input.trim()
    setInput('')
    try {
      await chat(projectId, msg, workingDir)
    } catch (err) {
      setError(String(err))
    }
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', {
            'bg-accent animate-pulse': isRunning,
            'bg-muted': status === 'idle',
            'bg-error': status === 'error',
          })} />
          <span className="text-xs font-mono text-muted">
            {isRunning ? 'Claude thinking...' : status === 'error' ? 'Error' : 'Ready'}
          </span>
        </div>
        <button
          onClick={() => clearOutput(projectId)}
          className="flex items-center gap-1 text-xs font-mono text-muted hover:text-text cursor-pointer transition-colors"
          title="Clear chat"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-xl bg-surface2 flex items-center justify-center border border-white/5">
              <Send className="w-5 h-5 text-muted" />
            </div>
            <p className="text-sm text-muted font-mono text-center">
              Type a message and press Enter to chat with Claude
            </p>
          </div>
        ) : (
          <div className="glass rounded-xl p-4 animate-fade-in">
            <pre className="text-sm font-mono text-text whitespace-pre-wrap leading-relaxed">
              {lines.join('\n')}
            </pre>
          </div>
        )}

        {/* Thinking indicator */}
        {isRunning && (
          <div className="flex items-center gap-2 px-4 py-2 animate-fade-in">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs text-muted font-mono">Claude is thinking...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-error/10 border border-error/20">
          <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
          <p className="text-xs font-mono text-error flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-error/60 hover:text-error cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-white/5 flex-shrink-0">
        <div className="flex items-end gap-2">
          <button className="p-2 text-muted hover:text-text cursor-pointer transition-colors flex-shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder={isRunning ? 'Claude is thinking...' : 'Message Claude... (Enter to send)'}
            rows={2}
            className={cn(
              'flex-1 bg-surface2 rounded-xl px-3 py-2',
              'text-sm font-mono text-text placeholder-muted',
              'resize-none focus:outline-none focus:ring-1 focus:ring-accent/40',
              'transition-all duration-150',
              isRunning && 'opacity-60 cursor-not-allowed',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isRunning}
            className={cn(
              'p-2.5 rounded-xl transition-all duration-200 flex-shrink-0',
              input.trim() && !isRunning
                ? 'bg-accent text-bg hover:bg-accent/90 glow-accent cursor-pointer'
                : 'bg-surface2 text-muted cursor-not-allowed',
            )}
          >
            {isRunning
              ? <div className="w-4 h-4 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-muted/60 font-mono mt-1.5 px-1">Enter to send · Shift+Enter new line</p>
      </div>
    </div>
  )
}
