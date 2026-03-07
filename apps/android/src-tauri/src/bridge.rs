/// C++ Audio Engine FFI Bridge
///
/// This module links against the compiled C++ audio engine static library
/// (`libaudiophile_engine.a` / `audiophile_engine.lib`) and exposes
/// safe Rust wrappers over the raw C FFI.
///
/// The C++ engine exposes a flat C API (extern "C") defined in
/// `packages/audio-engine/include/ace_engine.h`.
///
/// During development (before the C++ engine is compiled), all functions
/// return stub/mock values so the app boots and the UI is testable.

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use crate::commands::{AudioDeviceInfo, DspStatePayload, FileAnalysisResult};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

// ── Global app handle for emitting events from C++ callbacks ─
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) -> Result<(), BoxError> {
    APP_HANDLE.set(app).ok();
    Ok(())
}

// ── Engine lifecycle ─────────────────────────────────────────

pub fn engine_init() -> Result<(), BoxError> {
    // TODO: call ace_engine_init() from C++ via FFI
    log_stub("engine_init");
    Ok(())
}

pub fn engine_destroy() -> Result<(), BoxError> {
    log_stub("engine_destroy");
    Ok(())
}

// ── Playback ─────────────────────────────────────────────────

pub fn open_file(file_path: &str) -> Result<(), BoxError> {
    log_stub(&format!("open_file: {file_path}"));
    Ok(())
}

pub fn open_track(track_id: &str) -> Result<(), BoxError> {
    log_stub(&format!("open_track: {track_id}"));
    Ok(())
}

pub fn play() -> Result<(), BoxError> {
    log_stub("play");
    emit_event("ace://engine-status", "playing");
    Ok(())
}

pub fn pause() -> Result<(), BoxError> {
    log_stub("pause");
    emit_event("ace://engine-status", "paused");
    Ok(())
}

pub fn stop() -> Result<(), BoxError> {
    log_stub("stop");
    emit_event("ace://engine-status", "idle");
    Ok(())
}

pub fn seek(position_ms: u64) -> Result<(), BoxError> {
    log_stub(&format!("seek: {position_ms}ms"));
    Ok(())
}

pub fn set_volume(volume: f64) -> Result<(), BoxError> {
    log_stub(&format!("set_volume: {volume}"));
    Ok(())
}

// ── Devices ──────────────────────────────────────────────────

pub fn list_devices() -> Result<Vec<AudioDeviceInfo>, BoxError> {
    // TODO: enumerate real audio devices via WASAPI / CoreAudio / ALSA
    Ok(vec![AudioDeviceInfo {
        id: "default".into(),
        name: "Default Output".into(),
        r#type: "internal".into(),
        sample_rates: vec![44100, 48000, 88200, 96000, 176400, 192000],
        bit_depths: vec![16, 24, 32],
        channels: vec![2],
        is_exclusive: false,
        supports_dop: false,
        supports_native_dsd: false,
    }])
}

pub fn set_output_device(device_id: &str) -> Result<(), BoxError> {
    log_stub(&format!("set_output_device: {device_id}"));
    Ok(())
}

// ── DSP ──────────────────────────────────────────────────────

pub fn set_dsp_state(state: DspStatePayload) -> Result<(), BoxError> {
    log_stub(&format!("set_dsp_state: eq_enabled={}", state.eq_enabled));
    // TODO: serialize and pass to C++ engine
    Ok(())
}

// ── Analysis ─────────────────────────────────────────────────

pub async fn analyze_file(app: &AppHandle, file_path: &str) -> Result<FileAnalysisResult, BoxError> {
    log_stub(&format!("analyze_file: {file_path}"));

    // Emit progress event to frontend
    app.emit("ace://analysis-progress", 0u8).ok();

    // TODO: run real C++ analysis pipeline
    // For now return a stub result
    let result = FileAnalysisResult {
        track_id: "".into(),
        analyzed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        declared_bit_depth: 24,
        effective_bit_depth: 24,
        is_fake_bit_depth: false,
        lsb_histogram: vec![0; 256],
        is_lossy_transcode: false,
        lossy_confidence: 0,
        frequency_cutoff_hz: None,
        sbr: false,
        verdict: "unknown".into(),
        verdict_explanation: "Analysis not yet implemented — C++ engine pending".into(),
        dr_value: 0.0,
        lufs_integrated: 0.0,
        lufs_range: 0.0,
        true_peak_db: 0.0,
        crest_factor_db: 0.0,
        container: "unknown".into(),
        chunks: serde_json::json!([]),
    };

    app.emit("ace://analysis-progress", 100u8).ok();
    Ok(result)
}

pub fn generate_spectrogram(file_path: &str, channel_index: u32) -> Result<Vec<f32>, BoxError> {
    log_stub(&format!("generate_spectrogram: {file_path} ch={channel_index}"));
    // TODO: call C++ PFFFT-based spectrogram generator
    Ok(vec![])
}

// ── Helpers ──────────────────────────────────────────────────

fn log_stub(msg: &str) {
    eprintln!("[AceBridge][STUB] {msg}");
}

fn emit_event<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP_HANDLE.get() {
        app.emit(event, payload).ok();
    }
}
