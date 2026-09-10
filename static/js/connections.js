// Connection Modal and API Logic

function initConnections() {
    const connectBtn = document.getElementById("ide-btn-connect");
    const saveBtn    = document.getElementById("btnSaveConnection");
    const testBtn    = document.getElementById("btnTestConnection");
    const modalEl    = document.getElementById("connectionModal");
    const connForm   = document.getElementById("connectionForm");

    if (!connectBtn || !modalEl || !saveBtn) return {};
    // Initialize Bootstrap Modal
    const bsModal = new bootstrap.Modal(modalEl);
    
    // Form elements
    const fName = document.getElementById("connName");
    const fType = document.getElementById("connType");
    const fHost = document.getElementById("connHost");
    const fPort = document.getElementById("connPort");
    const fDb = document.getElementById("connDb");
    const fWinAuth = document.getElementById("connWinAuth");
    const fEncrypt = document.getElementById("connEncrypt");
    const fTrustCert = document.getElementById("connTrustCert");
    const fDriver = document.getElementById("connDriver");
    const fTimeout = document.getElementById("connTimeout");
    const sqlServerOptions = document.getElementById("connSqlServerOptionsGroup");
    const fUser = document.getElementById("connUser");
    const fPass = document.getElementById("connPass");
    
    // Load last used profile from localStorage
    function loadProfile() {
        const saved = localStorage.getItem("ide_last_connection");
        if (saved) {
            try {
                const data = JSON.parse(saved);
                fName.value = data.name || "";
                fType.value = data.type || "sqlserver";
                fHost.value = data.server || data.host || "localhost";
                fPort.value = data.port || "";
                fDb.value = data.database || "";
                fWinAuth.checked = data.trusted_connection || false;
                if (fEncrypt) {
                    fEncrypt.checked = data.encrypt !== undefined ? Boolean(data.encrypt) : (data.ssl !== undefined ? Boolean(data.ssl) : false);
                }
                if (fTrustCert) {
                    fTrustCert.checked = data.trust_server_certificate !== undefined ? Boolean(data.trust_server_certificate) : true;
                }
                if (fDriver && data.driver) {
                    fDriver.value = data.driver;
                }
                if (fTimeout && data.timeout) {
                    fTimeout.value = data.timeout;
                }
                fUser.value = data.username || "";
                // Do not load password for security
                fPass.value = ""; 
            } catch (e) {
                console.error("Error loading profile", e);
            }
        }
    }
    
    function buildPayload() {
        if (!fName.value || !fHost.value) {
            alert("Connection Name and Host are required!");
            return null;
        }
        
        const payload = {
            name: fName.value,
            type: fType.value,
            port: fPort.value ? parseInt(fPort.value) : null,
            database: fDb.value
        };
        
        if (fType.value === "sqlserver") {
            payload.server = fHost.value;
            payload.trusted_connection = fWinAuth.checked;
            payload.encrypt = fEncrypt ? fEncrypt.checked : false;
            payload.trust_server_certificate = fTrustCert ? fTrustCert.checked : true;
            if (fDriver && fDriver.value) {
                payload.driver = fDriver.value;
            }
            if (fTimeout && fTimeout.value) {
                payload.timeout = parseInt(fTimeout.value) || 30;
            }
        } else {
            payload.host = fHost.value;
        }

        // Only send username/password if not using windows auth
        if (!payload.trusted_connection) {
            payload.username = fUser.value;
            payload.password = fPass.value;
        }
        
        return payload;
    }

    // Toggle Username/Password visibility based on Windows Auth
    const credGroup = document.getElementById('connCredentialsGroup');
    function syncAuthUI() {
        if (!credGroup) return;
        credGroup.style.display = (fType.value === "sqlserver" && fWinAuth.checked) ? 'none' : '';
        const disableCreds = fType.value === "sqlserver" && fWinAuth.checked;
        if (fUser) fUser.disabled = disableCreds;
        if (fPass) fPass.disabled = disableCreds;
    }
    fWinAuth.addEventListener('change', syncAuthUI);

    // Toggle password visibility in Connection Modal
    const togglePassBtn = document.getElementById("btnToggleConnPass");
    if (togglePassBtn && fPass) {
        togglePassBtn.addEventListener("click", () => {
            const isPassword = fPass.type === "password";
            fPass.type = isPassword ? "text" : "password";
            const icon = togglePassBtn.querySelector("i");
            if (icon) {
                icon.className = isPassword ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
            }
        });
    }

    // Toggle SQL Server specific options when database type changes
    function syncTypeUI() {
        const isSqlServer = fType.value === "sqlserver";
        if (sqlServerOptions) {
            sqlServerOptions.style.display = isSqlServer ? "" : "none";
        }
        if (fPort && !fPort.value) {
            fPort.placeholder = isSqlServer ? "1433" : "5432";
        }
        syncAuthUI();
    }
    fType.addEventListener("change", syncTypeUI);

    syncAuthUI(); // apply on load
    syncTypeUI();

    // Open Modal
    connectBtn.addEventListener("click", () => {
        loadProfile();
        syncTypeUI();
        syncAuthUI();
        bsModal.show();
    });
    
    // Test Connection
    if (testBtn) {
        testBtn.addEventListener("click", async () => {
            const payload = buildPayload();
            if (!payload) return;

            testBtn.disabled = true;
            testBtn.textContent = "Testing…";

            try {
                const res = await fetch("/api/connections", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (res.ok && data.connection?.connection_id) {
                    // Clean up the test connection immediately
                    await fetch(`/api/connections/${data.connection.connection_id}`, { method: "DELETE" });
                    showToast("✓ Test connection succeeded!", 'success');
                } else {
                    showToast("Test failed: " + (data.error || "Unknown error"), 'danger');
                }
            } catch (e) {
                showToast("Network error: " + e.message, 'danger');
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = "Test Connection";
            }
        });
    }

    // Save & Connect handler
    async function handleSaveAndConnect() {
        const payload = buildPayload();
        if (!payload) return;
        
        // Disable button while connecting
        saveBtn.disabled = true;
        saveBtn.textContent = "Connecting...";
        
        try {
            // Call Backend API
            const res = await fetch("/api/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            
            if (res.ok && data.connection) {

                const profileToSave = { ...payload };
                delete profileToSave.password;
                localStorage.setItem("ide_last_connection", JSON.stringify(profileToSave));

                bsModal.hide();

                // Add to Object Explorer
                if (window.AppExplorer) {
                    if (window.AppExplorer.saveConnectionProfile) {
                        window.AppExplorer.saveConnectionProfile(profileToSave);
                    }
                    const refreshBtn = document.getElementById('ide-btn-refresh-tree');
                    if (refreshBtn) refreshBtn.click();
                }

                showToast(`✓ Connected to ${payload.name}`, 'success');

                // Update status bar
                const statusConn = document.getElementById('ide-status-conn');
                if (statusConn) {
                    statusConn.innerHTML = `<i class="fa-solid fa-circle-check me-1" style="color: var(--ide-success);"></i><span style="color: var(--ide-success);">${payload.name}</span>`;
                }

                // Activate connection context in Action Bar and Editor
                if (typeof window.activateConnectionContext === 'function') {
                    window.activateConnectionContext(data.connection.connection_id, payload.name, payload.type, payload.database);
                }
            } else {
                showToast("Connection failed: " + (data.error || "Unknown error"), 'danger');
            }
            
        } catch (e) {
            showToast("Network error: " + e.message, 'danger');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Connect";
        }
    }

    if (connForm) {
        connForm.addEventListener("submit", (e) => {
            e.preventDefault();
            handleSaveAndConnect();
        });
    } else {
        saveBtn.addEventListener("click", handleSaveAndConnect);
    }

    return {};
}

// Lightweight toast helper (bottom-right, auto-dismiss)
function showToast(message, type = 'info') {
    const colors = { success: 'var(--ide-success)', danger: 'var(--ide-danger)', info: 'var(--ide-text-muted)' };
    const el = document.createElement('div');
    el.style.cssText = `
        position: fixed; bottom: 36px; right: 16px; z-index: 9999;
        background: var(--ide-bg-modal); border: 1px solid var(--ide-border);
        border-left: 3px solid ${colors[type] || colors.info};
        color: var(--ide-text-main); font-size: 12px; padding: 8px 14px;
        border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: ctxAppear 0.15s ease; max-width: 320px;
    `;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

// connections.js is initialized by app.js via initConnections()
