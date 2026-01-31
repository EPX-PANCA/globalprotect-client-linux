// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 1. Disable hardware acceleration features in WebKitGTK
    // These are the primary causes of "blank white screen" on Linux
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    // 2. Try to disable sandbox if it's creating EGL context issues
    std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");

    // 3. Last resort: Software rendering for OpenGL
    // Addresses `EGL_BAD_PARAMETER`
    std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
    
    // Explicitly set the program name for Wayland/DE grouping
    glib::set_prgname(Some("com.globalprotect.clone"));
    glib::set_application_name("GlobalProtect");

    globalprotect_lib::run()
}
