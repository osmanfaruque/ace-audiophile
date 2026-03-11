/// A2.4 — Structured application errors with JSON serialization.
///
/// Every Tauri command returns `Result<T, AppError>`.  The `Serialize` impl
/// produces a JSON object `{ "kind": "...", "message": "..." }` that the
/// frontend can pattern-match on `kind` for i18n / toast routing.

use serde::Serialize;

/// Top-level error variants surfaced to the frontend.
#[derive(Debug)]
pub enum AppError {
    /// Failed to load or initialise the C++ engine DLL.
    EngineLoad(String),
    /// Playback-related failure (open, play, pause, stop, seek, volume, EQ).
    Playback(String),
    /// Requested audio device was not found or could not be opened.
    DeviceNotFound(String),
    /// File analysis failed (decode error, unsupported format, etc.).
    AnalysisFailed(String),
    /// Folder scan error (path not found, permission denied, etc.).
    ScanFailed(String),
    /// File-system watcher error (notify crate).
    WatcherFailed(String),
    /// DSP state application failed.
    DspError(String),
    /// Catch-all for unexpected errors.
    Internal(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EngineLoad(m) => write!(f, "Engine load error: {m}"),
            Self::Playback(m) => write!(f, "Playback error: {m}"),
            Self::DeviceNotFound(m) => write!(f, "Device not found: {m}"),
            Self::AnalysisFailed(m) => write!(f, "Analysis failed: {m}"),
            Self::ScanFailed(m) => write!(f, "Scan failed: {m}"),
            Self::WatcherFailed(m) => write!(f, "Watcher failed: {m}"),
            Self::DspError(m) => write!(f, "DSP error: {m}"),
            Self::Internal(m) => write!(f, "Internal error: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

/// A2.4.2 — serde_json serialization → frontend-consumable JSON.
///
/// Tauri commands that return `Result<T, AppError>` need `AppError` to
/// implement `Serialize`.  The output is:
/// ```json
/// { "kind": "Playback", "message": "ace_play failed (code -1)" }
/// ```
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            Self::EngineLoad(m) => ("EngineLoad", m.as_str()),
            Self::Playback(m) => ("Playback", m.as_str()),
            Self::DeviceNotFound(m) => ("DeviceNotFound", m.as_str()),
            Self::AnalysisFailed(m) => ("AnalysisFailed", m.as_str()),
            Self::ScanFailed(m) => ("ScanFailed", m.as_str()),
            Self::WatcherFailed(m) => ("WatcherFailed", m.as_str()),
            Self::DspError(m) => ("DspError", m.as_str()),
            Self::Internal(m) => ("Internal", m.as_str()),
        };
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", message)?;
        s.end()
    }
}

/// Convert from the boxed errors that bridge.rs returns.
impl From<Box<dyn std::error::Error + Send + Sync>> for AppError {
    fn from(e: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self::Internal(e.to_string())
    }
}
