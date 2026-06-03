//! App settings persisted to `~/.claude/desktop-settings.json`.
//! Currently: the Node.js binary used to run the Agent SDK sidecar.

use crate::sidecar_manager::SidecarManager;
use dirs::home_dir;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

fn settings_file() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join(".claude").join("desktop-settings.json"))
}

#[derive(Serialize, Deserialize, Default)]
struct DesktopSettings {
    /// User-selected Node path. None = auto-detect.
    #[serde(default)]
    node_path: Option<String>,
}

fn load_settings() -> DesktopSettings {
    settings_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_settings(s: &DesktopSettings) -> Result<(), String> {
    let path = settings_file().ok_or("No home directory")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Persisted Node override (used at startup to pre-configure the sidecar).
pub fn load_node_override() -> Option<String> {
    load_settings().node_path
}

#[derive(Serialize)]
pub struct NodeInfo {
    path: String,
    version: String, // "v20.12.2" or "unknown"
    major: u32,
    recommended: bool, // meets SDK minimum (>= 18)
}

/// Auto-detect every available Node binary and report its version.
#[tauri::command]
pub async fn list_node_versions() -> Result<Vec<NodeInfo>, String> {
    let mut out = Vec::new();
    for path in crate::platform::node_candidates() {
        let (version, major) = match crate::platform::node_version(&path) {
            Some((maj, min)) => (format!("v{}.{}", maj, min), maj),
            None => ("unknown".to_string(), 0),
        };
        out.push(NodeInfo {
            path,
            version,
            major,
            recommended: major >= 18,
        });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct NodeSetting {
    /// User override path, or null when set to Auto.
    selected: Option<String>,
    /// Path actually configured for the sidecar.
    resolved: Option<String>,
    /// Version of the resolved Node, e.g. "v20.12.2".
    version: Option<String>,
}

fn build_setting(sidecar: &SidecarManager, selected: Option<String>) -> NodeSetting {
    let resolved = sidecar.current_node_path();
    let version = resolved
        .as_deref()
        .and_then(crate::platform::node_version)
        .map(|(maj, min)| format!("v{}.{}", maj, min));
    NodeSetting {
        selected,
        resolved,
        version,
    }
}

/// Current Node setting (override + what's actually in use).
#[tauri::command]
pub async fn get_node_setting(
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<NodeSetting, String> {
    let selected = load_node_override();
    Ok(build_setting(&sidecar, selected))
}

/// Set the Node binary for the sidecar. `path = None` → Auto (re-detect newest).
/// Persists the choice and respawns the sidecar with the new Node.
#[tauri::command]
pub async fn set_node_path(
    sidecar: State<'_, Arc<SidecarManager>>,
    path: Option<String>,
) -> Result<NodeSetting, String> {
    let mut s = load_settings();
    s.node_path = path.clone();
    save_settings(&s)?;

    let resolved = match &path {
        Some(p) => Some(p.clone()),
        None => crate::sidecar_manager::detect_node_binary(),
    };
    sidecar.set_node_path(resolved);

    Ok(build_setting(&sidecar, path))
}
