use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

#[derive(Default)]
struct VpnState {
    child: Arc<Mutex<Option<Child>>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VpnConfig {
    portal: String,
    username: String,
    password: Option<String>,
    notifications_enabled: Option<bool>,
    auto_connect: Option<bool>,
}

#[tauri::command]
async fn check_openconnect() -> Result<bool, String> {
    let output = Command::new("which")
        .arg("openconnect")
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

#[tauri::command]
async fn connect_vpn(
    app_handle: tauri::AppHandle,
    config: VpnConfig,
    state: State<'_, VpnState>,
) -> Result<(), String> {
    let mut child_guard = state.child.lock().map_err(|_| "Failed to lock state")?;

    // Kill existing process if any
    if let Some(mut existing) = child_guard.take() {
        let _ = existing.kill();
    }

    // Prepare the command
    // Using sudo instead of pkexec for better scriptability and sudoers support
    let mut cmd = Command::new("sudo");
    cmd.arg("openconnect")
        .arg("--protocol=gp")
        .arg("--passwd-on-stdin")
        .arg(&config.portal)
        .arg("--user")
        .arg(&config.username);

    // Setup logging
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let logs_dir = app_dir.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    
    let log_path = logs_dir.join("vpn.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    
    // Log start attempt
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).open(&log_path) {
        let _ = writeln!(file, "\n--- Connection Attempt: {} ---", chrono::Local::now());
    }

    let stderr_log = log_file.try_clone().map_err(|e| e.to_string())?;

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_log));

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start openconnect: {}", e))?;

    // Send password to stdin
    if let Some(password) = config.password {
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = writeln!(stdin, "{}", password);
        }
    }

    *child_guard = Some(child);

    Ok(())
}

#[tauri::command]
async fn disconnect_vpn(state: State<'_, VpnState>) -> Result<(), String> {
    // Use absolute path for pkill as defined in sudoers
    let _ = Command::new("sudo")
        .arg("-n")
        .arg("/usr/bin/pkill")
        .arg("-f")
        .arg("openconnect")
        .status();

    std::thread::sleep(std::time::Duration::from_millis(300));

    // Attempt hard kill if still exists
    let _ = Command::new("sudo")
        .arg("-n")
        .arg("/usr/bin/pkill")
        .arg("-9")
        .arg("-f")
        .arg("openconnect")
        .status();

    let mut child_guard = state.child.lock().map_err(|_| "Failed to lock state")?;
    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
    }

    Ok(())
}

#[tauri::command]
async fn get_vpn_status(_state: State<'_, VpnState>) -> Result<bool, String> {
    // Check if openconnect process is running - use pgreg -f for better match
    let pgrep = Command::new("pgrep")
        .arg("-f")
        .arg("openconnect")
        .output()
        .map_err(|e| e.to_string())?;

    if !pgrep.status.success() {
        return Ok(false);
    }

    // Also check if a tun interface exists
    let ip_addr = Command::new("ip")
        .arg("addr")
        .arg("show")
        .output()
        .map_err(|e| e.to_string())?;
    let output = String::from_utf8_lossy(&ip_addr.stdout);

    // Most VPNs use tun interfaces
    Ok(output.contains("tun"))
}

#[tauri::command]
async fn save_config(app_handle: tauri::AppHandle, config: VpnConfig) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    // Create directory if it doesn't exist
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let path = app_dir.join("vpn_config.json");
    let content = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_config(app_handle: tauri::AppHandle) -> Result<Option<VpnConfig>, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let path = app_dir.join("vpn_config.json");

    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: VpnConfig = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(config))
}

#[tauri::command]
async fn check_permissions() -> Result<bool, String> {
    // Check if we can run openconnect with sudo without password
    // We use -n (non-interactive) to fail if password is required
    let output = Command::new("sudo")
        .arg("-n")
        .arg("openconnect")
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;

    Ok(output.status.success())
}

#[tauri::command]
async fn read_logs(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let log_path = app_dir.join("logs").join("vpn.log");

    if !log_path.exists() {
        return Ok("No logs found.".to_string());
    }

    std::fs::read_to_string(log_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_logs(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let log_path = app_dir.join("logs").join("vpn.log");

    if log_path.exists() {
        // Truncate file
        std::fs::write(log_path, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(VpnState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let status_i =
                MenuItem::with_id(app, "status", "Status: Disconnected", false, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show GlobalProtect", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status_i, &show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("GlobalProtect")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "show" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.set_always_on_top(true);
                            let _ = window.set_always_on_top(false);
                        }
                    } else if event.id.as_ref() == "quit" {
                        // Before exiting, disconnect VPN robustly
                        let _ = Command::new("sudo")
                            .arg("-n")
                            .arg("/usr/bin/pkill")
                            .arg("-f")
                            .arg("openconnect")
                            .status();
                        let _ = Command::new("sudo")
                            .arg("-n")
                            .arg("/usr/bin/pkill")
                            .arg("-9")
                            .arg("-f")
                            .arg("openconnect")
                            .status();
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { .. } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.set_always_on_top(true);
                            let _ = window.set_always_on_top(false);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Background thread to update status periodically
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_connected = false;
                loop {
                    let connected = {
                        let pgrep = Command::new("pgrep").arg("-f").arg("openconnect").output();
                        let ip_addr = Command::new("ip").arg("addr").arg("show").output();

                        let is_running = pgrep.map(|o| o.status.success()).unwrap_or(false);
                        let has_tun = ip_addr
                            .map(|o| String::from_utf8_lossy(&o.stdout).contains("tun"))
                            .unwrap_or(false);

                        is_running && has_tun
                    };

                    let text = if connected {
                        "Status: Connected ✅"
                    } else {
                        "Status: Disconnected ❌"
                    };

                    let _ = status_i.set_text(text);

                    // Update tray icon only if status changed
                    if connected != last_connected {
                        // Send system notification if enabled
                        let config_res = {
                            let app_dir = app_handle.path().app_data_dir().unwrap_or_default();
                            let path = app_dir.join("vpn_config.json");
                            if path.exists() {
                                std::fs::read_to_string(path).ok().and_then(|c| {
                                    serde_json::from_str::<VpnConfig>(&c).ok()
                                })
                            } else {
                                None
                            }
                        };

                        let notifications_enabled = config_res.as_ref().and_then(|c| c.notifications_enabled).unwrap_or(true);
                        
                        if notifications_enabled {
                            use tauri_plugin_notification::NotificationExt;
                            let title = if connected { "VPN Connected" } else { "VPN Disconnected" };
                            let body = if connected { 
                                format!("Successfully connected to {}", config_res.as_ref().map(|c| &c.portal).unwrap_or(&"portal".to_string()))
                            } else { 
                                "The VPN connection has been closed.".to_string()
                            };
                            
                            let _ = app_handle.notification()
                                .builder()
                                .title(title)
                                .body(body)
                                .show();
                        }

                        if let Some(tray) = app_handle.tray_by_id("main-tray") {
                            if connected {
                                // Try to load the green icon
                                if let Ok(img) =
                                    tauri::image::Image::from_path("icons/connected.png")
                                {
                                    let _ = tray.set_icon(Some(img));
                                }
                            } else {
                                // Back to default icon
                                let _ = tray.set_icon(Some(
                                    app_handle.default_window_icon().unwrap().clone(),
                                ));
                            }
                        }
                        last_connected = connected;
                    }

                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Handle minimize to tray
                tauri::WindowEvent::Resized(_) => {
                    if let Ok(true) = window.is_minimized() {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_openconnect,
            connect_vpn,
            disconnect_vpn,
            get_vpn_status,
            save_config,
            load_config,
            check_permissions,
            read_logs,
            clear_logs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } => {
                // Ensure VPN is killed when application fully exits
                let _ = Command::new("sudo")
                    .arg("-n")
                    .arg("/usr/bin/pkill")
                    .arg("-f")
                    .arg("openconnect")
                    .status();
                let _ = Command::new("sudo")
                    .arg("-n")
                    .arg("/usr/bin/pkill")
                    .arg("-9")
                    .arg("-f")
                    .arg("openconnect")
                    .status();
            }
            _ => {}
        });
}
