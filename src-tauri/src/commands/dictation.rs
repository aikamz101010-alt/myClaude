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
    stream: Mutex<Option<StreamSession>>,
    ctx: Mutex<Option<Arc<WhisperContext>>>,
}

struct Recording {
    stop: Arc<AtomicBool>,
    done: Arc<(Mutex<bool>, Condvar)>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    handle: Option<JoinHandle<()>>,
}

/// A live (streaming) dictation session: a capture thread feeding the sample
/// buffer plus a processor thread that segments speech on silence, emits partial
/// transcripts (`dictation:partial`) and an auto-submit signal (`dictation:autosubmit`).
struct StreamSession {
    cap: Recording,
    processor: Option<JoinHandle<()>>,
    proc_stop: Arc<AtomicBool>,
    result: Arc<Mutex<String>>,
}

impl Dictation {
    pub fn new() -> Self {
        Self { recording: Mutex::new(None), stream: Mutex::new(None), ctx: Mutex::new(None) }
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

/// Load (and cache) the Whisper model. Returns `model_missing` if not downloaded.
fn ensure_ctx(app: &AppHandle, state: &Dictation) -> Result<Arc<WhisperContext>, String> {
    let mut ctx_guard = state.ctx.lock().unwrap();
    if ctx_guard.is_none() {
        let path = model_path(app)?;
        if !path.exists() {
            return Err("model_missing".into());
        }
        let c = WhisperContext::new_with_params(
            &path,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("failed to load model: {e}"))?;
        *ctx_guard = Some(Arc::new(c));
    }
    Ok(ctx_guard.as_ref().unwrap().clone())
}

/// Strip the non-speech markers Whisper emits on silence/noise — e.g.
/// `[BLANK_AUDIO]`, `(music)`, `[ Suara mesin ]` — and collapse whitespace.
fn clean_transcript(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let (mut sq, mut rd) = (0i32, 0i32);
    for ch in s.chars() {
        match ch {
            '[' => sq += 1,
            ']' => sq = (sq - 1).max(0),
            '(' => rd += 1,
            ')' => rd = (rd - 1).max(0),
            _ if sq > 0 || rd > 0 => {}
            _ => out.push(ch),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
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
    let ctx = ensure_ctx(&app, &state)?;

    let lang = lang.unwrap_or_else(|| "auto".to_string());
    // Whisper inference is CPU-heavy — run off the async runtime.
    let text = tokio::task::spawn_blocking(move || transcribe(&ctx, &audio, &lang))
        .await
        .map_err(|e| format!("transcription task failed: {e}"))??;

    Ok(text)
}

// ── Live (streaming) dictation ────────────────────────────────────────────────

/// Start a live dictation session. As the user speaks, the backend emits
/// `dictation:partial` (`{ text }`) with the running transcript, and after a long
/// pause emits `dictation:autosubmit` (`{ text }`) so the UI can submit hands-free.
#[tauri::command]
pub async fn dictation_start_stream(
    app: AppHandle,
    state: State<'_, Arc<Dictation>>,
    lang: Option<String>,
) -> Result<(), String> {
    if state.stream.lock().unwrap().is_some() {
        return Ok(()); // already streaming
    }
    if state.recording.lock().unwrap().is_some() {
        return Err("busy".into()); // a push-to-talk recording is active
    }

    let lang = lang.unwrap_or_else(|| "auto".to_string());

    // Load the model up front (CPU/IO heavy) before opening the mic.
    let ctx = {
        let st = state.inner().clone();
        let app2 = app.clone();
        tokio::task::spawn_blocking(move || ensure_ctx(&app2, &st))
            .await
            .map_err(|e| format!("ctx task failed: {e}"))??
    };

    let cap = start_capture()?;
    let samples = cap.samples.clone();
    let sample_rate = cap.sample_rate;
    let proc_stop = Arc::new(AtomicBool::new(false));
    let result = Arc::new(Mutex::new(String::new()));

    let processor = {
        let app = app.clone();
        let stop = proc_stop.clone();
        let result = result.clone();
        std::thread::spawn(move || {
            run_processor(app, ctx, samples, sample_rate, lang, stop, result)
        })
    };

    *state.stream.lock().unwrap() =
        Some(StreamSession { cap, processor: Some(processor), proc_stop, result });
    Ok(())
}

/// Stop a live dictation session and return the final accumulated transcript.
#[tauri::command]
pub async fn dictation_stop_stream(state: State<'_, Arc<Dictation>>) -> Result<String, String> {
    let sess = state.stream.lock().unwrap().take();
    let Some(mut sess) = sess else {
        return Ok(String::new());
    };

    // Stop capture first so the sample buffer is final…
    sess.cap.stop.store(true, Ordering::Relaxed);
    {
        let (lock, cv) = &*sess.cap.done;
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
    if let Some(h) = sess.cap.handle.take() {
        let _ = h.join();
    }

    // …then let the processor flush the trailing phrase and exit.
    sess.proc_stop.store(true, Ordering::Relaxed);
    if let Some(h) = sess.processor.take() {
        let _ = tokio::task::spawn_blocking(move || h.join()).await;
    }

    let text = sess.result.lock().unwrap().clone();
    Ok(text)
}

/// Processor loop: segments the live mic buffer on silence, transcribing each
/// phrase as the user pauses (live preview + committed text), and signals
/// auto-submit after a sustained pause.
#[allow(clippy::too_many_arguments)]
fn run_processor(
    app: AppHandle,
    ctx: Arc<WhisperContext>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    lang: String,
    stop: Arc<AtomicBool>,
    result: Arc<Mutex<String>>,
) {
    let sr = sample_rate as f32;
    let frame = ((sr * 0.03) as usize).max(1); // 30ms VAD window
    let commit_silence = (sr * 0.7) as usize; // pause that ends a phrase
    let autosubmit_silence = (sr * 3.0) as usize; // pause that triggers submit
    let min_phrase = (sr * 0.4) as usize; // ignore blips shorter than this
    let max_phrase = (sr * 25.0) as usize; // force-commit very long phrases
    let preview_grow = (sr * 1.2) as usize; // re-preview cadence

    let mut scan_pos = 0usize;
    let mut last_voice = 0usize;
    let mut phrase_start = 0usize;
    let mut any_voice = false;
    let mut noise_floor = 0.01f32;
    let mut committed = String::new();
    let mut last_preview_at = 0usize;
    let mut submitted = false;

    let emit = |text: &str, result: &Arc<Mutex<String>>| {
        *result.lock().unwrap() = text.to_string();
        let _ = app.emit("dictation:partial", serde_json::json!({ "text": text }));
    };

    loop {
        let stopping = stop.load(Ordering::Relaxed);
        let total = samples.lock().unwrap().len();

        // ── Voice-activity scan over fresh 30ms frames ──
        {
            let buf = samples.lock().unwrap();
            while scan_pos + frame <= buf.len() {
                let w = &buf[scan_pos..scan_pos + frame];
                let rms = (w.iter().map(|x| x * x).sum::<f32>() / frame as f32).sqrt();
                let threshold = (noise_floor * 2.5).max(0.012);
                if rms > threshold {
                    last_voice = scan_pos + frame;
                    any_voice = true;
                } else {
                    noise_floor = noise_floor * 0.97 + rms * 0.03;
                }
                scan_pos += frame;
            }
        }

        if !submitted {
            let silence_run = total.saturating_sub(last_voice);
            let phrase_voiced = last_voice > phrase_start;
            let active_len = total.saturating_sub(phrase_start);
            let force_commit = stopping || active_len >= max_phrase;

            if phrase_voiced && active_len >= min_phrase && (silence_run >= commit_silence || force_commit) {
                // Commit the finished phrase.
                let end = (last_voice + frame * 6).min(total).max(phrase_start);
                let slice = { samples.lock().unwrap()[phrase_start..end].to_vec() };
                let audio = resample_to_16k(&slice, sample_rate);
                if let Ok(t) = transcribe(&ctx, &audio, &lang) {
                    let t = clean_transcript(&t);
                    if !t.is_empty() {
                        if !committed.is_empty() {
                            committed.push(' ');
                        }
                        committed.push_str(&t);
                        emit(&committed, &result);
                    }
                }
                phrase_start = total;
                last_preview_at = total;
            } else if phrase_voiced
                && active_len >= min_phrase
                && silence_run < commit_silence
                && total.saturating_sub(last_preview_at) >= preview_grow
                && !stopping
            {
                // Live preview of the in-progress phrase (not yet committed).
                let slice = { samples.lock().unwrap()[phrase_start..total].to_vec() };
                let audio = resample_to_16k(&slice, sample_rate);
                if let Ok(t) = transcribe(&ctx, &audio, &lang) {
                    let t = clean_transcript(&t);
                    let mut shown = committed.clone();
                    if !t.is_empty() {
                        if !shown.is_empty() {
                            shown.push(' ');
                        }
                        shown.push_str(&t);
                    }
                    if !shown.is_empty() {
                        emit(&shown, &result);
                    }
                }
                last_preview_at = total;
            }

            if any_voice && silence_run >= autosubmit_silence {
                submitted = true;
                let _ = app.emit("dictation:autosubmit", serde_json::json!({ "text": committed }));
            }
        }

        if stopping {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(180));
    }
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
    // whisper-rs 0.16: `full_n_segments` returns `c_int` directly, and segment
    // text is read via `get_segment(i).to_str()` (the old `full_get_segment_text`
    // accessor was removed).
    let n = st.full_n_segments();
    let mut text = String::new();
    for i in 0..n {
        if let Some(seg) = st.get_segment(i) {
            if let Ok(s) = seg.to_str() {
                text.push_str(s);
            }
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
