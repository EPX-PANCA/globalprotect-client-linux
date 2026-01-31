# Changelog

All notable changes to this project will be documented in this file.

## [1.2.2] - 2026-01-31

### Added
- **Connection Logs**: Introduce a dedicated logs view (`Logs`) accessible from the hamburger menu. Users can now view real-time logs of the VPN connection process (`~/.local/share/globalprotect/logs/vpn.log`).
- **Security Permission Check**: Added a proactive check on startup to verify if `openconnect` can be run without a password. If not, a warning and a fix command are displayed in the Settings menu.
- **Log Management**: Logic to automatically create the log directory if it doesn't exist and a "Clear" button to wipe logs.

### Changed
- **Reconnection Logic**: Improved network handling. Instead of immediately disconnecting when the internet is lost, the app now enters a "Connecting..." state and attempts to auto-reconnect when the network is restored.
- **UI/UX**: Refined the Logs view to match the aesthetic of the Settings page, including a minimal terminal-style viewer.
- **Dependencies**: Updated backend dependencies for better stability.

### Fixed
- **React Hook Issues**: Resolved `Rendered fewer hooks than expected` error by refactoring the Logs view into its own component.
- **Compilation Errors**: Fixed duplicate macro definitions in Rust backend.

## [1.2.1] - 2026-01-28

### Added
- **Auto-Reconnect**: Added retry logic (up to 5 attempts) if the VPN connection drops unexpectedly.
- **Graceful Exit**: Ensure `openconnect` processes are correctly terminated when the app closes.

### Fixed
- **Ghost Processes**: Fixed an issue where `openconnect` would persist in the background after closing the app.

---
