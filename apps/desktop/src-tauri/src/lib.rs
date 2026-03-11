use tauri::Manager;

/// All Tauri commands are defined here and forwarded to the C++ audio engine
/// via the bridge module.

mod commands;
mod bridge;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
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
            commands::ace_analyze_file,
            commands::ace_generate_spectrogram,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Audiophile Ace");
}
