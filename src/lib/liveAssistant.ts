// Live Assistant "director": after each assistant reply, a SEPARATE Claude
// session (Haiku, fresh — never the working chat) reads the reply and picks an
// emotion + gesture for the avatar to perform. Runs only when the user enables
// the Live Assistant toggle. Drives expression/gesture; never touches the main
// chat's context.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAvatarStore } from '@/store/avatarStore'
import { STANDBY_POSES, SPEAK_GESTURES } from './standbyPoses'

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'relaxed'] as const
export type Emotion = (typeof EMOTIONS)[number]

export interface PerformanceCue {
  emotion: Emotion
  gesture: string // a gesture name from the library, or 'none'
}

const HAIKU = 'claude-haiku-4-5-20251001'

/** All gesture names the director may choose from (idle + speaking). */
export function gestureNames(): string[] {
  return [...new Set([...SPEAK_GESTURES.map(g => g.name), ...STANDBY_POSES.map(p => p.name)])]
}

function buildPrompt(reply: string): string {
  const { assistantName, persona } = useAvatarStore.getState()
  return [
    `You are the performance director for a 3D virtual assistant named ${assistantName || 'the assistant'}.`,
    persona ? `The assistant's persona: ${persona}` : '',
    `Read the assistant's reply below and choose ONE emotion and ONE gesture that best match its tone and content.`,
    `Allowed emotions: ${EMOTIONS.join(', ')}.`,
    `Allowed gestures: ${gestureNames().join(', ')}, none.`,
    `Do NOT use any tools. Output ONLY compact JSON on a single line, nothing else:`,
    `{"emotion":"<emotion>","gesture":"<gesture>"}`,
    ``,
    `Reply:`,
    reply.slice(0, 2000),
  ].filter(Boolean).join('\n')
}

function parseCue(text: string): PerformanceCue | null {
  const m = text.match(/\{[\s\S]*?\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as { emotion?: string; gesture?: string }
    const emotion = (EMOTIONS as readonly string[]).includes(o.emotion ?? '') ? (o.emotion as Emotion) : 'neutral'
    const gesture = typeof o.gesture === 'string' ? o.gesture : 'none'
    return { emotion, gesture }
  } catch {
    return null
  }
}

let seq = 0

/** Run the director once for `reply`. Returns the chosen cue (or null). Stale
 * runs (superseded by a newer reply) resolve to null. */
export async function runDirector(reply: string, workingDir: string): Promise<PerformanceCue | null> {
  const id = ++seq
  const channel = `__director__-${id}`
  let acc = ''

  let resolveDone!: () => void
  const done = new Promise<void>(r => { resolveDone = r })

  // Register the listener BEFORE invoking so no events are missed.
  const unlisten = await listen<{
    kind: string; text?: string | null; request_id?: string | null
  }>(`chat:event:${channel}`, ev => {
    const e = ev.payload
    if (e.kind === 'text' && e.text) acc += e.text
    else if (e.kind === 'permission_request' && e.request_id) {
      // The director must not use tools — auto-deny so it never blocks.
      invoke('respond_permission', { chatId: channel, requestId: e.request_id, allow: false, message: 'no tools' }).catch(() => {})
    } else if (e.kind === 'done' || e.kind === 'error') {
      resolveDone()
    }
  })

  try {
    await invoke('send_chat_stream', {
      projectId: channel,           // separate event channel = separate session
      message: buildPrompt(reply),
      workingDir,
      sessionId: null,              // fresh session — no working-chat context
      model: HAIKU,
      permissionMode: 'default',
    })
    await done
  } catch {
    return null
  } finally {
    unlisten()
  }

  if (id !== seq) return null // superseded by a newer reply
  return parseCue(acc)
}

/** Write/refresh the local live-virtual-assistant agent file from the persona.
 * Best-effort: `.claude/agents/` already exists in managed projects. */
export async function ensureLiveAssistantAgent(workingDir: string): Promise<void> {
  const { assistantName, persona } = useAvatarStore.getState()
  const name = assistantName || 'Assistant'
  const body = `---
name: live-virtual-assistant
description: Performance director for the ${name} virtual assistant avatar
---

You are the performance director for a 3D virtual assistant named ${name}.

${persona ? `Persona:\n${persona}\n` : ''}
Given an assistant reply, choose ONE emotion and ONE gesture matching its tone.
- Emotions: ${EMOTIONS.join(', ')}
- Gestures: ${gestureNames().join(', ')}, none

Output ONLY compact JSON: {"emotion":"<emotion>","gesture":"<gesture>"}
Never use tools.
`
  try {
    await invoke('write_file', { path: `${workingDir}/.claude/agents/live-virtual-assistant.md`, content: body })
  } catch { /* dir may not exist yet — non-fatal */ }
}
