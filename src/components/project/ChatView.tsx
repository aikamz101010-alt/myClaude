import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSessionStore, type Message, type Block } from '@/store/sessionStore'
import { useAvatarStore } from '@/store/avatarStore'
import { LiveBadge } from './LiveBadge'
import { ChatInput, type AttachedFile } from './ChatInput'
import { cn } from '@/lib/utils'
import {
  Trash2, Terminal as TerminalIcon, RefreshCw, Bot, User,
  AlertCircle, DollarSign, ChevronDown, ChevronRight, Wrench,
  Copy, Check, ShieldAlert, CornerDownLeft,
} from 'lucide-react'

interface Props {
  chatId: string
  slashCommands?: string[]
}

// ── Token formatter ───────────────────────────────────────────────
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Copy button ───────────────────────────────────────────────────
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }
  return (
    <button
      onClick={handleCopy}
      className={cn('p-1 rounded-md text-muted hover:text-text hover:bg-surface2/60 cursor-pointer transition-colors', className)}
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-accent" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

// ── Markdown ──────────────────────────────────────────────────────
function Md({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children }) {
          const inline = !className
          const lang = className?.replace('language-', '') ?? ''
          if (inline) {
            return <code className="px-1 py-0.5 rounded text-xs font-mono bg-surface2/80 text-accent">{children}</code>
          }
          const codeText = String(children).replace(/\n$/, '')
          return (
            <div className="my-2 rounded-lg overflow-hidden border border-white/10 group/code">
              <div className="flex items-center justify-between px-3 py-1 bg-surface2/60 border-b border-white/5">
                <span className="text-xs font-mono text-muted">{lang || 'code'}</span>
                <CopyButton text={codeText} className="opacity-0 group-hover/code:opacity-100" />
              </div>
              <pre className="p-3 overflow-x-auto bg-surface/60"><code className="text-xs font-mono text-text">{children}</code></pre>
            </div>
          )
        },
        p({ children })          { return <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p> },
        ul({ children })         { return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul> },
        ol({ children })         { return <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol> },
        li({ children })         { return <li className="text-text">{children}</li> },
        h1({ children })         { return <h1 className="text-base font-bold mb-1 text-text">{children}</h1> },
        h2({ children })         { return <h2 className="text-sm font-bold mb-1 text-text">{children}</h2> },
        h3({ children })         { return <h3 className="text-xs font-bold mb-1 text-text">{children}</h3> },
        strong({ children })     { return <strong className="font-semibold text-text">{children}</strong> },
        em({ children })         { return <em className="italic text-muted">{children}</em> },
        a({ href, children })    { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-accent/80">{children}</a> },
        blockquote({ children }) { return <blockquote className="border-l-2 border-accent/40 pl-3 text-muted italic my-1.5">{children}</blockquote> },
        hr()                     { return <hr className="border-white/10 my-2" /> },
        table({ children })      { return <div className="overflow-x-auto my-2"><table className="text-xs font-mono border-collapse w-full">{children}</table></div> },
        th({ children })         { return <th className="border border-white/10 px-2 py-1 bg-surface2/60 text-left font-semibold">{children}</th> },
        td({ children })         { return <td className="border border-white/10 px-2 py-1">{children}</td> },
      }}
    >{content}</ReactMarkdown>
  )
}

// ── Tool card (live) ──────────────────────────────────────────────
function ToolCard({ name, input, result }: { name: string; input: string; result?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 rounded-lg border border-white/10 bg-surface2/30 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface2/40 cursor-pointer transition-colors"
      >
        <Wrench className="w-3 h-3 text-accent/70 flex-shrink-0" />
        <span className="text-xs font-mono font-semibold text-accent/90 flex-shrink-0">{name}</span>
        <span className="text-xs font-mono text-muted/70 truncate flex-1 text-left">{input}</span>
        {result !== undefined && (
          open ? <ChevronDown className="w-3 h-3 text-muted flex-shrink-0" />
               : <ChevronRight className="w-3 h-3 text-muted flex-shrink-0" />
        )}
        {result === undefined && (
          <div className="w-3 h-3 border-[1.5px] border-accent/40 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
      </button>
      {open && result !== undefined && (
        <pre className="px-3 py-2 text-xs font-mono text-muted/80 bg-surface/40 border-t border-white/5 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto">
          {result || '(no output)'}
        </pre>
      )}
    </div>
  )
}

// ── Legacy tool list (imported from terminal) ─────────────────────
function LegacyToolList({ tools }: { tools: Message['toolUses'] }) {
  const [open, setOpen] = useState(false)
  if (!tools || tools.length === 0) return null
  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs font-mono text-muted/60 hover:text-muted cursor-pointer">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {tools.length} tool use{tools.length > 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 pl-1 border-l border-white/10">
          {tools.map((t, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="text-xs font-mono font-semibold text-accent/70 flex-shrink-0">{t.name}</span>
              {t.input_summary && <span className="text-xs font-mono text-muted/50 truncate">{t.input_summary}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Plain-text extractor (for copying whole assistant message) ────
function messageToText(msg: Message): string {
  if (msg.blocks && msg.blocks.length > 0) {
    return msg.blocks.map(b =>
      b.type === 'text' ? b.text : `[${b.name}] ${b.input}${b.result ? `\n${b.result}` : ''}`
    ).join('\n\n')
  }
  return msg.content
}

// ── Message bubble ────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  // System marker (e.g. model switch)
  if (msg.role === 'system') {
    return (
      <div className="flex items-center justify-center py-1">
        <span className="text-xs font-mono text-muted/60 tracking-wide">{msg.content}</span>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end gap-2 group">
        <div className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-accent/15 border border-accent/25 text-text">
          <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{msg.content}</pre>
        </div>
        <div className="w-7 h-7 rounded-xl bg-surface2 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-3.5 h-3.5 text-muted" />
        </div>
      </div>
    )
  }

  if (msg.role === 'error') {
    return (
      <div className="flex gap-2">
        <div className="w-7 h-7 rounded-xl bg-error/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle className="w-3.5 h-3.5 text-error" />
        </div>
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-sm bg-error/10 border border-error/20 text-error text-xs font-mono whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    )
  }

  // Assistant
  const hasBlocks = msg.blocks && msg.blocks.length > 0
  const copyText = messageToText(msg)
  return (
    <div className="flex gap-2 group">
      <div className="w-7 h-7 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5 border border-accent/15">
        <Bot className="w-3.5 h-3.5 text-accent" />
      </div>
      <div className="max-w-[85%] flex flex-col gap-1 min-w-0">
        {hasBlocks ? (
          <div className="relative px-4 py-3 rounded-2xl rounded-tl-sm glass border border-white/8 text-sm text-text">
            {copyText.trim() && (
              <CopyButton text={copyText} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-surface/60" />
            )}
            {msg.blocks!.map((b: Block, i) =>
              b.type === 'text'
                ? <Md key={i} content={b.text} />
                : <ToolCard key={i} name={b.name} input={b.input} result={b.result} />
            )}
          </div>
        ) : msg.content ? (
          <div className={cn('relative px-4 py-3 rounded-2xl rounded-tl-sm glass border border-white/8 text-sm text-text', msg.fromTerminal && 'border-accent/10')}>
            <CopyButton text={msg.content} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-surface/60" />
            <Md content={msg.content} />
            <LegacyToolList tools={msg.toolUses} />
          </div>
        ) : null}

        {(msg.inputTokens !== undefined || msg.costUsd !== undefined) && (
          <div className="flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {msg.inputTokens !== undefined && <span className="text-xs font-mono text-muted/50">↑{msg.inputTokens} ↓{msg.outputTokens ?? 0} tok</span>}
            {msg.costUsd !== undefined && <span className="flex items-center gap-0.5 text-xs font-mono text-muted/50"><DollarSign className="w-2.5 h-2.5" />{msg.costUsd.toFixed(4)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ChatView ──────────────────────────────────────────────────────
export function ChatView({ chatId, slashCommands }: Props) {
  const { chats, sendMessageStream, clearMessages, importFromTerminal, subscribeChat, setChatModel, setChatPermissionMode, setChatYolo, respondPermission, interruptChat, pendingInsert, consumeInsert } = useSessionStore()
  const chat = chats[chatId]
  const injectText = pendingInsert[chatId]

  const [syncing, setSyncing] = useState(false)
  const [permMsg, setPermMsg] = useState('')  // custom instruction for the permission popup
  const bottomRef = useRef<HTMLDivElement>(null)

  const liveAssistant = useAvatarStore(s => s.liveAssistant)

  const messages  = chat?.messages ?? []
  const streaming = chat?.status === 'streaming'
  const sessionId = chat?.sessionId ?? null
  const totalIn   = chat?.totalInputTokens ?? 0
  const totalOut  = chat?.totalOutputTokens ?? 0
  const pendingPermission = chat?.pendingPermission ?? null

  // Subscribe to stream events. Guard the async race: if cleanup runs before
  // the listener resolves, unlisten immediately so we never leak a duplicate.
  useEffect(() => {
    let cancelled = false
    let cancel: (() => void) | null = null
    subscribeChat(chatId).then(fn => { if (cancelled) fn(); else cancel = fn })
    return () => { cancelled = true; cancel?.() }
  }, [chatId])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const handleSend = (text: string, files: AttachedFile[]) => {
    // Prepend attached file paths so Claude reads them (uses @path convention)
    const fileRefs = files.map(f => `@${f.path}`).join(' ')
    const full = fileRefs ? `${fileRefs}\n${text}` : text
    sendMessageStream(chatId, full)
  }

  const handleSync = async () => {
    setSyncing(true)
    await importFromTerminal(chatId)
    setSyncing(false)
  }

  if (!chat) {
    return <div className="flex items-center justify-center h-full text-muted font-mono text-xs">No chat selected</div>
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('w-2 h-2 rounded-full flex-shrink-0 transition-colors',
            streaming ? 'bg-accent animate-pulse' : sessionId ? 'bg-accent' : 'bg-muted')} />
          <span className="text-xs font-mono text-muted truncate">
            {streaming ? 'Claude is working…' : sessionId ? `Session ${sessionId.slice(0, 8)}…` : 'New conversation'}
          </span>
          {(totalIn > 0 || totalOut > 0) && (
            <span className="text-xs font-mono text-muted/50 flex-shrink-0" title="Total tokens (input / output)">
              · ↑{fmtTokens(totalIn)} ↓{fmtTokens(totalOut)} tok
            </span>
          )}
          {liveAssistant && <span className="flex-shrink-0"><LiveBadge /></span>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={handleSync} disabled={syncing || streaming}
            className="flex items-center gap-1 px-2 py-1 text-xs font-mono text-muted hover:text-text cursor-pointer rounded-lg hover:bg-surface2/50 disabled:opacity-40"
            title="Sync from terminal session">
            {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <TerminalIcon className="w-3 h-3" />}
            Sync
          </button>
          <button onClick={() => clearMessages(chatId)}
            className="p-1.5 text-muted hover:text-text cursor-pointer rounded-lg hover:bg-surface2/50" title="Clear messages">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
              <Bot className="w-7 h-7 text-accent" />
            </div>
            <div>
              <p className="text-sm font-mono font-semibold text-text mb-1">Claude Code</p>
              <p className="text-xs text-muted font-mono max-w-xs truncate">{chat.workingDir}</p>
              <p className="text-xs text-muted/60 font-mono mt-1">Enter to send · / commands · attach files</p>
            </div>
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}
        {streaming && !chat.streamingMsgId && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0 border border-accent/15">
              <Bot className="w-3.5 h-3.5 text-accent" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm glass border border-white/8">
              <div className="flex gap-1.5 items-center h-4">
                {[0, 200, 400].map(d => <div key={d} className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Permission confirmation popup */}
      {pendingPermission && (
        <div className="mx-3 mb-2 rounded-xl border border-warning/30 bg-warning/10 p-3 animate-slide-in">
          <div className="flex items-start gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono font-semibold text-text">
                Allow <span className="text-warning">{pendingPermission.tool}</span>?
              </p>
              <p className="text-xs font-mono text-muted/80 mt-0.5 break-all line-clamp-3">
                {pendingPermission.input}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { respondPermission(chatId, true); setPermMsg('') }}
              className="flex-1 py-1.5 rounded-lg text-xs font-mono font-semibold bg-accent text-bg hover:bg-accent/90 cursor-pointer transition-colors">
              Allow
            </button>
            <button onClick={() => { respondPermission(chatId, false); setPermMsg('') }}
              className="flex-1 py-1.5 rounded-lg text-xs font-mono bg-surface2 text-text hover:bg-surface2/70 cursor-pointer transition-colors">
              Deny
            </button>
            <button onClick={() => { respondPermission(chatId, true, true); setPermMsg('') }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono text-accent border border-accent/30 hover:bg-accent/10 cursor-pointer transition-colors"
              title="Allow this and all future tools (YOLO)">
              Always
            </button>
          </div>

          {/* Custom instruction — deny & tell Claude what to do instead */}
          <div className="flex items-center gap-2 mt-2">
            <input
              value={permMsg}
              onChange={e => setPermMsg(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && permMsg.trim()) {
                  e.preventDefault()
                  respondPermission(chatId, false, false, permMsg)
                  setPermMsg('')
                }
              }}
              placeholder="Atau tulis instruksi untuk Claude (kirim = tolak + arahkan)…"
              className="flex-1 bg-surface2/70 rounded-lg px-2.5 py-1.5 text-xs font-mono text-text placeholder-muted/50 focus:outline-none focus:ring-1 focus:ring-warning/40 border border-white/5"
            />
            <button
              onClick={() => { if (permMsg.trim()) { respondPermission(chatId, false, false, permMsg); setPermMsg('') } }}
              disabled={!permMsg.trim()}
              title="Tolak & kirim instruksi ke Claude"
              className="p-1.5 rounded-lg bg-warning/15 text-warning hover:bg-warning/25 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <CornerDownLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Rich input */}
      <ChatInput
        onSend={handleSend}
        onStop={() => interruptChat(chatId)}
        streaming={streaming}
        slashCommands={slashCommands}
        model={chat.model}
        onModelChange={(m) => setChatModel(chatId, m)}
        permissionMode={chat.permissionMode}
        onPermissionModeChange={(m) => setChatPermissionMode(chatId, m)}
        yolo={chat.yolo}
        onYoloChange={(v) => setChatYolo(chatId, v)}
        injectText={injectText}
        onInjectConsumed={() => consumeInsert(chatId)}
      />
    </div>
  )
}
