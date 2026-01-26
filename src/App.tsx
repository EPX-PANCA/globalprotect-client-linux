import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [portal, setPortal] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [view, setView] = useState<"main" | "settings" | "about">("main");
  const [rememberMe, setRememberMe] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [isManuallyDisconnected, setIsManuallyDisconnected] = useState(true);

  useEffect(() => {
    checkInstallation();
    loadStoredConfig();
    const interval = setInterval(updateStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadStoredConfig = async () => {
    try {
      const config = await invoke<{ portal: string, username: string, password?: string } | null>("load_config");
      if (config) {
        setPortal(config.portal);
        setUsername(config.username);
        if (config.password) {
          setPassword(config.password);
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

  const updateStatus = async () => {
    try {
      const isRunning = await invoke<boolean>("get_vpn_status");

      if (isRunning) {
        setStatus("connected");
        setRetryCount(0); // Reset retries on successful connection
      } else {
        if (status === "connected") {
          // Unexpected disconnection
          setStatus("disconnected");

          if (!isManuallyDisconnected && retryCount < 5) {
            const nextRetry = retryCount + 1;
            setRetryCount(nextRetry);
            setError(`Connection lost. Retrying (${nextRetry}/5)...`);

            // Wait 5 seconds before retrying
            setTimeout(() => {
              handleConnect(true);
            }, 5000);
          } else if (!isManuallyDisconnected && retryCount >= 5) {
            setError("Connection failed after 5 attempts. Please check your network.");
          }
        } else if (status === "connecting") {
          // Wait for connect_vpn to finish or updateStatus to catch it next time
        } else {
          setStatus("disconnected");
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnect = async (isRetry = false) => {
    setError(""); // Clear previous errors
    if (!isRetry) {
      setRetryCount(0);
      setIsManuallyDisconnected(false);
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
          password: rememberMe ? password : null
        }
      });

      // Update status immediately instead of waiting for interval
      setTimeout(updateStatus, 1000);
      setTimeout(updateStatus, 3000);
    } catch (e: any) {
      setError(e.toString());
      setStatus("disconnected");
    }
  };

  const handleDisconnect = async () => {
    setIsManuallyDisconnected(true);
    setRetryCount(0);
    try {
      await invoke("disconnect_vpn");
      setStatus("disconnected");
      setShowLogin(false);
    } catch (e: any) {
      setError(e.toString());
    }
  };

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
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8">
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
        <div className="flex items-center space-x-2 relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={`p-1 hover:bg-gray-100 rounded transition-colors ${showMenu ? 'bg-gray-100 text-gp-blue' : 'text-gray-400'}`}
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
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gp-bg flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                  <span>Home</span>
                </button>
                <button
                  onClick={() => { setView("settings"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gp-bg flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <span>Settings</span>
                </button>
                <div className="h-px bg-gray-100 my-1"></div>
                <button
                  onClick={() => { setView("about"); setShowMenu(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gp-bg flex items-center space-x-2"
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
              status === 'connecting' ? 'border-gp-blue animate-pulse' : 'border-gray-200'
              }`}>
              <svg className={`w-14 h-14 transition-colors duration-500 ${status === 'connected' ? 'text-gp-blue' : 'text-gray-300'
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
              status === 'connecting' ? 'Connecting...' : 'Not Connected'}
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

          {status === 'connecting' && (
            <div className="w-full w-full text-center space-y-6">
              <div className="flex flex-col items-center space-y-4">
                <div className="w-10 h-10 border-4 border-gp-blue border-t-transparent rounded-full animate-spin"></div>
                <div className="space-y-1">
                  <p className="text-gray-600 font-medium tracking-tight">Authenticating...</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Please check for password prompts</p>
                </div>
              </div>
              <button
                onClick={handleDisconnect}
                className="gp-button-secondary text-sm text-gray-400 hover:text-gp-blue"
              >
                Cancel
              </button>
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
                            config: { portal, username, password: rememberMe ? password : null }
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

                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Security</h3>
                  <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                    To connect without entering your root password every time, run this command in your terminal:
                  </p>
                  <div className="bg-gray-900 p-2 rounded text-[9px] font-mono text-blue-300 break-all mb-2 flex justify-between items-center group">
                    <span>echo "$USER ALL=(ALL) NOPASSWD: /usr/sbin/openconnect" | sudo tee /etc/sudoers.d/globalprotect</span>
                  </div>
                </div>

                <div className="h-px bg-gray-100"></div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Preferences</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Display Notifications</span>
                    <div className="w-10 h-5 bg-gp-blue rounded-full relative"><div className="absolute right-0.5 top-0.5 w-4 h-4 bg-white rounded-full"></div></div>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 text-center italic">Config location: ~/.local/share/globalprotect/</p>
            </div>
          </main>
        )
      }

      {
        view === "about" && (
          <main className="gp-content animate-in zoom-in-95 duration-300 overflow-y-auto max-h-[calc(100vh-100px)]">
            <div className="w-full w-full text-center space-y-4">
              <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
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
                  <circle cx="12" cy="11" r="3" fill="white" opacity="0.2" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-800">GlobalProtect</h2>
              <p className="text-sm text-gray-500 font-medium">Developed by EPX-PANCA & OpenConnect</p>
              <div className="bg-gray-100 p-3 rounded-md text-[10px] text-gray-400 space-y-1 font-mono uppercase tracking-wider">
                <p>v1.2.0 GP - Clone</p>
                <p>Backend: OpenConnect {ocInstalled ? '(Ready)' : '(Not Found)'}</p>
                <p>Architecture: x86_64</p>
              </div>
              <button onClick={() => setView("main")} className="gp-button-secondary text-sm font-bold">Back to Home</button>
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
        <span className="text-[8px]">v1.2.1 GP - Clone</span>
      </footer>
    </div >
  );
}

export default App;
