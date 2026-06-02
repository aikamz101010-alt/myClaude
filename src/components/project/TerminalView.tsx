import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useAgentStore } from '@/store/agentStore'
import '@xterm/xterm/css/xterm.css'

interface Props {
  projectId: string
}

export function TerminalView({ projectId }: Props) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const prevLinesRef = useRef(0)
  const { outputs } = useAgentStore()

  useEffect(() => {
    if (!termRef.current) return

    const term = new Terminal({
      theme: {
        background:   '#0F172A',
        foreground:   '#F8FAFC',
        cursor:       '#22C55E',
        cursorAccent: '#0F172A',
        selectionBackground: 'rgba(34,197,94,0.3)',
        black:   '#1E293B',
        green:   '#22C55E',
        brightGreen: '#4ADE80',
        yellow:  '#F59E0B',
        red:     '#EF4444',
        blue:    '#3B82F6',
        cyan:    '#06B6D4',
        white:   '#F8FAFC',
        brightBlack: '#334155',
      },
      fontFamily: "'Fira Code', 'Courier New', monospace",
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      convertEol: true,
    })

    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(termRef.current)
    fit.fit()

    xtermRef.current = term
    fitRef.current = fit
    prevLinesRef.current = 0

    const ro = new ResizeObserver(() => {
      try { fitRef.current?.fit() } catch {}
    })
    ro.observe(termRef.current)

    return () => {
      ro.disconnect()
      term.dispose()
      xtermRef.current = null
    }
  }, [projectId])

  // Stream new lines into terminal
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    const lines = outputs[projectId] ?? []
    const newLines = lines.slice(prevLinesRef.current)
    newLines.forEach((line) => term.writeln(line))
    prevLinesRef.current = lines.length
  }, [outputs, projectId])

  return (
    <div className="h-full bg-bg rounded-xl overflow-hidden p-2">
      <div ref={termRef} className="h-full w-full" />
    </div>
  )
}
