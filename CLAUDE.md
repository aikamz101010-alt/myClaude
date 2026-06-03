# Claude X — Project Instructions

Desktop GUI for the **Claude Code CLI**, built with **Tauri 2 (Rust) + React + TypeScript**, powered by the **Claude Agent SDK** (Node sidecar).

## Architecture

- **Frontend** (`src/`): React 18 + TS + Vite + Tailwind + Zustand + xterm.js
  - `windows/Hub.tsx` — project dashboard (cards, library, agent monitor, settings)
  - `windows/ProjectWindow.tsx` — per-project workspace (chat / terminal / contract tabs, folder tree, file editor tabs)
  - `components/project/` — `ChatView`, `ChatInput`, `ContractPanel`, `ContractEditor`, `FolderTree`, `FileEditor`, `TerminalView`
  - `store/` — `sessionStore` (chats/sessions, streaming events, permission, YOLO), `libraryStore`, `projectStore`, `themeStore`
  - `lib/tagColors.ts` — theme-aware skill/agent/plugin colors (`useTagColors()`)
- **Backend** (`src-tauri/src/`): Tauri commands
  - `commands/agent.rs` — `send_chat_stream` (routes to sidecar), `respond_permission`, `interrupt_chat`
  - `commands/library.rs` — auth (`auth_status_json`/`auth_login`/`auth_submit_code`/`auth_logout`), library scan, install (plugin/skill/agent, GitHub), `ensure_lead_orchestrator`
  - `commands/project.rs` — projects, contract read/write, `list_directory`, `read_file`/`write_file`
  - `commands/session.rs` — parse Claude CLI JSONL session history
  - `auth_manager.rs` — in-app browser OAuth login via a PTY: `auth_login` streams the login URL (`auth:url`/`auth:event`), `auth_submit_code` pastes the code back to the waiting `claude auth login`
  - `sidecar_manager.rs` — spawns & manages the Node Agent SDK sidecar, normalizes events → `chat:event:{chatId}`
  - `pty_manager.rs` — embedded terminal (portable-pty)
- **Sidecar** (`sidecar/agent.mjs`): Node process using `@anthropic-ai/claude-agent-sdk`. NDJSON over stdin/stdout. `canUseTool` → permission popups; `SubagentStart/Stop` hooks → agent activity. Bundled into the .app at `Contents/Resources/sidecar/`.

## Key behaviors

- **Auth**: chat/sidecar drop `ANTHROPIC_API_KEY` to use OAuth/ClaudeMax **subscription** (preferred — user does NOT want API-key fallback for chat). Login one-time per machine. Settings offers in-app **browser OAuth login** (PTY-based, via `auth_manager`) and an API-key field.
- **Auto-update**: `tauri-plugin-updater` + `tauri-plugin-process`. Endpoint `releases/latest/download/latest.json`, public key in `tauri.conf.json`. Settings shows current vs available version + install. Releases must include `Claude_X.app.tar.gz` + `.sig` + `latest.json` (see README "Releasing a new version").
- **Lead Orchestrator**: each session, the backend injects `CONTRACT.md` + `CLAUDE.md` + `MEMORY.md` (if present) as a system-prompt directive so the agent stays aligned. Scope (project/personal) creates a `lead-orchestrator` agent file.
- **Permissions**: per-tool popups (Allow/Deny/Always) via `canUseTool`; YOLO mode = `bypassPermissions`.
- **CONTRACT.md** sections: `# Allowed Skills`, `# Active Agents`, `# Plugins`, `# Lead Orchestrator`, `# Documents` (PRD/TRD auto-maintain), `# Custom Rules`.

## Conventions

- Run `npx tsc --noEmit` (frontend) and `cargo check` (in `src-tauri/`) before considering work done — both must be clean.
- Theme colors come from `useTagColors()` (theme-aware), not hardcoded hex.
- Permission/event payloads sent to the UI must be **strings**, never raw objects (rendering an object crashes React → blank screen).

## Build

```bash
npm run tauri dev                                    # development
npm run tauri build                                  # current arch .dmg
npm run tauri build -- --target universal-apple-darwin   # universal (Intel + Apple Silicon)

# Signed release (updater artifacts) — private key at ~/.tauri/claudex-updater.key (never commit)
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/claudex-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri build -- --target universal-apple-darwin
```
The app is ad-hoc signed (`signingIdentity: "-"`). Unsigned distribution needs the one-time Gatekeeper bypass (see README). Build artifacts staged for upload go to `release-artifacts/` (gitignored). Bump `version` in `tauri.conf.json` per release so the updater detects it.
