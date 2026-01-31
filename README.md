# GlobalProtect Client for Linux 🛡️

A modern, fast, and sleek GlobalProtect VPN client built with **Tauri**, **React**, and **OpenConnect**. 

Designed as a **free, open-source alternative** for the Linux community who need a reliable GlobalProtect connection without the hassle. If you've been looking for a way to connect to your corporate VPN on Linux with a native-feeling experience, smooth system tray integration, and seamless credential management — **this is your solution**.

<p align="center">
  <img src="screenshots/main_view.png" alt="GlobalProtect Client Main View" width="300">
</p>

![Status: Release](https://img.shields.io/badge/Status-Release-blue?style=for-the-badge)
![Platform: Linux](https://img.shields.io/badge/Platform-Linux-orange?style=for-the-badge)
![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

## Key Features ✨

-   **Connection Logs**: Real-time log viewer to monitor connection status and troubleshoot issues.
-   **Enhanced Connectivity**: Auto-reconnect logic handles network interruptions gracefully.
-   **Security Checks**: Built-in validation allows you to fix permission issues effortlessly.
-   **Zero-Password Connection**: No root password prompt every time you connect (via automated security policy).
-   **System Tray Integration**: Live connection status (Connected ✅ / Disconnected ❌) directly in your panel.
-   **Smart Auto-Connect**: Automatically connects if credentials are saved.
-   **Modern UI**: Sleek, compact design (width 288px) that looks great on any desktop.
-   **Credential Management**: Safely store and manage your portal, username, and password in Settings.
-   **Multi-Distro Support**: Available in `.deb` (Debian/Ubuntu) and `.rpm` (Fedora/RHEL) formats.

## Installation 🚀

### Debian / Ubuntu / Linux Mint / Kali
1. Download the latest `.deb` package from the [Releases](https://github.com/EPX-PANCA/globalprotect-client-linux/releases) page.
2. Install it using `apt` to automatically fetch dependencies:
    ```bash
    sudo apt install ./GlobalProtect_1.2.2_amd64.deb
    ```

### Fedora / RHEL / CentOS
1. Download the latest `.rpm` package from the [Releases](https://github.com/EPX-PANCA/globalprotect-client-linux/releases) page.
2. Install it using `dnf`:
    ```bash
    sudo dnf install ./GlobalProtect-1.2.2-1.x86_64.rpm
    ```

### AppImage (Universal Linux)
1. Download the `.AppImage` file.
2. Make it executable:
    ```bash
    chmod +x GlobalProtect_1.2.2_amd64.AppImage
    ```
3. Run it:
    ```bash
    ./GlobalProtect_1.2.2_amd64.AppImage
    ```
    > **Note**: Do not run the AppImage with `sudo`. Instead, follow the security tip below to allow the internal VPN process to run with privileges.
    >
    > **Compatibility**: AppImage is primarily tested on **Debian-based** distributions (Ubuntu, Linux Mint, Kali). Fedora/RHEL users are recommended to use the native `.rpm` installer for best results.

## Post-Installation Security Tip 🔑

To enable **connection without root password prompts** in development mode or if your installer didn't automatically apply the policy, run this command once:

```bash
echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/openconnect" | sudo tee /etc/sudoers.d/globalprotect
```

## Development Setup 🛠️

Requirements:
-   Node.js (v20+)
-   Rust (stable)
-   OpenConnect (`sudo apt install openconnect`)

```bash
# Clone the repository
git clone https://github.com/EPX-PANCA/globalprotect-client-linux.git

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build production installer
npm run tauri build
```

## Credits 🤝

Developed by [EPX-PANCA](https://github.com/EPX-PANCA). Powered by [Tauri](https://tauri.app/) and [OpenConnect](https://www.infradead.org/openconnect/).

---
*v1.2.2 for Linux*
