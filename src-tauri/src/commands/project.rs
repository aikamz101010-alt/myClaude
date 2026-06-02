use crate::state::{AppState, Project};
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    Ok(state.projects.read().clone())
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    path: String,
) -> Result<Project, String> {
    let contract_path = format!("{}/CONTRACT.md", path);

    if !std::path::Path::new(&contract_path).exists() {
        let content = format!(
            "---\nproject: {}\nversion: 1.0\n---\n\n# Allowed Skills\n\n# Active Agents\n\n# MCP Plugins\n\n# Custom Rules\n",
            name
        );
        std::fs::write(&contract_path, &content).map_err(|e| e.to_string())?;
    }

    let project = Project {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        contract_path,
    };
    state.projects.write().push(project.clone());
    Ok(project)
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    state.projects.write().retain(|p| p.id != id);
    Ok(())
}

#[tauri::command]
pub async fn read_contract(contract_path: String) -> Result<String, String> {
    std::fs::read_to_string(&contract_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_contract(contract_path: String, content: String) -> Result<(), String> {
    std::fs::write(&contract_path, content).map_err(|e| e.to_string())
}
