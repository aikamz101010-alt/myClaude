use crate::scanner;
use crate::state::{AppState, SkillItem};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_library(state: State<'_, Arc<AppState>>) -> Result<Vec<SkillItem>, String> {
    Ok(state.library.read().clone())
}

#[tauri::command]
pub async fn rescan_library(state: State<'_, Arc<AppState>>) -> Result<Vec<SkillItem>, String> {
    scanner::scan_library(state.inner().clone()).await;
    Ok(state.library.read().clone())
}

#[tauri::command]
pub async fn get_claude_binary(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    Ok(state.claude_binary.read().clone())
}

/// Manually set ANTHROPIC_API_KEY at runtime (survives until app restart)
#[tauri::command]
pub async fn set_api_key(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<(), String> {
    state.shell_env.write().insert("ANTHROPIC_API_KEY".into(), key);
    Ok(())
}

/// Debug: check if ANTHROPIC_API_KEY is captured (returns masked value)
#[tauri::command]
pub async fn get_auth_status(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let env = state.shell_env.read();
    match env.get("ANTHROPIC_API_KEY") {
        Some(key) if !key.is_empty() => {
            let masked = format!("{}...{}", &key[..12], &key[key.len()-4..]);
            Ok(format!("✅ API key found: {}", masked))
        }
        _ => Ok("❌ ANTHROPIC_API_KEY not found in captured env".to_string()),
    }
}
