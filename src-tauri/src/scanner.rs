use crate::state::{AppState, SkillItem};
use dirs::home_dir;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub fn detect_claude_binary() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    if let Some(home) = home_dir() {
        // nvm installs
        let nvm_base = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            // sort descending so newest node version wins
            let mut paths: Vec<_> = entries.flatten().collect();
            paths.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            for entry in paths {
                let bin = entry.path().join("bin/claude");
                if bin.exists() {
                    return Some(bin.to_string_lossy().into());
                }
            }
        }
        // npm global (non-nvm)
        for global in &[".npm-global/bin/claude", ".local/bin/claude"] {
            let p = home.join(global);
            if p.exists() {
                return Some(p.to_string_lossy().into());
            }
        }
    }
    None
}

pub async fn scan_library(state: Arc<AppState>) {
    let mut items: Vec<SkillItem> = Vec::new();
    let mut seen_names: HashSet<String> = HashSet::new();

    if let Some(home) = home_dir() {
        // 1. ~/.claude/skills/  — direct skills directory
        let direct_skills = home.join(".claude/skills");
        scan_skills_dir(&direct_skills, &mut items, &mut seen_names, "personal");

        // 2. ~/.claude/plugins/cache/  — packages (recurse up to 5 levels deep)
        let plugins_cache = home.join(".claude/plugins/cache");
        scan_plugins_recursive(&plugins_cache, &mut items, &mut seen_names, 0);

        // 3. MCP servers — check both settings.json AND settings.local.json
        for settings_file in &["settings.json", "settings.local.json"] {
            let path = home.join(".claude").join(settings_file);
            scan_mcp_plugins(&path, &mut items, &mut seen_names);
        }

        // 4. Agents from CLAUDE.md
        let claude_md = home.join(".claude/CLAUDE.md");
        scan_agents_from_md(&claude_md, &mut items);
    }

    *state.library.write() = items;
}

/// Scan a `skills/` directory — each subdirectory is a skill.
fn scan_skills_dir(
    dir: &PathBuf,
    items: &mut Vec<SkillItem>,
    seen: &mut HashSet<String>,
    source_label: &str,
) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }

        // Deduplicate by name
        if seen.contains(&name) { continue; }
        seen.insert(name.clone());

        let description = read_skill_description(&path);
        items.push(SkillItem {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            version: source_label.to_string(),
            source_path: path.to_string_lossy().into(),
            item_type: "skill".into(),
        });
    }
}

/// Recursively walk plugin cache, find any `skills/` directories.
fn scan_plugins_recursive(
    dir: &PathBuf,
    items: &mut Vec<SkillItem>,
    seen: &mut HashSet<String>,
    depth: usize,
) {
    if depth > 5 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }

        if name == "skills" {
            // Found a skills/ dir — scan it
            scan_skills_dir(&path, items, seen, "plugin");
        } else {
            // Keep descending
            scan_plugins_recursive(&path, items, seen, depth + 1);
        }
    }
}

fn read_skill_description(skill_path: &PathBuf) -> String {
    // Look for the first .md file and extract a description line
    if let Ok(entries) = std::fs::read_dir(skill_path) {
        let mut md_files: Vec<_> = entries
            .flatten()
            .filter(|e| e.path().extension().map_or(false, |x| x == "md"))
            .collect();
        md_files.sort_by_key(|e| e.file_name());

        for entry in md_files {
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                for line in content.lines().skip(1) {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with('-') {
                        return trimmed.chars().take(80).collect();
                    }
                }
            }
        }
    }
    String::new()
}

fn scan_mcp_plugins(
    settings_path: &PathBuf,
    items: &mut Vec<SkillItem>,
    seen: &mut HashSet<String>,
) {
    let Ok(content) = std::fs::read_to_string(settings_path) else { return };
    let Ok(json): Result<Value, _> = serde_json::from_str(&content) else { return };
    if let Some(mcps) = json["mcpServers"].as_object() {
        for (name, val) in mcps {
            if seen.contains(name) { continue; }
            seen.insert(name.clone());
            // Try to get a description from the command
            let description = val["command"]
                .as_str()
                .map(|s| format!("cmd: {}", s.split('/').last().unwrap_or(s)))
                .unwrap_or_else(|| "MCP Server".into());
            items.push(SkillItem {
                id: Uuid::new_v4().to_string(),
                name: name.clone(),
                description,
                version: String::new(),
                source_path: settings_path.to_string_lossy().into(),
                item_type: "mcp".into(),
            });
        }
    }
}

fn scan_agents_from_md(claude_md: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(content) = std::fs::read_to_string(claude_md) else { return };
    // Match subagent definitions in CLAUDE.md agent descriptions sections
    let mut in_agents_section = false;
    for line in content.lines() {
        let trimmed = line.trim();
        // Detect agent sections by common headers
        if trimmed.to_lowercase().contains("agent") && trimmed.starts_with('#') {
            in_agents_section = true;
            continue;
        }
        if trimmed.starts_with('#') {
            in_agents_section = false;
        }
        // Parse lines like: "- subagent_type: name" or "- name:" in agent sections
        if trimmed.starts_with("- subagent_type:") {
            let name = trimmed.replace("- subagent_type:", "").trim().to_string();
            if !name.is_empty() {
                items.push(SkillItem {
                    id: Uuid::new_v4().to_string(),
                    name,
                    description: "Subagent".into(),
                    version: String::new(),
                    source_path: claude_md.to_string_lossy().into(),
                    item_type: "agent".into(),
                });
            }
        } else if in_agents_section && trimmed.starts_with("- ") && trimmed.ends_with(':') {
            let name = trimmed.trim_start_matches("- ").trim_end_matches(':').trim().to_string();
            if !name.is_empty() && !name.contains(' ') {
                items.push(SkillItem {
                    id: Uuid::new_v4().to_string(),
                    name,
                    description: "Agent".into(),
                    version: String::new(),
                    source_path: claude_md.to_string_lossy().into(),
                    item_type: "agent".into(),
                });
            }
        }
    }
}
