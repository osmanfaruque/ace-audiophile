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

use libloading::{Library, Symbol};
use tauri::{AppHandle, Emitter};

use crate::commands::{AudioDeviceInfo, DspStatePayload, FileAnalysisResult};

type BoxError = Box<dyn std::error::Error + Send + Sync>;

// ── Global state ─────────────────────────────────────────────

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static ENGINE_LIB: OnceLock<Library> = OnceLock::new();

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

// ── Playback ─────────────────────────────────────────────────

pub fn open_file(file_path: &str) -> Result<(), BoxError> {
    let c_path = CString::new(file_path)?;
    unsafe {
        let ace_open: Symbol<unsafe extern "C" fn(*const i8) -> i32> = sym(b"ace_open\0")?;
        let ret = ace_open(c_path.as_ptr());
        if ret != 0 {
            return Err(format!("ace_open failed for '{file_path}' (code {ret})").into());
        }
    }
    Ok(())
}

pub fn open_track(track_id: &str) -> Result<(), BoxError> {
    // open_track resolves the track path from DB, then calls open_file
    // For now, treat track_id as a file path
    open_file(track_id)
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

pub fn set_volume(volume: f64) -> Result<(), BoxError> {
    unsafe {
        let ace_set_volume: Symbol<unsafe extern "C" fn(f32)> = sym(b"ace_set_volume\0")?;
        ace_set_volume(volume as f32);
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

pub fn set_output_device(_device_id: &str) -> Result<(), BoxError> {
    // ace_engine currently auto-selects devices on open;
    // device selection will be wired in A2.2.8
    Ok(())
}

// ── DSP ──────────────────────────────────────────────────────

pub fn set_dsp_state(_state: DspStatePayload) -> Result<(), BoxError> {
    // Full DSP state wiring is A2.2.6 — for now just log
    eprintln!("[AceBridge] set_dsp_state — will be wired in A2.2.6");
    Ok(())
}

// ── Analysis ─────────────────────────────────────────────────

pub async fn analyze_file(app: &AppHandle, file_path: &str) -> Result<FileAnalysisResult, BoxError> {
    app.emit("ace://analysis-progress", 0u8).ok();

    // Full analysis wiring is A2.2.9 — return metadata from engine
    let result = FileAnalysisResult {
        track_id: String::new(),
        analyzed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        declared_bit_depth: 0,
        effective_bit_depth: 0,
        is_fake_bit_depth: false,
        lsb_histogram: vec![],
        is_lossy_transcode: false,
        lossy_confidence: 0,
        frequency_cutoff_hz: None,
        sbr: false,
        verdict: "pending".into(),
        verdict_explanation: format!("Analysis bridge pending for: {file_path}"),
        dr_value: 0.0,
        lufs_integrated: 0.0,
        lufs_range: 0.0,
        true_peak_db: 0.0,
        crest_factor_db: 0.0,
        container: String::new(),
        chunks: serde_json::json!([]),
    };

    app.emit("ace://analysis-progress", 100u8).ok();
    Ok(result)
}

pub fn generate_spectrogram(_file_path: &str, _channel_index: u32) -> Result<Vec<f32>, BoxError> {
    // Will be wired when A7 analyzer is implemented
    Ok(vec![])
}

// ── Helpers ──────────────────────────────────────────────────

fn emit_event<S: serde::Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP_HANDLE.get() {
        app.emit(event, payload).ok();
    }
}
