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
- **In-app login** — sign in via browser OAuth (Claude subscription / API billing) or API key, right from Settings
- **Auto-update** — Settings → *Check for updates* shows current vs available version and installs in place
- **Per-project usage** — cumulative ↑input / ↓output tokens + est. USD on each project card

---

## ⬇️ Download

Download the latest `.dmg` from the **[Releases page](https://github.com/aikamz101010-alt/myClaude/releases/latest)**.

- **`Claude_X_x.y.z_universal.dmg`** — macOS **universal** (native on both Intel & Apple Silicon)

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

**4. Apple Silicon (M1/M2/M3…):** the universal build runs **natively** — no Rosetta needed.

> **Fully frictionless install for everyone** (no Gatekeeper step) requires **Apple code signing + notarization** (Apple Developer account, $99/yr). Without it, the one-time right-click → Open is expected for unsigned apps.

### Sign in

On first run, open **Settings (⚙️)** → **Authentication**:
- **Browser login** (recommended) — *Claude subscription* (Claude Max/Pro) or *API billing*; opens Claude's login page in your browser.
- **API key** — paste `sk-ant-…` and save.

Login is one-time per machine; the app reuses your Claude Code credentials afterwards. Chat uses your **subscription (OAuth)** by default.

### Auto-update

Settings → **Check for updates** shows the current and available version, downloads, verifies the signature, and restarts in place. Updates are pulled from the GitHub Releases `latest.json`.

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

### Releasing a new version (with auto-update)

1. Bump `version` in `src-tauri/tauri.conf.json` (e.g. `0.2.0`).
2. Build signed (updater artifacts need the private key — kept at `~/.tauri/claudex-updater.key`, **never commit it**):
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/claudex-updater.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npm run tauri build -- --target universal-apple-darwin
   ```
   Produces in `…/universal-apple-darwin/release/bundle/`:
   - `dmg/Claude X_<v>_universal.dmg` (installer)
   - `macos/Claude X.app.tar.gz` + `.sig` (updater payload + signature)
3. Create a GitHub Release (tag `v<version>`) and upload **3 files** (rename to remove spaces):
   - `Claude_X_<v>_universal.dmg`
   - `Claude_X.app.tar.gz`
   - `latest.json` — manifest the app reads to detect updates:
     ```json
     {
       "version": "<v>",
       "notes": "…",
       "pub_date": "<RFC3339>",
       "platforms": {
         "darwin-aarch64": { "signature": "<contents of .sig>", "url": ".../releases/latest/download/Claude_X.app.tar.gz" },
         "darwin-x86_64":  { "signature": "<contents of .sig>", "url": ".../releases/latest/download/Claude_X.app.tar.gz" }
       }
     }
     ```
   The updater endpoint is configured as `releases/latest/download/latest.json` in `tauri.conf.json`.

The updater **public key** is embedded in `tauri.conf.json` (`plugins.updater.pubkey`); the **private key** signs each release.

---

## Tech

- **Frontend:** React 18, TypeScript, Vite, Tailwind, Zustand, xterm.js
- **Backend:** Tauri 2 (Rust), portable-pty
- **AI:** `@anthropic-ai/claude-agent-sdk` (Node sidecar) + Claude Code CLI
