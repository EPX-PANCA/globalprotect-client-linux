// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Explicitly set the program name for Wayland/DE grouping
    glib::set_prgname(Some("com.globalprotect.clone"));
    glib::set_application_name("GlobalProtect");

    globalprotect_lib::run()
}
