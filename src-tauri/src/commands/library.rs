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
