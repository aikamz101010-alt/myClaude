use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Runs `claude auth login` inside a real PTY so the CLI behaves interactively
/// (prints the login URL and waits for the pasted authorization code).
/// Without a PTY the CLI detects non-interactive stdin and stays silent.
pub struct AuthManager {
    inner: Mutex<Option<AuthSession>>,
}

struct AuthSession {
    writer: Box<dyn Write + Send>,
    // Master must stay alive for the PTY (and our writer) to remain valid.
    _master: Box<dyn portable_pty::MasterPty + Send>,
}

impl AuthManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { inner: Mutex::new(None) })
    }

    /// Spawn `claude auth login <flag>` in a PTY.
    /// Emits: `auth:event` (cleaned output lines), `auth:url` (detected login URL),
    /// `auth:done` { success } on exit.
    pub fn start(
        self: &Arc<Self>,
        app: AppHandle,
        claude_binary: String,
        shell_env: Vec<(String, String)>,
        flag: String,
    ) -> anyhow::Result<()> {
        // Tear down any previous attempt.
        *self.inner.lock() = None;

        let pty_system = native_pty_system();
        // Wide terminal so the long OAuth URL is printed on a single unwrapped line.
        let pair = pty_system.openpty(PtySize {
            rows: 50,
            cols: 800,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&claude_binary);
        cmd.arg("auth");
        cmd.arg("login");
        cmd.arg(&flag);
        // Drop ANTHROPIC_API_KEY so the OAuth flow runs (a key short-circuits auth).
        for (k, v) in &shell_env {
            if k != "ANTHROPIC_API_KEY" {
                cmd.env(k, v);
            }
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        let mut child = pair.slave.spawn_command(cmd)?;
        let writer = pair.master.take_writer()?;
        let mut reader = pair.master.try_clone_reader()?;

        *self.inner.lock() = Some(AuthSession {
            writer,
            _master: pair.master,
        });

        let this = self.clone();
        std::thread::spawn(move || {
            let mut acc = String::new();
            let mut url_sent = false;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        let clean = strip_ansi(&chunk);
                        if !clean.trim().is_empty() {
                            let _ = app.emit("auth:event", clean.clone());
                        }
                        acc.push_str(&clean);
                        if !url_sent {
                            if let Some(url) = extract_url(&acc) {
                                url_sent = true;
                                let _ = app.emit("auth:url", url);
                            }
                        }
                    }
                }
            }
            let _ = child.wait();
            let success = check_logged_in(&claude_binary, &shell_env);
            *this.inner.lock() = None;
            let _ = app.emit("auth:done", serde_json::json!({ "success": success }));
        });

        Ok(())
    }

    /// Send the pasted authorization code to the waiting CLI (plus Enter).
    pub fn submit_code(&self, code: &str) -> anyhow::Result<()> {
        let mut guard = self.inner.lock();
        match guard.as_mut() {
            Some(session) => {
                session.writer.write_all(code.trim().as_bytes())?;
                session.writer.write_all(b"\r")?;
                session.writer.flush()?;
                Ok(())
            }
            None => anyhow::bail!("no active login session"),
        }
    }
}

/// Strip ANSI/OSC escape sequences so the UI shows plain text and URL parsing is clean.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&nc) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        if nc == '\u{07}' {
                            break;
                        }
                        if nc == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Find the first https:// URL in accumulated output.
fn extract_url(s: &str) -> Option<String> {
    let idx = s.find("https://")?;
    let tail = &s[idx..];
    let end = tail
        .find(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | ')' | '`'))
        .unwrap_or(tail.len());
    let url = tail[..end].trim_end_matches(['.', ',']).to_string();
    if url.len() > "https://".len() {
        Some(url)
    } else {
        None
    }
}

/// Confirm login succeeded via `claude auth status --json` (ignoring any API key).
fn check_logged_in(binary: &str, shell_env: &[(String, String)]) -> bool {
    let mut cmd = std::process::Command::new(binary);
    cmd.args(["auth", "status", "--json"]);
    for (k, v) in shell_env {
        if k != "ANTHROPIC_API_KEY" {
            cmd.env(k, v);
        }
    }
    cmd.env_remove("ANTHROPIC_API_KEY");
    if let Ok(out) = cmd.output() {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(s.trim()) {
            return v.get("loggedIn").and_then(|b| b.as_bool()).unwrap_or(false);
        }
    }
    false
}
