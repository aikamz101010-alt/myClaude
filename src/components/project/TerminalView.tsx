import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAgentStore } from '@/store/agentStore'
import '@xterm/xterm/css/xterm.css'

interface Props {
  projectId: string
  workingDir: string
}

export function TerminalView({ projectId, workingDir }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const prevLinesRef = useRef(0)
  const inputBufRef = useRef('')
  const { outputs, statuses, spawnAgent, stopAgent, subscribeOutput } = useAgentStore()
  const status = statuses[projectId] ?? 'idle'

  // Auto-subscribe to output events
  useEffect(() => {
    const unsub = subscribeOutput(projectId)
    return unsub
  }, [projectId])

  // Init xterm
  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background:          '#0F172A',
        foreground:          '#F8FAFC',
        cursor:              '#22C55E',
        cursorAccent:        '#0F172A',
        selectionBackground: 'rgba(34,197,94,0.3)',
        black:               '#1E293B',
        green:               '#22C55E',
        brightGreen:         '#4ADE80',
        yellow:              '#F59E0B',
        red:                 '#EF4444',
        blue:                '#3B82F6',
        cyan:                '#06B6D4',
        white:               '#F8FAFC',
        brightBlack:         '#334155',
      },
      fontFamily: "'Fira Code', 'Courier New', monospace",
      fontSize:   12,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback:  5000,
      convertEol:  true,
    })

    const fit  = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(termRef.current)
    fit.fit()

    xtermRef.current  = term
    fitRef.current    = fit
    prevLinesRef.current = 0

    // Handle keyboard input → send to agent stdin
    term.onKey(({ key, domEvent }) => {
      const { spawnAgent: _sp, stopAgent: _st, ...store } = useAgentStore.getState()
      const currentStatus = store.statuses[projectId] ?? 'idle'

      if (domEvent.key === 'Enter') {
        term.writeln('')
        const line = inputBufRef.current
        inputBufRef.current = ''
        if (line.trim()) {
          useAgentStore.getState().sendToAgent?.(projectId, line)
        }
      } else if (domEvent.key === 'Backspace') {
        if (inputBufRef.current.length > 0) {
          inputBufRef.current = inputBufRef.current.slice(0, -1)
          term.write('\b \b')
        }
      } else if (!domEvent.ctrlKey && !domEvent.altKey && !domEvent.metaKey) {
        if (currentStatus === 'running') {
          inputBufRef.current += key
          term.write(key)
        }
      }
    })

    const ro = new ResizeObserver(() => {
      try { fitRef.current?.fit() } catch {}
    })
    ro.observe(termRef.current)

    // Show welcome prompt
    term.writeln('\x1b[32m● Claude Desktop Terminal\x1b[0m')
    term.writeln('\x1b[2mPress Start to begin an interactive Claude CLI session\x1b[0m')
    term.writeln('')

    return () => {
      ro.disconnect()
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId])

  // Stream new output lines into terminal
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    const lines = outputs[projectId] ?? []
    const newLines = lines.slice(prevLinesRef.current)
    newLines.forEach((line) => term.writeln(line))
    prevLinesRef.current = lines.length
  }, [outputs, projectId])

  // Show status change in terminal
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    if (status === 'running') {
      term.writeln('\x1b[32m● Session started\x1b[0m')
    } else if (status === 'idle' && prevLinesRef.current > 3) {
      term.writeln('\x1b[2m○ Session ended\x1b[0m')
    }
  }, [status])

  const handleStartStop = async () => {
    if (status === 'running') {
      await stopAgent(projectId)
    } else {
      await spawnAgent(projectId, workingDir)
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Terminal toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 flex-shrink-0">
        <div className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-accent animate-pulse' : 'bg-muted'}`} />
        <span className="text-xs font-mono text-muted flex-1">
          {status === 'running' ? 'Claude CLI — interactive session' : 'Terminal — not running'}
        </span>
        <button
          onClick={handleStartStop}
          className={`px-3 py-1 rounded-lg text-xs font-mono cursor-pointer transition-all ${
            status === 'running'
              ? 'bg-error/10 text-error hover:bg-error/20 border border-error/20'
              : 'bg-accent/10 text-accent hover:bg-accent hover:text-bg border border-accent/20'
          }`}
        >
          {status === 'running' ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* xterm.js area */}
      <div className="flex-1 overflow-hidden p-2">
        <div ref={termRef} className="h-full w-full" />
      </div>
    </div>
  )
}
