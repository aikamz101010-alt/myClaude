use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
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
        let _child = pair.slave.spawn_command(cmd)?;

        // Get writer (to send keystrokes to claude)
        let writer = pair.master.take_writer()?;

        // Get reader (to receive claude output)
        let mut reader = pair.master.try_clone_reader()?;

        let pid = project_id.clone();
        let app_handle = app.clone();

        // Stream raw PTY output to frontend
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        // Send raw bytes as UTF-8 string (xterm.js handles ANSI)
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&format!("pty:output:{}", pid), data);
                    }
                }
            }
            // Session ended
            let _ = app_handle.emit(&format!("pty:exit:{}", pid), ());
        });

        let _ = app.emit(&format!("pty:started:{}", project_id), ());

        self.sessions.lock().insert(
            project_id,
            PtySession { writer, master: pair.master },
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
        self.sessions.lock().contains_key(project_id)
    }
}
