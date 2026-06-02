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

### Install on another Mac — step by step

**1. Install prerequisites** (the app drives the Claude Code CLI, so these must exist on the machine):

```bash
# Node.js ≥ 18 must be installed first (https://nodejs.org)
npm install -g @anthropic-ai/claude-code   # install Claude Code CLI
claude                                       # run once and log in (Claude Max/Pro or API key)
```

**2. Install the app:** open the `.dmg` → drag **Claude X** into **Applications**.

**3. First launch — bypass Gatekeeper** (the app is not notarized, so macOS blocks it once). Pick any one:
- **Right-click** `Claude X` in Applications → **Open** → click **Open** in the dialog ✅ (easiest), or
- **System Settings → Privacy & Security** → scroll down → **Open Anyway**, or
- Terminal: `xattr -cr "/Applications/Claude X.app"`

After opening once this way, double-click works normally afterward.

**4. Apple Silicon (M1/M2/M3…):** this build is Intel (x64). On first launch macOS will offer to install **Rosetta 2** — click **Install**, then the app runs. (A native universal build can be produced from source — see below.)

> **Fully frictionless install for everyone** (no Gatekeeper step) requires **Apple code signing + notarization** (Apple Developer account, $99/yr). Without it, the one-time right-click → Open is expected for unsigned apps.

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
