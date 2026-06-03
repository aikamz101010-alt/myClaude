import { create } from 'zustand'

/**
 * Runtime stats for the Live Assistant (Sari) — NOT persisted. Updated by the
 * director runtime; read by the Live badge to show activity, cumulative token
 * usage, and the time of the last execution.
 */
interface LiveStatus {
  running: boolean          // a director/command call is in flight
  tokensIn: number          // cumulative input tokens this app session
  tokensOut: number         // cumulative output tokens this app session
  lastRun: number | null    // timestamp (ms) of the last completed run

  start: () => void
  finish: (inTok: number, outTok: number) => void
}

export const useLiveStatus = create<LiveStatus>(set => ({
  running: false,
  tokensIn: 0,
  tokensOut: 0,
  lastRun: null,

  start: () => set({ running: true }),
  finish: (inTok, outTok) =>
    set(s => ({
      running: false,
      tokensIn: s.tokensIn + (inTok || 0),
      tokensOut: s.tokensOut + (outTok || 0),
      lastRun: Date.now(),
    })),
}))
