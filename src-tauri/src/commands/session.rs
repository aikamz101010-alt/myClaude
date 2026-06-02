use dirs::home_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

/// A parsed message from a Claude CLI session JSONL file.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionEntry {
    pub role: String,       // "user" | "assistant"
    pub text: String,       // merged text content
    pub tool_uses: Vec<ToolUse>,
    pub session_id: Option<String>,
    pub uuid: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToolUse {
    pub name: String,
    pub input_summary: String,
}

/// Convert a filesystem path to the Claude project slug.
/// e.g. /Users/foo/my-project → -Users-foo-my-project
fn path_to_slug(project_path: &str) -> String {
    project_path.replace('/', "-")
}

/// Find the project directory in ~/.claude/projects/ for a given project path.
fn find_project_dir(project_path: &str) -> Option<PathBuf> {
    let home = home_dir()?;
    let slug = path_to_slug(project_path);
    let candidate = home.join(".claude").join("projects").join(&slug);
    if candidate.is_dir() {
        return Some(candidate);
    }
    // Fallback: search for a prefix match (in case path includes trailing slash or minor diff)
    let projects_dir = home.join(".claude").join("projects");
    let Ok(entries) = std::fs::read_dir(&projects_dir) else { return None };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == slug || slug.ends_with(&name) || name.ends_with(&slug) {
            if entry.path().is_dir() {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Find the most recently modified JSONL session file in a project directory.
fn find_latest_session_file(project_dir: &PathBuf) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(project_dir) else { return None };

    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.path().extension().map_or(false, |x| x == "jsonl"))
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((mtime, e.path()))
        })
        .collect();

    candidates.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    candidates.into_iter().next().map(|(_, p)| p)
}

/// Parse a session JSONL file into a list of SessionEntry.
/// Multiple consecutive assistant JSONL lines (chained by parentUuid) are
/// collapsed into a single assistant entry.
fn parse_session_jsonl(path: &PathBuf) -> Vec<SessionEntry> {
    let Ok(content) = std::fs::read_to_string(path) else { return vec![] };

    let mut raw: Vec<Value> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();

    // Only keep user/assistant entries that have a message body
    raw.retain(|v| {
        matches!(v["type"].as_str(), Some("user") | Some("assistant"))
            && !v["message"].is_null()
    });

    // Collapse: group consecutive assistant rows into one turn
    let mut entries: Vec<SessionEntry> = vec![];

    for row in &raw {
        let role = row["type"].as_str().unwrap_or("").to_string();
        let msg  = &row["message"];
        let uuid = row["uuid"].as_str().map(String::from);

        // Extract session_id if present (only on first assistant in a turn)
        let session_id = msg["session_id"].as_str().map(String::from)
            .or_else(|| row["sessionId"].as_str().map(String::from));

        // Collect text and tool_uses from content array
        let (text, mut tool_uses) = extract_content(msg);

        if role == "user" {
            // Always a new entry
            entries.push(SessionEntry { role, text, tool_uses, session_id, uuid });
        } else if role == "assistant" {
            // Try to merge into the previous assistant entry (same turn)
            if let Some(last) = entries.last_mut() {
                if last.role == "assistant" {
                    if !text.is_empty() {
                        if !last.text.is_empty() { last.text.push('\n'); }
                        last.text.push_str(&text);
                    }
                    last.tool_uses.append(&mut tool_uses);
                    if last.session_id.is_none() {
                        last.session_id = session_id;
                    }
                    continue;
                }
            }
            entries.push(SessionEntry { role, text, tool_uses, session_id, uuid });
        }
    }

    entries
}

fn extract_content(msg: &Value) -> (String, Vec<ToolUse>) {
    let mut text_parts: Vec<String> = vec![];
    let mut tool_uses: Vec<ToolUse> = vec![];

    let content = match msg["content"].as_array() {
        Some(arr) => arr.as_slice(),
        None => {
            // Some entries store content as plain string (older format)
            if let Some(s) = msg["content"].as_str() {
                return (s.to_string(), vec![]);
            }
            return (String::new(), vec![]);
        }
    };

    for block in content {
        match block["type"].as_str() {
            Some("text") => {
                if let Some(t) = block["text"].as_str() {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        text_parts.push(trimmed.to_string());
                    }
                }
            }
            Some("tool_use") => {
                let name = block["name"].as_str().unwrap_or("tool").to_string();
                // Summarise input (first 80 chars of the most relevant field)
                let input_summary = summarise_tool_input(&block["input"]);
                tool_uses.push(ToolUse { name, input_summary });
            }
            Some("thinking") => {} // skip
            _ => {}
        }
    }

    (text_parts.join("\n"), tool_uses)
}

fn summarise_tool_input(input: &Value) -> String {
    // Common tool fields
    for field in &["command", "file_path", "path", "query", "content", "description"] {
        if let Some(v) = input[field].as_str() {
            let s: String = v.chars().take(80).collect();
            return if v.len() > 80 { format!("{}…", s) } else { s };
        }
    }
    // Fallback: compact JSON
    let s = serde_json::to_string(input).unwrap_or_default();
    let short: String = s.chars().take(80).collect();
    if s.len() > 80 { format!("{}…", short) } else { short }
}

// ── Tauri commands ────────────────────────────────────────────────

/// Load the most recent Claude CLI session history for a project path.
/// Returns an empty Vec if no session exists yet.
#[tauri::command]
pub async fn get_session_history(project_path: String) -> Result<Vec<SessionEntry>, String> {
    let Some(project_dir) = find_project_dir(&project_path) else {
        return Ok(vec![]);
    };
    let Some(jsonl_file) = find_latest_session_file(&project_dir) else {
        return Ok(vec![]);
    };
    Ok(parse_session_jsonl(&jsonl_file))
}

/// List all session IDs (JSONL filenames without extension) for a project.
#[tauri::command]
pub async fn list_project_sessions(project_path: String) -> Result<Vec<String>, String> {
    let Some(project_dir) = find_project_dir(&project_path) else {
        return Ok(vec![]);
    };
    let Ok(entries) = std::fs::read_dir(&project_dir) else {
        return Ok(vec![]);
    };
    let mut sessions: Vec<(std::time::SystemTime, String)> = entries
        .flatten()
        .filter(|e| e.path().extension().map_or(false, |x| x == "jsonl"))
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            let name  = e.path().file_stem()?.to_string_lossy().to_string();
            Some((mtime, name))
        })
        .collect();
    sessions.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(sessions.into_iter().map(|(_, n)| n).collect())
}
