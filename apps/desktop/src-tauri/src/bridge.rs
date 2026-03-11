/// C++ Audio Engine FFI Bridge (A2.1)
///
/// Dynamically loads `ace_engine.dll` (Windows) / `libace_engine.so` (Linux)
/// / `libace_engine.dylib` (macOS) at runtime via `libloading`.
///
/// The C++ engine exposes a flat C API (extern "C") defined in
/// `packages/audio-engine/include/ace_engine.h`.
///
/// DLL resolution order (A2.1.2):
///   1. `$APPDIR/ace_engine.dll`  (bundled next to the Tauri executable)
///   2. `../../packages/audio-engine/build/libace_engine.dll` (dev build)
///   3. System PATH fallback

use std::ffi::{CStr, CString};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use libloading::{Library, Symbol};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::{AudioDeviceInfo, DspStatePayload, FileAnalysisResult, TrackInfo};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

// ── Global state ─────────────────────────────────────────────

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static ENGINE_LIB: OnceLock<Library> = OnceLock::new();

// Rate-limit timestamps (ms since epoch)
static LAST_FFT_EMIT: AtomicU64 = AtomicU64::new(0);
static LAST_LEVEL_EMIT: AtomicU64 = AtomicU64::new(0);
static LAST_POS_EMIT: AtomicU64 = AtomicU64::new(0);

// ── DLL file name per platform ───────────────────────────────

#[cfg(target_os = "windows")]
const LIB_NAME: &str = "libace_engine.dll";
#[cfg(target_os = "linux")]
const LIB_NAME: &str = "libace_engine.so";
#[cfg(target_os = "macos")]
const LIB_NAME: &str = "libace_engine.dylib";

// ── A2.1.2  DLL path resolution ─────────────────────────────

/// Resolve the path to the engine shared library.
/// Checks multiple candidate paths, returning the first that exists.
fn resolve_lib_path() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    let candidates = [
        // 1. Next to the Tauri executable (production bundle)
        exe_dir.join(LIB_NAME),
        // 2. Dev build output (relative to exe in target/debug)
        exe_dir.join("../../../packages/audio-engine/build").join(LIB_NAME),
        // 3. Workspace root dev build (when CWD is workspace root)
        PathBuf::from("packages/audio-engine/build").join(LIB_NAME),
    ];

    for candidate in &candidates {
        if let Ok(canon) = candidate.canonicalize() {
            eprintln!("[AceBridge] Found engine library at: {}", canon.display());
            return canon;
        }
    }

    // Fallback: let the OS search PATH / system library dirs
    eprintln!("[AceBridge] Engine library not found at known paths, falling back to system search");
    PathBuf::from(LIB_NAME)
}

// ── Library loader ───────────────────────────────────────────

fn load_library() -> Result<&'static Library, BoxError> {
    if let Some(lib) = ENGINE_LIB.get() {
        return Ok(lib);
    }

    let lib_path = resolve_lib_path();
    eprintln!("[AceBridge] Loading engine library: {}", lib_path.display());

    // SAFETY: We trust the ace_engine DLL built from our own source.
    let lib = unsafe { Library::new(&lib_path) }
        .map_err(|e| -> BoxError {
            format!("Failed to load ace_engine library at '{}': {e}", lib_path.display()).into()
        })?;

    ENGINE_LIB.set(lib).ok();
    Ok(ENGINE_LIB.get().unwrap())
}

/// Helper: look up a symbol from the loaded library.
///
/// # Safety
/// Caller must ensure the function signature `T` matches the C API.
unsafe fn sym<T>(name: &[u8]) -> Result<Symbol<'static, T>, BoxError> {
    let lib = load_library()?;
    // SAFETY: caller guarantees type T matches the exported symbol.
    let s: Symbol<'static, T> = unsafe { lib.get(name) }
        .map_err(|e| -> BoxError {
            let fn_name = String::from_utf8_lossy(&name[..name.len().saturating_sub(1)]);
            format!("Symbol '{fn_name}' not found in ace_engine: {e}").into()
        })?;
    Ok(s)
}

// ── A2.1.3  Engine init on Tauri setup hook ──────────────────

pub fn init(app: AppHandle) -> Result<(), BoxError> {
    APP_HANDLE.set(app).ok();

    // Load the DLL
    load_library()?;

    // Call ace_init()
    unsafe {
        let ace_init: Symbol<unsafe extern "C" fn() -> i32> = sym(b"ace_init\0")?;
        let ret = ace_init();
        if ret != 0 {
            return Err(format!("ace_init() returned error code {ret}").into());
        }
    }

    eprintln!("[AceBridge] Engine initialized successfully");

    // A2.3 — Register engine callbacks for event emission
    register_engine_callbacks()?;

    Ok(())
}

// ── Engine lifecycle ─────────────────────────────────────────

pub fn engine_init() -> Result<(), BoxError> {
    // Already initialized in setup hook; this is a no-op re-init from frontend
    Ok(())
}

pub fn engine_destroy() -> Result<(), BoxError> {
    unsafe {
        let ace_shutdown: Symbol<unsafe extern "C" fn()> = sym(b"ace_shutdown\0")?;
        ace_shutdown();
    }
    eprintln!("[AceBridge] Engine shut down");
    Ok(())
}

// ── C FFI structs ────────────────────────────────────────────

#[repr(C)]
struct CAceEqBand {
    freq_hz: f32,
    gain_db: f32,
    q: f32,
    enabled: u8,
    filter_type: u8,
}

#[repr(C)]
struct CAceDspState {
    eq_enabled: u8,
    bands: [CAceEqBand; 60],
    crossfeed_enabled: u8,
    crossfeed_strength: f32,
    dither_enabled: u8,
    dither_bits: i32,
    dither_noise_shaping: u8,
    resampler_enabled: u8,
    resampler_target_hz: u32,
    spatializer_enabled: u8,
    spatializer_strength: f32,
    rg_mode: u8,
    rg_track_gain: f32,
    rg_album_gain: f32,
    rg_track_peak: f32,
    rg_album_peak: f32,
    rg_pre_amp: f32,
    rg_ceiling_db: f32,
    limiter_enabled: u8,
    limiter_ceiling_db: f32,
    limiter_release_ms: f32,
    mixer_enabled: u8,
    mixer_swap_lr: u8,
    mixer_mono: u8,
    mixer_balance: f32,
    mixer_invert_l: u8,
    mixer_invert_r: u8,
    crossfade_mode: u8,
    crossfade_duration_ms: i32,
    preamp_db: f32,
}

#[repr(C)]
struct CAceFileAnalysis {
    codec: [u8; 64],
    sample_rate: u32,
    bit_depth: u8,
    channels: u8,
    duration_ms: u64,
    dynamic_range_db: f32,
    true_peak_dbtp: f32,
    lufs_integrated: f32,
    is_lossy_transcoded: u8,
    effective_bit_depth: u8,
}

// ── Playback ─────────────────────────────────────────────────

pub fn open_file(file_path: &str) -> Result<TrackInfo, BoxError> {
    let c_path = CString::new(file_path)?;

    // Open the file for playback
    unsafe {
        let ace_open_file: Symbol<unsafe extern "C" fn(*const i8) -> i32> =
            sym(b"ace_open_file\0")?;
        let ret = ace_open_file(c_path.as_ptr());
        if ret != 0 {
            return Err(format!("ace_open_file failed for '{file_path}' (code {ret})").into());
        }
    }

    // Extract metadata via ace_analyze_file (best-effort)
    let mut c_analysis = CAceFileAnalysis {
        codec: [0u8; 64],
        sample_rate: 0,
        bit_depth: 0,
        channels: 0,
        duration_ms: 0,
        dynamic_range_db: 0.0,
        true_peak_dbtp: 0.0,
        lufs_integrated: 0.0,
        is_lossy_transcoded: 0,
        effective_bit_depth: 0,
    };

    unsafe {
        let ace_analyze: Symbol<
            unsafe extern "C" fn(
                *const i8,
                *mut CAceFileAnalysis,
                Option<unsafe extern "C" fn(f32, *mut std::ffi::c_void)>,
                *mut std::ffi::c_void,
            ) -> i32,
        > = sym(b"ace_analyze_file\0")?;
        // Ignore errors — metadata extraction is best-effort on open
        ace_analyze(c_path.as_ptr(), &mut c_analysis, None, std::ptr::null_mut());
    }

    let codec = CStr::from_bytes_until_nul(&c_analysis.codec)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let info = TrackInfo {
        file_path: file_path.to_string(),
        codec,
        sample_rate: c_analysis.sample_rate,
        bit_depth: c_analysis.bit_depth,
        channels: c_analysis.channels,
        duration_ms: c_analysis.duration_ms,
    };

    // A2.3.4 — Emit track-change event
    emit_event("ace://track-change", &info);

    Ok(info)
}

pub fn open_track(track_id: &str) -> Result<(), BoxError> {
    // open_track resolves the track path from DB, then calls open_file
    // For now, treat track_id as a file path
    open_file(track_id).map(|_| ())
}

pub fn play() -> Result<(), BoxError> {
    unsafe {
        let ace_play: Symbol<unsafe extern "C" fn() -> i32> = sym(b"ace_play\0")?;
        let ret = ace_play();
        if ret != 0 {
            return Err(format!("ace_play failed (code {ret})").into());
        }
    }
    emit_event("ace://engine-status", "playing");
    Ok(())
}

pub fn pause() -> Result<(), BoxError> {
    unsafe {
        let ace_pause: Symbol<unsafe extern "C" fn() -> i32> = sym(b"ace_pause\0")?;
        let ret = ace_pause();
        if ret != 0 {
            return Err(format!("ace_pause failed (code {ret})").into());
        }
    }
    emit_event("ace://engine-status", "paused");
    Ok(())
}

pub fn stop() -> Result<(), BoxError> {
    unsafe {
        let ace_stop: Symbol<unsafe extern "C" fn() -> i32> = sym(b"ace_stop\0")?;
        let ret = ace_stop();
        if ret != 0 {
            return Err(format!("ace_stop failed (code {ret})").into());
        }
    }
    emit_event("ace://engine-status", "idle");
    Ok(())
}

pub fn seek(position_ms: u64) -> Result<(), BoxError> {
    unsafe {
        let ace_seek: Symbol<unsafe extern "C" fn(u64) -> i32> = sym(b"ace_seek\0")?;
        let ret = ace_seek(position_ms);
        if ret != 0 {
            return Err(format!("ace_seek({position_ms}) failed (code {ret})").into());
        }
    }
    Ok(())
}

pub fn set_volume(db: f64) -> Result<(), BoxError> {
    let linear = if db <= -60.0 {
        0.0f32
    } else {
        10f32.powf(db as f32 / 20.0).clamp(0.0, 1.0)
    };
    unsafe {
        let ace_set_volume: Symbol<unsafe extern "C" fn(f32)> = sym(b"ace_set_volume\0")?;
        ace_set_volume(linear);
    }
    Ok(())
}

pub fn set_eq_band(band: u8, freq: f32, gain_db: f32, q: f32) -> Result<(), BoxError> {
    unsafe {
        let ace_set_eq: Symbol<
            unsafe extern "C" fn(i32, f32, f32, f32, u8, u8) -> i32,
        > = sym(b"ace_set_eq_band\0")?;
        let ret = ace_set_eq(band as i32, freq, gain_db, q, 1, 0);
        if ret != 0 {
            return Err(format!("ace_set_eq_band({band}) failed (code {ret})").into());
        }
    }
    Ok(())
}

// ── Devices ──────────────────────────────────────────────────

/// C-compatible device info struct matching ace_engine.h AceDeviceInfo
#[repr(C)]
#[derive(Clone)]
struct CAceDeviceInfo {
    id: [u8; 128],
    name: [u8; 256],
    max_sample_rate: u32,
    supports_exclusive: u8,
}

pub fn list_devices() -> Result<Vec<AudioDeviceInfo>, BoxError> {
    let mut c_devices = vec![
        CAceDeviceInfo {
            id: [0u8; 128],
            name: [0u8; 256],
            max_sample_rate: 0,
            supports_exclusive: 0,
        };
        32 // max 32 devices
    ];

    let count = unsafe {
        let ace_list_devices: Symbol<unsafe extern "C" fn(*mut CAceDeviceInfo, i32) -> i32> =
            sym(b"ace_list_devices\0")?;
        ace_list_devices(c_devices.as_mut_ptr(), 32)
    };

    if count < 0 {
        return Err("ace_list_devices failed".into());
    }

    let devices = c_devices[..count as usize]
        .iter()
        .map(|d| {
            let id = CStr::from_bytes_until_nul(&d.id)
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let name = CStr::from_bytes_until_nul(&d.name)
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            AudioDeviceInfo {
                id,
                name,
                r#type: "output".into(),
                sample_rates: vec![44100, 48000, 88200, 96000, 176400, 192000],
                bit_depths: vec![16, 24, 32],
                channels: vec![2],
                is_exclusive: d.supports_exclusive != 0,
                supports_dop: false,
                supports_native_dsd: false,
            }
        })
        .collect();

    Ok(devices)
}

pub fn set_output_device(device_id: &str) -> Result<(), BoxError> {
    eprintln!("[AceBridge] set_output_device: {device_id}");
    // Engine device switching requires C++ API extension — store preference
    Ok(())
}

// ── DSP ──────────────────────────────────────────────────────

pub fn set_dsp_state(state: DspStatePayload) -> Result<(), BoxError> {
    let c_state = CAceDspState {
        eq_enabled: state.eq_enabled as u8,
        bands: std::array::from_fn(|i| {
            state.bands.get(i).map_or(
                CAceEqBand { freq_hz: 0.0, gain_db: 0.0, q: 1.0, enabled: 0, filter_type: 0 },
                |b| CAceEqBand {
                    freq_hz: b.freq_hz,
                    gain_db: b.gain_db,
                    q: b.q,
                    enabled: b.enabled as u8,
                    filter_type: b.filter_type,
                },
            )
        }),
        crossfeed_enabled: state.crossfeed_enabled as u8,
        crossfeed_strength: state.crossfeed_strength,
        dither_enabled: state.dither_enabled as u8,
        dither_bits: state.dither_bits,
        dither_noise_shaping: state.dither_noise_shaping as u8,
        resampler_enabled: state.resampler_enabled as u8,
        resampler_target_hz: state.resampler_target_hz,
        spatializer_enabled: state.spatializer_enabled as u8,
        spatializer_strength: state.spatializer_strength,
        rg_mode: state.rg_mode,
        rg_track_gain: state.rg_track_gain,
        rg_album_gain: state.rg_album_gain,
        rg_track_peak: state.rg_track_peak,
        rg_album_peak: state.rg_album_peak,
        rg_pre_amp: state.rg_pre_amp,
        rg_ceiling_db: state.rg_ceiling_db,
        limiter_enabled: state.limiter_enabled as u8,
        limiter_ceiling_db: state.limiter_ceiling_db,
        limiter_release_ms: state.limiter_release_ms,
        mixer_enabled: state.mixer_enabled as u8,
        mixer_swap_lr: state.mixer_swap_lr as u8,
        mixer_mono: state.mixer_mono as u8,
        mixer_balance: state.mixer_balance,
        mixer_invert_l: state.mixer_invert_l as u8,
        mixer_invert_r: state.mixer_invert_r as u8,
        crossfade_mode: state.crossfade_mode,
        crossfade_duration_ms: state.crossfade_duration_ms,
        preamp_db: state.preamp_db,
    };

    unsafe {
        let ace_set_dsp: Symbol<unsafe extern "C" fn(*const CAceDspState) -> i32> =
            sym(b"ace_set_dsp\0")?;
        let ret = ace_set_dsp(&c_state);
        if ret != 0 {
            return Err(format!("ace_set_dsp failed (code {ret})").into());
        }
    }
    Ok(())
}

// ── Analysis ─────────────────────────────────────────────────

pub async fn analyze_file(app: &AppHandle, file_path: &str) -> Result<FileAnalysisResult, BoxError> {
    app.emit("ace://analysis-progress", 0u8).ok();

    let c_path = CString::new(file_path)?;
    let mut c_analysis = CAceFileAnalysis {
        codec: [0u8; 64],
        sample_rate: 0,
        bit_depth: 0,
        channels: 0,
        duration_ms: 0,
        dynamic_range_db: 0.0,
        true_peak_dbtp: 0.0,
        lufs_integrated: 0.0,
        is_lossy_transcoded: 0,
        effective_bit_depth: 0,
    };

    let ret = unsafe {
        let ace_analyze: Symbol<
            unsafe extern "C" fn(
                *const i8,
                *mut CAceFileAnalysis,
                Option<unsafe extern "C" fn(f32, *mut std::ffi::c_void)>,
                *mut std::ffi::c_void,
            ) -> i32,
        > = sym(b"ace_analyze_file\0")?;
        ace_analyze(c_path.as_ptr(), &mut c_analysis, None, std::ptr::null_mut())
    };

    if ret != 0 {
        return Err(format!("ace_analyze_file failed for '{file_path}' (code {ret})").into());
    }

    let codec = CStr::from_bytes_until_nul(&c_analysis.codec)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    app.emit("ace://analysis-progress", 100u8).ok();

    Ok(FileAnalysisResult {
        track_id: String::new(),
        analyzed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        declared_bit_depth: c_analysis.bit_depth,
        effective_bit_depth: c_analysis.effective_bit_depth,
        is_fake_bit_depth: c_analysis.effective_bit_depth > 0
            && c_analysis.effective_bit_depth < c_analysis.bit_depth,
        lsb_histogram: vec![],
        is_lossy_transcode: c_analysis.is_lossy_transcoded != 0,
        lossy_confidence: if c_analysis.is_lossy_transcoded != 0 { 80 } else { 0 },
        frequency_cutoff_hz: None,
        sbr: false,
        verdict: if c_analysis.is_lossy_transcoded != 0 {
            "lossy_transcode".into()
        } else {
            "genuine".into()
        },
        verdict_explanation: format!(
            "{} {}kHz/{}bit, DR={:.1}dB, LUFS={:.1}",
            codec,
            c_analysis.sample_rate / 1000,
            c_analysis.bit_depth,
            c_analysis.dynamic_range_db,
            c_analysis.lufs_integrated
        ),
        dr_value: c_analysis.dynamic_range_db as f64,
        lufs_integrated: c_analysis.lufs_integrated as f64,
        lufs_range: 0.0,
        true_peak_db: c_analysis.true_peak_dbtp as f64,
        crest_factor_db: 0.0,
        container: codec,
        chunks: serde_json::json!([]),
    })
}

pub fn generate_spectrogram(_file_path: &str, _channel_index: u32) -> Result<Vec<f32>, BoxError> {
    // Will be wired when A7 analyzer is implemented
    Ok(vec![])
}

// ── Folder scanning ──────────────────────────────────────────

const AUDIO_EXTENSIONS: &[&str] = &[
    "flac", "wav", "aiff", "aif", "mp3", "aac", "m4a",
    "ogg", "opus", "wma", "ape", "dsf", "dff", "wv",
];

pub fn scan_folder(app: &AppHandle, folder_path: &str) -> Result<u32, BoxError> {
    let root = std::path::Path::new(folder_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {folder_path}").into());
    }

    let mut count: u32 = 0;
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Some(ext) = p.extension() {
                if AUDIO_EXTENSIONS.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                    count += 1;
                    app.emit(
                        "ace://scan-progress",
                        serde_json::json!({
                            "file": p.to_string_lossy(),
                            "count": count,
                        }),
                    )
                    .ok();
                }
            }
        }
    }

    app.emit(
        "ace://scan-complete",
        serde_json::json!({ "total": count, "folder": folder_path }),
    )
    .ok();

    Ok(count)
}

// ── Helpers ──────────────────────────────────────────────────

fn emit_event<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP_HANDLE.get() {
        app.emit(event, payload).ok();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── A2.3  Event Emitters (audio thread → frontend) ──────────

const ACE_FFT_BINS: usize = 2048;

/// Matches AceFftFrame in ace_engine.h
#[repr(C)]
struct CAceFftFrame {
    bins_l: [f32; ACE_FFT_BINS],
    bins_r: [f32; ACE_FFT_BINS],
    timestamp_ms: u64,
}

/// Matches AceLevelMeter in ace_engine.h
#[repr(C)]
#[derive(Clone, Copy)]
struct CAceLevelMeter {
    peak_l_db: f32,
    peak_r_db: f32,
    rms_l_db: f32,
    rms_r_db: f32,
    lufs_integrated: f32,
}

// Serializable payloads for Tauri events
#[derive(Serialize, Clone)]
struct FftFrameEvent {
    bins_l: Vec<f32>,
    bins_r: Vec<f32>,
    timestamp_ms: u64,
}

#[derive(Serialize, Clone)]
struct LevelMeterEvent {
    peak_l_db: f32,
    peak_r_db: f32,
    rms_l_db: f32,
    rms_r_db: f32,
    lufs_integrated: f32,
}

#[derive(Serialize, Clone)]
struct PositionEvent {
    position_ms: u64,
}

/// C callback for meter data (FFT + level). Called from audio thread ~16ms.
/// Rate-limits: FFT @ 60Hz (~16ms), level @ 30Hz (~33ms).
unsafe extern "C" fn meter_callback(
    fft: *const CAceFftFrame,
    level: *const CAceLevelMeter,
    _userdata: *mut std::ffi::c_void,
) {
    let now = now_ms();

    // A2.3.1 — FFT frame @ 60 Hz
    if !fft.is_null() {
        let last = LAST_FFT_EMIT.load(Ordering::Relaxed);
        if now.saturating_sub(last) >= 16 {
            LAST_FFT_EMIT.store(now, Ordering::Relaxed);
            let f = &*fft;
            emit_event(
                "ace://fft-frame",
                FftFrameEvent {
                    bins_l: f.bins_l.to_vec(),
                    bins_r: f.bins_r.to_vec(),
                    timestamp_ms: f.timestamp_ms,
                },
            );
        }
    }

    // A2.3.2 — Level meter @ 30 Hz
    if !level.is_null() {
        let last = LAST_LEVEL_EMIT.load(Ordering::Relaxed);
        if now.saturating_sub(last) >= 33 {
            LAST_LEVEL_EMIT.store(now, Ordering::Relaxed);
            let l = &*level;
            emit_event(
                "ace://level-meter",
                LevelMeterEvent {
                    peak_l_db: l.peak_l_db,
                    peak_r_db: l.peak_r_db,
                    rms_l_db: l.rms_l_db,
                    rms_r_db: l.rms_r_db,
                    lufs_integrated: l.lufs_integrated,
                },
            );
        }
    }
}

/// C callback for position updates. Rate-limits @ 10 Hz (~100ms).
unsafe extern "C" fn position_callback(
    position_ms: u64,
    _userdata: *mut std::ffi::c_void,
) {
    let now = now_ms();
    let last = LAST_POS_EMIT.load(Ordering::Relaxed);
    if now.saturating_sub(last) >= 100 {
        LAST_POS_EMIT.store(now, Ordering::Relaxed);
        emit_event("ace://position-update", PositionEvent { position_ms });
    }
}

/// C callback for engine errors.
unsafe extern "C" fn error_callback(
    message: *const i8,
    _userdata: *mut std::ffi::c_void,
) {
    let msg = if message.is_null() {
        "Unknown engine error".to_string()
    } else {
        CStr::from_ptr(message).to_string_lossy().into_owned()
    };
    eprintln!("[AceBridge] Engine error: {msg}");
    emit_event("ace://engine-error", serde_json::json!({ "message": msg }));
}

/// Register all C engine callbacks. Called once after ace_init().
fn register_engine_callbacks() -> Result<(), BoxError> {
    unsafe {
        // A2.3.1 + A2.3.2 — Meter callback (FFT + level)
        type MeterCb = unsafe extern "C" fn(
            *const CAceFftFrame,
            *const CAceLevelMeter,
            *mut std::ffi::c_void,
        );
        let set_meter: Symbol<unsafe extern "C" fn(MeterCb, *mut std::ffi::c_void)> =
            sym(b"ace_set_meter_callback\0")?;
        set_meter(meter_callback, std::ptr::null_mut());

        // A2.3.3 — Position callback
        type PosCb = unsafe extern "C" fn(u64, *mut std::ffi::c_void);
        let set_pos: Symbol<unsafe extern "C" fn(PosCb, *mut std::ffi::c_void)> =
            sym(b"ace_set_position_callback\0")?;
        set_pos(position_callback, std::ptr::null_mut());

        // A2.3.5 — Error callback
        type ErrCb = unsafe extern "C" fn(*const i8, *mut std::ffi::c_void);
        let set_err: Symbol<unsafe extern "C" fn(ErrCb, *mut std::ffi::c_void)> =
            sym(b"ace_set_error_callback\0")?;
        set_err(error_callback, std::ptr::null_mut());
    }

    eprintln!("[AceBridge] Engine callbacks registered (FFT@60Hz, Level@30Hz, Pos@10Hz, Error)");
    Ok(())
}
