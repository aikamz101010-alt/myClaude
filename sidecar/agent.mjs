#!/usr/bin/env node
// Claude Agent SDK sidecar.
// Protocol: newline-delimited JSON over stdin (commands) and stdout (events).
//
// Commands (stdin):
//   {cmd:"prompt", chatId, message, cwd, model?, permissionMode?, resume?, claudePath?}
//   {cmd:"permission", chatId, requestId, allow:boolean, message?, always?:boolean}
//   {cmd:"interrupt", chatId}
//
// Events (stdout), each tagged with chatId:
//   {chatId, kind:"text", text}
//   {chatId, kind:"tool_use", tool, input, toolUseId, subagent?}
//   {chatId, kind:"tool_result", toolUseId, text}
//   {chatId, kind:"agent_start", name}
//   {chatId, kind:"agent_stop", name}
//   {chatId, kind:"permission_request", requestId, tool, input}
//   {chatId, kind:"done", sessionId, costUsd, inputTokens, outputTokens}
//   {chatId, kind:"error", text}
//   {kind:"ready"}  (once at startup)

import { query } from '@anthropic-ai/claude-agent-sdk'
import readline from 'node:readline'

// ── output helper ─────────────────────────────────────────────────
function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

// Per-chat runtime state
const active = new Map() // chatId → { abort: AbortController, pendingPerms: Map<requestId, resolve> }

let reqCounter = 0
function nextReqId() { return `perm-${Date.now()}-${++reqCounter}` }

// ── handle a prompt ───────────────────────────────────────────────
async function handlePrompt(cmd) {
  const { chatId, message, cwd, model, permissionMode, resume, claudePath, systemAppend } = cmd

  const abort = new AbortController()
  const pendingPerms = new Map()
  active.set(chatId, { abort, pendingPerms })

  // canUseTool → ask the UI (unless bypassPermissions handled by SDK)
  const canUseTool = async (toolName, input) => {
    const requestId = nextReqId()
    emit({ chatId, kind: 'permission_request', requestId, tool: toolName, input })
    return await new Promise(resolve => {
      pendingPerms.set(requestId, (allow, msg) => {
        if (allow) {
          resolve({ behavior: 'allow', updatedInput: input })
        } else {
          resolve({ behavior: 'deny', message: msg || 'Denied by user' })
        }
      })
    })
  }

  const options = {
    cwd: cwd || process.cwd(),
    abortController: abort,
    canUseTool,
    permissionMode: permissionMode || 'default',
    includePartialMessages: false,
    hooks: {
      SubagentStart: [{
        hooks: [async (inp) => {
          const name = inp?.subagent_type || inp?.agent_type || inp?.name || 'subagent'
          emit({ chatId, kind: 'agent_start', name })
          return { continue: true }
        }],
      }],
      SubagentStop: [{
        hooks: [async (inp) => {
          const name = inp?.subagent_type || inp?.agent_type || inp?.name || 'subagent'
          emit({ chatId, kind: 'agent_stop', name })
          return { continue: true }
        }],
      }],
    },
  }
  if (model) options.model = model
  if (resume) options.resume = resume
  if (claudePath) options.pathToClaudeCodeExecutable = claudePath
  // Lead-orchestrator directive + CONTRACT.md appended to Claude Code's preset prompt
  if (systemAppend && systemAppend.trim()) {
    options.systemPrompt = { type: 'preset', preset: 'claude_code', append: systemAppend }
  }
  // bypassPermissions (YOLO) requires explicit opt-in
  if (permissionMode === 'bypassPermissions') {
    options.allowDangerouslySkipPermissions = true
  }

  try {
    const q = query({ prompt: message, options })

    for await (const msg of q) {
      if (msg.type === 'assistant') {
        const subagent = msg.subagent_type || undefined
        const content = msg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              emit({ chatId, kind: 'text', text: block.text, subagent })
            } else if (block.type === 'tool_use') {
              emit({
                chatId, kind: 'tool_use',
                tool: block.name,
                input: summariseInput(block.input),
                toolUseId: block.id,
                subagent,
              })
            }
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              emit({
                chatId, kind: 'tool_result',
                toolUseId: block.tool_use_id,
                text: extractResult(block.content),
              })
            }
          }
        }
      } else if (msg.type === 'result') {
        if (msg.is_error) {
          emit({ chatId, kind: 'error', text: msg.result || 'Error' })
        } else {
          emit({
            chatId, kind: 'done',
            sessionId: msg.session_id,
            costUsd: msg.total_cost_usd ?? null,
            inputTokens: msg.usage?.input_tokens ?? null,
            outputTokens: msg.usage?.output_tokens ?? null,
          })
        }
      }
    }
  } catch (err) {
    const text = String(err?.message || err)
    emit({ chatId, kind: 'error', text })
  } finally {
    active.delete(chatId)
  }
}

function summariseInput(input) {
  if (!input || typeof input !== 'object') return String(input ?? '')
  for (const f of ['name', 'subagent_type', 'command', 'file_path', 'path', 'query', 'pattern', 'description', 'prompt']) {
    if (typeof input[f] === 'string' && input[f]) {
      const s = input[f]
      return s.length > 160 ? s.slice(0, 160) + '…' : s
    }
  }
  const s = JSON.stringify(input)
  return s.length > 160 ? s.slice(0, 160) + '…' : s
}

function extractResult(content) {
  let text = ''
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    text = content.map(b => (typeof b === 'string' ? b : b?.text || '')).join('\n')
  }
  const lines = text.split('\n').slice(0, 14)
  let out = lines.join('\n')
  if (text.split('\n').length > 14) out += '\n…'
  return out.slice(0, 3000)
}

// ── stdin command loop ────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let cmd
  try { cmd = JSON.parse(trimmed) } catch { return }

  if (cmd.cmd === 'prompt') {
    handlePrompt(cmd) // fire-and-forget; events stream out
  } else if (cmd.cmd === 'permission') {
    const st = active.get(cmd.chatId)
    const resolver = st?.pendingPerms.get(cmd.requestId)
    if (resolver) {
      st.pendingPerms.delete(cmd.requestId)
      resolver(cmd.allow, cmd.message)
    }
  } else if (cmd.cmd === 'interrupt') {
    const st = active.get(cmd.chatId)
    if (st) { try { st.abort.abort() } catch {} }
  }
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))

emit({ kind: 'ready' })
