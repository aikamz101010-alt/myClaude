use crate::state::{AppState, SkillItem};
use dirs::home_dir;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub fn detect_claude_binary() -> Option<String> {
    // 1. `which claude` — fastest, works when launched from a terminal with PATH set
    if let Ok(out) = std::process::Command::new("which").arg("claude").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() && std::path::Path::new(&p).exists() {
                return Some(p);
            }
        }
    }

    // 2. Well-known Homebrew / system paths
    for path in &["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    // 3. NVM installs — scan all node versions (newest first)
    if let Some(home) = home_dir() {
        let nvm_base = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_base) {
            let mut paths: Vec<_> = entries.flatten().collect();
            paths.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            for entry in paths {
                let bin = entry.path().join("bin/claude");
                if bin.exists() {
                    return Some(bin.to_string_lossy().into());
                }
            }
        }
        // 4. npm global (non-nvm) and ~/.local/bin
        for suffix in &[".npm-global/bin/claude", ".local/bin/claude"] {
            let p = home.join(suffix);
            if p.exists() {
                return Some(p.to_string_lossy().into());
            }
        }
    }
    None
}

pub async fn scan_library(state: Arc<AppState>) {
    let mut items: Vec<SkillItem> = Vec::new();
    // seen_skills deduplicates by skill name — personal skills win over plugin skills
    let mut seen_skills: HashSet<String> = HashSet::new();

    if let Some(home) = home_dir() {
        let claude_dir = home.join(".claude");

        // 1. Personal skills — highest priority
        scan_skills_dir(&claude_dir.join("skills"), &mut items, &mut seen_skills, "personal");

        // 2. Installed plugins: emit one "plugin" entry per package AND scan their skills
        scan_installed_plugins(&claude_dir.join("plugins/cache"), &mut items, &mut seen_skills);

        // 3. MCP servers declared in settings files
        for f in &["settings.json", "settings.local.json"] {
            scan_mcp_servers(&claude_dir.join(f), &mut items);
        }

        // 4. Agents — each .md file is an agent definition
        scan_agents_dir(&claude_dir.join("agents"), &mut items);
    }

    *state.library.write() = items;
}

// ── Plugin packages ──────────────────────────────────────────────────────────

/// Walk ~/.claude/plugins/cache/<publisher>/<package>/<version>/
///
/// For each package (using the latest version folder):
/// - Emit one `item_type = "plugin"` entry for the package itself
/// - Scan `skills/` and `.claude/skills/` inside that version for skill entries
fn scan_installed_plugins(
    cache_dir: &PathBuf,
    items: &mut Vec<SkillItem>,
    seen_skills: &mut HashSet<String>,
) {
    let Ok(publishers) = std::fs::read_dir(cache_dir) else { return };

    for pub_entry in publishers.flatten() {
        let publisher = pub_entry.file_name().to_string_lossy().to_string();
        if publisher.starts_with('.') { continue; }

        let Ok(packages) = std::fs::read_dir(pub_entry.path()) else { continue };

        for pkg_entry in packages.flatten() {
            let pkg_name = pkg_entry.file_name().to_string_lossy().to_string();
            if pkg_name.starts_with('.') || !pkg_entry.path().is_dir() { continue; }

            // Sort version folders descending — newest first
            let Ok(vers) = std::fs::read_dir(pkg_entry.path()) else { continue };
            let mut ver_entries: Vec<_> = vers.flatten()
                .filter(|e| e.path().is_dir())
                .collect();
            ver_entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

            let Some(ver_entry) = ver_entries.first() else { continue };
            let version = ver_entry.file_name().to_string_lossy().to_string();
            let pkg_path = ver_entry.path();

            // --- Plugin entry ---
            let description = read_plugin_description(&pkg_path);
            items.push(SkillItem {
                id: Uuid::new_v4().to_string(),
                name: pkg_name.clone(),
                description,
                version: version.clone(),
                source_path: pkg_path.to_string_lossy().into(),
                item_type: "plugin".into(),
                // reuse `model` field to store publisher
                model: publisher.clone(),
            });

            // --- Skills inside this plugin ---
            // Claude CLI checks both skills/ and .claude/skills/
            let source_label = format!("{}@{}", pkg_name, version);
            for sub in &["skills", ".claude/skills"] {
                let skills_dir = pkg_path.join(sub);
                if skills_dir.is_dir() {
                    scan_skills_dir(&skills_dir, items, seen_skills, &source_label);
                }
            }
        }
    }
}

// ── Skills directory ─────────────────────────────────────────────────────────

/// Scan a `skills/` directory — each sub-directory is a skill.
fn scan_skills_dir(
    dir: &PathBuf,
    items: &mut Vec<SkillItem>,
    seen: &mut HashSet<String>,
    source_label: &str,
) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries_vec: Vec<_> = entries.flatten().collect();
    entries_vec.sort_by_key(|e| e.file_name());

    for entry in entries_vec {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.ends_with(".bak") || name.ends_with("-bak") { continue; }

        // Deduplicate: personal skills added first take priority
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
            model: String::new(),
        });
    }
}

fn read_skill_description(skill_path: &PathBuf) -> String {
    // Prefer SKILL.md, then any .md file
    let candidates = ["SKILL.md", "README.md", "skill.md", "readme.md"];
    for name in &candidates {
        let p = skill_path.join(name);
        if let Ok(content) = std::fs::read_to_string(&p) {
            for line in content.lines().skip(1) {
                let t = line.trim();
                if !t.is_empty() && !t.starts_with('#') && !t.starts_with('-') && !t.starts_with("---") {
                    return t.chars().take(100).collect();
                }
            }
        }
    }
    String::new()
}

fn read_plugin_description(pkg_path: &PathBuf) -> String {
    // 1. Try package.json description field
    if let Ok(content) = std::fs::read_to_string(pkg_path.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            if let Some(desc) = json["description"].as_str() {
                if !desc.is_empty() {
                    return desc.chars().take(100).collect();
                }
            }
        }
    }
    // 2. First non-empty, non-heading line from README.md
    for name in &["README.md", "readme.md"] {
        if let Ok(content) = std::fs::read_to_string(pkg_path.join(name)) {
            for line in content.lines().skip(1) {
                let t = line.trim();
                if !t.is_empty() && !t.starts_with('#') && !t.starts_with('-') && !t.starts_with("---") {
                    return t.chars().take(100).collect();
                }
            }
        }
    }
    String::new()
}

// ── MCP servers ──────────────────────────────────────────────────────────────

fn scan_mcp_servers(settings_path: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(content) = std::fs::read_to_string(settings_path) else { return };
    let Ok(json): Result<Value, _> = serde_json::from_str(&content) else { return };
    let Some(mcps) = json["mcpServers"].as_object() else { return };

    for (name, val) in mcps {
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
            model: String::new(),
        });
    }
}

// ── Agents ───────────────────────────────────────────────────────────────────

fn scan_agents_dir(dir: &PathBuf, items: &mut Vec<SkillItem>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries.flatten().collect();
    files.sort_by_key(|e| e.file_name());

    for entry in files {
        let path = entry.path();
        if path.extension().map_or(true, |e| e != "md") { continue; }

        let raw_name = path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if raw_name.is_empty() { continue; }

        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let (description, model) = parse_agent_frontmatter(&content);

        items.push(SkillItem {
            id: Uuid::new_v4().to_string(),
            name: raw_name,
            description,
            version: String::new(),
            source_path: path.to_string_lossy().into(),
            item_type: "agent".into(),
            model,
        });
    }
}

fn parse_agent_frontmatter(content: &str) -> (String, String) {
    let mut description = String::new();
    let mut model = String::new();
    let mut in_frontmatter = false;
    let mut found_start = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if !found_start { found_start = true; in_frontmatter = true; continue; }
            else { break; }
        }
        if in_frontmatter {
            if let Some(val) = trimmed.strip_prefix("description:") {
                description = val.trim().trim_matches('"').to_string();
            } else if let Some(val) = trimmed.strip_prefix("model:") {
                model = val.trim().trim_matches('"').to_string();
            }
        }
    }

    // Fallback: first non-empty non-heading line after frontmatter
    if description.is_empty() {
        let mut past_front = !found_start;
        for line in content.lines() {
            if line.trim() == "---" { past_front = !past_front; continue; }
            if !past_front { continue; }
            let t = line.trim();
            if !t.is_empty() && !t.starts_with('#') && !t.starts_with('-') {
                description = t.chars().take(100).collect();
                break;
            }
        }
    }

    (description, model)
}
