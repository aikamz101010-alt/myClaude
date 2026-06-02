import { useState, useEffect, useRef } from 'react'
import { useAgentStore } from '@/store/agentStore'
import { cn } from '@/lib/utils'
import { Send, Paperclip } from 'lucide-react'

interface Props {
  projectId: string
}

export function ChatView({ projectId }: Props) {
  const { outputs, sendMessage } = useAgentStore()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lines = outputs[projectId] ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    setSending(true)
    try {
      await sendMessage(projectId, input.trim())
      setInput('')
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

  // Group lines into paragraphs (split on blank lines or tool-call markers)
  const content = lines.join('\n')

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-surface2 flex items-center justify-center border border-white/5">
              <Send className="w-4 h-4 text-muted" />
            </div>
            <p className="text-sm text-muted font-mono">Start the agent, then send a message</p>
          </div>
        ) : (
          <div className="glass rounded-xl p-4 animate-fade-in">
            <pre className="text-xs font-mono text-text whitespace-pre-wrap leading-relaxed">
              {content}
            </pre>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-white/5 flex-shrink-0">
        <div className="flex items-end gap-2">
          <button className="p-2 text-muted hover:text-text cursor-pointer transition-colors flex-shrink-0">
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude... (Enter to send, Shift+Enter for newline)"
            rows={2}
            className={cn(
              'flex-1 bg-surface2 rounded-xl px-3 py-2',
              'text-sm font-mono text-text placeholder-muted',
              'resize-none focus:outline-none focus:ring-1 focus:ring-accent/40',
              'transition-all duration-150',
            )}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={cn(
              'p-2.5 rounded-xl cursor-pointer transition-all duration-200 flex-shrink-0',
              input.trim() && !sending
                ? 'bg-accent text-bg hover:bg-accent/90 glow-accent'
                : 'bg-surface2 text-muted cursor-not-allowed',
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted font-mono mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
