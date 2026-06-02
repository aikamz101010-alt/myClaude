use crate::process::ProcessManager;
use crate::state::AppState;
use std::io::Write;
use std::process::Stdio;
use std::sync::Arc;
use tauri::State;

/// One-shot chat via `claude --print`.
/// Returns the full response text directly — no event streaming needed.
#[tauri::command]
pub async fn chat_message(
    state: State<'_, Arc<AppState>>,
    message: String,
    working_dir: String,
) -> Result<String, String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or("Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code")?;

    // Validate working dir
    let work_dir = if std::path::Path::new(&working_dir).exists() {
        working_dir.clone()
    } else {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or(working_dir)
    };

    let mut cmd = std::process::Command::new(&binary);
    cmd.arg("--print")
        .current_dir(&work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Pass shell env (ANTHROPIC_API_KEY etc.)
    let env = state.shell_env.read();
    for (k, v) in env.iter() {
        cmd.env(k, v);
    }
    drop(env);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Claude CLI: {}", e))?;

    // Write message to stdin then close (sends EOF to claude)
    if let Some(mut stdin) = child.stdin.take() {
        writeln!(stdin, "{}", message)
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;
        // stdin dropped here → EOF
    }

    // Wait for full response
    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for Claude CLI: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !stderr.is_empty() {
            return Err(format!("Claude CLI error: {}", stderr.trim()));
        }
    }

    let response = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(response)
}

/// Spawn persistent Claude CLI session (for terminal view — handled by pty_manager).
#[tauri::command]
pub async fn spawn_agent(
    app: tauri::AppHandle,
    pm: State<'_, Arc<ProcessManager>>,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    working_dir: String,
) -> Result<(), String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or("Claude CLI not found")?;
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
