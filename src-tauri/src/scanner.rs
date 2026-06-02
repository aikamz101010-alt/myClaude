use crate::state::{AppState, SkillItem};
use dirs::home_dir;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub fn detect_claude_binary() -> Option<String> {
    // Check standard paths first
    let candidates = [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // Check nvm paths
    if let Some(home) = home_dir() {
        let nvm_base = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin/claude");
                if bin.exists() {
                    return Some(bin.to_string_lossy().into());
                }
            }
        }
        // Check npm global (non-nvm)
        let npm_global = home.join(".npm-global/bin/claude");
        if npm_global.exists() {
            return Some(npm_global.to_string_lossy().into());
        }
    }
    None
}

pub async fn scan_library(state: Arc<AppState>) {
    let mut items: Vec<SkillItem> = Vec::new();

    if let Some(home) = home_dir() {
        let plugins_cache = home.join(".claude/plugins/cache");
        scan_skill_packages(&plugins_cache, &mut items);

        let settings_path = home.join(".claude/settings.json");
        scan_mcp_plugins(&settings_path, &mut items);

        let claude_md = home.join(".claude/CLAUDE.md");
        scan_agents_from_md(&claude_md, &mut items);
    }

    *state.library.write() = items;
}

fn scan_skill_packages(base: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(packages) = std::fs::read_dir(base) else { return };
    for pkg in packages.flatten() {
        let skills_dir = pkg.path().join("skills");
        if !skills_dir.exists() { continue; }
        let Ok(skills) = std::fs::read_dir(&skills_dir) else { continue };
        for skill in skills.flatten() {
            let name = skill.file_name().to_string_lossy().to_string();
            // Try to read description from skill .md file
            let description = read_skill_description(&skill.path());
            items.push(SkillItem {
                id: Uuid::new_v4().to_string(),
                name,
                description,
                version: "latest".into(),
                source_path: skill.path().to_string_lossy().into(),
                item_type: "skill".into(),
            });
        }
    }
}

fn read_skill_description(skill_path: &PathBuf) -> String {
    // Look for a .md file in the skill directory
    if let Ok(entries) = std::fs::read_dir(skill_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    // Extract first non-empty line after "# " heading
                    for line in content.lines().skip(1) {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() && !trimmed.starts_with('#') {
                            return trimmed.chars().take(80).collect();
                        }
                    }
                }
            }
        }
    }
    String::new()
}

fn scan_mcp_plugins(settings_path: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(content) = std::fs::read_to_string(settings_path) else { return };
    let Ok(json): Result<Value, _> = serde_json::from_str(&content) else { return };
    if let Some(mcps) = json["mcpServers"].as_object() {
        for (name, _) in mcps {
            items.push(SkillItem {
                id: Uuid::new_v4().to_string(),
                name: name.clone(),
                description: format!("MCP Server: {}", name),
                version: String::new(),
                source_path: settings_path.to_string_lossy().into(),
                item_type: "mcp".into(),
            });
        }
    }
}

fn scan_agents_from_md(claude_md: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(content) = std::fs::read_to_string(claude_md) else { return };
    for line in content.lines() {
        let trimmed = line.trim();
        // Match lines like "- subagent_type: agent-name" or "- agent-name:"
        if trimmed.starts_with("- subagent_type:") {
            let name = trimmed.replace("- subagent_type:", "").trim().to_string();
            if !name.is_empty() {
                items.push(SkillItem {
                    id: Uuid::new_v4().to_string(),
                    name,
                    description: "Agent from CLAUDE.md".into(),
                    version: String::new(),
                    source_path: claude_md.to_string_lossy().into(),
                    item_type: "agent".into(),
                });
            }
        }
    }
}
