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

        if (dbLabel)   dbLabel.textContent   = dbText;
        if (schemaLabel) schemaLabel.textContent = schText;

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
                    if (preferredSchema && sNames.includes(preferredSchema)) {
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
            newCtx.schema = newCtx.dbType === 'postgresql' ? 'public' : 'dbo';
        }

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
                    } else {
                        try {
                            const raw = localStorage.getItem('ide_saved_connections');
                            if (raw) savedList = JSON.parse(raw);
                        } catch (_) {}
                    }

                    const allItems = [];
                    const seenKeys = new Set();

                    // Saved profiles first
                    savedList.forEach(s => {
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
                                if (window.bootstrap) {
                                    const dd = bootstrap.Dropdown.getInstance(btnConn);
                                    if (dd) dd.hide();
                                }

                                if (c.isActive && c.connId) {
                                    showToast(`Switching to ${c.name}…`, 'info');
                                    await activateConnectionContext(c.connId, c.name, c.type, c.config?.database);
                                    showToast(`Switched connection to ${c.name}`, 'success');
                                } else {
                                    showToast(`Connecting to ${c.name}…`, 'info');
                                    if (window.AppExplorer && window.AppExplorer.reconnect) {
                                        window.AppExplorer.reconnect(c.name, c.type, c.config, async (newConn) => {
                                            const newId = newConn.connection_id || newConn.id;
                                            await activateConnectionContext(newId, c.name, c.type, c.config?.database);
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
                    header.innerHTML = '<h6 class="dropdown-header text-uppercase" style="font-size: 10px; letter-spacing: 0.5px;">Select Database</h6>';
                    menuDb.appendChild(header);

                    data.items.forEach(item => {
                        const dbName = typeof item === 'string' ? item : (item.name || '');
                        const isCurrent = dbName === currentDb;

                        const li = document.createElement('li');
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
                            try {
                                const sRes = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
                                const sData = await sRes.json();
                                if (sData.success && Array.isArray(sData.items) && sData.items.length > 0) {
                                    const sNames = sData.items.map(s => typeof s === 'string' ? s : (s.name || ''));
                                    if (dbType === 'postgresql' && sNames.includes('public')) {
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

    // ── Restore Tab Results ───────────────────────────────────────────────────
    function restoreTabResults(state) {
        if (!state) {
            clearResults();
            if (messagesEl) messagesEl.innerHTML = '';
            if (planEl) planEl.textContent = '';
            setStatus('');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        if (messagesEl) {
            messagesEl.innerHTML = '';
            if (state.messageText) {
                const pre = document.createElement('span');
                pre.className = state.messageText.startsWith('Error') ? 'msg-error' : 'msg-success';
                pre.textContent = state.messageText;
                messagesEl.appendChild(pre);
            }
        }
        
        if (planEl) planEl.textContent = state.planText || '';

        clearResults();
        const hasData = state.resultData && state.resultData.results && state.resultData.results.some(r => r.columns && r.columns.length > 0);
        setResultsTabVisible(hasData);

        if (hasData) {
            renderGrid(state.resultData, state.resultData.durationMs || 0);
            switchResultView(state.activeView || 'results-grid');
        } else {
            setStatus('');
            switchResultView(state.activeView || 'results-messages');
        }
    }

    // ── Execute query ─────────────────────────────────────────────────────────
    async function executeQuery() {
        if (resultPanelState.isRunning) return;

        if (!window.AppEditor) return;

        // Prefer selected text
        let sql = window.AppEditor.getSelection();
        if (!sql || !sql.trim()) sql = window.AppEditor.getValue();
        if (!sql.trim()) {
            showMessage('Error: Query is empty.', 'error');
            setResultsTabVisible(false);
            switchResultView('results-messages');
            return;
        }

        const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        const connId   = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        const dbName   = (tabState && tabState.database)     || window.ActiveDatabase;
        const dbType   = (tabState && tabState.dbType)       || window.ActiveDbType;

        if (!connId) {
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
                    database: dbName || null
                })
            });
            const data = await res.json();
            const ms   = Math.round(performance.now() - t0);

            if (!res.ok || !data.success) throw new Error(data.error || 'Unknown error');

            // If query execution changed the current database (e.g. USE statement executed),
            // update tab state and action bar
            if (data.current_database && window.AppTabs) {
                window.AppTabs.updateActiveTabContext({ database: data.current_database });
            }

            const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            if (state) state.resultData = { ...data, durationMs: ms };

            // Filter to only result sets with actual columns (skip USE/DDL empty sets)
            const dataResults = (data.results || []).filter(r => r.columns && r.columns.length > 0);

            // Format SSMS-like messages
            let msgLines = [];
            if (data.messages && data.messages.length > 0) {
                msgLines = [...data.messages];
            } else if (data.message) {
                msgLines.push(data.message);
            }
            msgLines.push(`\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`);
            const msgText = msgLines.join('\n');

            if (dataResults.length > 0) {
                // SELECT result(s) -> Show Results Tab
                setResultsTabVisible(true);
                renderGrid({ results: dataResults }, ms);
                showMessage(msgText, 'success');
                switchResultView('results-grid');
            } else {
                // DDL / DML / PRINT -> Hide Results Tab (SSMS Parity)
                setResultsTabVisible(false);
                clearResults();
                showMessage(msgText, 'success');
                switchResultView('results-messages');
            }

        } catch (e) {
            const ms = Math.round(performance.now() - t0);
            setResultsTabVisible(false);
            showMessage(`Msg: ${e.message}\nCompletion time: ${new Date().toLocaleTimeString()} (${ms} ms)`, 'error');
            setStatus('Error', true);
            switchResultView('results-messages');
        } finally {
            setRunning(false);
        }
    }

    // ── Execution Plan ────────────────────────────────────────────────────────
    async function requestPlan() {
        if (resultPanelState.isRunning) return;
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
        tableWrap.innerHTML = ''; // Clear container

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
                const w = savedWidths[colKey] || savedWidths[colName] || 120;
                th.style.width = w + 'px';
                th.style.minWidth = '50px';

                const label = document.createElement('span');
                label.textContent = colName;
                label.style.pointerEvents = 'none';
                th.appendChild(label);

                // Resize handle
                const resizer = document.createElement('span');
                resizer.className = 'col-resizer';
                resizer.title = 'Drag to resize';
                th.appendChild(resizer);

                // Resizer drag
                let startX, startW;
                resizer.addEventListener('pointerdown', e => {
                    e.stopPropagation();
                    startX = e.clientX;
                    startW = th.offsetWidth;
                    resizer.classList.add('dragging');
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';

                    const onMove = mv => {
                        const newW = Math.max(50, startW + (mv.clientX - startX));
                        th.style.width = newW + 'px';
                        if (tabId) savedWidths[colKey] = newW;
                    };
                    const onUp = () => {
                        resizer.classList.remove('dragging');
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        document.removeEventListener('pointermove', onMove);
                        document.removeEventListener('pointerup', onUp);
                    };
                    document.addEventListener('pointermove', onMove);
                    document.addEventListener('pointerup', onUp);
                });

                headerTr.appendChild(th);
            });
            thead.appendChild(headerTr);
            table.appendChild(thead);

            // Rows
            resSet.rows.forEach((row, idx) => {
                const tr = document.createElement('tr');

                const rnTd = document.createElement('td');
                rnTd.className = 'ide-row-number';
                rnTd.textContent = idx + 1;
                tr.appendChild(rnTd);

                row.forEach(val => {
                    const td = document.createElement('td');
                    if (val === null || val === undefined) {
                        td.innerHTML = '<span class="ide-null-value">NULL</span>';
                    } else if (typeof val === 'number') {
                        td.textContent = val;
                        td.className = 'ide-num-value';
                    } else if (typeof val === 'boolean') {
                        td.textContent = val ? '1' : '0';
                        td.className = 'ide-bool-value';
                    } else {
                        td.textContent = val;
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            pane.appendChild(table);
            tableWrap.appendChild(pane);

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

                tableWrap.appendChild(splitter);
            }
        });

        // Footer
        footerRows.textContent = `${totalRowCount} row${totalRowCount !== 1 ? 's' : ''} (${totalGrids} result set${totalGrids !== 1 ? 's' : ''})`;
        footerTime.textContent = `${ms} ms`;
        footer.classList.remove('d-none');
        footer.classList.add('d-flex');
        setStatus(`${totalRowCount} rows · ${totalGrids} grid${totalGrids > 1 ? 's' : ''} · ${ms} ms`);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function clearResults() {
        tableWrap.innerHTML = '';
        emptyEl.classList.remove('d-none');
        tableWrap.classList.add('d-none');
        footer.classList.add('d-none');
        footer.classList.remove('d-flex');
    }

    function showMessage(text, type = 'info') {
        const state = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (state) state.messageText = text;
        
        if (!messagesEl) return;
        messagesEl.innerHTML = '';
        const pre = document.createElement('span');
        pre.className = type === 'error' ? 'msg-error' : type === 'success' ? 'msg-success' : '';
        pre.textContent = text;
        messagesEl.appendChild(pre);
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

    // ── Bind buttons ──────────────────────────────────────────────────────────
    if (runBtn)  runBtn.addEventListener('click', executeQuery);
    if (planBtn) planBtn.addEventListener('click', requestPlan);

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
