//! Text-to-speech for the talking VRM avatar.
//!
//! Uses the built-in macOS `say` command (offline, free, no API key) to render
//! the assistant's reply to a WAV file, then returns it base64-encoded so the
//! frontend can decode it via the Web Audio API and drive VRM lip-sync.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Synthesize `text` to speech and return base64-encoded WAV (PCM 16-bit @ 22.05kHz).
///
/// - `voice`: optional macOS voice name (e.g. "Samantha", "Daniel"). `say -v '?'` lists them.
/// - `rate`: optional words-per-minute (default ~175).
#[tauri::command]
pub async fn synthesize_speech(
    text: String,
    voice: Option<String>,
    rate: Option<u32>,
) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty text".into());
    }
    synth_impl(text, voice, rate).await
}

#[cfg(target_os = "macos")]
async fn synth_impl(
    text: String,
    voice: Option<String>,
    rate: Option<u32>,
) -> Result<String, String> {
    use tokio::process::Command;

    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let mut path = std::env::temp_dir();
    path.push(format!("claudex_tts_{}_{}.wav", pid, id));

    let mut cmd = Command::new("say");
    cmd.arg("-o")
        .arg(&path)
        .arg("--file-format=WAVE")
        .arg("--data-format=LEI16@22050");
    if let Some(v) = voice.as_deref() {
        if !v.is_empty() {
            cmd.arg("-v").arg(v);
        }
    }
    if let Some(r) = rate {
        cmd.arg("-r").arg(r.to_string());
    }
    cmd.arg(prosody_markup(&text));

    let status = cmd
        .status()
        .await
        .map_err(|e| format!("failed to run `say`: {e}"))?;
    if !status.success() {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(format!("`say` exited with status {status}"));
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("failed to read synthesized audio: {e}"))?;
    let _ = tokio::fs::remove_file(&path).await;

    Ok(STANDARD.encode(&bytes))
}

#[cfg(not(target_os = "macos"))]
async fn synth_impl(
    _text: String,
    _voice: Option<String>,
    _rate: Option<u32>,
) -> Result<String, String> {
    Err("Voice synthesis is currently only supported on macOS".into())
}

/// Add `say` speech-command markup for less robotic delivery:
/// - `[[pmod N]]` raises pitch modulation (reduces the flat/monotone tone)
/// - `[[slnc ms]]` inserts clear pauses at sentence- and clause-boundaries so
///   periods and commas are read with natural breaks.
#[cfg(target_os = "macos")]
fn prosody_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 64);
    out.push_str("[[pmod 65]] ");
    for ch in text.chars() {
        out.push(ch);
        match ch {
            '.' | '!' | '?' | '…' => out.push_str(" [[slnc 320]] "),
            ',' | ';' | ':' => out.push_str(" [[slnc 150]] "),
            _ => {}
        }
    }
    out
}

/// List the macOS TTS voices available on this machine.
/// Returns lines of the form "Name  lang  # sample text" from `say -v '?'`.
#[tauri::command]
pub async fn list_voices() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use tokio::process::Command;
        let out = Command::new("say")
            .arg("-v")
            .arg("?")
            .output()
            .await
            .map_err(|e| format!("failed to run `say -v '?'`: {e}"))?;
        if !out.status.success() {
            return Err("`say -v '?'` failed".into());
        }
        let text = String::from_utf8_lossy(&out.stdout);
        Ok(text.lines().map(|l| l.to_string()).collect())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

/// Realistic neural TTS via Microsoft Edge's free read-aloud service.
/// No API key required (uses a public token); needs an internet connection.
/// Works on all platforms. Returns base64-encoded MP3.
///
/// `voice`: an Edge voice short-name. Defaults to `id-ID-GadisNeural` (female,
/// Bahasa Indonesia). Male alternative: `id-ID-ArdiNeural`.
/// `rate`: speaking-rate percent offset (-100..100, 0 = normal).
#[tauri::command]
pub async fn synthesize_edge(
    text: String,
    voice: Option<String>,
    rate: Option<i32>,
) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty text".into());
    }
    let voice = voice
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "id-ID-GadisNeural".to_string());
    let rate = rate.unwrap_or(0).clamp(-100, 100);

    tokio::task::spawn_blocking(move || edge_synth(&text, &voice, rate))
        .await
        .map_err(|e| format!("edge tts task failed: {e}"))?
}

fn edge_synth(text: &str, voice: &str, rate: i32) -> Result<String, String> {
    use msedge_tts::tts::client::connect;
    use msedge_tts::tts::SpeechConfig;

    let config = SpeechConfig {
        voice_name: voice.to_string(),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".to_string(),
        pitch: 0,
        rate,
        volume: 0,
    };
    let mut client =
        connect().map_err(|e| format!("Edge TTS connect failed (offline?): {e}"))?;
    let audio = client
        .synthesize(text, &config)
        .map_err(|e| format!("Edge TTS synthesis failed: {e}"))?;
    Ok(STANDARD.encode(&audio.audio_bytes))
}

// ── Piper TTS (offline neural, Bahasa Indonesia) ────────────────────────────────
//
// Piper (rhasspy/piper) is a fast, fully-offline neural TTS. Unlike `say` (macOS
// only, robotic) and Edge (needs internet), it runs a small ONNX model locally and
// sounds natural. The self-contained binary tarball + the Indonesian voice model
// (`id_ID-news_tts-medium`) are downloaded once into the app data dir on first use,
// mirroring the Whisper dictation-model flow — so the build/CI pipeline is untouched.

/// Piper release used. The macOS binary tarball ships the executable + `espeak-ng-data`
/// but NOT its shared libraries — those come from the matching `piper-phonemize`
/// release (libespeak-ng / libpiper_phonemize / libonnxruntime), which we download
/// alongside and put on the dynamic-loader path.
const PIPER_RELEASE: &str = "2023.11.14-2";
const PIPER_PHONEMIZE_RELEASE: &str = "2023.11.14-4";
/// Indonesian voice model (rhasspy/piper-voices, MIT).
const PIPER_MODEL_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx?download=true";
const PIPER_MODEL_CFG_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json?download=true";
const PIPER_MODEL_FILE: &str = "id_ID-news_tts-medium.onnx";

#[derive(Serialize)]
pub struct PiperStatus {
    binary_present: bool,
    model_present: bool,
}

fn piper_base(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("piper"))
}

/// Extracted binary location. The tarball unpacks to a top-level `piper/` folder,
/// so the executable ends up at `<base>/piper/piper`.
fn piper_bin(base: &std::path::Path) -> std::path::PathBuf {
    base.join("piper").join("piper")
}
fn piper_libdir(base: &std::path::Path) -> std::path::PathBuf {
    base.join("piper")
}
/// Shared libraries (from the piper-phonemize release) the binary links against.
fn piper_phonemize_libdir(base: &std::path::Path) -> std::path::PathBuf {
    base.join("piper-phonemize").join("lib")
}
fn piper_espeak_data(base: &std::path::Path) -> std::path::PathBuf {
    base.join("piper").join("espeak-ng-data")
}
fn piper_model(base: &std::path::Path) -> std::path::PathBuf {
    base.join(PIPER_MODEL_FILE)
}
/// The dynamic loader search path the binary needs (phonemize libs + its own dir).
fn piper_dyld_path(base: &std::path::Path) -> String {
    format!(
        "{}:{}",
        piper_phonemize_libdir(base).display(),
        piper_libdir(base).display()
    )
}
/// A representative shared library — present only after piper-phonemize extracts.
fn piper_phonemize_marker(base: &std::path::Path) -> std::path::PathBuf {
    piper_phonemize_libdir(base).join("libpiper_phonemize.1.dylib")
}

/// Piper binary release asset for the current platform/arch.
fn piper_asset() -> Result<&'static str, String> {
    #[cfg(target_os = "macos")]
    {
        if cfg!(target_arch = "aarch64") {
            Ok("piper_macos_aarch64.tar.gz")
        } else {
            Ok("piper_macos_x64.tar.gz")
        }
    }
    #[cfg(target_os = "linux")]
    {
        Ok("piper_linux_x86_64.tar.gz")
    }
    #[cfg(target_os = "windows")]
    {
        Ok("piper_windows_amd64.zip")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Piper is not supported on this platform".into())
    }
}

/// piper-phonemize (shared-library) release asset for the current platform/arch.
fn piper_phonemize_asset() -> Result<&'static str, String> {
    #[cfg(target_os = "macos")]
    {
        if cfg!(target_arch = "aarch64") {
            Ok("piper-phonemize_macos_aarch64.tar.gz")
        } else {
            Ok("piper-phonemize_macos_x64.tar.gz")
        }
    }
    #[cfg(target_os = "linux")]
    {
        Ok("piper-phonemize_linux_x86_64.tar.gz")
    }
    #[cfg(target_os = "windows")]
    {
        Ok("piper-phonemize_windows_amd64.zip")
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Piper is not supported on this platform".into())
    }
}

#[tauri::command]
pub async fn piper_status(app: AppHandle) -> Result<PiperStatus, String> {
    let base = piper_base(&app)?;
    Ok(PiperStatus {
        binary_present: piper_bin(&base).is_file() && piper_phonemize_marker(&base).is_file(),
        model_present: piper_model(&base).is_file(),
    })
}

/// Download a URL to `dest`, emitting `piper:download` progress for `stage`.
async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &std::path::Path,
    stage: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create file: {e}"))?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("write: {e}"))?;
        received += chunk.len() as u64;
        if received - last_emit >= 1_048_576 || received == total {
            last_emit = received;
            let percent = if total > 0 { (received as f64 / total as f64 * 100.0) as u32 } else { 0 };
            let _ = app.emit(
                "piper:download",
                serde_json::json!({ "stage": stage, "received": received, "total": total, "percent": percent }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| format!("finalize: {e}"))?;
    Ok(())
}

/// Extract a `.tar.gz` into `dest`. macOS/Linux ship `tar`; Windows 10+ ships
/// `tar.exe`, so a single shell-out covers every target.
async fn extract_tar_gz(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let status = tokio::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .status()
        .await
        .map_err(|e| format!("failed to run tar: {e}"))?;
    if !status.success() {
        return Err(format!("tar extraction failed ({status})"));
    }
    Ok(())
}

/// Download + install the Piper binary and the Indonesian voice model (idempotent).
#[tauri::command]
pub async fn piper_download(app: AppHandle) -> Result<(), String> {
    let base = piper_base(&app)?;
    std::fs::create_dir_all(&base).map_err(|e| format!("mkdir: {e}"))?;

    // 1) Binary (ships the executable + espeak-ng-data; skip if already extracted).
    if !piper_bin(&base).is_file() {
        let asset = piper_asset()?;
        let url = format!(
            "https://github.com/rhasspy/piper/releases/download/{PIPER_RELEASE}/{asset}"
        );
        let archive = base.join(asset);
        download_with_progress(&app, &url, &archive, "binary").await?;
        extract_tar_gz(&archive, &base).await?;
        let _ = std::fs::remove_file(&archive);
        if !piper_bin(&base).is_file() {
            return Err("piper binary not found after extraction".into());
        }
    }

    // 2) Shared libraries (piper-phonemize) — the macOS binary tarball omits them.
    if !piper_phonemize_marker(&base).is_file() {
        let asset = piper_phonemize_asset()?;
        let url = format!(
            "https://github.com/rhasspy/piper-phonemize/releases/download/{PIPER_PHONEMIZE_RELEASE}/{asset}"
        );
        let archive = base.join(asset);
        download_with_progress(&app, &url, &archive, "libs").await?;
        extract_tar_gz(&archive, &base).await?;
        let _ = std::fs::remove_file(&archive);
        if !piper_phonemize_marker(&base).is_file() {
            return Err("piper shared libraries not found after extraction".into());
        }
    }

    // Make the binary executable + clear macOS quarantine so Gatekeeper allows the
    // downloaded binary and dylibs to run.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(piper_bin(&base)) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = std::fs::set_permissions(piper_bin(&base), perm);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = tokio::process::Command::new("xattr")
            .arg("-dr")
            .arg("com.apple.quarantine")
            .arg(&base)
            .status()
            .await;
    }

    // 3) Voice model + config.
    let model = piper_model(&base);
    if !model.is_file() {
        download_with_progress(&app, PIPER_MODEL_URL, &model, "model").await?;
    }
    let cfg = base.join(format!("{PIPER_MODEL_FILE}.json"));
    if !cfg.is_file() {
        download_with_progress(&app, PIPER_MODEL_CFG_URL, &cfg, "config").await?;
    }
    Ok(())
}

/// Synthesize `text` with Piper (offline neural, Bahasa Indonesia) → base64 WAV
/// (PCM 16-bit @ 22.05kHz — same format as `say`, so VRM lip-sync works unchanged).
///
/// `rate`: optional words-per-minute (default ~175). Mapped to Piper's
/// `--length_scale` (lower = faster).
#[tauri::command]
pub async fn synthesize_piper(
    app: AppHandle,
    text: String,
    rate: Option<u32>,
) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("empty text".into());
    }
    let base = piper_base(&app)?;
    let bin = piper_bin(&base);
    let model = piper_model(&base);
    if !bin.is_file() || !model.is_file() {
        return Err("piper_missing".into());
    }

    tokio::task::spawn_blocking(move || piper_synth(&base, &bin, &model, &text, rate))
        .await
        .map_err(|e| format!("piper task failed: {e}"))?
}

fn piper_synth(
    base: &std::path::Path,
    bin: &std::path::Path,
    model: &std::path::Path,
    text: &str,
    rate: Option<u32>,
) -> Result<String, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let id = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let mut out = std::env::temp_dir();
    out.push(format!("claudex_piper_{}_{}.wav", pid, id));

    // wpm → length_scale: 175 wpm ≈ 1.0; faster speech = smaller scale.
    let length_scale = (175.0 / rate.unwrap_or(175).max(60) as f32).clamp(0.5, 2.0);

    let mut cmd = Command::new(bin);
    cmd.arg("--model")
        .arg(model)
        .arg("--espeak_data")
        .arg(piper_espeak_data(base))
        .arg("--length_scale")
        .arg(format!("{length_scale:.3}"))
        .arg("--output_file")
        .arg(&out)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    // The shared libraries (from piper-phonemize) plus the binary's own dir must be
    // on the dynamic-loader path so it can resolve libespeak-ng / libpiper_phonemize
    // / libonnxruntime.
    let dyld = piper_dyld_path(base);
    cmd.env("DYLD_LIBRARY_PATH", &dyld);
    cmd.env("LD_LIBRARY_PATH", &dyld);

    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn piper: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("write to piper stdin: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("piper wait failed: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&out);
        return Err(format!(
            "piper exited with {} — {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let bytes = std::fs::read(&out).map_err(|e| format!("read piper output: {e}"))?;
    let _ = std::fs::remove_file(&out);
    Ok(STANDARD.encode(&bytes))
}
