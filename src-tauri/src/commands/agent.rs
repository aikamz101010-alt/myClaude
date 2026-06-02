use crate::process::ProcessManager;
use crate::state::AppState;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn spawn_agent(
    app: AppHandle,
    pm: State<'_, Arc<ProcessManager>>,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    working_dir: String,
) -> Result<(), String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or_else(|| "Claude CLI not found on this system".to_string())?;
    pm.spawn(app, project_id, binary, working_dir)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_to_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
    message: String,
) -> Result<(), String> {
    pm.send_input(&project_id, &message)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
) -> Result<(), String> {
    pm.kill(&project_id);
    Ok(())
}
