use crate::pty_manager::PtyManager;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn start_pty(
    app: AppHandle,
    pty: State<'_, Arc<PtyManager>>,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or("Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code")?;

    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();

    pty.start(app, project_id, binary, working_dir, shell_env, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_pty(
    pty: State<'_, Arc<PtyManager>>,
    project_id: String,
    data: String,
) -> Result<(), String> {
    pty.write(&project_id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_pty(
    pty: State<'_, Arc<PtyManager>>,
    project_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(&project_id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_pty(
    pty: State<'_, Arc<PtyManager>>,
    project_id: String,
) -> Result<(), String> {
    pty.stop(&project_id);
    Ok(())
}

#[tauri::command]
pub async fn is_pty_running(
    pty: State<'_, Arc<PtyManager>>,
    project_id: String,
) -> Result<bool, String> {
    Ok(pty.is_running(&project_id))
}
