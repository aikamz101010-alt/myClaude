use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct ManagedProcess {
    #[allow(dead_code)]
    pub project_id: String,
    pub child: Child,
    pub stdin: Option<Box<dyn Write + Send>>,
}

pub struct ProcessManager {
    pub processes: Mutex<HashMap<String, ManagedProcess>>,
}

impl ProcessManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            processes: Mutex::new(HashMap::new()),
        })
    }

    /// Spawn Claude CLI in interactive mode with full shell env (for terminal view).
    pub fn spawn_with_env(
        self: &Arc<Self>,
        app: AppHandle,
        project_id: String,
        claude_binary: String,
        working_dir: String,
        shell_env: Vec<(String, String)>,
    ) -> anyhow::Result<()> {
        // Kill existing session for this project if any
        self.kill(&project_id);

        let mut cmd = Command::new(&claude_binary);
        cmd.current_dir(&working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Pass captured shell environment
        for (k, v) in &shell_env {
            cmd.env(k, v);
        }

        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow::anyhow!("no stderr"))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("no stdin"))?;

        let pid = project_id.clone();
        let app_out = app.clone();
        let pid_err = pid.clone();
        let app_err = app.clone();

        // Stream stdout
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app_out.emit(&format!("agent:output:{}", pid), line);
            }
            // Process ended
            let _ = app_out.emit(&format!("agent:status:{}", pid), "idle");
        });

        // Stream stderr
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                let t = line.trim().to_string();
                if !t.is_empty() && !t.contains("Logging to") {
                    let _ = app_err.emit(&format!("agent:output:{}", pid_err), format!("[!] {}", t));
                }
            }
        });

        let _ = app.emit(&format!("agent:status:{}", project_id), "running");

        self.processes.lock().insert(
            project_id.clone(),
            ManagedProcess {
                project_id,
                child,
                stdin: Some(Box::new(stdin)),
            },
        );

        Ok(())
    }

    #[allow(dead_code)]
    pub fn spawn(
        self: &Arc<Self>,
        app: AppHandle,
        project_id: String,
        claude_binary: String,
        working_dir: String,
    ) -> anyhow::Result<()> {
        self.spawn_with_env(app, project_id, claude_binary, working_dir, vec![])
    }

    pub fn send_input(&self, project_id: &str, input: &str) -> anyhow::Result<()> {
        let mut procs = self.processes.lock();
        if let Some(proc) = procs.get_mut(project_id) {
            if let Some(ref mut stdin) = proc.stdin {
                writeln!(stdin, "{}", input)?;
            }
        }
        Ok(())
    }

    pub fn kill(&self, project_id: &str) {
        let mut procs = self.processes.lock();
        if let Some(mut proc) = procs.remove(project_id) {
            drop(proc.stdin.take()); // close stdin first
            let _ = proc.child.kill();
        }
    }

    #[allow(dead_code)]
    pub fn is_running(&self, project_id: &str) -> bool {
        let mut procs = self.processes.lock();
        if let Some(proc) = procs.get_mut(project_id) {
            matches!(proc.child.try_wait(), Ok(None))
        } else {
            false
        }
    }
}
