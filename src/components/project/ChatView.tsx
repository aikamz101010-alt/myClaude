import { useState, useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Send, Trash2, AlertCircle, X, Bot, User } from 'lucide-react'

interface Props {
  projectId: string
  workingDir: string
}

interface Message {
  role: 'user' | 'assistant' | 'error'
  content: string
}

function parseMessages(lines: string[]): Message[] {
  const messages: Message[] = []
  let current: Message | null = null

  for (const line of lines) {
    if (line.startsWith('> ')) {
      if (current) messages.push(current)
      current = { role: 'user', content: line.slice(2) }
    } else if (line.startsWith('[Error]')) {
      if (current) messages.push(current)
      messages.push({ role: 'error', content: line.replace('[Error] ', '') })
      current = null
    } else {
      if (!current) {
        current = { role: 'assistant', content: line }
      } else if (current.role === 'assistant') {
        current.content += '\n' + line
      } else {
        messages.push(current)
        current = { role: 'assistant', content: line }
      }
    }
  }
  if (current) messages.push(current)
  return messages
}

export function ChatView({ projectId, workingDir }: Props) {
  const { outputs, statuses, chat, clearOutput } = useAgentStore()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const lines = outputs[projectId] ?? []
  const messages = parseMessages(lines)
  const status = statuses[projectId] ?? 'idle'
  const isRunning = status === 'running'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

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
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full transition-colors', {
            'bg-accent animate-pulse': isRunning,
            'bg-muted': status === 'idle',
            'bg-error': status === 'error',
          })} />
          <span className="text-xs font-mono text-muted">
            {isRunning ? 'Claude thinking...' : 'Claude Code — Chat'}
          </span>
        </div>
        <button
          onClick={() => clearOutput(projectId)}
          className="flex items-center gap-1 text-xs font-mono text-muted hover:text-text cursor-pointer transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Bot className="w-6 h-6 text-accent" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono font-semibold text-text mb-1">Claude Code CLI</p>
              <p className="text-xs text-muted font-mono">Type a message and press Enter</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role !== 'user' && (
                <div className={cn(
                  'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                  msg.role === 'error' ? 'bg-error/10' : 'bg-accent/10'
                )}>
                  {msg.role === 'error'
                    ? <AlertCircle className="w-3.5 h-3.5 text-error" />
                    : <Bot className="w-3.5 h-3.5 text-accent" />}
                </div>
              )}

              <div className={cn(
                'max-w-[80%] rounded-2xl px-4 py-3 text-sm font-mono',
                msg.role === 'user'
                  ? 'bg-accent/15 text-text border border-accent/20 rounded-tr-sm'
                  : msg.role === 'error'
                  ? 'bg-error/10 text-error border border-error/20'
                  : 'glass text-text rounded-tl-sm'
              )}>
                <pre className="whitespace-pre-wrap leading-relaxed text-xs">{msg.content}</pre>
              </div>

              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-lg bg-surface2 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-muted" />
                </div>
              )}
            </div>
          ))
        )}

        {isRunning && (
          <div className="flex gap-3 justify-start">
            <div className="w-6 h-6 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-accent" />
            </div>
            <div className="glass rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '200ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: '400ms' }} />
              </div>
            </div>
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
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            placeholder="Message Claude... (Enter to send, Shift+Enter new line)"
            rows={2}
            className={cn(
              'flex-1 bg-surface2 rounded-xl px-3 py-2.5',
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
        <p className="text-xs text-muted/50 font-mono mt-1.5 px-1">Enter to send · Shift+Enter new line</p>
      </div>
    </div>
  )
}
