/// Tauri command handlers — thin wrappers that forward to the C++ engine bridge.
/// All heavy lifting happens in bridge.rs (FFI to C++ audio engine).

use tauri::AppHandle;
use serde::{Deserialize, Serialize};

// ── Shared types (mirror @ace/types on the Rust side) ────────
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub sample_rates: Vec<u32>,
    pub bit_depths: Vec<u8>,
    pub channels: Vec<u8>,
    pub is_exclusive: bool,
    pub supports_dop: bool,
    pub supports_native_dsd: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DspStatePayload {
    pub eq_enabled: bool,
    pub preamp_db: f64,
    pub bands: serde_json::Value,
    pub crossfeed_enabled: bool,
    pub crossfeed_level: f64,
    pub surround_enabled: bool,
    pub dither_enabled: bool,
    pub dither_type: String,
    pub noise_shaping_profile: String,
    pub compressor_enabled: bool,
    pub stereo_width_enabled: bool,
    pub stereo_width: f64,
    pub replay_gain_mode: String,
    pub replay_gain_preamp_db: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileAnalysisResult {
    pub track_id: String,
    pub analyzed_at: u64,
    pub declared_bit_depth: u8,
    pub effective_bit_depth: u8,
    pub is_fake_bit_depth: bool,
    pub lsb_histogram: Vec<u32>,
    pub is_lossy_transcode: bool,
    pub lossy_confidence: u8,
    pub frequency_cutoff_hz: Option<f64>,
    pub sbr: bool,
    pub verdict: String,
    pub verdict_explanation: String,
    pub dr_value: f64,
    pub lufs_integrated: f64,
    pub lufs_range: f64,
    pub true_peak_db: f64,
    pub crest_factor_db: f64,
    pub container: String,
    pub chunks: serde_json::Value,
}

// ── Commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn ace_engine_init(_app: AppHandle) -> Result<(), String> {
    crate::bridge::engine_init().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_engine_destroy(_app: AppHandle) -> Result<(), String> {
    crate::bridge::engine_destroy().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_open_file(_app: AppHandle, file_path: String) -> Result<(), String> {
    crate::bridge::open_file(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_open_track(_app: AppHandle, track_id: String) -> Result<(), String> {
    crate::bridge::open_track(&track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_play(_app: AppHandle) -> Result<(), String> {
    crate::bridge::play().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_pause(_app: AppHandle) -> Result<(), String> {
    crate::bridge::pause().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_stop(_app: AppHandle) -> Result<(), String> {
    crate::bridge::stop().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_seek(_app: AppHandle, position_ms: u64) -> Result<(), String> {
    crate::bridge::seek(position_ms).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_set_volume(_app: AppHandle, volume: f64) -> Result<(), String> {
    crate::bridge::set_volume(volume).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_list_devices(_app: AppHandle) -> Result<Vec<AudioDeviceInfo>, String> {
    crate::bridge::list_devices().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_set_output_device(_app: AppHandle, device_id: String) -> Result<(), String> {
    crate::bridge::set_output_device(&device_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_set_dsp_state(_app: AppHandle, state: DspStatePayload) -> Result<(), String> {
    crate::bridge::set_dsp_state(state).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_analyze_file(app: AppHandle, file_path: String) -> Result<FileAnalysisResult, String> {
    crate::bridge::analyze_file(&app, &file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ace_generate_spectrogram(
    _app: AppHandle,
    file_path: String,
    channel_index: u32,
) -> Result<Vec<f32>, String> {
    crate::bridge::generate_spectrogram(&file_path, channel_index)
        .map_err(|e| e.to_string())
}
