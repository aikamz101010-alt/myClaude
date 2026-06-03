//! Cross-platform helpers for locating executables (claude, node …).
//! Keeps macOS working while adding Windows (and Linux) support.

use std::path::Path;

/// Candidate file names for a binary on the current platform.
/// On Windows, npm-installed CLIs are usually `<name>.cmd`; also try `.exe`/`.bat`.
#[cfg(windows)]
pub fn binary_names(name: &str) -> Vec<String> {
    vec![
        format!("{name}.cmd"),
        format!("{name}.exe"),
        format!("{name}.bat"),
        name.to_string(),
    ]
}

#[cfg(not(windows))]
pub fn binary_names(name: &str) -> Vec<String> {
    vec![name.to_string()]
}

/// Search the PATH environment variable for an executable (cross-platform `which`).
pub fn which(name: &str) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    let names = binary_names(name);
    for dir in std::env::split_paths(&path_var) {
        for candidate in &names {
            let full = dir.join(candidate);
            if full.is_file() {
                return Some(full.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Well-known fallback install locations, checked when PATH lookup fails
/// (e.g. when the app is launched from Finder/Explorer with a minimal PATH).
pub fn fallback_binary(name: &str) -> Option<String> {
    let home = dirs::home_dir();

    #[cfg(target_os = "macos")]
    for base in &["/opt/homebrew/bin", "/usr/local/bin"] {
        let p = Path::new(base).join(name);
        if p.exists() {
            return Some(p.to_string_lossy().into());
        }
    }

    #[cfg(target_os = "linux")]
    for base in &["/usr/local/bin", "/usr/bin"] {
        let p = Path::new(base).join(name);
        if p.exists() {
            return Some(p.to_string_lossy().into());
        }
    }

    // nvm (unix): ~/.nvm/versions/node/<version>/bin/<name>, newest first.
    #[cfg(unix)]
    if let Some(home) = &home {
        if let Some(p) = newest_versioned(&home.join(".nvm/versions/node"), &format!("bin/{name}")) {
            return Some(p);
        }
        for suffix in &[format!(".npm-global/bin/{name}"), format!(".local/bin/{name}")] {
            let p = home.join(suffix);
            if p.exists() {
                return Some(p.to_string_lossy().into());
            }
        }
    }

    // Windows: npm global (%APPDATA%\npm), nvm-windows symlink, Program Files\nodejs.
    #[cfg(windows)]
    for candidate in binary_names(name) {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let p = Path::new(&appdata).join("npm").join(&candidate);
            if p.is_file() {
                return Some(p.to_string_lossy().into());
            }
        }
        if let Some(nvm_sym) = std::env::var_os("NVM_SYMLINK") {
            let p = Path::new(&nvm_sym).join(&candidate);
            if p.is_file() {
                return Some(p.to_string_lossy().into());
            }
        }
        for base in &["ProgramFiles", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(base) {
                let p = Path::new(&pf).join("nodejs").join(&candidate);
                if p.is_file() {
                    return Some(p.to_string_lossy().into());
                }
            }
        }
    }

    let _ = &home; // silence unused warning on some cfg combinations
    None
}

/// Run `<path> -v` and parse the (major, minor) version. None if it can't run.
pub fn node_version(path: &str) -> Option<(u32, u32)> {
    let out = std::process::Command::new(path).arg("-v").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let s = s.trim().trim_start_matches('v');
    let mut it = s.split('.');
    let major: u32 = it.next()?.parse().ok()?;
    let minor: u32 = it.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some((major, minor))
}

/// Gather all candidate `node` binary paths across PATH and well-known install
/// locations (nvm newest-first, Homebrew, system). Used to pick the best version
/// when launched from Finder/Explorer with a minimal PATH.
pub fn node_candidates() -> Vec<String> {
    let mut c: Vec<String> = Vec::new();

    if let Some(p) = which("node") {
        c.push(p);
    }

    // nvm (unix): every installed version, newest first.
    #[cfg(unix)]
    if let Some(home) = dirs::home_dir() {
        let base = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&base) {
            let mut dirs: Vec<_> = entries.flatten().collect();
            dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            for e in dirs {
                let bin = e.path().join("bin/node");
                if bin.exists() {
                    c.push(bin.to_string_lossy().into());
                }
            }
        }
        for suffix in &[".npm-global/bin/node", ".local/bin/node"] {
            let p = home.join(suffix);
            if p.exists() {
                c.push(p.to_string_lossy().into());
            }
        }
    }

    #[cfg(target_os = "macos")]
    for base in &["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if Path::new(base).exists() {
            c.push(base.to_string());
        }
    }

    #[cfg(target_os = "linux")]
    for base in &["/usr/local/bin/node", "/usr/bin/node"] {
        if Path::new(base).exists() {
            c.push(base.to_string());
        }
    }

    #[cfg(windows)]
    for name in binary_names("node") {
        if let Some(nvm_sym) = std::env::var_os("NVM_SYMLINK") {
            let p = Path::new(&nvm_sym).join(&name);
            if p.is_file() {
                c.push(p.to_string_lossy().into());
            }
        }
        for base in &["ProgramFiles", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(base) {
                let p = Path::new(&pf).join("nodejs").join(&name);
                if p.is_file() {
                    c.push(p.to_string_lossy().into());
                }
            }
        }
    }

    c.dedup();
    c
}

#[cfg(unix)]
fn newest_versioned(base: &Path, rel: &str) -> Option<String> {
    let entries = std::fs::read_dir(base).ok()?;
    let mut paths: Vec<_> = entries.flatten().collect();
    paths.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    for entry in paths {
        let bin = entry.path().join(rel);
        if bin.exists() {
            return Some(bin.to_string_lossy().into());
        }
    }
    None
}
