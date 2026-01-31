// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Fix for blank screen on Wayland/Nvidia and newer WebKitGTK
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    // Force X11 backend to avoid Wayland rendering issues
    std::env::set_var("GDK_BACKEND", "x11");
    
    // Explicitly set the program name for Wayland/DE grouping
    // This helps match the .desktop file (GlobalProtect)
    glib::set_prgname(Some("globalprotect"));
    glib::set_application_name("GlobalProtect");

    globalprotect_lib::run()
}
