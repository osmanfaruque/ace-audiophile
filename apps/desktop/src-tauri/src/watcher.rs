/// A4.1.2 — File-system watcher using the `notify` crate.
///
/// Watches library paths for audio-file changes (create / delete / rename)
/// and emits `ace://fs-change` events to the frontend so the library stays
/// in sync without a full rescan.

use std::path::PathBuf;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::bridge;

// ── Payload sent to the frontend ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct FsChangeEvent {
    pub kind: &'static str, // "created" | "removed" | "renamed"
    pub path: String,
}

// ── Singleton watcher state ──────────────────────────────────

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);
static WATCHED_PATHS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Start watching the given directory paths for audio-file changes.
pub fn start(app: &AppHandle, paths: &[String]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Stop any existing watcher first
    stop();

    let app_handle = app.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let Ok(event) = res else { return };

        let kind: &str = match event.kind {
            EventKind::Create(_) => "created",
            EventKind::Remove(_) => "removed",
            EventKind::Modify(notify::event::ModifyKind::Name(_)) => "renamed",
            _ => return,
        };

        for path in &event.paths {
            if path.is_file() && bridge::is_audio_file(path) {
                app_handle
                    .emit(
                        "ace://fs-change",
                        FsChangeEvent {
                            kind,
                            path: path.to_string_lossy().into_owned(),
                        },
                    )
                    .ok();
            }
        }
    })?;

    let mut watched = WATCHED_PATHS.lock().unwrap();
    watched.clear();

    for p in paths {
        let pb = PathBuf::from(p);
        if pb.is_dir() {
            watcher.watch(&pb, RecursiveMode::Recursive)?;
            watched.push(pb);
        }
    }

    *WATCHER.lock().unwrap() = Some(watcher);
    Ok(())
}

/// Stop watching all paths and drop the watcher.
pub fn stop() {
    let mut guard = WATCHER.lock().unwrap();
    if let Some(mut w) = guard.take() {
        let paths = WATCHED_PATHS.lock().unwrap();
        for p in paths.iter() {
            w.unwatch(p).ok();
        }
    }
    WATCHED_PATHS.lock().unwrap().clear();
}
