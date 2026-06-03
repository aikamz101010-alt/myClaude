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
