use crate::state::{AppState, Project};
use dirs::home_dir;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn projects_file() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join(".claude").join("desktop-projects.json"))
}

pub fn load_projects_from_disk() -> Vec<Project> {
    let Some(path) = projects_file() else { return vec![] };
    let Ok(content) = std::fs::read_to_string(&path) else { return vec![] };
    let mut projects: Vec<Project> = serde_json::from_str(&content).unwrap_or_default();
    // Sort: most recently opened first, then by created_at desc
    projects.sort_by(|a, b| {
        b.last_opened.cmp(&a.last_opened)
            .then(b.created_at.cmp(&a.created_at))
    });
    projects
}

fn save_projects_to_disk(projects: &[Project]) {
    let Some(path) = projects_file() else { return };
    let Ok(json) = serde_json::to_string_pretty(projects) else { return };
    // Atomic write: write to .tmp then rename
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

#[tauri::command]
pub async fn get_projects(state: State<'_, Arc<AppState>>) -> Result<Vec<Project>, String> {
    let mut projects = state.projects.read().clone();
    // Always return sorted: last opened first
    projects.sort_by(|a, b| {
        b.last_opened.cmp(&a.last_opened)
            .then(b.created_at.cmp(&a.created_at))
    });
    Ok(projects)
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, Arc<AppState>>,
    name: String,
    path: String,
) -> Result<Project, String> {
    if !std::path::Path::new(&path).exists() {
        return Err(format!("Folder tidak ditemukan: {}", path));
    }

    let contract_path = format!("{}/CONTRACT.md", path);
    if !std::path::Path::new(&contract_path).exists() {
        let content = format!(
            "---\nproject: {}\nversion: 1.0\n---\n\n# Allowed Skills\n\n# Active Agents\n\n# MCP Plugins\n\n# Custom Rules\n",
            name
        );
        std::fs::write(&contract_path, &content).map_err(|e| e.to_string())?;
    }

    let now = now_secs();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name,
        path,
        contract_path,
        created_at: now,
        last_opened: now, // new projects count as opened
    };

    {
        let mut projects = state.projects.write();
        projects.push(project.clone());
        save_projects_to_disk(&projects);
    }
    Ok(project)
}

/// Called when user opens a project — updates last_opened timestamp.
#[tauri::command]
pub async fn touch_project(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<Project, String> {
    let now = now_secs();
    let mut projects = state.projects.write();
    let project = projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project not found: {}", id))?;
    project.last_opened = now;
    let updated = project.clone();
    save_projects_to_disk(&projects);
    Ok(updated)
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
