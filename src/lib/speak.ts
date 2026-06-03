import { invoke } from '@tauri-apps/api/core'
import { lipSync } from './lipsync'
import { useAvatarStore, DEFAULT_VRM_URL } from '@/store/avatarStore'

/** Effective voice gender: the built-in character is locked to a female voice;
 * a custom (uploaded) VRM honors the chosen gender. */
function effectiveGender(): 'woman' | 'man' {
  const { voiceGender, vrmUrl } = useAvatarStore.getState()
  return vrmUrl === DEFAULT_VRM_URL ? 'woman' : voiceGender
}

/**
 * Strip markdown / code / urls down to plain prose suitable for TTS. By default
 * there is no length cap (maxLen = Infinity) — the whole reply is narrated; the
 * caller passes a finite cap only if the user chose a shorter narration length.
 * Language is left untouched (speaks in Claude's language).
 */
export function sanitizeForSpeech(text: string, maxLen = Infinity): string {
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

// Voices keyed by gender → spoken-language. Edge (neural, online):
const EDGE_VOICE: Record<'woman' | 'man', Record<'id' | 'en' | 'multi', string>> = {
  woman: {
    id: 'id-ID-GadisNeural',              // native Indonesian (female)
    en: 'en-US-AriaNeural',               // native English (female)
    multi: 'en-US-AvaMultilingualNeural', // auto per-word, mixed ID/EN (female)
  },
  man: {
    id: 'id-ID-ArdiNeural',                  // native Indonesian (male)
    en: 'en-US-GuyNeural',                   // native English (male)
    multi: 'en-US-AndrewMultilingualNeural', // auto per-word, mixed ID/EN (male)
  },
}
// macOS `say` (offline). Note: macOS has no male id_ID voice → Damayanti for ID.
const LOCAL_VOICE: Record<'woman' | 'man', Record<'id' | 'en' | 'multi', string>> = {
  woman: { id: 'Damayanti', en: 'Samantha', multi: 'Damayanti' },
  man:   { id: 'Damayanti', en: 'Daniel',   multi: 'Damayanti' },
}

/** macOS `say` (offline) synthesis → base64 WAV. */
function synthLocal(text: string): Promise<string> {
  const { rate, voiceLang } = useAvatarStore.getState()
  return invoke<string>('synthesize_speech', { text, voice: LOCAL_VOICE[effectiveGender()][voiceLang], rate: rate || null })
}

/** Microsoft Edge neural synthesis (free, realistic, needs internet) → base64 MP3. */
function synthEdge(text: string): Promise<string> {
  const { voiceLang } = useAvatarStore.getState()
  return invoke<string>('synthesize_edge', { text, voice: EDGE_VOICE[effectiveGender()][voiceLang], rate: null })
}

/** Synthesize one piece of text via the active provider (Edge → local fallback). */
async function synth(text: string): Promise<string> {
  const { provider } = useAvatarStore.getState()
  if (provider === 'edge') {
    try {
      return await synthEdge(text)
    } catch (e) {
      console.warn('[avatar] Edge TTS failed, falling back to local:', e)
      return await synthLocal(text)
    }
  }
  return await synthLocal(text)
}

/** Split long prose into chunks (≤ max chars) on sentence boundaries — so very
 * long replies synthesize reliably and play back fully without a hard limit. */
function chunkText(text: string, max = 480): string[] {
  if (text.length <= max) return [text]
  const sentences = text.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) ?? [text]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { chunks.push(cur.trim()); cur = '' }
    cur += s
    while (cur.length > max) { chunks.push(cur.slice(0, max).trim()); cur = cur.slice(max) }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.filter(Boolean)
}

/** Play one synthesized chunk and resolve when it finishes (or is stopped). */
function playChunk(b64: string, caption: string): Promise<void> {
  return new Promise<void>(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; lipSync.onEnd = null; resolve() } }
    lipSync.play(b64, caption).then(() => { lipSync.onEnd = finish }).catch(finish)
  })
}

// Cancellation token: a newer speak() supersedes an in-flight one.
let speakSeq = 0

/** Synthesize + play `text` through the avatar (lip-sync driven by the audio).
 * Honors the persisted narration-length setting (default: unlimited). Long text
 * is chunked and played sequentially, with the next chunk pre-synthesized while
 * the current one plays so there are no gaps. */
export async function speak(text: string): Promise<void> {
  const { narrationLimit } = useAvatarStore.getState()
  const limit = narrationLimit && narrationLimit > 0 ? narrationLimit : Infinity
  const clean = sanitizeForSpeech(text, limit)
  if (!clean) return

  const mySeq = ++speakSeq
  lipSync.stop() // cancel any current narration

  const chunks = chunkText(clean)
  let nextP: Promise<string> = synth(chunks[0]).catch(() => '')
  for (let i = 0; i < chunks.length; i++) {
    if (mySeq !== speakSeq) return
    const b64 = await nextP
    // Pre-synthesize the next chunk while this one plays.
    nextP = i + 1 < chunks.length ? synth(chunks[i + 1]).catch(() => '') : Promise.resolve('')
    if (mySeq !== speakSeq) return
    if (!b64) continue
    await playChunk(b64, chunks[i])
  }
}

/** Stop any in-progress narration (both one-shot and streaming queue). */
export function stopSpeaking(): void {
  speakSeq++          // invalidate any running speak() loop
  qGen++              // invalidate the streaming queue
  queue.length = 0
  pumping = false
  lipSync.stop()
}

// Narrate a given assistant message at most once across the whole app, keyed by
// its id. Prevents double narration (floating avatar + Character panel) and
// re-narration when a view remounts / the user switches tabs.
let lastSpokenId: string | null = null
export function speakMessageOnce(id: string, text: string): void {
  if (id === lastSpokenId) return
  lastSpokenId = id
  void speak(text)
}

/** Mark a message id as already narrated (so other narrators won't repeat it). */
export function markNarrated(id: string): void {
  lastSpokenId = id
}

// ── Streaming narration queue ─────────────────────────────────────────────────
// Speaks pieces of text as they arrive (sentence-by-sentence while Claude is
// still streaming), so the avatar starts answering almost immediately instead of
// waiting for the whole reply. Pieces are chunked and played in order.
let qGen = 0
const queue: string[] = []
let pumping = false

/** Clear the queue and stop current narration — call when a new reply starts. */
export function resetNarration(): void {
  qGen++
  queue.length = 0
  pumping = false
  lipSync.stop()
}

/** Append text to the narration queue; starts playback if idle. */
export function enqueueSpeech(text: string): void {
  const t = text.trim()
  if (!t) return
  for (const c of chunkText(t)) queue.push(c)
  if (!pumping) void pumpQueue()
}

async function pumpQueue(): Promise<void> {
  pumping = true
  const myGen = qGen
  while (queue.length) {
    if (myGen !== qGen) return
    const chunk = queue.shift() as string
    let b64 = ''
    try { b64 = await synth(chunk) } catch { /* skip on failure */ }
    if (myGen !== qGen) return
    if (b64) await playChunk(b64, chunk)
  }
  pumping = false
}
