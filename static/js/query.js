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
        }
        if (btnDb)     btnDb.title     = `Switch Database (Current: ${dbText})`;
        if (btnSchema) btnSchema.title = `Switch Schema (Current: ${schText})`;
    }
    window.updateActionBar = updateActionBar;

    // ── Centralized Connection Context Activator ──────────────────────────────
    async function activateConnectionContext(connId, connName, dbType, preferredDb = null, preferredSchema = null) {
        // If preferredSchema is not provided, look up from saved connections
        if (!preferredSchema) {
            let savedList = [];
            if (window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                savedList = window.AppExplorer.getSavedConnections() || [];
            }
            const foundProfile = savedList.find(s => s && s.type === (dbType || 'postgresql') && (s.name === connName || s.connection_id === connId));
            if (foundProfile && foundProfile.schema) {
                preferredSchema = foundProfile.schema;
            }
        }

        // 1. Immediately update global state & UI so ide-ctx-connection updates without waiting for network
        window.ActiveConnectionId   = connId;
        window.ActiveConnectionName = connName;
        window.ActiveDbType         = dbType || 'sqlserver';
        if (preferredDb) window.ActiveDatabase = preferredDb;
        if (preferredSchema) window.ActiveSchema = preferredSchema;

        const immediateCtx = {
            connectionId: connId,
            connectionName: connName,
            dbType: dbType || 'sqlserver',
            database: preferredDb || null,
            schema: preferredSchema || null
        };

        if (window.AppTabs) {
            if (window.AppTabs.updateActiveTabContext) {
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

        if (newCtx.database) window.ActiveDatabase = newCtx.database;
        if (newCtx.schema) window.ActiveSchema = newCtx.schema;

        // Apply updated database and schema to active tab and action bar
        if (window.AppTabs) {
            window.AppTabs.updateActiveTabContext(newCtx);
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

                    // Load saved connections from localStorage or AppExplorer
                    let savedList = [];
                    if (window.AppExplorer && window.AppExplorer.getSavedConnections) {
                        savedList = window.AppExplorer.getSavedConnections();
                    } else if (window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
                        try {
                            savedList = await window.AppStorage.getSavedConnections() || [];
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
                                    await activateConnectionContext(c.connId, c.name, c.type, c.config?.database, c.config?.schema);
                                    showToast(`Switched connection to ${c.name}`, 'success');
                                } else {
                                    showToast(`Connecting to ${c.name}…`, 'info');
                                    if (window.AppExplorer && window.AppExplorer.reconnect) {
                                        window.AppExplorer.reconnect(c.name, c.type, c.config, async (newConn) => {
                                            const newId = newConn.connection_id || newConn.id;
                                            await activateConnectionContext(newId, c.name, c.type, c.config?.database, c.config?.schema);
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

                            // Single selection: set active database and default schema (dbo for sqlserver, public for postgresql)
                            let defaultSchema = dbType === 'postgresql' ? 'public' : 'dbo';
                            let preferredSch = null;
                            if (dbType === 'postgresql') {
                                if (window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                                    const savedList = window.AppExplorer.getSavedConnections() || [];
                                    const profile = savedList.find(s => s && s.type === dbType && (s.name === currentConnName || s.connection_id === connId));
                                    if (profile && profile.schema && (!profile.database || profile.database === dbName)) {
                                        preferredSch = profile.schema;
                                    }
                                }
                            }
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

    // ── Execute query ─────────────────────────────────────────────────────────
    async function executeQuery() {
        if (resultPanelState.isRunning) return;

        if (typeof window.ensureResultPanelVisible === 'function') {
            window.ensureResultPanelVisible(true);
        }

        if (!window.AppEditor) return;

        // Prefer selected text and track editor line offset
        let baseStartLine = 1;
        let sql = '';
        if (typeof window.AppEditor.somethingSelected === 'function' && window.AppEditor.somethingSelected()) {
            sql = window.AppEditor.getSelection();
            const monacoSel = (typeof window.AppEditor.getMonacoSelection === 'function')
                ? window.AppEditor.getMonacoSelection()
                : (window.AppEditor.rawEditor ? window.AppEditor.rawEditor.getSelection() : null);
            if (monacoSel && typeof monacoSel.startLineNumber === 'number') {
                baseStartLine = monacoSel.startLineNumber;
            }
        } else if (typeof window.AppEditor.getValue === 'function') {
            sql = window.AppEditor.getValue();
            baseStartLine = 1;
        }

        if (!sql || !sql.trim()) {
            showMessage('Error: Query is empty.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const connId   = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        const dbName   = (tabState && tabState.database)     || window.ActiveDatabase;
        const dbType   = (tabState && tabState.dbType)       || window.ActiveDbType;
        const schema   = (tabState && tabState.schema)       || window.ActiveSchema || (window.LastFocusedTreeContext && window.LastFocusedTreeContext.schema);

        if (!connId) {
            // Check if tab has a connName that can be reconnected
            if (tabState && tabState.connectionName && window.AppExplorer && typeof window.AppExplorer.reconnect === 'function') {
                const savedList = window.AppExplorer.getSavedConnections ? window.AppExplorer.getSavedConnections() : [];
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

        const t0 = performance.now();

        try {
            const limitEl = document.getElementById('ide-query-limit');
            const limitVal = limitEl ? parseInt(limitEl.value, 10) : 1000;
            const parsedLimit = isNaN(limitVal) ? 1000 : limitVal;

            const res  = await fetch('/api/query/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connection_id: connId,
                    sql: sql,
                    limit: parsedLimit,
                    database: dbName || null,
                    schema: schema || null
                })
            });

            let data;
            try {
                data = await res.json();
            } catch (jsonErr) {
                data = { success: false, error: res.statusText || 'Lỗi phản hồi từ server' };
            }
            const ms = Math.round(performance.now() - t0);

            // If query execution changed the current database (e.g. USE statement executed),
            // update tab state and action bar
            if (data && data.current_database && window.AppTabs) {
                window.AppTabs.updateActiveTabContext({ database: data.current_database });
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
            const errorsList = (data.errors && Array.isArray(data.errors) && data.errors.length > 0)
                ? data.errors
                : (hasErrors ? [{
                    message: errorMsg || 'Query execution failed',
                    line: data.error_line,
                    col: data.error_col,
                    token: data.error_token
                }] : []);

            // Format SSMS-like messages
            let msgLines = [];
            if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
                msgLines = data.messages.map(cleanClientMessage).filter(m => m !== '');
            } else if (data.message) {
                const cm = cleanClientMessage(data.message);
                if (cm) msgLines.push(cm);
            } else if (errorMsg) {
                msgLines = [errorMsg];
            }
            msgLines.push(`\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`);
            const fullMsgText = msgLines.join('\n');

            const msgType = hasErrors ? (hasData ? 'warning' : 'error') : 'success';
            showMessage(fullMsgText, msgType, {
                baseStartLine,
                executedSql: sql,
                errors: errorsList
            });

            if (hasData) {
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

        } catch (e) {
            const ms = Math.round(performance.now() - t0);
            setResultsTabVisible(false);
            const cleanErr = cleanClientMessage(e.message || 'Unknown execution error');
            showMessage(`${cleanErr}\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`, 'error', {
                baseStartLine,
                executedSql: sql,
                errors: [{ message: cleanErr, line: 1, col: 1 }]
            });
            setStatus('Error', true);
            switchResultView('results-messages');
        } finally {
            setRunning(false);
        }
    }

    // ── Execution Plan ────────────────────────────────────────────────────────
    async function requestPlan() {
        if (resultPanelState.isRunning) return;

        if (typeof window.ensureResultPanelVisible === 'function') {
            window.ensureResultPanelVisible(true);
        }

        if (!window.AppEditor) return;

        let sql = window.AppEditor.getSelection();
        if (!sql || !sql.trim()) sql = window.AppEditor.getValue();
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

        let totalRowCount = 0;
        const totalGrids = resultsList.length;

        // Calculate default height per grid pane
        const containerH = tableWrap.clientHeight || 360;
        const splitterH = 6;
        const availH = containerH - (totalGrids - 1) * splitterH;
        const defaultPaneH = totalGrids === 1 ? '100%' : `${Math.max(140, Math.floor(availH / totalGrids))}px`;

        resultsList.forEach((resSet, index) => {
            totalRowCount += (resSet.row_count ?? resSet.rows.length);

            // Create grid pane container
            const pane = document.createElement('div');
            pane.className = 'ide-grid-pane';
            pane.dataset.gridIndex = index;
            pane.style.height = defaultPaneH;
            if (totalGrids === 1) {
                pane.style.flex = '1 1 100%';
            }

            // Filter bar banner for this grid pane
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

            // Table scroll wrapper (enables sticky thead while filterBar stays neatly above)
            const tableScroll = document.createElement('div');
            tableScroll.className = 'ide-grid-table-scroll';

            // Create table
            const table = document.createElement('table');
            table.className = 'ide-results-table';

            const thead = document.createElement('thead');
            const tbody = document.createElement('tbody');

            // Header
            const headerTr = document.createElement('tr');

            // Row-number column header
            const rnTh = document.createElement('th');
            rnTh.className = 'ide-row-number';
            rnTh.textContent = '';
            headerTr.appendChild(rnTh);

            resSet.columns.forEach((col, cIdx) => {
                const colName = typeof col === 'string' ? col : col.name;
                const colKey = `${index}_${colName}`;
                const th = document.createElement('th');
                const minW = Math.max(38, Math.min(160, colName.length * 8 + 36));
                const w = savedWidths[colKey] || savedWidths[colName] || Math.max(minW, 120);
                th.style.width = w + 'px';
                th.style.minWidth = minW + 'px';

                // Content wrapper: column title + filter button
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

                // Resize handle
                const resizer = document.createElement('span');
                resizer.className = 'col-resizer';
                resizer.title = 'Kéo để thay đổi độ rộng cột';
                th.appendChild(resizer);

                // Resizer drag with requestAnimationFrame to prevent forced synchronous layout
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
                        if (tabId) savedWidths[colKey] = latestWidth;
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

            // Fast cell formatter helper for data values (PostgreSQL boolean, JSON, etc.)
            function formatGridCell(td, val) {
                if (val === null || val === undefined) {
                    td.innerHTML = '<span class="ide-null-value">NULL</span>';
                    td.classList.add('ide-null-cell');
                } else if (typeof val === 'number') {
                    td.textContent = val;
                    td.className = 'ide-num-value';
                } else if (typeof val === 'boolean') {
                    // Supports PostgreSQL boolean (true/false) as well as SQL Server bit
                    td.textContent = String(val);
                    td.className = 'ide-bool-value';
                } else if (typeof val === 'object') {
                    // PostgreSQL JSON, JSONB, arrays, etc.
                    try {
                        td.textContent = JSON.stringify(val);
                    } catch (e) {
                        td.textContent = String(val);
                    }
                } else {
                    td.textContent = val;
                }
            }

            table.appendChild(tbody);
            tableScroll.appendChild(table);
            pane.appendChild(tableScroll);
            tabContainer.appendChild(pane);

            // Gắn GridResultManager cho cell selection, phím tắt, filter, context menu và virtual row rendering
            if (window.GridResultManager) {
                window.GridResultManager.attach(table, resSet, index);
            } else {
                // Fallback row population if GridResultManager is not loaded
                resSet.rows.forEach((row, idx) => {
                    const tr = document.createElement('tr');
                    const rnTd = document.createElement('td');
                    rnTd.className = 'ide-row-number';
                    rnTd.textContent = idx + 1;
                    tr.appendChild(rnTd);
                    row.forEach(val => {
                        const td = document.createElement('td');
                        formatGridCell(td, val);
                        tr.appendChild(td);
                    });
                    tbody.appendChild(tr);
                });
            }

            // Insert splitter between panes
            if (index < totalGrids - 1) {
                const splitter = document.createElement('div');
                splitter.className = 'ide-grid-splitter';
                splitter.title = 'Drag to resize results';

                let startY, startH;
                splitter.addEventListener('pointerdown', e => {
                    e.preventDefault();
                    startY = e.clientY;
                    startH = pane.offsetHeight;
                    splitter.classList.add('dragging');
                    document.body.style.cursor = 'row-resize';
                    document.body.style.userSelect = 'none';

                    const onPointerMove = mv => {
                        const delta = mv.clientY - startY;
                        const newH = Math.max(60, startH + delta);
                        pane.style.height = `${newH}px`;
                        pane.style.flex = 'none';
                    };

                    const onPointerUp = () => {
                        splitter.classList.remove('dragging');
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.removeEventListener('pointermove', onPointerMove);
                        document.removeEventListener('pointerup', onPointerUp);
                    };

                    document.addEventListener('pointermove', onPointerMove);
                    document.addEventListener('pointerup', onPointerUp);
                });

                tabContainer.appendChild(splitter);
            }
        });

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
            const cleaned = cleanClientMessage(rawLine);
            const lineEl = document.createElement('div');
            lineEl.className = 'ide-msg-line';

            if (!cleaned) {
                lineEl.innerHTML = '&nbsp;';
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
                if (type === 'error' || cleaned.toLowerCase().startsWith('error') || cleaned.startsWith('Msg ')) {
                    lineEl.className += ' ide-msg-error';
                } else if (type === 'success') {
                    lineEl.className += ' ide-msg-success';
                } else {
                    lineEl.className += ' ide-msg-info';
                }
                lineEl.textContent = cleaned;
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
            runBtn.innerHTML = running
                ? '<i class="fa-solid fa-spinner fa-spin me-1"></i>Running'
                : '<i class="fa-solid fa-play me-1"></i>Run';
        }
        if (stopBtn) stopBtn.disabled = !running;
    }

    // ── Keyboard shortcut F5 ──────────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.key === 'F5' && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            executeQuery();
        }
    });

    // ── Bind buttons & Message interactions ───────────────────────────────────
    if (runBtn)  runBtn.addEventListener('click', executeQuery);
    if (planBtn) planBtn.addEventListener('click', requestPlan);

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

    // Initial action bar update
    updateActionBar();

    return {
        executeQuery,
        requestPlan,
        switchResultView,
        updateActionBar,
        getTabColumnWidths: (tabId) => tabColumnWidths[tabId] || {}
    };
}
