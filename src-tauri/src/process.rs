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

    pub fn spawn(
        self: &Arc<Self>,
        app: AppHandle,
        project_id: String,
        claude_binary: String,
        working_dir: String,
    ) -> anyhow::Result<()> {
        let mut child = Command::new(&claude_binary)
            .current_dir(&working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().expect("stdout");
        let pid = project_id.clone();
        let app_handle = app.clone();

        // Stream stdout in background thread
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = app_handle.emit(&format!("agent:output:{}", pid), line);
            }
        });

        self.processes.lock().insert(
            project_id.clone(),
            ManagedProcess { project_id, child },
        );

        Ok(())
    }

    pub fn send_input(&self, project_id: &str, input: &str) -> anyhow::Result<()> {
        let mut procs = self.processes.lock();
        if let Some(proc) = procs.get_mut(project_id) {
            if let Some(stdin) = proc.child.stdin.as_mut() {
                writeln!(stdin, "{}", input)?;
            }
        }
        Ok(())
    }

    pub fn kill(&self, project_id: &str) {
        let mut procs = self.processes.lock();
        if let Some(mut proc) = procs.remove(project_id) {
            let _ = proc.child.kill();
        }
    }
}
