#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process;
mod pty_manager;
mod scanner;
mod state;

use commands::{
    agent::{chat_message, send_to_agent, spawn_agent, stop_agent},
    library::{get_claude_binary, get_library, rescan_library},
    project::{create_project, delete_project, get_projects, read_contract, touch_project, write_contract},
    terminal::{is_pty_running, resize_pty, start_pty, stop_pty, write_pty},
};
use process::ProcessManager;
use pty_manager::PtyManager;
use state::AppState;
use std::collections::HashMap;

/// Source the user's shell profile to capture env vars like ANTHROPIC_API_KEY.
/// Needed when app is launched from Finder/Spotlight (no shell environment).
fn capture_shell_env() -> HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-l", "-c", "env"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|line| {
                    let mut parts = line.splitn(2, '=');
                    let key = parts.next()?.to_string();
                    let val = parts.next()?.to_string();
                    if key.starts_with("ANTHROPIC")
                        || key.starts_with("CLAUDE")
                        || key == "PATH"
                        || key == "HOME"
                        || key == "USER"
                        || key == "TERM"
                        || key == "NVM_DIR"
                        || key == "NVM_BIN"
                        || key == "NODE_PATH"
                        || key == "LANG"
                        || key == "LC_ALL"
                    {
                        Some((key, val))
                    } else {
                        None
                    }
                })
                .collect()
        }
        _ => std::env::vars()
            .filter(|(k, _)| k.starts_with("ANTHROPIC") || k.starts_with("CLAUDE") || k == "PATH" || k == "HOME")
            .collect(),
    }
}

fn main() {
    let app_state = AppState::new();
    let process_manager = ProcessManager::new();
    let pty_manager = PtyManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state.clone())
        .manage(process_manager)
        .manage(pty_manager)
        .setup(move |_app| {
            // Capture shell env (ANTHROPIC_API_KEY etc.)
            let shell_env = capture_shell_env();
            *app_state.shell_env.write() = shell_env;

            // Load persisted projects
            let saved = commands::project::load_projects_from_disk();
            *app_state.projects.write() = saved;

            // Detect Claude CLI binary
            let binary = scanner::detect_claude_binary();
            *app_state.claude_binary.write() = binary;

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
            // Library
            get_library,
            rescan_library,
            get_claude_binary,
            // Chat (claude --print)
            chat_message,
            // Persistent agent session
            spawn_agent,
            send_to_agent,
            stop_agent,
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
