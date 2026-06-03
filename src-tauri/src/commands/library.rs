use crate::scanner;
use crate::state::{AppState, SkillItem};
use dirs::home_dir;
#[allow(unused_imports)]
use scopeguard::defer;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_library(state: State<'_, Arc<AppState>>) -> Result<Vec<SkillItem>, String> {
    Ok(state.library.read().clone())
}

#[tauri::command]
pub async fn rescan_library(state: State<'_, Arc<AppState>>) -> Result<Vec<SkillItem>, String> {
    let binary = scanner::detect_claude_binary();
    *state.claude_binary.write() = binary;
    scanner::scan_library(state.inner().clone()).await;
    Ok(state.library.read().clone())
}

#[tauri::command]
pub async fn get_claude_binary(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    Ok(state.claude_binary.read().clone())
}

#[tauri::command]
pub async fn set_api_key(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<(), String> {
    state.shell_env.write().insert("ANTHROPIC_API_KEY".into(), key);
    Ok(())
}

/// Run `claude auth status --json` and return the raw JSON (frontend parses it).
#[tauri::command]
pub async fn auth_status_json(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let binary = state.claude_binary.read().clone().ok_or("Claude CLI not found")?;
    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();

    let mut cmd = std::process::Command::new(&binary);
    cmd.args(["auth", "status", "--json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for (k, v) in &shell_env { cmd.env(k, v); }

    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok("{\"loggedIn\":false}".into());
    }
    Ok(stdout)
}

/// Start interactive browser OAuth login via `claude auth login`.
/// mode = "claudeai" (subscription, default) | "console" (API billing).
/// Streams progress as `auth:event` and emits `auth:done` { success } when finished.
#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    mode: String,
) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    let binary = state.claude_binary.read().clone().ok_or("Claude CLI not found")?;
    // Drop ANTHROPIC_API_KEY so the OAuth flow runs (key would short-circuit auth)
    let shell_env: Vec<(String, String)> = state.shell_env.read().clone()
        .into_iter().filter(|(k, _)| k != "ANTHROPIC_API_KEY").collect();

    let flag = if mode == "console" { "--console" } else { "--claudeai" };

    std::thread::spawn(move || {
        let mut cmd = std::process::Command::new(&binary);
        cmd.args(["auth", "login", flag])
            .env_remove("ANTHROPIC_API_KEY")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        for (k, v) in &shell_env { cmd.env(k, v); }

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => { let _ = app.emit("auth:done", serde_json::json!({"success": false, "error": e.to_string()})); return; }
        };

        // Stream stdout + stderr lines as auth:event (CLI prints the login URL here)
        if let Some(stdout) = child.stdout.take() {
            let app2 = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let _ = app2.emit("auth:event", line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let app3 = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    let _ = app3.emit("auth:event", line);
                }
            });
        }

        let status = child.wait();
        let success = status.map(|s| s.success()).unwrap_or(false);
        let _ = app.emit("auth:done", serde_json::json!({"success": success}));
    });

    Ok(())
}

/// Log out: `claude auth logout`.
#[tauri::command]
pub async fn auth_logout(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let binary = state.claude_binary.read().clone().ok_or("Claude CLI not found")?;
    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();
    let mut cmd = std::process::Command::new(&binary);
    cmd.args(["auth", "logout"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for (k, v) in &shell_env { cmd.env(k, v); }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok("logged_out".into())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Legacy: simple API-key presence check (kept for the title-bar indicator).
#[tauri::command]
pub async fn get_auth_status(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let env = state.shell_env.read();
    match env.get("ANTHROPIC_API_KEY") {
        Some(key) if !key.is_empty() => {
            // char-safe masking (never slice on byte/UTF-8 boundary)
            let chars: Vec<char> = key.chars().collect();
            let masked = if chars.len() > 16 {
                let head: String = chars.iter().take(12).collect();
                let tail: String = chars.iter().rev().take(4).rev().collect();
                format!("{}...{}", head, tail)
            } else {
                "•".repeat(chars.len())
            };
            Ok(format!("✅ API key found: {}", masked))
        }
        _ => Ok("❌ ANTHROPIC_API_KEY not found in captured env".to_string()),
    }
}

// ── Plugin management commands ────────────────────────────────────────────────

fn run_claude(state: &State<'_, Arc<AppState>>, args: &[&str]) -> Result<String, String> {
    let binary = state.claude_binary.read().clone()
        .ok_or_else(|| "Claude CLI not found — install with: npm i -g @anthropic-ai/claude-code".to_string())?;

    let shell_env: Vec<(String, String)> = state.shell_env.read().clone().into_iter().collect();

    let mut cmd = std::process::Command::new(&binary);
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    for (k, v) in &shell_env {
        cmd.env(k, v);
    }

    let output = cmd.output().map_err(|e| format!("Failed to run claude: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        Ok(if stdout.is_empty() { "Done.".to_string() } else { stdout })
    } else {
        let msg = if !stderr.is_empty() { stderr } else { stdout };
        Err(if msg.is_empty() {
            format!("Command exited with code {:?}", output.status.code())
        } else {
            msg
        })
    }
}

/// Install a plugin via `claude plugin install <plugin>[@marketplace]`.
/// Also accepts a GitHub URL as marketplace source — in that case it first
/// adds the marketplace then installs.
#[tauri::command]
pub async fn install_plugin(
    state: State<'_, Arc<AppState>>,
    target: String, // "plugin@marketplace" OR "https://github.com/..."
) -> Result<String, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err("Plugin name or URL is required".into());
    }
    run_claude(&state, &["plugin", "install", &target])
}

/// Add a marketplace from a GitHub URL, then return a success message.
#[tauri::command]
pub async fn add_marketplace(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<String, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Marketplace URL is required".into());
    }
    run_claude(&state, &["plugin", "marketplace", "add", &url])
}

/// Scaffold a new personal skill at ~/.claude/skills/<name>/.
#[tauri::command]
pub async fn init_skill(
    state: State<'_, Arc<AppState>>,
    name: String,
) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Skill name is required".into());
    }
    // Validate: only alphanumeric, hyphens, underscores
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Skill name may only contain letters, numbers, hyphens, and underscores".into());
    }
    run_claude(&state, &["plugin", "init", &name])
}

/// Create a new agent .md file at ~/.claude/agents/<name>.md.
#[tauri::command]
pub async fn create_agent(
    name: String,
    description: String,
    model: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Agent name is required".into());
    }
    if !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Agent name may only contain letters, numbers, hyphens, and underscores".into());
    }

    let agents_dir = home_dir()
        .ok_or("Cannot find home directory")?
        .join(".claude/agents");
    std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let path = agents_dir.join(format!("{}.md", name));
    if path.exists() {
        return Err(format!("Agent '{}' already exists", name));
    }

    let mut content = String::from("---\n");
    if !description.is_empty() {
        content.push_str(&format!("description: \"{}\"\n", description.replace('"', "\\\"")));
    }
    if !model.is_empty() {
        content.push_str(&format!("model: \"{}\"\n", model));
    }
    content.push_str("---\n\n");
    content.push_str(&format!("# {}\n\n", name));
    if !description.is_empty() {
        content.push_str(&format!("{}\n", description));
    }

    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Ensure a `lead-orchestrator` agent exists.
/// scope = "personal" → ~/.claude/agents/lead-orchestrator.md
/// scope = "project"  → <project_path>/.claude/agents/lead-orchestrator.md
/// Returns "created" or "exists".
#[tauri::command]
pub async fn ensure_lead_orchestrator(
    scope: String,
    project_path: String,
) -> Result<String, String> {
    let agents_dir = if scope == "project" {
        std::path::Path::new(&project_path).join(".claude/agents")
    } else {
        home_dir().ok_or("Cannot find home directory")?.join(".claude/agents")
    };
    std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;

    let path = agents_dir.join("lead-orchestrator.md");
    if path.exists() {
        return Ok("exists".into());
    }

    let content = r#"---
name: lead-orchestrator
description: Coordinates development so the main agent, subagents, skills, and plugins all act according to CONTRACT.md (directives & agreements), CLAUDE.md (instructions), and MEMORY.md (memory). Auto-activated each session.
model: claude-opus-4-8
---

# Lead Orchestrator

You coordinate this project's development. Before acting, internalize the project guidance and treat it as the source of truth for the whole session:

- **CONTRACT.md** — directives & agreements (allowed skills/agents/plugins, custom rules, documents to maintain).
- **CLAUDE.md** — project instructions.
- **MEMORY.md** — project memory.

## Responsibilities

1. Keep every step aligned with the guidance above.
2. When delegating to subagents or invoking plugins/skills, pass along the relevant directives so they act consistently with the contract.
3. Prefer the skills, agents, and MCP plugins allowed by CONTRACT.md.
4. Obey the Custom Rules / Arahan.
5. If a Documents section lists files (e.g. PRD.md, TRD.md), keep them created and updated whenever features or logic change.
6. If a request conflicts with the guidance, flag it clearly and propose a compliant approach before proceeding.
"#;

    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok("created".into())
}

// ── GitHub skill install ──────────────────────────────────────────────────────

fn parse_github_owner_repo(url: &str) -> Option<String> {
    // Accept: https://github.com/owner/repo  or  github.com/owner/repo
    let stripped = url
        .trim()
        .trim_end_matches('/')
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("github.com/");
    // Now should be owner/repo
    let parts: Vec<&str> = stripped.splitn(3, '/').collect();
    if parts.len() >= 2 {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

/// Detect where skills live in a GitHub repo and return (skill_names, subfolder_path).
/// Checks `skills/` first, then `.claude/skills/` as a fallback.
/// Returns (vec![], "") when the repo itself is a single skill.
async fn detect_github_skills(
    client: &reqwest::Client,
    repo: &str,
) -> Result<(Vec<String>, String), String> {
    for subfolder in &["skills", ".claude/skills"] {
        let url = format!("https://api.github.com/repos/{}/contents/{}", repo, subfolder);
        let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

        match resp.status().as_u16() {
            200 => {
                let items: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
                let skills: Vec<String> = items
                    .iter()
                    .filter(|i| i["type"].as_str() == Some("dir"))
                    .filter_map(|i| i["name"].as_str().map(String::from))
                    .filter(|n| !n.starts_with('.'))
                    .collect();
                if !skills.is_empty() {
                    return Ok((skills, subfolder.to_string()));
                }
            }
            404 => continue,
            status => return Err(format!("GitHub API returned {} for {}", status, url)),
        }
    }
    // No skills subfolder found — repo root is itself a skill
    Ok((vec![], String::new()))
}

/// Fetch list of skills available in a GitHub repo.
/// Returns skill folder names. Empty means the repo itself is a skill.
#[tauri::command]
pub async fn list_github_skills(github_url: String) -> Result<Vec<String>, String> {
    let repo = parse_github_owner_repo(&github_url)
        .ok_or_else(|| "Invalid GitHub URL — expected https://github.com/owner/repo".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("claude-desktop-custom/1.0")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let (skills, _path) = detect_github_skills(&client, &repo).await?;
    Ok(skills)
}

/// Install skills from a GitHub repo into ~/.claude/skills/.
///
/// - `skills`: skill names to install (from `list_github_skills`).
///   Pass empty to install the repo root as a single skill.
#[tauri::command]
pub async fn install_github_skill(
    github_url: String,
    skills: Vec<String>,
) -> Result<String, String> {
    let repo_full = parse_github_owner_repo(&github_url)
        .ok_or_else(|| "Invalid GitHub URL".to_string())?;
    let repo_name = repo_full.split('/').last().unwrap_or("skill").to_string();

    // Re-detect skills path so we know the correct subfolder
    let client = reqwest::Client::builder()
        .user_agent("claude-desktop-custom/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let (_, detected_path) = detect_github_skills(&client, &repo_full).await
        .unwrap_or_default();

    let skills_target = home_dir()
        .ok_or("Cannot find home directory")?
        .join(".claude/skills");
    std::fs::create_dir_all(&skills_target).map_err(|e| e.to_string())?;

    // Unique temp directory to avoid conflicts
    let tmp_base = std::env::temp_dir();
    let tmp_dir = tmp_base.join(format!("cdc-skill-{}-{}", repo_name, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)));

    // Always clean up on exit
    let tmp_dir_clone = tmp_dir.clone();

    // Use detected_path or default to "skills"
    let skills_subdir = if detected_path.is_empty() { "skills".to_string() } else { detected_path };

    let result = if skills.is_empty() {
        // Clone repo root as a single skill (no skills/ subfolder)
        git_clone_sparse(&github_url, &tmp_dir, &[])?;
        let dst = skills_target.join(&repo_name);
        if dst.exists() {
            return Err(format!("~/.claude/skills/{} already exists — remove it first", repo_name));
        }
        copy_dir_all(&tmp_dir, &dst)?;
        format!("Installed skill \"{}\" → ~/.claude/skills/{}/", repo_name, repo_name)
    } else {
        // Sparse-checkout the requested skill directories
        let sparse_paths: Vec<String> = skills.iter()
            .map(|s| format!("{}/{}", skills_subdir, s))
            .collect();
        let sparse_refs: Vec<&str> = sparse_paths.iter().map(String::as_str).collect();
        git_clone_sparse(&github_url, &tmp_dir, &sparse_refs)?;

        let skills_in_clone = tmp_dir.join(&skills_subdir);
        let mut installed: Vec<String> = vec![];
        let mut skipped: Vec<String> = vec![];

        for skill_name in &skills {
            let src = skills_in_clone.join(skill_name);
            let dst = skills_target.join(skill_name);
            if !src.is_dir() {
                skipped.push(skill_name.clone());
                continue;
            }
            if dst.exists() {
                skipped.push(format!("{} (already exists)", skill_name));
                continue;
            }
            copy_dir_all(&src, &dst)?;
            installed.push(skill_name.clone());
        }

        let mut msg = format!("Installed {} skill(s): {}", installed.len(), installed.join(", "));
        if !skipped.is_empty() {
            msg.push_str(&format!("\nSkipped: {}", skipped.join(", ")));
        }
        msg
    };

    // Cleanup temp dir
    let _ = std::fs::remove_dir_all(&tmp_dir_clone);
    Ok(result)
}

fn git_clone_sparse(url: &str, dst: &std::path::Path, sparse_paths: &[&str]) -> Result<(), String> {
    // Step 1: shallow sparse clone (no blobs)
    let status = std::process::Command::new("git")
        .args([
            "clone", "--depth=1", "--filter=blob:none", "--sparse",
            url,
            dst.to_str().ok_or("Invalid path")?,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .map_err(|e| format!("git not found: {}", e))?;

    if !status.success() {
        return Err(format!("Failed to clone {}", url));
    }

    if !sparse_paths.is_empty() {
        // Step 2: set sparse-checkout paths
        let mut args = vec!["sparse-checkout", "set"];
        args.extend_from_slice(sparse_paths);
        let out = std::process::Command::new("git")
            .args(&args)
            .current_dir(dst)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
    }

    Ok(())
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let src_p = entry.path();
        let dst_p = dst.join(entry.file_name());
        // Skip .git directory
        if entry.file_name() == ".git" { continue; }
        if src_p.is_dir() {
            copy_dir_all(&src_p, &dst_p)?;
        } else {
            std::fs::copy(&src_p, &dst_p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
