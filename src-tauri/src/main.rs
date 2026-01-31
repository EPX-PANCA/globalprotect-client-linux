// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix for blank screen on Wayland/Nvidia
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    globalprotect_lib::run()
}
