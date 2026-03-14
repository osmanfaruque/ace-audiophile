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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MetadataWritePayload {
    #[serde(default)]
    pub file_path: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub album_artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub genre: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub year: u32,
    #[serde(default)]
    pub track_number: u32,
    #[serde(default)]
    pub track_total: u32,
    #[serde(default)]
    pub disc_number: u32,
    #[serde(default)]
    pub disc_total: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutoTagCandidatePayload {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: String,
    pub score: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SchemaVersionPayload {
    pub version: i64,
    pub description: String,
    pub applied_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbExportPayload {
    pub json: String,
    pub output_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbPlaylistPayload {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: i64,
    pub modified_at: i64,
    pub track_count: i64,
    pub is_smart_playlist: bool,
    pub rules_json: Option<String>,
    pub track_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbRatingPayload {
    pub track_id: String,
    pub stars: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LibraryQueryPayload {
    pub search: Option<String>,
    pub mode: Option<String>,
    pub active_filter: Option<String>,
    pub sort_key: Option<String>,
    pub sort_dir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbTrackPayload {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<i64>,
    pub track_number: Option<i64>,
    pub total_tracks: Option<i64>,
    pub disc_number: Option<i64>,
    pub total_discs: Option<i64>,
    pub comment: String,
    pub duration_ms: i64,
    pub sample_rate: i64,
    pub bit_depth: i64,
    pub channels: i64,
    pub codec: String,
    pub bitrate_kbps: i64,
    pub file_size_bytes: i64,
    pub play_count: i64,
    pub album_art_path: Option<String>,
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

// ── A4.1.2 — File-system watcher ─────────────────────────────

#[tauri::command]
pub async fn ace_start_watcher(app: AppHandle, paths: Vec<String>) -> Result<(), AppError> {
    crate::watcher::start(&app, &paths).map_err(|e| AppError::WatcherFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_stop_watcher(_app: AppHandle) -> Result<(), AppError> {
    crate::watcher::stop();
    Ok(())
}

#[tauri::command]
pub async fn ace_write_metadata(_app: AppHandle, payload: MetadataWritePayload) -> Result<(), AppError> {
    crate::bridge::write_metadata(payload).map_err(|e| AppError::MetadataWriteFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_acoustid_lookup(_app: AppHandle, file_path: String) -> Result<Vec<AutoTagCandidatePayload>, AppError> {
    let rows = crate::autotag::acoustid_lookup(&file_path)
        .await
        .map_err(|e| AppError::AutoTagFailed(e.to_string()))?;
    Ok(rows.into_iter().map(|r| AutoTagCandidatePayload {
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        year: r.year,
        score: r.score,
    }).collect())
}

#[tauri::command]
pub async fn ace_musicbrainz_search(_app: AppHandle, query: String) -> Result<Vec<AutoTagCandidatePayload>, AppError> {
    let rows = crate::autotag::musicbrainz_search(&query)
        .await
        .map_err(|e| AppError::AutoTagFailed(e.to_string()))?;
    Ok(rows.into_iter().map(|r| AutoTagCandidatePayload {
        id: r.id,
        title: r.title,
        artist: r.artist,
        album: r.album,
        year: r.year,
        score: r.score,
    }).collect())
}

#[tauri::command]
pub async fn ace_fetch_embed_cover_art(
    _app: AppHandle,
    file_path: String,
    release_mbid: String,
) -> Result<(), AppError> {
    let temp_path = crate::autotag::fetch_cover_art_to_temp(&release_mbid)
        .await
        .map_err(|e| AppError::AutoTagFailed(e.to_string()))?;
    crate::bridge::embed_cover_art(&file_path, &temp_path)
        .map_err(|e| AppError::AutoTagFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_get_schema_versions(app: AppHandle) -> Result<Vec<SchemaVersionPayload>, AppError> {
    let exported = crate::db::export_db_json(&app, None)
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))?;

    let root: serde_json::Value = serde_json::from_str(&exported)
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))?;

    let versions = root
        .get("schema_versions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| AppError::DatabaseFailed("schema_versions missing in export payload".to_string()))?;

    let mut out = Vec::with_capacity(versions.len());
    for item in versions {
        out.push(SchemaVersionPayload {
            version: item.get("version").and_then(|v| v.as_i64()).unwrap_or_default(),
            description: item
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            applied_at: item.get("applied_at").and_then(|v| v.as_i64()).unwrap_or_default(),
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn ace_export_db_json(
    app: AppHandle,
    output_path: Option<String>,
) -> Result<DbExportPayload, AppError> {
    let json = crate::db::export_db_json(&app, output_path.clone())
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))?;

    Ok(DbExportPayload { json, output_path })
}

#[tauri::command]
pub async fn ace_scan_index_folder(app: AppHandle, path: String) -> Result<u32, AppError> {
    crate::db::scan_and_index_folder(&app, &path)
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_index_file_paths(app: AppHandle, paths: Vec<String>) -> Result<u32, AppError> {
    crate::db::index_file_paths(&app, &paths)
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_query_library_tracks(
    app: AppHandle,
    query: LibraryQueryPayload,
) -> Result<Vec<DbTrackPayload>, AppError> {
    let rows = crate::db::query_library_tracks(
        &app,
        crate::db::LibraryQuery {
            search: query.search,
            mode: query.mode,
            active_filter: query.active_filter,
            sort_key: query.sort_key,
            sort_dir: query.sort_dir,
        },
    )
    .map_err(|e| AppError::DatabaseFailed(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|r| DbTrackPayload {
            id: r.id,
            file_path: r.file_path,
            title: r.title,
            artist: r.artist,
            album_artist: r.album_artist,
            album: r.album,
            genre: r.genre,
            year: r.year,
            track_number: r.track_number,
            total_tracks: r.total_tracks,
            disc_number: r.disc_number,
            total_discs: r.total_discs,
            comment: r.comment,
            duration_ms: r.duration_ms,
            sample_rate: r.sample_rate,
            bit_depth: r.bit_depth,
            channels: r.channels,
            codec: r.codec,
            bitrate_kbps: r.bitrate_kbps,
            file_size_bytes: r.file_size_bytes,
            play_count: r.play_count,
            album_art_path: r.album_art_path,
        })
        .collect())
}

#[tauri::command]
pub async fn ace_save_playlists(app: AppHandle, entries: Vec<DbPlaylistPayload>) -> Result<(), AppError> {
    let rows: Vec<crate::db::PlaylistPayload> = entries
        .into_iter()
        .map(|p| crate::db::PlaylistPayload {
            id: p.id,
            name: p.name,
            description: p.description,
            created_at: p.created_at,
            modified_at: p.modified_at,
            track_count: p.track_count,
            is_smart_playlist: p.is_smart_playlist,
            rules_json: p.rules_json,
            track_paths: p.track_paths,
        })
        .collect();
    crate::db::save_playlists(&app, &rows).map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_load_playlists(app: AppHandle) -> Result<Vec<DbPlaylistPayload>, AppError> {
    let rows = crate::db::load_playlists(&app).map_err(|e| AppError::DatabaseFailed(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|p| DbPlaylistPayload {
            id: p.id,
            name: p.name,
            description: p.description,
            created_at: p.created_at,
            modified_at: p.modified_at,
            track_count: p.track_count,
            is_smart_playlist: p.is_smart_playlist,
            rules_json: p.rules_json,
            track_paths: p.track_paths,
        })
        .collect())
}

#[tauri::command]
pub async fn ace_set_rating(app: AppHandle, track_id: String, stars: i64) -> Result<(), AppError> {
    crate::db::set_rating(&app, &track_id, stars).map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_get_ratings(app: AppHandle) -> Result<Vec<DbRatingPayload>, AppError> {
    let rows = crate::db::get_ratings(&app).map_err(|e| AppError::DatabaseFailed(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|r| DbRatingPayload {
            track_id: r.track_id,
            stars: r.stars,
        })
        .collect())
}

#[tauri::command]
pub async fn ace_log_listening_event(
    app: AppHandle,
    track_id: String,
    started_at: i64,
    ended_at: Option<i64>,
    completed: bool,
) -> Result<(), AppError> {
    crate::db::log_listening_event(&app, &track_id, started_at, ended_at, completed)
        .map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_get_recap_stats(app: AppHandle, year: i32) -> Result<serde_json::Value, AppError> {
    crate::db::get_recap_stats(&app, year).map_err(|e| AppError::DatabaseFailed(e.to_string()))
}

#[tauri::command]
pub async fn ace_get_album_art_path(app: AppHandle, track_id: String) -> Result<Option<String>, AppError> {
    crate::db::get_album_art_path(&app, &track_id).map_err(|e| AppError::DatabaseFailed(e.to_string()))
}
