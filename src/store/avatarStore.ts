import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Talking-avatar settings (persisted). The avatar narrates Claude's replies
 * via offline macOS TTS and drives VRM lip-sync from the audio amplitude.
 */
interface AvatarStore {
  enabled: boolean          // panel visible
  autoSpeak: boolean        // speak each assistant reply automatically
  provider: 'edge' | 'local' // 'edge' = realistic neural (free, needs internet); 'local' = macOS say (offline)
  edgeMultilingual: boolean // true = adapt pronunciation per word (mixed ID/EN); false = native Indonesian
  voice: string | null      // macOS voice name ('' / null = system default)
  edgeVoice: string         // Edge neural voice short-name (e.g. id-ID-GadisNeural)
  rate: number              // words per minute (say -r)
  vrmUrl: string            // VRM model URL (default served from /public)
  pos: { x: number; y: number } | null // panel position; null = default bottom-right

  setEnabled: (v: boolean) => void
  toggleEnabled: () => void
  setAutoSpeak: (v: boolean) => void
  setProvider: (p: 'edge' | 'local') => void
  setEdgeMultilingual: (v: boolean) => void
  setVoice: (v: string | null) => void
  setEdgeVoice: (v: string) => void
  setRate: (n: number) => void
  setVrmUrl: (u: string) => void
  setPos: (p: { x: number; y: number } | null) => void
}

export const DEFAULT_VRM_URL = '/avatar/character.vrm'

export const useAvatarStore = create<AvatarStore>()(
  persist(
    set => ({
      enabled: false,
      autoSpeak: true,
      provider: 'edge', // realistic neural Indonesian voice by default
      edgeMultilingual: true, // adapt pronunciation to mixed ID/EN text
      voice: 'Damayanti', // macOS id_ID voice (offline fallback)
      edgeVoice: 'id-ID-GadisNeural', // female Indonesian neural voice
      rate: 175,
      vrmUrl: DEFAULT_VRM_URL,
      pos: null,

      setEnabled: v => set({ enabled: v }),
      toggleEnabled: () => set(s => ({ enabled: !s.enabled })),
      setAutoSpeak: v => set({ autoSpeak: v }),
      setProvider: p => set({ provider: p }),
      setEdgeMultilingual: v => set({ edgeMultilingual: v }),
      setVoice: v => set({ voice: v }),
      setEdgeVoice: v => set({ edgeVoice: v }),
      setRate: n => set({ rate: n }),
      setVrmUrl: u => set({ vrmUrl: u }),
      setPos: p => set({ pos: p }),
    }),
    { name: 'claudex-avatar' },
  ),
)
