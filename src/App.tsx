import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [portal, setPortal] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected" | "disconnecting">("disconnected");
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [view, setView] = useState<"main" | "settings" | "about" | "logs">("main");
  const [rememberMe, setRememberMe] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoConnect, setAutoConnect] = useState(false);
  const isManuallyDisconnected = useRef(true);
  const statusRef = useRef(status);
  const [hasPermissionIssue, setHasPermissionIssue] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    checkInstallation();
    loadStoredConfig();
    checkPermissions();
  }, []);

  useEffect(() => {
    const interval = setInterval(updateStatus, 2000); // 2s is better for responsiveness
    return () => clearInterval(interval);
  }, [status, retryCount, portal, username, password]); // Depend on relevant state to avoid stale closures


  const loadStoredConfig = async () => {
    try {
      const config = await invoke<{ portal: string, username: string, password?: string, notifications_enabled?: boolean, auto_connect?: boolean } | null>("load_config");
      if (config) {
        setPortal(config.portal);
        setUsername(config.username);
        if (config.password) {
          setPassword(config.password);
        }
        if (config.notifications_enabled !== undefined && config.notifications_enabled !== null) {
          setNotificationsEnabled(config.notifications_enabled);
        }
        if (config.auto_connect !== undefined && config.auto_connect !== null) {
          setAutoConnect(config.auto_connect);
          // If auto-connect is enabled and we have everything we need, try to connect
          if (config.auto_connect && config.portal && config.username && config.password) {
            // Use setTimeout to ensure state is settled
            setTimeout(() => {
              handleConnect(false);
            }, 1000);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load config", e);
    }
  };

  const checkInstallation = async () => {
    const installed = await invoke<boolean>("check_openconnect");
    setOcInstalled(installed);
  };

  const checkPermissions = async () => {
    try {
      // Returns true if permissions are OK (passwordless), false if permission denied (needs password)
      const isOk = await invoke<boolean>("check_permissions");
      setHasPermissionIssue(!isOk);
    } catch (e) {
      console.error("Failed to check permissions", e);
      // Assume issue if check fails
      setHasPermissionIssue(true);
    }
  };

  const updateStatus = async () => {
    // If offline, we want to show "Connecting..." (reconnecting) instead of "Connected"
    // This gives immediate feedback that something is wrong without kicking the user to login.
    if (!navigator.onLine) {
      setStatus(prev => {
        if (prev === 'connected') return 'connecting';
        return prev;
      });
      // We don't return here, we let the logic proceed or just pause retry counting?
      // If we return, we stop checking pgrep.
      return;
    }

    try {
      const isRunning = await invoke<boolean>("get_vpn_status");

      setStatus(currentStatus => {
        if (isRunning) {
          if (currentStatus !== "connected") {
            setRetryCount(0);
          }
          return "connected";
        } else {
          // If we are currently "connected" and it stops running, start retry logic
          if (currentStatus === "connected") {
            if (!isManuallyDisconnected.current && retryCount < 5) {
              const nextRetry = retryCount + 1;
              setRetryCount(nextRetry);
              setError(`Connection lost. Retrying (${nextRetry}/5)...`);
              setTimeout(() => handleConnect(true), 5000);
            } else if (!isManuallyDisconnected.current && retryCount >= 5) {
              setError("Connection failed after 5 attempts.");
            }
            return "disconnected";
          }
          // If we are already in a transition state, DON'T overwrite it with "disconnected"
          if (currentStatus === "connecting" || currentStatus === "disconnecting") {
            return currentStatus;
          }
          return "disconnected";
        }
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnect = async (isRetry = false) => {
    setError(""); // Clear previous errors
    if (!isRetry) {
      setRetryCount(0);
      isManuallyDisconnected.current = false;
    }

    if (!portal) {
      setError("Portal URL is required");
      return;
    }

    // If login view is hidden, check if we can auto-connect
    if (!showLogin) {
      if (username && password) {
        // We have credentials, proceed to connecting
      } else {
        setShowLogin(true);
        return;
      }
    } else {
      // In login view, check for credentials
      if (!username || !password) {
        setError("Please enter username and password");
        return;
      }
    }

    setError("");
    setStatus("connecting");
    try {
      await invoke("connect_vpn", {
        config: { portal, username, password }
      });

      // Save config
      await invoke("save_config", {
        config: {
          portal,
          username,
          password: rememberMe ? password : null,
          notifications_enabled: notificationsEnabled,
          auto_connect: autoConnect
        }
      });

      // Polling for success with timeout
      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;
        const isUp = await invoke<boolean>("get_vpn_status");
        if (isUp) {
          setStatus("connected");
          clearInterval(checkInterval);
        } else if (attempts > 15) { // 15 seconds timeout
          clearInterval(checkInterval);
          setStatus(curr => curr === "connected" ? "connected" : "disconnected");
          setError("Connection timeout. Please check your credentials/portal.");
        }
      }, 1000);

    } catch (e: any) {
      setError(e.toString());
      setStatus("disconnected");
    }
  };

  const handleDisconnect = async () => {
    isManuallyDisconnected.current = true;
    setRetryCount(0);
    setStatus("disconnecting");
    try {
      await invoke("disconnect_vpn");
      // Give it a moment to clear
      setTimeout(() => {
        setStatus("disconnected");
        setShowLogin(false);
      }, 800);
    } catch (e: any) {
      setError(e.toString());
      setStatus("connected"); // Revert if failed
    }
  };

  // Listen for network events
  useEffect(() => {
    const handleOffline = () => {
      // When offline, switch to 'connecting' to indicate we are waiting for network
      if (statusRef.current === 'connected') {
        setStatus("connecting");
        setError("Network connection lost. Waiting for internet...");
      }
    };

    const handleOnline = () => {
      // When back online, if we were waiting (connecting) and not manually disconnected, try to reconnect
      if (statusRef.current === 'connecting' && !isManuallyDisconnected.current) {
        // Add a small delay to ensure network interfaces are up
        setTimeout(() => handleConnect(true), 1000);
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [handleConnect]); // handleConnect is a dependency


  if (ocInstalled === false) {
    return (
      <div className="gp-window flex items-center justify-center p-8 text-center">
        <div className="space-y-4">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold">OpenConnect Not Found</h1>
          <p className="text-gray-600">Please install openconnect to use this app:</p>
          <code className="block bg-gray-100 p-2 rounded">sudo apt install openconnect</code>
          <button
            onClick={checkInstallation}
            className="gp-button w-full mt-4"
          >
            Check Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gp-window font-sans relative">
      <header className="gp-header shadow-sm z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7">
            <svg className="w-full h-full" viewBox="0 0 24 24">
              <defs>
                <linearGradient id="headerShieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style={{ stopColor: '#0055d2', stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: '#00c6ff', stopOpacity: 1 }} />
                </linearGradient>
              </defs>
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="url(#headerShieldGradient)" />
            </svg>
          </div>
          <span className="font-semibold text-gray-700">GlobalProtect</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={`p-1.5 hover:bg-gray-100 rounded transition-colors ${showMenu ? 'bg-gray-100 text-gp-blue' : 'text-gray-400'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Hamburger Dropdown */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)}></div>
              <div className="absolute right-0 top-full mt-1 w-48 bg-white shadow-xl rounded-md border border-gray-100 py-1 z-40">
                <button
                  onClick={() => { setView("main"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gp-bg flex items-center gap-3 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  <span>Home</span>
                </button>
                <button
                  onClick={() => { setView("settings"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gp-bg flex items-center gap-3 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <span>Settings</span>
                </button>
                <button
                  onClick={() => { setView("logs"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gp-bg flex items-center gap-3 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <span>Logs</span>
                </button>
                <button
                  onClick={() => { setView("about"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gp-bg flex items-center gap-3 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>About</span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {view === "main" && (
        <main className="gp-content animate-in fade-in duration-300">
          {/* Globe Animation */}
          <div className="relative mb-4 text-gp-blue transition-all duration-300">
            <div className={`w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all duration-1000 ${status === 'connected' ? 'border-gp-blue shadow-[0_0_20px_rgba(0,163,224,0.4)]' :
              status === 'connecting' || status === 'disconnecting' ? 'border-gp-blue animate-pulse' : 'border-gray-200'
              }`}>
              <svg className={`w-14 h-14 transition-colors duration-500 ${status === 'connected' ? 'text-gp-blue' :
                status === 'connecting' || status === 'disconnecting' ? 'text-gp-blue/60' : 'text-gray-300'
                }`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            {status === 'connected' && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-4 border-white rounded-full"></div>
            )}
          </div>

          <h2 className="text-xl font-light text-gray-800 mb-1">
            {status === 'connected' ? 'Connected' :
              status === 'connecting' ? 'Connecting...' :
                status === 'disconnecting' ? 'Disconnecting...' : 'Not Connected'}
          </h2>

          {status === 'disconnected' && !showLogin && (
            <div className="w-full space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-gray-400 font-bold ml-1 uppercase tracking-wider">Portal</label>
                <input
                  type="text"
                  className="gp-input"
                  placeholder="portal.example.com"
                  value={portal}
                  onChange={(e) => setPortal(e.target.value)}
                />
              </div>
              {error && <p className="text-red-500 text-xs italic bg-red-50 p-2 rounded border border-red-100">{error}</p>}
              <button
                onClick={() => handleConnect()}
                className="gp-button w-full shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
              >
                Connect
              </button>
            </div>
          )}

          {status === 'disconnected' && showLogin && (
            <div className="w-full space-y-4">
              <div className="text-center mb-2">
                <p className="text-xs font-bold text-gp-blue uppercase tracking-widest">{portal}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 font-bold ml-1 uppercase tracking-wider">Username</label>
                <input
                  type="text"
                  className="gp-input"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400 font-bold ml-1 uppercase tracking-wider">Password</label>
                <input
                  type="password"
                  className="gp-input"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2 ml-1">
                <input
                  type="checkbox"
                  id="remember"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-gp-blue focus:ring-gp-blue"
                />
                <label htmlFor="remember" className="text-xs text-gray-500 font-medium cursor-pointer">Remember Me</label>
              </div>
              {error && <p className="text-red-500 text-xs italic bg-red-50 p-2 rounded border border-red-100">{error}</p>}
              <div className="flex flex-col space-y-2 pt-2">
                <button
                  onClick={() => handleConnect()}
                  className="gp-button w-full shadow-lg shadow-gp-blue/20 active:scale-[0.98] transition-all"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setShowLogin(false); setError(""); }}
                  className="gp-button-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {status === 'connected' && (
            <div className="w-full w-full space-y-6 text-center">
              <div className="space-y-1">
                <p className="text-gray-400 text-[10px] uppercase font-bold tracking-tighter">Connection Portal</p>
                <p className="font-semibold text-gray-700">{portal}</p>
              </div>
              <button
                onClick={handleDisconnect}
                className="gp-button w-full !bg-white !text-gp-blue border border-gp-blue hover:!bg-gp-blue hover:!text-white transition-all shadow-sm"
              >
                Disconnect
              </button>
            </div>
          )}

          {status === 'disconnecting' && (
            <div className="w-full w-full text-center space-y-6">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-10 h-10 border-4 border-gray-300 border-t-gp-blue rounded-full animate-spin"></div>
                <div className="space-y-1">
                  <p className="text-gray-600 font-medium tracking-tight">Closing connection...</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Stopping openconnect</p>
                </div>
              </div>
            </div>
          )}
        </main>
      )
      }

      {
        view === "settings" && (
          <main className="gp-content animate-in slide-in-from-right duration-300 !justify-start pt-8 overflow-y-auto max-h-[calc(100vh-100px)]">
            <div className="w-full w-full space-y-6">
              <div className="flex items-center space-x-2 mb-4">
                <button onClick={() => setView("main")} className="p-1 hover:bg-gray-100 rounded text-gray-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
                </button>
                <h2 className="text-xl font-semibold text-gray-800">Settings</h2>
              </div>
              <div className="bg-white p-4 rounded-lg border border-gray-200 space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Account Management</h3>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 font-bold uppercase">Portal URL</label>
                      <input
                        type="text"
                        className="gp-input text-sm"
                        value={portal}
                        onChange={(e) => setPortal(e.target.value)}
                        placeholder="portal.example.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 font-bold uppercase">Username</label>
                      <input
                        type="text"
                        className="gp-input text-sm"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Username"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-400 font-bold uppercase">Password</label>
                      <input
                        type="password"
                        className="gp-input text-sm"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await invoke("save_config", {
                            config: {
                              portal,
                              username,
                              password: rememberMe ? password : null,
                              notifications_enabled: notificationsEnabled,
                              auto_connect: autoConnect
                            }
                          });
                          alert("Settings saved successfully!");
                        } catch (e) {
                          alert("Failed to save: " + e);
                        }
                      }}
                      className="gp-button !py-2 w-full text-xs font-bold"
                    >
                      Update & Save
                    </button>
                  </div>
                </div>

                <div className="h-px bg-gray-100"></div>

                {hasPermissionIssue && (
                  <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Security</h3>
                    <div className="bg-yellow-50 border border-yellow-100 p-3 rounded-lg mb-3">
                      <p className="text-[10px] text-yellow-700 font-medium flex items-center gap-2 mb-1">
                        <span className="text-xl">⚠️</span>
                        Root permissions required
                      </p>
                      <p className="text-[10px] text-gray-500 mb-2 leading-relaxed">
                        To fix this, please run the following command to allow GlobalProtect to run without a password:
                      </p>
                      <div className="bg-gray-900 p-2 rounded text-[9px] font-mono text-blue-300 break-all flex justify-between items-center group relative">
                        <span>echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/openconnect" | sudo tee /etc/sudoers.d/globalprotect</span>
                      </div>
                    </div>
                  </div>
                )}

                {hasPermissionIssue && <div className="h-px bg-gray-100"></div>}

                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Preferences</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Display Notifications</span>
                    <button
                      onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                      className={`w-10 h-5 rounded-full relative transition-colors duration-200 focus:outline-none ${notificationsEnabled ? 'bg-gp-blue' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all duration-200 ${notificationsEnabled ? 'right-0.5' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Auto-Connect on Startup</span>
                    <button
                      onClick={() => setAutoConnect(!autoConnect)}
                      className={`w-10 h-5 rounded-full relative transition-colors duration-200 focus:outline-none ${autoConnect ? 'bg-gp-blue' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all duration-200 ${autoConnect ? 'right-0.5' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">Config location: ~/.local/share/globalprotect/</p>
            </div>
          </main>
        )
      }

      {
        view === "logs" && <LogsView onBack={() => setView("main")} />
      }

      {
        view === "about" && (
          <main className="gp-content animate-in zoom-in-95 duration-300 overflow-y-auto max-h-[calc(100vh-100px)]">
            <div className="w-full text-center space-y-4">
              <div className="w-16 h-16 mx-auto mb-2 flex items-center justify-center">
                <svg className="w-full h-full" viewBox="0 0 24 24">
                  <defs>
                    <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{ stopColor: '#0055d2', stopOpacity: 1 }} />
                      <stop offset="100%" style={{ stopColor: '#00c6ff', stopOpacity: 1 }} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"
                    fill="url(#shieldGradient)"
                  />
                  <path d="M12 3.3l6.5 2.89v4.81c0 4.38-2.98 8.16-6.5 9.17-3.52-1.01-6.5-4.79-6.5-9.17V6.19L12 3.3z" fill="white" opacity="0.1" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-800">GlobalProtect for Linux</h2>
              <p className="text-xs text-gray-500 px-4 leading-relaxed">
                A modern desktop client for GlobalProtect VPN, designed specifically for the Linux community.
              </p>
              <p className="text-[10px] text-gp-blue font-bold uppercase tracking-widest">
                Created by <a href="https://github.com/EPX-PANCA" target="_blank" rel="noopener noreferrer" className="hover:underline">EPX-PANCA</a>
              </p>

              <div className="space-y-4 px-2 pt-2">
                <div className="text-left bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                  <h3 className="text-[10px] font-bold text-gp-blue uppercase tracking-widest mb-1">Core Engine</h3>
                  <p className="text-xs text-gray-600 leading-tight">
                    Powered by <a href="https://www.infradead.org/openconnect/" target="_blank" rel="noopener noreferrer" className="text-gp-blue hover:underline font-bold">OpenConnect</a>, the open-source client for Cisco AnyConnect and Palo Alto GlobalProtect.
                  </p>
                  <p className="text-[9px] text-gray-400 mt-1 italic">Special thanks to the OpenConnect community.</p>
                </div>

                <div className="text-left bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                  <h3 className="text-[10px] font-bold text-gp-blue uppercase tracking-widest mb-1">Framework</h3>
                  <p className="text-xs text-gray-600 leading-tight">
                    Built with <a href="https://tauri.app/" target="_blank" rel="noopener noreferrer" className="text-gp-blue hover:underline font-bold">Tauri</a> and <a href="https://react.dev/" target="_blank" rel="noopener noreferrer" className="text-gp-blue hover:underline font-bold">React</a> for a lightweight and secure experience.
                  </p>
                </div>

                <div className="bg-gray-50 p-3 rounded-md text-[9px] text-gray-400 space-y-1 font-mono uppercase tracking-wider text-left border border-gray-100">
                  <div className="flex justify-between">
                    <span>Backend</span>
                    <span className={ocInstalled ? "text-green-600 font-bold" : "text-red-500"}>{ocInstalled ? 'OpenConnect Ready' : 'OC Not Found'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Architecture</span>
                    <span>x86_64 Linux</span>
                  </div>
                </div>
              </div>

              <button onClick={() => setView("main")} className="gp-button-secondary text-xs font-bold py-2 px-6">Back to Dashboard</button>
            </div>
          </main>
        )
      }

      <footer className="p-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 uppercase tracking-widest">
        <a href="https://github.com/EPX-PANCA" target="_blank" rel="noopener noreferrer" className="hover:text-gp-blue transition-all">
          <svg className="w-6 h-6 opacity-70 hover:opacity-100" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
        </a>
        <span className="text-[8px]">v1.2.2 for Linux</span>
      </footer>
    </div >
  );
}

const LogsView = ({ onBack }: { onBack: () => void }) => {
  const [logs, setLogs] = useState("Loading logs...");

  useEffect(() => {
    let isMounted = true;
    const fetchLogs = async () => {
      try {
        const content = await invoke<string>("read_logs");
        if (isMounted) {
          setLogs(content);
        }
      } catch (e) {
        if (isMounted) setLogs("Failed to load logs: " + e);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll effect when logs change
  useEffect(() => {
    const el = document.getElementById("log-viewer");
    if (el) {
      // Auto-scroll if near bottom or initial load
      const isScrolledToBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 100;
      if (isScrolledToBottom || logs.length < 1000) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [logs]);

  const handleClear = async () => {
    try {
      await invoke("clear_logs");
      setLogs("");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <main className="gp-content animate-in slide-in-from-right duration-300 !justify-start pt-8 overflow-y-auto max-h-[calc(100vh-100px)]">
      <div className="w-full w-full space-y-6">
        {/* Header - Matching Settings View */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h2 className="text-xl font-semibold text-gray-800">Connection Logs</h2>
          </div>
          <button
            onClick={handleClear}
            className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Clear
          </button>
        </div>

        {/* Terminal Window */}
        <div className="bg-[#1e1e1e] rounded-lg shadow-md border border-gray-700 flex flex-col overflow-hidden">
          {/* Terminal Header */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#2d2d2d] border-b border-gray-700 select-none">
            <div className="text-[10px] text-gray-400 font-mono">vpn.log</div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Live</span>
            </div>
          </div>

          {/* Terminal Content */}
          <div className="relative h-64">
            <pre
              id="log-viewer"
              className="absolute inset-0 p-3 overflow-auto text-[10px] font-mono leading-relaxed text-gray-300 whitespace-pre-wrap break-all custom-scrollbar selection:bg-gray-700 selection:text-white"
              style={{ fontFamily: "monospace" }}
            >
              {logs || <span className="text-gray-500 italic">No logs available.</span>}
            </pre>
          </div>
        </div>

        <p className="text-[10px] text-gray-400 text-center italic">
          Logs are stored locally at <code className="bg-gray-100 px-1 rounded text-gray-500 not-italic">~/.local/share/globalprotect/logs/</code>
        </p>
      </div>
    </main>
  );
};

export default App;
