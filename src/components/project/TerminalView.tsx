import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

interface Props {
  projectId: string
  workingDir: string
}

export function TerminalView({ projectId, workingDir }: Props) {
  const termRef    = useRef<HTMLDivElement>(null)
  const xtermRef   = useRef<Terminal | null>(null)
  const fitRef     = useRef<FitAddon | null>(null)
  const [running, setRunning]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  // Boot the terminal UI once
  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background:          '#0F172A',
        foreground:          '#F8FAFC',
        cursor:              '#22C55E',
        cursorAccent:        '#0F172A',
        selectionBackground: 'rgba(34,197,94,0.25)',
        black:               '#1E293B',
        red:                 '#EF4444',
        green:               '#22C55E',
        yellow:              '#F59E0B',
        blue:                '#3B82F6',
        magenta:             '#A855F7',
        cyan:                '#06B6D4',
        white:               '#F8FAFC',
        brightBlack:         '#334155',
        brightGreen:         '#4ADE80',
        brightWhite:         '#FFFFFF',
      },
      fontFamily: "'Fira Code', 'Cascadia Code', 'Courier New', monospace",
      fontSize:    13,
      lineHeight:  1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback:  10000,
      allowProposedApi: true,
    })

    const fit   = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(termRef.current)
    fit.fit()

    xtermRef.current = term
    fitRef.current   = fit

    // Auto-resize
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        const { cols, rows } = term
        invoke('resize_pty', { projectId, cols, rows }).catch(() => {})
      } catch {}
    })
    ro.observe(termRef.current)

    // Raw keystroke → PTY stdin
    term.onData((data) => {
      invoke('write_pty', { projectId, data }).catch(console.error)
    })

    // Subscribe to raw PTY output
    const unlistenOutput = listen<string>(`pty:output:${projectId}`, (ev) => {
      term.write(ev.payload)  // raw ANSI — NOT writeln
    })

    // PTY session ended
    const unlistenExit = listen(`pty:exit:${projectId}`, () => {
      setRunning(false)
      term.writeln('\r\n\x1b[2m[session ended]\x1b[0m')
    })

    // Welcome
    term.writeln('\x1b[32m╔══════════════════════════════════════╗\x1b[0m')
    term.writeln('\x1b[32m║     Claude Desktop — Terminal         ║\x1b[0m')
    term.writeln('\x1b[32m╚══════════════════════════════════════╝\x1b[0m')
    term.writeln('\x1b[2mPress \x1b[0m\x1b[32mStart\x1b[0m\x1b[2m to launch Claude Code CLI\x1b[0m')
    term.writeln('')

    return () => {
      ro.disconnect()
      unlistenOutput.then(fn => fn())
      unlistenExit.then(fn => fn())
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId])

  const handleStart = async () => {
    if (!termRef.current || !xtermRef.current) return
    setLoading(true)
    setError('')
    try {
      const { cols, rows } = xtermRef.current
      await invoke('start_pty', { projectId, workingDir, cols, rows })
      setRunning(true)
      xtermRef.current.focus()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    await invoke('stop_pty', { projectId })
    setRunning(false)
  }

  return (
    <div className="flex flex-col h-full bg-[#0F172A]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/5 bg-[#1E293B] flex-shrink-0">
        <div className={cn('w-2 h-2 rounded-full transition-colors', {
          'bg-accent animate-pulse': running,
          'bg-muted':                !running,
        })} />
        <span className="text-xs font-mono text-muted flex-1">
          {running ? `claude — ${workingDir}` : 'Claude Code CLI — not running'}
        </span>

        {error && (
          <span className="text-xs font-mono text-error truncate max-w-xs">{error}</span>
        )}

        {running ? (
          <button
            onClick={handleStop}
            className="px-3 py-1 rounded-lg text-xs font-mono bg-error/10 text-error hover:bg-error/20 border border-error/20 cursor-pointer transition-all"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-3 py-1 rounded-lg text-xs font-mono bg-accent/10 text-accent hover:bg-accent hover:text-bg border border-accent/20 cursor-pointer transition-all disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start'}
          </button>
        )}
      </div>

      {/* xterm.js — the real embedded Claude CLI */}
      <div
        ref={termRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '8px' }}
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  )
}
