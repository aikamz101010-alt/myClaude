import { invoke } from '@tauri-apps/api/core'
import { lipSync } from './lipsync'
import { useAvatarStore } from '@/store/avatarStore'

/**
 * Strip markdown / code / urls down to plain prose suitable for TTS, and cap
 * the length so the avatar gives a concise spoken summary rather than reading
 * an entire essay. Language is left untouched (speaks in Claude's language).
 */
export function sanitizeForSpeech(text: string, maxLen = 600): string {
  let t = text
  t = t.replace(/```[\s\S]*?```/g, ' code block ')       // fenced code
  t = t.replace(/`[^`]*`/g, ' ')                          // inline code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')             // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')           // links → text
  t = t.replace(/https?:\/\/\S+/g, ' ')                   // bare urls
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')                // headings
  t = t.replace(/^[\s>*-]+/gm, '')                        // bullets / quotes
  t = t.replace(/[*_`#>|]+/g, '')                         // leftover md markers
  // Strip emoji / emoticons so they aren't spoken aloud.
  t = t.replace(/\p{Extended_Pictographic}/gu, ' ')       // emoji pictographs
  t = t.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, ' ')           // regional indicators (flags)
  t = t.replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}]/gu, '') // modifiers/VS/ZWJ
  t = t.replace(/[:;=8][-^']?[)(DPpoO3|\\/]/g, ' ')       // ASCII emoticons :) :-( etc.
  t = t.replace(/\s+/g, ' ').trim()                       // collapse whitespace
  if (t.length > maxLen) {
    t = t.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
  }
  return t
}

// Per user preference: ALWAYS use a female Indonesian voice — locked here so no
// setting (now or later) can switch the avatar to a male voice.
const FEMALE_EDGE_VOICE = 'id-ID-GadisNeural' // Edge neural, female
const FEMALE_LOCAL_VOICE = 'Damayanti'        // macOS `say` id_ID, female

/** macOS `say` (offline) synthesis → base64 WAV. */
function synthLocal(text: string): Promise<string> {
  const { rate } = useAvatarStore.getState()
  return invoke<string>('synthesize_speech', { text, voice: FEMALE_LOCAL_VOICE, rate: rate || null })
}

/** Microsoft Edge neural synthesis (free, realistic, needs internet) → base64 MP3. */
function synthEdge(text: string): Promise<string> {
  return invoke<string>('synthesize_edge', { text, voice: FEMALE_EDGE_VOICE, rate: null })
}

/** Synthesize + play `text` through the avatar (lip-sync driven by the audio). */
export async function speak(text: string): Promise<void> {
  const { provider } = useAvatarStore.getState()
  const clean = sanitizeForSpeech(text)
  if (!clean) return
  try {
    let b64: string
    if (provider === 'edge') {
      try {
        b64 = await synthEdge(clean)
      } catch (e) {
        // No internet / endpoint down → fall back to the offline voice.
        console.warn('[avatar] Edge TTS failed, falling back to local:', e)
        b64 = await synthLocal(clean)
      }
    } else {
      b64 = await synthLocal(clean)
    }
    await lipSync.play(b64, clean)
  } catch (e) {
    console.warn('[avatar] TTS failed:', e)
  }
}

/** Stop any in-progress narration. */
export function stopSpeaking(): void {
  lipSync.stop()
}
