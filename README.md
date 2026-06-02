# Claude X

A desktop GUI for the **Claude Code CLI** — manage projects, chat with Claude, run an embedded terminal, browse files, and orchestrate skills/agents/plugins per project. Built with **Tauri (Rust) + React + TypeScript**, powered by the **Claude Agent SDK**.

> Uses your existing **Claude Code** login (Claude Max / Pro subscription or API key). No extra account needed.

---

## ✨ Features

- **Rich chat** — streaming responses, markdown rendering, live tool cards, multi-window chat (each its own session)
- **Per-tool permission popups** + **YOLO mode** (auto-approve) — powered by the Agent SDK `canUseTool`
- **Embedded terminal** — real PTY running the `claude` CLI (xterm.js)
- **Folder browser** — open files in tabs; `.md` files get a rendered viewer/editor
- **CONTRACT.md** — define directives & agreements per project; a **Lead Orchestrator** keeps every session aligned with `CONTRACT.md`, `CLAUDE.md`, and `MEMORY.md`
- **Library** — skills, agents, and plugins; install from marketplace or GitHub
- **Model switcher**, **theme** (dark / light / system), **voice input** (Bahasa Indonesia)
- **Session persistence** — sessions survive navigating back to the Hub

---

## ⬇️ Download

Download the latest `.dmg` from the **[Releases page](https://github.com/aikamz101010-alt/myClaude/releases/latest)**.

- **`Claude X_x.y.z_x64.dmg`** — macOS (Intel native; runs on Apple Silicon via Rosetta 2)

### Install

1. Open the `.dmg` and drag **Claude X** into **Applications**.
2. First launch (the app is **not code-signed**), macOS Gatekeeper will block it. Do one of:
   - **Right-click** `Claude X` → **Open** → click **Open** in the dialog, or
   - **System Settings → Privacy & Security →** scroll down → **Open Anyway**, or
   - Terminal: `xattr -cr "/Applications/Claude X.app"`

   After opening once this way, future launches work normally.

### Prerequisites (on the machine running the app)

- **Claude Code CLI** installed and logged in — `npm install -g @anthropic-ai/claude-code` then run `claude` once to authenticate
- **Node.js** ≥ 18 (the chat uses a Node sidecar with the Agent SDK)

---

## 🛠️ Build from source

```bash
# Prerequisites: Node.js, Rust toolchain, Tauri deps
npm install
npm run tauri dev      # run in development
npm run tauri build    # build .app + .dmg → src-tauri/target/release/bundle/
```

The build bundles the Agent SDK sidecar into `Claude X.app/Contents/Resources/sidecar/`.

### Universal binary (native Intel + Apple Silicon)

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

---

## Tech

- **Frontend:** React 18, TypeScript, Vite, Tailwind, Zustand, xterm.js
- **Backend:** Tauri 2 (Rust), portable-pty
- **AI:** `@anthropic-ai/claude-agent-sdk` (Node sidecar) + Claude Code CLI
