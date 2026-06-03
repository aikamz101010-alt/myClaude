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

// Director model options → full model IDs.
export const LIVE_MODEL_ID: Record<'haiku' | 'sonnet' | 'opus', string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
}

/** All gesture names the director may choose from (idle + speaking). */
export function gestureNames(): string[] {
  return [...new Set([...SPEAK_GESTURES.map(g => g.name), ...STANDBY_POSES.map(p => p.name)])]
}

const AGENT_PATH = '~/.claude/agents/live-virtual-assistant.md'

/** Read the agent file body (its frontmatter stripped). This is the editable
 * source of truth for the avatar's personality/behaviour. */
async function readAgentBody(): Promise<string | null> {
  try {
    const raw = await invoke<string>('read_file', { path: AGENT_PATH })
    const body = raw.replace(/^---[\s\S]*?---\s*/, '').trim()
    return body || null
  } catch {
    return null
  }
}

/** Base instructions for the avatar: its agent file if present (editable in Hub
 * or directly), otherwise built from the persona in settings. */
async function baseInstructions(): Promise<string> {
  const fromFile = await readAgentBody()
  if (fromFile) return fromFile
  const { assistantName, persona } = useAvatarStore.getState()
  const name = assistantName || 'the assistant'
  return [
    `You are ${name}, a friendly 3D virtual-assistant avatar.`,
    persona ? `Persona: ${persona}` : '',
    `You can show emotions (${EMOTIONS.join(', ')}) and play gestures (${gestureNames().join(', ')}).`,
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

  // Build the prompt from the agent file (source of truth) + this task.
  const prompt = `${await baseInstructions()}

The assistant just replied (below). Pick ONE emotion and ONE gesture that match its tone.
Allowed emotions: ${EMOTIONS.join(', ')}.
Allowed gestures: ${gestureNames().join(', ')}, none.
Output ONLY compact JSON: {"emotion":"<emotion>","gesture":"<gesture>"}. Never use tools.

Reply:
${reply.slice(0, 2000)}`

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

  const { liveModel } = useAvatarStore.getState()
  try {
    await invoke('send_chat_stream', {
      projectId: channel,           // separate event channel = separate session
      message: prompt,
      workingDir,
      sessionId: null,              // fresh session — no working-chat context
      model: LIVE_MODEL_ID[liveModel],
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

export interface AvatarCommand {
  action: 'perform' | 'forward'
  emotion?: Emotion
  gesture?: string
  say?: string
}

/** Interactive command for the avatar. The live-assistant (separate session)
 * decides whether the user is talking TO the avatar (perform a gesture / chat)
 * or asking for coding work meant for the main Claude Code agent (forward). */
export async function commandAvatar(userText: string, workingDir: string): Promise<AvatarCommand> {
  const { liveModel } = useAvatarStore.getState()
  const prompt = `${await baseInstructions()}

The user said: "${userText}"
Decide who this is for:
- If it is addressed to YOU (perform/express something — dance, wave, spin, look happy, greet — or just chat), reply:
  {"action":"perform","emotion":"<emotion>","gesture":"<gesture>","say":"<short spoken reply in the user's language, max 160 chars>"}
- If it is a software / coding / file / terminal task for the main Claude Code assistant, reply:
  {"action":"forward"}
Allowed emotions: ${EMOTIONS.join(', ')}. Allowed gestures: ${gestureNames().join(', ')}, none.
Output ONLY compact JSON on one line. Never use tools.`

  const id = ++seq
  const channel = `__director__-${id}`
  let acc = ''
  let resolveDone!: () => void
  const done = new Promise<void>(r => { resolveDone = r })
  const unlisten = await listen<{ kind: string; text?: string | null; request_id?: string | null }>(
    `chat:event:${channel}`,
    ev => {
      const e = ev.payload
      if (e.kind === 'text' && e.text) acc += e.text
      else if (e.kind === 'permission_request' && e.request_id) {
        invoke('respond_permission', { chatId: channel, requestId: e.request_id, allow: false, message: 'no tools' }).catch(() => {})
      } else if (e.kind === 'done' || e.kind === 'error') resolveDone()
    },
  )
  try {
    await invoke('send_chat_stream', {
      projectId: channel, message: prompt, workingDir,
      sessionId: null, model: LIVE_MODEL_ID[liveModel], permissionMode: 'default',
    })
    await done
  } catch {
    return { action: 'forward' } // on failure, let the main agent handle it
  } finally {
    unlisten()
  }

  const m = acc.match(/\{[\s\S]*?\}/)
  if (!m) return { action: 'forward' }
  try {
    const o = JSON.parse(m[0]) as { action?: string; emotion?: string; gesture?: string; say?: string }
    if (o.action === 'perform') {
      return {
        action: 'perform',
        emotion: (EMOTIONS as readonly string[]).includes(o.emotion ?? '') ? (o.emotion as Emotion) : 'happy',
        gesture: typeof o.gesture === 'string' ? o.gesture : 'none',
        say: typeof o.say === 'string' ? o.say : '',
      }
    }
  } catch { /* fall through */ }
  return { action: 'forward' }
}

/** Write/refresh the live-virtual-assistant agent file from the persona, to the
 * global `~/.claude/agents/` folder (shared across all projects). The directory
 * is ensured first by calling `create_agent` (which runs create_dir_all before
 * its own write); we then overwrite with the persona-aware content. */
export async function ensureLiveAssistantAgent(): Promise<void> {
  const { assistantName, persona, liveModel } = useAvatarStore.getState()
  const name = assistantName || 'Assistant'
  const body = `---
name: live-virtual-assistant
description: Brain & personality for the ${name} virtual-assistant avatar
model: ${liveModel}
---

You are ${name}, a 3D virtual-assistant avatar.

## Persona
${persona || 'Friendly, warm, and helpful.'}

## What you can do
- Show emotions: ${EMOTIONS.join(', ')}
- Play gestures: ${gestureNames().join(', ')}, none

## How to behave
- When the user talks to you directly (greetings, chit-chat, "menari"/"dance", "wave", "look happy", questions about you), respond in character with a fitting emotion + gesture, and a short spoken reply in the user's language.
- When the user asks for software / coding / file / terminal work, that is for the main Claude Code assistant — let it be forwarded.
- Keep spoken replies short and natural.

> Edit this file to teach or adjust ${name}'s personality and behaviour.
> (Saving the Virtual Assistant settings in the Hub regenerates this file.)
`
  // Ensure ~/.claude/agents exists (create_agent runs create_dir_all first).
  try {
    await invoke('create_agent', { name: 'live-virtual-assistant', description: `Director for ${name}`, model: liveModel })
  } catch { /* already exists or validation — dir is created regardless */ }
  try {
    await invoke('write_file', { path: '~/.claude/agents/live-virtual-assistant.md', content: body })
  } catch (e) {
    console.warn('[live-assistant] could not write agent file:', e)
  }
}
