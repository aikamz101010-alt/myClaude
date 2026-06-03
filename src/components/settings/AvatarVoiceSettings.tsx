import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAvatarStore } from '@/store/avatarStore'
import { cn } from '@/lib/utils'
import { Bot, Mic, Download, Check, Loader2, Wifi, WifiOff } from 'lucide-react'

type ModelState = 'unknown' | 'missing' | 'ready' | 'downloading'

/** Avatar & voice settings — a self-contained section for the Settings modal. */
export function AvatarVoiceSettings() {
  const provider = useAvatarStore(s => s.provider)
  const setProvider = useAvatarStore(s => s.setProvider)
  const edgeMultilingual = useAvatarStore(s => s.edgeMultilingual)
  const setEdgeMultilingual = useAvatarStore(s => s.setEdgeMultilingual)
  const autoSpeak = useAvatarStore(s => s.autoSpeak)
  const setAutoSpeak = useAvatarStore(s => s.setAutoSpeak)
  const rate = useAvatarStore(s => s.rate)
  const setRate = useAvatarStore(s => s.setRate)

  const [model, setModel] = useState<ModelState>('unknown')
  const [pct, setPct] = useState(0)

  useEffect(() => {
    invoke<{ present: boolean }>('dictation_model_status')
      .then(s => setModel(s.present ? 'ready' : 'missing'))
      .catch(() => setModel('missing'))
  }, [])

  useEffect(() => {
    const un = listen<{ percent: number }>('dictation:download', e => setPct(e.payload.percent))
    return () => { un.then(f => f()) }
  }, [])

  const downloadModel = async () => {
    setModel('downloading'); setPct(0)
    try {
      await invoke('dictation_download_model')
      setModel('ready')
    } catch {
      setModel('missing')
    }
  }

  return (
    <div className="mb-4 p-3 rounded-xl bg-surface2/50 border border-white/5 space-y-3.5">
      <p className="text-xs font-mono font-semibold text-muted flex items-center gap-1.5">
        <Bot className="w-3.5 h-3.5 text-accent" /> Avatar &amp; Suara
      </p>

      {/* Voice mode */}
      <div>
        <p className="text-[11px] text-text mb-1.5">Mode suara</p>
        <div className="flex gap-1">
          <button onClick={() => setProvider('edge')}
            className={cn('flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors border',
              provider === 'edge' ? 'bg-accent/15 text-accent border-accent/40' : 'text-muted hover:text-text border-white/10')}>
            <Wifi className="w-3 h-3" /> Realistis
          </button>
          <button onClick={() => setProvider('local')}
            className={cn('flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-mono cursor-pointer transition-colors border',
              provider === 'local' ? 'bg-accent/15 text-accent border-accent/40' : 'text-muted hover:text-text border-white/10')}>
            <WifiOff className="w-3 h-3" /> Offline
          </button>
        </div>
        <p className="text-[10px] text-muted/60 mt-1">
          {provider === 'edge'
            ? 'Neural — natural, butuh internet'
            : 'Damayanti (macOS) — tanpa internet, lebih robotik'}
        </p>
      </div>

      {/* Mixed-language adaptation (Edge only) */}
      {provider === 'edge' && (
        <button onClick={() => setEdgeMultilingual(!edgeMultilingual)}
          className="w-full flex items-center justify-between cursor-pointer group text-left">
          <span className="text-[11px] text-text pr-2">
            Sesuaikan campuran bahasa
            <span className="block text-[10px] text-muted/60">
              {edgeMultilingual
                ? 'Kata Inggris dibaca lafal Inggris (ID + EN)'
                : 'Native Indonesia — terbaik untuk teks murni ID'}
            </span>
          </span>
          <span className={cn('relative w-8 h-4 rounded-full transition-colors flex-shrink-0', edgeMultilingual ? 'bg-accent' : 'bg-white/15')}>
            <span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', edgeMultilingual ? 'left-4' : 'left-0.5')} />
          </span>
        </button>
      )}

      {/* Auto-speak */}
      <button onClick={() => setAutoSpeak(!autoSpeak)}
        className="w-full flex items-center justify-between cursor-pointer group">
        <span className="text-[11px] text-text">Bacakan balasan otomatis</span>
        <span className={cn('relative w-8 h-4 rounded-full transition-colors', autoSpeak ? 'bg-accent' : 'bg-white/15')}>
          <span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', autoSpeak ? 'left-4' : 'left-0.5')} />
        </span>
      </button>

      {/* Speaking rate */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-text">Kecepatan bicara</span>
          <span className="text-muted font-mono">{rate} wpm</span>
        </div>
        <input type="range" min={120} max={240} step={5} value={rate}
          onChange={e => setRate(Number(e.target.value))}
          className="w-full accent-accent cursor-pointer" />
      </div>

      {/* Voice locked info */}
      <p className="text-[10px] text-muted/60">
        Suara dikunci ke <span className="text-text">perempuan (Bahasa Indonesia)</span>.
      </p>

      {/* Mic dictation model */}
      <div className="pt-1 border-t border-white/5">
        <p className="text-[11px] text-text mb-1.5 flex items-center gap-1.5">
          <Mic className="w-3 h-3 text-accent" /> Model input suara (mic)
        </p>
        {model === 'ready' && (
          <p className="flex items-center gap-1.5 text-[11px] text-accent font-mono">
            <Check className="w-3.5 h-3.5" /> Terpasang &amp; siap dipakai
          </p>
        )}
        {model === 'missing' && (
          <button onClick={downloadModel}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-surface2 border border-white/10 text-text hover:text-accent hover:border-accent/30 cursor-pointer transition-colors">
            <Download className="w-3.5 h-3.5" /> Unduh model (~148 MB)
          </button>
        )}
        {model === 'downloading' && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted font-mono">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Mengunduh… {pct}%
          </p>
        )}
        {model === 'unknown' && (
          <p className="text-[11px] text-muted/60 font-mono">Memeriksa…</p>
        )}
        <p className="text-[10px] text-muted/60 mt-1">
          Untuk dikte Bahasa Indonesia (offline, Whisper). Diperlukan sekali unduh.
        </p>
      </div>
    </div>
  )
}
