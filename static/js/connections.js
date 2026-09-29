// Connection Modal and API Logic

function initConnections() {
    const connectBtn = document.getElementById("ide-btn-connect");
    const saveBtn    = document.getElementById("btnSaveConnection");
    const testBtn    = document.getElementById("btnTestConnection");
    const modalEl    = document.getElementById("connectionModal");
    const connForm   = document.getElementById("connectionForm");

    if (!modalEl || !saveBtn) return {
        editConnection,};
    const bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal) ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;
    
    // Form elements
    const fName = document.getElementById("connName");
    const fType = document.getElementById("connType");
    const fHost = document.getElementById("connHost");
    const fPort = document.getElementById("connPort");
    const fDb = document.getElementById("connDb");
    const fSchema = document.getElementById("connSchema");
    const btnFetchDbs = document.getElementById("btnFetchDbs");
    const btnFetchSchemas = document.getElementById("btnFetchSchemas");
    const connDbList = document.getElementById("connDbList");
    const fGroup = document.getElementById("connGroup");
    const fGroupList = document.getElementById("connGroupList");
    const fWinAuth = document.getElementById("connWinAuth");
    const fEncrypt = document.getElementById("connEncrypt");
    const fTrustCert = document.getElementById("connTrustCert");
    const fDriver = document.getElementById("connDriver");
    const fTimeout = document.getElementById("connTimeout");
    const sqlServerOptions = document.getElementById("connSqlServerOptionsGroup");
    const fUser = document.getElementById("connUser");
    const fPass = document.getElementById("connPass");
    
    // Helper to refresh group datalist safely
    async function refreshGroupList() {
        if (!fGroupList || !window.AppStorage || typeof window.AppStorage.getSavedConnections !== 'function') return;
        try {
            const saved = await window.AppStorage.getSavedConnections() || [];
            const groups = [...new Set(
                (saved || [])
                    .filter(c => c && typeof c === 'object' && c.group)
                    .map(c => String(c.group).trim())
                    .filter(Boolean)
            )];
            fGroupList.innerHTML = groups.map(g => `<option value="${g}">`).join('');
        } catch (e) {
            console.warn('[connections.js] refreshGroupList error:', e);
        }
    }

    // Load last used profile from AppStorage (data/connections.json)
    async function editConnection(data) {
        if (!data || data.type === 'group_marker' || String(data.name || '').startsWith('__group__')) {
            console.warn('[connections.js] Cannot edit a group node as connection:', data);
            return;
        }
        window._editingConnId = data.id || null;
        fName.value = data.name || "";
        fType.value = (data.type === "postgresql") ? "postgresql" : "sqlserver";
        fHost.value = data.server || data.host || "localhost";
        fPort.value = data.port || "";
        fDb.value = data.database || "";
        if (fSchema) {
            fSchema.innerHTML = '<option value="">(Tất cả / Mặc định)</option>';
            if (data.schema) {
                const opt = document.createElement("option");
                opt.value = data.schema;
                opt.textContent = data.schema;
                opt.selected = true;
                fSchema.appendChild(opt);
            }
        }
        if (fGroup) fGroup.value = data.group || "";
        fWinAuth.checked = Boolean(data.trusted_connection);
        if (fEncrypt) fEncrypt.checked = data.encrypt !== undefined ? Boolean(data.encrypt) : (data.ssl !== undefined ? Boolean(data.ssl) : false);
        if (fTrustCert) fTrustCert.checked = data.trust_server_certificate !== undefined ? Boolean(data.trust_server_certificate) : true;
        if (fDriver) fDriver.value = data.driver || "ODBC Driver 17 for SQL Server";
        if (fTimeout) fTimeout.value = data.timeout || 30;
        fUser.value = data.username || "";
        
        // Show password masked if exists
        fPass.value = "";
        fPass.type = "password";
        if (data.has_password || data.password) {
            try {
                if (window.AppStorage && typeof window.AppStorage.getConnectionPassword === 'function') {
                    const pwd = await window.AppStorage.getConnectionPassword(data.id || data.name);
                    if (pwd) {
                        fPass.value = pwd;
                        fPass.type = "password";
                    }
                }
            } catch (_) {}
        }
        
        // Reset toggle password eye icon to hidden (eye)
        const toggleIcon = document.getElementById("btnToggleConnPass")?.querySelector("i");
        if (toggleIcon) toggleIcon.className = "fa-solid fa-eye";

        // Update modal title and button for Edit mode
        const modalTitle = document.getElementById("connectionModalLabel");
        if (modalTitle) {
            modalTitle.innerHTML = '<i class="fa-solid fa-pen me-2" style="color: var(--ide-accent);"></i>Edit Connection';
        }
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i>Lưu';
        }

        syncTypeUI();
        syncAuthUI();
        await refreshGroupList();
        if (bsModal) {
            bsModal.show();
        }
    }

    async function loadProfile() {
        let data = null;
        if (window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
            try {
                const savedList = await window.AppStorage.getSavedConnections();
                if (Array.isArray(savedList)) {
                    // Filter out group markers and non-connection items
                    const realConns = savedList.filter(c => 
                        c && typeof c === 'object' && 
                        c.type && c.type !== 'group_marker' && 
                        !String(c.name || '').startsWith('__group__')
                    );
                    if (realConns.length > 0) {
                        data = realConns[realConns.length - 1];
                    }
                }
            } catch (err) {
                console.warn('[connections.js] loadProfile error:', err);
            }
        }
        if (data) {
            try {
                fName.value = "";
                fName.placeholder = data.name ? `Ví dụ: ${data.name}_Copy` : "My Connection";
                fType.value = (data.type === "postgresql") ? "postgresql" : "sqlserver";
                fHost.value = data.server || data.host || "localhost";
                fPort.value = data.port || "";
                fDb.value = data.database || "";
                if (fSchema) {
                    fSchema.innerHTML = '<option value="">(Tất cả / Mặc định)</option>';
                    if (data.schema) {
                        const opt = document.createElement("option");
                        opt.value = data.schema;
                        opt.textContent = data.schema;
                        opt.selected = true;
                        fSchema.appendChild(opt);
                    }
                }
                if (fGroup) fGroup.value = data.group || "";
                fWinAuth.checked = Boolean(data.trusted_connection);
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
                fPass.value = ""; 
            } catch (e) {
                console.error("Error loading profile", e);
            }
        } else {
            fName.value = "";
            fName.placeholder = "My Connection";
            fType.value = "sqlserver";
            fHost.value = "localhost";
            fPort.value = "";
            fDb.value = "";
            if (fSchema) {
                fSchema.innerHTML = '<option value="">(Tất cả / Mặc định)</option>';
            }
            if (fGroup) fGroup.value = "";
            fWinAuth.checked = true;
            if (fEncrypt) fEncrypt.checked = false;
            if (fTrustCert) fTrustCert.checked = true;
            if (fDriver) fDriver.value = "ODBC Driver 17 for SQL Server";
            if (fTimeout) fTimeout.value = 30;
            fUser.value = "";
            fPass.value = "";
        }
    }
    
    function buildPayload() {
        if (!fName.value || !fHost.value) {
            alert("Connection Name and Host are required!");
            return null;
        }
        if (fType.value === "group_marker" || fName.value.startsWith('__group__')) {
            alert("Không thể tạo kết nối với định dạng nhóm (group marker)!");
            return null;
        }
        
        const payload = {
            name: fName.value,
            type: fType.value,
            port: fPort.value ? parseInt(fPort.value) : null,
            database: fDb.value ? fDb.value.trim() : "",
            schema: fSchema ? fSchema.value.trim() : "",
            group: fGroup ? fGroup.value.trim() : ""
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

    // Connect to server and fetch available Databases and Schemas
    async function fetchMetadata(trigger = 'both') {
        const hostVal = (fHost.value || '').trim();
        if (!hostVal) {
            alert("Vui lòng nhập thông tin Host / Server trước!");
            fHost.focus();
            return;
        }

        const btn = (trigger === 'schemas') ? btnFetchSchemas : btnFetchDbs;
        const oldBtnHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải...';
            btn.style.pointerEvents = 'none';
        }

        try {
            const metaPayload = {
                id: window._editingConnId || null,
                name: (fName.value || '').trim() || "temp_conn",
                type: fType.value,
                port: fPort.value ? parseInt(fPort.value) : null,
                database: (fDb.value || '').trim(),
                schema: fSchema ? (fSchema.value || '').trim() : ""
            };
            if (fType.value === "sqlserver") {
                metaPayload.server = hostVal;
                metaPayload.trusted_connection = fWinAuth.checked;
                metaPayload.encrypt = fEncrypt ? fEncrypt.checked : false;
                metaPayload.trust_server_certificate = fTrustCert ? fTrustCert.checked : true;
                if (fDriver && fDriver.value) metaPayload.driver = fDriver.value;
                if (fTimeout && fTimeout.value) metaPayload.timeout = parseInt(fTimeout.value) || 30;
            } else {
                metaPayload.host = hostVal;
            }
            if (!metaPayload.trusted_connection) {
                metaPayload.username = fUser.value;
                metaPayload.password = fPass.value;
            }

            const res = await fetch("/api/connections/fetch-metadata", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(metaPayload)
            });
            const data = await res.json();

            if (res.ok && data.success) {
                // 1. Populate Databases datalist
                if (Array.isArray(data.databases) && connDbList) {
                    connDbList.innerHTML = data.databases.map(d => `<option value="${d}">`).join('');
                }

                // 2. Populate Schemas dropdown
                if (Array.isArray(data.schemas) && fSchema) {
                    const curVal = fSchema.value;
                    fSchema.innerHTML = '<option value="">(Tất cả / Mặc định)</option>';
                    data.schemas.forEach(s => {
                        const opt = document.createElement("option");
                        opt.value = s;
                        opt.textContent = s;
                        if (s === curVal) opt.selected = true;
                        fSchema.appendChild(opt);
                    });
                }

                const dCount = (data.databases || []).length;
                const sCount = (data.schemas || []).length;
                if (trigger === 'schemas') {
                    showToast(`✓ Đã tải ${sCount} schema từ server`, 'success');
                } else if (trigger === 'dbs') {
                    showToast(`✓ Đã tải ${dCount} database từ server`, 'success');
                } else {
                    showToast(`✓ Đã tải kết nối (${dCount} DBs, ${sCount} Schemas)`, 'success');
                }
            } else {
                alert("Không thể tải metadata từ server: " + (data.error || "Lỗi không xác định"));
            }
        } catch (err) {
            alert("Lỗi kết nối khi tải metadata: " + err.message);
        } finally {
            if (btn) {
                btn.innerHTML = oldBtnHtml;
                btn.style.pointerEvents = '';
            }
        }
    }

    if (btnFetchDbs) {
        btnFetchDbs.addEventListener("click", () => fetchMetadata('dbs'));
    }
    if (btnFetchSchemas) {
        btnFetchSchemas.addEventListener("click", () => fetchMetadata('schemas'));
    }
    if (fDb) {
        fDb.addEventListener("change", () => {
            if (fHost.value && fHost.value.trim()) {
                fetchMetadata('schemas');
            }
        });
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
    if (fWinAuth) fWinAuth.addEventListener('change', syncAuthUI);

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

        // Update database type logo and name right below the title
        const logoImg = document.getElementById("connTypeLogo");
        const typeNameEl = document.getElementById("connTypeName");
        if (logoImg) {
            if (isSqlServer) {
                logoImg.src = "/static/icons/sqlserver.png";
                logoImg.alt = "microsoft-sql-server";
                logoImg.onerror = function() { this.src = "https://img.icons8.com/color/48/microsoft-sql-server.png"; };
            } else {
                logoImg.src = "/static/icons/postgresql.png";
                logoImg.alt = "postgreesql";
                logoImg.onerror = function() { this.src = "https://img.icons8.com/color/48/postgreesql.png"; };
            }
        }
        if (typeNameEl) {
            typeNameEl.textContent = isSqlServer ? "Microsoft SQL Server" : "PostgreSQL";
        }

        syncAuthUI();
    }
    if (fType) fType.addEventListener("change", syncTypeUI);

    syncAuthUI(); // apply on load
    syncTypeUI();

    // Open Modal
    if (connectBtn && bsModal) {
        connectBtn.addEventListener("click", async () => {
            window._editingConnId = null;
            const modalTitle = document.getElementById("connectionModalLabel");
            if (modalTitle) {
                modalTitle.innerHTML = '<i class="fa-solid fa-plug me-2" style="color: var(--ide-accent);"></i>New Connection';
            }
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fa-solid fa-plug me-1"></i>Connect';
            }
            await loadProfile();
            syncTypeUI();
            syncAuthUI();
            await refreshGroupList();
            bsModal.show();
        });
    }
    
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
        
        if (window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
            try {
                const savedConns = await window.AppStorage.getSavedConnections() || [];
                const nonMarkerConns = (savedConns || []).filter(c => c && typeof c === 'object' && c.type !== 'group_marker');

                // 1. Check duplicate connection name
                const isDuplicateName = nonMarkerConns.some(c => 
                    c.id !== window._editingConnId && 
                    (c.name || '').trim().toLowerCase() === (payload.name || '').trim().toLowerCase()
                );
                if (isDuplicateName) {
                    alert("Tên kết nối đã tồn tại! Vui lòng chọn tên khác.");
                    return;
                }

                // 2. Check duplicate Host/IP
                const currentHost = (payload.server || payload.host || '').trim().toLowerCase();
                if (currentHost) {
                    const currentPort = String(payload.port || (payload.type === 'postgresql' ? '5432' : '1433'));
                    const isDuplicateHost = nonMarkerConns.some(c => {
                        if (c.id === window._editingConnId) return false;
                        const h = (c.server || c.host || '').trim().toLowerCase();
                        const p = String(c.port || (c.type === 'postgresql' ? '5432' : '1433'));
                        return h === currentHost && p === currentPort;
                    });
                    if (isDuplicateHost) {
                        alert("Host/IP kết nối đã tồn tại! Vui lòng kiểm tra lại.");
                        return;
                    }
                }
            } catch (err) {
                console.warn('[connections.js] check duplicate error:', err);
            }
        }
        
        // In Edit mode: save directly without re-connecting
        if (window._editingConnId) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Đang lưu...';
            try {
                const profileToSave = { ...payload, id: window._editingConnId };
                if (!profileToSave.password) {
                    profileToSave.clear_password = true;
                }
                if (window.AppExplorer && typeof window.AppExplorer.saveConnectionProfile === 'function') {
                    await window.AppExplorer.saveConnectionProfile(profileToSave);
                } else if (window.AppStorage && typeof window.AppStorage.saveConnectionProfile === 'function') {
                    await window.AppStorage.saveConnectionProfile(profileToSave);
                }
                bsModal.hide();
                if (window.AppExplorer) window.AppExplorer.loadActiveConnections();
                showToast(`✓ Đã lưu thay đổi kết nối ${payload.name}`, 'success');
            } catch (e) {
                showToast(`Lỗi khi lưu kết nối: ${e.message}`, 'danger');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i>Lưu';
            }
            return;
        }

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
                // Keep password in profileToSave so backend can encrypt it
                bsModal.hide();

                // Add to Object Explorer & persist profile to connections.json (Single source of truth)
                if (window.AppExplorer && typeof window.AppExplorer.saveConnectionProfile === 'function') {
                    await window.AppExplorer.saveConnectionProfile(profileToSave);
                    const refreshBtn = document.getElementById('ide-btn-refresh-tree');
                    if (refreshBtn) refreshBtn.click();
                } else if (window.AppStorage && typeof window.AppStorage.saveConnectionProfile === 'function') {
                    await window.AppStorage.saveConnectionProfile(profileToSave);
                }

                const toastMsg = data.reused
                    ? `✓ Đã sử dụng kết nối hiện có tới ${payload.name}`
                    : `✓ Connected to ${payload.name}`;
                showToast(toastMsg, 'success');

                // Update status bar
                const statusConn = document.getElementById('ide-status-conn');
                if (statusConn) {
                    statusConn.innerHTML = `<i class="fa-solid fa-circle-check me-1" style="color: var(--ide-success);"></i><span style="color: var(--ide-success);">${payload.name}</span>`;
                }

                // Activate connection context in Action Bar and Editor
                if (typeof window.activateConnectionContext === 'function') {
                    window.activateConnectionContext(data.connection.connection_id, payload.name, payload.type, payload.database, payload.schema);
                }

                // Dispatch event so BRAVO window or other components can catch the new connection
                document.dispatchEvent(new CustomEvent('connection-created', {
                    detail: { connection: data.connection, payload: payload }
                }));
                document.dispatchEvent(new CustomEvent('bravo-connection-created', {
                    detail: { connection: data.connection, payload: payload }
                }));
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

    window.editConnection = editConnection;
    return {
        editConnection,
        loadProfile,
        show: async () => {
            if (bsModal) {
                window._editingConnId = null;
                const modalTitle = document.getElementById("connectionModalLabel");
                if (modalTitle) {
                    modalTitle.innerHTML = '<i class="fa-solid fa-plug me-2" style="color: var(--ide-accent);"></i>New Connection';
                }
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fa-solid fa-plug me-1"></i>Connect';
                }
                await loadProfile();
                syncTypeUI();
                syncAuthUI();
                await refreshGroupList();
                bsModal.show();
            }
        },
        hide: () => {
            if (bsModal) bsModal.hide();
        }
    };
}

// Lightweight toast helper with top-right stacked container (never hidden by bottom status/task bar)
function showToast(message, type = 'info') {
    let container = document.getElementById('ide-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'ide-toast-container';
        container.style.cssText = `
            position: fixed;
            top: 48px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
            max-width: 380px;
        `;
        document.body.appendChild(container);
    }

    const colors = {
        success: '#2ea44f',
        danger: '#f85149',
        warning: '#d29922',
        info: '#58a6ff',
        secondary: 'var(--ide-text-muted, #8b949e)'
    };
    const icons = {
        success: 'fa-circle-check',
        danger: 'fa-circle-xmark',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info',
        secondary: 'fa-bell'
    };

    const color = colors[type] || colors.info;
    const icon = icons[type] || icons.info;

    const el = document.createElement('div');
    el.className = `ide-toast-item ide-toast-${type}`;
    el.style.cssText = `
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--ide-bg-modal, #252526);
        border: 1px solid var(--ide-border, #3c3f41);
        border-left: 4px solid ${color};
        color: var(--ide-text-main, #cccccc);
        font-size: 12px;
        padding: 9px 14px;
        border-radius: 5px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transform: translateX(30px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        word-break: break-word;
    `;

    const cleanMsg = typeof message === 'string' ? message.replace(/</g, '&lt;').replace(/>/g, '&gt;') : message;
    el.innerHTML = `
        <i class="fa-solid ${icon}" style="color: ${color}; font-size: 14px; flex-shrink: 0;"></i>
        <span style="flex: 1; line-height: 1.4;">${cleanMsg}</span>
        <span class="ide-toast-close" style="cursor: pointer; opacity: 0.6; padding: 0 4px; font-size: 15px; line-height: 1;" title="Đóng">&times;</span>
    `;

    const closeBtn = el.querySelector('.ide-toast-close');
    let removed = false;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        el.style.opacity = '0';
        el.style.transform = 'translateX(30px)';
        setTimeout(() => el.remove(), 200);
    };
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    container.appendChild(el);
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(0)';
    });

    setTimeout(dismiss, 4000);
}
window.showToast = showToast;

// connections.js is initialized by app.js via initConnections()


// Global promptReconnectPassword support for both IDE and Standalone BRAVO windows
window.promptReconnectPassword = function (name, dbType, config, onConnected) {
    if (!config || config.type === 'group_marker' || dbType === 'group_marker' || String(name || '').startsWith('__group__')) {
        console.warn('[connections.js] Cannot prompt reconnect password for group:', name);
        return;
    }
    const modalEl = document.getElementById('reconnectPasswordModal');
    if (!modalEl) {
        const entered = prompt(`Enter password for user '${config.username || ''}' to connect to ${name}:`);
        if (entered !== null) {
            fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, password: entered })
            }).then(r => r.json()).then(data => {
                if (data.success && typeof onConnected === 'function') onConnected(data.connection, config);
            });
        }
        return;
    }

    const bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal) ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;
    const elName = document.getElementById('reconnectConnName');
    const elHost = document.getElementById('reconnectConnHost');
    const elPort = document.getElementById('reconnectConnPort');
    const elPortRow = document.getElementById('reconnectConnPortRow');
    const elUser = document.getElementById('reconnectConnUser');
    const elPass = document.getElementById('reconnectPassInput');
    const elError = document.getElementById('reconnectPassError');
    const btnToggle = document.getElementById('btnToggleReconnectPass');
    const btnConfirm = document.getElementById('btnConfirmReconnect');

    if (elName) elName.textContent = name || config.name || 'Connection';
    if (elHost) elHost.textContent = config.server || config.host || 'localhost';

    const portVal = config.port;
    if (portVal && elPort && elPortRow) {
        elPort.textContent = portVal;
        elPortRow.style.display = '';
    } else if (elPortRow) {
        elPortRow.style.display = 'none';
    }

    if (elUser) elUser.textContent = config.username || '(not specified)';

    const reconnForm = document.getElementById('reconnectPasswordForm');
    if (elPass) { elPass.value = ''; elPass.type = 'password'; }
    if (elError) { elError.textContent = ''; elError.classList.add('d-none'); }

    if (btnToggle && !btnToggle._hasListener) {
        btnToggle._hasListener = true;
        btnToggle.addEventListener('click', () => {
            if (!elPass) return;
            const isPass = elPass.type === 'password';
            elPass.type = isPass ? 'text' : 'password';
            const icon = btnToggle.querySelector('i');
            if (icon) icon.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        });
    }

    const submitPassword = async () => {
        const password = elPass ? elPass.value : '';
        if (!password) {
            if (elError) { elError.textContent = 'Password is required.'; elError.classList.remove('d-none'); }
            return;
        }

        if (btnConfirm) {
            btnConfirm.disabled = true;
            btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Connecting...';
        }

        try {
            const res = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, password })
            });
            const data = await res.json();
            if (res.ok && data.connection) {
                if (bsModal) bsModal.hide();
                if (typeof onConnected === 'function') {
                    onConnected(data.connection, config);
                }
            } else {
                const errMsg = data.error || 'Connection failed.';
                if (elError) { elError.textContent = errMsg; elError.classList.remove('d-none'); }
            }
        } catch (e) {
            if (elError) { elError.textContent = 'Network error: ' + e.message; elError.classList.remove('d-none'); }
        } finally {
            if (btnConfirm) {
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = '<i class="fa-solid fa-plug me-1"></i>Connect';
            }
        }
    };

    if (reconnForm) {
        reconnForm.onsubmit = (e) => { e.preventDefault(); submitPassword(); };
    }
    if (btnConfirm) {
        btnConfirm.onclick = (e) => { e.preventDefault(); submitPassword(); };
    }

    if (bsModal) bsModal.show();
    setTimeout(() => { if (elPass) elPass.focus(); }, 200);
};
