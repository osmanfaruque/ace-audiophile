/// Tauri command handlers — thin wrappers that forward to the C++ engine bridge.
/// All heavy lifting happens in bridge.rs (FFI to C++ audio engine).

use tauri::AppHandle;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

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
pub struct TrackInfo {
    pub file_path: String,
    pub codec: String,
    pub sample_rate: u32,
    pub bit_depth: u8,
    pub channels: u8,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct EqBandPayload {
    #[serde(default)]
    pub freq_hz: f32,
    #[serde(default)]
    pub gain_db: f32,
    #[serde(default = "default_q")]
    pub q: f32,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub filter_type: u8,
}

fn default_q() -> f32 { 1.0 }
fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct DspStatePayload {
    #[serde(default)]
    pub eq_enabled: bool,
    #[serde(default)]
    pub bands: Vec<EqBandPayload>,
    #[serde(default)]
    pub preamp_db: f32,
    #[serde(default)]
    pub crossfeed_enabled: bool,
    #[serde(default)]
    pub crossfeed_strength: f32,
    #[serde(default)]
    pub dither_enabled: bool,
    #[serde(default)]
    pub dither_bits: i32,
    #[serde(default)]
    pub dither_noise_shaping: bool,
    #[serde(default)]
    pub resampler_enabled: bool,
    #[serde(default)]
    pub resampler_target_hz: u32,
    #[serde(default)]
    pub spatializer_enabled: bool,
    #[serde(default)]
    pub spatializer_strength: f32,
    #[serde(default)]
    pub rg_mode: u8,
    #[serde(default)]
    pub rg_track_gain: f32,
    #[serde(default)]
    pub rg_album_gain: f32,
    #[serde(default)]
    pub rg_track_peak: f32,
    #[serde(default)]
    pub rg_album_peak: f32,
    #[serde(default)]
    pub rg_pre_amp: f32,
    #[serde(default)]
    pub rg_ceiling_db: f32,
    #[serde(default)]
    pub limiter_enabled: bool,
    #[serde(default)]
    pub limiter_ceiling_db: f32,
    #[serde(default)]
    pub limiter_release_ms: f32,
    #[serde(default)]
    pub mixer_enabled: bool,
    #[serde(default)]
    pub mixer_swap_lr: bool,
    #[serde(default)]
    pub mixer_mono: bool,
    #[serde(default)]
    pub mixer_balance: f32,
    #[serde(default)]
    pub mixer_invert_l: bool,
    #[serde(default)]
    pub mixer_invert_r: bool,
    #[serde(default)]
    pub crossfade_mode: u8,
    #[serde(default)]
    pub crossfade_duration_ms: i32,
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
pub async fn ace_engine_init(_app: AppHandle) -> Result<(), AppError> {
    crate::bridge::engine_init().map_err(|e| AppError::EngineLoad(e.to_string()))
}

#[tauri::command]
pub async fn ace_engine_destroy(_app: AppHandle) -> Result<(), AppError> {
    crate::bridge::engine_destroy().map_err(|e| AppError::EngineLoad(e.to_string()))
}

#[tauri::command]
pub async fn ace_open_file(_app: AppHandle, file_path: String) -> Result<TrackInfo, AppError> {
    crate::bridge::open_file(&file_path).map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_open_track(_app: AppHandle, track_id: String) -> Result<(), AppError> {
    crate::bridge::open_track(&track_id).map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_play(_app: AppHandle) -> Result<(), AppError> {
    crate::bridge::play().map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_pause(_app: AppHandle) -> Result<(), AppError> {
    crate::bridge::pause().map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_stop(_app: AppHandle) -> Result<(), AppError> {
    crate::bridge::stop().map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_seek(_app: AppHandle, position_ms: u64) -> Result<(), AppError> {
    crate::bridge::seek(position_ms).map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_set_volume(_app: AppHandle, db: f64) -> Result<(), AppError> {
    crate::bridge::set_volume(db).map_err(|e| AppError::Playback(e.to_string()))
}

#[tauri::command]
pub async fn ace_set_eq_band(
    _app: AppHandle,
    band: u8,
    freq: f32,
    gain_db: f32,
    q: f32,
) -> Result<(), AppError> {
    crate::bridge::set_eq_band(band, freq, gain_db, q).map_err(|e| AppError::DspError(e.to_string()))
}

#[tauri::command]
pub async fn ace_list_devices(_app: AppHandle) -> Result<Vec<AudioDeviceInfo>, AppError> {
    crate::bridge::list_devices().map_err(|e| AppError::DeviceNotFound(e.to_string()))
}

#[tauri::command]
pub async fn ace_set_output_device(_app: AppHandle, device_id: String) -> Result<(), AppError> {
    crate::bridge::set_output_device(&device_id).map_err(|e| AppError::DeviceNotFound(e.to_string()))
}

#[tauri::command]
pub async fn ace_set_dsp_state(_app: AppHandle, state: DspStatePayload) -> Result<(), AppError> {
    crate::bridge::set_dsp_state(state).map_err(|e| AppError::DspError(e.to_string()))
}

#[tauri::command]
pub async fn ace_analyze_file(app: AppHandle, file_path: String) -> Result<FileAnalysisResult, AppError> {
    crate::bridge::analyze_file(&app, &file_path)
        .await
        .map_err(|e| AppError::AnalysisFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_generate_spectrogram(
    _app: AppHandle,
    file_path: String,
    channel_index: u32,
) -> Result<Vec<f32>, AppError> {
    crate::bridge::generate_spectrogram(&file_path, channel_index)
        .map_err(|e| AppError::AnalysisFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_scan_folder(app: AppHandle, path: String) -> Result<u32, AppError> {
    crate::bridge::scan_folder(&app, &path).map_err(|e| AppError::ScanFailed(e.to_string()))
}
