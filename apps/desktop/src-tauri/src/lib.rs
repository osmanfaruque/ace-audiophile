use tauri::Manager;

/// All Tauri commands are defined here and forwarded to the C++ audio engine
/// via the bridge module.

mod commands;
mod bridge;
mod error;
mod watcher;
mod autotag;
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_migrations = db::migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db_migrations)
                .build(),
        )
        .setup(|app| {
            // Initialize the C++ audio engine on startup
            bridge::init(app.handle().clone()).map_err(|e| e.to_string())?;

            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ace_engine_init,
            commands::ace_engine_destroy,
            commands::ace_open_file,
            commands::ace_open_track,
            commands::ace_play,
            commands::ace_pause,
            commands::ace_stop,
            commands::ace_seek,
            commands::ace_set_volume,
            commands::ace_list_devices,
            commands::ace_set_output_device,
            commands::ace_set_dsp_state,
            commands::ace_set_eq_band,
            commands::ace_analyze_file,
            commands::ace_generate_spectrogram,
            commands::ace_scan_folder,
            commands::ace_start_watcher,
            commands::ace_stop_watcher,
            commands::ace_write_metadata,
            commands::ace_acoustid_lookup,
            commands::ace_musicbrainz_search,
            commands::ace_fetch_embed_cover_art,
            commands::ace_get_schema_versions,
            commands::ace_export_db_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Audiophile Ace");
}
