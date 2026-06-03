#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth_manager;
mod commands;
mod platform;
mod pty_manager;
mod scanner;
mod sidecar_manager;
mod state;

use commands::{
    agent::{interrupt_chat, respond_permission, send_chat_stream},
    session::{get_session_history, list_project_sessions},
    library::{
        add_marketplace, auth_login, auth_logout, auth_status_json, auth_submit_code,
        create_agent, ensure_lead_orchestrator, get_auth_status, get_claude_binary,
        get_library, init_skill, install_github_skill, install_plugin,
        list_github_skills, rescan_library, set_api_key,
    },
    project::{create_project, delete_project, get_projects, list_directory, read_contract, read_file, touch_project, write_contract, write_file},
    terminal::{is_pty_running, resize_pty, start_pty, stop_pty, write_pty},
};
use auth_manager::AuthManager;
use pty_manager::PtyManager;
use sidecar_manager::SidecarManager;
use state::AppState;
use std::collections::HashMap;

/// Capture env vars needed by Claude CLI.
/// Strategy (in order):
/// 1. Current process env (works when launched from terminal)
/// 2. Try bash -l then zsh -l (covers most shell setups)
/// 3. Parse profile files directly (fallback for ANTHROPIC_API_KEY)
fn capture_shell_env() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = HashMap::new();

    // Step 1: Current process env — fastest, works when launched from terminal
    for (k, v) in std::env::vars() {
        if is_relevant_key(&k) {
            env.insert(k, v);
        }
    }

    // Steps 2 & 3 are unix-specific (login shells + dotfiles). On Windows the user
    // environment is already inherited in step 1, so we skip them there.
    #[cfg(unix)]
    {
    // Step 2: Source login shells to pick up profile vars
    for shell in &["/bin/bash", "/bin/zsh"] {
        if let Ok(o) = std::process::Command::new(shell)
            .args(["-l", "-c", "env"])
            .output()
        {
            if o.status.success() {
                for line in String::from_utf8_lossy(&o.stdout).lines() {
                    let mut parts = line.splitn(2, '=');
                    if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                        if is_relevant_key(k) {
                            env.entry(k.to_string()).or_insert_with(|| v.to_string());
                        }
                    }
                }
            }
        }
    }

    // Step 3: Parse profile files directly for export KEY="VALUE" lines
    // Covers cases where shell sourcing fails (permission, nvm init errors, etc.)
    if let Some(home) = dirs::home_dir() {
        let profiles = [
            ".bash_profile", ".bashrc", ".zshrc", ".zprofile",
            ".profile", ".bash_login",
        ];
        for profile in &profiles {
            let path = home.join(profile);
            if let Ok(content) = std::fs::read_to_string(&path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    // Match: export KEY=VALUE or export KEY="VALUE"
                    if let Some(rest) = trimmed.strip_prefix("export ") {
                        let rest = rest.trim();
                        let mut parts = rest.splitn(2, '=');
                        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                            let k = k.trim().to_string();
                            let v = v.trim().trim_matches('"').trim_matches('\'').to_string();
                            if is_relevant_key(&k) && !v.is_empty() {
                                // Profile file wins for ANTHROPIC keys (most explicit)
                                if k.starts_with("ANTHROPIC") {
                                    env.insert(k, v);
                                } else {
                                    env.entry(k).or_insert(v);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    } // end #[cfg(unix)]

    env
}

fn is_relevant_key(k: &str) -> bool {
    k.starts_with("ANTHROPIC")
        || k.starts_with("CLAUDE")
        || k == "PATH"
        || k == "HOME"
        || k == "USER"
        || k == "SHELL"
        || k == "TERM"
        || k == "LANG"
        || k == "LC_ALL"
        || k == "NVM_DIR"
        || k == "NVM_BIN"
        || k == "NODE_PATH"
}

fn main() {
    let app_state = AppState::new();
    let pty_manager = PtyManager::new();
    let auth_manager = AuthManager::new();
    let sidecar_manager = SidecarManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state.clone())
        .manage(pty_manager)
        .manage(auth_manager)
        .manage(sidecar_manager.clone())
        .setup(move |_app| {
            // Capture shell env (ANTHROPIC_API_KEY etc.)
            let shell_env = capture_shell_env();
            *app_state.shell_env.write() = shell_env.clone();

            // Load persisted projects
            let saved = commands::project::load_projects_from_disk();
            *app_state.projects.write() = saved;

            // Detect Claude CLI binary
            let binary = scanner::detect_claude_binary();
            *app_state.claude_binary.write() = binary.clone();

            // Configure Agent SDK sidecar (Node + script + claude path + env)
            let node = sidecar_manager::detect_node_binary();
            let script = sidecar_manager::detect_sidecar_script();
            let env_vec: Vec<(String, String)> = shell_env.into_iter().collect();
            sidecar_manager.configure(node, script, binary, env_vec);

            // Scan library in background
            let state_clone = app_state.clone();
            tauri::async_runtime::spawn(async move {
                scanner::scan_library(state_clone).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Projects
            get_projects,
            create_project,
            delete_project,
            touch_project,
            read_contract,
            write_contract,
            list_directory,
            read_file,
            write_file,
            // Library
            get_library,
            rescan_library,
            get_claude_binary,
            get_auth_status,
            set_api_key,
            auth_status_json,
            auth_login,
            auth_submit_code,
            auth_logout,
            // Plugin / skill / agent management
            install_plugin,
            add_marketplace,
            init_skill,
            create_agent,
            ensure_lead_orchestrator,
            // GitHub skill install
            list_github_skills,
            install_github_skill,
            // Session history
            get_session_history,
            list_project_sessions,
            // Chat via Agent SDK sidecar
            send_chat_stream,
            respond_permission,
            interrupt_chat,
            // PTY terminal (real embedded claude CLI)
            start_pty,
            write_pty,
            resize_pty,
            stop_pty,
            is_pty_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
