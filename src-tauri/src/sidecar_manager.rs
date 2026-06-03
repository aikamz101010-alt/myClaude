use parking_lot::Mutex;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Manages a single long-lived Node sidecar running the Claude Agent SDK.
/// Commands are written to its stdin as NDJSON; events are read from stdout
/// and re-emitted to the frontend as `chat:event:{chatId}`.
pub struct SidecarManager {
    inner: Mutex<Option<SidecarProc>>,
    node_path: Mutex<Option<String>>,
    script_path: Mutex<Option<String>>,
    claude_path: Mutex<Option<String>>,
    shell_env: Mutex<Vec<(String, String)>>,
}

struct SidecarProc {
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
}

impl SidecarManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(None),
            node_path: Mutex::new(None),
            script_path: Mutex::new(None),
            claude_path: Mutex::new(None),
            shell_env: Mutex::new(vec![]),
        })
    }

    /// Configure paths & env (called at startup).
    pub fn configure(
        &self,
        node_path: Option<String>,
        script_path: Option<String>,
        claude_path: Option<String>,
        shell_env: Vec<(String, String)>,
    ) {
        *self.node_path.lock() = node_path;
        *self.script_path.lock() = script_path;
        *self.claude_path.lock() = claude_path;
        *self.shell_env.lock() = shell_env;
    }

    /// Ensure the sidecar is running; spawn if needed.
    fn ensure_running(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self.inner.lock();
        if let Some(proc) = guard.as_mut() {
            // Still alive?
            match proc.child.try_wait() {
                Ok(None) => return Ok(()), // running
                _ => { *guard = None; }    // died → respawn
            }
        }

        let node = self.node_path.lock().clone()
            .ok_or("Node.js not found — required for Agent SDK")?;
        let script = self.script_path.lock().clone()
            .ok_or("Sidecar script not found")?;

        let mut cmd = Command::new(&node);
        cmd.arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Inherit shell env EXCEPT ANTHROPIC_API_KEY (force OAuth/subscription)
        for (k, v) in self.shell_env.lock().iter() {
            if k == "ANTHROPIC_API_KEY" { continue; }
            cmd.env(k, v);
        }
        cmd.env_remove("ANTHROPIC_API_KEY");
        // Give the SDK/CLI a writable temp dir
        cmd.env("CLAUDE_CODE_TMPDIR", std::env::temp_dir());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

        let stdin = child.stdin.take().ok_or("No sidecar stdin")?;
        let stdout = child.stdout.take().ok_or("No sidecar stdout")?;
        let stderr = child.stderr.take();

        // Reader thread → re-emit events to frontend
        let app_out = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let line = line.trim().to_string();
                if line.is_empty() { continue; }
                let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };

                // Startup marker
                if ev["kind"].as_str() == Some("ready") { continue; }

                let Some(chat_id) = ev["chatId"].as_str() else { continue };
                let payload = normalize_event(&ev);
                let _ = app_out.emit(&format!("chat:event:{}", chat_id), payload);
            }
        });

        // Drain stderr (debug)
        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[sidecar] {}", line);
                }
            });
        }

        *guard = Some(SidecarProc { child, stdin });
        Ok(())
    }

    fn write_command(&self, app: &AppHandle, cmd: Value) -> Result<(), String> {
        self.ensure_running(app)?;
        let mut guard = self.inner.lock();
        let proc = guard.as_mut().ok_or("Sidecar not running")?;
        let line = cmd.to_string();
        proc.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        proc.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
        proc.stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn send_prompt(
        &self,
        app: &AppHandle,
        chat_id: &str,
        message: &str,
        cwd: &str,
        model: Option<String>,
        permission_mode: Option<String>,
        resume: Option<String>,
        system_append: Option<String>,
    ) -> Result<(), String> {
        let claude = self.claude_path.lock().clone();
        let cmd = json!({
            "cmd": "prompt",
            "chatId": chat_id,
            "message": message,
            "cwd": cwd,
            "model": model,
            "permissionMode": permission_mode,
            "resume": resume,
            "claudePath": claude,
            "systemAppend": system_append,
        });
        self.write_command(app, cmd)
    }

    pub fn respond_permission(
        &self,
        app: &AppHandle,
        chat_id: &str,
        request_id: &str,
        allow: bool,
        message: Option<String>,
    ) -> Result<(), String> {
        let cmd = json!({
            "cmd": "permission",
            "chatId": chat_id,
            "requestId": request_id,
            "allow": allow,
            "message": message,
        });
        self.write_command(app, cmd)
    }

    pub fn interrupt(&self, app: &AppHandle, chat_id: &str) -> Result<(), String> {
        let cmd = json!({ "cmd": "interrupt", "chatId": chat_id });
        self.write_command(app, cmd)
    }

    /// The Node binary currently configured for the sidecar.
    pub fn current_node_path(&self) -> Option<String> {
        self.node_path.lock().clone()
    }

    /// Change which Node binary runs the sidecar. Kills the running process so the
    /// next prompt respawns it with the new Node.
    pub fn set_node_path(&self, path: Option<String>) {
        *self.node_path.lock() = path;
        if let Some(mut proc) = self.inner.lock().take() {
            let _ = proc.child.kill();
        }
    }
}

/// Normalize sidecar event (camelCase + new kinds) → frontend ChatStreamEvent shape.
fn normalize_event(ev: &Value) -> Value {
    let kind = ev["kind"].as_str().unwrap_or("");
    match kind {
        "text" => json!({
            "kind": "text",
            "text": ev["text"],
            "subagent": ev["subagent"],
        }),
        "tool_use" => json!({
            "kind": "tool_use",
            "tool_name": ev["tool"],
            "tool_input": ev["input"],
            "tool_use_id": ev["toolUseId"],
            "subagent": ev["subagent"],
        }),
        "tool_result" => json!({
            "kind": "tool_result",
            "text": ev["text"],
            "tool_use_id": ev["toolUseId"],
        }),
        "agent_start" => json!({ "kind": "agent_start", "agent_name": ev["name"] }),
        "agent_stop"  => json!({ "kind": "agent_stop",  "agent_name": ev["name"] }),
        "permission_request" => json!({
            "kind": "permission_request",
            "request_id": ev["requestId"],
            "tool_name": ev["tool"],
            "tool_input": ev["input"],
        }),
        "done" => json!({
            "kind": "done",
            "session_id": ev["sessionId"],
            "cost_usd": ev["costUsd"],
            "input_tokens": ev["inputTokens"],
            "output_tokens": ev["outputTokens"],
        }),
        "error" => json!({ "kind": "error", "text": ev["text"] }),
        _ => ev.clone(),
    }
}

/// Detect a usable `node` binary (cross-platform).
///
/// The Claude Agent SDK uses disposable resources (`Symbol.asyncDispose`) and
/// requires Node >= 18; older Node (e.g. a stale Homebrew v16 in /usr/local/bin)
/// throws "object not disposable". So we don't just take the first node on PATH:
/// we inspect every candidate and pick the NEWEST version that meets the minimum.
pub fn detect_node_binary() -> Option<String> {
    const MIN_MAJOR: u32 = 18;
    let candidates = crate::platform::node_candidates();

    // Pick the highest (major, minor) that is >= MIN_MAJOR.
    let mut best: Option<((u32, u32), String)> = None;
    for path in &candidates {
        if let Some(ver) = crate::platform::node_version(path) {
            if ver.0 < MIN_MAJOR {
                continue;
            }
            let better = best.as_ref().map_or(true, |(bv, _)| ver > *bv);
            if better {
                best = Some((ver, path.clone()));
            }
        }
    }
    if let Some((_, path)) = best {
        return Some(path);
    }

    // Best-effort fallback: nothing met the minimum (or versions weren't parseable).
    // Return the first existing candidate so the sidecar can at least try and
    // surface a clear error, rather than reporting "Node.js not found".
    candidates.into_iter().next()
        .or_else(|| crate::platform::fallback_binary("node"))
}

/// Resolve the sidecar script path (dev: project/sidecar/agent.mjs).
pub fn detect_sidecar_script() -> Option<String> {
    let mut candidates: Vec<PathBuf> = vec![];
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("sidecar/agent.mjs"));
        candidates.push(cwd.join("../sidecar/agent.mjs"));
    }
    // Relative to the executable (bundled)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("sidecar/agent.mjs"));
            candidates.push(dir.join("../Resources/sidecar/agent.mjs"));
        }
    }
    for c in candidates {
        if c.exists() {
            return Some(c.to_string_lossy().into());
        }
    }
    None
}
