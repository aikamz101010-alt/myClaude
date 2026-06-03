use crate::process::ProcessManager;
use crate::sidecar_manager::SidecarManager;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, Write};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Result returned by chat_message.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResult {
    pub content: String,
    pub session_id: Option<String>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

/// One-shot chat via `claude --print --output-format json`.
///
/// Auth strategy: the interactive terminal uses whatever auth the user has
/// (often ClaudeMax OAuth). To match it, we try OAuth FIRST (without injecting
/// ANTHROPIC_API_KEY), and only fall back to the API key if that fails with an
/// auth error. This fixes the "external API key" 401 for OAuth/ClaudeMax users
/// while still supporting API-key-only setups.
#[tauri::command]
pub async fn chat_message(
    state: State<'_, Arc<AppState>>,
    message: String,
    working_dir: String,
    session_id: Option<String>,
) -> Result<ChatResult, String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or("Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code")?;

    let work_dir = if std::path::Path::new(&working_dir).exists() {
        working_dir.clone()
    } else {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or(working_dir)
    };

    let shell_env: Vec<(String, String)> =
        state.shell_env.read().clone().into_iter().collect();

    // Attempt 1: OAuth (drop ANTHROPIC_API_KEY) — matches interactive terminal
    let res = run_chat(&binary, &work_dir, &message, &session_id, &shell_env, false);
    match res {
        Ok(r) => Ok(r),
        Err(e) if is_auth_error(&e) => {
            // Attempt 2: with ANTHROPIC_API_KEY injected
            run_chat(&binary, &work_dir, &message, &session_id, &shell_env, true)
        }
        Err(e) => Err(e),
    }
}

fn is_auth_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("api key")
        || m.contains("authentication")
        || m.contains("unauthorized")
        || m.contains("401")
        || m.contains("login")
}

fn run_chat(
    binary: &str,
    work_dir: &str,
    message: &str,
    session_id: &Option<String>,
    shell_env: &[(String, String)],
    use_api_key: bool,
) -> Result<ChatResult, String> {
    let mut cmd = std::process::Command::new(binary);
    cmd.arg("--print")
        .arg("--output-format").arg("json")
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(id) = session_id {
        cmd.arg("--resume").arg(id);
    }

    // Inherit shell env, optionally dropping ANTHROPIC_API_KEY to force OAuth
    for (k, v) in shell_env {
        if !use_api_key && k == "ANTHROPIC_API_KEY" {
            continue;
        }
        cmd.env(k, v);
    }
    if !use_api_key {
        cmd.env_remove("ANTHROPIC_API_KEY");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Claude CLI: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        writeln!(stdin, "{}", message)
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Claude CLI: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // Parse JSON response
    if let Ok(json) = serde_json::from_str::<Value>(stdout.trim()) {
        let is_error = json["is_error"].as_bool().unwrap_or(false);
        let content = json["result"].as_str().unwrap_or("").to_string();
        let api_status = json["api_error_status"].as_u64();

        if is_error {
            // Surface the result text (e.g. "Invalid API key · Fix external API key")
            let err = if !content.is_empty() {
                content
            } else if let Some(status) = api_status {
                format!("API error {}", status)
            } else if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                "Unknown error".to_string()
            };
            return Err(err);
        }

        return Ok(ChatResult {
            content,
            session_id: json["session_id"].as_str().map(String::from),
            cost_usd: json["total_cost_usd"].as_f64(),
            input_tokens: json["usage"]["input_tokens"].as_u64(),
            output_tokens: json["usage"]["output_tokens"].as_u64(),
        });
    }

    if !output.status.success() {
        return Err(if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            format!("Claude CLI exited with status {:?}", output.status.code())
        });
    }

    // Fallback: raw stdout
    Ok(ChatResult {
        content: stdout.trim().to_string(),
        session_id: None,
        cost_usd: None,
        input_tokens: None,
        output_tokens: None,
    })
}

// ── Streaming chat (rich, live) ───────────────────────────────────

/// A single streamed chat event sent to the frontend.
/// (Legacy — kept for reference after Agent SDK migration.)
#[allow(dead_code)]
#[derive(Debug, Serialize, Clone)]
pub struct ChatStreamEvent {
    pub kind: String,                 // "text" | "tool_use" | "tool_result" | "done" | "error"
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<String>,
    pub session_id: Option<String>,
    pub cost_usd: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[allow(dead_code)]
impl ChatStreamEvent {
    fn empty(kind: &str) -> Self {
        ChatStreamEvent {
            kind: kind.into(), text: None, tool_name: None, tool_input: None,
            session_id: None, cost_usd: None, input_tokens: None, output_tokens: None,
        }
    }
}

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

    let _ = &state; // shell_env configured at startup

    // Lead-orchestrator directive (from CONTRACT.md) — injected EVERY turn so the
    // orchestrator role persists across the whole session, including resumes.
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
    let claude    = read("CLAUDE.md", 6000);
    let memory   = read("MEMORY.md", 4000);

    // Activate the orchestrator only when at least one guidance file exists.
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

/// (Legacy) message-preamble builder — superseded by build_orchestrator_directive.
#[allow(dead_code)]
fn build_context_preamble(work_dir: &str) -> String {
    let mut parts: Vec<String> = vec![];
    let files = [
        ("CONTRACT.md", "Project Contract (allowed skills, agents, rules)"),
        ("MEMORY.md", "Project Memory"),
    ];
    for (fname, label) in &files {
        let path = std::path::Path::new(work_dir).join(fname);
        if let Ok(content) = std::fs::read_to_string(&path) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                // Cap each file to ~4000 chars to avoid oversized prompts
                let capped: String = trimmed.chars().take(4000).collect();
                parts.push(format!("## {} ({})\n{}", label, fname, capped));
            }
        }
    }
    if parts.is_empty() {
        return String::new();
    }
    format!(
        "<project-context>\nThe following project files provide important context. Follow them.\n\n{}\n</project-context>",
        parts.join("\n\n")
    )
}

/// Run one streaming attempt. (Legacy CLI streaming — kept for rollback.)
#[allow(dead_code)]
fn stream_once(
    app: &tauri::AppHandle,
    project_id: &str,
    binary: &str,
    work_dir: &str,
    message: &str,
    session_id: &Option<String>,
    shell_env: &[(String, String)],
    model: &Option<String>,
    permission_mode: &Option<String>,
    use_api_key: bool,
) -> Result<(), bool> {
    let event_name = format!("chat:event:{}", project_id);

    let mut cmd = std::process::Command::new(binary);
    cmd.arg("--print")
        .arg("--output-format").arg("stream-json")
        .arg("--verbose")
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(m) = model {
        if !m.is_empty() {
            cmd.arg("--model").arg(m);
        }
    }

    if let Some(pm) = permission_mode {
        if !pm.is_empty() && pm != "default" {
            cmd.arg("--permission-mode").arg(pm);
        }
    }

    if let Some(id) = session_id {
        cmd.arg("--resume").arg(id);
    }

    for (k, v) in shell_env {
        if !use_api_key && k == "ANTHROPIC_API_KEY" { continue; }
        cmd.env(k, v);
    }
    if !use_api_key {
        cmd.env_remove("ANTHROPIC_API_KEY");
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let mut ev = ChatStreamEvent::empty("error");
            ev.text = Some(format!("Failed to start Claude CLI: {}", e));
            let _ = app.emit(&event_name, ev);
            return Ok(());
        }
    };

    // Write message → stdin → EOF
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{}", message);
    }

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return Ok(()),
    };

    let mut content_emitted = false;
    let mut auth_error = false;
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() { continue; }
        let Ok(json) = serde_json::from_str::<Value>(line) else { continue };

        match json["type"].as_str() {
            Some("assistant") => {
                if let Some(content) = json["message"]["content"].as_array() {
                    for block in content {
                        match block["type"].as_str() {
                            Some("text") => {
                                if let Some(t) = block["text"].as_str() {
                                    if !t.trim().is_empty() {
                                        let mut ev = ChatStreamEvent::empty("text");
                                        ev.text = Some(t.to_string());
                                        let _ = app.emit(&event_name, ev);
                                        content_emitted = true;
                                    }
                                }
                            }
                            Some("tool_use") => {
                                let mut ev = ChatStreamEvent::empty("tool_use");
                                ev.tool_name = block["name"].as_str().map(String::from);
                                ev.tool_input = Some(summarise_input(&block["input"]));
                                let _ = app.emit(&event_name, ev);
                                content_emitted = true;
                            }
                            _ => {}
                        }
                    }
                }
            }
            Some("user") => {
                // tool_result blocks
                if let Some(content) = json["message"]["content"].as_array() {
                    for block in content {
                        if block["type"].as_str() == Some("tool_result") {
                            let mut ev = ChatStreamEvent::empty("tool_result");
                            ev.text = Some(extract_tool_result(&block["content"]));
                            let _ = app.emit(&event_name, ev);
                        }
                    }
                }
            }
            Some("result") => {
                let is_error = json["is_error"].as_bool().unwrap_or(false);
                let api_status = json["api_error_status"].as_u64();
                if is_error {
                    let result_text = json["result"].as_str().unwrap_or("").to_string();
                    let is_auth = result_text.to_lowercase().contains("api key")
                        || result_text.to_lowercase().contains("login")
                        || matches!(api_status, Some(401) | Some(403));
                    if is_auth && !content_emitted && !use_api_key {
                        auth_error = true; // caller retries with key
                    } else {
                        let mut ev = ChatStreamEvent::empty("error");
                        ev.text = Some(if result_text.is_empty() {
                            "Claude returned an error".into()
                        } else { result_text });
                        let _ = app.emit(&event_name, ev);
                    }
                } else {
                    let mut ev = ChatStreamEvent::empty("done");
                    ev.session_id = json["session_id"].as_str().map(String::from);
                    ev.cost_usd = json["total_cost_usd"].as_f64();
                    ev.input_tokens = json["usage"]["input_tokens"].as_u64();
                    ev.output_tokens = json["usage"]["output_tokens"].as_u64();
                    let _ = app.emit(&event_name, ev);
                }
            }
            _ => {}
        }
    }

    let _ = child.wait();

    if auth_error {
        return Err(true); // signal retry
    }
    Ok(())
}

#[allow(dead_code)]
fn summarise_input(input: &Value) -> String {
    // Identifier fields first (so skill/agent names are captured for panel matching):
    //  - Skill tool → input.name / input.command
    //  - Task tool  → input.subagent_type
    // Then descriptive fields.
    for field in &["name", "subagent_type", "command", "file_path", "path", "query", "pattern", "description"] {
        if let Some(v) = input[field].as_str() {
            let s: String = v.chars().take(120).collect();
            return if v.chars().count() > 120 { format!("{}…", s) } else { s };
        }
    }
    let s = serde_json::to_string(input).unwrap_or_default();
    let short: String = s.chars().take(120).collect();
    if s.chars().count() > 120 { format!("{}…", short) } else { short }
}

#[allow(dead_code)]
fn extract_tool_result(content: &Value) -> String {
    let text = if let Some(s) = content.as_str() {
        s.to_string()
    } else if let Some(arr) = content.as_array() {
        arr.iter()
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };
    // Cap result preview
    let lines: Vec<&str> = text.lines().take(12).collect();
    let mut out = lines.join("\n");
    if text.lines().count() > 12 {
        out.push_str("\n…");
    }
    out.chars().take(2000).collect()
}

/// Spawn persistent Claude CLI session (PTY — for terminal view).
#[tauri::command]
pub async fn spawn_agent(
    app: tauri::AppHandle,
    pm: State<'_, Arc<ProcessManager>>,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    working_dir: String,
) -> Result<(), String> {
    let binary = state.claude_binary.read().clone().ok_or("Claude CLI not found")?;
    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();
    pm.spawn_with_env(app, project_id, binary, working_dir, shell_env)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_to_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
    message: String,
) -> Result<(), String> {
    pm.send_input(&project_id, &message).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
) -> Result<(), String> {
    pm.kill(&project_id);
    Ok(())
}
