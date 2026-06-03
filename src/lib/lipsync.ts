/**
 * Volume-based lip-sync engine (singleton).
 *
 * Decodes a base64 WAV (from the `synthesize_speech` Rust command), plays it
 * through the Web Audio API, and exposes a live "mouth openness" value (0..1)
 * derived from the audio's RMS amplitude. The VRM render loop reads `mouth()`
 * each frame to drive the 'aa' blendshape — no phoneme alignment needed, works
 * with any TTS audio.
 */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

class LipSync {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: AudioBufferSourceNode | null = null
  private data: Uint8Array = new Uint8Array(0)
  private level = 0 // smoothed mouth value
  private startedAt = 0
  private duration = 0
  private ended = false
  private lastP = 0

  /** True while audio is actively playing. */
  speaking = false
  /** The text currently being narrated (for subtitle display). */
  caption = ''
  /** Fired when playback finishes (or is stopped). */
  onEnd: (() => void) | null = null

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    }
    return this.ctx
  }

  async play(wavBase64: string, caption = ''): Promise<void> {
    this.stop()
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    const buf = base64ToArrayBuffer(wavBase64)
    const audioBuf = await ctx.decodeAudioData(buf)

    const source = ctx.createBufferSource()
    source.buffer = audioBuf

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    this.data = new Uint8Array(analyser.frequencyBinCount)

    source.connect(analyser)
    analyser.connect(ctx.destination)

    source.onended = () => {
      if (this.source === source) {
        this.speaking = false
        this.ended = true
        this.source = null
        this.analyser = null
        this.onEnd?.()
      }
    }

    this.caption = caption
    this.duration = audioBuf.duration
    this.startedAt = ctx.currentTime
    this.ended = false
    this.lastP = 0
    this.source = source
    this.analyser = analyser
    this.speaking = true
    source.start()
  }

  /** Playback progress 0..1 (1 once finished). Frozen on manual stop. */
  progress(): number {
    if (this.speaking && this.ctx && this.duration > 0) {
      const p = (this.ctx.currentTime - this.startedAt) / this.duration
      this.lastP = p < 0 ? 0 : p > 1 ? 1 : p
    } else if (this.ended) {
      this.lastP = 1
    }
    return this.lastP
  }

  stop(): void {
    if (this.source) {
      try { this.source.onended = null; this.source.stop() } catch { /* already stopped */ }
      this.source = null
    }
    this.analyser = null
    this.speaking = false
    this.caption = ''
    this.ended = false
    this.lastP = 0
  }

  /** Current mouth openness (0..1), smoothed for natural movement. */
  mouth(): number {
    let target = 0
    if (this.speaking && this.analyser) {
      this.analyser.getByteTimeDomainData(this.data)
      let sum = 0
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i] - 128) / 128 // -1..1
        sum += v * v
      }
      const rms = Math.sqrt(sum / this.data.length) // 0..~1
      // Map RMS to a lively mouth range; clamp to 1.
      target = Math.min(1, rms * 3.2)
    }
    // Asymmetric smoothing: open fast, close a touch slower.
    const k = target > this.level ? 0.5 : 0.25
    this.level += (target - this.level) * k
    if (this.level < 0.01) this.level = 0
    return this.level
  }
}

export const lipSync = new LipSync()
