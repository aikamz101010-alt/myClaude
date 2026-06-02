#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod process;
mod scanner;
mod state;

use commands::{
    agent::{send_to_agent, spawn_agent, stop_agent},
    library::{get_claude_binary, get_library, rescan_library},
    project::{create_project, delete_project, get_projects, read_contract, write_contract},
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
        .manage(app_state.clone())
        .manage(process_manager)
        .setup(move |_app| {
            // Detect Claude CLI binary on startup
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
            read_contract,
            write_contract,
            get_library,
            rescan_library,
            get_claude_binary,
            spawn_agent,
            send_to_agent,
            stop_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
