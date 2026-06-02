use crate::process::ProcessManager;
use crate::state::AppState;
use std::io::Write;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Build a Command pre-loaded with the captured shell environment.
fn claude_cmd(binary: &str, state: &Arc<AppState>) -> std::process::Command {
    let mut cmd = std::process::Command::new(binary);
    let env = state.shell_env.read();
    for (k, v) in env.iter() {
        cmd.env(k, v);
    }
    cmd
}

/// One-shot chat: send message via `claude --print`, stream response back.
/// Uses the same auth as Claude Code CLI — no API key config needed.
#[tauri::command]
pub async fn chat_message(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    message: String,
    working_dir: String,
) -> Result<(), String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or_else(|| "Claude CLI not found. Run: npm install -g @anthropic-ai/claude-code".to_string())?;

    let _ = app.emit(&format!("agent:status:{}", project_id), "running");
    let _ = app.emit(&format!("agent:output:{}", project_id), format!("> {}", message));

    let mut child = claude_cmd(&binary, &state)
        .arg("--print")
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Claude CLI: {}", e))?;

    // Write message then close stdin (sends EOF)
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{}", message);
    }

    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");
    let pid = project_id.clone();
    let app_out = app.clone();
    let app_err = app.clone();
    let pid_err = pid.clone();

    let out_thread = std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app_out.emit(&format!("agent:output:{}", pid), line);
        }
    });

    let err_thread = std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() && !trimmed.contains("Logging to") {
                let _ = app_err.emit(&format!("agent:output:{}", pid_err), format!("[!] {}", trimmed));
            }
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = out_thread.join();
    let _ = err_thread.join();

    let _ = app.emit(&format!("agent:status:{}", project_id), "idle");

    if !status.success() {
        let code = status.code().unwrap_or(-1);
        if code != 0 {
            let _ = app.emit(
                &format!("agent:output:{}", project_id),
                format!("\n[exit {}]", code),
            );
        }
    }

    Ok(())
}

/// Spawn persistent interactive Claude CLI session for the terminal view.
#[tauri::command]
pub async fn spawn_agent(
    app: AppHandle,
    pm: State<'_, Arc<ProcessManager>>,
    state: State<'_, Arc<AppState>>,
    project_id: String,
    working_dir: String,
) -> Result<(), String> {
    let binary = state
        .claude_binary
        .read()
        .clone()
        .ok_or_else(|| "Claude CLI not found".to_string())?;

    // Pass shell env to ProcessManager
    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();

    pm.spawn_with_env(app, project_id, binary, working_dir, shell_env)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_to_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
    message: String,
) -> Result<(), String> {
    pm.send_input(&project_id, &message).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_agent(
    pm: State<'_, Arc<ProcessManager>>,
    project_id: String,
) -> Result<(), String> {
    pm.kill(&project_id);
    Ok(())
}
