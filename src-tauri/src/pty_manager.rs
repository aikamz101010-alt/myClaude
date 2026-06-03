use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
        })
    }

    /// Spawn `claude` in a real PTY. Output streamed raw as Tauri events.
    pub fn start(
        self: &Arc<Self>,
        app: AppHandle,
        project_id: String,
        claude_binary: String,
        working_dir: String,
        shell_env: Vec<(String, String)>,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<()> {
        // Kill any existing session
        self.stop(&project_id);

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&claude_binary);
        cmd.cwd(&working_dir);
        for (k, v) in &shell_env {
            cmd.env(k, v);
        }
        // Tell Claude CLI it's running in a terminal
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Spawn claude in the PTY slave
        let child = pair.slave.spawn_command(cmd)?;

        // Get writer (to send keystrokes to claude)
        let writer = pair.master.take_writer()?;

        // Get reader (to receive claude output)
        let mut reader = pair.master.try_clone_reader()?;

        let pid = project_id.clone();
        let app_handle = app.clone();

        // Stream raw PTY output to frontend (xterm.js handles ANSI).
        // We must NOT split a multi-byte UTF-8 char across reads — Claude's TUI
        // uses box-drawing/emoji/spinner glyphs, and `from_utf8_lossy` on a
        // partial sequence would emit replacement chars (�). So we keep any
        // incomplete trailing bytes and prepend them to the next chunk.
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        // Emit the largest valid UTF-8 prefix; hold back the rest.
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(e) => e.valid_up_to(),
                        };
                        if valid > 0 {
                            let s = String::from_utf8_lossy(&pending[..valid]).to_string();
                            let _ = app_handle.emit(&format!("pty:output:{}", pid), &s);
                            pending.drain(..valid);
                        }
                        // A split char leaves at most 3 trailing bytes. More than
                        // that means genuinely invalid bytes → flush lossily so we
                        // never stall or grow unbounded.
                        if pending.len() >= 4 {
                            let s = String::from_utf8_lossy(&pending).to_string();
                            let _ = app_handle.emit(&format!("pty:output:{}", pid), &s);
                            pending.clear();
                        }
                    }
                }
            }
            let _ = app_handle.emit(&format!("pty:exit:{}", pid), ());
        });

        let _ = app.emit(&format!("pty:started:{}", project_id), ());

        self.sessions.lock().insert(
            project_id,
            PtySession { writer, master: pair.master, child },
        );

        Ok(())
    }

    /// Write raw keystrokes to PTY (from xterm.js onData)
    pub fn write(&self, project_id: &str, data: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(project_id) {
            session.writer.write_all(data.as_bytes())?;
            session.writer.flush()?;
        }
        Ok(())
    }

    /// Resize PTY when xterm.js viewport changes
    pub fn resize(&self, project_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(project_id) {
            session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }

    pub fn stop(&self, project_id: &str) {
        self.sessions.lock().remove(project_id);
    }

    pub fn is_running(&self, project_id: &str) -> bool {
        let mut sessions = self.sessions.lock();
        match sessions.get_mut(project_id) {
            Some(session) => match session.child.try_wait() {
                // Process has exited → prune the dead session so callers can
                // restart cleanly instead of "reconnecting" to a corpse.
                Ok(Some(_)) => { sessions.remove(project_id); false }
                _ => true, // still running (or status unknown)
            },
            None => false,
        }
    }
}
