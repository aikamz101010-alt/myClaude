//! Cross-platform speech-to-text (mic input) using whisper.cpp (offline).
//!
//! Flow (push-to-talk toggle):
//!   `dictation_start` → capture mic audio via `cpal` on a dedicated thread.
//!   `dictation_stop`  → stop capture, resample to 16kHz mono, transcribe with
//!                        `whisper-rs`, return the recognized text.
//!
//! The Whisper model (ggml) is downloaded once to the app data dir. Microphone
//! access requires OS permission (macOS: Info.plist usage description → system
//! prompt; Windows: privacy setting; Linux: PulseAudio/ALSA).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Default multilingual model (~148 MB) — good Indonesian support, reasonable speed.
const MODEL_FILE: &str = "ggml-base.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

// ── Managed state ─────────────────────────────────────────────────────────────

pub struct Dictation {
    recording: Mutex<Option<Recording>>,
    ctx: Mutex<Option<Arc<WhisperContext>>>,
}

struct Recording {
    stop: Arc<AtomicBool>,
    done: Arc<(Mutex<bool>, Condvar)>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    handle: Option<JoinHandle<()>>,
}

impl Dictation {
    pub fn new() -> Self {
        Self { recording: Mutex::new(None), ctx: Mutex::new(None) }
    }
}

#[derive(Serialize)]
pub struct ModelStatus {
    present: bool,
    path: String,
    size_mb: u64,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn model_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("models");
    Ok(dir.join(MODEL_FILE))
}

/// Simple linear resampler to 16kHz (whisper's required rate). Input is mono.
fn resample_to_16k(input: &[f32], in_rate: u32) -> Vec<f32> {
    if in_rate == 16_000 || input.is_empty() {
        return input.to_vec();
    }
    let ratio = 16_000.0 / in_rate as f32;
    let out_len = (input.len() as f32 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f32 / ratio;
        let idx = src.floor() as usize;
        let frac = src - idx as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// Build + start a mic capture stream on a dedicated thread (cpal streams are
/// not `Send`, so the stream lives entirely on its own thread).
fn start_capture() -> Result<Recording, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("no input (microphone) device found")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("no default input config: {e}"))?;
    let sample_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();

    let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let done = Arc::new((Mutex::new(false), Condvar::new()));

    let samples_t = samples.clone();
    let stop_t = stop.clone();
    let done_t = done.clone();

    let handle = std::thread::spawn(move || {
        let err_fn = |e| eprintln!("[dictation] stream error: {e}");

        // Downmix interleaved frames to mono and append.
        macro_rules! push_mono {
            ($buf:expr, $data:expr, $conv:expr) => {{
                let mut b = $buf.lock().unwrap();
                for frame in $data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|v| $conv(*v)).sum();
                    b.push(sum / channels as f32);
                }
            }};
        }

        let built = match sample_format {
            cpal::SampleFormat::F32 => {
                let buf = samples_t.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &_| push_mono!(buf, data, |v: f32| v),
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let buf = samples_t.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &_| push_mono!(buf, data, |v: i16| v as f32 / 32768.0),
                    err_fn,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let buf = samples_t.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[u16], _: &_| {
                        push_mono!(buf, data, |v: u16| (v as f32 - 32768.0) / 32768.0)
                    },
                    err_fn,
                    None,
                )
            }
            other => {
                eprintln!("[dictation] unsupported sample format: {other:?}");
                let (lock, cv) = &*done_t;
                *lock.lock().unwrap() = true;
                cv.notify_all();
                return;
            }
        };

        let stream = match built {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[dictation] failed to build stream: {e}");
                let (lock, cv) = &*done_t;
                *lock.lock().unwrap() = true;
                cv.notify_all();
                return;
            }
        };
        if let Err(e) = stream.play() {
            eprintln!("[dictation] failed to start stream: {e}");
        }

        while !stop_t.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        drop(stream); // stop & release the device on this thread

        let (lock, cv) = &*done_t;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    });

    Ok(Recording { stop, done, samples, sample_rate, handle: Some(handle) })
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn dictation_start(state: State<'_, Arc<Dictation>>) -> Result<(), String> {
    let mut guard = state.recording.lock().unwrap();
    if guard.is_some() {
        return Ok(()); // already recording
    }
    *guard = Some(start_capture()?);
    Ok(())
}

#[tauri::command]
pub async fn dictation_stop(
    app: AppHandle,
    state: State<'_, Arc<Dictation>>,
    lang: Option<String>,
) -> Result<String, String> {
    // Take the active recording out of the state.
    let rec = state.recording.lock().unwrap().take();
    let Some(mut rec) = rec else {
        return Ok(String::new()); // nothing was recording
    };

    // Signal the capture thread to stop and wait until it has released the device.
    rec.stop.store(true, Ordering::Relaxed);
    {
        let (lock, cv) = &*rec.done;
        let mut finished = lock.lock().unwrap();
        let timeout = std::time::Duration::from_secs(2);
        while !*finished {
            let (g, res) = cv.wait_timeout(finished, timeout).unwrap();
            finished = g;
            if res.timed_out() {
                break;
            }
        }
    }
    if let Some(h) = rec.handle.take() {
        let _ = h.join();
    }

    let raw = std::mem::take(&mut *rec.samples.lock().unwrap());
    if raw.len() < (rec.sample_rate as usize / 5) {
        return Ok(String::new()); // < 0.2s of audio — ignore
    }
    let audio = resample_to_16k(&raw, rec.sample_rate);

    // Ensure the model is loaded (cached across calls).
    let ctx = {
        let mut ctx_guard = state.ctx.lock().unwrap();
        if ctx_guard.is_none() {
            let path = model_path(&app)?;
            if !path.exists() {
                return Err("model_missing".into());
            }
            let c = WhisperContext::new_with_params(
                &path.to_string_lossy(),
                WhisperContextParameters::default(),
            )
            .map_err(|e| format!("failed to load model: {e}"))?;
            *ctx_guard = Some(Arc::new(c));
        }
        ctx_guard.as_ref().unwrap().clone()
    };

    let lang = lang.unwrap_or_else(|| "auto".to_string());
    // Whisper inference is CPU-heavy — run off the async runtime.
    let text = tokio::task::spawn_blocking(move || transcribe(&ctx, &audio, &lang))
        .await
        .map_err(|e| format!("transcription task failed: {e}"))??;

    Ok(text)
}

fn transcribe(ctx: &WhisperContext, audio: &[f32], lang: &str) -> Result<String, String> {
    let mut st = ctx.create_state().map_err(|e| format!("create_state: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    if lang != "auto" {
        params.set_language(Some(lang));
    }
    params.set_n_threads(num_threads());
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    st.full(params, audio).map_err(|e| format!("whisper full: {e}"))?;
    let n = st.full_n_segments().map_err(|e| format!("n_segments: {e}"))?;
    let mut text = String::new();
    for i in 0..n {
        if let Ok(seg) = st.full_get_segment_text(i) {
            text.push_str(&seg);
        }
    }
    Ok(text.trim().to_string())
}

fn num_threads() -> std::os::raw::c_int {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    n.clamp(1, 8) as std::os::raw::c_int
}

#[tauri::command]
pub async fn dictation_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let path = model_path(&app)?;
    let (present, size_mb) = match std::fs::metadata(&path) {
        Ok(m) if m.is_file() => (true, m.len() / (1024 * 1024)),
        _ => (false, 0),
    };
    Ok(ModelStatus { present, path: path.to_string_lossy().to_string(), size_mb })
}

/// Download the Whisper model to the app data dir, emitting `dictation:download`
/// progress events (`{ received, total, percent }`).
#[tauri::command]
pub async fn dictation_download_model(app: AppHandle) -> Result<(), String> {
    use std::io::Write;

    let path = model_path(&app)?;
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }

    let resp = reqwest::get(MODEL_URL)
        .await
        .map_err(|e| format!("download request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let tmp = path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create file: {e}"))?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    let mut stream = resp.bytes_stream();
    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("write: {e}"))?;
        received += chunk.len() as u64;
        // Throttle progress events to ~ every 1 MB.
        if received - last_emit >= 1_048_576 || received == total {
            last_emit = received;
            let percent = if total > 0 { (received as f64 / total as f64 * 100.0) as u32 } else { 0 };
            let _ = app.emit(
                "dictation:download",
                serde_json::json!({ "received": received, "total": total, "percent": percent }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush: {e}"))?;
    drop(file);
    std::fs::rename(&tmp, &path).map_err(|e| format!("finalize: {e}"))?;
    Ok(())
}
