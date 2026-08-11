use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
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

const OPENCONNECT_HELPER: &str = "/usr/libexec/globalprotect/openconnect-helper";
const VPN_INTERFACE: &str = "globalprotect";

fn sudo_path() -> PathBuf {
    ["/usr/bin/sudo", "/bin/sudo"]
        .iter()
        .map(Path::new)
        .find(|path| path.is_file())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("sudo"))
}

fn openconnect_path() -> Option<PathBuf> {
    [
        "/usr/sbin/openconnect",
        "/usr/bin/openconnect",
        "/sbin/openconnect",
        "/bin/openconnect",
    ]
    .iter()
    .map(Path::new)
    .find(|path| path.is_file())
    .map(Path::to_path_buf)
}

fn command_path() -> Result<PathBuf, String> {
    if Path::new(OPENCONNECT_HELPER).is_file() {
        Ok(PathBuf::from(OPENCONNECT_HELPER))
    } else {
        openconnect_path()
            .ok_or_else(|| "OpenConnect was not found in /usr/sbin or /usr/bin".to_string())
    }
}

fn stop_child(child: &Arc<Mutex<Option<Child>>>) -> Result<(), String> {
    let mut child_guard = child.lock().map_err(|_| "Failed to lock VPN state")?;
    if let Some(mut process) = child_guard.take() {
        let process_id = process.id();
        let _ = process.kill();

        if !matches!(process.try_wait(), Ok(Some(_))) && Path::new(OPENCONNECT_HELPER).is_file() {
            let _ = Command::new(sudo_path())
                .args(["-n", OPENCONNECT_HELPER, "--stop"])
                .status();
        }

        for _ in 0..20 {
            match process.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(_) => break,
            }
        }

        *child_guard = Some(process);
        return Err(format!("Unable to stop VPN process {}", process_id));
    }
    Ok(())
}

fn child_is_running(child: &Arc<Mutex<Option<Child>>>) -> bool {
    let Ok(mut child_guard) = child.lock() else {
        return false;
    };

    let Some(process) = child_guard.as_mut() else {
        return false;
    };

    match process.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => {
            child_guard.take();
            false
        }
    }
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

#[tauri::command]
async fn check_openconnect() -> Result<bool, String> {
    let Some(path) = openconnect_path() else {
        return Ok(false);
    };

    let output = Command::new(path)
        .arg("--version")
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
    stop_child(&state.child)?;

    let helper_available = Path::new(OPENCONNECT_HELPER).is_file();
    let command = command_path()?;

    // -n prevents sudo from consuming the VPN password when the policy is missing.
    let mut cmd = Command::new(sudo_path());
    cmd.arg("-n").arg(command);
    if helper_available {
        cmd.arg(&config.portal).arg(&config.username);
    } else {
        cmd.arg("--protocol=gp")
            .arg("--passwd-on-stdin")
            .arg(format!("--interface={VPN_INTERFACE}"))
            .arg(&config.portal)
            .arg("--user")
            .arg(&config.username);
    }

    // Setup logging
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let logs_dir = app_dir.join("logs");
    ensure_private_directory(&logs_dir)?;

    let log_path = logs_dir.join("vpn.log");
    let mut log_options = std::fs::OpenOptions::new();
    log_options.create(true).append(true);
    #[cfg(unix)]
    log_options.mode(0o600);
    let log_file = log_options
        .open(&log_path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;
    #[cfg(unix)]
    log_file
        .set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;

    // Log start attempt
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).open(&log_path) {
        let _ = writeln!(
            file,
            "\n--- Connection Attempt: {} ---",
            chrono::Local::now()
        );
    }

    let stderr_log = log_file.try_clone().map_err(|e| e.to_string())?;

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr_log));

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start openconnect: {}", e))?;

    // Always close stdin so a missing password cannot leave OpenConnect blocked.
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(password) = config.password {
            use std::io::Write;
            let _ = writeln!(stdin, "{}", password);
        }
    }

    let mut child_guard = state.child.lock().map_err(|_| "Failed to lock state")?;
    *child_guard = Some(child);

    Ok(())
}

#[tauri::command]
async fn disconnect_vpn(state: State<'_, VpnState>) -> Result<(), String> {
    stop_child(&state.child)
}

#[tauri::command]
async fn get_vpn_status(state: State<'_, VpnState>) -> Result<bool, String> {
    Ok(child_is_running(&state.child) && Path::new("/sys/class/net/globalprotect").exists())
}

#[tauri::command]
async fn save_config(app_handle: tauri::AppHandle, config: VpnConfig) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    // Create directory if it doesn't exist
    ensure_private_directory(&app_dir)?;

    let path = app_dir.join("vpn_config.json");
    let content = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
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
    let helper_available = Path::new(OPENCONNECT_HELPER).is_file();
    let command = command_path()?;
    let mut check = Command::new(sudo_path());
    check.arg("-n").arg(command);
    if helper_available {
        check.arg("--check");
    } else {
        check.arg("--version");
    }
    let output = check
        .stdout(Stdio::null())
        .stderr(Stdio::null())
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
                        }
                    } else if event.id.as_ref() == "quit" {
                        let state = app.state::<VpnState>();
                        let _ = stop_child(&state.child);
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
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Background thread to update status periodically
            let app_handle = app.handle().clone();
            let vpn_child = app.state::<VpnState>().child.clone();
            std::thread::spawn(move || {
                let mut last_connected = false;
                loop {
                    let connected = child_is_running(&vpn_child)
                        && Path::new("/sys/class/net/globalprotect").exists();

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
                                std::fs::read_to_string(path)
                                    .ok()
                                    .and_then(|c| serde_json::from_str::<VpnConfig>(&c).ok())
                            } else {
                                None
                            }
                        };

                        let notifications_enabled = config_res
                            .as_ref()
                            .and_then(|c| c.notifications_enabled)
                            .unwrap_or(true);

                        if notifications_enabled {
                            use tauri_plugin_notification::NotificationExt;
                            let title = if connected {
                                "VPN Connected"
                            } else {
                                "VPN Disconnected"
                            };
                            let body = if connected {
                                format!(
                                    "Successfully connected to {}",
                                    config_res
                                        .as_ref()
                                        .map(|c| &c.portal)
                                        .unwrap_or(&"portal".to_string())
                                )
                            } else {
                                "The VPN connection has been closed.".to_string()
                            };

                            let _ = app_handle
                                .notification()
                                .builder()
                                .title(title)
                                .body(body)
                                .show();
                        }

                        if let Some(tray) = app_handle.tray_by_id("main-tray") {
                            if connected {
                                // Try to load the green icon
                                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!(
                                    "../icons/connected.png"
                                )) {
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
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } => {
                let state = app_handle.state::<VpnState>();
                let _ = stop_child(&state.child);
            }
            _ => {}
        });
}
