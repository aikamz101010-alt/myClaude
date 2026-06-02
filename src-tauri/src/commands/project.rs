use crate::state::{AppState, Project};
use dirs::home_dir;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

fn projects_file() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join(".claude").join("desktop-projects.json"))
}

pub fn load_projects_from_disk() -> Vec<Project> {
    let Some(path) = projects_file() else { return vec![] };
    let Ok(content) = std::fs::read_to_string(&path) else { return vec![] };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_projects_to_disk(projects: &[Project]) {
    let Some(path) = projects_file() else { return };
    if let Ok(json) = serde_json::to_string_pretty(projects) {
        let _ = std::fs::write(path, json);
    }
}

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
    // Validate folder exists
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Folder does not exist: {}", path));
    }

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

    {
        let mut projects = state.projects.write();
        projects.push(project.clone());
        save_projects_to_disk(&projects);
    }

    Ok(project)
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let mut projects = state.projects.write();
    projects.retain(|p| p.id != id);
    save_projects_to_disk(&projects);
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
