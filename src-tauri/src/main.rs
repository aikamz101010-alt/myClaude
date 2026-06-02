#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process;
mod scanner;
mod state;

use commands::{
    agent::{chat_message, send_to_agent, spawn_agent, stop_agent},
    library::{get_claude_binary, get_library, rescan_library},
    project::{create_project, delete_project, get_projects, read_contract, touch_project, write_contract},
};
use process::ProcessManager;
use state::AppState;

fn main() {
    let app_state = AppState::new();
    let process_manager = ProcessManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state.clone())
        .manage(process_manager)
        .setup(move |_app| {
            // Load persisted projects from disk
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
            get_projects,
            create_project,
            delete_project,
            touch_project,
            read_contract,
            write_contract,
            get_library,
            rescan_library,
            get_claude_binary,
            chat_message,
            spawn_agent,
            send_to_agent,
            stop_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
