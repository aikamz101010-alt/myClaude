//! Text-to-speech for the talking VRM avatar.
//!
//! Uses the built-in macOS `say` command (offline, free, no API key) to render
//! the assistant's reply to a WAV file, then returns it base64-encoded so the
//! frontend can decode it via the Web Audio API and drive VRM lip-sync.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::sync::atomic::{AtomicU64, Ordering};

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
