use crate::process::ProcessManager;
use crate::state::AppState;
use std::io::Write;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// One-shot chat: send message via `claude --print`, stream response back.
/// No need to "Start Agent" first — works immediately.
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
        .ok_or_else(|| "Claude CLI not found. Install: npm install -g @anthropic-ai/claude-code".to_string())?;

    // Signal "thinking" to frontend
    let _ = app.emit(&format!("agent:status:{}", project_id), "running");
    let _ = app.emit(&format!("agent:output:{}", project_id), format!("\n> {}\n", message));

    let mut child = std::process::Command::new(&binary)
        .arg("--print")
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Claude CLI: {}", e))?;

    // Write message to stdin then close it
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{}", message);
        // stdin dropped here → EOF sent to claude
    }

    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");
    let pid = project_id.clone();
    let app_out = app.clone();
    let app_err = app.clone();
    let pid_err = pid.clone();

    // Stream stdout
    let out_thread = std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_out.emit(&format!("agent:output:{}", pid), line);
        }
    });

    // Stream stderr (claude CLI warnings/errors)
    let err_thread = std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                let _ = app_err.emit(&format!("agent:output:{}", pid_err), format!("[stderr] {}", line));
            }
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = out_thread.join();
    let _ = err_thread.join();

    // Signal done
    let _ = app.emit(&format!("agent:status:{}", project_id), "idle");

    if !status.success() {
        let _ = app.emit(
            &format!("agent:output:{}", project_id),
            format!("\n[exit {}]", status.code().unwrap_or(-1)),
        );
    }

    Ok(())
}

/// Spawn persistent Claude CLI session (for long-running agent tasks).
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
    pm.spawn(app, project_id, binary, working_dir)
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
