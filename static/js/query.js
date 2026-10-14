// Query Execution — with state model, resizable columns, per-tab width storage

function initQuery() {

    // ── DOM refs ─────────────────────────────────────────────────────────────
    const runBtn    = document.getElementById('ide-btn-run');
    const stopBtn   = document.getElementById('ide-btn-stop');
    const planBtn   = document.getElementById('ide-btn-plan');

    const resultsHead   = document.getElementById('ide-results-head');
    const resultsBody   = document.getElementById('ide-results-body');
    const messagesEl    = document.getElementById('ide-results-messages');
    const planEl        = document.getElementById('ide-results-plan');
    const resultStatus  = document.getElementById('ide-result-status');
    const footer        = document.getElementById('ide-result-footer');
    const footerRows    = document.getElementById('ide-footer-rows');
    const footerTime    = document.getElementById('ide-footer-time');

    const gridView      = document.getElementById('ide-results-grid-view');
    const messagesView  = document.getElementById('ide-results-messages-view');
    const planView      = document.getElementById('ide-results-plan-view');
    const tableWrap     = document.getElementById('ide-results-table-wrap');
    const emptyEl       = document.getElementById('ide-results-empty');

    const tabs = {
        'results-grid':     { btn: document.getElementById('ide-rtab-result'),   view: gridView },
        'results-messages': { btn: document.getElementById('ide-rtab-messages'), view: messagesView },
        'results-plan':     { btn: document.getElementById('ide-rtab-plan'),     view: planView },
    };

    // ── Per-tab state ─────────────────────────────────────────────────────────
    // columnWidths[tabId][colName] = widthPx
    const tabColumnWidths = {};
    const tabGridContainers = {}; // tabId -> DOM container for rendered results grid

    // Clean up cached grid when a tab is closed
    document.addEventListener('ide-tab-closed', (e) => {
        const tabId = e.detail && e.detail.tabId;
        if (!tabId) return;
        delete tabColumnWidths[tabId];

        // If a running query belongs to this tab, cancel it to free resources
        if (resultPanelState.isRunning && (currentStreamingData && currentStreamingData.tabId === tabId)) {
            cancelQuery();
        }

        if (tabGridContainers[tabId]) {
            const oldTables = tabGridContainers[tabId].querySelectorAll('table.ide-results-table');
            oldTables.forEach(tbl => {
                const inst = window.GridResultManager ? window.GridResultManager.getInstance(tbl) : null;
                if (inst) inst.destroy();
            });
            tabGridContainers[tabId].remove();
            delete tabGridContainers[tabId];
        }
    });

    // ── Result panel state ────────────────────────────────────────────────────
    const resultPanelState = {
        isRunning: false
    };

    // ── Result / Message / Plan tab switching ─────────────────────────────────
    function switchResultView(viewKey) {
        const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (state) state.activeView = viewKey;

        Object.entries(tabs).forEach(([key, { btn, view }]) => {
            const active = key === viewKey;
            btn.classList.toggle('active', active);
            view.classList.toggle('d-none', !active);
        });

        const copyMsgBtn = document.getElementById('ide-btn-copy-messages');
        if (copyMsgBtn) {
            copyMsgBtn.classList.toggle('d-none', viewKey !== 'results-messages');
        }
    }

    Object.entries(tabs).forEach(([key, { btn }]) => {
        btn.addEventListener('click', () => switchResultView(key));
    });

    // ── Action bar context update ─────────────────────────────────────────────
    function updateActionBar() {
        let connLabel    = document.getElementById('ide-ctx-conn-label');
        const dbLabel    = document.getElementById('ide-ctx-db-label');
        const schemaLabel= document.getElementById('ide-ctx-schema-label');
        const btnConn    = document.getElementById('ide-ctx-connection');
        const btnDb      = document.getElementById('ide-ctx-database');
        const btnSchema  = document.getElementById('ide-ctx-schema');

        const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;

        const connText = (tab && tab.connectionName) || window.ActiveConnectionName || 'No connection';
        const dbText   = (tab && tab.database)       || window.ActiveDatabase       || '—';
        const schText  = (tab && tab.schema)         || window.ActiveSchema         || '—';

        if (connLabel) {
            connLabel.textContent = connText;
        } else if (btnConn) {
            btnConn.innerHTML = `<i class="fa-solid fa-plug-circle-bolt me-1 text-success"></i><span id="ide-ctx-conn-label" class="text-truncate" style="max-width: 130px;">${connText}</span>`;
            connLabel = document.getElementById('ide-ctx-conn-label');
        }

        if (dbLabel) {
            dbLabel.textContent = dbText;
        } else if (btnDb) {
            btnDb.innerHTML = `<i class="fa-solid fa-database me-1 text-info"></i><span id="ide-ctx-db-label" class="text-truncate" style="max-width: 130px;">${dbText}</span>`;
        }

        if (schemaLabel) {
            schemaLabel.textContent = schText;
        } else if (btnSchema) {
            btnSchema.innerHTML = `<i class="fa-solid fa-layer-group me-1 text-warning"></i><span id="ide-ctx-schema-label" class="text-truncate" style="max-width: 110px;">${schText}</span>`;
        }

        if (btnConn) {
            btnConn.title = `Switch Connection (Current: ${connText})`;
            btnConn.setAttribute('data-connection-name', connText);
            btnConn.setAttribute('data-connection-id', (tab && tab.connectionId) || window.ActiveConnectionId || '');
            const hcName = document.getElementById('ide-ctx-hc-name');
            const hcDetails = document.getElementById('ide-ctx-hc-details');
            if (hcName) hcName.textContent = connText;
            if (hcDetails) {
                const curType = ((tab && tab.dbType) || window.ActiveDbType || 'sqlserver').toUpperCase();
                hcDetails.textContent = `Type: ${curType} | DB: ${dbText} | Schema: ${schText}`;
            }
        }
        if (btnDb)     btnDb.title     = `Switch Database (Current: ${dbText})`;
        if (btnSchema) btnSchema.title = `Switch Schema (Current: ${schText})`;

        const dbType = (tab && tab.dbType) || window.ActiveDbType || 'sqlserver';
        const debugBtn = document.getElementById('ide-btn-run-debug');
        if (debugBtn) {
            const isPg = (
                (dbType && (dbType.toLowerCase() === 'postgresql' || dbType.toLowerCase() === 'postgres' || dbType.toLowerCase() === 'pg' || dbType.toLowerCase().includes('postgr'))) ||
                (window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.isSupported === 'function' && window.DebugExtensionRegistry.isSupported(dbType))
            );
            debugBtn.classList.toggle('d-none', !isPg);
            if (isPg) {
                const isDebugActive = Boolean(tab && tab.isDebugActive);
                debugBtn.classList.toggle('active', isDebugActive);
                if (isDebugActive) {
                    debugBtn.title = 'Chế độ Debug PostgreSQL: ĐANG BẬT (Click để tắt)';
                    if (runBtn && !resultPanelState.isRunning) {
                        runBtn.classList.add('is-debug-mode');
                        runBtn.innerHTML = '<i class="fa-solid fa-play me-1"></i>Run <span class="badge bg-warning text-dark ms-1" style="font-size: 9px; padding: 1px 4px; font-weight: 700; border-radius: 2px;">DEBUG</span>';
                        runBtn.title = 'Chạy Query ở chế độ Debug PostgreSQL (F5 / Ctrl+E)';
                    }
                } else {
                    debugBtn.title = 'Chế độ Debug PostgreSQL: ĐANG TẮT (Click để bật)';
                    if (runBtn && !resultPanelState.isRunning) {
                        runBtn.classList.remove('is-debug-mode');
                        runBtn.innerHTML = '<i class="fa-solid fa-play me-1"></i>Run';
                        runBtn.title = 'Chạy Query (F5 / Ctrl+E)';
                    }
                }
            } else {
                if (runBtn && !resultPanelState.isRunning) {
                    runBtn.classList.remove('is-debug-mode');
                    runBtn.innerHTML = '<i class="fa-solid fa-play me-1"></i>Run';
                    runBtn.title = 'Chạy Query (F5 / Ctrl+E)';
                }
            }
        }

        // ── Mục 5.1: Environment & Read-Only Badges ──
        const envBadge = document.getElementById('ide-status-env');
        const roBadge = document.getElementById('ide-status-readonly');

        let curConn = null;
        if (window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
            const list = window.AppExplorer.getActiveConnections() || [];
            curConn = list.find(c => c && (String(c.connection_id) === String(tab?.connectionId || window.ActiveConnectionId) || c.name === connText));
        }

        const env = ((tab && tab.environment) || (curConn && curConn.environment) || '').toLowerCase();
        const isReadOnly = Boolean((tab && tab.readOnly) || (curConn && curConn.read_only));

        if (envBadge) {
            if (env === 'prod') {
                envBadge.className = 'badge bg-danger text-light border border-danger px-2 py-1';
                envBadge.textContent = 'PROD';
                envBadge.title = 'Môi trường PRODUCTION: Mọi câu lệnh DML / DDL yêu cầu xác nhận trước khi chạy!';
                envBadge.classList.remove('d-none');
            } else if (env === 'test') {
                envBadge.className = 'badge bg-warning text-dark border border-warning px-2 py-1';
                envBadge.textContent = 'TEST';
                envBadge.title = 'Môi trường KIỂM THỬ (TEST)';
                envBadge.classList.remove('d-none');
            } else if (env === 'dev') {
                envBadge.className = 'badge bg-primary text-light border border-primary px-2 py-1';
                envBadge.textContent = 'DEV';
                envBadge.title = 'Môi trường PHÁT TRIỂN (DEV)';
                envBadge.classList.remove('d-none');
            } else {
                envBadge.classList.add('d-none');
            }
        }

        if (roBadge) {
            roBadge.classList.toggle('d-none', !isReadOnly);
            if (isReadOnly) {
                roBadge.title = 'Kết nối CHỈ ĐỌC: Tất cả các thao tác ghi (INSERT, UPDATE, DELETE, DDL) bị chặn an toàn. Click để chuyển sang chế độ Ghi.';
                roBadge.style.cursor = 'pointer';
                roBadge.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                    const connId = (tabState && tabState.connectionId) || window.ActiveConnectionId;
                    const connName = (tabState && tabState.connectionName) || window.ActiveConnectionName || 'Kết nối hiện tại';
                    const db = (tabState && tabState.database) || window.ActiveDatabase;
                    const env = (tabState && tabState.environment) || '';
                    if (window.SqlProtection && typeof window.SqlProtection.showSwitchToWriteModeDialog === 'function') {
                        window.SqlProtection.showSwitchToWriteModeDialog({
                            connectionId: connId,
                            connectionName: connName,
                            database: db,
                            environment: env
                        });
                    }
                };
            }
        }

        // Refresh transaction status in background
        refreshTxStatus();
    }
    window.updateActionBar = updateActionBar;

    // ── Mục 5.1: Explicit Transaction Control Logic ────────────────────────────
    let _txPollingInterval = null;
    async function refreshTxStatus() {
        const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const connId = (tab && tab.connectionId) || window.ActiveConnectionId;
        const txBadge = document.getElementById('ide-status-tx');
        const btnTxToggle = document.getElementById('ide-btn-tx-toggle');
        const btnTxCommit = document.getElementById('ide-btn-tx-commit');
        const btnTxRollback = document.getElementById('ide-btn-tx-rollback');

        if (!connId) {
            if (txBadge) txBadge.classList.add('d-none');
            if (btnTxCommit) btnTxCommit.classList.add('d-none');
            if (btnTxRollback) btnTxRollback.classList.add('d-none');
            if (btnTxToggle) {
                btnTxToggle.innerHTML = '<i class="fa-solid fa-handshake me-1 text-warning"></i><span>Begin TX</span>';
                btnTxToggle.classList.remove('active');
            }
            if (_txPollingInterval) {
                clearInterval(_txPollingInterval);
                _txPollingInterval = null;
            }
            return;
        }

        try {
            const res = await fetch(`/api/tx/status?connection_id=${encodeURIComponent(connId)}`);
            const data = await res.json();
            const inTx = Boolean(data && data.success && data.in_transaction);

            if (txBadge) {
                if (inTx) {
                    const elapsed = data.duration_seconds !== null && data.duration_seconds !== undefined ? ` (${data.duration_seconds}s)` : '';
                    txBadge.innerHTML = `<i class="fa-solid fa-rotate me-1 fa-spin"></i>TX OPEN${elapsed}`;
                    txBadge.classList.remove('d-none');
                    txBadge.title = `Giao dịch tường minh đang mở. Bắt đầu: ${data.started_at || 'Vừa xong'}`;
                } else {
                    txBadge.classList.add('d-none');
                }
            }

            if (btnTxCommit) btnTxCommit.classList.toggle('d-none', !inTx);
            if (btnTxRollback) btnTxRollback.classList.toggle('d-none', !inTx);
            if (btnTxToggle) {
                if (inTx) {
                    btnTxToggle.innerHTML = '<i class="fa-solid fa-circle-dot me-1 text-danger"></i><span>In TX</span>';
                    btnTxToggle.classList.add('active');
                    btnTxToggle.title = 'Giao dịch tường minh đang mở (Click để xem thông tin)';
                } else {
                    btnTxToggle.innerHTML = '<i class="fa-solid fa-handshake me-1 text-warning"></i><span>Begin TX</span>';
                    btnTxToggle.classList.remove('active');
                    btnTxToggle.title = 'Bắt đầu Transaction tường minh (BEGIN TRAN)';
                }
            }

            // Keep polling elapsed seconds while in transaction
            if (inTx && !_txPollingInterval) {
                _txPollingInterval = setInterval(refreshTxStatus, 5000);
            } else if (!inTx && _txPollingInterval) {
                clearInterval(_txPollingInterval);
                _txPollingInterval = null;
            }
        } catch (_) {}
    }
    window.refreshTxStatus = refreshTxStatus;

    // ── Centralized Connection Context Activator ──────────────────────────────
    async function activateConnectionContext(connId, connName, dbType, preferredDb = null, preferredSchema = null, updateActiveTab = true) {
        // If preferredSchema is not provided, look up from saved connections
        if (!preferredSchema) {
            let savedList = [];
            if (window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                savedList = window.AppExplorer.getSavedConnections() || [];
            }
            if ((!savedList || savedList.length === 0) && typeof localStorage !== 'undefined') {
                try {
                    savedList = JSON.parse(localStorage.getItem('ide_saved_connections') || '[]');
                } catch (_) {}
            }
            const foundProfile = savedList.find(s => s && s.type === (dbType || 'postgresql') && (s.name === connName || s.connection_id === connId));
            if (foundProfile && foundProfile.schema) {
                preferredSchema = foundProfile.schema;
            }
        }

        const shouldUpdateActiveTab = updateActiveTab !== false;

        if (shouldUpdateActiveTab) {
            // Immediately update global state & UI so ide-ctx-connection updates without waiting for network
            window.ActiveConnectionId   = connId;
            window.ActiveConnectionName = connName;
            window.ActiveDbType         = dbType || 'sqlserver';
            if (preferredDb) window.ActiveDatabase = preferredDb;
            if (preferredSchema) window.ActiveSchema = preferredSchema;
        }

        const immediateCtx = {
            connectionId: connId,
            connectionName: connName,
            dbType: dbType || 'sqlserver',
            database: preferredDb || null,
            schema: preferredSchema || null
        };

        if (window.AppTabs) {
            if (shouldUpdateActiveTab && window.AppTabs.updateActiveTabContext) {
                window.AppTabs.updateActiveTabContext(immediateCtx);
            }
            if (window.AppTabs.setDefaultContext) {
                window.AppTabs.setDefaultContext(immediateCtx);
            }
        }
        updateActionBar();

        const newCtx = { ...immediateCtx };

        // 2. Fetch databases
        try {
            const dRes = await fetch(`/api/metadata/${connId}/databases`);
            const dData = await dRes.json();
            if (dData.success && Array.isArray(dData.items) && dData.items.length > 0) {
                const dbNames = dData.items.map(d => typeof d === 'string' ? d : (d.name || ''));
                if (preferredDb && dbNames.includes(preferredDb)) {
                    newCtx.database = preferredDb;
                } else {
                    newCtx.database = dbNames[0];
                }
            }
        } catch (e) {
            console.warn('Failed to fetch databases for connection', e);
        }

        // 3. Fetch schemas for selected database
        if (newCtx.database) {
            try {
                const sRes = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(newCtx.database)}`);
                const sData = await sRes.json();
                if (sData.success && Array.isArray(sData.items) && sData.items.length > 0) {
                    const sNames = sData.items.map(s => typeof s === 'string' ? s : (s.name || ''));
                    const matched = preferredSchema ? sNames.find(s => s.toLowerCase() === preferredSchema.toLowerCase()) : null;
                    if (matched) {
                        newCtx.schema = matched;
                    } else if (preferredSchema) {
                        newCtx.schema = preferredSchema;
                    } else if (newCtx.dbType === 'postgresql' && sNames.includes('public')) {
                        newCtx.schema = 'public';
                    } else if (newCtx.dbType === 'sqlserver' && sNames.includes('dbo')) {
                        newCtx.schema = 'dbo';
                    } else if (sNames.includes('dbo')) {
                        newCtx.schema = 'dbo';
                    } else if (sNames.includes('public')) {
                        newCtx.schema = 'public';
                    } else {
                        newCtx.schema = sNames[0];
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch schemas for database', e);
            }
        }

        if (!newCtx.schema) {
            newCtx.schema = preferredSchema || (newCtx.dbType === 'postgresql' ? 'public' : 'dbo');
        }

        if (shouldUpdateActiveTab) {
            if (newCtx.database) window.ActiveDatabase = newCtx.database;
            if (newCtx.schema) window.ActiveSchema = newCtx.schema;
        }

        // Apply updated database and schema to active tab and action bar
        if (window.AppTabs) {
            if (shouldUpdateActiveTab && window.AppTabs.updateActiveTabContext) {
                window.AppTabs.updateActiveTabContext(newCtx);
            }
            if (window.AppTabs.setDefaultContext) {
                window.AppTabs.setDefaultContext(newCtx);
            }
        }
        updateActionBar();
        return newCtx;
    }
    window.activateConnectionContext = activateConnectionContext;

    // ── Action bar interactive dropdowns ──────────────────────────────────────
    function initActionBarDropdowns() {
        const btnConn   = document.getElementById('ide-ctx-connection');
        const menuConn  = document.getElementById('ide-ctx-conn-menu');
        const btnDb     = document.getElementById('ide-ctx-database');
        const menuDb    = document.getElementById('ide-ctx-db-menu');
        const btnSchema = document.getElementById('ide-ctx-schema');
        const menuSchema= document.getElementById('ide-ctx-schema-menu');

        // 1. Connection Dropdown (Single-select: active or saved connections)
        if (btnConn && menuConn) {
            btnConn.addEventListener('click', async () => {
                menuConn.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading connections…</span></li>';
                try {
                    const res = await fetch('/api/connections');
                    const data = await res.json();
                    menuConn.innerHTML = '';

                    const activeList = (data.success && Array.isArray(data.connections)) ? data.connections : [];
                    const activeMap = {};
                    activeList.forEach(c => {
                        const dbType = c.type || c.config?.type || 'sqlserver';
                        const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                        activeMap[displayName + '::' + dbType] = c;
                    });

                    // Load saved connections: Prioritize data.saved_connections from response, then AppExplorer cache, then AppStorage, then localStorage
                    let savedList = [];
                    if (data && Array.isArray(data.saved_connections) && data.saved_connections.length > 0) {
                        savedList = data.saved_connections;
                    }
                    if (savedList.length === 0 && window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                        const explorerSaved = window.AppExplorer.getSavedConnections();
                        if (Array.isArray(explorerSaved) && explorerSaved.length > 0) {
                            savedList = explorerSaved;
                        }
                    }
                    if (savedList.length === 0 && window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
                        try {
                            const storageSaved = await window.AppStorage.getSavedConnections();
                            if (Array.isArray(storageSaved) && storageSaved.length > 0) {
                                savedList = storageSaved;
                            }
                        } catch (_) {}
                    }
                    if (savedList.length === 0) {
                        try {
                            const localSaved = JSON.parse(localStorage.getItem('ide_saved_connections') || '[]');
                            if (Array.isArray(localSaved) && localSaved.length > 0) {
                                savedList = localSaved;
                            }
                        } catch (_) {}
                    }

                    if (Array.isArray(savedList) && savedList.length > 0) {
                        try {
                            localStorage.setItem('ide_saved_connections', JSON.stringify(savedList));
                        } catch (_) {}
                    }

                    const allItems = [];
                    const seenKeys = new Set();

                    // Saved profiles first (exclude group markers)
                    savedList.forEach(s => {
                        if (!s || s.type === 'group_marker' || String(s.name || '').startsWith('__group__')) return;
                        const sName = s.name || s.server || 'Server';
                        const sType = s.type || 'sqlserver';
                        const key = sName + '::' + sType;
                        seenKeys.add(key);

                        const activeConn = activeMap[key];
                        allItems.push({
                            name: sName,
                            type: sType,
                            isActive: !!activeConn,
                            connId: activeConn ? activeConn.connection_id : null,
                            config: s
                        });
                    });

                    // Active connections not in saved list
                    activeList.forEach(c => {
                        if (!c || c.type === 'group_marker' || String(c.name || '').startsWith('__group__')) return;
                        const cType = c.type || c.config?.type || 'sqlserver';
                        const cName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                        const key = cName + '::' + cType;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            allItems.push({
                                name: cName,
                                type: cType,
                                isActive: true,
                                connId: c.connection_id,
                                config: c.config || {}
                            });
                        }
                    });

                    const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                    const currentConnId = (activeTab && activeTab.connectionId) || window.ActiveConnectionId;
                    const currentConnName = (activeTab && activeTab.connectionName) || window.ActiveConnectionName;

                    if (allItems.length === 0) {
                        menuConn.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-circle-info me-2"></i>No saved connections</span></li>';
                    } else {
                        const header = document.createElement('li');
                        header.innerHTML = '<h6 class="dropdown-header text-uppercase" style="font-size: 10px; letter-spacing: 0.5px;">Select Server / Connection</h6>';
                        menuConn.appendChild(header);

                        allItems.forEach(c => {
                            const isCurrent = (c.connId && c.connId === currentConnId) || (c.name === currentConnName);
                            const li = document.createElement('li');

                            const statusBadge = c.isActive 
                                ? '<span class="badge bg-success-subtle text-success border border-success-subtle ms-2" style="font-size: 9px; padding: 2px 5px;">Connected</span>'
                                : '<span class="badge bg-secondary-subtle text-muted border ms-2" style="font-size: 9px; padding: 2px 5px;">Click to connect</span>';

                            const icon = c.isActive
                                ? '<i class="fa-solid fa-server me-2 text-success"></i>'
                                : '<i class="fa-solid fa-server me-2 text-secondary opacity-75"></i>';

                            li.innerHTML = `
                                <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                    <span class="d-flex align-items-center overflow-hidden">
                                        ${icon}
                                        <strong class="text-truncate" style="max-width: 140px;">${c.name}</strong>
                                        <span class="text-muted ms-1 small" style="font-size: 10px;">(${c.type})</span>
                                    </span>
                                    <div class="d-flex align-items-center ms-2 flex-shrink-0">
                                        ${statusBadge}
                                        ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                                    </div>
                                </a>
                            `;

                            li.querySelector('a').addEventListener('click', async (e) => {
                                e.preventDefault();
                                if (c.type === 'group_marker' || String(c.name || '').startsWith('__group__')) return;
                                if (window.bootstrap) {
                                    const dd = bootstrap.Dropdown.getInstance(btnConn);
                                    if (dd) dd.hide();
                                }

                                if (c.isActive && c.connId) {
                                    showToast(`Switching to ${c.name}…`, 'info');
                                    await activateConnectionContext(c.connId, c.name, c.type, c.config?.database, c.config?.schema, true /* updateActiveTab */);
                                    showToast(`Switched connection to ${c.name}`, 'success');
                                } else {
                                    showToast(`Connecting to ${c.name}…`, 'info');
                                    // Optimistically assign connection profile to active tab & Action Bar immediately
                                    const optCtx = {
                                        connectionName: c.name,
                                        connectionId: null,
                                        dbType: c.type || 'sqlserver',
                                        database: c.config?.database || null,
                                        schema: c.config?.schema || null
                                    };
                                    window.ActiveConnectionName = c.name;
                                    window.ActiveDbType = c.type || 'sqlserver';
                                    if (c.config?.database) window.ActiveDatabase = c.config.database;
                                    if (c.config?.schema) window.ActiveSchema = c.config.schema;
                                    if (window.AppTabs && window.AppTabs.updateActiveTabContext) {
                                        window.AppTabs.updateActiveTabContext(optCtx);
                                    }
                                    if (window.AppTabs && window.AppTabs.setDefaultContext) {
                                        window.AppTabs.setDefaultContext(optCtx);
                                    }
                                    updateActionBar();

                                    if (window.AppExplorer && window.AppExplorer.reconnect) {
                                        window.AppExplorer.reconnect(c.name, c.type, c.config, async (newConn) => {
                                            const newId = newConn.connection_id || newConn.id;
                                            await activateConnectionContext(newId, c.name, c.type, c.config?.database, c.config?.schema, true /* updateActiveTab */);
                                            showToast(`✓ Connected and switched to ${c.name}`, 'success');
                                        });
                                    }
                                }
                            });

                            menuConn.appendChild(li);
                        });
                    }

                    // "New Connection..." button
                    const div = document.createElement('li');
                    div.innerHTML = '<hr class="dropdown-divider my-1">';
                    menuConn.appendChild(div);

                    const newConnLi = document.createElement('li');
                    newConnLi.innerHTML = `
                        <a class="dropdown-item text-primary d-flex align-items-center py-1 px-3" href="#" style="cursor: pointer;">
                            <i class="fa-solid fa-plus me-2"></i>New Connection...
                        </a>
                    `;
                    newConnLi.querySelector('a').addEventListener('click', (e) => {
                        e.preventDefault();
                        if (window.bootstrap) {
                            const dd = bootstrap.Dropdown.getInstance(btnConn);
                            if (dd) dd.hide();
                        }
                        const newBtn = document.getElementById('ide-btn-connect');
                        if (newBtn) newBtn.click();
                    });
                    menuConn.appendChild(newConnLi);

                    if (window.bootstrap && bootstrap.Dropdown) {
                        const dd = bootstrap.Dropdown.getOrCreateInstance(btnConn);
                        if (dd && typeof dd.update === 'function') dd.update();
                    }

                } catch (e) {
                    menuConn.innerHTML = `<li><span class="dropdown-item text-danger small">Error loading connections: ${e.message}</span></li>`;
                }
            });
        }

        // 2. Database Dropdown (Pure single-select dropdown list, no text input)
        if (btnDb && menuDb) {
            btnDb.addEventListener('click', async () => {
                const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                const connId = (activeTab && activeTab.connectionId) || window.ActiveConnectionId;
                const currentConnName = (activeTab && activeTab.connectionName) || window.ActiveConnectionName;
                const currentDb = (activeTab && activeTab.database) || window.ActiveDatabase;
                const dbType = (activeTab && activeTab.dbType) || window.ActiveDbType || 'sqlserver';

                if (!connId) {
                    menuDb.innerHTML = `
                        <li>
                            <span class="dropdown-item text-muted small">
                                <i class="fa-solid fa-circle-exclamation me-2 text-warning"></i>Please connect to a server first
                            </span>
                        </li>
                    `;
                    return;
                }

                menuDb.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading databases…</span></li>';

                try {
                    const res = await fetch(`/api/metadata/${connId}/databases`);
                    const data = await res.json();
                    menuDb.innerHTML = '';

                    if (!data.success || !Array.isArray(data.items) || data.items.length === 0) {
                        menuDb.innerHTML = '<li><span class="dropdown-item text-muted small">No databases found</span></li>';
                        return;
                    }

                    const header = document.createElement('li');
                    header.className = 'ide-ctx-db-header';
                    header.innerHTML = `
                        <div class="d-flex align-items-center justify-content-between">
                            <span class="ide-ctx-db-header-title">Select Database</span>
                            <button type="button" class="ide-ctx-db-filter-btn" title="Lọc database">
                                <i class="fa-solid fa-filter"></i>
                            </button>
                        </div>
                        <div class="ide-ctx-db-filter-box d-none">
                            <div class="ide-ctx-db-filter-group">
                                <i class="fa-solid fa-magnifying-glass ide-ctx-db-filter-icon"></i>
                                <input type="text" class="ide-ctx-db-filter-input" placeholder="Lọc database..." autocomplete="off" spellcheck="false">
                                <button type="button" class="ide-ctx-db-filter-clear d-none" title="Xóa lọc">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                    `;
                    header.addEventListener('click', (e) => e.stopPropagation());
                    header.addEventListener('keydown', (e) => e.stopPropagation());
                    menuDb.appendChild(header);

                    const filterBtn = header.querySelector('.ide-ctx-db-filter-btn');
                    const filterBox = header.querySelector('.ide-ctx-db-filter-box');
                    const filterInput = header.querySelector('.ide-ctx-db-filter-input');
                    const filterClear = header.querySelector('.ide-ctx-db-filter-clear');

                    const noMatchLi = document.createElement('li');
                    noMatchLi.className = 'ide-ctx-db-no-match d-none';
                    noMatchLi.textContent = 'Không tìm thấy cơ sở dữ liệu phù hợp';
                    menuDb.appendChild(noMatchLi);

                    const dbItems = [];

                    data.items.forEach(item => {
                        const dbName = typeof item === 'string' ? item : (item.name || '');
                        const isCurrent = dbName === currentDb;

                        const li = document.createElement('li');
                        li.dataset.dbname = dbName.toLowerCase();
                        li.innerHTML = `
                            <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                <span><i class="fa-solid fa-database me-2 text-info"></i>${dbName}</span>
                                ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                            </a>
                        `;

                        li.querySelector('a').addEventListener('click', async (e) => {
                            e.preventDefault();
                            if (window.bootstrap) {
                                const dd = bootstrap.Dropdown.getInstance(btnDb);
                                if (dd) dd.hide();
                            }

                            // Single selection: set active database and default schema
                            let preferredSch = null;
                            if (window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                                const savedList = window.AppExplorer.getSavedConnections() || [];
                                const profile = savedList.find(s => s && (s.name === currentConnName || s.server === currentConnName || s.connection_id === connId || s.id === connId));
                                if (profile && profile.schema) {
                                    preferredSch = profile.schema;
                                }
                            }
                            let defaultSchema = preferredSch || (dbType === 'postgresql' ? 'public' : 'dbo');
                            try {
                                const sRes = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
                                const sData = await sRes.json();
                                if (sData.success && Array.isArray(sData.items) && sData.items.length > 0) {
                                    const sNames = sData.items.map(s => typeof s === 'string' ? s : (s.name || ''));
                                    const matched = preferredSch ? sNames.find(s => s.toLowerCase() === preferredSch.toLowerCase()) : null;
                                    if (matched) {
                                        defaultSchema = matched;
                                    } else if (preferredSch) {
                                        defaultSchema = preferredSch;
                                    } else if (dbType === 'postgresql' && sNames.includes('public')) {
                                        defaultSchema = 'public';
                                    } else if (dbType === 'sqlserver' && sNames.includes('dbo')) {
                                        defaultSchema = 'dbo';
                                    } else if (sNames.includes('dbo')) {
                                        defaultSchema = 'dbo';
                                    } else if (sNames.includes('public')) {
                                        defaultSchema = 'public';
                                    } else {
                                        defaultSchema = sNames[0];
                                    }
                                }
                            } catch (_) {}

                            const newCtx = {
                                database: dbName,
                                schema: defaultSchema
                            };

                            if (window.AppTabs) {
                                window.AppTabs.updateActiveTabContext(newCtx);
                                if (window.AppTabs.setDefaultContext) {
                                    window.AppTabs.setDefaultContext(newCtx);
                                }
                            }
                            updateActionBar();
                            showToast(`Switched database to ${dbName}`, 'info');
                        });

                        menuDb.appendChild(li);
                        dbItems.push({ li, name: dbName.toLowerCase() });
                    });

                    // Live Filter function
                    const applyFilter = (query) => {
                        const q = (query || '').trim().toLowerCase();
                        let visibleCount = 0;
                        dbItems.forEach(({ li, name }) => {
                            if (!q || name.includes(q)) {
                                li.style.display = '';
                                visibleCount++;
                            } else {
                                li.style.display = 'none';
                            }
                        });
                        noMatchLi.classList.toggle('d-none', visibleCount > 0);
                        filterClear.classList.toggle('d-none', !q);
                    };

                    // Toggle filter box
                    filterBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isHidden = filterBox.classList.contains('d-none');
                        if (isHidden) {
                            filterBox.classList.remove('d-none');
                            filterBtn.classList.add('active');
                            setTimeout(() => filterInput.focus(), 50);
                        } else {
                            filterBox.classList.add('d-none');
                            filterBtn.classList.remove('active');
                            filterInput.value = '';
                            applyFilter('');
                        }
                    });

                    // Real-time input filtering
                    filterInput.addEventListener('input', (e) => {
                        applyFilter(e.target.value);
                    });

                    // Clear button click
                    filterClear.addEventListener('click', (e) => {
                        e.stopPropagation();
                        filterInput.value = '';
                        applyFilter('');
                        filterInput.focus();
                    });

                    // Keyboard shortcuts
                    filterInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            e.stopPropagation();
                            if (filterInput.value) {
                                filterInput.value = '';
                                applyFilter('');
                            } else {
                                filterBox.classList.add('d-none');
                                filterBtn.classList.remove('active');
                            }
                        }
                    });

                    if (window.bootstrap && bootstrap.Dropdown) {
                        const dd = bootstrap.Dropdown.getOrCreateInstance(btnDb);
                        if (dd && typeof dd.update === 'function') dd.update();
                    }
                } catch (e) {
                    menuDb.innerHTML = `<li><span class="dropdown-item text-danger small">Network error: ${e.message}</span></li>`;
                }
            });
        }

        // 3. Schema Dropdown (Single-select dropdown list)
        if (btnSchema && menuSchema) {
            btnSchema.addEventListener('click', async () => {
                const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                const connId = (activeTab && activeTab.connectionId) || window.ActiveConnectionId;
                const database = (activeTab && activeTab.database) || window.ActiveDatabase;
                const currentSchema = (activeTab && activeTab.schema) || window.ActiveSchema;

                if (!connId || !database) {
                    menuSchema.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-circle-exclamation me-2 text-warning"></i>Select connection and database first</span></li>';
                    return;
                }

                menuSchema.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading schemas…</span></li>';

                try {
                    const res = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(database)}`);
                    const data = await res.json();
                    menuSchema.innerHTML = '';

                    if (!data.success || !Array.isArray(data.items) || data.items.length === 0) {
                        menuSchema.innerHTML = '<li><span class="dropdown-item text-muted small">No schemas found</span></li>';
                    } else {
                        const header = document.createElement('li');
                        header.innerHTML = '<h6 class="dropdown-header text-uppercase" style="font-size: 10px; letter-spacing: 0.5px;">Select Schema</h6>';
                        menuSchema.appendChild(header);

                        data.items.forEach(item => {
                            const name = typeof item === 'string' ? item : (item.name || '');
                            const isCurrent = name === currentSchema;

                            const li = document.createElement('li');
                            li.innerHTML = `
                                <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                    <span><i class="fa-solid fa-layer-group me-2 text-warning"></i>${name}</span>
                                    ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                                </a>
                            `;

                            li.querySelector('a').addEventListener('click', (e) => {
                                e.preventDefault();
                                if (window.bootstrap) {
                                    const dd = bootstrap.Dropdown.getInstance(btnSchema);
                                    if (dd) dd.hide();
                                }

                                const newCtx = { schema: name };
                                if (window.AppTabs) {
                                    window.AppTabs.updateActiveTabContext(newCtx);
                                    if (window.AppTabs.setDefaultContext) {
                                        window.AppTabs.setDefaultContext(newCtx);
                                    }
                                }
                                updateActionBar();
                                showToast(`Switched schema to ${name}`, 'info');
                            });

                            menuSchema.appendChild(li);
                        });
                    }

                    if (window.bootstrap && bootstrap.Dropdown) {
                        const dd = bootstrap.Dropdown.getOrCreateInstance(btnSchema);
                        if (dd && typeof dd.update === 'function') dd.update();
                    }
                } catch (e) {
                    menuSchema.innerHTML = `<li><span class="dropdown-item text-danger small">Network error: ${e.message}</span></li>`;
                }
            });
        }
    }

    // Initialize action bar dropdown selectors
    initActionBarDropdowns();

    // Listen for context change from explorer or dropdown selectors
    document.addEventListener('ide-context-changed', updateActionBar);
    // Also update when tabs switch
    document.addEventListener('ide-tab-switched', (e) => {
        updateActionBar();
        restoreTabResults(e.detail.state);
    });

    function setResultsTabVisible(visible) {
        const resultBtn = tabs['results-grid'] ? tabs['results-grid'].btn : null;
        if (resultBtn) {
            resultBtn.classList.toggle('d-none', !visible);
        }
    }

    function indicateMessagesTabError(hasError) {
        const rtabMessages = document.getElementById('ide-rtab-messages');
        if (!rtabMessages) return;
        let dot = rtabMessages.querySelector('.ide-tab-err-dot');
        if (!dot) {
            dot = document.createElement('span');
            dot.className = 'ide-tab-err-dot d-none';
            dot.title = 'Có lỗi khi thực thi';
            rtabMessages.appendChild(dot);
        }
        dot.classList.toggle('d-none', !hasError);
    }

    // ── Restore Tab Results ───────────────────────────────────────────────────
    function restoreTabResults(state) {
        const tabId = window.AppTabs ? window.AppTabs.getActiveTabId() : null;

        if (!state) {
            clearResults();
            if (messagesEl) messagesEl.innerHTML = '';
            if (planEl) planEl.textContent = '';
            setStatus('');
            setResultsTabVisible(false);
            indicateMessagesTabError(false);
            switchResultView('results-messages');
            return;
        }

        indicateMessagesTabError(Boolean(state && (state.messageType === 'error' || state.messageType === 'warning')));

        if (messagesEl) {
            messagesEl.innerHTML = '';
            if (state.messageText) {
                showMessage(state.messageText, state.messageType || (state.messageText.startsWith('Error') ? 'error' : 'info'), state.messageMetadata || null);
            }
        }
        
        if (planEl) planEl.textContent = state.planText || '';

        const hasData = state.resultData && state.resultData.results && state.resultData.results.some(r => r.columns && r.columns.length > 0);
        setResultsTabVisible(hasData);

        if (hasData) {
            // Check if tab grid DOM container is already cached
            if (tabId && tabGridContainers[tabId]) {
                emptyEl.classList.add('d-none');
                tableWrap.classList.remove('d-none');
                Object.keys(tabGridContainers).forEach(id => {
                    if (tabGridContainers[id]) {
                        tabGridContainers[id].classList.toggle('d-none', id !== tabId);
                    }
                });
                footer.classList.remove('d-none');
                footer.classList.add('d-flex');
                if (window.updateResultFooter) window.updateResultFooter();

                // Refresh layout for restored grids if they were hidden
                const restoredTables = tabGridContainers[tabId].querySelectorAll('table.ide-results-table');
                restoredTables.forEach(tbl => {
                    const inst = window.GridResultManager ? window.GridResultManager.getInstance(tbl) : null;
                    if (inst) {
                        if (inst.gridApi) {
                            requestAnimationFrame(() => {
                                if (inst.gridApi && !inst.gridApi.isDestroyed?.()) {
                                    inst.gridApi.redrawRows();
                                }
                            });
                        }
                        if (inst.renderer) {
                            requestAnimationFrame(() => {
                                if (inst.renderer) inst.renderer.render(false);
                            });
                        }
                    }
                });

                switchResultView(state.activeView || 'results-grid');
            } else {
                renderGrid(state.resultData, state.resultData.durationMs || 0);
                switchResultView(state.activeView || 'results-grid');
            }
        } else {
            clearResults();
            setStatus('');
            switchResultView(state.activeView || 'results-messages');
        }
    }

    // ── Progressive Query Streaming & Cancel State ────────────────────────────
    let currentExecutingConnId = null;
    let currentExecutingQueryId = null;
    let currentStreamingData = null;

    async function cancelQuery() {
        if (!resultPanelState.isRunning) return;
        setStatus('Đang hủy truy vấn… (Cancelling…)', true);
        if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Stopping';
        }
        if (currentStreamingData && currentStreamingData.grids) {
            Object.values(currentStreamingData.grids).forEach(g => {
                if (g && g.table) {
                    const inst = window.GridResultManager ? window.GridResultManager.getInstance(g.table) : null;
                    if (inst) inst.setState('cancelled');
                }
            });
        }
        const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const connId = currentExecutingConnId || (tabState && tabState.connectionId) || window.ActiveConnectionId;
        if (connId) {
            try {
                await fetch('/api/query/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection_id: connId })
                });
            } catch (err) {
                console.warn('Error sending query cancel request:', err);
            }
        }
    }

    // Fast cell formatter helper for data values (PostgreSQL boolean, JSON, etc.)
    function formatGridCell(td, val, colName, colIdx, rowIdx) {
        if (val === null || val === undefined) {
            td.innerHTML = '<span class="ide-null-value">NULL</span>';
            td.classList.add('ide-null-cell');
        } else if (typeof val === 'boolean') {
            td.textContent = String(val);
            td.className = 'ide-bool-value';
        } else {
            const structFormat = (window.StructuredDataDetector && typeof window.StructuredDataDetector.detectCandidate === 'function')
                ? window.StructuredDataDetector.detectCandidate(val, colName)
                : null;
            if (structFormat) {
                const icon = structFormat === 'xml' ? 'fa-file-code' : 'fa-code';
                let displayText = (typeof val === 'object') ? JSON.stringify(val) : String(val);
                displayText = displayText.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
                if (displayText.length > 300) displayText = displayText.slice(0, 300) + '…';
                const rawStr = (typeof val === 'object') ? JSON.stringify(val) : String(val);
                const preview = rawStr.length > 500 ? (rawStr.slice(0, 500) + '…') : rawStr;
                const tooltip = `Click để mở ${structFormat.toUpperCase()} trong tab Editor\n${preview}`;
                const safeEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                td.innerHTML = `<span class="ide-structured-link ide-structured-link-${structFormat}" data-format="${structFormat}" data-col-idx="${colIdx ?? ''}" data-row-idx="${rowIdx ?? ''}" role="button" tabindex="0" title="${safeEscape(tooltip)}"><i class="fa-solid ${icon} me-1"></i>${safeEscape(displayText)}</span>`;
                td.className = '';
                return;
            }
            if (typeof val === 'number') {
                td.textContent = val;
                td.className = 'ide-num-value';
            } else if (typeof val === 'object') {
                try {
                    td.textContent = JSON.stringify(val);
                } catch (e) {
                    td.textContent = String(val);
                }
            } else {
                td.textContent = val;
            }
        }
    }

    // Helper to rebalance pane heights and dock minimized panes to the bottom without white space
    function rebalanceTabPanes(container) {
        if (!container) return;
        const panes = Array.from(container.querySelectorAll('.ide-grid-pane'));
        const splitters = Array.from(container.querySelectorAll('.ide-grid-splitter'));

        const openPanes = panes.filter(p => !p.classList.contains('ide-grid-pane-minimized'));

        splitters.forEach(sp => {
            const prev = sp._prevPane || sp.previousElementSibling;
            const next = sp._nextPane || sp.nextElementSibling;
            const prevMin = prev && prev.classList.contains('ide-grid-pane-minimized');
            const nextMin = next && next.classList.contains('ide-grid-pane-minimized');
            if (prevMin || nextMin) {
                sp.style.display = 'none';
            } else {
                sp.style.display = '';
            }
        });

        if (openPanes.length === 0) return;

        if (openPanes.length === 1) {
            const p = openPanes[0];
            p.style.flex = '1 1 0%';
            p.style.height = 'auto';
            p.style.minHeight = '100px';
        } else {
            openPanes.forEach((p, idx) => {
                const isLastOpen = (idx === openPanes.length - 1);
                if (isLastOpen) {
                    p.style.flex = '1 1 0%';
                    p.style.height = 'auto';
                    p.style.minHeight = '100px';
                } else {
                    const curH = p.style.height;
                    if (!curH || curH === 'auto' || curH === '28px' || curH === '0px') {
                        p.style.height = (p._savedHeight && p._savedHeight !== '28px') ? p._savedHeight : '200px';
                    }
                    p.style.flex = '0 0 auto';
                    p.style.minHeight = '60px';
                }
            });
        }

        if (window.GridResultManager && typeof window.GridResultManager.getAllInstances === 'function') {
            setTimeout(() => {
                window.GridResultManager.getAllInstances().forEach(inst => {
                    if (inst && typeof inst.refreshLayout === 'function') inst.refreshLayout();
                });
            }, 30);
        }
    }

    // Helper to construct a single grid pane with header, col resizers and virtual grid
    function createGridPaneElement(resSet, index, totalGrids, tabContainer, savedWidths, tabId, defaultPaneH, isLast = false) {
        const pane = document.createElement('div');
        pane.className = 'ide-grid-pane';
        pane.dataset.gridIndex = index;
        const rowCount = (resSet.row_count ?? (resSet.rows ? resSet.rows.length : 0));
        const gridNum = index + 1;

        // If it's the last pane (or the only pane), let it flex-grow to occupy 100% of remaining vertical space
        if (isLast || totalGrids === 1) {
            pane.classList.add('ide-grid-pane-last');
            pane.style.flex = '1 1 0%';
            pane.style.height = 'auto';
            pane.style.minHeight = '100px';
        } else {
            pane.style.flex = '0 0 auto';
            pane.style.height = defaultPaneH || '220px';
            pane.style.minHeight = '60px';
        }

        // Toolbar header for this result pane
        const paneToolbar = document.createElement('div');
        paneToolbar.className = 'ide-grid-pane-toolbar d-flex align-items-center justify-content-between px-2 py-1';
        const durBadge = (resSet.duration_ms !== undefined)
            ? `<span class="ide-grid-pane-dur font-monospace" title="Thời gian thực thi câu lệnh"><i class="fa-regular fa-clock me-1"></i>${resSet.duration_ms} ms</span>`
            : '';

        paneToolbar.innerHTML = `
            <div class="d-flex align-items-center gap-2 overflow-hidden ide-grid-pane-info">
                <span class="ide-grid-pane-title fw-semibold font-monospace" style="font-size: 11px;">
                    <i class="fa-solid fa-table me-1 text-primary"></i>Bảng #${gridNum}
                </span>
                <span class="badge bg-secondary-subtle text-body font-monospace ide-grid-pane-rowcount" style="font-size: 10px;">
                    ${rowCount.toLocaleString()} dòng
                </span>
                ${durBadge}
            </div>
            <div class="d-flex align-items-center gap-1 ide-grid-pane-actions">
                <button type="button" class="btn btn-xs btn-outline-secondary ide-btn-grid-minimize" title="Thu nhỏ / Ẩn bảng này xuống dưới">
                    <i class="fa-solid fa-window-minimize"></i>
                </button>
            </div>
        `;
        pane.appendChild(paneToolbar);

        const rowCountBadge = paneToolbar.querySelector('.ide-grid-pane-rowcount');
        pane.updateRowCount = (count) => {
            const num = (typeof count === 'number') ? count : (parseInt(count, 10) || 0);
            if (rowCountBadge) {
                rowCountBadge.textContent = `${num.toLocaleString()} dòng`;
            }
        };

        // Click on pane/toolbar marks it as active and updates status
        const setActiveGrid = () => {
            tabContainer.querySelectorAll('.ide-grid-pane').forEach(p => p.classList.remove('ide-grid-pane-active'));
            pane.classList.add('ide-grid-pane-active');
            if (typeof window.updateActiveGridStatus === 'function') {
                const curRows = (resSet.row_count ?? (resSet.rows ? resSet.rows.length : 0));
                window.updateActiveGridStatus(gridNum, curRows, totalGrids);
            }
        };
        pane.addEventListener('pointerdown', setActiveGrid);
        paneToolbar.addEventListener('click', setActiveGrid);

        const filterBar = document.createElement('div');
        filterBar.className = 'ide-result-filter-bar d-none';
        filterBar.style.display = 'none';
        filterBar.innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-grow-1 text-truncate">
                <i class="fa-solid fa-filter text-primary" style="font-size: 11px;"></i>
                <span class="ide-result-filter-summary text-truncate"></span>
            </div>
            <button type="button" class="ide-btn-clear-all-filters" title="Xóa tất cả bộ lọc trên bảng kết quả này">
                <i class="fa-solid fa-circle-xmark me-1"></i>Xóa tất cả lọc
            </button>
        `;
        pane.appendChild(filterBar);

        if (resSet.isTrace) {
            const traceHeader = document.createElement('div');
            traceHeader.className = 'ide-trace-grid-header d-flex align-items-center justify-content-between px-2 py-1 bg-dark border-bottom border-warning';
            traceHeader.style.cursor = 'pointer';
            traceHeader.title = 'Click để nhảy đến vị trí bs.trace() trong editor';

            const iterBadge = resSet.iteration ? `<span class="badge bg-secondary text-light ms-1" style="font-size: 10px;">Iteration ${resSet.iteration}</span>` : '';
            traceHeader.innerHTML = `
                <div class="d-flex align-items-center gap-2 overflow-hidden">
                    <span class="badge bg-warning text-dark font-monospace fw-bold" style="font-size: 10px;">
                        <i class="fa-solid fa-bug me-1"></i>Trace #${resSet.runtimeOrder || (index + 1)}
                    </span>
                    <span class="small font-monospace text-warning fw-semibold text-truncate" style="max-width: 300px;">
                        ${resSet.traceId || ''}
                    </span>
                    ${iterBadge}
                    <span class="badge bg-dark border border-secondary text-info font-monospace" style="font-size: 10px;">
                        ${resSet.row_count || 0} row(s)
                    </span>
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="small text-muted font-monospace" style="font-size: 10px;">
                        Line ${resSet.sourceLocation ? resSet.sourceLocation.startLine : '?'}
                    </span>
                    <i class="fa-solid fa-arrow-up-right-from-square text-warning" style="font-size: 11px;"></i>
                </div>
            `;

            traceHeader.addEventListener('click', () => {
                if (resSet.sourceLocation) {
                    const loc = resSet.sourceLocation;
                    jumpToEditorLine(loc.startLine, loc.startCol, loc.rawText || loc.innerContent);
                }
            });

            pane.appendChild(traceHeader);
        }

        const tableScroll = document.createElement('div');
        tableScroll.className = 'ide-grid-table-scroll';

        // Minimize / Restore handling
        const minBtn = paneToolbar.querySelector('.ide-btn-grid-minimize');
        let isMinimized = false;
        let savedHeight = pane.style.height;

        minBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isMinimized = !isMinimized;
            if (isMinimized) {
                savedHeight = pane.style.height;
                pane._savedHeight = savedHeight;
                pane.classList.add('ide-grid-pane-minimized');
                pane.style.height = '28px';
                pane.style.flex = '0 0 28px';
                pane.style.minHeight = '28px';
                pane.style.order = '9999';
                tableScroll.style.display = 'none';
                minBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>';
                minBtn.title = 'Mở rộng / Hiện lại bảng này';
            } else {
                pane.classList.remove('ide-grid-pane-minimized');
                pane.style.order = '';
                tableScroll.style.display = '';
                pane.style.height = (savedHeight && savedHeight !== '28px') ? savedHeight : (defaultPaneH || '220px');
                pane.style.flex = isLast ? '1 1 0%' : '0 0 auto';
                pane.style.minHeight = isLast ? '100px' : '60px';
                minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
                minBtn.title = 'Thu nhỏ / Ẩn bảng này xuống dưới';
            }
            rebalanceTabPanes(tabContainer);
        });

        const table = document.createElement('table');
        table.className = 'ide-results-table';
        table._gridPane = pane;
        pane._gridTable = table;

        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        const headerTr = document.createElement('tr');
        const rnTh = document.createElement('th');
        rnTh.className = 'ide-row-number';
        rnTh.textContent = '#';
        headerTr.appendChild(rnTh);

        (resSet.columns || []).forEach((col, cIdx) => {
            const rawColName = typeof col === 'string' ? col : (col ? (col.name || String(col)) : '');
            const colName = rawColName || '(No column name)';
            const colKey = `${index}_${colName}`;
            const th = document.createElement('th');
            const minW = Math.max(38, Math.min(160, colName.length * 8 + 36));
            const w = (savedWidths && (savedWidths[colKey] || savedWidths[colName])) || Math.max(minW, 120);
            th.style.width = w + 'px';
            th.style.minWidth = minW + 'px';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'ide-th-content';

            const label = document.createElement('span');
            label.className = 'ide-th-name';
            label.textContent = colName;
            label.title = colName;
            contentDiv.appendChild(label);

            const filterBtn = document.createElement('button');
            filterBtn.type = 'button';
            filterBtn.className = 'ide-th-filter-btn';
            filterBtn.dataset.colIdx = cIdx;
            filterBtn.dataset.colName = colName;
            filterBtn.title = `Lọc cột [${colName}]`;
            filterBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';
            contentDiv.appendChild(filterBtn);

            th.appendChild(contentDiv);

            const resizer = document.createElement('span');
            resizer.className = 'col-resizer';
            resizer.title = 'Kéo để thay đổi độ rộng cột';
            th.appendChild(resizer);

            let startX, startW;
            let pendingResize = false;
            let latestWidth = 0;

            resizer.addEventListener('pointerdown', e => {
                e.stopPropagation();
                startX = e.clientX;
                startW = th.offsetWidth;
                latestWidth = startW;
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                const onMove = mv => {
                    latestWidth = Math.max(minW, startW + (mv.clientX - startX));
                    if (tabId && savedWidths) savedWidths[colKey] = latestWidth;
                    if (pendingResize) return;
                    pendingResize = true;
                    requestAnimationFrame(() => {
                        pendingResize = false;
                        th.style.width = latestWidth + 'px';
                    });
                };
                const onUp = () => {
                    resizer.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', onUp);
                    th.style.width = latestWidth + 'px';
                };
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
            });

            headerTr.appendChild(th);
        });

        thead.appendChild(headerTr);
        table.appendChild(thead);
        table.appendChild(tbody);
        tableScroll.appendChild(table);
        pane.appendChild(tableScroll);
        tabContainer.appendChild(pane);
        table.addEventListener('click', (e) => {
            const linkEl = e.target.closest('.ide-structured-link');
            if (!linkEl || e.__structuredHandled) return;
            e.__structuredHandled = true;
            const format = linkEl.dataset.format;
            const cIdx = parseInt(linkEl.dataset.colIdx, 10);
            const rIdx = parseInt(linkEl.dataset.rowIdx, 10);
            const col = (resSet.columns || [])[cIdx];
            const rawColName = typeof col === 'string' ? col : (col ? (col.name || String(col)) : '');
            const colName = rawColName || '(No column name)';
            const row = (resSet.rows || [])[rIdx];
            const val = row ? row[cIdx] : null;
            if (window.StructuredDataViewer && typeof window.StructuredDataViewer.openInNewTab === 'function') {
                window.StructuredDataViewer.openInNewTab({
                    value: val,
                    colName: colName,
                    rowIndex: rIdx,
                    format: format
                });
            }
        });

        if (window.GridResultManager) {
            window.GridResultManager.attach(table, resSet, index);
        } else if (resSet.rows && resSet.rows.length > 0) {
            resSet.rows.forEach((row, idx) => {
                const tr = document.createElement('tr');
                const rnTd = document.createElement('td');
                rnTd.className = 'ide-row-number';
                rnTd.textContent = idx + 1;
                tr.appendChild(rnTd);
                row.forEach((val, cIdx) => {
                    const col = (resSet.columns || [])[cIdx];
                    const rawColName = typeof col === 'string' ? col : (col ? (col.name || String(col)) : '');
                    const colName = rawColName || '(No column name)';
                    const td = document.createElement('td');
                    formatGridCell(td, val, colName, cIdx, idx);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        return { pane, table };
    }

    // ── Progressive Query Streaming Hook ──────────────────────────────────────
    window.onQueryProgress = function(evt) {
        if (!evt || !evt.query_id || evt.query_id !== currentExecutingQueryId || !resultPanelState.isRunning) {
            return;
        }

        const tabId = window.AppTabs ? window.AppTabs.getActiveTabId() : null;
        if (!tabColumnWidths[tabId]) tabColumnWidths[tabId] = {};
        const savedWidths = tabColumnWidths[tabId];

        if (!currentStreamingData) {
            emptyEl.classList.add('d-none');
            tableWrap.classList.remove('d-none');
            setResultsTabVisible(true);
            switchResultView('results-grid');

            // Hide any other cached tab containers
            Object.keys(tabGridContainers).forEach(id => {
                if (tabGridContainers[id]) tabGridContainers[id].classList.add('d-none');
            });

            // Clean up old container for this tab if any
            if (tabId && tabGridContainers[tabId]) {
                const oldTables = tabGridContainers[tabId].querySelectorAll('table.ide-results-table');
                oldTables.forEach(tbl => {
                    const inst = window.GridResultManager ? window.GridResultManager.getInstance(tbl) : null;
                    if (inst) inst.destroy();
                });
                tabGridContainers[tabId].remove();
                delete tabGridContainers[tabId];
            }

            const tabContainer = document.createElement('div');
            tabContainer.className = 'ide-tab-grid-wrap w-100 h-100 d-flex flex-column';
            if (tabId) {
                tabContainer.dataset.tabId = tabId;
                tabGridContainers[tabId] = tabContainer;
            }
            tableWrap.appendChild(tabContainer);

            currentStreamingData = {
                tabId,
                tabContainer,
                savedWidths,
                grids: {},
                totalRows: 0
            };
        }

        const resIdx = evt.result_index || 0;

        if (evt.type === 'columns') {
            if (!currentStreamingData.grids[resIdx]) {
                const resSet = { columns: evt.columns, rows: [], row_count: 0 };
                // Insert splitter before subsequent result sets
                if (resIdx > 0 && currentStreamingData.grids[resIdx - 1]) {
                    const prevGrid = currentStreamingData.grids[resIdx - 1];
                    if (prevGrid.pane && !prevGrid.hasSplitter) {
                        prevGrid.hasSplitter = true;
                        prevGrid.pane.style.height = '200px';
                        prevGrid.pane.style.flex = 'none';
                        const splitter = createGridSplitter(prevGrid.pane);
                        currentStreamingData.tabContainer.appendChild(splitter);
                    }
                }
                const initialH = resIdx > 0 ? '200px' : '100%';
                const { pane, table } = createGridPaneElement(resSet, resIdx, 1, currentStreamingData.tabContainer, savedWidths, tabId, initialH, true);
                const inst = window.GridResultManager ? window.GridResultManager.getInstance(table) : null;
                if (inst) inst.setState('loading');
                currentStreamingData.grids[resIdx] = { pane, table, resSet, hasSplitter: false };
            }
            setStatus(`Đang truy vấn... (${evt.columns.length} cột)`);
        } else if (evt.type === 'chunk') {
            let entry = currentStreamingData.grids[resIdx];
            if (!entry) {
                const resSet = { columns: evt.columns, rows: [], row_count: 0 };
                if (resIdx > 0 && currentStreamingData.grids[resIdx - 1]) {
                    const prevGrid = currentStreamingData.grids[resIdx - 1];
                    if (prevGrid.pane && !prevGrid.hasSplitter) {
                        prevGrid.hasSplitter = true;
                        prevGrid.pane.style.height = '200px';
                        prevGrid.pane.style.flex = 'none';
                        const splitter = createGridSplitter(prevGrid.pane);
                        currentStreamingData.tabContainer.appendChild(splitter);
                    }
                }
                const initialH = resIdx > 0 ? '200px' : '100%';
                const { pane, table } = createGridPaneElement(resSet, resIdx, 1, currentStreamingData.tabContainer, savedWidths, tabId, initialH, true);
                entry = { pane, table, resSet, hasSplitter: false };
                currentStreamingData.grids[resIdx] = entry;
            }
            const inst = window.GridResultManager ? window.GridResultManager.getInstance(entry.table) : null;
            if (inst && typeof inst.appendRows === 'function') {
                inst.appendRows(evt.rows);
                if (entry.resSet) {
                    if (Array.isArray(entry.resSet.rows)) entry.resSet.rows.push(...evt.rows);
                    entry.resSet.row_count = (entry.resSet.row_count || 0) + (evt.rows ? evt.rows.length : 0);
                }
            } else {
                const startIdx = entry.resSet.rows.length;
                entry.resSet.rows.push(...evt.rows);
                entry.resSet.row_count = entry.resSet.rows.length;
                const tbody = entry.table ? entry.table.querySelector('tbody') : null;
                if (tbody) {
                    evt.rows.forEach((row, rOffset) => {
                        const tr = document.createElement('tr');
                        const rnTd = document.createElement('td');
                        rnTd.className = 'ide-row-number';
                        rnTd.textContent = startIdx + rOffset + 1;
                        tr.appendChild(rnTd);
                        row.forEach((val, cIdx) => {
                            const col = (entry.resSet.columns || [])[cIdx];
                            const rawColName = typeof col === 'string' ? col : (col ? (col.name || String(col)) : '');
                            const colName = rawColName || '(No column name)';
                            const td = document.createElement('td');
                            formatGridCell(td, val, colName, cIdx, startIdx + rOffset);
                            tr.appendChild(td);
                        });
                        tbody.appendChild(tr);
                    });
                }
            }
            if (entry.pane && typeof entry.pane.updateRowCount === 'function') {
                const cnt = (inst && typeof inst.totalRows === 'number')
                    ? inst.totalRows
                    : (entry.resSet ? (entry.resSet.row_count || (entry.resSet.rows ? entry.resSet.rows.length : 0)) : 0);
                entry.pane.updateRowCount(cnt);
            }
            currentStreamingData.totalRows += evt.rows.length;
            const curCount = currentStreamingData.totalRows;
            setStatus(`Đang tải dữ liệu... Đã nhận ${curCount.toLocaleString()} dòng`);
            if (footerRows) footerRows.textContent = `${curCount.toLocaleString()} rows (streaming...)`;
            if (footer) {
                footer.classList.remove('d-none');
                footer.classList.add('d-flex');
            }
        }
    };

    // ── Editor State Helpers (Cursor, Selection & Scroll Preservation) ─────────
    function resolveMonacoEditor(targetEd) {
        if (!targetEd) {
            targetEd = (typeof window.getActiveAppEditor === 'function')
                ? window.getActiveAppEditor()
                : window.AppEditor;
        }
        if (!targetEd) return null;
        if (typeof targetEd.getPosition === 'function' && typeof targetEd.setScrollTop === 'function') {
            return targetEd;
        }
        if (targetEd.rawEditor && typeof targetEd.rawEditor.getPosition === 'function') {
            return targetEd.rawEditor;
        }
        if (typeof targetEd.getActiveEditor === 'function') {
            const active = targetEd.getActiveEditor();
            if (active && typeof active.getPosition === 'function') return active;
        }
        if (typeof targetEd.getMonacoInstance === 'function') {
            const mon = targetEd.getMonacoInstance();
            if (mon && typeof mon.getPosition === 'function') return mon;
        }
        if (window.AppEditor && window.AppEditor.rawEditor && typeof window.AppEditor.rawEditor.getPosition === 'function') {
            return window.AppEditor.rawEditor;
        }
        return null;
    }

    function captureEditorState(rawEditor) {
        if (!rawEditor) return null;
        try {
            const pos = (typeof rawEditor.getPosition === 'function') ? rawEditor.getPosition() : null;
            const sel = (typeof rawEditor.getSelection === 'function') ? rawEditor.getSelection() : null;
            const sTop = (typeof rawEditor.getScrollTop === 'function') ? rawEditor.getScrollTop() : null;
            const sLeft = (typeof rawEditor.getScrollLeft === 'function') ? rawEditor.getScrollLeft() : null;
            return {
                position: pos ? { lineNumber: pos.lineNumber, column: pos.column } : null,
                selection: sel ? {
                    selectionStartLineNumber: sel.selectionStartLineNumber,
                    selectionStartColumn: sel.selectionStartColumn,
                    positionLineNumber: sel.positionLineNumber,
                    positionColumn: sel.positionColumn
                } : null,
                scrollTop: (typeof sTop === 'number') ? sTop : null,
                scrollLeft: (typeof sLeft === 'number') ? sLeft : null
            };
        } catch (_) {
            return null;
        }
    }

    function restoreEditorState(rawEditor, snapshot) {
        if (!rawEditor || !snapshot) return;
        try {
            if (typeof rawEditor.layout === 'function') {
                rawEditor.layout();
            }
            if (snapshot.position) {
                rawEditor.setPosition(snapshot.position);
            }
            if (snapshot.selection && typeof rawEditor.setSelection === 'function') {
                rawEditor.setSelection(snapshot.selection);
            }
            if (typeof snapshot.scrollTop === 'number') {
                rawEditor.setScrollTop(snapshot.scrollTop);
            }
            if (typeof snapshot.scrollLeft === 'number') {
                rawEditor.setScrollLeft(snapshot.scrollLeft);
            }
            if (snapshot.position) {
                if (typeof rawEditor.revealPositionInCenterIfOutsideViewport === 'function') {
                    rawEditor.revealPositionInCenterIfOutsideViewport(snapshot.position);
                } else if (typeof rawEditor.revealPosition === 'function') {
                    rawEditor.revealPosition(snapshot.position);
                } else if (typeof rawEditor.revealLineInCenter === 'function') {
                    rawEditor.revealLineInCenter(snapshot.position.lineNumber);
                }
            }
            if (typeof rawEditor.focus === 'function') {
                rawEditor.focus();
            }
        } catch (_) {}
    }

    function scheduleEditorStateRestoration(rawEditor, snapshot) {
        if (!rawEditor || !snapshot) return;
        // 1. Immediate restore
        restoreEditorState(rawEditor, snapshot);
        // 2. Next animation frame (after CSS layout/paint changes)
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                restoreEditorState(rawEditor, snapshot);
            });
        }
        // 3. Staggered timers ensuring restoration after result panel animation / reflow finishes
        setTimeout(() => restoreEditorState(rawEditor, snapshot), 50);
        setTimeout(() => restoreEditorState(rawEditor, snapshot), 150);
    }

    // ── Execute query ─────────────────────────────────────────────────────────
    async function executeQuery(skipProtection = false, skipBsCheck = false, confirmed = false, execOptions = {}) {
        if (resultPanelState.isRunning) return;

        const targetEd = (typeof window.getActiveAppEditor === 'function')
            ? window.getActiveAppEditor()
            : window.AppEditor;
        if (!targetEd) return;

        // Snapshot editor state (position, selection, scroll position) at the very beginning BEFORE any DOM alterations (BUG 5)
        const rawEditorInstance = resolveMonacoEditor(targetEd);
        const editorStateSnapshot = captureEditorState(rawEditorInstance);

        const tabState = (typeof window.getActiveExecutingTabState === 'function')
            ? window.getActiveExecutingTabState()
            : (window.AppTabs ? window.AppTabs.getActiveTabState() : null);

        if (tabState && editorStateSnapshot) {
            tabState.savedCursorPosition = editorStateSnapshot.position;
            tabState.savedSelection = editorStateSnapshot.selection;
            tabState.savedScrollTop = editorStateSnapshot.scrollTop;
            tabState.savedScrollLeft = editorStateSnapshot.scrollLeft;
        }

        if (typeof window.ensureResultPanelVisible === 'function') {
            window.ensureResultPanelVisible(true);
        }

        // Prefer selected text and track editor line offset
        let baseStartLine = 1;
        let sql = '';
        if (typeof targetEd.somethingSelected === 'function' && targetEd.somethingSelected()) {
            sql = targetEd.getSelection();
            const monacoSel = (typeof targetEd.getMonacoSelection === 'function')
                ? targetEd.getMonacoSelection()
                : (targetEd.rawEditor ? targetEd.rawEditor.getSelection() : null);
            if (monacoSel && typeof monacoSel.startLineNumber === 'number') {
                baseStartLine = monacoSel.startLineNumber;
            }
        } else if (typeof targetEd.getValue === 'function') {
            sql = targetEd.getValue();
            baseStartLine = 1;
        }

        if (!sql || !sql.trim()) {
            showMessage('Error: Query is empty.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        // Resolve active tab, connection & dbType early so mode checks (debug extensions, fatal actions) have complete state
        let connId   = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        let dbName   = (tabState && tabState.database)     || window.ActiveDatabase;
        let dbType   = (tabState && tabState.dbType)       || window.ActiveDbType;
        let schema   = (tabState && tabState.schema)       || window.ActiveSchema || (window.LastFocusedTreeContext && window.LastFocusedTreeContext.schema);

        // Fallback / Auto-healing for dbType from active or saved connections
        if (!dbType && window.AppExplorer) {
            if (typeof window.AppExplorer.getActiveConnections === 'function') {
                const activeList = window.AppExplorer.getActiveConnections() || [];
                const matched = activeList.find(a => a && (
                    (connId && String(a.connection_id) === String(connId)) ||
                    (tabState && tabState.connectionName && (a.name === tabState.connectionName || a.server === tabState.connectionName)) ||
                    (window.ActiveConnectionName && (a.name === window.ActiveConnectionName || a.server === window.ActiveConnectionName))
                ));
                if (matched && matched.type) dbType = matched.type;
            }
            if (!dbType && typeof window.AppExplorer.getSavedConnections === 'function') {
                const savedList = window.AppExplorer.getSavedConnections() || [];
                const matchedSaved = savedList.find(s => s && (
                    (connId && String(s.connection_id) === String(connId)) ||
                    (tabState && tabState.connectionName && s.name === tabState.connectionName) ||
                    (window.ActiveConnectionName && s.name === window.ActiveConnectionName)
                ));
                if (matchedSaved && matchedSaved.type) dbType = matchedSaved.type;
            }
        }
        if (!dbType) {
            const connNameStr = (tabState && tabState.connectionName) || window.ActiveConnectionName || '';
            if (/postgre/i.test(connNameStr) || /^pge_/i.test(connNameStr)) {
                dbType = 'postgresql';
            } else {
                dbType = 'sqlserver';
            }
        }
        if (tabState && !tabState.dbType && dbType) {
            tabState.dbType = dbType;
        }

        // ── 0. Check & prompt for script parameters (Mục 5.2) ───────────────────
        const queryParams = (execOptions && execOptions.parameters) ? execOptions.parameters : null;
        if (!queryParams && window.QueryParamsManager && typeof window.QueryParamsManager.extractParameters === 'function') {
            const detectedParams = window.QueryParamsManager.extractParameters(sql, dbType);
            if (detectedParams && detectedParams.length > 0) {
                if (tabState && !tabState.cachedParams) tabState.cachedParams = {};
                const cached = (tabState && tabState.cachedParams) ? tabState.cachedParams : {};
                window.QueryParamsManager.showParameterModal(detectedParams, {
                    tabId: (tabState && tabState.id) || 'default',
                    cachedValues: cached,
                    onConfirm: (vals) => {
                        if (tabState) tabState.cachedParams = { ...cached, ...vals };
                        executeQuery(skipProtection, skipBsCheck, confirmed, { ...execOptions, parameters: vals });
                    },
                    onCancel: () => {
                        // User cancelled from parameter modal
                    }
                });
                return;
            }
        }

        const isPg = (
            (dbType && (dbType.toLowerCase() === 'postgresql' || dbType.toLowerCase() === 'postgres' || dbType.toLowerCase() === 'pg' || dbType.toLowerCase().includes('postgr'))) ||
            (window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.isSupported === 'function' && window.DebugExtensionRegistry.isSupported(dbType)) ||
            (tabState && tabState.connectionName && (/postgre/i.test(tabState.connectionName) || /^pge_/i.test(tabState.connectionName))) ||
            (window.ActiveConnectionName && (/postgre/i.test(window.ActiveConnectionName) || /^pge_/i.test(window.ActiveConnectionName)))
        );

        const shouldBypassProtection = (skipProtection === true);
        const shouldBypassBsCheck = (skipBsCheck === true);

        // ── 1. IDE Debug Extensions Check in Normal Mode (Run / F5) ─────────────
        // REQUIREMENT: Check bs.* FIRST before any other popup (such as Fatal Actions Guard for UPDATE/DELETE).
        // If detected:
        //   - "Comment & Run": comment out bs.* in editor, then proceed to Fatal Actions check (skipProtection = false, skipBsCheck = true)
        //   - "Switch to Run Debug": execute via executeDebugQuery()
        //   - "Cancel": abort execution completely
        if (!shouldBypassBsCheck && window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.detectDebugExtensions === 'function') {
            const detectedExts = window.DebugExtensionRegistry.detectDebugExtensions(sql);
            if (detectedExts && detectedExts.length > 0) {
                window.DebugExtensionRegistry.showNormalModeWarningModal(detectedExts, {
                    onCommentAndRun: () => {
                        const isSelection = (typeof targetEd.somethingSelected === 'function' && targetEd.somethingSelected());
                        if (isSelection) {
                            const selText = targetEd.getSelection();
                            const { newSql } = window.DebugExtensionRegistry.commentOutDebugExtensions(selText);
                            if (typeof targetEd.replaceSelection === 'function') {
                                targetEd.replaceSelection(newSql);
                            } else if (typeof targetEd.setValue === 'function') {
                                targetEd.setValue(newSql);
                            }
                        } else {
                            const fullText = (typeof targetEd.getValue === 'function') ? targetEd.getValue() : sql;
                            const { newSql } = window.DebugExtensionRegistry.commentOutDebugExtensions(fullText);
                            if (typeof targetEd.setValue === 'function') {
                                targetEd.setValue(newSql);
                            }
                        }
                        // Execute immediately after commenting bs.*:
                        // IMPORTANT: skipProtection is false so Fatal Actions Guard (UPDATE/DELETE check) runs NEXT!
                        // skipBsCheck is true so we do not re-prompt for bs.*
                        setTimeout(() => {
                            executeQuery(false, true);
                        }, 60);
                    },
                    onSwitchToDebug: () => {
                        executeDebugQuery();
                    },
                    onCancel: () => {
                        // User cancelled from bs.* popup: abort execution completely
                    },
                    onNavigate: (startLine, startCol, endLine, endCol) => {
                        const absStartLine = baseStartLine + startLine - 1;
                        const absEndLine = baseStartLine + endLine - 1;
                        if (targetEd.rawEditor) {
                            try {
                                targetEd.rawEditor.revealLineInCenter(absStartLine);
                                if (typeof monaco !== 'undefined' && monaco.Selection) {
                                    targetEd.rawEditor.setSelection(new monaco.Selection(absStartLine, startCol, absEndLine, endCol));
                                } else {
                                    targetEd.rawEditor.setPosition({ lineNumber: absStartLine, column: startCol });
                                }
                                targetEd.rawEditor.focus();
                            } catch (_) {}
                        }
                    }
                });
                return;
            }
        }

        // ── 2. Fatal Actions Guard (SSMSBoost Fatal Actions Protection) ───────────
        // Checked SECOND after bs.* check.
        // Detects dangerous statements (e.g. UPDATE / DELETE without WHERE, TRUNCATE).
        // Note: skipProtection must be strictly boolean true to bypass,
        // preventing Event objects from click listeners from accidentally bypassing protection.
        if (!shouldBypassProtection && window.SqlProtection && typeof window.SqlProtection.isProtectionEnabled === 'function' && window.SqlProtection.isProtectionEnabled()) {
            const detectedIssues = window.SqlProtection.detectFatalSqlActions(sql, baseStartLine);
            if (detectedIssues && detectedIssues.length > 0) {
                window.SqlProtection.showFatalActionsGuard(detectedIssues, {
                    onContinue: () => {
                        executeQuery(true, true);
                    },
                    onCancel: () => {
                        // Execution aborted by user
                    },
                    onNavigate: (line) => {
                        if (typeof targetEd.setCursor === 'function') {
                            targetEd.setCursor(line, 1);
                        }
                        if (targetEd.rawEditor) {
                            try {
                                targetEd.rawEditor.revealLineInCenter(line);
                                targetEd.rawEditor.setPosition({ lineNumber: line, column: 1 });
                                targetEd.rawEditor.focus();
                            } catch (_) {}
                        }
                    }
                });
                return;
            }
        }

        // Check if connectionId needs auto-healing from active connections (e.g. after reconnect via context menu)
        if (tabState && tabState.connectionName && window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
            const activeList = window.AppExplorer.getActiveConnections() || [];
            const cleanTabConnName = String(tabState.connectionName).replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim();
            const matched = activeList.find(a => (
                a && (
                    (a.name && (a.name.toLowerCase() === tabState.connectionName.toLowerCase() || a.name.toLowerCase() === cleanTabConnName.toLowerCase())) ||
                    (a.server && (a.server.toLowerCase() === tabState.connectionName.toLowerCase() || a.server.toLowerCase() === cleanTabConnName.toLowerCase()))
                ) && (
                    !tabState.dbType || !a.type || a.type === tabState.dbType
                )
            ));
            if (matched && matched.connection_id) {
                if (tabState.connectionId !== matched.connection_id) {
                    tabState.connectionId = matched.connection_id;
                    connId = matched.connection_id;
                    window.ActiveConnectionId = matched.connection_id;
                    if (window.updateActionBar) window.updateActionBar();
                }
            }
        }

        if (!connId) {
            // Check if tab has a connName that can be reconnected
            if (tabState && tabState.connectionName && window.AppExplorer && typeof window.AppExplorer.reconnect === 'function') {
                let savedList = window.AppExplorer.getSavedConnections ? window.AppExplorer.getSavedConnections() : [];
                if ((!savedList || savedList.length === 0) && typeof localStorage !== 'undefined') {
                    try {
                        savedList = JSON.parse(localStorage.getItem('ide_saved_connections') || '[]');
                    } catch (_) {}
                }
                const profile = savedList.find(s => s && s.name === tabState.connectionName && s.type === tabState.dbType);
                if (profile) {
                    window.AppExplorer.reconnect(tabState.connectionName, tabState.dbType, profile, async (newConn) => {
                        const newId = newConn.connection_id || newConn.id;
                        tabState.connectionId = newId;
                        window.ActiveConnectionId = newId;
                        if (window.updateActionBar) window.updateActionBar();
                        executeQuery();
                    });
                    return;
                }
            }
            showMessage('No connection selected.\nPlease click a database in the Object Explorer first.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        // UI: running state
        setRunning(true);
        clearResults();
        setStatus('Running…');

        currentExecutingConnId = connId;
        currentExecutingQueryId = 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        currentStreamingData = null;

        // Phase 2: Asynchronous Query History Logging (< 1ms overhead on UI thread, non-blocking)
        let historyLogPromise = null;
        try {
            const hDocId = (tabState && tabState.docId) || (tabState ? (tabState.docId = (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)))) : 'doc-default');
            const hTitle = (tabState && tabState.title) || 'Untitled.sql';
            const hFilePath = (tabState && tabState.filePath) || null;
            const hServer = (tabState && tabState.connectionName) || window.ActiveConnectionName || 'localhost';
            const hDatabase = dbName || 'master';
            const hLogin = (tabState && tabState.login) || null;
            const hIsSelection = Boolean(typeof targetEd.somethingSelected === 'function' && targetEd.somethingSelected());

            historyLogPromise = fetch('/api/history/log_execution', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: hDocId,
                    display_name: hTitle,
                    file_path: hFilePath,
                    sql: sql,
                    server: hServer,
                    database: hDatabase,
                    login: hLogin,
                    is_selection: hIsSelection,
                    executed_at: Date.now()
                })
            }).then(r => r.json()).then(d => (d && d.success && d.entry_id ? d.entry_id : null)).catch(() => null);
        } catch (_) {
            historyLogPromise = Promise.resolve(null);
        }

        const t0 = performance.now();

        try {
            const limitEl = document.getElementById('ide-query-limit');
            const defaultLimit = (window._sqlConfig && window._sqlConfig.maxRows !== undefined)
                ? Number(window._sqlConfig.maxRows)
                : (window.IDE_SETTINGS?.sql?.maxRows !== undefined ? Number(window.IDE_SETTINGS.sql.maxRows) : 1000);
            const limitVal = limitEl && limitEl.value !== '' ? parseInt(limitEl.value, 10) : defaultLimit;
            const parsedLimit = isNaN(limitVal) ? defaultLimit : limitVal;

            const stopOnErrorSetting = (window.IDE_SETTINGS && window.IDE_SETTINGS.sql && window.IDE_SETTINGS.sql.stopOnError !== undefined)
                ? Boolean(window.IDE_SETTINGS.sql.stopOnError)
                : true;

            const res  = await fetch('/api/query/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connection_id: connId,
                    sql: sql,
                    limit: parsedLimit,
                    database: dbName || null,
                    schema: schema || null,
                    query_id: currentExecutingQueryId,
                    confirmed: Boolean(confirmed),
                    parameters: queryParams || null,
                    stop_on_error: stopOnErrorSetting
                })
            });

            let data;
            try {
                data = await res.json();
            } catch (jsonErr) {
                data = { success: false, error: res.statusText || 'Lỗi phản hồi từ server' };
            }

            // Handle Production Safety Handshake (Mục 5.1)
            if (data && data.needs_confirmation) {
                setRunning(false);
                setStatus('Yêu cầu xác nhận Production');
                if (window.SqlProtection && typeof window.SqlProtection.showProdSafetyDialog === 'function') {
                    window.SqlProtection.showProdSafetyDialog({
                        connectionName: (tabState && tabState.connectionName) || window.ActiveConnectionName || 'PROD Server',
                        database: dbName || 'Mặc định',
                        queryType: data.query_type || 'DML / DDL',
                        message: data.message || 'Bạn đang thực thi thao tác sửa đổi dữ liệu trên môi trường PRODUCTION!',
                        onConfirm: () => {
                            executeQuery(true, true, true, execOptions);
                        },
                        onCancel: () => {
                            showMessage('Đã hủy bỏ thao tác trên môi trường PRODUCTION.', 'info');
                            switchResultView('results-messages');
                        }
                    });
                } else {
                    const ok = confirm(data.message || 'Cảnh báo: Bạn đang thao tác trên môi trường PRODUCTION. Tiếp tục?');
                    if (ok) {
                        executeQuery(true, true, true, execOptions);
                    } else {
                        showMessage('Đã hủy bỏ thao tác trên môi trường PRODUCTION.', 'info');
                        switchResultView('results-messages');
                    }
                }
                return;
            }

            const ms = Math.round(performance.now() - t0);

            // If query execution changed the current database (e.g. USE statement executed),
            // update tab state and action bar
            if (data && data.current_database && window.AppTabs) {
                window.AppTabs.updateActiveTabContext({ database: data.current_database });
            }

            // Phase 5: Automatically invalidate metadata cache if query was a DDL statement
            if (data && data.success && window.AppMetadataCache && typeof window.AppMetadataCache.handleDdlExecution === 'function') {
                window.AppMetadataCache.handleDdlExecution(connId, dbName, sql);
            }

            // Sync connection status with Object Explorer
            if (connId && window.AppExplorer && typeof window.AppExplorer.setConnectionStatus === 'function') {
                if (data && data.success) {
                    window.AppExplorer.setConnectionStatus(connId, null, null, 'connected');
                } else if (data && data.error && /closed|connection|communication link|operationalerror|socket/i.test(data.error)) {
                    window.AppExplorer.setConnectionStatus(connId, null, null, 'lost');
                }
            }

            const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            if (state) state.resultData = { ...data, durationMs: ms };

            // Filter to only result sets with actual columns
            const dataResults = (data && data.results && Array.isArray(data.results))
                ? data.results.filter(r => r.columns && r.columns.length > 0)
                : [];
            const hasData = dataResults.length > 0;
            const hasErrors = Boolean(!res.ok || !data.success || (data.errors && data.errors.length > 0));

            const errorMsg = cleanClientMessage(data.error || '');

            // Phase 2: Update Query History entry result asynchronously
            if (historyLogPromise) {
                const histStatus = hasErrors ? 1 : 0;
                const histErr = hasErrors ? (errorMsg || 'Query execution error') : null;
                historyLogPromise.then(entryId => {
                    if (entryId) {
                        fetch('/api/history/update_execution', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                entry_id: entryId,
                                duration_ms: ms,
                                status: histStatus,
                                error_summary: histErr
                            })
                        }).then(() => {
                            document.dispatchEvent(new CustomEvent('ide-history-updated', { detail: { docId: hDocId } }));
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }

            const errorsList = (data.errors && Array.isArray(data.errors) && data.errors.length > 0)
                ? data.errors
                : (hasErrors ? [{
                    message: errorMsg || 'Query execution failed',
                    line: data.error_line,
                    col: data.error_col
                }] : []);

            // Format SSMS-like messages with clear separation between messages
            let msgBlocks = [];
            if (data.statements && Array.isArray(data.statements) && data.statements.length > 1) {
                const stmtSummary = data.statements.map(s => {
                    const statusIcon = s.error ? '❌ Lỗi' : '✓ Thành công';
                    const aff = (s.rows_affected !== undefined && s.rows_affected >= 0)
                        ? `${s.rows_affected} dòng affected`
                        : (s.rows ? `${s.rows.length} dòng trả về` : '');
                    const errPart = s.error ? ` (${s.error})` : '';
                    return `[Câu lệnh #${s.index} (Dòng ${s.start_line || 1})] ${statusIcon} · ${s.duration_ms || 0} ms · ${aff}${errPart}`;
                }).join('\n');
                msgBlocks.push(stmtSummary);
            }
            if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
                msgBlocks.push(...data.messages.map(cleanClientMessage).filter(m => m !== ''));
            } else if (data.message) {
                const cm = cleanClientMessage(data.message);
                if (cm) msgBlocks.push(cm);
            } else if (errorMsg) {
                msgBlocks.push(errorMsg);
            }
            msgBlocks.push(`Completion time: ${new Date().toLocaleTimeString()} (${ms} ms)`);
            const fullMsgText = msgBlocks.join('\n\n');

            const msgType = hasErrors ? (hasData ? 'warning' : 'error') : 'success';
            showMessage(fullMsgText, msgType, {
                baseStartLine,
                executedSql: sql,
                errors: errorsList
            });

            const streamingUsed = Boolean(currentStreamingData && Object.keys(currentStreamingData.grids).length > 0);

            if (streamingUsed) {
                const finalRows = currentStreamingData.totalRows;
                const gridKeys = Object.keys(currentStreamingData.grids).sort((a, b) => Number(a) - Number(b));
                const gridCount = gridKeys.length;

                // Sync streamed result sets directly into tab state without duplicate bridge payload
                const streamedResults = gridKeys.map(k => currentStreamingData.grids[k].resSet);
                if (state) {
                    state.resultData = {
                        ...data,
                        results: streamedResults,
                        durationMs: ms
                    };
                }

                // Balance pane heights evenly if there are multiple grids
                if (gridCount > 1) {
                    const containerH = tableWrap.clientHeight || 360;
                    const splitterH = 6;
                    const availH = containerH - (gridCount - 1) * splitterH;
                    const paneH = `${Math.max(120, Math.floor(availH / gridCount))}px`;
                    gridKeys.forEach(k => {
                        const g = currentStreamingData.grids[k];
                        if (g && g.pane) {
                            g.pane.style.height = paneH;
                            g.pane.style.flex = 'none';
                        }
                    });
                }

                const finalState = data.cancelled ? 'cancelled' : (hasErrors ? 'error' : 'ready');
                gridKeys.forEach(k => {
                    const g = currentStreamingData.grids[k];
                    const inst = window.GridResultManager ? window.GridResultManager.getInstance(g.table) : null;
                    if (inst) inst.setState(finalState);
                    if (g && g.pane && typeof g.pane.updateRowCount === 'function') {
                        const cnt = (inst && typeof inst.totalRows === 'number')
                            ? (inst.getDisplayRowCount ? inst.getDisplayRowCount() : inst.totalRows)
                            : (g.resSet ? (g.resSet.row_count ?? (g.resSet.rows ? g.resSet.rows.length : 0)) : 0);
                        g.pane.updateRowCount(cnt);
                    }
                });

                if (data.cancelled) {
                    setStatus(`Đã dừng truy vấn theo yêu cầu · Đã nhận ${finalRows.toLocaleString()} dòng · ${ms} ms`, true);
                } else if (hasErrors) {
                    indicateMessagesTabError(true);
                    setStatus(`${finalRows.toLocaleString()} rows · Có lỗi xảy ra · ${ms} ms`, true);
                } else {
                    indicateMessagesTabError(false);
                    setStatus(`${finalRows.toLocaleString()} rows · ${gridCount} grid${gridCount > 1 ? 's' : ''} · ${ms} ms`);
                }
                if (footerTime) footerTime.textContent = `${ms} ms`;
                if (footerRows) footerRows.textContent = `${finalRows.toLocaleString()} row${finalRows !== 1 ? 's' : ''} (${gridCount} result set${gridCount !== 1 ? 's' : ''})`;
                setResultsTabVisible(true);
                switchResultView('results-grid');
            } else if (hasData) {
                // Results available (e.g. statement 1 succeeded) -> Show Results Tab
                setResultsTabVisible(true);
                renderGrid({ results: dataResults }, ms);

                if (hasErrors) {
                    // Subsequent statement failed -> notify user and show indicator on Messages tab
                    const firstErrMsg = (errorsList[0] && (errorsList[0].clean_message || errorsList[0].message)) || errorMsg || 'Có lỗi khi thực thi câu lệnh tiếp theo';
                    const firstErrLine = (errorsList[0] && errorsList[0].line) ? ` tại dòng ${errorsList[0].line}` : '';
                    setStatus(`${dataResults.length} result set${dataResults.length > 1 ? 's' : ''} · Có lỗi xảy ra${firstErrLine} · ${ms} ms`, true);

                    if (typeof showToast === 'function') {
                        showToast(`Câu lệnh 1 thành công. Lỗi${firstErrLine}: ${firstErrMsg}`, 'warning');
                    }

                    indicateMessagesTabError(true);
                } else {
                    indicateMessagesTabError(false);
                }

                switchResultView('results-grid');
            } else {
                // No result sets (all failed or pure DDL/PRINT)
                setResultsTabVisible(false);
                clearResults();
                indicateMessagesTabError(hasErrors);
                if (hasErrors) {
                    setStatus('Error', true);
                }
                switchResultView('results-messages');
            }

            // BUG 5: Restore cursor, selection, and scroll position reliably across execution (both success & errors)
            if (rawEditorInstance && editorStateSnapshot) {
                scheduleEditorStateRestoration(rawEditorInstance, editorStateSnapshot);
            }

        } catch (e) {
            const ms = Math.round(performance.now() - t0);
            const streamingUsed = Boolean(currentStreamingData && currentStreamingData.totalRows > 0);
            if (!streamingUsed) {
                setResultsTabVisible(false);
                clearResults();
            }
            const cleanErr = cleanClientMessage(e.message || 'Unknown execution error');
            if (connId && window.AppExplorer && typeof window.AppExplorer.setConnectionStatus === 'function') {
                if (/network|fetch|connection|closed|lost|socket/i.test(cleanErr)) {
                    window.AppExplorer.setConnectionStatus(connId, null, null, 'lost');
                }
            }
            showMessage(`${cleanErr}\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`, 'error', {
                baseStartLine,
                executedSql: sql,
                errors: [{ message: cleanErr, line: 1, col: 1 }]
            });
            setStatus(cleanErr.toLowerCase().includes('cancel') ? 'Query cancelled' : 'Error', true);

            // Phase 2: Update Query History with error or cancellation
            if (historyLogPromise) {
                const isCancelled = cleanErr.toLowerCase().includes('cancel');
                const histStatus = isCancelled ? 2 : 1;
                historyLogPromise.then(entryId => {
                    if (entryId) {
                        fetch('/api/history/update_execution', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                entry_id: entryId,
                                duration_ms: ms,
                                status: histStatus,
                                error_summary: cleanErr
                            })
                        }).then(() => {
                            document.dispatchEvent(new CustomEvent('ide-history-updated', { detail: { docId: hDocId } }));
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }

            if (!streamingUsed) {
                switchResultView('results-messages');
            }

            // Restore editor state on execution error/exception as well
            if (rawEditorInstance && editorStateSnapshot) {
                scheduleEditorStateRestoration(rawEditorInstance, editorStateSnapshot);
            }
        } finally {
            setRunning(false);
        }
    }

    // ── Execute Debug Query (PostgreSQL IDE Debug Extensions) ─────────────────
    async function executeDebugQuery() {
        if (resultPanelState.isRunning) return;

        const targetEd = (typeof window.getActiveAppEditor === 'function')
            ? window.getActiveAppEditor()
            : window.AppEditor;
        if (!targetEd) return;

        // Snapshot editor state before any DOM changes
        const rawEditorInstance = resolveMonacoEditor(targetEd);
        const editorStateSnapshot = captureEditorState(rawEditorInstance);

        if (typeof window.ensureResultPanelVisible === 'function') {
            window.ensureResultPanelVisible(true);
        }

        let baseStartLine = 1;
        let sql = '';
        if (typeof targetEd.somethingSelected === 'function' && targetEd.somethingSelected()) {
            sql = targetEd.getSelection();
            const monacoSel = (typeof targetEd.getMonacoSelection === 'function')
                ? targetEd.getMonacoSelection()
                : (targetEd.rawEditor ? targetEd.rawEditor.getSelection() : null);
            if (monacoSel && typeof monacoSel.startLineNumber === 'number') {
                baseStartLine = monacoSel.startLineNumber;
            }
        } else if (typeof targetEd.getValue === 'function') {
            sql = targetEd.getValue();
            baseStartLine = 1;
        }

        if (!sql || !sql.trim()) {
            showMessage('Error: Query is empty.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        const tabState = (typeof window.getActiveExecutingTabState === 'function')
            ? window.getActiveExecutingTabState()
            : (window.AppTabs ? window.AppTabs.getActiveTabState() : null);
        const connId   = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        const dbName   = (tabState && tabState.database)     || window.ActiveDatabase;
        const dbType   = (tabState && tabState.dbType)       || window.ActiveDbType;
        const schema   = (tabState && tabState.schema)       || window.ActiveSchema || (window.LastFocusedTreeContext && window.LastFocusedTreeContext.schema);

        if (!connId) {
            showMessage('No connection selected.\nPlease click a database in the Object Explorer first.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        const isPg = (
            (dbType && (dbType.toLowerCase() === 'postgresql' || dbType.toLowerCase() === 'postgres' || dbType.toLowerCase() === 'pg' || dbType.toLowerCase().includes('postgr'))) ||
            (window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.isSupported === 'function' && window.DebugExtensionRegistry.isSupported(dbType))
        );

        if (!isPg) {
            showMessage('Run Debug chỉ hỗ trợ kết nối PostgreSQL.\n(Chế độ Debug Extensions chỉ áp dụng cho PostgreSQL)', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        const detectedExts = (window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.detectDebugExtensions === 'function')
            ? window.DebugExtensionRegistry.detectDebugExtensions(sql)
            : [];

        // Create Debug Session
        const debugSession = window.DebugSessionManager
            ? window.DebugSessionManager.createSession({
                connectionId: connId,
                database: dbName,
                schema: schema,
                traces: detectedExts
            })
            : null;

        const debugSessionId = debugSession ? debugSession.debugSessionId : ('DBG_' + Date.now());

        // UI: running debug state
        setRunning(true);
        clearResults();
        setStatus(`🐞 Debugging (${debugSessionId})…`);

        // Phase 2: Asynchronous Query History Logging
        let historyLogPromise = null;
        try {
            const hDocId = (tabState && tabState.docId) || (tabState ? (tabState.docId = (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)))) : 'doc-default');
            const hTitle = (tabState && tabState.title) || 'Untitled.sql';
            const hFilePath = (tabState && tabState.filePath) || null;
            const hServer = (tabState && tabState.connectionName) || window.ActiveConnectionName || 'localhost';
            const hDatabase = dbName || 'master';
            const hLogin = (tabState && tabState.login) || null;
            const hIsSelection = Boolean(typeof targetEd.somethingSelected === 'function' && targetEd.somethingSelected());

            historyLogPromise = fetch('/api/history/log_execution', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: hDocId,
                    display_name: hTitle,
                    file_path: hFilePath,
                    sql: sql,
                    server: hServer,
                    database: hDatabase,
                    login: hLogin,
                    is_selection: hIsSelection,
                    executed_at: Date.now()
                })
            }).then(r => r.json()).then(d => (d && d.success && d.entry_id ? d.entry_id : null)).catch(() => null);
        } catch (_) {
            historyLogPromise = Promise.resolve(null);
        }

        const t0 = performance.now();

        try {
            const limitEl = document.getElementById('ide-query-limit');
            const defaultLimit = (window._sqlConfig && window._sqlConfig.maxRows !== undefined)
                ? Number(window._sqlConfig.maxRows)
                : (window.IDE_SETTINGS?.sql?.maxRows !== undefined ? Number(window.IDE_SETTINGS.sql.maxRows) : 1000);
            const limitVal = limitEl && limitEl.value !== '' ? parseInt(limitEl.value, 10) : defaultLimit;
            const parsedLimit = isNaN(limitVal) ? defaultLimit : limitVal;

            const res = await fetch('/api/query/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connection_id: connId,
                    sql: sql,
                    limit: parsedLimit,
                    database: dbName || null,
                    schema: schema || null,
                    mode: 'debug',
                    debug_session_id: debugSessionId,
                    traces: detectedExts
                })
            });

            let data;
            try {
                data = await res.json();
            } catch (jsonErr) {
                data = { success: false, error: res.statusText || 'Lỗi phản hồi từ server' };
            }

            const ms = Math.round(performance.now() - t0);

            // Record events in debugSession
            if (debugSession && Array.isArray(data.trace_results)) {
                data.trace_results.forEach(ev => debugSession.recordEvent(ev));
            }

            // Combine standard results and trace results in chronological order
            let combinedResults = [];
            let traceResults = [];
            if (data && Array.isArray(data.results) && data.results.some(r => r.isTrace)) {
                // Backend provided unified chronological ordered results!
                combinedResults = data.results.filter(r => r.columns && r.columns.length > 0).map((r, idx) => {
                    if (r.isTrace) {
                        return {
                            columns: r.columns || [],
                            rows: r.rows || [],
                            row_count: r.row_count || (r.rows ? r.rows.length : 0),
                            isTrace: true,
                            traceId: r.traceId || r.trace_id,
                            runtimeOrder: r.runtimeOrder || r.runtime_order || (idx + 1),
                            iteration: r.iteration || 1,
                            sourceLocation: r.sourceLocation || r.source_location,
                            title: r.title || `Trace #${r.runtimeOrder || (idx + 1)}: ${r.traceId || r.trace_id || ''}${r.iteration > 1 ? ` (Iteration ${r.iteration})` : ''}`
                        };
                    }
                    return {
                        columns: r.columns || [],
                        rows: r.rows || [],
                        row_count: r.row_count || (r.rows ? r.rows.length : 0),
                        isTrace: false,
                        title: r.title || `Result #${idx + 1}`
                    };
                });
                traceResults = combinedResults.filter(r => r.isTrace);
            } else {
                const regularResults = (data && Array.isArray(data.results))
                    ? data.results.filter(r => !r.isTrace && r.columns && r.columns.length > 0)
                    : [];

                traceResults = (data && Array.isArray(data.trace_results))
                    ? data.trace_results.map(tr => ({
                        columns: tr.columns || [],
                        rows: tr.rows || [],
                        row_count: tr.row_count || (tr.rows ? tr.rows.length : 0),
                        isTrace: true,
                        traceId: tr.trace_id,
                        runtimeOrder: tr.runtime_order,
                        iteration: tr.iteration,
                        sourceLocation: tr.source_location,
                        title: `Trace #${tr.runtime_order}: ${tr.trace_id}${tr.iteration > 1 ? ` (Iteration ${tr.iteration})` : ''}`
                    }))
                    : [];

                combinedResults = [...regularResults, ...traceResults];
            }
            const hasData = combinedResults.length > 0;
            const hasErrors = Boolean(!res.ok || !data.success || (data.errors && data.errors.length > 0));

            const errorMsg = cleanClientMessage(data.error || '');

            // Phase 2: Update Query History entry result asynchronously
            if (historyLogPromise) {
                const histStatus = hasErrors ? 1 : 0;
                const histErr = hasErrors ? (errorMsg || 'Debug execution error') : null;
                historyLogPromise.then(entryId => {
                    if (entryId) {
                        fetch('/api/history/update_execution', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                entry_id: entryId,
                                duration_ms: ms,
                                status: histStatus,
                                error_summary: histErr
                            })
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }

            let msgBlocks = [];
            msgBlocks.push(`[🐞 DEBUG SESSION: ${debugSessionId}]`);
            if (traceResults.length > 0) {
                msgBlocks.push(`Đã thu thập ${traceResults.length} Trace Result(s) theo runtime order.`);
            }
            if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
                msgBlocks.push(...data.messages.map(cleanClientMessage).filter(m => m !== ''));
            } else if (data.message) {
                const cm = cleanClientMessage(data.message);
                if (cm) msgBlocks.push(cm);
            }
            if (errorMsg) {
                msgBlocks.push(errorMsg);
            }
            msgBlocks.push(`Completion time: ${new Date().toLocaleTimeString()} (${ms} ms)`);

            const fullMsgText = msgBlocks.join('\n\n');
            const msgType = hasErrors ? (hasData ? 'warning' : 'error') : 'success';

            showMessage(fullMsgText, msgType, {
                baseStartLine,
                executedSql: sql,
                errors: data.errors || (hasErrors ? [{ message: errorMsg, line: 1, col: 1 }] : [])
            });

            if (hasData) {
                setResultsTabVisible(true);
                renderGrid({ results: combinedResults }, ms);
                setStatus(`🐞 Debug Session: ${debugSessionId} · ${traceResults.length} trace(s) · ${ms} ms`);
                switchResultView('results-grid');
            } else {
                setResultsTabVisible(false);
                clearResults();
                indicateMessagesTabError(hasErrors);
                setStatus(hasErrors ? 'Error' : `🐞 Debug Session: ${debugSessionId} · Hoàn thành (${ms} ms)`);
                switchResultView('results-messages');
            }

            if (rawEditorInstance && editorStateSnapshot) {
                scheduleEditorStateRestoration(rawEditorInstance, editorStateSnapshot);
            }

        } catch (e) {
            const ms = Math.round(performance.now() - t0);
            const cleanErr = cleanClientMessage(e.message || 'Unknown debug error');

            // Phase 2: Update Query History with error
            if (historyLogPromise) {
                historyLogPromise.then(entryId => {
                    if (entryId) {
                        fetch('/api/history/update_execution', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                entry_id: entryId,
                                duration_ms: ms,
                                status: 1,
                                error_summary: cleanErr
                            })
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }

            showMessage(`[🐞 DEBUG SESSION: ${debugSessionId}]\n${cleanErr}\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`, 'error');
            setStatus('Debug Error', true);
            setResultsTabVisible(false);
            clearResults();
            switchResultView('results-messages');

            if (rawEditorInstance && editorStateSnapshot) {
                scheduleEditorStateRestoration(rawEditorInstance, editorStateSnapshot);
            }
        } finally {
            setRunning(false);
        }
    }
    window.executeDebugQuery = executeDebugQuery;

    // ── Execution Plan ────────────────────────────────────────────────────────
    async function requestPlan() {
        if (resultPanelState.isRunning) return;

        if (typeof window.ensureResultPanelVisible === 'function') {
            window.ensureResultPanelVisible(true);
        }

        const targetEd = (typeof window.getActiveAppEditor === 'function')
            ? window.getActiveAppEditor()
            : window.AppEditor;
        if (!targetEd) return;

        let sql = (typeof targetEd.getSelection === 'function') ? targetEd.getSelection() : '';
        if (!sql || !sql.trim()) sql = (typeof targetEd.getValue === 'function') ? targetEd.getValue() : '';
        if (!sql.trim()) { showPlan('Error: Query is empty.'); switchResultView('results-plan'); return; }

        const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const connId   = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        const dbName   = (tabState && tabState.database)     || window.ActiveDatabase;
        const dbType   = (tabState && tabState.dbType)       || window.ActiveDbType;

        if (!connId) { showPlan('No connection selected.'); switchResultView('results-plan'); return; }

        setRunning(true);
        showPlan('Generating execution plan…');
        switchResultView('results-plan');

        try {
            const res  = await fetch('/api/query/explain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connection_id: connId,
                    sql: sql,
                    database: dbName || null
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Could not retrieve plan');
            showPlan(data.plan || '(No plan returned)');
        } catch (e) {
            showPlan('Error: ' + e.message);
        } finally {
            setRunning(false);
        }
    }

    // ── Helper: Throttled Grid Splitter for multiple result panes ─────────────
    function createGridSplitter(pane) {
        const splitter = document.createElement('div');
        splitter.className = 'ide-grid-splitter';
        splitter.title = 'Kéo để thay đổi chiều cao các bảng kết quả (Drag to resize results)';

        let startY = 0;
        let startPrevH = 0;
        let startNextH = 0;
        let isDragging = false;
        let rAF = null;

        const onPointerDown = e => {
            if (e.button !== 0 && e.button !== undefined) return;
            isDragging = true;
            try { splitter.setPointerCapture(e.pointerId); } catch (_) {}
            splitter.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';

            startY = e.clientY;
            startPrevH = pane.getBoundingClientRect().height || pane.offsetHeight;
            const nextPane = splitter._nextPane || splitter.nextElementSibling;
            if (nextPane && nextPane.classList.contains('ide-grid-pane')) {
                startNextH = nextPane.getBoundingClientRect().height || nextPane.offsetHeight;
            } else {
                startNextH = 0;
            }

            e.preventDefault();
            e.stopPropagation();
        };

        const onPointerMove = mv => {
            if (!isDragging) return;
            const delta = mv.clientY - startY;
            const minH = 60;
            const nextPane = splitter._nextPane || splitter.nextElementSibling;

            const targetPrevH = Math.max(minH, Math.round(startPrevH + delta));
            if (!rAF) {
                rAF = requestAnimationFrame(() => {
                    rAF = null;
                    pane.style.setProperty('height', `${targetPrevH}px`, 'important');
                    pane.style.setProperty('flex', '0 0 auto', 'important');

                    if (nextPane && nextPane.classList.contains('ide-grid-pane')) {
                        if (nextPane.classList.contains('ide-grid-pane-last')) {
                            nextPane.style.setProperty('flex', '1 1 0%', 'important');
                            nextPane.style.setProperty('height', 'auto', 'important');
                        } else if (startNextH > 0) {
                            const targetNextH = Math.max(minH, Math.round(startNextH - delta));
                            nextPane.style.setProperty('height', `${targetNextH}px`, 'important');
                            nextPane.style.setProperty('flex', '0 0 auto', 'important');
                        }
                    }

                    if (window.GridResultManager && typeof window.GridResultManager.getAllInstances === 'function') {
                        window.GridResultManager.getAllInstances().forEach(inst => {
                            if (inst && typeof inst.refreshLayout === 'function') inst.refreshLayout();
                        });
                    }
                });
            }
        };

        const onPointerUp = e => {
            if (!isDragging) return;
            isDragging = false;
            if (rAF) {
                cancelAnimationFrame(rAF);
                rAF = null;
            }
            try { splitter.releasePointerCapture(e.pointerId); } catch (_) {}
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            if (window.GridResultManager && typeof window.GridResultManager.getAllInstances === 'function') {
                window.GridResultManager.getAllInstances().forEach(inst => {
                    if (inst && typeof inst.refreshLayout === 'function') inst.refreshLayout();
                });
            }
        };

        splitter.addEventListener('pointerdown', onPointerDown);
        splitter.addEventListener('pointermove', onPointerMove);
        splitter.addEventListener('pointerup', onPointerUp);
        splitter.addEventListener('pointercancel', onPointerUp);

        return splitter;
    }

    // ── Render grid (SSMS-like multi-table layout with resizers) ───────────────
    function renderGrid(data, ms) {
        const tabId = window.AppTabs ? window.AppTabs.getActiveTabId() : null;
        if (!tabColumnWidths[tabId]) tabColumnWidths[tabId] = {};
        const savedWidths = tabColumnWidths[tabId];

        emptyEl.classList.add('d-none');
        tableWrap.classList.remove('d-none');

        // Hide any other cached tab containers
        Object.keys(tabGridContainers).forEach(id => {
            if (tabGridContainers[id]) tabGridContainers[id].classList.add('d-none');
        });

        // Remove old container for this tab if any
        if (tabId && tabGridContainers[tabId]) {
            const oldTables = tabGridContainers[tabId].querySelectorAll('table.ide-results-table');
            oldTables.forEach(tbl => {
                const inst = window.GridResultManager ? window.GridResultManager.getInstance(tbl) : null;
                if (inst) inst.destroy();
            });
            tabGridContainers[tabId].remove();
            delete tabGridContainers[tabId];
        }

        const tabContainer = document.createElement('div');
        tabContainer.className = 'ide-tab-grid-wrap w-100 h-100 d-flex flex-column';
        if (tabId) {
            tabContainer.dataset.tabId = tabId;
            tabGridContainers[tabId] = tabContainer;
        }
        tableWrap.appendChild(tabContainer);

        const resultsList = (data.results || []).filter(r => r.columns && r.columns.length > 0);
        if (resultsList.length === 0) {
            clearResults();
            return;
        }

        // Sub-tabs / Summary bar for multiple statements (Mục 5.2)
        if (data.statements && Array.isArray(data.statements) && data.statements.length > 1) {
            const stmtsBar = document.createElement('div');
            stmtsBar.className = 'ide-statements-summary-bar d-flex align-items-center gap-1 flex-wrap';

            data.statements.forEach((stmt) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                const hasErr = Boolean(stmt.error);
                btn.className = `ide-stmt-badge ${hasErr ? 'ide-stmt-error' : 'ide-stmt-success'}`;

                const icon = hasErr ? '<i class="fa-solid fa-circle-xmark"></i>' : '<i class="fa-solid fa-check"></i>';
                const rowText = (stmt.rows && stmt.rows.length > 0)
                    ? `${stmt.rows.length} dòng`
                    : ((stmt.rows_affected !== undefined && stmt.rows_affected >= 0) ? `${stmt.rows_affected} aff` : '');
                const durText = `${stmt.duration_ms || 0}ms`;

                btn.innerHTML = `${icon} <b>#${stmt.index}</b> · ${rowText ? rowText + ' · ' : ''}${durText}`;
                btn.title = `Câu lệnh #${stmt.index} (Dòng ${stmt.start_line}):\n${(stmt.sql || '').slice(0, 150)}${stmt.error ? '\nLỗi: ' + stmt.error : ''}`;

                btn.addEventListener('click', () => {
                    const targetPane = tabContainer.querySelector(`.ide-grid-pane[data-grid-index="${stmt.index - 1}"]`);
                    if (targetPane) {
                        targetPane.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        targetPane.classList.add('ide-grid-pane-active');
                        setTimeout(() => targetPane.classList.remove('ide-grid-pane-active'), 1800);
                    } else if (hasErr) {
                        switchResultView('results-messages');
                    }
                });

                stmtsBar.appendChild(btn);
            });

            tabContainer.appendChild(stmtsBar);
        }

        let totalRowCount = 0;
        const totalGrids = resultsList.length;

        // Calculate default height per grid pane
        const containerH = tableWrap.clientHeight || 360;
        const splitterH = 6;
        const availH = containerH - (totalGrids - 1) * splitterH;
        const defaultPaneH = totalGrids === 1 ? '100%' : `${Math.max(140, Math.floor(availH / totalGrids))}px`;

        let lastCreatedSplitter = null;
        resultsList.forEach((resSet, index) => {
            if (data.statements && data.statements[index]) {
                resSet.duration_ms = data.statements[index].duration_ms;
            }
            totalRowCount += (resSet.row_count ?? resSet.rows.length);
            const isLast = (index === totalGrids - 1);
            const { pane } = createGridPaneElement(resSet, index, totalGrids, tabContainer, savedWidths, tabId, defaultPaneH, isLast);

            if (lastCreatedSplitter) {
                lastCreatedSplitter._nextPane = pane;
                pane._prevSplitter = lastCreatedSplitter;
            }

            // Insert splitter between panes
            if (index < totalGrids - 1) {
                const splitter = createGridSplitter(pane);
                splitter._prevPane = pane;
                pane._nextSplitter = splitter;
                tabContainer.appendChild(splitter);
                lastCreatedSplitter = splitter;
            } else {
                lastCreatedSplitter = null;
            }
        });

        // Function to update status when user clicks a specific grid
        window.updateActiveGridStatus = function(activeGridNum, activeRows, totalGridsCount) {
            if (footerRows) {
                footerRows.innerHTML = `Bảng <b>#${activeGridNum}</b>: <b>${activeRows.toLocaleString()}</b> dòng <span class="text-muted ms-1">(Tổng: ${totalRowCount.toLocaleString()} dòng / ${totalGridsCount} bảng)</span>`;
            }
            setStatus(`Bảng #${activeGridNum}: ${activeRows.toLocaleString()} dòng`);
        };

        // Function to synchronize footer row counts when rows are filtered
        function updateResultFooter() {
            let shownTotal = 0;
            let hiddenTotal = 0;
            const currentContainer = (tabId && tabGridContainers[tabId]) ? tabGridContainers[tabId] : tableWrap;
            const tables = currentContainer.querySelectorAll('table.ide-results-table');
            tables.forEach(tbl => {
                const inst = window.GridResultManager ? window.GridResultManager.getInstance(tbl) : null;
                if (inst) {
                    const shown = inst.getVisibleRowCount();
                    shownTotal += shown;
                    hiddenTotal += (inst.totalRows - shown);
                } else {
                    const trs = tbl.querySelectorAll('tbody tr');
                    trs.forEach(tr => {
                        if (tr.classList.contains('ide-row-filtered-out')) {
                            hiddenTotal++;
                        } else {
                            shownTotal++;
                        }
                    });
                }
            });

            if (hiddenTotal > 0) {
                footerRows.innerHTML = `Hiển thị <b>${shownTotal}</b> / ${totalRowCount} dòng (${totalGrids} result set${totalGrids !== 1 ? 's' : ''})`;
            } else {
                footerRows.textContent = `${totalRowCount} row${totalRowCount !== 1 ? 's' : ''} (${totalGrids} result set${totalGrids !== 1 ? 's' : ''})`;
            }
        }
        window.updateResultFooter = updateResultFooter;

        // Footer
        footerRows.textContent = `${totalRowCount} row${totalRowCount !== 1 ? 's' : ''} (${totalGrids} result set${totalGrids !== 1 ? 's' : ''})`;
        footerTime.textContent = `${ms} ms`;
        footer.classList.remove('d-none');
        footer.classList.add('d-flex');
        setStatus(`${totalRowCount} rows · ${totalGrids} grid${totalGrids > 1 ? 's' : ''} · ${ms} ms`);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function clearResults() {
        const tabId = window.AppTabs ? window.AppTabs.getActiveTabId() : null;
        if (tabId && tabGridContainers[tabId]) {
            tabGridContainers[tabId].classList.add('d-none');
        }
        if (window.StructuredDataViewer && typeof window.StructuredDataViewer.onQueryExecuted === 'function') {
            window.StructuredDataViewer.onQueryExecuted();
        }
        currentStreamingData = null;
        emptyEl.classList.remove('d-none');
        tableWrap.classList.add('d-none');
        footer.classList.add('d-none');
        footer.classList.remove('d-flex');
    }
    window.renderGrid = renderGrid;

    // ── Helper: Clean client-side driver & tuple noise ────────────────────────
    function cleanClientMessage(text) {
        if (!text && text !== 0) return '';
        let s = String(text);
        // If string contains table box-drawing or ASCII table formatting, preserve lines & indentation intact!
        const hasTableFormatting = /[┌─┬┐│├┼┤└┴┘]|\+[-+]+\+/.test(s);
        if (hasTableFormatting) {
            return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\n+|\n+$/g, '');
        }
        if (s.startsWith("(") && s.endsWith(")")) {
            const match = s.match(/^\(['"]?[A-Z0-9]+['"]?,\s*['"](.*)['"]\)$/s);
            if (match) s = match[1];
        }
        s = s.replace(/(\[[^\]\r\n]+\])+/g, (match) => {
            if (/odbc|driver|sql server|client|microsoft|psycopg/i.test(match)) {
                return '';
            }
            return match;
        });
        s = s.replace(/\s*\(\d+\)\s*\([A-Za-z0-9_]+\)\s*$/g, '');
        return s.trim();
    }

    // ── Helper: Jump to Monaco Editor Line & Column ───────────────────────────
    function jumpToEditorLine(targetLine, targetCol, token) {
        let ed = null;
        if (window.AppEditor2 && document.activeElement && document.getElementById('editor-pane-2')?.contains(document.activeElement)) {
            ed = window.AppEditor2.rawEditor || window.AppEditor2;
        } else if (window.AppEditor) {
            ed = window.AppEditor.rawEditor || window.AppEditor;
        }
        if (!ed) return;

        let line = parseInt(targetLine, 10);
        if (isNaN(line) || line < 1) line = 1;
        let col = parseInt(targetCol, 10);
        if (isNaN(col) || col < 1) col = 1;

        const model = (typeof ed.getModel === 'function') ? ed.getModel() : null;
        if (model) {
            const maxLine = model.getLineCount();
            if (line > maxLine) line = maxLine;
            const lineContent = model.getLineContent(line);
            if (token && lineContent) {
                const cleanToken = String(token).replace(/^['"]|['"]$/g, '');
                if (cleanToken) {
                    const idx = lineContent.indexOf(cleanToken);
                    if (idx !== -1) {
                        col = idx + 1;
                        if (typeof ed.setSelection === 'function' && typeof monaco !== 'undefined' && monaco.Selection) {
                            ed.setSelection(new monaco.Selection(line, col, line, col + cleanToken.length));
                        }
                    }
                }
            }
        }

        if (typeof ed.setPosition === 'function') {
            ed.setPosition({ lineNumber: line, column: col });
        }
        if (typeof ed.revealPositionInCenter === 'function') {
            ed.revealPositionInCenter({ lineNumber: line, column: col });
        } else if (typeof ed.revealLineInCenter === 'function') {
            ed.revealLineInCenter(line);
        }
        if (typeof ed.focus === 'function') {
            ed.focus();
        }
    }

    // ── Helper: Robust Clipboard Copying ──────────────────────────────────────
    async function copyTextToClipboard(text) {
        if (!text) return false;
        if (typeof window.copyToClipboard === 'function') {
            return await window.copyToClipboard(text);
        }
        let ok = false;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                ok = true;
            } catch (e) {
                console.warn('[Copy] navigator.clipboard error, fallback to execCommand:', e);
            }
        }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '-9999px';
                ta.setAttribute('readonly', '');
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (e2) {
                console.error('[Copy] execCommand error:', e2);
            }
        }
        return ok;
    }

    // ── Messages Renderer with Clickable Errors & Formatting ──────────────────
    function showMessage(text, type = 'info', metadata = null) {
        const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (state) {
            state.messageText = text;
            state.messageType = type;
            state.messageMetadata = metadata;
        }

        if (!messagesEl) return;
        messagesEl.innerHTML = '';

        if (!text && text !== '') return;

        const baseStartLine = (metadata && typeof metadata.baseStartLine === 'number') ? metadata.baseStartLine : 1;
        const errorList = (metadata && Array.isArray(metadata.errors)) ? metadata.errors : [];

        const rawLines = String(text).split(/\r?\n/);

        // Strip leading and trailing empty/blank lines so messages start directly at top
        while (rawLines.length > 0 && !rawLines[0].trim()) {
            rawLines.shift();
        }
        while (rawLines.length > 0 && !rawLines[rawLines.length - 1].trim()) {
            rawLines.pop();
        }

        function matchErrorMeta(lineText) {
            for (const err of errorList) {
                if (!err) continue;
                if (err.message && lineText && (err.message.includes(lineText.trim()) || lineText.includes(err.message.trim()))) {
                    return err;
                }
                if (err.line) {
                    const linePat = new RegExp(`(?:Line|LINE)\\s+${err.line}\\b`, 'i');
                    if (linePat.test(lineText)) return err;
                }
            }
            const m = lineText.match(/(?:Line|LINE)\s+(\d+)/i) ||
                      lineText.match(/Msg\s+\d+.*Line\s+(\d+)/i) ||
                      lineText.match(/(?:at\s+line|on\s+line)\s+(\d+)/i);
            if (m) {
                const parsedRelLine = parseInt(m[1], 10);
                const found = errorList.find(e => e && e.line === parsedRelLine);
                if (found) return found;
                return { line: parsedRelLine, col: 1, token: '' };
            }
            return null;
        }

        let activeErrorContext = null;

        rawLines.forEach((rawLine) => {
            const isBoxLine = /[┌─┬┐│├┼┤└┴┘]|\+[-+]+\+/.test(rawLine);
            const isBlank = !isBoxLine && (!rawLine || !rawLine.trim());
            const cleaned = isBoxLine ? rawLine : cleanClientMessage(rawLine);
            const lineEl = document.createElement('div');
            lineEl.className = 'ide-msg-line' + (isBoxLine ? ' ide-msg-table-line' : '');

            if (isBlank || (!isBoxLine && !cleaned)) {
                lineEl.className = 'ide-msg-line ide-msg-separator';
                lineEl.innerHTML = '&nbsp;';
                activeErrorContext = null;
                messagesEl.appendChild(lineEl);
                return;
            }

            if (isBoxLine) {
                if (type === 'error') {
                    lineEl.className += ' ide-msg-error';
                } else if (type === 'success') {
                    lineEl.className += ' ide-msg-success';
                } else {
                    lineEl.className += ' ide-msg-info';
                }
                lineEl.textContent = cleaned;
                activeErrorContext = null;
                messagesEl.appendChild(lineEl);
                return;
            }

            // Check if line is an informational rowcount or notice (NOT an error)
            const isRowCount = /^\(\d+\s+row(?:\(s\))?\s+(?:returned|affected)\)/i.test(cleaned);
            if (isRowCount) {
                lineEl.className += ' ide-msg-info';
                lineEl.textContent = cleaned;
                activeErrorContext = null;
                messagesEl.appendChild(lineEl);
                return;
            }

            if (cleaned.startsWith('Completion time:')) {
                lineEl.className += ' ide-msg-muted';
                lineEl.textContent = cleaned;
                activeErrorContext = null;
                messagesEl.appendChild(lineEl);
                return;
            }

            let errMeta = matchErrorMeta(cleaned);
            if (errMeta) {
                activeErrorContext = errMeta;
            } else if (type === 'error' && activeErrorContext) {
                errMeta = activeErrorContext;
            } else if (type === 'error' && errorList.length === 1 && errorList[0] && errorList[0].line) {
                if (/^(?:Msg\b|Error\b|Line\b|LINE\b|Exception\b)/i.test(cleaned) || (errMeta = matchErrorMeta(cleaned))) {
                    errMeta = errorList[0];
                    activeErrorContext = errMeta;
                }
            }

            if (errMeta && errMeta.line) {
                const relLine = parseInt(errMeta.line, 10);
                const absLine = (!isNaN(relLine) && relLine > 0) ? (baseStartLine + relLine - 1) : baseStartLine;
                const col = errMeta.col || 1;
                const token = errMeta.token || '';

                lineEl.className += ' ide-msg-error clickable';
                lineEl.dataset.line = absLine;
                lineEl.dataset.col = col;
                if (token) lineEl.dataset.token = token;
                lineEl.title = `Click đúp để nhảy tới dòng ${absLine} trong editor`;

                const iconSpan = document.createElement('span');
                iconSpan.className = 'ide-msg-jump-icon';
                iconSpan.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>';
                lineEl.appendChild(iconSpan);

                const textSpan = document.createElement('span');
                textSpan.className = 'ide-msg-text';
                textSpan.textContent = cleaned;
                lineEl.appendChild(textSpan);
            } else {
                const isReadOnlyBlocked = cleaned.includes('CHỈ ĐỌC (Read-Only)') || cleaned.includes('ERR_READ_ONLY');
                if (isReadOnlyBlocked) {
                    lineEl.className += ' ide-msg-error d-flex align-items-center flex-wrap gap-2 py-1';
                    const textSpan = document.createElement('span');
                    textSpan.textContent = cleaned;
                    lineEl.appendChild(textSpan);

                    const btnSwitch = document.createElement('button');
                    btnSwitch.type = 'button';
                    btnSwitch.className = 'btn btn-xs btn-outline-warning ide-btn-switch-write py-0 px-2 fw-semibold shadow-sm ms-2';
                    btnSwitch.style.cssText = 'font-size: 11px; height: 22px; line-height: 20px; border-radius: 4px; border: 1px solid #ffc107; cursor: pointer; background: rgba(255,193,7,0.15); color: #ffc107;';
                    btnSwitch.title = 'Bấm để mở hộp thoại chuyển phiên kết nối sang chế độ Ghi (Read-Write)';
                    btnSwitch.innerHTML = '<i class="fa-solid fa-lock-open me-1"></i>Chuyển sang chế độ Ghi';
                    btnSwitch.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                        const connId = (tabState && tabState.connectionId) || window.ActiveConnectionId;
                        const connName = (tabState && tabState.connectionName) || window.ActiveConnectionName || 'Kết nối hiện tại';
                        const db = (tabState && tabState.database) || window.ActiveDatabase;
                        const env = (tabState && tabState.environment) || '';
                        if (window.SqlProtection && typeof window.SqlProtection.showSwitchToWriteModeDialog === 'function') {
                            window.SqlProtection.showSwitchToWriteModeDialog({
                                connectionId: connId,
                                connectionName: connName,
                                database: db,
                                environment: env,
                                onSuccess: () => {
                                    // Tự động chạy lại câu lệnh ngay sau khi chuyển chế độ ghi
                                    executeQuery(true, true);
                                }
                            });
                        }
                    };
                    lineEl.appendChild(btnSwitch);
                } else {
                    if (type === 'error' || cleaned.toLowerCase().startsWith('error') || cleaned.startsWith('Msg ')) {
                        lineEl.className += ' ide-msg-error';
                    } else if (type === 'success') {
                        lineEl.className += ' ide-msg-success';
                    } else {
                        lineEl.className += ' ide-msg-info';
                    }
                    lineEl.textContent = cleaned;
                }
            }

            messagesEl.appendChild(lineEl);
        });
    }

    function showPlan(text) {
        const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (state) state.planText = text;
        if (planEl) planEl.textContent = text;
    }

    function setStatus(text, isError = false) {
        if (resultStatus) {
            resultStatus.textContent = text;
            resultStatus.style.color = isError ? 'var(--ide-danger)' : 'var(--ide-text-muted)';
        }
    }

    function setRunning(running) {
        resultPanelState.isRunning = running;
        if (runBtn) {
            runBtn.disabled = running;
            const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const isDebugActive = Boolean(tab && tab.isDebugActive);
            if (running) {
                runBtn.innerHTML = isDebugActive
                    ? '<i class="fa-solid fa-spinner fa-spin me-1"></i>Debugging'
                    : '<i class="fa-solid fa-spinner fa-spin me-1"></i>Running';
            } else {
                updateActionBar();
            }
        }
        if (stopBtn) {
            stopBtn.disabled = !running;
            stopBtn.innerHTML = '<i class="fa-solid fa-stop me-1"></i>Stop';
        }
        if (!running) {
            currentExecutingConnId = null;
            currentExecutingQueryId = null;
        }
    }

    // ── Unified Run Action (Normal vs PostgreSQL Debug) ──────────────────────
    let lastRunActionTime = 0;
    function handleRunAction() {
        const now = Date.now();
        if (now - lastRunActionTime < 150) return;
        lastRunActionTime = now;

        const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const dbType = (tab && tab.dbType) || window.ActiveDbType || 'sqlserver';
        const isPg = (
            (dbType && (dbType.toLowerCase() === 'postgresql' || dbType.toLowerCase() === 'postgres' || dbType.toLowerCase() === 'pg' || dbType.toLowerCase().includes('postgr'))) ||
            (window.DebugExtensionRegistry && typeof window.DebugExtensionRegistry.isSupported === 'function' && window.DebugExtensionRegistry.isSupported(dbType))
        );
        const isDebugActive = Boolean(tab && tab.isDebugActive) ||
                              Boolean(runBtn && runBtn.classList.contains('is-debug-mode')) ||
                              Boolean(document.getElementById('ide-btn-run-debug')?.classList.contains('active'));
        if (isPg && isDebugActive) {
            executeDebugQuery();
        } else {
            executeQuery(false);
        }
    }
    window.handleRunAction = handleRunAction;

    // ── Keyboard shortcut F5, Ctrl+E, Ctrl+Enter, Ctrl+F5, Alt+F5 & Esc (Cancel) ──
    document.addEventListener('keydown', e => {
        const isRunShortcut = (
            (e.key === 'F5' && !e.ctrlKey && !e.altKey) ||
            ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E' || e.code === 'KeyE')) ||
            ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === 'Enter')
        );

        if (isRunShortcut) {
            const activeEl = document.activeElement;
            const activeTag = activeEl ? activeEl.tagName : '';
            if (activeTag === 'INPUT' || (activeTag === 'TEXTAREA' && !activeEl.closest('.monaco-editor'))) {
                return;
            }
            e.preventDefault();
            handleRunAction();
        } else if (e.key === 'F5' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (window.checkSqlSyntax) window.checkSqlSyntax();
        } else if (e.key === 'F5' && e.altKey) {
            e.preventDefault();
            executeDebugQuery();
        } else if (e.key === 'Escape' && resultPanelState.isRunning) {
            e.preventDefault();
            cancelQuery();
        }
    });

    // ── Bind buttons & Message interactions ───────────────────────────────────
    // runBtn.addEventListener('click', () => executeQuery(false));
    if (runBtn) runBtn.addEventListener('click', () => handleRunAction());
    const runDebugBtn = document.getElementById('ide-btn-run-debug');
    if (runDebugBtn) {
        runDebugBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            if (tab) {
                tab.isDebugActive = !tab.isDebugActive;
                if (typeof showToast === 'function') {
                    showToast(tab.isDebugActive ? 'Chế độ Debug PostgreSQL: ĐÃ BẬT' : 'Chế độ Debug PostgreSQL: ĐÃ TẮT', tab.isDebugActive ? 'warning' : 'info');
                }
            }
            updateActionBar();
            if (window.checkSqlSyntax) window.checkSqlSyntax();
        });
    }
    const parseBtn = document.getElementById('ide-btn-parse');
    if (parseBtn) parseBtn.addEventListener('click', () => {
        if (window.checkSqlSyntax) window.checkSqlSyntax();
    });
    if (stopBtn) stopBtn.addEventListener('click', () => cancelQuery());
    if (planBtn) planBtn.addEventListener('click', () => requestPlan());

    // Copy Messages button
    const copyMsgBtn = document.getElementById('ide-btn-copy-messages');
    if (copyMsgBtn) {
        copyMsgBtn.addEventListener('click', async () => {
            const text = messagesEl ? messagesEl.innerText : '';
            if (!text || !text.trim()) return;
            const ok = await copyTextToClipboard(text);
            if (ok) {
                const origHtml = copyMsgBtn.innerHTML;
                copyMsgBtn.innerHTML = '<i class="fa-solid fa-check me-1 text-success"></i>Đã chép!';
                copyMsgBtn.disabled = true;
                setTimeout(() => {
                    copyMsgBtn.innerHTML = origHtml;
                    copyMsgBtn.disabled = false;
                }, 1500);
            }
        });
    }

    // Double-click error navigation
    if (messagesEl) {
        messagesEl.addEventListener('dblclick', (e) => {
            const lineEl = e.target.closest('.ide-msg-line.clickable, .ide-msg-error.clickable');
            if (lineEl) {
                const line = lineEl.dataset.line;
                const col = lineEl.dataset.col || 1;
                const token = lineEl.dataset.token || '';
                if (line) {
                    jumpToEditorLine(line, col, token);
                }
            }
        });

        // Single click on jump icon
        messagesEl.addEventListener('click', (e) => {
            const jumpIcon = e.target.closest('.ide-msg-jump-icon');
            if (jumpIcon) {
                const lineEl = jumpIcon.closest('.ide-msg-line.clickable, .ide-msg-error.clickable');
                if (lineEl) {
                    const line = lineEl.dataset.line;
                    const col = lineEl.dataset.col || 1;
                    const token = lineEl.dataset.token || '';
                    if (line) {
                        jumpToEditorLine(line, col, token);
                    }
                }
            }
        });
    }

    // ── Bind Transaction Action Buttons (Mục 5.1) ──────────────────────────
    const btnTxToggle = document.getElementById('ide-btn-tx-toggle');
    const btnTxCommit = document.getElementById('ide-btn-tx-commit');
    const btnTxRollback = document.getElementById('ide-btn-tx-rollback');

    if (btnTxToggle) {
        btnTxToggle.addEventListener('click', async () => {
            const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const connId = (tab && tab.connectionId) || window.ActiveConnectionId;
            if (!connId) {
                alert('Vui lòng chọn kết nối trước khi mở giao dịch!');
                return;
            }
            try {
                const res = await fetch('/api/tx/begin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection_id: connId })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') {
                        showToast('Đã bắt đầu giao dịch tường minh (Explicit Transaction).', 'info');
                    }
                    await refreshTxStatus();
                } else {
                    alert(data.error || 'Không thể bắt đầu giao dịch!');
                }
            } catch (err) {
                alert('Lỗi khi gọi API bắt đầu giao dịch: ' + err.message);
            }
        });
    }

    if (btnTxCommit) {
        btnTxCommit.addEventListener('click', async () => {
            const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const connId = (tab && tab.connectionId) || window.ActiveConnectionId;
            if (!connId) return;
            try {
                const res = await fetch('/api/tx/commit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection_id: connId })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') {
                        showToast('Đã COMMIT giao dịch thành công!', 'success');
                    }
                    await refreshTxStatus();
                } else {
                    alert(data.error || 'Lỗi khi COMMIT giao dịch!');
                }
            } catch (err) {
                alert('Lỗi: ' + err.message);
            }
        });
    }

    if (btnTxRollback) {
        btnTxRollback.addEventListener('click', async () => {
            const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const connId = (tab && tab.connectionId) || window.ActiveConnectionId;
            if (!connId) return;
            try {
                const res = await fetch('/api/tx/rollback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection_id: connId })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof showToast === 'function') {
                        showToast('Đã ROLLBACK toàn bộ thay đổi trong giao dịch.', 'warning');
                    }
                    await refreshTxStatus();
                } else {
                    alert(data.error || 'Lỗi khi ROLLBACK giao dịch!');
                }
            } catch (err) {
                alert('Lỗi: ' + err.message);
            }
        });
    }

    // Initial action bar update
    updateActionBar();

    return {
        executeQuery,
        executeDebugQuery,
        handleRunAction,
        runQuery: handleRunAction,
        requestPlan,
        switchResultView,
        updateActionBar,
        getTabColumnWidths: (tabId) => tabColumnWidths[tabId] || {}
    };
}
