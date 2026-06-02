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

/// Launch `claude` in login mode so user can authenticate via browser.
/// Claude Code CLI opens browser for OAuth when run interactively.
#[tauri::command]
pub async fn launch_claude_login(
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or("Claude CLI not found")?;

    // Try: claude --version to check if already authenticated
    let check = std::process::Command::new(&binary)
        .arg("--print")
        .env("ANTHROPIC_API_KEY", "")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    match check {
        Ok(mut child) => {
            use std::io::Write;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = writeln!(stdin, "hello");
            }
            let out = child.wait_with_output().map_err(|e| e.to_string())?;
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stderr.to_lowercase().contains("login") || stderr.to_lowercase().contains("auth") {
                Ok("needs_login".into())
            } else {
                Ok("authenticated".into())
            }
        }
        Err(e) => Err(e.to_string()),
    }
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
