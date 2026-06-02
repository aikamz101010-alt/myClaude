import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'
import { RefreshCw, Square, Eraser, ZoomIn, ZoomOut } from 'lucide-react'
import { useSessionStore } from '@/store/sessionStore'
import '@xterm/xterm/css/xterm.css'

interface Props {
  projectId: string
  workingDir: string
  autoStart?: boolean
}

const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18]
const DEFAULT_FONT_SIZE = 13

export function TerminalView({ projectId, workingDir, autoStart = false }: Props) {
  const termRef    = useRef<HTMLDivElement>(null)
  const xtermRef   = useRef<Terminal | null>(null)
  const fitRef     = useRef<FitAddon | null>(null)
  const startedRef = useRef(false)

  const [running, setRunning]   = useState(false)
  const [error, setError]       = useState('')
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)

  const { setPtyStatus } = useSessionStore()

  // ── Init xterm once ──────────────────────────────────────────
  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background:          '#0F172A',
        foreground:          '#F8FAFC',
        cursor:              '#22C55E',
        cursorAccent:        '#0F172A',
        selectionBackground: 'rgba(34,197,94,0.25)',
        black:  '#1E293B', red:    '#EF4444', green:  '#22C55E',
        yellow: '#F59E0B', blue:   '#3B82F6', magenta:'#A855F7',
        cyan:   '#06B6D4', white:  '#F8FAFC',
        brightBlack: '#334155', brightGreen: '#4ADE80', brightWhite: '#FFFFFF',
      },
      fontFamily:  "'Fira Code', 'Cascadia Code', monospace",
      fontSize,
      lineHeight:  1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback:  10000,
    })

    const fit   = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(termRef.current)
    fit.fit()

    xtermRef.current = term
    fitRef.current   = fit

    // Resize → notify PTY
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        invoke('resize_pty', { projectId, cols: term.cols, rows: term.rows }).catch(() => {})
      } catch {}
    })
    ro.observe(termRef.current)

    // Keystrokes → PTY stdin
    term.onData(data => {
      invoke('write_pty', { projectId, data }).catch(console.error)
    })

    // PTY output
    const unlistenOutput = listen<string>(`pty:output:${projectId}`, ev => {
      term.write(ev.payload)
    })

    // PTY exited
    const unlistenExit = listen(`pty:exit:${projectId}`, () => {
      setRunning(false)
      setPtyStatus(projectId, 'stopped')
      term.writeln('\r\n\x1b[2m[session ended — click Restart to run again]\x1b[0m')
    })

    // Check if PTY already running (reconnect after tab switch / back navigation)
    invoke<boolean>('is_pty_running', { projectId }).then(alive => {
      if (alive) {
        setRunning(true)
        term.writeln('\x1b[2m[reconnected to running session]\x1b[0m')
        fit.fit()
        invoke('resize_pty', { projectId, cols: term.cols, rows: term.rows }).catch(() => {})
      }
    }).catch(() => {})

    return () => {
      ro.disconnect()
      unlistenOutput.then(fn => fn())
      unlistenExit.then(fn => fn())
      term.dispose()
      xtermRef.current = null
      // ── Session persistence: do NOT stop_pty here ──
      // PTY keeps running when user navigates back to Hub
      // or switches to Chat/Contract tab.
    }
  }, [projectId])

  // ── Font size change → update xterm ─────────────────────────
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize
      fitRef.current?.fit()
    }
  }, [fontSize])

  // ── Auto-start on mount ──────────────────────────────────────
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true
      startClaude()
    }
    return () => { startedRef.current = false }
  }, [autoStart, workingDir])

  const startClaude = async () => {
    if (!xtermRef.current) return
    // Don't start if already alive
    const alive = await invoke<boolean>('is_pty_running', { projectId }).catch(() => false)
    if (alive) { setRunning(true); return }
    setError('')
    try {
      const { cols, rows } = xtermRef.current
      await invoke('start_pty', { projectId, workingDir, cols, rows })
      setRunning(true)
      setPtyStatus(projectId, 'running')
      xtermRef.current.focus()
    } catch (err) {
      setError(String(err))
      xtermRef.current?.writeln(`\r\n\x1b[31m[Error] ${String(err)}\x1b[0m`)
    }
  }

  const handleRestart = async () => {
    await invoke('stop_pty', { projectId }).catch(() => {})
    setRunning(false)
    setPtyStatus(projectId, 'stopped')
    xtermRef.current?.writeln('\r\n\x1b[2m[restarting...]\x1b[0m')
    await startClaude()
  }

  const handleStop = async () => {
    await invoke('stop_pty', { projectId })
    setRunning(false)
    setPtyStatus(projectId, 'stopped')
  }

  const handleClear = () => {
    xtermRef.current?.clear()
    xtermRef.current?.focus()
  }

  const adjustFontSize = (delta: number) => {
    setFontSize(prev => {
      const idx = FONT_SIZES.indexOf(prev)
      const nextIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))
      return FONT_SIZES[nextIdx]
    })
  }

  return (
    <div className="flex flex-col h-full bg-[#0F172A]">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-white/5 bg-[#1E293B] flex-shrink-0">
        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 mr-1', running ? 'bg-accent animate-pulse' : 'bg-muted')} />
        <span className="text-xs font-mono text-muted flex-1 truncate">
          {running ? `claude — ${workingDir}` : 'claude — stopped'}
        </span>

        {error && (
          <span className="text-xs font-mono text-error truncate max-w-xs" title={error}>
            {error.length > 40 ? error.slice(0, 40) + '…' : error}
          </span>
        )}

        {/* Font size controls */}
        <div className="flex items-center border-r border-white/10 pr-1 mr-1">
          <button onClick={() => adjustFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]}
            className="p-1 text-muted hover:text-text cursor-pointer transition-colors disabled:opacity-30" title="Decrease font size">
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-xs font-mono text-muted w-5 text-center">{fontSize}</span>
          <button onClick={() => adjustFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]}
            className="p-1 text-muted hover:text-text cursor-pointer transition-colors disabled:opacity-30" title="Increase font size">
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>

        {/* Clear */}
        <button onClick={handleClear} className="p-1 text-muted hover:text-text cursor-pointer transition-colors" title="Clear terminal">
          <Eraser className="w-3 h-3" />
        </button>

        {running ? (
          <>
            <button onClick={handleRestart} className="p-1 text-muted hover:text-accent cursor-pointer transition-colors" title="Restart">
              <RefreshCw className="w-3 h-3" />
            </button>
            <button onClick={handleStop} className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono text-error hover:text-error/80 cursor-pointer transition-colors">
              <Square className="w-3 h-3" /> Stop
            </button>
          </>
        ) : (
          <button onClick={startClaude}
            className="px-3 py-0.5 rounded text-xs font-mono bg-accent/10 text-accent hover:bg-accent hover:text-bg border border-accent/20 cursor-pointer transition-all">
            Start claude
          </button>
        )}
      </div>

      {/* xterm.js */}
      <div
        ref={termRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '6px' }}
        onClick={() => xtermRef.current?.focus()}
      />
    </div>
  )
}
