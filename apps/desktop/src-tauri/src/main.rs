// Tauri requires a non-async main for the entry point.
// All logic is in lib.rs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    audiophile_ace_desktop_lib::run();
}
