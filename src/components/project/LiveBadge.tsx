import { useEffect, useState } from 'react'
import { useAvatarStore } from '@/store/avatarStore'
import { useLiveStatus } from '@/store/liveStatusStore'
import { cn } from '@/lib/utils'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k'
  return String(n)
}
function rel(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'baru saja'
  if (s < 60) return `${s} dtk lalu`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} mnt lalu`
  return `${Math.floor(m / 60)} jam lalu`
}

/** "● Live" badge showing the assistant name, model, cumulative token usage,
 * and the time of the last live-assistant execution. */
export function LiveBadge() {
  const name = useAvatarStore(s => s.assistantName)
  const model = useAvatarStore(s => s.liveModel)
  const running = useLiveStatus(s => s.running)
  const tokensIn = useLiveStatus(s => s.tokensIn)
  const tokensOut = useLiveStatus(s => s.tokensOut)
  const lastRun = useLiveStatus(s => s.lastRun)

  // Re-render every second so the relative "last run" time stays fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!lastRun || running) return
    const id = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [lastRun, running])

  const tot = tokensIn + tokensOut
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-bg/80 backdrop-blur border border-accent/30 px-2.5 py-1 text-[10px] font-mono text-accent whitespace-nowrap">
      <span className={cn('w-1.5 h-1.5 rounded-full bg-accent', running && 'animate-pulse')} />
      Live · {name || 'Assistant'} · {model}
      {tot > 0 && <span className="text-accent/70">· ↑{fmt(tokensIn)} ↓{fmt(tokensOut)} tok</span>}
      <span className="text-muted/70">· {running ? 'berpikir…' : lastRun ? rel(lastRun) : 'idle'}</span>
    </span>
  )
}
