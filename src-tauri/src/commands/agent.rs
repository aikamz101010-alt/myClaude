use crate::sidecar_manager::SidecarManager;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// Streaming chat via the Claude Agent SDK sidecar.
/// Emits `chat:event:{project_id}` Tauri events (text, tool_use, tool_result,
/// agent_start/stop, permission_request, done, error).
#[tauri::command]
pub async fn send_chat_stream(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    sidecar: State<'_, Arc<SidecarManager>>,
    project_id: String,        // used as the chatId / event-channel key
    message: String,
    working_dir: String,
    session_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
) -> Result<(), String> {
    let work_dir = if std::path::Path::new(&working_dir).exists() {
        working_dir.clone()
    } else {
        dirs::home_dir().map(|h| h.to_string_lossy().to_string()).unwrap_or(working_dir)
    };

    let _ = &state; // shell_env configured in the sidecar manager at startup

    // Lead-orchestrator directive (from CONTRACT.md/CLAUDE.md/MEMORY.md) — injected
    // EVERY turn so the orchestrator role persists across the whole session.
    let system_append = build_orchestrator_directive(&work_dir);

    sidecar.send_prompt(&app, &project_id, &message, &work_dir, model, permission_mode, session_id, system_append)
}

/// Build the lead-orchestrator system-prompt directive from CONTRACT.md, CLAUDE.md
/// and MEMORY.md (whichever exist). Returns None if none exist — then chat behaves
/// like plain Claude Code.
fn build_orchestrator_directive(work_dir: &str) -> Option<String> {
    let read = |name: &str, cap: usize| -> Option<String> {
        let p = std::path::Path::new(work_dir).join(name);
        let c = std::fs::read_to_string(&p).ok()?;
        let c = c.trim();
        if c.is_empty() { None } else { Some(c.chars().take(cap).collect()) }
    };

    let contract = read("CONTRACT.md", 8000);
    let claude   = read("CLAUDE.md", 6000);
    let memory   = read("MEMORY.md", 4000);

    if contract.is_none() && claude.is_none() && memory.is_none() {
        return None;
    }

    let mut out = String::new();
    out.push_str(
        "You are the LEAD ORCHESTRATOR for this project. Before doing anything, internalize the \
project guidance below (CONTRACT.md = directives & agreements, CLAUDE.md = project instructions, \
MEMORY.md = project memory) and treat it as the source of truth for this WHOLE session:\n\
- Keep the main agent and ALL work aligned with this guidance at every step.\n\
- When delegating to subagents or invoking plugins/skills, pass along these directives so they \
act consistently with the contract.\n\
- Honor the allowed Skills, Agents, and MCP Plugins; prefer them when relevant.\n\
- Obey the Custom Rules / Arahan.\n\
- If a Documents section lists files (e.g. PRD.md, TRD.md), keep them created and updated whenever \
features or logic change.\n\
- If a request conflicts with the guidance, flag it and propose a compliant approach.\n",
    );

    if let Some(c) = contract {
        out.push_str("\n=== CONTRACT.md (directives & agreements) ===\n");
        out.push_str(&c); out.push('\n');
    }
    if let Some(c) = claude {
        out.push_str("\n=== CLAUDE.md (project instructions) ===\n");
        out.push_str(&c); out.push('\n');
    }
    if let Some(m) = memory {
        out.push_str("\n=== MEMORY.md (project memory) ===\n");
        out.push_str(&m); out.push('\n');
    }

    Some(out)
}

/// Respond to a tool permission request from the sidecar.
#[tauri::command]
pub async fn respond_permission(
    app: AppHandle,
    sidecar: State<'_, Arc<SidecarManager>>,
    chat_id: String,
    request_id: String,
    allow: bool,
    message: Option<String>,
) -> Result<(), String> {
    sidecar.respond_permission(&app, &chat_id, &request_id, allow, message)
}

/// Interrupt an in-progress chat.
#[tauri::command]
pub async fn interrupt_chat(
    app: AppHandle,
    sidecar: State<'_, Arc<SidecarManager>>,
    chat_id: String,
) -> Result<(), String> {
    sidecar.interrupt(&app, &chat_id)
}
