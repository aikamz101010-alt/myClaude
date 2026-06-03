// Live Assistant "director": after each assistant reply, a SEPARATE Claude
// session (Haiku, fresh — never the working chat) reads the reply and picks an
// emotion + gesture for the avatar to perform. Runs only when the user enables
// the Live Assistant toggle. Drives expression/gesture; never touches the main
// chat's context.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAvatarStore } from '@/store/avatarStore'
import { useLiveStatus } from '@/store/liveStatusStore'
import { useLearnedMotions } from '@/store/learnedMotionsStore'
import { STANDBY_POSES, SPEAK_GESTURES, MOTION_NAMES } from './standbyPoses'

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

/** All gesture names the director may choose from. Includes dynamic full-body
 * motions (dance, cheer, …) when the Full-Motion setting is on. */
export function gestureNames(): string[] {
  const base = [...new Set([...SPEAK_GESTURES.map(g => g.name), ...STANDBY_POSES.map(p => p.name)])]
  const learned = Object.keys(useLearnedMotions.getState().motions)
  const dyn = useAvatarStore.getState().fullMotion ? MOTION_NAMES : []
  return [...base, ...dyn, ...learned]
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

  let tokIn = 0, tokOut = 0
  let resolveDone!: () => void
  const done = new Promise<void>(r => { resolveDone = r })

  // Register the listener BEFORE invoking so no events are missed.
  const unlisten = await listen<{
    kind: string; text?: string | null; request_id?: string | null; input_tokens?: number | null; output_tokens?: number | null
  }>(`chat:event:${channel}`, ev => {
    const e = ev.payload
    if (e.kind === 'text' && e.text) acc += e.text
    else if (e.kind === 'permission_request' && e.request_id) {
      // The director must not use tools — auto-deny so it never blocks.
      invoke('respond_permission', { chatId: channel, requestId: e.request_id, allow: false, message: 'no tools' }).catch(() => {})
    } else if (e.kind === 'done' || e.kind === 'error') {
      tokIn = e.input_tokens ?? 0; tokOut = e.output_tokens ?? 0
      resolveDone()
    }
  })

  const { liveModel } = useAvatarStore.getState()
  useLiveStatus.getState().start()
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
    useLiveStatus.getState().finish(tokIn, tokOut)
  }

  if (id !== seq) return null // superseded by a newer reply
  return parseCue(acc)
}

/** One animated channel of an agent-composed motion: a bone's axis driven as
 * base + sin(time*freq + phase) * amp. Lets the agent invent movements that
 * aren't in the fixed gesture library. */
export interface MotionChannel {
  bone: string
  axis: 'x' | 'y' | 'z'
  base?: number
  amp?: number
  freq?: number
  phase?: number
}

export const MOTION_BONES = [
  'head', 'neck', 'spine', 'chest', 'hips',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg',
]
const MOTION_BONE_SET = new Set(MOTION_BONES)
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function parseMotion(raw: unknown): MotionChannel[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: MotionChannel[] = []
  for (const c of raw.slice(0, 14)) {
    if (!c || typeof c !== 'object') continue
    const ch = c as Record<string, unknown>
    const bone = String(ch.bone ?? '')
    const axis = String(ch.axis ?? '')
    if (!MOTION_BONE_SET.has(bone) || !['x', 'y', 'z'].includes(axis)) continue
    out.push({
      bone,
      axis: axis as 'x' | 'y' | 'z',
      base: clampN(Number(ch.base) || 0, -3.2, 3.2),
      amp: clampN(Number(ch.amp) || 0, -3.2, 3.2),
      freq: clampN(Number(ch.freq) || 0, 0, 15),
      phase: Number(ch.phase) || 0,
    })
  }
  return out.length ? out : undefined
}

export interface AvatarCommand {
  action: 'perform' | 'forward' | 'save-motion'
  emotion?: Emotion
  gesture?: string
  motion?: MotionChannel[]
  saveAs?: string  // on perform: also save the composed motion under this name
  name?: string    // on save-motion: name to save the previous motion under
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

If no listed gesture fits, you may COMPOSE a custom movement with a "motion" array instead of "gesture":
  {"action":"perform","emotion":"happy","motion":[{"bone":"rightUpperArm","axis":"x","base":-2.5,"amp":0.3,"freq":8},{"bone":"hips","axis":"z","amp":0.12,"freq":7}],"say":"..."}
Each channel animates bone.axis as base + sin(time*freq + phase) * amp (radians).
Allowed bones: ${MOTION_BONES.join(', ')}. axis: x|y|z. base/amp about -3..3, freq about 0..12. Use several channels for a lively move.

To remember a composed motion for reuse, add "saveAs":"<short-name>" to the perform reply.
If the user asks to SAVE / remember / "simpan" the previous movement, reply: {"action":"save-motion","name":"<short-name>"}.

Output ONLY compact JSON on one line. Never use tools.`

  const id = ++seq
  const channel = `__director__-${id}`
  let acc = ''
  let tokIn = 0, tokOut = 0
  let resolveDone!: () => void
  const done = new Promise<void>(r => { resolveDone = r })
  const unlisten = await listen<{ kind: string; text?: string | null; request_id?: string | null; input_tokens?: number | null; output_tokens?: number | null }>(
    `chat:event:${channel}`,
    ev => {
      const e = ev.payload
      if (e.kind === 'text' && e.text) acc += e.text
      else if (e.kind === 'permission_request' && e.request_id) {
        invoke('respond_permission', { chatId: channel, requestId: e.request_id, allow: false, message: 'no tools' }).catch(() => {})
      } else if (e.kind === 'done' || e.kind === 'error') {
        tokIn = e.input_tokens ?? 0; tokOut = e.output_tokens ?? 0
        resolveDone()
      }
    },
  )
  useLiveStatus.getState().start()
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
    useLiveStatus.getState().finish(tokIn, tokOut)
  }

  const m = acc.match(/\{[\s\S]*?\}/)
  console.log('[live-assistant] command:', userText, '→ model:', LIVE_MODEL_ID[liveModel], '→ raw:', acc.slice(0, 300))
  if (!m) return { action: 'forward' }
  try {
    const o = JSON.parse(m[0]) as { action?: string; emotion?: string; gesture?: string; motion?: unknown; saveAs?: string; name?: string; say?: string }
    if (o.action === 'save-motion') {
      return { action: 'save-motion', name: typeof o.name === 'string' ? o.name : '' }
    }
    if (o.action === 'perform') {
      const result: AvatarCommand = {
        action: 'perform',
        emotion: (EMOTIONS as readonly string[]).includes(o.emotion ?? '') ? (o.emotion as Emotion) : 'happy',
        gesture: typeof o.gesture === 'string' ? o.gesture : 'none',
        motion: parseMotion(o.motion),
        saveAs: typeof o.saveAs === 'string' ? o.saveAs : undefined,
        say: typeof o.say === 'string' ? o.say : '',
      }
      console.log('[live-assistant] perform:', result)
      return result
    }
  } catch (e) { console.warn('[live-assistant] parse failed:', e) }
  console.log('[live-assistant] forward to main Claude Code')
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
- Compose CUSTOM dynamic motions when no gesture fits, via a "motion" array of
  channels: { bone, axis (x|y|z), base, amp, freq, phase } → animated as
  base + sin(time*freq + phase) * amp. Bones: ${MOTION_BONES.join(', ')}.
- Save a composed motion for reuse: add "saveAs":"<name>" on a perform, or reply
  { "action":"save-motion", "name":"<name>" } when asked to remember the last move.
  Saved motions then appear as named gestures you can replay later.

## How to behave
- When the user talks to you directly (greetings, chit-chat, "menari"/"dance", "wave", "look happy", questions about you), respond in character with a fitting emotion + gesture (or a composed motion), and a short spoken reply in the user's language.
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
