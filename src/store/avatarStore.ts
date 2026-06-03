import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Talking-avatar settings (persisted). The avatar narrates Claude's replies
 * via offline macOS TTS and drives VRM lip-sync from the audio amplitude.
 */
export type AvatarZoom = 'full' | 'three' | 'half' | 'head'

interface AvatarStore {
  enabled: boolean          // panel visible
  autoSpeak: boolean        // speak each assistant reply automatically
  provider: 'edge' | 'local' // 'edge' = realistic neural (free, needs internet); 'local' = macOS say (offline)
  voiceLang: 'id' | 'en' | 'multi' // spoken language: native Indonesian, native English, or auto multilingual
  voice: string | null      // macOS voice name ('' / null = system default)
  edgeVoice: string         // Edge neural voice short-name (e.g. id-ID-GadisNeural)
  rate: number              // words per minute (say -r)
  vrmUrl: string            // VRM model URL (default served from /public)
  pos: { x: number; y: number } | null // panel position; null = default bottom-right

  // ── Character panel view settings (persisted) ──
  zoom: AvatarZoom          // camera framing: full body / 3-4 / half / head
  subtitleSide: 'left' | 'right' // subtitle box side
  showLog: boolean          // conversation transcript visible
  interactive: boolean      // lively idle eyes + hands
  narrationLimit: number    // max characters to narrate; 0 = unlimited (default)
  captionHideSec: number    // auto-hide subtitle this many seconds after speech ends; 0 = keep until next reply

  // ── Virtual assistant identity (persisted) ──
  assistantName: string     // shown as the project tab name (default 'Claudia')
  persona: string           // free-text persona; folded into the live-assistant agent prompt
  voiceGender: 'woman' | 'man' // selects male/female neural + offline voices
  liveAssistant: boolean    // ON → a separate-session subagent drives the character (default OFF)
  liveModel: 'haiku' | 'sonnet' | 'opus' // model for the live-assistant director

  setEnabled: (v: boolean) => void
  toggleEnabled: () => void
  setAutoSpeak: (v: boolean) => void
  setProvider: (p: 'edge' | 'local') => void
  setVoiceLang: (v: 'id' | 'en' | 'multi') => void
  setVoice: (v: string | null) => void
  setEdgeVoice: (v: string) => void
  setRate: (n: number) => void
  setVrmUrl: (u: string) => void
  setPos: (p: { x: number; y: number } | null) => void
  setZoom: (z: AvatarZoom) => void
  setSubtitleSide: (s: 'left' | 'right') => void
  setShowLog: (v: boolean) => void
  setInteractive: (v: boolean) => void
  setNarrationLimit: (n: number) => void
  setCaptionHideSec: (n: number) => void
  setAssistantName: (s: string) => void
  setPersona: (s: string) => void
  setVoiceGender: (g: 'woman' | 'man') => void
  setLiveAssistant: (v: boolean) => void
  setLiveModel: (m: 'haiku' | 'sonnet' | 'opus') => void
}

export const DEFAULT_VRM_URL = '/avatar/character.vrm'

export const useAvatarStore = create<AvatarStore>()(
  persist(
    set => ({
      enabled: false,
      autoSpeak: true,
      provider: 'edge', // realistic neural Indonesian voice by default
      voiceLang: 'multi', // adapt pronunciation to mixed ID/EN text by default
      voice: 'Damayanti', // macOS id_ID voice (offline fallback)
      edgeVoice: 'id-ID-GadisNeural', // female Indonesian neural voice
      rate: 175,
      vrmUrl: DEFAULT_VRM_URL,
      pos: null,

      zoom: 'full',
      subtitleSide: 'left',
      showLog: true,
      interactive: true,
      narrationLimit: 0, // unlimited by default — narrate the whole reply
      captionHideSec: 0, // keep subtitle until the next reply by default

      assistantName: 'Claudia', // existing default character
      persona: '',
      voiceGender: 'woman',
      liveAssistant: false, // subagent control OFF by default
      liveModel: 'haiku',

      setEnabled: v => set({ enabled: v }),
      toggleEnabled: () => set(s => ({ enabled: !s.enabled })),
      setAutoSpeak: v => set({ autoSpeak: v }),
      setProvider: p => set({ provider: p }),
      setVoiceLang: v => set({ voiceLang: v }),
      setVoice: v => set({ voice: v }),
      setEdgeVoice: v => set({ edgeVoice: v }),
      setRate: n => set({ rate: n }),
      setVrmUrl: u => set({ vrmUrl: u }),
      setPos: p => set({ pos: p }),
      setZoom: z => set({ zoom: z }),
      setSubtitleSide: s => set({ subtitleSide: s }),
      setShowLog: v => set({ showLog: v }),
      setInteractive: v => set({ interactive: v }),
      setNarrationLimit: n => set({ narrationLimit: n }),
      setCaptionHideSec: n => set({ captionHideSec: n }),
      setAssistantName: s => set({ assistantName: s }),
      setPersona: s => set({ persona: s }),
      setVoiceGender: g => set({ voiceGender: g }),
      setLiveAssistant: v => set({ liveAssistant: v }),
      setLiveModel: m => set({ liveModel: m }),
    }),
    { name: 'claudex-avatar' },
  ),
)
