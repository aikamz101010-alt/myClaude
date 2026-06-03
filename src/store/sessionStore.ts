import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ── Types ─────────────────────────────────────────────────────────

export interface ToolUse {
  name: string
  input_summary: string
}

export interface SessionEntry {
  role: 'user' | 'assistant'
  text: string
  tool_uses: ToolUse[]
  session_id: string | null
  uuid: string | null
}

// Backend stream event (chat:event:{chatId})
interface ChatStreamEvent {
  kind: 'text' | 'tool_use' | 'tool_result' | 'agent_start' | 'agent_stop' | 'permission_request' | 'done' | 'error'
  text?: string | null
  tool_name?: string | null
  tool_input?: string | null
  tool_use_id?: string | null
  subagent?: string | null
  agent_name?: string | null
  request_id?: string | null
  session_id?: string | null
  cost_usd?: number | null
  input_tokens?: number | null
  output_tokens?: number | null
}

// Ordered content blocks (assistant messages built from stream)
export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: string; result?: string; toolUseId?: string; subagent?: string }

export interface PendingPermission {
  requestId: string
  tool: string
  input: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'error' | 'system'
  content: string            // user/error/system text, or fallback for assistant
  blocks?: Block[]           // streamed assistant content (text + tools interleaved)
  timestamp: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  toolUses?: ToolUse[]       // legacy: imported-from-terminal tool list
  fromTerminal?: boolean
}

export interface Chat {
  id: string
  projectId: string
  title: string
  workingDir: string
  messages: Message[]
  status: 'idle' | 'streaming' | 'error'
  sessionId: string | null
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  model: string              // '' = default; e.g. 'claude-opus-4-8'
  permissionMode: string     // 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'
  yolo: boolean              // YOLO: auto-approve everything (= bypassPermissions)
  pendingPermission: PendingPermission | null
  activeAgents: string[]     // running subagent names (from SDK hooks)
  // id of the in-progress assistant message (while streaming)
  streamingMsgId: string | null
}

interface SessionStore {
  chats: Record<string, Chat>
  // ordered chat ids per project
  chatsByProject: Record<string, string[]>

  createChat: (projectId: string, workingDir: string, title?: string) => string
  closeChat: (chatId: string) => void
  renameChat: (chatId: string, title: string) => void
  setChatModel: (chatId: string, model: string) => void
  setChatPermissionMode: (chatId: string, mode: string) => void
  setChatYolo: (chatId: string, yolo: boolean) => void
  respondPermission: (chatId: string, allow: boolean, alwaysAllow?: boolean, message?: string | null) => void
  interruptChat: (chatId: string) => void
  getProjectChats: (projectId: string) => Chat[]

  sendMessageStream: (chatId: string, content: string) => Promise<void>
  subscribeChat: (chatId: string) => Promise<UnlistenFn>

  importFromTerminal: (chatId: string) => Promise<void>
  clearMessages: (chatId: string) => void

  // PTY status (terminal indicator) — keyed by projectId
  ptyStatus: Record<string, 'running' | 'stopped'>
  setPtyStatus: (projectId: string, status: 'running' | 'stopped') => void

  // Click-to-insert: text queued to be appended into a chat's input box
  pendingInsert: Record<string, string>
  pushInsert: (chatId: string, text: string) => void
  consumeInsert: (chatId: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────

let idCounter = 0
function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${++idCounter}`
}

function emptyChat(projectId: string, workingDir: string, title: string): Chat {
  return {
    id: uid('chat'),
    projectId,
    title,
    workingDir,
    messages: [],
    status: 'idle',
    sessionId: null,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    model: '',
    permissionMode: 'default',
    yolo: false,
    pendingPermission: null,
    activeAgents: [],
    streamingMsgId: null,
  }
}

// Human-readable model label for the switch marker
function modelLabel(model: string): string {
  if (!model) return 'Default'
  return model
    .replace('claude-', '')
    .replace(/-\d{8}$/, '')   // strip date suffix
}

// ── Store ─────────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>((set, get) => ({
  chats: {},
  chatsByProject: {},
  ptyStatus: {},
  pendingInsert: {},

  pushInsert: (chatId, text) =>
    set(s => ({
      pendingInsert: {
        ...s.pendingInsert,
        [chatId]: (s.pendingInsert[chatId] ? s.pendingInsert[chatId] + ' ' : '') + text,
      },
    })),

  consumeInsert: (chatId) =>
    set(s => {
      if (!(chatId in s.pendingInsert)) return s
      const { [chatId]: _, ...rest } = s.pendingInsert
      return { pendingInsert: rest }
    }),

  createChat: (projectId, workingDir, title) => {
    const existing = get().chatsByProject[projectId] ?? []
    const chat = emptyChat(projectId, workingDir, title ?? `Chat ${existing.length + 1}`)
    set(s => ({
      chats: { ...s.chats, [chat.id]: chat },
      chatsByProject: {
        ...s.chatsByProject,
        [projectId]: [...existing, chat.id],
      },
    }))
    return chat.id
  },

  closeChat: (chatId) => {
    set(s => {
      const chat = s.chats[chatId]
      if (!chat) return s
      const { [chatId]: _removed, ...restChats } = s.chats
      const list = (s.chatsByProject[chat.projectId] ?? []).filter(id => id !== chatId)
      return {
        chats: restChats,
        chatsByProject: { ...s.chatsByProject, [chat.projectId]: list },
      }
    })
  },

  renameChat: (chatId, title) =>
    set(s => s.chats[chatId]
      ? { chats: { ...s.chats, [chatId]: { ...s.chats[chatId], title } } }
      : s),

  setChatModel: (chatId, model) =>
    set(s => {
      const chat = s.chats[chatId]
      if (!chat || chat.model === model) return s
      const marker: Message = {
        id: uid('msg'),
        role: 'system',
        content: `──── switch to model : ${modelLabel(model)} ────`,
        timestamp: Date.now(),
      }
      return {
        chats: {
          ...s.chats,
          [chatId]: { ...chat, model, messages: [...chat.messages, marker] },
        },
      }
    }),

  setChatPermissionMode: (chatId, mode) =>
    set(s => {
      const chat = s.chats[chatId]
      if (!chat || chat.permissionMode === mode) return s
      const marker: Message = {
        id: uid('msg'),
        role: 'system',
        content: `──── permission mode : ${mode} ────`,
        timestamp: Date.now(),
      }
      return {
        chats: {
          ...s.chats,
          [chatId]: { ...chat, permissionMode: mode, messages: [...chat.messages, marker] },
        },
      }
    }),

  setChatYolo: (chatId, yolo) =>
    set(s => {
      const chat = s.chats[chatId]
      if (!chat) return s
      const marker: Message = {
        id: uid('msg'),
        role: 'system',
        content: yolo ? '──── YOLO mode ON (auto-approve all tools) ────' : '──── YOLO mode OFF ────',
        timestamp: Date.now(),
      }
      return {
        chats: {
          ...s.chats,
          [chatId]: {
            ...chat,
            yolo,
            // YOLO maps to bypassPermissions; turning off restores default
            permissionMode: yolo ? 'bypassPermissions' : 'default',
            messages: [...chat.messages, marker],
          },
        },
      }
    }),

  respondPermission: (chatId, allow, alwaysAllow, message) => {
    const chat = get().chats[chatId]
    if (!chat?.pendingPermission) return
    const { requestId } = chat.pendingPermission
    const note = message?.trim()
    invoke('respond_permission', {
      chatId, requestId, allow,
      // Custom instruction (if typed) is sent to Claude; else a sensible default.
      message: note ? note : (allow ? null : 'Denied by user'),
    }).catch(() => {})
    set(s => {
      const c = s.chats[chatId]
      if (!c) return s
      // alwaysAllow → flip to YOLO so future tools auto-approve
      const yolo = alwaysAllow ? true : c.yolo
      return {
        chats: {
          ...s.chats,
          [chatId]: {
            ...c,
            pendingPermission: null,
            yolo,
            permissionMode: alwaysAllow ? 'bypassPermissions' : c.permissionMode,
          },
        },
      }
    })
  },

  interruptChat: (chatId) => {
    invoke('interrupt_chat', { chatId }).catch(() => {})
    set(s => {
      const c = s.chats[chatId]
      if (!c) return s
      return {
        chats: {
          ...s.chats,
          [chatId]: { ...c, status: 'idle', streamingMsgId: null, pendingPermission: null, activeAgents: [] },
        },
      }
    })
  },

  getProjectChats: (projectId) => {
    const ids = get().chatsByProject[projectId] ?? []
    return ids.map(id => get().chats[id]).filter(Boolean)
  },

  subscribeChat: async (chatId) => {
    const unlisten = await listen<ChatStreamEvent>(`chat:event:${chatId}`, ev => {
      const e = ev.payload
      set(s => {
        const chat = s.chats[chatId]
        if (!chat) return s

        let messages = [...chat.messages]
        let streamingMsgId = chat.streamingMsgId
        let status = chat.status
        let sessionId = chat.sessionId
        let totalCost = chat.totalCost
        let totalInputTokens = chat.totalInputTokens
        let totalOutputTokens = chat.totalOutputTokens
        let pendingPermission = chat.pendingPermission
        let activeAgents = chat.activeAgents

        // Ensure there's an in-progress assistant message
        const ensureAssistant = (): number => {
          let idx = messages.findIndex(m => m.id === streamingMsgId)
          if (idx === -1) {
            const msg: Message = {
              id: uid('msg'),
              role: 'assistant',
              content: '',
              blocks: [],
              timestamp: Date.now(),
            }
            messages.push(msg)
            streamingMsgId = msg.id
            idx = messages.length - 1
          }
          return idx
        }

        switch (e.kind) {
          case 'text': {
            const idx = ensureAssistant()
            const msg = { ...messages[idx] }
            const blocks = [...(msg.blocks ?? [])]
            const last = blocks[blocks.length - 1]
            if (last && last.type === 'text') {
              blocks[blocks.length - 1] = { type: 'text', text: last.text + (e.text ?? '') }
            } else {
              blocks.push({ type: 'text', text: e.text ?? '' })
            }
            msg.blocks = blocks
            messages[idx] = msg
            break
          }
          case 'tool_use': {
            const idx = ensureAssistant()
            const msg = { ...messages[idx] }
            const blocks = [...(msg.blocks ?? [])]
            blocks.push({
              type: 'tool',
              name: e.tool_name ?? 'tool',
              input: e.tool_input ?? '',
              toolUseId: e.tool_use_id ?? undefined,
              subagent: e.subagent ?? undefined,
            })
            msg.blocks = blocks
            messages[idx] = msg
            break
          }
          case 'tool_result': {
            const idx = ensureAssistant()
            const msg = { ...messages[idx] }
            const blocks = [...(msg.blocks ?? [])]
            // Match by toolUseId; fallback to last tool without result
            let matched = false
            if (e.tool_use_id) {
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i]
                if (b.type === 'tool' && b.toolUseId === e.tool_use_id) {
                  blocks[i] = { ...b, result: e.text ?? '' }
                  matched = true
                  break
                }
              }
            }
            if (!matched) {
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i]
                if (b.type === 'tool' && b.result === undefined) {
                  blocks[i] = { ...b, result: e.text ?? '' }
                  break
                }
              }
            }
            msg.blocks = blocks
            messages[idx] = msg
            break
          }
          case 'agent_start': {
            const name = e.agent_name ?? 'subagent'
            if (!activeAgents.includes(name)) activeAgents = [...activeAgents, name]
            break
          }
          case 'agent_stop': {
            const name = e.agent_name ?? 'subagent'
            activeAgents = activeAgents.filter(a => a !== name)
            break
          }
          case 'permission_request': {
            // Coerce to string defensively — never store an object (would crash render)
            const pin = e.tool_input as unknown
            const inputStr = typeof pin === 'string' ? pin : pin == null ? '' : (() => { try { return JSON.stringify(pin) } catch { return String(pin) } })()
            pendingPermission = {
              requestId: e.request_id ?? '',
              tool: typeof e.tool_name === 'string' ? e.tool_name : 'tool',
              input: inputStr,
            }
            break
          }
          case 'done': {
            status = 'idle'
            sessionId = e.session_id ?? sessionId
            totalCost += e.cost_usd ?? 0
            totalInputTokens += e.input_tokens ?? 0
            totalOutputTokens += e.output_tokens ?? 0
            activeAgents = []
            const idx = messages.findIndex(m => m.id === streamingMsgId)
            if (idx !== -1) {
              messages[idx] = {
                ...messages[idx],
                costUsd: e.cost_usd ?? undefined,
                inputTokens: e.input_tokens ?? undefined,
                outputTokens: e.output_tokens ?? undefined,
              }
            }
            streamingMsgId = null
            break
          }
          case 'error': {
            status = 'error'
            pendingPermission = null
            activeAgents = []
            if (streamingMsgId) {
              const idx = messages.findIndex(m => m.id === streamingMsgId)
              if (idx !== -1 && (messages[idx].blocks?.length ?? 0) === 0) {
                messages.splice(idx, 1)
              }
            }
            messages.push({
              id: uid('msg'),
              role: 'error',
              content: e.text ?? 'Unknown error',
              timestamp: Date.now(),
            })
            streamingMsgId = null
            break
          }
        }

        return {
          chats: {
            ...s.chats,
            [chatId]: { ...chat, messages, streamingMsgId, status, sessionId, totalCost, totalInputTokens, totalOutputTokens, pendingPermission, activeAgents },
          },
        }
      })
    })
    return unlisten
  },

  sendMessageStream: async (chatId, content) => {
    const chat = get().chats[chatId]
    if (!chat) return

    const userMsg: Message = {
      id: uid('msg'),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    set(s => ({
      chats: {
        ...s.chats,
        [chatId]: {
          ...chat,
          messages: [...chat.messages, userMsg],
          status: 'streaming',
          streamingMsgId: null,
          // Use first user message as title if still default
          title: chat.messages.length === 0 && chat.title.startsWith('Chat ')
            ? content.slice(0, 30)
            : chat.title,
        },
      },
    }))

    try {
      // chatId is used as the event-channel key on the backend
      await invoke('send_chat_stream', {
        projectId: chatId,
        message: content,
        workingDir: chat.workingDir,
        sessionId: chat.sessionId,
        model: chat.model || null,
        permissionMode: chat.permissionMode || null,
      })
    } catch (err) {
      set(s => {
        const c = s.chats[chatId]
        if (!c) return s
        return {
          chats: {
            ...s.chats,
            [chatId]: {
              ...c,
              status: 'error',
              messages: [...c.messages, {
                id: uid('msg'), role: 'error', content: String(err), timestamp: Date.now(),
              }],
            },
          },
        }
      })
    }
  },

  importFromTerminal: async (chatId) => {
    const chat = get().chats[chatId]
    if (!chat) return
    try {
      const entries = await invoke<SessionEntry[]>('get_session_history', {
        projectPath: chat.workingDir,
      })
      if (entries.length === 0) return

      const messages: Message[] = entries
        .filter(e => e.role === 'user' || e.role === 'assistant')
        .map(e => ({
          id: uid('msg'),
          role: e.role as 'user' | 'assistant',
          content: e.text,
          timestamp: Date.now(),
          toolUses: e.tool_uses.length > 0 ? e.tool_uses : undefined,
          fromTerminal: true,
        }))

      const latestSessionId = entries
        .filter(e => e.session_id).map(e => e.session_id!).pop() ?? null

      set(s => {
        const c = s.chats[chatId]
        if (!c) return s
        return {
          chats: {
            ...s.chats,
            [chatId]: { ...c, messages, sessionId: latestSessionId ?? c.sessionId, status: 'idle' },
          },
        }
      })
    } catch { /* no session yet */ }
  },

  clearMessages: (chatId) =>
    set(s => s.chats[chatId]
      ? { chats: { ...s.chats, [chatId]: { ...s.chats[chatId], messages: [], status: 'idle', streamingMsgId: null } } }
      : s),

  setPtyStatus: (projectId, status) =>
    set(s => ({ ptyStatus: { ...s.ptyStatus, [projectId]: status } })),
}))
