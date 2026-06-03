# Project Memory — Claude X

Progress & decisions log (newest first).

## Status (2026-06-03)

Working desktop app **Claude X** shipped as macOS `.dmg`. Repo: `github.com/aikamz101010-alt/myClaude` (branch `main`).

### Done
- **Chat** via Claude Agent SDK sidecar: streaming, markdown, live tool cards, multi-window sessions (persist across Hub navigation), session sync from terminal JSONL.
- **Permissions**: per-tool Allow/Deny/Always popups + YOLO (bypassPermissions). Uses ClaudeMax/OAuth **subscription** — user prefers subscription, NO API-key fallback for chat.
- **In-app login** (Settings): browser OAuth via PTY (`auth_manager`: `auth_login` streams URL, `auth_submit_code` pastes code) for Claude subscription / API billing, + API key field; rich status + logout.
- **Auto-update**: tauri-plugin-updater + process. Settings → Check for updates (current vs available + install). Endpoint `releases/latest/download/latest.json`; pubkey in tauri.conf.json; private key at `~/.tauri/claudex-updater.key` (NOT in git).
- **Universal build**: native Intel + Apple Silicon (`--target universal-apple-darwin`, verified `x86_64 arm64`).
- **App icon**: CX logo. Per-project usage (↑/↓ tokens + USD) on cards. Agent monitor from chat sessions. Running subagents shown via SDK hooks.
- **CONTRACT.md** = project directives & agreements. **Lead Orchestrator** (project/personal scope) auto-injected each session from CONTRACT/CLAUDE/MEMORY.md.
- **Contract editor**: click-to-add items (no drag), `@`-mention rules (contract items only), PRD/TRD toggles (auto-generate on Save), theme-aware colored tokens.
- **Right panel**: Active (in-contract + running subagents via SDK hooks) + List (all, searchable, collapsible) tabs; click-to-tag.
- **Folder tree** tab + **file editor** tabs (green); `.md` viewer/editor.
- **Hub**: project sort (added/activity/name), agent monitor from chat sessions, project cards show cumulative `↑input ↓output` tokens + est. USD (bottom-right).
- **Theme** dark/light/system (theme-aware tag colors). Library: install skills/plugins/agents from marketplace or GitHub.
- **Crash hardening**: permission input sent as string (fixed blank-screen), char-safe key masking, safe stdio.

### Build / distribution
- `npm run tauri build` → `src-tauri/target/release/bundle/dmg/`. Sidecar (agent.mjs + SDK) bundled into `.app/Contents/Resources/sidecar/`.
- Ad-hoc signed (`signingIdentity: "-"`). Unsigned → users do one-time Gatekeeper bypass (right-click Open / `xattr -cr`). Full frictionless = Apple notarization ($99/yr).
- Prereqs on target machine: Node ≥18 + Claude Code CLI logged in.

### Pending
- **Publish to GitHub Releases**: upload `release-artifacts/` (Claude_X_0.1.0_universal.dmg + Claude_X.app.tar.gz + latest.json) under tag `v0.1.0`. `gh` not logged in — do via web UI or `gh auth login`. Auto-update only works once these are on Releases.
- Next release: bump `version` in tauri.conf.json, rebuild signed, regenerate latest.json (see README "Releasing a new version").

### Conventions
- Keep `tsc --noEmit` + `cargo check` clean.
- UI event payloads must be strings (never raw objects → React crash).
