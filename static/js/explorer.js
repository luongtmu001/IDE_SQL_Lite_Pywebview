// Object Explorer — lazy loading, schema filters, context menu, filter modal

function initExplorer() {
    const rootUl    = document.getElementById('ide-tree-root');
    const refreshBtn = document.getElementById('ide-btn-refresh-tree');

    // ── Object Explorer Quick Search / Tree Filtering ───────────────────────
    const searchInput = document.getElementById('ide-explorer-search-input');
    const searchClearBtn = document.getElementById('ide-explorer-search-clear');
    let searchDebounceTimer = null;

    function removeHighlights(container) {
        if (!container) return;
        container.querySelectorAll('.tree-search-highlight').forEach(el => {
            const parent = el.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            }
        });
    }

    function highlightText(labelEl, query) {
        if (!labelEl || !query) return;
        removeHighlights(labelEl);
        const text = labelEl.textContent;
        const qLower = query.toLowerCase();
        const tLower = text.toLowerCase();
        const idx = tLower.indexOf(qLower);
        if (idx === -1) return;

        const before = text.substring(0, idx);
        const match = text.substring(idx, idx + query.length);
        const after = text.substring(idx + query.length);

        labelEl.innerHTML = '';
        if (before) labelEl.appendChild(document.createTextNode(before));
        const span = document.createElement('span');
        span.className = 'tree-search-highlight';
        span.textContent = match;
        labelEl.appendChild(span);
        if (after) labelEl.appendChild(document.createTextNode(after));
    }

    function applyTreeFilter(query) {
        const q = (query !== undefined && query !== null ? String(query) : (searchInput ? searchInput.value : '')).trim().toLowerCase();
        const root = document.getElementById('ide-tree-root');
        if (!root) return;

        if (searchClearBtn) {
            if (q) searchClearBtn.classList.remove('d-none');
            else searchClearBtn.classList.add('d-none');
        }

        if (!q) {
            // Restore visibility of all nodes and remove search highlights
            root.querySelectorAll('.tree-node-filtered-out').forEach(el => {
                el.classList.remove('tree-node-filtered-out');
            });
            removeHighlights(root);
            return;
        }

        // Recursive tree filtering: returns true if this li or any descendant matches query
        function filterLi(li) {
            const item = li.querySelector(':scope > .tree-item');
            const labelEl = item ? item.querySelector('.tree-label') : null;
            const labelText = (labelEl?.textContent || '').trim().toLowerCase();

            const selfMatch = labelText.includes(q);

            // Check children
            const childUl = li.querySelector(':scope > .tree-children');
            let childMatch = false;

            if (childUl) {
                const childLis = childUl.querySelectorAll(':scope > li');
                childLis.forEach(cLi => {
                    if (filterLi(cLi)) {
                        childMatch = true;
                    }
                });
            }

            const isMatched = selfMatch || childMatch;

            if (isMatched) {
                li.classList.remove('tree-node-filtered-out');
                if (labelEl && selfMatch) {
                    highlightText(labelEl, q);
                } else if (labelEl) {
                    removeHighlights(labelEl);
                }

                // If children matched, ensure parent ul is visible and toggle shows caret-down
                if (childMatch && childUl) {
                    childUl.style.display = 'block';
                    const toggle = item ? item.querySelector('.tree-toggle') : null;
                    if (toggle && toggle.classList.contains('fa-caret-right')) {
                        toggle.classList.replace('fa-caret-right', 'fa-caret-down');
                    }
                }
            } else {
                li.classList.add('tree-node-filtered-out');
                if (labelEl) removeHighlights(labelEl);
            }

            return isMatched;
        }

        const topLis = root.querySelectorAll(':scope > li');
        topLis.forEach(li => filterLi(li));
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            const val = e.target.value;
            searchDebounceTimer = setTimeout(() => {
                applyTreeFilter(val);
            }, 120);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                applyTreeFilter('');
                searchInput.blur();
            }
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            applyTreeFilter('');
        });
    }

    // ── Global context tracking ───────────────────────────────────────────────
    window.ActiveConnectionId   = null;
    window.ActiveConnectionName = null;
    window.ActiveDatabase       = null;
    window.ActiveSchema         = null;
    window.ActiveDbType         = null;

    // ── Filter state: keyed by `connId::db::objectType` ──────────────────────
    const filterState = {};
    // Schema filter: keyed by `connId::db`
    const schemaFilters = {};
    // Database filter: keyed by `connId`
    const dbFilters = {};

    // ── Connection health tracking ───────────────────────────────────────────
    // Maps connId or 'name::dbType' -> 'connected' | 'lost' | 'disconnected' | 'reconnecting'
    const connectionStatuses = {};
    window.AppConnectionStatuses = connectionStatuses;

    function getConnectionStatus(connId, name, dbType, isActive = true) {
        if (connId && connectionStatuses[connId]) return connectionStatuses[connId];
        const key = name + '::' + dbType;
        if (connectionStatuses[key]) return connectionStatuses[key];
        return isActive ? 'connected' : 'disconnected';
    }

    function setConnectionStatus(connId, name, dbType, status) {
        if (connId) connectionStatuses[connId] = status;
        if (name && dbType) connectionStatuses[name + '::' + dbType] = status;
        const key = connId || (name + '::' + dbType);
        connectionStatuses[key] = status;

        // Update tree node indicators
        const query = `.conn-status-indicator[data-conn-id="${connId}"], .conn-status-indicator[data-conn-key="${key}"], .tree-item[data-conn-id="${connId}"] .conn-status-dot`;
        document.querySelectorAll(query).forEach(el => {
            const dot = el.classList.contains('conn-status-dot') ? el : el.querySelector('.conn-status-dot');
            if (dot) {
                dot.className = `fa-solid ${status === 'reconnecting' ? 'fa-spinner fa-spin' : 'fa-circle'} conn-status-dot status-${status}`;
                dot.title = status === 'connected' ? 'Connected (Đang kết nối)' 
                          : status === 'lost' ? 'Lost Connection (Mất kết nối - Bấm Reconnect để kết nối lại)'
                          : status === 'reconnecting' ? 'Đang kết nối lại...' : 'Disconnected';
            }
        });

        // Update mini-rail collapsed items
        const railBadges = document.querySelectorAll(`.ide-collapsed-conn-item[data-conn-id="${connId}"] .ide-collapsed-conn-badge, .ide-collapsed-conn-item[data-conn-key="${key}"] .ide-collapsed-conn-badge`);
        railBadges.forEach(badge => {
            badge.className = `ide-collapsed-conn-badge conn-status-badge status-${status}`;
            const item = badge.closest('.ide-collapsed-conn-item');
            if (item) {
                const cName = item.getAttribute('data-conn-name') || name || 'Connection';
                const statusLabel = status === 'connected' ? 'Connected' : status === 'lost' ? 'Lost Connection' : status === 'reconnecting' ? 'Reconnecting' : 'Disconnected';
                item.title = `${cName} (${statusLabel})`;
            }
        });
    }

    function escapeHtml(str) {
        if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
            return window.escapeHtml(str);
        }
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ── Detect and apply context from any tree element (hierarchy-aware) ────
    function detectAndApplyTreeContext(element) {
        if (!element) return null;
        let current = element.closest('.tree-item');
        const ctx = {
            connectionId: null,
            connectionName: null,
            database: null,
            schema: null,
            dbType: null
        };

        while (current) {
            const nd = current._nodeData || {};
            if (!ctx.connectionId && nd.connId) ctx.connectionId = nd.connId;
            if (!ctx.connectionName && nd.connName) ctx.connectionName = nd.connName;
            if (!ctx.database && nd.database) ctx.database = nd.database;
            if (!ctx.schema && nd.schema) ctx.schema = nd.schema;
            if (!ctx.dbType && nd.dbType) ctx.dbType = nd.dbType;
            if (!ctx.tableName && nd.tableName) ctx.tableName = nd.tableName;
            if (!ctx.table && nd.table) ctx.table = nd.table;

            const parentUl = current.closest('ul');
            if (!parentUl || parentUl.id === 'ide-tree-root') break;
            const parentLi = parentUl.closest('li');
            if (!parentLi) break;
            current = parentLi.querySelector(':scope > .tree-item');
        }

        // If database is detected but schema not found, check configured default schema or schemaFilter first
        if (ctx.database && !ctx.schema) {
            const filterKey = `${ctx.connectionId}::${ctx.database}`;
            const sf = schemaFilters[filterKey];
            if (Array.isArray(sf) && sf.length > 0 && sf[0]) {
                ctx.schema = sf[0];
            } else {
                let savedSch = null;
                if (typeof getSavedConnections === 'function') {
                    const savedList = getSavedConnections() || [];
                    const profile = savedList.find(s => s && (s.type === ctx.dbType || !ctx.dbType) && (s.name === ctx.connectionName || s.server === ctx.connectionName || s.connection_id === ctx.connectionId || s.id === ctx.connectionId));
                    if (profile && profile.schema) {
                        savedSch = profile.schema;
                    }
                }
                ctx.schema = savedSch || (ctx.dbType === 'postgresql' ? 'public' : 'dbo');
            }
        }

        // Always track focused tree context so New Query / Profiler can consume it
        const focusedNodeData = element ? element.closest('.tree-item')?._nodeData : null;
        window.LastFocusedTreeContext = { 
            ...ctx, 
            nodeType: focusedNodeData?.type || null, 
            config: focusedNodeData?.config || null 
        };

        if (window.AppTabs && window.AppTabs.setDefaultContext) {
            window.AppTabs.setDefaultContext(ctx);
        }

        // Context Adoption Rules:
        // 1. If active tab has no connection yet, adopt this clicked connection if connected.
        // 2. If active tab already belongs to this connection, sync database / schema navigation within the same connection.
        // 3. If user clicked a DIFFERENT connection in the tree, do NOT hijack the active editor's context!
        const activeTabState = window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function' 
            ? window.AppTabs.getActiveTabState() 
            : null;
        const currentTabConnId = activeTabState?.connectionId || null;
        const currentTabConnName = activeTabState?.connectionName || null;

        const tabHasNoConnection = !currentTabConnId || !currentTabConnName || currentTabConnName === 'No connection';
        const isSameConnection = Boolean(
            (ctx.connectionId && ctx.connectionId === currentTabConnId) ||
            (ctx.connectionName && ctx.connectionName === currentTabConnName)
        );

        if ((tabHasNoConnection && ctx.connectionId) || isSameConnection) {
            if (ctx.connectionId)   window.ActiveConnectionId   = ctx.connectionId;
            if (ctx.connectionName) window.ActiveConnectionName = ctx.connectionName;
            if (ctx.database)       window.ActiveDatabase       = ctx.database;
            if (ctx.schema)         window.ActiveSchema         = ctx.schema;
            if (ctx.dbType)         window.ActiveDbType         = ctx.dbType;

            if (window.AppTabs && window.AppTabs.updateActiveTabContext) {
                window.AppTabs.updateActiveTabContext(ctx);
            }

            document.dispatchEvent(new CustomEvent('ide-context-changed', { detail: ctx }));
            if (typeof window.updateActionBar === 'function') {
                window.updateActionBar();
            }
        }
        return ctx;
    }

    // ── Delegate contextmenu on explorer (suppress browser menu) ─────────────
    document.querySelector('.ide-tree').addEventListener('contextmenu', e => {
        const item = e.target.closest('.tree-item');
        e.preventDefault();
        
        let type = 'sidebar';
        let nodeData = {};
        
        if (item) {
            document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            const ctx = detectAndApplyTreeContext(item) || {};
            nodeData = { ...item._nodeData, ...ctx };
            type = nodeData.type || 'database';
        }
        
        if (window.ContextMenu) {
            window.ContextMenu.show(type, nodeData, e.clientX, e.clientY);
        }
    });

    rootUl.addEventListener('focusin', e => {
        const item = e.target.closest('.tree-item');
        if (item) detectAndApplyTreeContext(item);
    });

    // ── Create Action Menu Button [⋮] (Priority 1) ───────────────────────────
    function createMoreBtn(nodeData) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tree-more-btn';
        btn.title = 'Actions (Thao tác)';
        btn.setAttribute('aria-label', 'Actions');
        btn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const treeItem = btn.closest('.tree-item');
            if (treeItem) {
                document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
                treeItem.classList.add('selected');
                const ctx = detectAndApplyTreeContext(treeItem) || {};
                const fullData = { ...treeItem._nodeData, ...nodeData, ...ctx };
                const rect = btn.getBoundingClientRect();
                if (window.ContextMenu) {
                    window.ContextMenu.show(fullData.type || 'database', fullData, rect.right, rect.bottom);
                }
            }
        });
        return btn;
    }

    // ── Render a tree node ────────────────────────────────────────────────────
    function renderNode(container, opts) {
        const {
            name, type, icon, iconColor,
            hasChildren, loadCallback,
            nodeData = {}, rightEl = null,
            iconImg = null, iconFallback = null, iconClass = '',
            countBadgeEl = null,
            title = null
        } = opts;

        const li   = document.createElement('li');
        const item = document.createElement('div');
        item.className = 'tree-item';
        if (title) item.title = title;
        item._nodeData = { ...nodeData, name: nodeData.name || name, type: nodeData.type || type, label: name };

        // Transfer data attrs for context menu
        if (nodeData.connId)   item.dataset.connId   = nodeData.connId;
        if (nodeData.connName) item.dataset.connName = nodeData.connName;
        if (nodeData.database) item.dataset.database = nodeData.database;
        if (nodeData.schema)   item.dataset.schema   = nodeData.schema;
        item.dataset.nodeType = type || '';

        const toggle = document.createElement('i');
        toggle.className = `fa-solid ${hasChildren ? 'fa-caret-right' : 'fa-fw'} tree-toggle`;

        let iconEl;
        if (iconImg) {
            iconEl = document.createElement('img');
            iconEl.src = iconImg;
            iconEl.className = `tree-conn-icon ${iconClass || ''}`;
            if (iconFallback) {
                iconEl.onerror = () => {
                    iconEl.onerror = null;
                    iconEl.src = iconFallback;
                };
            }
            iconEl.alt = name || '';
        } else {
            iconEl = document.createElement('i');
            iconEl.className = `fa-solid fa-${icon} tree-icon`;
            if (iconColor) iconEl.style.color = iconColor;
        }

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = name;

        item.append(toggle, iconEl, label);
        if (countBadgeEl) {
            item.appendChild(countBadgeEl);
        }

        if (rightEl) {
            rightEl.addEventListener('click', e => e.stopPropagation());
            if (!rightEl.classList.contains('tree-node-actions')) {
                rightEl.classList.add('tree-node-actions');
            }
            item.appendChild(rightEl);
        }

        li.appendChild(item);

        let childUl = null;
        let loaded  = false;

        item.addEventListener('click', async () => {
            // Selection highlight
            document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            // Automatically detect and apply context from focused tree node
            detectAndApplyTreeContext(item);

            if (!hasChildren) return;

            // Toggle expand/collapse
            if (!childUl) {
                childUl = document.createElement('ul');
                childUl.className = 'tree-children';
                li.appendChild(childUl);
            }

            if (!loaded || childUl.style.display === 'none') {
                childUl.style.display = 'block';
                toggle.classList.replace('fa-caret-right', 'fa-caret-down');

                if (!loaded && loadCallback) {
                    const isForce = !!item._forceNextRefresh;
                    item._forceNextRefresh = false;
                    childUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size: 11px;"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading…</div></li>';
                    try {
                        await loadCallback(childUl, isForce);
                        loaded = true;
                    } catch (err) {
                        childUl.innerHTML = `<li><div class="tree-item" style="color: var(--ide-danger); font-size: 11px;">Error: ${escapeHtml(err.message)}</div></li>`;
                    }
                }
            } else {
                childUl.style.display = 'none';
                toggle.classList.replace('fa-caret-down', 'fa-caret-right');
            }
        });

        container.appendChild(li);

        const reloadFn = async (force = true) => {
            loaded = false;
            item._forceNextRefresh = force;
            if (childUl) { childUl.innerHTML = ''; childUl.style.display = 'none'; }
            toggle.classList.replace('fa-caret-down', 'fa-caret-right');
            item.click();
        };
        item._reload = reloadFn;

        return {
            item,
            reload: reloadFn
        };
    }

    // ── Fetch databases ───────────────────────────────────────────────────────
    async function fetchDatabases(containerUl, connId, connName, dbType, config = null) {
        let res, data;
        try {
            res = await fetch(`/api/metadata/${connId}/databases`);
            data = await res.json();
            if (!res.ok) {
                setConnectionStatus(connId, connName, dbType, 'lost');
                const errMsg = escapeHtml(data.error || 'Mất kết nối tới máy chủ');
                containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>${errMsg} - <a href="javascript:void(0)" class="text-info ide-reconnect-inline ms-1 font-weight-bold">Kết nối lại</a></div></li>`;
                const retryBtn = containerUl.querySelector('.ide-reconnect-inline');
                if (retryBtn) {
                    retryBtn.onclick = (e) => {
                        e.stopPropagation();
                        reconnectConnection(connId, connName, dbType, config);
                    };
                }
                return;
            }
            setConnectionStatus(connId, connName, dbType, 'connected');
        } catch (fetchErr) {
            setConnectionStatus(connId, connName, dbType, 'lost');
            containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>Mất kết nối mạng: ${escapeHtml(fetchErr.message)} - <a href="javascript:void(0)" class="text-info ide-reconnect-inline ms-1 font-weight-bold">Kết nối lại</a></div></li>`;
            const retryBtn = containerUl.querySelector('.ide-reconnect-inline');
            if (retryBtn) {
                retryBtn.onclick = (e) => {
                    e.stopPropagation();
                    reconnectConnection(connId, connName, dbType, config);
                };
            }
            return;
        }
        containerUl.innerHTML = '';

        let items = data.items || [];
        const dbFilter = dbFilters[connId];
        if (dbFilter) {
            if (Array.isArray(dbFilter.selected)) {
                const selLower = dbFilter.selected.map(x => String(x).toLowerCase());
                const filtered = items.filter(db => {
                    const dName = db.name || db;
                    return dbFilter.selected.includes(dName) || selLower.includes(String(dName).toLowerCase());
                });
                if (filtered.length > 0) {
                    items = filtered;
                } else if (config && config.database && dbFilter.selected.length === 1 && selLower.includes(String(config.database).toLowerCase())) {
                    // Configured default database was not found or is inaccessible; show all available databases
                    delete dbFilters[connId];
                } else {
                    items = [];
                }
            } else if (dbFilter.search) {
                const s = dbFilter.search.toLowerCase();
                items = items.filter(db => (db.name || db).toLowerCase().includes(s));
            }
        }

        if (!items.length) {
            const msg = dbFilter ? '(No matching databases)' : '(No databases)';
            containerUl.innerHTML = `<li><div class="tree-item text-muted" style="font-size:11px;">${msg}</div></li>`;
        } else {
            // Determine default schema for this connection
            let connDefaultSchema = (config && config.schema) ? config.schema : null;
            if (!connDefaultSchema && typeof getSavedConnections === 'function') {
                const savedList = getSavedConnections() || [];
                const profile = savedList.find(s => s && (s.name === connName || s.server === connName || (config && s.id === config.id)));
                if (profile && profile.schema) {
                    connDefaultSchema = profile.schema;
                }
            }

            items.forEach(db => {
            const dbName = db.name || db;
            const filterKey = `${connId}::${dbName}`;

            // If connection has default schema configured, any newly opened database under that connection
            // automatically defaults to filtering by that default schema.
            if (connDefaultSchema && !schemaFilters[filterKey]) {
                schemaFilters[filterKey] = [connDefaultSchema];
            }

            // Database actions wrapper: [⋮] [Filter]
            const dbActions = document.createElement('div');
            dbActions.className = 'tree-node-actions';

            const dbDefaultSchema = (Array.isArray(schemaFilters[filterKey]) && schemaFilters[filterKey].length > 0)
                ? schemaFilters[filterKey][0]
                : (connDefaultSchema || null);

            const moreBtn = createMoreBtn({
                connId, connName, database: dbName, schema: dbDefaultSchema,
                type: 'database', dbType
            });

            // Schema filter checklist button
            const schemaFilterBtn = document.createElement('button');
            schemaFilterBtn.type = 'button';
            schemaFilterBtn.className = 'tree-filter-btn ide-schema-filter-btn';
            schemaFilterBtn.title = 'Filter Schemas';
            schemaFilterBtn.setAttribute('aria-label', 'Filter Schemas');
            schemaFilterBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';

            const isSchemaFiltered = Array.isArray(schemaFilters[filterKey]) && schemaFilters[filterKey].length > 0;
            if (isSchemaFiltered) {
                schemaFilterBtn.classList.add('filter-active');
                schemaFilterBtn.title = `Filter Schemas (${schemaFilters[filterKey].length} selected)`;
                dbActions.classList.add('has-active-filter');
            }

            dbActions.append(moreBtn, schemaFilterBtn);

            let dbNodeCtrl = null;

            schemaFilterBtn.addEventListener('click', e => {
                e.stopPropagation();
                showSchemaChecklistModal({
                    connId,
                    dbName,
                    filterKey,
                    onApply: () => {
                        const filteredNow = Array.isArray(schemaFilters[filterKey]) && schemaFilters[filterKey].length > 0;
                        if (filteredNow) {
                            schemaFilterBtn.classList.add('filter-active');
                            dbActions.classList.add('has-active-filter');
                        } else {
                            schemaFilterBtn.classList.remove('filter-active');
                            dbActions.classList.remove('has-active-filter');
                        }
                        if (dbNodeCtrl) dbNodeCtrl.reload();
                    }
                });
            });

            dbNodeCtrl = renderNode(containerUl, {
                name: dbName, type: 'database', icon: 'database', iconColor: 'var(--ide-accent)',
                hasChildren: true,
                loadCallback: ul => fetchSchemas(ul, connId, connName, dbName, dbType, connDefaultSchema),
                nodeData: { connId, connName, database: dbName, schema: dbDefaultSchema, dbType },
                rightEl: dbActions
            });
        });
    }

        // ── Render Linked Servers group at the same level as databases (SQL Server) ──
        const isSqlServer = !dbType || ['sqlserver', 'mssql', 'tsql'].includes(String(dbType).toLowerCase());
        if (isSqlServer) {
            const lsActions = document.createElement('div');
            lsActions.className = 'tree-node-actions';
            lsActions.appendChild(createMoreBtn({
                connId, connName, dbType, type: 'linked_servers_group'
            }));

            renderNode(containerUl, {
                name: 'Linked Servers',
                type: 'linked_servers_group',
                icon: 'server',
                iconColor: 'var(--ide-info, #17a2b8)',
                hasChildren: true,
                loadCallback: ul => fetchLinkedServers(ul, connId, connName, dbType),
                nodeData: { connId, connName, dbType, type: 'linked_servers_group' },
                rightEl: lsActions
            });
        }
    }

    // ── Fetch Linked Servers ──────────────────────────────────────────────────
    async function fetchLinkedServers(containerUl, connId, connName, dbType) {
        containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;"><i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải Linked Servers...</div></li>';
        try {
            const res = await fetch(`/api/metadata/${connId}/linked_servers`);
            const data = await res.json();
            containerUl.innerHTML = '';
            if (!data || !data.success) {
                const errMsg = (data && data.error) ? data.error : 'Không thể tải Linked Servers';
                containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>${escapeHtml(errMsg)}</div></li>`;
                return;
            }
            const items = Array.isArray(data.items) ? data.items : [];
            if (!items.length) {
                containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(No linked servers)</div></li>';
                return;
            }

            items.forEach(ls => {
                const lsName = ls.name || ls.LinkedServerName || 'Unknown Server';
                const lsProduct = ls.product || ls.Product || 'SQL Server';
                const lsProvider = ls.provider || ls.Provider || '';
                const lsDataSource = ls.data_source || ls.DataSource_IP_Or_Instance || '';
                const lsTitle = `${lsName} (${lsProduct}${lsDataSource ? ' - ' + lsDataSource : ''})`;

                const lsActions = document.createElement('div');
                lsActions.className = 'tree-node-actions';
                lsActions.appendChild(createMoreBtn({
                    connId,
                    connName,
                    dbType,
                    server: lsName,
                    name: lsName,
                    product: lsProduct,
                    provider: lsProvider,
                    data_source: lsDataSource,
                    type: 'linked_server'
                }));

                renderNode(containerUl, {
                    name: lsName,
                    type: 'linked_server',
                    icon: 'link',
                    iconColor: 'var(--ide-accent, #61afef)',
                    title: lsTitle,
                    hasChildren: true,
                    loadCallback: ul => fetchRemoteDatabases(ul, connId, connName, lsName, dbType),
                    nodeData: {
                        connId,
                        connName,
                        dbType,
                        server: lsName,
                        name: lsName,
                        product: lsProduct,
                        provider: lsProvider,
                        data_source: lsDataSource,
                        type: 'linked_server'
                    },
                    rightEl: lsActions
                });
            });
        } catch (err) {
            console.error('[Explorer] fetchLinkedServers error:', err);
            containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>Lỗi tải Linked Servers: ${escapeHtml(err.message)}</div></li>`;
        }
    }

    // ── Fetch Remote Databases under Linked Server ────────────────────────────
    async function fetchRemoteDatabases(containerUl, connId, connName, serverName, dbType) {
        containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;"><i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải Catalogs...</div></li>';
        try {
            const res = await fetch(`/api/metadata/${connId}/linked_server/databases?server=${encodeURIComponent(serverName)}`);
            const data = await res.json();
            containerUl.innerHTML = '';
            const items = (data && data.success && Array.isArray(data.items)) ? data.items : [];
            if (!items.length) {
                containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(No catalogs or offline)</div></li>';
                return;
            }

            items.forEach(db => {
                const dbName = db.name || db;
                const dbActions = document.createElement('div');
                dbActions.className = 'tree-node-actions';
                dbActions.appendChild(createMoreBtn({
                    connId, connName, dbType, server: serverName, database: dbName, type: 'remote_database'
                }));

                renderNode(containerUl, {
                    name: dbName,
                    type: 'remote_database',
                    icon: 'database',
                    iconColor: 'var(--ide-info, #17a2b8)',
                    hasChildren: true,
                    loadCallback: ul => fetchRemoteObjects(ul, connId, connName, serverName, dbName, dbType),
                    nodeData: { connId, connName, dbType, server: serverName, database: dbName, type: 'remote_database' },
                    rightEl: dbActions
                });
            });
        } catch (err) {
            containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>${escapeHtml(err.message)}</div></li>`;
        }
    }

    // ── Fetch Remote Objects under Remote Database ────────────────────────────
    async function fetchRemoteObjects(containerUl, connId, connName, serverName, dbName, dbType) {
        containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;"><i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải bảng từ xa...</div></li>';
        try {
            const res = await fetch(`/api/metadata/${connId}/linked_server/objects?server=${encodeURIComponent(serverName)}&database=${encodeURIComponent(dbName)}`);
            const data = await res.json();
            containerUl.innerHTML = '';
            const items = (data && data.success && Array.isArray(data.items)) ? data.items : [];
            if (!items.length) {
                containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(No tables)</div></li>';
                return;
            }

            items.forEach(obj => {
                const objName = obj.name || 'table';
                const objSchema = obj.schema || 'dbo';
                const isView = obj.type === 'remote_view' || obj.type === 'view';
                renderNode(containerUl, {
                    name: `${objSchema}.${objName}`,
                    type: isView ? 'remote_view' : 'remote_table',
                    icon: isView ? 'table-columns' : 'table',
                    iconColor: isView ? 'var(--ide-info)' : 'var(--ide-primary)',
                    hasChildren: false,
                    nodeData: {
                        connId, connName, dbType,
                        server: serverName, database: dbName, schema: objSchema, name: objName,
                        type: isView ? 'remote_view' : 'remote_table'
                    }
                });
            });
        } catch (err) {
            containerUl.innerHTML = `<li><div class="tree-item text-danger" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>${escapeHtml(err.message)}</div></li>`;
        }
    }

    // ── Fetch schemas ─────────────────────────────────────────────────────────
    async function fetchSchemas(containerUl, connId, connName, dbName, dbType, connDefaultSchema = null) {
        const res  = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
        const data = await res.json();
        containerUl.innerHTML = '';

        let schemas = data.items || [];
        const activeFilter = schemaFilters[`${connId}::${dbName}`];
        if (Array.isArray(activeFilter)) {
            const activeFilterLower = activeFilter.map(x => String(x).toLowerCase());
            const matched = schemas.filter(s => {
                const sName = String(s.name || s);
                return activeFilter.includes(sName) || activeFilterLower.includes(sName.toLowerCase());
            });
            if (matched.length > 0) {
                schemas = matched;
            } else if (connDefaultSchema && activeFilter.length === 1 && activeFilterLower.includes(connDefaultSchema.toLowerCase())) {
                // If the inherited default schema is not present in this database, fall back to showing all schemas
                delete schemaFilters[`${connId}::${dbName}`];
            } else {
                schemas = matched;
            }
        }

        if (!schemas.length) {
            const msg = Array.isArray(activeFilter) ? '(No matching schemas)' : '(No schemas)';
            containerUl.innerHTML = `<li><div class="tree-item text-muted" style="font-size:11px;">${msg}</div></li>`;
            return;
        }

        schemas.forEach(s => {
            const schemaName = s.name || s;
            const schemaActions = document.createElement('div');
            schemaActions.className = 'tree-node-actions';
            schemaActions.appendChild(createMoreBtn({
                connId, connName, database: dbName, schema: schemaName, type: 'schema', dbType
            }));

            renderNode(containerUl, {
                name: schemaName, type: 'schema', icon: 'folder', iconColor: '#E8C859',
                hasChildren: true,
                loadCallback: ul => fetchCategories(ul, connId, connName, dbName, schemaName, dbType),
                nodeData: { connId, connName, database: dbName, schema: schemaName, dbType },
                rightEl: schemaActions,
            });
        });
    }

    // ── Fetch categories (Tables, Views, etc.) ────────────────────────────────
    async function fetchCategories(containerUl, connId, connName, dbName, schemaName, dbType) {
        containerUl.innerHTML = '';

        const isPg = (dbType || window.ActiveDbType || '').toLowerCase().includes('postgr');
        const isSqlServer = !isPg && ((dbType || window.ActiveDbType || '').toLowerCase().includes('sqlserver') || (dbType || window.ActiveDbType || '').toLowerCase().includes('ssms') || (dbType || window.ActiveDbType || '').toLowerCase() === 'mssql');
        const defaultSchema = isPg ? 'public' : 'dbo';
        const safeSchema = schemaName || defaultSchema;

        const categories = [
            { label: 'Tables',             type: 'tables',             icon: 'table',           color: '#6897BB' },
            { label: 'Views',              type: 'views',              icon: 'eye',             color: '#6897BB' },
            ...(isPg ? [{ label: 'Materialized Views', type: 'materialized_views', icon: 'layer-group', color: '#6897BB' }] : []),
            { label: 'Procedures',         type: 'procedures',         icon: 'code',            color: '#CC7832' },
            { label: 'Functions',          type: 'functions',          icon: 'calculator',      color: '#CC7832' },
            { label: 'Triggers',           type: 'triggers',           icon: 'bolt',            color: '#CC7832' },
            { label: 'Sequences',          type: 'sequences',          icon: 'arrow-down-1-9',  color: '#8892b0' },
            ...(isSqlServer ? [{ label: 'Synonyms', type: 'synonyms', icon: 'link', color: '#6897BB' }] : []),
            { label: 'User Defined Types', type: 'user_types',         icon: 'cube',            color: '#98c379' },
        ];

        const countBadges = {};

        categories.forEach(cat => {
            const fk = `${connId}::${dbName}::${safeSchema}::${cat.type}`;
            const fkLegacy = `${connId}::${dbName}::${cat.type}`;

            // Category actions wrapper: [⋮] [Filter]
            const catActions = document.createElement('div');
            catActions.className = 'tree-node-actions';

            const moreBtn = createMoreBtn({
                connId, connName, database: dbName, schema: safeSchema,
                type: `group-${cat.type}`, dbType
            });

            // Filter button
            const filterBtn = document.createElement('button');
            filterBtn.type = 'button';
            filterBtn.className = 'tree-filter-btn';
            filterBtn.title = `Filter ${cat.label}`;
            filterBtn.setAttribute('aria-label', `Filter ${cat.label}`);
            filterBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';

            const countBadge = document.createElement('span');
            countBadge.className = 'tree-count-badge';
            countBadges[cat.type] = countBadge;

            const updateFilterActiveUi = () => {
                if (hasActiveFilter(fk) || hasActiveFilter(fkLegacy)) {
                    filterBtn.classList.add('filter-active');
                    filterBtn.title = `Filter ${cat.label} (Filtered)`;
                    catActions.classList.add('has-active-filter');
                } else {
                    filterBtn.classList.remove('filter-active');
                    filterBtn.title = `Filter ${cat.label}`;
                    catActions.classList.remove('has-active-filter');
                }
            };
            updateFilterActiveUi();

            filterBtn.addEventListener('click', e => {
                e.stopPropagation();
                showFilterModal({
                    title: `Filter ${cat.label}`,
                    filterKey: fk,
                    connId, dbName, schemaName: safeSchema,
                    objectType: cat.type,
                    onApply: () => {
                        updateFilterActiveUi();
                        // Update count badge immediately from cache if available
                        const isFilterActive = hasActiveFilter(fk) || hasActiveFilter(fkLegacy);
                        const filter = filterState[fk] || filterState[fkLegacy];
                        const cacheKey = `${connId}::${dbName}::${safeSchema}::${cat.type}`;
                        const items = categoryDataCache[cacheKey] || [];
                        const totalCount = items.length;
                        const filteredItems = isFilterActive 
                            ? items.filter(obj => matchFilterItem(obj, safeSchema, filter))
                            : items;
                        if (countBadge) {
                            if (isFilterActive) {
                                countBadge.textContent = `${filteredItems.length}/${totalCount}`;
                                countBadge.className = 'tree-count-badge is-filtered';
                                countBadge.title = `Filtered: ${filteredItems.length} of ${totalCount} objects`;
                            } else {
                                countBadge.textContent = `${totalCount}`;
                                countBadge.className = 'tree-count-badge';
                                countBadge.title = `Total: ${totalCount} objects`;
                            }
                        }
                        catNodeCtrl.reload();
                    }
                });
            });

            catActions.append(moreBtn, filterBtn);

            let catNodeCtrl;
            catNodeCtrl = renderNode(containerUl, {
                name: cat.label, type: `group-${cat.type}`, icon: cat.icon, iconColor: cat.color,
                hasChildren: true,
                loadCallback: (ul, force) => fetchObjects(ul, connId, connName, dbName, safeSchema, cat.type, dbType, countBadge, force),
                nodeData: { connId, connName, database: dbName, schema: safeSchema, dbType, catType: cat.type, objectType: cat.type },
                rightEl: catActions,
                countBadgeEl: countBadge
            });

            catNodeCtrl.item._updateBadge = async (force = false) => {
                try {
                    const items = force
                        ? await loadCategoryObjects(connId, dbName, safeSchema, cat.type, dbType, true)
                        : await loadCategoryObjects(connId, dbName, safeSchema, cat.type, dbType);
                    const fk = `${connId}::${dbName}::${safeSchema}::${cat.type}`;
                    const fkLegacy = `${connId}::${dbName}::${cat.type}`;
                    const filter = filterState[fk] || filterState[fkLegacy];
                    const isFilterActive = hasActiveFilter(fk) || hasActiveFilter(fkLegacy);
                    const totalCount = items.length;
                    const filteredItems = isFilterActive 
                        ? items.filter(obj => matchFilterItem(obj, safeSchema, filter))
                        : items;
                    if (countBadge) {
                        if (isFilterActive) {
                            countBadge.textContent = `${filteredItems.length}/${totalCount}`;
                            countBadge.className = 'tree-count-badge is-filtered';
                            countBadge.title = `Filtered: ${filteredItems.length} of ${totalCount} objects`;
                        } else {
                            countBadge.textContent = `${totalCount}`;
                            countBadge.className = 'tree-count-badge';
                            countBadge.title = `Total: ${totalCount} objects`;
                        }
                    }
                } catch (err) {
                    console.warn(`[Explorer] Error calculating count for ${cat.label}:`, err);
                }
            };
        });

        // 1. Calculate object counts for each category immediately upon schema expansion
        categories.forEach(cat => {
            const catItem = containerUl.querySelector(`.tree-item[data-node-type="group-${cat.type}"]`);
            if (catItem && typeof catItem._updateBadge === 'function') {
                catItem._updateBadge(false);
            }
        });
    }

    // Cache for raw category object lists: cacheKey -> array of objects
    const categoryDataCache = {};
    const categoryPromiseCache = {};

    async function loadCategoryObjects(connId, dbName, schemaName, catType, dbType = null, forceRefresh = false) {
        const isPg = ((dbType || window.ActiveDbType || '').toLowerCase().includes('postgr'));
        const safeSchema = schemaName || (isPg ? 'public' : 'dbo');
        const cacheKey = `${connId}::${dbName}::${safeSchema}::${catType}`;
        if (forceRefresh) {
            delete categoryDataCache[cacheKey];
            delete categoryPromiseCache[cacheKey];
            if (window.AppMetadataCache && typeof window.AppMetadataCache.invalidateSchema === 'function') {
                window.AppMetadataCache.invalidateSchema(connId, dbName, safeSchema);
            }
        } else {
            if (categoryDataCache[cacheKey]) {
                return categoryDataCache[cacheKey];
            }
            if (categoryPromiseCache[cacheKey]) {
                return categoryPromiseCache[cacheKey];
            }
        }

        const fetchPromise = (async () => {
            try {
                const params = new URLSearchParams({ database: dbName, schema: safeSchema, type: catType });
                if (forceRefresh) {
                    params.set('refresh', 'true');
                    params.set('_t', String(Date.now()));
                }
                const res = await fetch(`/api/metadata/${connId}/objects?${params}`);
                const data = await res.json();
                const items = data.items || [];
                categoryDataCache[cacheKey] = items;
                return items;
            } catch (err) {
                console.warn(`[Explorer] Failed to load objects for ${catType}:`, err);
                return [];
            } finally {
                delete categoryPromiseCache[cacheKey];
            }
        })();

        categoryPromiseCache[cacheKey] = fetchPromise;
        return fetchPromise;
    }

    function hasActiveFilter(fk) {
        const f = filterState[fk];
        if (!f) return false;
        if (f.search && f.search.trim()) return true;
        if (Array.isArray(f.conditions) && f.conditions.some(c => c && (c.value || '').trim())) return true;
        return false;
    }

    function matchFilterItem(obj, defaultSchema, filter) {
        if (!filter) return true;

        let conditions = [];
        if (Array.isArray(filter.conditions) && filter.conditions.length > 0) {
            conditions = filter.conditions.filter(c => c && (c.value || '').trim());
        } else if (filter.search && filter.search.trim()) {
            conditions = [{ field: 'name', operator: 'contains', value: filter.search.trim() }];
        }

        if (conditions.length === 0) return true;

        const objName = String(obj.name || obj || '').toLowerCase();
        const objSchema = String(obj.schema || defaultSchema || 'dbo').toLowerCase();

        const checkCond = (c) => {
            const target = c.field === 'schema' ? objSchema : objName;
            const val = String(c.value || '').trim().toLowerCase();
            if (!val) return true;

            switch (c.operator) {
                case 'contains':
                    return target.includes(val);
                case 'startswith':
                    return target.startsWith(val);
                case 'endswith':
                    return target.endsWith(val);
                case 'equals':
                    return target === val;
                case 'notequals':
                    return target !== val;
                default:
                    return target.includes(val);
            }
        };

        if (filter.logic === 'OR') {
            return conditions.some(checkCond);
        } else {
            return conditions.every(checkCond);
        }
    }

    // ── Fetch objects ─────────────────────────────────────────────────────────
    async function fetchObjects(containerUl, connId, connName, dbName, schema, objType, dbType, countBadgeEl = null, forceRefresh = false) {
        const effectiveDbType = dbType || window.ActiveDbType;
        const isPg = (effectiveDbType || '').toLowerCase().includes('postgr');
        const safeSchema = schema || (isPg ? 'public' : 'dbo');
        const fk = `${connId}::${dbName}::${safeSchema}::${objType}`;
        const fkLegacy = `${connId}::${dbName}::${objType}`;
        const filter = filterState[fk] || filterState[fkLegacy];

        const allItems = await loadCategoryObjects(connId, dbName, safeSchema, objType, effectiveDbType, forceRefresh);
        const totalCount = allItems.length;
        const isFilterActive = hasActiveFilter(fk) || hasActiveFilter(fkLegacy);
        const filteredItems = isFilterActive 
            ? allItems.filter(obj => matchFilterItem(obj, safeSchema, filter))
            : allItems;

        // Section 52: Hiển thị số lượng Object và trạng thái lọc
        if (countBadgeEl) {
            if (isFilterActive) {
                countBadgeEl.textContent = `${filteredItems.length}/${totalCount}`;
                countBadgeEl.className = 'tree-count-badge is-filtered';
                countBadgeEl.title = `Filtered: ${filteredItems.length} of ${totalCount} objects`;
            } else {
                countBadgeEl.textContent = `${totalCount}`;
                countBadgeEl.className = 'tree-count-badge';
                countBadgeEl.title = `Total: ${totalCount} objects`;
            }
        }

        containerUl.innerHTML = '';

        if (!filteredItems.length) {
            containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(Empty)</div></li>';
            return;
        }

        const iconMap = { 
            tables: 'table', 
            views: 'eye', 
            materialized_views: 'layer-group', 
            procedures: 'code', 
            functions: 'calculator', 
            triggers: 'bolt',
            sequences: 'arrow-down-1-9',
            synonyms: 'link',
            user_types: 'cube'
        };
        const typeMap = { 
            tables: 'table', 
            views: 'view', 
            materialized_views: 'materialized_view', 
            procedures: 'procedure', 
            functions: 'function', 
            triggers: 'trigger',
            sequences: 'sequence',
            synonyms: 'synonym',
            user_types: 'user_type'
        };

        const fragment = document.createDocumentFragment();
        filteredItems.forEach(obj => {
            const objName = obj.name || obj;
            const objSchema = obj.schema || schema || 'dbo';
            const mappedType = typeMap[objType] || objType;
            const isLeaf = objType === 'sequences' || objType === 'user_types' || objType === 'synonyms';
            const baseName = obj.base_name || (typeof objName === 'string' && objName.includes('(') ? objName.slice(0, objName.indexOf('(')).trim() : objName);
            const identityArgs = obj.identity_args !== undefined ? obj.identity_args : (typeof objName === 'string' && objName.includes('(') ? objName.slice(objName.indexOf('(') + 1, -1).trim() : '');
            
            const nData = { 
                connId, 
                connName, 
                database: dbName, 
                schema: objSchema, 
                name: objName, 
                baseName,
                base_object_name: obj.base_object_name || null,
                identityArgs,
                oid: obj.oid || null,
                type: mappedType, 
                object_type: mappedType.toUpperCase(),
                isColumn: false,
                dbType: effectiveDbType 
            };

            const objActions = document.createElement('div');
            objActions.className = 'tree-node-actions';
            objActions.appendChild(createMoreBtn(nData));

            renderNode(fragment, {
                name: objName, 
                type: mappedType, 
                icon: iconMap[objType] || 'file-code', 
                iconColor: objType === 'sequences' ? '#8892b0' : (objType === 'user_types' ? '#98c379' : (objType === 'synonyms' ? '#6897BB' : '#c7cfcf')),
                hasChildren: !isLeaf,
                loadCallback: isLeaf ? null : (ul => fetchObjectFolders(ul, connId, connName, dbName, objSchema, mappedType, objName, effectiveDbType)),
                nodeData: nData,
                rightEl: objActions,
                title: (mappedType === 'synonym' && obj.base_object_name) ? `${objName} -> ${obj.base_object_name}` : objName
            });
        });
        containerUl.appendChild(fragment);
        if (searchInput && searchInput.value && searchInput.value.trim()) {
            applyTreeFilter(searchInput.value.trim());
        }
    }

    // ── Fetch object folders (Columns, Keys, etc.) ────────────────────────────
    async function fetchObjectFolders(containerUl, connId, connName, dbName, schema, objType, objName, dbType) {
        const effectiveDbType = dbType || window.ActiveDbType;
        containerUl.innerHTML = '';
        let folders = [];
        if (objType === 'table') {
            folders = [
                { label: 'Columns', type: 'columns' },
                { label: 'Keys', type: 'keys' },
                { label: 'Constraints', type: 'constraints' },
                { label: 'Triggers', type: 'triggers' },
                { label: 'Indexes', type: 'indexes' }
            ];
        } else if (objType === 'view' || objType === 'materialized_view') {
            folders = [
                { label: 'Columns', type: 'columns' },
                { label: 'Triggers', type: 'triggers' },
                { label: 'Indexes', type: 'indexes' }
            ];
        } else if (objType === 'procedure' || objType === 'function') {
            folders = [
                { label: 'Parameters', type: 'params' }
            ];
        } else {
            containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(No details)</div></li>';
            return;
        }

        folders.forEach(f => {
            renderNode(containerUl, {
                name: f.label, type: `folder-${f.type}`, icon: 'folder', iconColor: '#dcb67a',
                hasChildren: true,
                loadCallback: ul => fetchObjectChildren(ul, connId, connName, dbName, schema, objName, objType, f.type, effectiveDbType),
                nodeData: { connId, connName, database: dbName, schema, tableName: objName, table: objName, dbType: effectiveDbType }
            });
        });
    }

    // ── Fetch object children (Actual columns, keys, etc.) ────────────────────
    async function fetchObjectChildren(containerUl, connId, connName, dbName, schema, objName, objType, childType, dbType) {
        const effectiveDbType = dbType || window.ActiveDbType;
        const safeSchema = schema || (effectiveDbType === 'postgresql' ? 'public' : 'dbo');
        const params = new URLSearchParams({ database: dbName, schema: safeSchema, name: objName, type: objType, child_type: childType });
        const res = await fetch(`/api/metadata/${connId}/object_children?${params}`);
        const data = await res.json();
        containerUl.innerHTML = '';
        
        if (!res.ok || !data.success) {
            containerUl.innerHTML = `<li><div class="tree-item" style="color:var(--ide-danger);font-size:11px;">Error: ${escapeHtml(data.error || 'Unknown error')}</div></li>`;
            return;
        }

        if (!data.items?.length) {
            containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(Empty)</div></li>';
            return;
        }

        const fragment = document.createDocumentFragment();
        data.items.forEach(child => {
            if (childType === 'triggers') {
                const trgData = {
                    connId,
                    connName,
                    database: dbName,
                    schema: safeSchema,
                    name: child.name,
                    tableName: objName,
                    type: 'trigger',
                    dbType: effectiveDbType
                };
                const trgActionWrap = document.createElement('div');
                trgActionWrap.className = 'tree-node-actions';
                trgActionWrap.appendChild(createMoreBtn(trgData));

                renderNode(fragment, {
                    name: child.name,
                    type: 'trigger',
                    icon: 'bolt',
                    iconColor: '#CC7832',
                    hasChildren: false,
                    nodeData: trgData,
                    rightEl: trgActionWrap,
                });
                return;
            }

            let label = child.name;
            let icon = 'cube';
            let color = 'var(--ide-text-dim)';
            
            if (childType === 'columns') {
                let lengthStr = child.length === null ? '' : (child.length > 0 ? child.length : 'max');
                label = `${child.name} (${child.type}${lengthStr ? ',' + lengthStr : ''}, ${child.nullable ? 'null' : 'not null'})`;
                icon = 'columns';
                color = 'var(--ide-info)';
            } else if (childType === 'keys') {
                label = `${child.name} (${child.type})`;
                icon = 'key';
                color = 'var(--ide-warning)';
            } else if (childType === 'constraints') {
                label = `${child.name} (${child.type})`;
                icon = 'link';
                color = 'var(--ide-text-dim)';
            } else if (childType === 'indexes') {
                icon = 'list-ol';
                color = 'var(--ide-text-dim)';
            } else if (childType === 'params') {
                label = `${child.name} (${child.type})`;
                icon = 'at';
                color = 'var(--ide-text-dim)';
            }

            renderNode(fragment, {
                name: label, type: `leaf-${childType}`, icon: icon, iconColor: color,
                hasChildren: false,
                nodeData: { 
                    connId, 
                    connName, 
                    database: dbName, 
                    schema: safeSchema, 
                    name: child.name, 
                    columnName: childType === 'columns' ? child.name : undefined,
                    column: childType === 'columns' ? child.name : undefined,
                    tableName: objName, 
                    table: objName, 
                    type: childType === 'columns' ? 'column' : childType, 
                    object_type: childType === 'columns' ? 'COLUMN' : childType.toUpperCase(),
                    isColumn: childType === 'columns',
                    dbType: effectiveDbType 
                }
            });
        });
        containerUl.appendChild(fragment);
    }

    // ── Filter modal (Multiple conditions: AND/OR, Contains, Starts with, Ends with, Equals, Not equals) ─
    function showFilterModal({ title, filterKey, onApply }) {
        const current = filterState[filterKey] || {};

        // Remove old if any
        document.getElementById('ide-filter-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'ide-filter-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 480px;">
                <div class="modal-content">
                    <div class="modal-header py-2 d-flex align-items-center justify-content-between">
                        <h6 class="modal-title d-flex align-items-center gap-2 mb-0" style="font-size:13px; font-weight: 600;">
                            <i class="fa-solid fa-filter text-primary"></i>
                            <span>${title}</span>
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-2">
                        <div class="d-flex align-items-center mb-1 text-muted px-1" style="font-size: 11px; font-weight: 500;">
                            <div style="width: 28%;">Field</div>
                            <div style="width: 32%; padding-left: 6px;">Operator</div>
                            <div style="width: 34%; padding-left: 6px;">Value</div>
                            <div style="width: 6%;"></div>
                        </div>
                        <div id="ide-filter-conditions-list" class="d-flex flex-column gap-1 mb-2"></div>
                        <div class="d-flex align-items-center justify-content-between pt-2 border-top border-secondary-subtle">
                            <button type="button" class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" id="ide-filter-add-btn" style="font-size: 12px;">
                                <i class="fa-solid fa-plus"></i> Add condition
                            </button>
                            <div class="d-flex align-items-center gap-2">
                                <label for="ide-filter-logic" class="mb-0 text-muted" style="font-size: 12px;">Logic:</label>
                                <select id="ide-filter-logic" class="form-select form-select-sm" style="width: 80px; font-size: 12px;">
                                    <option value="AND"${current.logic !== 'OR' ? ' selected' : ''}>AND</option>
                                    <option value="OR"${current.logic === 'OR' ? ' selected' : ''}>OR</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer py-2 d-flex justify-content-between">
                        <button type="button" class="btn btn-sm btn-link text-danger text-decoration-none px-0" id="ide-filter-reset">
                            <i class="fa-solid fa-trash-can me-1"></i>Clear
                        </button>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-sm btn-primary" id="ide-filter-apply">Apply</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        function createConditionRow(cond = { field: 'name', operator: 'contains', value: '' }) {
            const row = document.createElement('div');
            row.className = 'filter-condition-row d-flex align-items-center gap-1';
            row.innerHTML = `
                <select class="form-select form-select-sm cond-field" style="width: 28%; font-size: 12px;">
                    <option value="name"${cond.field === 'name' ? ' selected' : ''}>Name</option>
                    <option value="schema"${cond.field === 'schema' ? ' selected' : ''}>Schema</option>
                </select>
                <select class="form-select form-select-sm cond-operator" style="width: 32%; font-size: 12px;">
                    <option value="contains"${cond.operator === 'contains' ? ' selected' : ''}>Contains</option>
                    <option value="startswith"${cond.operator === 'startswith' ? ' selected' : ''}>Starts with</option>
                    <option value="endswith"${cond.operator === 'endswith' ? ' selected' : ''}>Ends with</option>
                    <option value="equals"${cond.operator === 'equals' ? ' selected' : ''}>Equals</option>
                    <option value="notequals"${cond.operator === 'notequals' ? ' selected' : ''}>Not equals</option>
                </select>
                <input type="text" class="form-control form-control-sm cond-value" style="width: 34%; font-size: 12px;" placeholder="e.g. customer" value="${escapeHtml(cond.value || '')}">
                <button type="button" class="btn btn-sm btn-link text-danger cond-remove px-1" title="Remove condition" style="width: 6%; text-decoration: none;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;

            row.querySelector('.cond-remove').addEventListener('click', () => {
                const list = modal.querySelector('#ide-filter-conditions-list');
                if (list.children.length > 1) {
                    row.remove();
                } else {
                    row.querySelector('.cond-value').value = '';
                }
            });

            row.querySelector('.cond-value').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    modal.querySelector('#ide-filter-apply').click();
                }
            });

            return row;
        }

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        const list = modal.querySelector('#ide-filter-conditions-list');
        const initialConditions = Array.isArray(current.conditions) && current.conditions.length > 0
            ? current.conditions
            : (current.search ? [{ field: 'name', operator: 'contains', value: current.search }] : [{ field: 'name', operator: 'contains', value: '' }]);

        initialConditions.forEach(c => list.appendChild(createConditionRow(c)));

        modal.querySelector('#ide-filter-add-btn').addEventListener('click', () => {
            const newRow = createConditionRow({ field: 'name', operator: 'contains', value: '' });
            list.appendChild(newRow);
            setTimeout(() => newRow.querySelector('.cond-value').focus(), 50);
        });

        modal.querySelector('#ide-filter-apply').addEventListener('click', () => {
            const rows = modal.querySelectorAll('.filter-condition-row');
            const conditions = [];
            rows.forEach(r => {
                const field = r.querySelector('.cond-field').value;
                const operator = r.querySelector('.cond-operator').value;
                const value = r.querySelector('.cond-value').value.trim();
                if (value) {
                    conditions.push({ field, operator, value });
                }
            });

            const logic = modal.querySelector('#ide-filter-logic')?.value || 'AND';
            if (conditions.length > 0) {
                filterState[filterKey] = { conditions, logic };
            } else {
                delete filterState[filterKey];
            }

            bsModal.hide();
            if (onApply) onApply();
        });

        modal.querySelector('#ide-filter-reset').addEventListener('click', () => {
            delete filterState[filterKey];
            bsModal.hide();
            if (onApply) onApply();
        });

        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
        setTimeout(() => modal.querySelector('.cond-value')?.focus(), 300);
    }

    // ── Schema Checklist Modal ────────────────────────────────────────────────
    async function showSchemaChecklistModal({ connId, dbName, filterKey, onApply }) {
        document.getElementById('ide-schema-checklist-modal')?.remove();

        let allSchemas = [];
        try {
            const res = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
            const data = await res.json();
            allSchemas = (data.items || []).map(s => s.name || s);
        } catch (err) {
            console.error('Failed to load schemas', err);
            return;
        }

        if (!allSchemas.length) {
            if (typeof showToast === 'function') showToast(`No schemas found in database ${dbName}`, 'info');
            return;
        }

        const currentSelected = schemaFilters[filterKey];
        const selectedSet = new Set(
            Array.isArray(currentSelected) ? currentSelected : allSchemas
        );

        const modal = document.createElement('div');
        modal.id = 'ide-schema-checklist-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title d-flex align-items-center gap-2" style="font-size:13px;">
                            <i class="fa-solid fa-filter text-info"></i>
                            <span>Filter Schemas <small class="text-muted fw-normal">(${escapeHtml(dbName)})</small></span>
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body py-2">
                        <div class="mb-2">
                            <input type="text" id="ide-schema-search-input" class="form-control form-control-sm" placeholder="Search schemas...">
                        </div>
                        <div class="checklist-actions">
                            <div>
                                <a id="ide-schema-select-all" class="me-2">Select All</a>
                                <a id="ide-schema-deselect-all">Deselect All</a>
                            </div>
                            <span id="ide-schema-stats" class="text-muted">${selectedSet.size}/${allSchemas.length} selected</span>
                        </div>
                        <div class="checklist-container" id="ide-schema-checklist-list">
                            <!-- Injected checkboxes -->
                        </div>
                    </div>
                    <div class="modal-footer py-1 d-flex justify-content-between">
                        <button class="btn btn-sm btn-link text-danger px-0" id="ide-schema-btn-reset">Reset</button>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button class="btn btn-sm btn-primary" id="ide-schema-btn-apply">Apply</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        const listContainer = modal.querySelector('#ide-schema-checklist-list');
        const statsEl = modal.querySelector('#ide-schema-stats');
        const searchInput = modal.querySelector('#ide-schema-search-input');

        function renderList(query = '') {
            const q = query.trim().toLowerCase();
            listContainer.innerHTML = '';
            let visibleCount = 0;

            allSchemas.forEach(sName => {
                if (q && !sName.toLowerCase().includes(q)) return;
                visibleCount++;

                const item = document.createElement('label');
                item.className = 'checklist-item';
                const isChecked = selectedSet.has(sName);

                item.innerHTML = `
                    <input type="checkbox" class="form-check-input" value="${escapeHtml(sName)}" ${isChecked ? 'checked' : ''}>
                    <span class="text-truncate">${escapeHtml(sName)}</span>
                `;

                item.querySelector('input').addEventListener('change', e => {
                    if (e.target.checked) {
                        selectedSet.add(sName);
                    } else {
                        selectedSet.delete(sName);
                    }
                    updateStats();
                });

                listContainer.appendChild(item);
            });

            if (visibleCount === 0) {
                listContainer.innerHTML = '<div class="px-2 py-3 text-center text-muted" style="font-size:11px;">No matching schemas</div>';
            }
        }

        function updateStats() {
            statsEl.textContent = `${selectedSet.size}/${allSchemas.length} selected`;
        }

        renderList();

        searchInput.addEventListener('input', () => {
            renderList(searchInput.value);
        });

        modal.querySelector('#ide-schema-select-all').addEventListener('click', () => {
            const q = searchInput.value.trim().toLowerCase();
            allSchemas.forEach(sName => {
                if (!q || sName.toLowerCase().includes(q)) {
                    selectedSet.add(sName);
                }
            });
            renderList(searchInput.value);
            updateStats();
        });

        modal.querySelector('#ide-schema-deselect-all').addEventListener('click', () => {
            const q = searchInput.value.trim().toLowerCase();
            allSchemas.forEach(sName => {
                if (!q || sName.toLowerCase().includes(q)) {
                    selectedSet.delete(sName);
                }
            });
            renderList(searchInput.value);
            updateStats();
        });

        modal.querySelector('#ide-schema-btn-reset').addEventListener('click', () => {
            delete schemaFilters[filterKey];
            bsModal.hide();
            if (onApply) onApply();
        });

        modal.querySelector('#ide-schema-btn-apply').addEventListener('click', () => {
            if (selectedSet.size === allSchemas.length) {
                delete schemaFilters[filterKey];
            } else {
                schemaFilters[filterKey] = Array.from(selectedSet);
            }
            bsModal.hide();
            if (onApply) onApply();
        });

        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
        setTimeout(() => searchInput.focus(), 300);
    }

    // ── Database Filter Modal ────────────────────────────────────────────────
    async function showDatabaseFilterModal({ connId, connName, onApply }) {
        document.getElementById('ide-db-filter-modal')?.remove();

        let allDatabases = [];
        try {
            const res = await fetch(`/api/metadata/${connId}/databases`);
            const data = await res.json();
            allDatabases = (data.items || []).map(d => d.name || d);
        } catch (err) {
            console.error('Failed to load databases', err);
            return;
        }

        if (!allDatabases.length) {
            if (typeof showToast === 'function') showToast(`No databases found for ${connName}`, 'info');
            return;
        }

        const currentFilter = dbFilters[connId];
        const selectedSet = new Set(
            currentFilter && Array.isArray(currentFilter.selected)
                ? currentFilter.selected
                : allDatabases
        );

        const modal = document.createElement('div');
        modal.id = 'ide-db-filter-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title d-flex align-items-center gap-2" style="font-size:13px;">
                            <i class="fa-solid fa-filter text-primary"></i>
                            <span>Filter Databases <small class="text-muted fw-normal">(${escapeHtml(connName)})</small></span>
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body py-2">
                        <div class="mb-2">
                            <input type="text" id="ide-db-search-input" class="form-control form-control-sm" placeholder="Search databases...">
                        </div>
                        <div class="checklist-actions">
                            <div>
                                <a id="ide-db-select-all" class="me-2">Select All</a>
                                <a id="ide-db-deselect-all">Deselect All</a>
                            </div>
                            <span id="ide-db-stats" class="text-muted">${selectedSet.size}/${allDatabases.length} selected</span>
                        </div>
                        <div class="checklist-container" id="ide-db-checklist-list">
                            <!-- Injected checkboxes -->
                        </div>
                    </div>
                    <div class="modal-footer py-1 d-flex justify-content-between">
                        <button class="btn btn-sm btn-link text-danger px-0" id="ide-db-btn-reset">Reset</button>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button class="btn btn-sm btn-primary" id="ide-db-btn-apply">Apply</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        const listContainer = modal.querySelector('#ide-db-checklist-list');
        const statsEl = modal.querySelector('#ide-db-stats');
        const searchInput = modal.querySelector('#ide-db-search-input');

        function renderList(query = '') {
            const q = query.trim().toLowerCase();
            listContainer.innerHTML = '';
            let visibleCount = 0;

            allDatabases.forEach(dbName => {
                if (q && !dbName.toLowerCase().includes(q)) return;
                visibleCount++;

                const item = document.createElement('label');
                item.className = 'checklist-item';
                const isChecked = selectedSet.has(dbName);

                item.innerHTML = `
                    <input type="checkbox" class="form-check-input" value="${escapeHtml(dbName)}" ${isChecked ? 'checked' : ''}>
                    <span class="text-truncate">${escapeHtml(dbName)}</span>
                `;

                item.querySelector('input').addEventListener('change', e => {
                    if (e.target.checked) {
                        selectedSet.add(dbName);
                    } else {
                        selectedSet.delete(dbName);
                    }
                    updateStats();
                });

                listContainer.appendChild(item);
            });

            if (visibleCount === 0) {
                listContainer.innerHTML = '<div class="px-2 py-3 text-center text-muted" style="font-size:11px;">No matching databases</div>';
            }
        }

        function updateStats() {
            statsEl.textContent = `${selectedSet.size}/${allDatabases.length} selected`;
        }

        renderList();

        searchInput.addEventListener('input', () => {
            renderList(searchInput.value);
        });

        modal.querySelector('#ide-db-select-all').addEventListener('click', () => {
            const q = searchInput.value.trim().toLowerCase();
            allDatabases.forEach(dbName => {
                if (!q || dbName.toLowerCase().includes(q)) {
                    selectedSet.add(dbName);
                }
            });
            renderList(searchInput.value);
            updateStats();
        });

        modal.querySelector('#ide-db-deselect-all').addEventListener('click', () => {
            const q = searchInput.value.trim().toLowerCase();
            allDatabases.forEach(dbName => {
                if (!q || dbName.toLowerCase().includes(q)) {
                    selectedSet.delete(dbName);
                }
            });
            renderList(searchInput.value);
            updateStats();
        });

        modal.querySelector('#ide-db-btn-reset').addEventListener('click', () => {
            delete dbFilters[connId];
            bsModal.hide();
            if (onApply) onApply();
        });

        modal.querySelector('#ide-db-btn-apply').addEventListener('click', () => {
            if (selectedSet.size === allDatabases.length) {
                delete dbFilters[connId];
            } else {
                dbFilters[connId] = { selected: Array.from(selectedSet) };
            }
            bsModal.hide();
            if (onApply) onApply();
        });

        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
        setTimeout(() => searchInput.focus(), 300);
    }

    // ── Add a connection to the tree ──────────────────────────────────────────
        function addConnectionNode(connId, name, dbType, isActive = true, config = null) {
        return addConnectionNodeToUl(rootUl, connId, name, dbType, isActive, config);
    }

    function addConnectionNodeToUl(ul, connId, name, dbType, isActive = true, config = null) {
        if (!name || dbType === 'group_marker' || (config && config.type === 'group_marker') || String(name || '').startsWith('__group__')) {
            console.warn('[Explorer] Cannot add group_marker as a connection node:', name);
            return null;
        }
        const typeLabel = dbType === 'sqlserver' ? 'SQL Server' : 'PostgreSQL';
        const connKey = connId || (name + '::' + dbType);

        let currentStatus = getConnectionStatus(connId, name, dbType, isActive);
        if (isActive && config && config.is_alive === false) {
            currentStatus = 'lost';
            setConnectionStatus(connId, name, dbType, 'lost');
        } else if (!isActive) {
            currentStatus = 'disconnected';
            setConnectionStatus(connId, name, dbType, 'disconnected');
        }

        const rightEl = document.createElement('div');
        rightEl.className = 'tree-actions tree-node-actions d-flex align-items-center gap-1';
        
        if (isActive) {
            rightEl.innerHTML = `
                <i class="fa-solid fa-rotate-right tree-icon text-muted ide-conn-reconnect" title="Reconnect (Kết nối lại)"></i>
                <button class="tree-filter-btn ide-conn-filter" title="Filter Databases" aria-label="Filter Databases">
                    <i class="fa-solid fa-filter"></i>
                </button>
                <i class="fa-solid fa-arrows-rotate tree-icon text-muted ide-conn-refresh" title="Refresh Metadata"></i>
                <i class="fa-solid fa-plug-circle-xmark tree-icon text-warning ide-conn-disconnect" title="Disconnect"></i>
            `;
        } else {
            rightEl.innerHTML = `
                <i class="fa-solid fa-plug tree-icon text-success ide-conn-connect" title="Connect (Kết nối)"></i>
            `;
        }

        // Auto-initialize default database and schema filters if configured in connection profile
        if (isActive && connId && config) {
            if (config.database && !dbFilters[connId]) {
                dbFilters[connId] = { selected: [config.database] };
            }
            if (config.database && config.schema && !schemaFilters[`${connId}::${config.database}`]) {
                schemaFilters[`${connId}::${config.database}`] = [config.schema];
            }
        }

        let dbNodeCtrl = null;

        const btnFilter = rightEl.querySelector('.ide-conn-filter');
        if (btnFilter) {
            const hasDbFilter = () => {
                const f = dbFilters[connId];
                return !!(f && (Array.isArray(f.selected) || f.search));
            };
            if (hasDbFilter()) {
                btnFilter.classList.add('filter-active');
                btnFilter.title = `Filter Databases (Filtered)`;
                rightEl.classList.add('has-active-filter');
            }

            btnFilter.addEventListener('click', (e) => {
                e.stopPropagation();
                showDatabaseFilterModal({
                    connId,
                    connName: name,
                    onApply: () => {
                        if (hasDbFilter()) {
                            btnFilter.classList.add('filter-active');
                            rightEl.classList.add('has-active-filter');
                        } else {
                            btnFilter.classList.remove('filter-active');
                            rightEl.classList.remove('has-active-filter');
                        }
                        if (dbNodeCtrl) dbNodeCtrl.reload();
                    }
                });
            });
        }
        
        const btnRefresh = rightEl.querySelector('.ide-conn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.AppMetadataCache && typeof window.AppMetadataCache.invalidateConnection === 'function') {
                    window.AppMetadataCache.invalidateConnection(connId);
                }
                Object.keys(categoryDataCache).forEach(k => {
                    if (k.startsWith(`${connId}::`)) delete categoryDataCache[k];
                });
                if (dbNodeCtrl) dbNodeCtrl.reload();
            });
        }

        const btnReconnect = rightEl.querySelector('.ide-conn-reconnect');
        if (btnReconnect) {
            btnReconnect.addEventListener('click', (e) => {
                e.stopPropagation();
                reconnectConnection(connId, name, dbType, config);
            });
        }
        
        const btnDisconnect = rightEl.querySelector('.ide-conn-disconnect');
        if (btnDisconnect) {
            btnDisconnect.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Disconnect from ${name}?`)) {
                    disconnect(connId);
                }
            });
        }
        
        const btnConnect = rightEl.querySelector('.ide-conn-connect');
        if (btnConnect) {
            btnConnect.addEventListener('click', (e) => {
                e.stopPropagation();
                reconnectConnection(connId, name, dbType, config);
            });
        }

        const isPg = String(dbType || '').toLowerCase().includes('postgr');
        const connIconImg = isPg ? '/static/icons/postgresql.png' : '/static/icons/sqlserver.png';
        const connIconFallback = isPg 
            ? 'https://img.icons8.com/color/48/postgreesql.png' 
            : 'https://img.icons8.com/color/48/microsoft-sql-server.png';
        const connIconClass = isActive ? 'connected' : 'disconnected';

        dbNodeCtrl = renderNode(ul, {
            name: `${name} (${typeLabel})`,
            type: 'connection',
            iconImg: connIconImg,
            iconFallback: connIconFallback,
            iconClass: connIconClass,
            icon: 'server',
            iconColor: isActive ? 'var(--ide-success)' : 'var(--ide-text-dim)',
            hasChildren: isActive,
            loadCallback: isActive ? (childUl => fetchDatabases(childUl, connId, name, dbType, config)) : null,
            nodeData: { connId, connName: name, dbType, isActive, database: config ? config.database : null, schema: config ? config.schema : null, config },
            rightEl: rightEl
        });

        if (dbNodeCtrl && dbNodeCtrl.item) {
            dbNodeCtrl.item.addEventListener('dblclick', (e) => {
                const curSt = getConnectionStatus(connId, name, dbType, isActive);
                if (!isActive || curSt === 'lost') {
                    e.stopPropagation();
                    reconnectConnection(connId, name, dbType, config);
                }
            });
        }
        return dbNodeCtrl;
    }

    // ── Load active connections from server on page load ──────────────────────
    let _cachedSavedConnections = [];
    let _cachedActiveConnections = [];

    function getSavedConnections() {
        if ((!_cachedSavedConnections || _cachedSavedConnections.length === 0) && typeof localStorage !== 'undefined') {
            try {
                const ls = JSON.parse(localStorage.getItem('ide_saved_connections') || '[]');
                if (Array.isArray(ls) && ls.length > 0) {
                    _cachedSavedConnections = ls;
                }
            } catch (_) {}
        }
        return _cachedSavedConnections;
    }

    function getActiveConnections() {
        return _cachedActiveConnections;
    }

    async function loadSavedConnectionsFromStorage() {
        if (window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
            _cachedSavedConnections = await window.AppStorage.getSavedConnections() || [];
        }
        return _cachedSavedConnections;
    }

    async function saveConnectionProfile(config) {
        if (window.AppStorage && typeof window.AppStorage.saveConnectionProfile === 'function') {
            await window.AppStorage.saveConnectionProfile(config);
            await loadSavedConnectionsFromStorage();
        }
    }

    async function removeConnectionProfile(name, type) {
        if (window.AppStorage) {
            const saved = await window.AppStorage.getSavedConnections() || [];
            const target = saved.find(c => c.name === name && c.type === type);
            if (target && target.id) {
                await window.AppStorage.deleteSavedConnection(target.id);
            }
            await loadSavedConnectionsFromStorage();
        }
    }

    // ── Group Modal Helpers (No native browser alert/confirm/prompt) ──────────
    function showGroupInputModal({ title = 'Tạo nhóm mới', parentGroup = null, initialValue = '', onConfirm }) {
        const modalEl = document.getElementById('groupInputModal');
        if (!modalEl) {
            const val = prompt(title, initialValue);
            if (val && typeof onConfirm === 'function') onConfirm(val.trim());
            return;
        }

        const titleEl = document.getElementById('groupInputModalTitle');
        const parentWrap = document.getElementById('groupInputParentWrap');
        const parentNameEl = document.getElementById('groupInputParentName');
        const inputEl = document.getElementById('groupInputName');
        const errorEl = document.getElementById('groupInputError');
        const formEl = document.getElementById('groupInputForm');

        if (titleEl) titleEl.textContent = title;
        if (parentWrap && parentNameEl) {
            if (parentGroup) {
                parentWrap.style.display = 'block';
                parentNameEl.textContent = parentGroup;
            } else {
                parentWrap.style.display = 'none';
                parentNameEl.textContent = '';
            }
        }
        if (inputEl) {
            inputEl.value = initialValue || '';
            inputEl.classList.remove('is-invalid');
        }
        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }

        const bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal)
            ? bootstrap.Modal.getOrCreateInstance(modalEl)
            : null;

        if (formEl) {
            formEl.onsubmit = (e) => {
                e.preventDefault();
                const val = (inputEl.value || '').trim();
                if (!val) {
                    if (errorEl) {
                        errorEl.textContent = 'Vui lòng nhập tên nhóm.';
                        errorEl.style.display = 'block';
                    }
                    if (inputEl) inputEl.focus();
                    return;
                }
                if (val.includes('\\')) {
                    if (errorEl) {
                        errorEl.textContent = 'Tên nhóm không được chứa ký tự gạch chéo ngược (\\).';
                        errorEl.style.display = 'block';
                    }
                    if (inputEl) inputEl.focus();
                    return;
                }

                if (bsModal) bsModal.hide();
                if (typeof onConfirm === 'function') {
                    onConfirm(val);
                }
            };
        }

        if (bsModal) {
            bsModal.show();
            setTimeout(() => { if (inputEl) { inputEl.focus(); inputEl.select(); } }, 200);
        }
    }

    function showGroupConfirmModal({
        title = 'Xác nhận xóa nhóm',
        message = 'Bạn có chắc chắn muốn xóa nhóm này?',
        subtext = 'Các kết nối trong nhóm sẽ được chuyển về Chưa phân nhóm.',
        confirmText = 'Xóa',
        confirmVariant = 'btn-danger',
        onConfirm
    }) {
        const modalEl = document.getElementById('groupConfirmModal');
        if (!modalEl) {
            if (confirm(`${message}\n${subtext}`) && typeof onConfirm === 'function') onConfirm();
            return;
        }

        const titleEl = document.getElementById('groupConfirmModalTitle');
        const iconEl = document.getElementById('groupConfirmModalIcon');
        const msgEl = document.getElementById('groupConfirmMessage');
        const subEl = document.getElementById('groupConfirmSubtext');
        const actionBtn = document.getElementById('btnGroupConfirmAction');
        const actionText = document.getElementById('btnGroupConfirmActionText');
        const actionIcon = document.getElementById('btnGroupConfirmActionIcon');
        const cancelBtn = document.getElementById('btnGroupConfirmCancel');

        if (titleEl) titleEl.textContent = title;
        if (iconEl) {
            iconEl.className = confirmVariant === 'btn-danger'
                ? 'fa-solid fa-triangle-exclamation me-2 text-danger'
                : 'fa-solid fa-circle-info me-2 text-info';
        }
        if (msgEl) msgEl.textContent = message;
        if (subEl) {
            subEl.textContent = subtext || '';
            subEl.style.display = subtext ? 'block' : 'none';
        }
        if (actionText) actionText.textContent = confirmText;
        if (actionBtn) {
            actionBtn.className = `btn btn-sm ${confirmVariant}`;
            if (actionIcon) {
                actionIcon.className = confirmVariant === 'btn-danger'
                    ? 'fa-solid fa-trash me-1'
                    : 'fa-solid fa-check me-1';
            }
            actionBtn.style.display = 'inline-block';
        }
        if (cancelBtn) cancelBtn.style.display = 'inline-block';

        const bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal)
            ? bootstrap.Modal.getOrCreateInstance(modalEl)
            : null;

        if (actionBtn) {
            actionBtn.onclick = () => {
                if (bsModal) bsModal.hide();
                if (typeof onConfirm === 'function') {
                    onConfirm();
                }
            };
        }

        if (bsModal) bsModal.show();
    }

    function showGroupModalMessage({
        title = 'Thông báo',
        message = '',
        icon = 'fa-circle-info',
        iconColor = 'text-info'
    }) {
        const modalEl = document.getElementById('groupConfirmModal');
        if (!modalEl) {
            alert(message);
            return;
        }

        const titleEl = document.getElementById('groupConfirmModalTitle');
        const iconEl = document.getElementById('groupConfirmModalIcon');
        const msgEl = document.getElementById('groupConfirmMessage');
        const subEl = document.getElementById('groupConfirmSubtext');
        const actionBtn = document.getElementById('btnGroupConfirmAction');
        const actionText = document.getElementById('btnGroupConfirmActionText');
        const actionIcon = document.getElementById('btnGroupConfirmActionIcon');
        const cancelBtn = document.getElementById('btnGroupConfirmCancel');

        if (titleEl) titleEl.textContent = title;
        if (iconEl) iconEl.className = `fa-solid ${icon} me-2 ${iconColor}`;
        if (msgEl) msgEl.textContent = message;
        if (subEl) subEl.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (actionBtn) {
            actionBtn.className = 'btn btn-sm btn-primary';
            if (actionIcon) actionIcon.className = 'fa-solid fa-check me-1';
            if (actionText) actionText.textContent = 'Đóng';
            actionBtn.style.display = 'inline-block';
            actionBtn.onclick = () => {
                const bsModal = bootstrap.Modal.getInstance(modalEl);
                if (bsModal) bsModal.hide();
            };
        }

        const bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal)
            ? bootstrap.Modal.getOrCreateInstance(modalEl)
            : null;
        if (bsModal) bsModal.show();
    }

    window.showGroupInputModal = showGroupInputModal;
    window.showGroupConfirmModal = showGroupConfirmModal;
    window.showGroupModalMessage = showGroupModalMessage;

    // ── Multi-level Hierarchical Group Tree Builder ───────────────────────────
    function buildGroupHierarchy(saved) {
        const root = {
            name: "",
            fullPath: "",
            subgroups: new Map(),
            connections: []
        };

        (saved || []).forEach(c => {
            if (!c || typeof c !== 'object') return;
            const rawGroup = (c.group || "").trim();
            if (!rawGroup) {
                if (c.type !== 'group_marker') {
                    root.connections.push(c);
                }
                return;
            }

            const parts = rawGroup.split('/').map(p => p.trim()).filter(Boolean);
            if (parts.length === 0) {
                if (c.type !== 'group_marker') root.connections.push(c);
                return;
            }

            let curr = root;
            let runningPath = "";
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                runningPath = runningPath ? `${runningPath}/${part}` : part;
                if (!curr.subgroups.has(part)) {
                    curr.subgroups.set(part, {
                        name: part,
                        fullPath: runningPath,
                        subgroups: new Map(),
                        connections: []
                    });
                }
                curr = curr.subgroups.get(part);
            }

            if (c.type !== 'group_marker') {
                curr.connections.push(c);
            }
        });

        return root;
    }

    // ── Recursive Group Node Renderer with Nested Drag & Drop ────────────────
    function showRootDropZone(show = true) {
        const el = document.getElementById('ide-tree-root-dropzone');
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function hideRootDropZone() {
        const el = document.getElementById('ide-tree-root-dropzone');
        if (el) {
            el.style.display = 'none';
            el.classList.remove('drag-over');
        }
    }

    function renderGroupNode(groupNode, containerUl, saved, activeMap) {
        const li = document.createElement('li');
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.setAttribute('data-group', groupNode.fullPath);
        item.setAttribute('draggable', 'true');
        item._nodeData = { type: 'group', name: groupNode.fullPath, label: groupNode.name };

        const toggle = document.createElement('i');
        toggle.className = 'fa-solid fa-caret-down tree-toggle';
        const iconEl = document.createElement('i');
        iconEl.className = 'fa-solid fa-folder tree-icon';
        iconEl.style.color = '#dcb67a';
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = groupNode.name;

        const groupActions = document.createElement('div');
        groupActions.className = 'tree-node-actions';
        groupActions.appendChild(createMoreBtn({ type: 'group', name: groupNode.fullPath, label: groupNode.name }));

        item.append(toggle, iconEl, label, groupActions);
        li.appendChild(item);

        const childUl = document.createElement('ul');
        childUl.className = 'tree-children';
        childUl.style.display = 'block';
        li.appendChild(childUl);

        // Click to expand/collapse
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            if (childUl.style.display === 'none') {
                childUl.style.display = 'block';
                toggle.classList.replace('fa-caret-right', 'fa-caret-down');
            } else {
                childUl.style.display = 'none';
                toggle.classList.replace('fa-caret-down', 'fa-caret-right');
            }
        });

        // Dragging THIS group
        item.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('text/group-path', groupNode.fullPath);
            e.dataTransfer.setData('text/plain', 'group:' + groupNode.fullPath);
            window._draggingGroupPath = groupNode.fullPath;
            // Always show root dropzone when dragging any group (especially subgroups)
            showRootDropZone(true);
        });
        item.addEventListener('dragend', () => {
            hideRootDropZone();
            setTimeout(() => {
                window._draggingGroupPath = null;
            }, 500);
        });

        // Dropping another group or connection ONTO this group
        const onGroupDragOver = (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.style.background = 'var(--ide-bg-hover)';
        };
        const onGroupDragLeave = (e) => {
            item.style.background = '';
        };
        const onGroupDrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideRootDropZone();
            item.style.background = '';

            const targetGroupPath = groupNode.fullPath;
            const plain = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
            let srcGroupPath = e.dataTransfer ? e.dataTransfer.getData('text/group-path') : null;
            if (!srcGroupPath && plain && plain.startsWith('group:')) {
                srcGroupPath = plain.substring(6);
            }
            if (!srcGroupPath && window._draggingGroupPath) {
                srcGroupPath = window._draggingGroupPath;
            }

            if (srcGroupPath) {
                window._draggingGroupPath = null;
                if (srcGroupPath === targetGroupPath) return;

                // Circular nesting protection: cannot drag group into itself or its child
                if (targetGroupPath === srcGroupPath || targetGroupPath.startsWith(srcGroupPath + '/')) {
                    showGroupModalMessage({
                        title: 'Không thể di chuyển nhóm',
                        message: `Không thể di chuyển nhóm "${srcGroupPath}" vào chính nó hoặc nhóm con!`,
                        icon: 'fa-triangle-exclamation',
                        iconColor: 'text-warning'
                    });
                    return;
                }

                const baseName = srcGroupPath.split('/').pop();
                const newGroupPath = `${targetGroupPath}/${baseName}`;
                if (newGroupPath === srcGroupPath) return;

                await moveGroupHierarchy(srcGroupPath, newGroupPath);
                return;
            }

            // Connection drop into this group
            let connIdToMove = e.dataTransfer ? e.dataTransfer.getData('text/conn-id') : null;
            if (!connIdToMove && plain && !plain.startsWith('group:')) {
                connIdToMove = plain;
            }
            if (!connIdToMove && window._draggingConnId) {
                connIdToMove = window._draggingConnId;
            }

            if (connIdToMove) {
                window._draggingConnId = null;
                const cToMove = saved.find(s => s.id === connIdToMove);
                if (cToMove && cToMove.group !== targetGroupPath) {
                    cToMove.group = targetGroupPath;
                    await saveConnectionProfile(cToMove);
                    loadActiveConnections();
                    if (typeof showToast === 'function') {
                        showToast(`✓ Đã chuyển kết nối "${cToMove.name}" vào nhóm "${targetGroupPath}"`, 'success');
                    }
                }
            }
        };

        item.addEventListener('dragover', onGroupDragOver);
        item.addEventListener('dragleave', onGroupDragLeave);
        item.addEventListener('drop', onGroupDrop);

        // Also allow dropping onto childUl directly
        childUl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        childUl.addEventListener('drop', onGroupDrop);

        // Render child groups recursively (sorted alphabetically)
        const sortedSubgroupKeys = Array.from(groupNode.subgroups.keys()).sort((a, b) => a.localeCompare(b));
        for (const subKey of sortedSubgroupKeys) {
            renderGroupNode(groupNode.subgroups.get(subKey), childUl, saved, activeMap);
        }

        // Render child connections in this group
        groupNode.connections.forEach(c => {
            renderConnectionItem(c, childUl, saved, activeMap);
        });

        containerUl.appendChild(li);
    }

    function renderConnectionItem(c, targetUl, saved, activeMap) {
        if (!c || c.type === 'group_marker' || String(c.name || '').startsWith('__group__')) return;
        const activeConn = activeMap[c.name + '::' + c.type]
            || activeMap[(c.server || c.host || '') + '::' + c.type]
            || Object.values(activeMap).find(a => (a && (a.connection_id === c.id || (a.config && a.config.id === c.id) || a.name === c.name || (a.config && a.config.name === c.name))));
        const isActive = !!activeConn;
        const connId = isActive ? activeConn.connection_id : null;
        const connConfig = { ...(c || {}), ...(activeConn?.config || {}), is_alive: activeConn?.is_alive };
        const ctrl = addConnectionNodeToUl(targetUl, connId, c.name, c.type, isActive, connConfig);
        if (ctrl && ctrl.item && c.id) {
            ctrl.item.setAttribute('draggable', 'true');
            ctrl.item.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('text/conn-id', c.id);
                e.dataTransfer.setData('text/plain', c.id);
                window._draggingConnId = c.id;
                showRootDropZone(!!c.group);
            });
            ctrl.item.addEventListener('dragend', () => {
                hideRootDropZone();
                setTimeout(() => {
                    window._draggingConnId = null;
                }, 500);
            });
        }
    }

    // ── Move Group and all its Descendant Groups & Connections ────────────────
    async function moveGroupHierarchy(oldPath, newPath) {
        const saved = await getSavedConnections();
        for (const c of saved) {
            if (c.group === oldPath) {
                c.group = newPath;
                if (c.type === 'group_marker') {
                    c.name = `__group__${newPath}`;
                }
                await saveConnectionProfile(c);
            } else if (c.group && c.group.startsWith(oldPath + '/')) {
                const subSuffix = c.group.substring(oldPath.length);
                c.group = newPath + subSuffix;
                if (c.type === 'group_marker') {
                    c.name = `__group__${c.group}`;
                }
                await saveConnectionProfile(c);
            }
        }

        // Ensure marker exists for newPath
        const hasMarker = saved.some(c => c.group === newPath);
        if (!hasMarker) {
            const dummy = {
                id: 'group_' + Date.now(),
                name: `__group__${newPath}`,
                type: 'group_marker',
                group: newPath
            };
            await saveConnectionProfile(dummy);
        }

        loadActiveConnections();
        const baseName = oldPath.split('/').pop();
        if (typeof showToast === 'function') {
            if (newPath === baseName) {
                showToast(`✓ Đã chuyển nhóm "${baseName}" ra thư mục gốc`, 'success');
            } else {
                showToast(`✓ Đã chuyển nhóm "${baseName}" vào "${newPath}"`, 'success');
            }
        }
    }

    // ── Drop to Root (moves group to root or connection to ungrouped) ─────────
    async function handleDropToRoot(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        hideRootDropZone();

        const plain = e && e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
        let srcGroupPath = e && e.dataTransfer ? e.dataTransfer.getData('text/group-path') : null;
        if (!srcGroupPath && plain && plain.startsWith('group:')) {
            srcGroupPath = plain.substring(6);
        }
        if (!srcGroupPath && window._draggingGroupPath) {
            srcGroupPath = window._draggingGroupPath;
        }

        if (srcGroupPath) {
            window._draggingGroupPath = null;
            const parts = srcGroupPath.split('/').filter(Boolean);
            const baseName = parts[parts.length - 1];
            if (srcGroupPath !== baseName) {
                await moveGroupHierarchy(srcGroupPath, baseName);
            }
            return;
        }

        let connIdToMove = e && e.dataTransfer ? e.dataTransfer.getData('text/conn-id') : null;
        if (!connIdToMove && plain && !plain.startsWith('group:')) {
            connIdToMove = plain;
        }
        if (!connIdToMove && window._draggingConnId) {
            connIdToMove = window._draggingConnId;
        }

        if (connIdToMove) {
            window._draggingConnId = null;
            const saved = getSavedConnections();
            const cToMove = saved.find(s => s.id === connIdToMove);
            if (cToMove && cToMove.group) {
                cToMove.group = '';
                await saveConnectionProfile(cToMove);
                loadActiveConnections();
                if (typeof showToast === 'function') {
                    showToast(`✓ Đã chuyển kết nối "${cToMove.name}" về Chưa phân nhóm`, 'success');
                }
            }
        }
    }

    // ── Load active connections from server on page load ──────────────────────
    async function loadActiveConnections() {
        try {
            await loadSavedConnectionsFromStorage();
            const activeMap = {};
            let fetchedSaved = [];
            try {
                const res  = await fetch('/api/connections');
                if (res && res.ok) {
                    const data = await res.json();
                    if (data && data.success && Array.isArray(data.connections)) {
                        _cachedActiveConnections = data.connections;
                        data.connections.forEach(c => {
                            if (!c) return;
                            const dbType = c.type || c.config?.type || 'sqlserver';
                            const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                            activeMap[displayName + '::' + dbType] = c;
                        });
                    } else {
                        _cachedActiveConnections = [];
                    }
                    if (data && Array.isArray(data.saved_connections) && data.saved_connections.length > 0) {
                        fetchedSaved = data.saved_connections;
                    }
                }
            } catch (fetchErr) {
                console.warn('[Explorer] fetch /api/connections warning:', fetchErr);
            }

            let saved = getSavedConnections();
            if ((!saved || saved.length === 0) && fetchedSaved.length > 0) {
                _cachedSavedConnections = fetchedSaved;
                saved = _cachedSavedConnections;
            }

            // Merge active connections that might not be in saved yet
            Object.values(activeMap).forEach(c => {
                if (!c) return;
                const dbType = c.type || c.config?.type || 'sqlserver';
                const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                if (!saved.find(s => s && s.name === displayName && s.type === dbType)) {
                    saved.push({ name: displayName, type: dbType, ...c.config });
                }
            });

            rootUl.innerHTML = '';
            rootUl.style.minHeight = '100%';

            // Dedicated Root Dropzone item (shown when dragging)
            const rootDropZone = document.createElement('li');
            rootDropZone.id = 'ide-tree-root-dropzone';
            rootDropZone.className = 'tree-root-dropzone';
            rootDropZone.innerHTML = '<i class="fa-solid fa-arrow-turn-up me-1"></i><span>Thả vào đây để chuyển ra thư mục gốc (Root)</span>';
            rootDropZone.ondragover = (e) => {
                e.preventDefault();
                e.stopPropagation();
                rootDropZone.classList.add('drag-over');
            };
            rootDropZone.ondragleave = (e) => {
                rootDropZone.classList.remove('drag-over');
            };
            rootDropZone.ondrop = (e) => {
                handleDropToRoot(e);
            };
            rootUl.appendChild(rootDropZone);

            // Build hierarchical tree of groups
            const groupHierarchy = buildGroupHierarchy(saved);

            // 1. Render top-level groups (alphabetical)
            const topGroupKeys = Array.from(groupHierarchy.subgroups.keys()).sort((a, b) => a.localeCompare(b));
            for (const gKey of topGroupKeys) {
                renderGroupNode(groupHierarchy.subgroups.get(gKey), rootUl, saved, activeMap);
            }

            // 2. Render ungrouped connections at the root level
            groupHierarchy.connections.forEach(c => {
                renderConnectionItem(c, rootUl, saved, activeMap);
            });

            // 3. Drop on empty background of rootUl or parent tree container
            rootUl.ondragover = (e) => {
                e.preventDefault();
                if (window._draggingGroupPath && window._draggingGroupPath.includes('/')) {
                    showRootDropZone(true);
                }
            };
            rootUl.ondrop = (e) => {
                handleDropToRoot(e);
            };

            const treeContainer = rootUl.closest('.ide-tree') || rootUl.parentElement;
            if (treeContainer) {
                treeContainer.ondragover = (e) => {
                    e.preventDefault();
                    if (window._draggingGroupPath && window._draggingGroupPath.includes('/')) {
                        showRootDropZone(true);
                    }
                };
                treeContainer.ondrop = (e) => {
                    handleDropToRoot(e);
                };
            }

            // Sync mini-rail collapsed items with latest connections and statuses
            renderCollapsedRail();

            // Auto-sync action bar if no connection is assigned yet and saved profiles exist
            const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const currentTabConn = activeTab ? activeTab.connectionName : null;
            if ((!currentTabConn || currentTabConn === 'No connection') && (!window.ActiveConnectionName || window.ActiveConnectionName === 'No connection')) {
                const defaultSaved = saved.find(s => s && s.type !== 'group_marker' && !String(s.name || '').startsWith('__group__'));
                if (defaultSaved && window.AppTabs && typeof window.AppTabs.updateActiveTabContext === 'function') {
                    const prefillCtx = {
                        connectionName: defaultSaved.name,
                        connectionId: defaultSaved.id || null,
                        dbType: defaultSaved.type || 'sqlserver',
                        database: defaultSaved.database || null,
                        schema: defaultSaved.schema || null
                    };
                    window.ActiveConnectionName = defaultSaved.name;
                    window.ActiveConnectionId = defaultSaved.id || null;
                    window.ActiveDbType = defaultSaved.type || 'sqlserver';
                    if (defaultSaved.database) window.ActiveDatabase = defaultSaved.database;
                    if (defaultSaved.schema) window.ActiveSchema = defaultSaved.schema;
                    window.AppTabs.updateActiveTabContext(prefillCtx);
                    if (typeof window.updateActionBar === 'function') {
                        window.updateActionBar();
                    }
                }
            }

        } catch (e) {
            console.error('loadActiveConnections failed', e);
        }
    }

    async function createGroup(groupName) {
        if (!groupName) return;
        const dummy = {
            id: 'group_' + Date.now(),
            name: `__group__${groupName}`,
            type: 'group_marker',
            group: groupName
        };
        await saveConnectionProfile(dummy);
        loadActiveConnections();
    }

    async function renameGroup(oldPath, newPath) {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const saved = await getSavedConnections();
        for (const c of saved) {
            if (c.group === oldPath) {
                c.group = newPath;
                if (c.type === 'group_marker') {
                    c.name = `__group__${newPath}`;
                }
                await saveConnectionProfile(c);
            } else if (c.group && c.group.startsWith(oldPath + '/')) {
                const subSuffix = c.group.substring(oldPath.length);
                c.group = newPath + subSuffix;
                if (c.type === 'group_marker') {
                    c.name = `__group__${c.group}`;
                }
                await saveConnectionProfile(c);
            }
        }

        // Ensure marker exists for newPath if it was an empty group
        const hasMarker = saved.some(c => c.group === newPath);
        if (!hasMarker) {
            const dummy = {
                id: 'group_' + Date.now(),
                name: `__group__${newPath}`,
                type: 'group_marker',
                group: newPath
            };
            await saveConnectionProfile(dummy);
        }

        loadActiveConnections();
        const baseName = newPath.split('/').pop();
        if (typeof showToast === 'function') {
            showToast(`✓ Đã đổi tên nhóm thành "${baseName}"`, 'success');
        }
    }

    async function deleteGroup(groupName) {
        if (!groupName) return;
        const targetLower = (groupName || '').trim().toLowerCase();
        const prefixLower = targetLower + '/';
        showGroupConfirmModal({
            title: 'Xác nhận xóa nhóm',
            message: `Bạn có chắc muốn xóa nhóm "${groupName}"?`,
            subtext: 'Tất cả kết nối và nhóm con bên trong sẽ được chuyển về Chưa phân nhóm.',
            confirmText: 'Xóa nhóm',
            confirmVariant: 'btn-danger',
            onConfirm: async () => {
                const saved = await getSavedConnections();
                for (const c of saved) {
                    const cGrp = (c.group || '').trim().toLowerCase();
                    if (cGrp === targetLower || cGrp.startsWith(prefixLower)) {
                        if (c.type === 'group_marker') {
                            if (window.AppStorage && typeof window.AppStorage.deleteSavedConnection === 'function') {
                                await window.AppStorage.deleteSavedConnection(c.id);
                            }
                        } else {
                            c.group = '';
                            await saveConnectionProfile(c);
                        }
                    }
                }
                loadActiveConnections();
                if (typeof showToast === 'function') {
                    showToast(`✓ Đã xóa nhóm "${groupName}"`, 'info');
                }
            }
        });
    }
    async function disconnect(connId) {
        let targetId = connId;
        if (typeof targetId === 'object' && targetId) {
            targetId = targetId.connId || targetId.connectionId || targetId.connection_id || targetId.id;
        }
        if (!targetId) targetId = window.ActiveConnectionId;
        if (!targetId) return;

        try {
            const res = await fetch(`/api/connections/${targetId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (data && data.success) {
                if (typeof showToast === 'function') {
                    showToast('✓ Disconnected successfully', 'info');
                }
            }
        } catch (_) {}

        if (window.ActiveConnectionId === targetId || !window.ActiveConnectionId) {
            window.ActiveConnectionId = null;
            window.ActiveConnectionName = null;
            window.ActiveDatabase = null;
            window.ActiveSchema = null;
            window.ActiveDbType = null;
            if (typeof window.updateActionBar === 'function') {
                window.updateActionBar();
            }
        }
        await loadActiveConnections();
    }
    
    async function deleteConnection(connId, name, type) {
        if (connId) {
            try { await fetch(`/api/connections/${connId}`, { method: 'DELETE' }); } catch (_) {}
        }
        try {
            await fetch('/api/connections/clear-credential', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type })
            });
        } catch (_) {}
        removeConnectionProfile(name, type);
        loadActiveConnections();
    }

    // ── Direct connection executor ───────────────────────────────────────────
    async function doConnect(name, payload, onConnected) {
        if (!payload || payload.type === 'group_marker' || String(name || '').startsWith('__group__')) {
            console.warn('[Explorer] Cannot connect to a group node:', name);
            return { success: false, error: 'Cannot connect to a group node' };
        }
        try {
            showToast(`Connecting to ${name}…`, 'info');
            const res = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok && data.connection) {
                showToast(`✓ Connected to ${name}`, 'success');
                await loadActiveConnections();
                if (typeof window.activateConnectionContext === 'function') {
                    await window.activateConnectionContext(data.connection.connection_id, name, payload.type, payload.database, payload.schema);
                }
                if (typeof onConnected === 'function') {
                    onConnected(data.connection, payload);
                }
                return { success: true, data };
            } else {
                const err = data.error || 'Unknown error';
                showToast('Connection failed: ' + err, 'danger');
                return { success: false, error: err };
            }
        } catch (e) {
            showToast('Network error: ' + e.message, 'danger');
            return { success: false, error: e.message };
        }
    }

    // ── Reconnect Password Prompt Modal ──────────────────────────────────────
    let reconnectModalInstance = null;
    function promptReconnectPassword(name, dbType, config, onConnected) {
        const modalEl = document.getElementById('reconnectPasswordModal');
        if (!modalEl) {
            const entered = prompt(`Enter password for user '${config.username || ''}' to connect to ${name}:`);
            if (entered !== null) {
                doConnect(name, { ...config, password: entered }, onConnected);
            }
            return;
        }

        if (!reconnectModalInstance && window.bootstrap) {
            reconnectModalInstance = new bootstrap.Modal(modalEl);
        }

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

        // Reset inputs
        if (elPass) {
            elPass.value = '';
            elPass.type = 'password';
        }
        if (elError) {
            elError.textContent = '';
            elError.classList.add('d-none');
        }
        if (btnToggle) {
            const icon = btnToggle.querySelector('i');
            if (icon) icon.className = 'fa-solid fa-eye';
        }

        const submitPassword = async () => {
            const password = elPass ? elPass.value : '';
            if (!password) {
                if (elError) {
                    elError.textContent = 'Please enter password.';
                    elError.classList.remove('d-none');
                }
                if (elPass) elPass.focus();
                return;
            }

            if (btnConfirm) {
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Connecting...';
            }
            if (elError) elError.classList.add('d-none');

            try {
                const res = await fetch('/api/connections', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...config, password })
                });
                const data = await res.json();
                if (res.ok && data.connection) {

                    if (reconnectModalInstance) reconnectModalInstance.hide();
                    showToast(`✓ Connected to ${name}`, 'success');
                    await loadActiveConnections();
                    if (typeof window.activateConnectionContext === 'function') {
                        window.activateConnectionContext(data.connection.connection_id, name, dbType, config.database, config.schema);
                    }
                    if (typeof onConnected === 'function') {
                        onConnected(data.connection, config);
                    }
                } else {
                    const errMsg = data.error || 'Connection failed.';
                    if (elError) {
                        elError.textContent = errMsg;
                        elError.classList.remove('d-none');
                    } else {
                        showToast(errMsg, 'danger');
                    }
                    if (elPass) elPass.focus();
                }
            } catch (e) {
                if (elError) {
                    elError.textContent = 'Network error: ' + e.message;
                    elError.classList.remove('d-none');
                }
            } finally {
                if (btnConfirm) {
                    btnConfirm.disabled = false;
                    btnConfirm.innerHTML = '<i class="fa-solid fa-plug me-1"></i>Connect';
                }
            }
        };

        // Wire form submit
        if (reconnForm) {
            reconnForm.onsubmit = (e) => {
                e.preventDefault();
                submitPassword();
            };
        }

        // Wire toggle button once
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

        // Wire confirm click and enter key fallback
        if (btnConfirm) {
            btnConfirm.onclick = submitPassword;
        }
        if (elPass) {
            elPass.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPassword();
                }
            };
        }

        if (reconnectModalInstance) {
            reconnectModalInstance.show();
            setTimeout(() => { if (elPass) elPass.focus(); }, 350);
        }
    }

    // ── Reconnect (Check RAM cache first, prompt modal if missing) ────────────
    async function reconnect(name, dbType, config, onConnected) {
        if (!config || config.type === 'group_marker' || dbType === 'group_marker' || String(name || '').startsWith('__group__')) {
            console.warn('[Explorer] Cannot reconnect a group item:', name);
            return;
        }
        if (!config) {
            showToast('No saved config for this connection.', 'danger');
            return;
        }

        const isTrusted = config.trusted_connection === true || config.trusted_connection === 'true';
        const isSqlite = (dbType || config.type || '').toLowerCase() === 'sqlite';

        // Windows Auth, SQLite, or Password already supplied -> Connect immediately
        if (isTrusted || isSqlite || config.password) {
            await doConnect(name, config, onConnected);
            return;
        }

        // Try getting saved password from AppStorage before showing modal
        if (window.AppStorage && typeof window.AppStorage.getConnectionPassword === 'function') {
            try {
                const pwdRes = await window.AppStorage.getConnectionPassword(config.id || config.name || name);
                const resolvedPwd = (typeof pwdRes === 'string') ? pwdRes : (pwdRes && pwdRes.password ? pwdRes.password : '');
                if (resolvedPwd) {
                    await doConnect(name, { ...config, password: resolvedPwd }, onConnected);
                    return;
                }
            } catch (_) {}
        }

        // Check if password exists in RAM cache (Cách 2)
        try {
            const checkRes = await fetch('/api/connections/check-credential', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const checkData = await checkRes.json();
            if (checkData.success && checkData.has_password) {
                // Password exists in RAM cache -> Connect directly
                await doConnect(name, config, onConnected);
                return;
            }
        } catch (e) {
            console.warn('Failed to check credentials from cache', e);
        }

        // Password not in RAM cache -> Show Password Modal
        promptReconnectPassword(name, dbType, config, onConnected);
    }

    // ── Refresh button ────────────────────────────────────────────────────────
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            if (window.ActiveConnectionId) {
                try {
                    await fetch(`/api/metadata/${window.ActiveConnectionId}/refresh`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({})
                    }).catch(e => {});
                } catch (e) {}
            }
            if (window.AppMetadataCache && typeof window.AppMetadataCache.invalidateAll === 'function') {
                window.AppMetadataCache.invalidateAll();
            }
            if (window.AppIntelliSense && typeof window.AppIntelliSense.invalidateAll === 'function') {
                window.AppIntelliSense.invalidateAll();
            }
            Object.keys(categoryDataCache).forEach(k => delete categoryDataCache[k]);
            rootUl.innerHTML = '';
            window.ActiveConnectionId = null;
            window.ActiveDatabase     = null;
            window.ActiveSchema       = null;
            loadActiveConnections();
        });
    }

    // ── New Group button ──────────────────────────────────────────────────────
    const newGroupBtn = document.getElementById('ide-btn-new-group');
    if (newGroupBtn) {
        newGroupBtn.addEventListener('click', () => {
            showGroupInputModal({
                title: 'Tạo nhóm mới',
                onConfirm: async (groupName) => {
                    await createGroup(groupName);
                    if (typeof showToast === 'function') {
                        showToast(`✓ Đã tạo nhóm "${groupName}"`, 'success');
                    }
                }
            });
        });
    }

    // ── Sidebar Toolbar Database Filter button ────────────────────────────────
    const filterDbBtn = document.getElementById('ide-btn-filter-db');
    if (filterDbBtn) {
        filterDbBtn.addEventListener('click', () => {
            const targetConnId = window.ActiveConnectionId;
            if (!targetConnId) {
                const activeConnItem = rootUl.querySelector('.tree-item[data-node-type="connection"]');
                if (activeConnItem && activeConnItem._nodeData && activeConnItem._nodeData.connId) {
                    const nd = activeConnItem._nodeData;
                    showDatabaseFilterModal({
                        connId: nd.connId,
                        connName: nd.connName || 'Connection',
                        onApply: () => {
                            loadActiveConnections();
                        }
                    });
                } else {
                    if (typeof showToast === 'function') showToast('Please connect to a database server first.', 'info');
                }
                return;
            }
            showDatabaseFilterModal({
                connId: targetConnId,
                connName: window.ActiveConnectionName || 'Active Connection',
                onApply: () => {
                    loadActiveConnections();
                }
            });
        });
    }

    loadActiveConnections();

    // Reload active connections automatically if pywebview becomes ready after DOM initialization
    window.addEventListener('pywebviewready', () => {
        loadActiveConnections();
    });

    function clearCategoryCache(connId = null, dbName = null) {
        if (!connId) {
            Object.keys(categoryDataCache).forEach(k => delete categoryDataCache[k]);
            return;
        }
        const prefix = dbName ? `${connId}::${dbName}` : `${connId}::`;
        for (const k of Object.keys(categoryDataCache)) {
            if (k.startsWith(prefix)) {
                delete categoryDataCache[k];
            }
        }
    }

    async function refreshNode(nodeData) {
        if (!nodeData) return;
        const targetConn = nodeData.connId || nodeData.connectionId || window.ActiveConnectionId;
        const targetDb = nodeData.database || (nodeData.type === 'database' ? nodeData.name : window.ActiveDatabase);
        const targetSchema = nodeData.schema || (nodeData.type === 'schema' ? nodeData.name : null);
        const targetType = nodeData.type || '';
        const targetName = nodeData.name ? String(nodeData.name).trim().toLowerCase() : null;
        const catType = nodeData.catType || nodeData.objectType || (targetType.startsWith('group-') ? targetType.replace(/^group-/, '') : null);

        // 1. Invalidate Backend Cache via API
        if (targetConn) {
            try {
                fetch(`/api/metadata/${targetConn}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        database: targetDb,
                        schema: targetSchema,
                        type: catType
                    })
                }).catch(e => console.warn('[refreshNode] backend refresh warn:', e));
            } catch (e) {}
        }

        // 2. Invalidate Frontend Cache
        if (targetConn) {
            // Invalidate categoryDataCache for target scope
            const prefix = targetDb ? `${targetConn}::${targetDb}` : `${targetConn}::`;
            for (const k of Object.keys(categoryDataCache)) {
                if (k.startsWith(prefix)) {
                    if (!catType || k.endsWith(`::${catType}`)) {
                        delete categoryDataCache[k];
                    }
                }
            }
            // Invalidate AppMetadataCache
            if (window.AppMetadataCache) {
                if (targetType.startsWith('group-') || targetType === 'schema') {
                    window.AppMetadataCache.invalidateSchema(targetConn, targetDb, targetSchema);
                } else if (targetType === 'database') {
                    window.AppMetadataCache.invalidateDatabase(targetConn, targetDb);
                } else if (targetType === 'connection') {
                    window.AppMetadataCache.invalidateConnection(targetConn);
                } else if (targetName && ['table', 'view', 'procedure', 'function', 'materialized_view', 'trigger', 'sequence'].includes(targetType)) {
                    window.AppMetadataCache.invalidateObject(targetConn, targetDb, targetSchema, nodeData.name);
                } else {
                    window.AppMetadataCache.invalidateConnection(targetConn);
                }
            }
            // Invalidate AppIntelliSense data provider
            if (window.AppIntelliSense && typeof window.AppIntelliSense.invalidateConnection === 'function') {
                window.AppIntelliSense.invalidateConnection(targetConn);
            }
        }

        // 3. Locate and reload corresponding tree items in DOM
        const items = document.querySelectorAll('.tree-item');

        // Case A: Group node refresh (group-tables, group-views, group-procedures, etc.)
        if (catType || targetType.startsWith('group-')) {
            const expectedGroupType = catType ? `group-${catType}` : targetType;
            for (const it of items) {
                const nd = it._nodeData;
                if (!nd) continue;
                if (targetConn && nd.connId && nd.connId !== targetConn) continue;
                if (targetDb && nd.database && nd.database !== targetDb) continue;
                if (targetSchema && nd.schema && nd.schema !== targetSchema) continue;

                if (nd.type === expectedGroupType || (catType && (nd.catType === catType || nd.objectType === catType))) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                    }
                    if (typeof it._updateBadge === 'function') {
                        it._updateBadge(true);
                    }
                    return;
                }
            }
        }

        // Case B: Linked Server / Linked Servers Group
        if (targetType === 'linked_server' || targetType === 'linked_servers_group') {
            for (const it of items) {
                const nd = it._nodeData;
                if (!nd) continue;
                if (nd.type === 'linked_servers_group' && (!targetConn || nd.connId === targetConn)) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                        return;
                    }
                }
            }
        }

        // Case C: Single Object (table, view, proc, etc.) - reload item and its parent group
        if (['table', 'view', 'procedure', 'function', 'materialized_view', 'trigger', 'sequence'].includes(targetType)) {
            for (const it of items) {
                const nd = it._nodeData;
                if (!nd) continue;
                if (targetConn && nd.connId && nd.connId !== targetConn) continue;
                if (targetDb && nd.database && nd.database !== targetDb) continue;
                if (targetSchema && nd.schema && nd.schema !== targetSchema) continue;

                if (nd.name && String(nd.name).trim().toLowerCase() === targetName) {
                    // Reload item if it has children (e.g. table columns)
                    if (typeof it._reload === 'function') {
                        it._reload(true);
                    }
                    // Also reload parent group (e.g. Tables folder)
                    const parentItem = it.parentElement?.parentElement?.closest('.tree-item');
                    if (parentItem && typeof parentItem._reload === 'function') {
                        parentItem._reload(true);
                        if (typeof parentItem._updateBadge === 'function') parentItem._updateBadge(true);
                    }
                    return;
                }
            }
        }

        // Case D: Schema, Database, or Connection Node
        for (const it of items) {
            const nd = it._nodeData;
            if (!nd) continue;
            if (targetConn && nd.connId && nd.connId !== targetConn) continue;

            if (targetType === 'schema' && nd.type === 'schema') {
                if (targetDb && nd.database && nd.database !== targetDb) continue;
                if (targetName && String(nd.name).trim().toLowerCase() === targetName) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                        return;
                    }
                }
            } else if (targetType === 'database' && nd.type === 'database') {
                if (!targetName || (nd.name && String(nd.name).trim().toLowerCase() === targetName)) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                    }
                }
            } else if (targetType === 'connection' && nd.type === 'connection') {
                if (nd.connId === targetConn) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                        return;
                    }
                }
            }
        }

        // Case E: If refreshing entire database or connection, also reload any open/expanded category group nodes
        if (targetType === 'database' || targetType === 'connection' || !targetType) {
            for (const it of items) {
                const nd = it._nodeData;
                if (!nd) continue;
                if (targetConn && nd.connId && nd.connId !== targetConn) continue;
                if (targetDb && nd.database && nd.database !== targetDb) continue;
                if (nd.type && nd.type.startsWith('group-')) {
                    const subUl = it.parentElement?.querySelector('ul');
                    const isExpanded = it.classList.contains('open') || (subUl && subUl.style.display !== 'none');
                    if (isExpanded) {
                        if (typeof it._reload === 'function') {
                            it._reload(true).catch(() => {});
                        }
                        if (typeof it._updateBadge === 'function') {
                            it._updateBadge(true);
                        }
                    }
                }
            }
        }

        // Fallback: match by name
        if (targetName) {
            for (const it of items) {
                const nd = it._nodeData;
                if (!nd) continue;
                if (targetConn && nd.connId && nd.connId !== targetConn) continue;
                if (nd.name && String(nd.name).trim().toLowerCase() === targetName) {
                    if (typeof it._reload === 'function') {
                        await it._reload(true);
                        return;
                    }
                }
            }
        }
    }

    // ── Render Collapsed Mini-Rail (Representative Connection Icons) ──────────
    function renderCollapsedRail() {
        const rail = document.getElementById('ide-sidebar-collapsed-rail');
        if (!rail) return;
        rail.innerHTML = '';

        const saved = getSavedConnections() || [];
        const renderedKeys = new Set();

        // 1. Add all connection items currently in the Object Explorer tree
        const connTreeItems = rootUl.querySelectorAll('.tree-item[data-node-type="connection"]');
        connTreeItems.forEach(item => {
            const nd = item._nodeData || {};
            const name = nd.connName || nd.name;
            if (!name) return;
            const dbType = nd.dbType || nd.config?.type || 'sqlserver';
            const connId = nd.connId || null;
            const key = connId || (name + '::' + dbType);
            if (renderedKeys.has(key)) return;
            renderedKeys.add(key);

            const isPg = String(dbType || '').toLowerCase().includes('postgr');
            const iconImg = isPg ? '/static/icons/postgresql.png' : '/static/icons/sqlserver.png';
            const fallbackIcon = isPg 
                ? 'https://img.icons8.com/color/48/postgreesql.png' 
                : 'https://img.icons8.com/color/48/microsoft-sql-server.png';
            
            const status = getConnectionStatus(connId, name, dbType, nd.isActive);

            const itemDiv = document.createElement('div');
            itemDiv.className = `ide-collapsed-conn-item ${status === 'connected' ? 'active' : ''}`;
            itemDiv.dataset.connKey = key;
            if (connId) itemDiv.dataset.connId = connId;
            itemDiv.dataset.connName = name;
            itemDiv.dataset.dbType = dbType;
            const statusLabel = status === 'connected' ? 'Connected (Đang kết nối)' 
                              : status === 'lost' ? 'Lost Connection (Mất kết nối - Chuột phải để Reconnect)' 
                              : status === 'reconnecting' ? 'Reconnecting (Đang kết nối lại...)' : 'Disconnected (Chưa kết nối)';
            itemDiv.title = `${name} (${statusLabel})`;

            const img = document.createElement('img');
            img.src = iconImg;
            img.className = 'ide-collapsed-conn-icon';
            img.onerror = () => { img.onerror = null; img.src = fallbackIcon; };
            img.alt = name;

            const badge = document.createElement('span');
            badge.className = `ide-collapsed-conn-badge conn-status-badge status-${status}`;

            itemDiv.appendChild(img);
            itemDiv.appendChild(badge);

            // Left Click: Expand sidebar and focus/select this tree item
            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof window.expandSidebar === 'function') {
                    window.expandSidebar();
                }
                setTimeout(() => {
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    item.click();
                }, 120);
            });

            // Right Click: Show Context Menu for this connection
            itemDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.ContextMenu) {
                    window.ContextMenu.show('connection', nd, e.clientX, e.clientY);
                }
            });

            rail.appendChild(itemDiv);
        });

        // 2. Add saved connections not in tree
        saved.forEach(s => {
            if (!s || s.type === 'group_marker' || String(s.name || '').startsWith('__group__')) return;
            const key = s.id || (s.name + '::' + s.type);
            if (renderedKeys.has(key)) return;
            renderedKeys.add(key);

            const isPg = String(s.type || '').toLowerCase().includes('postgr');
            const iconImg = isPg ? '/static/icons/postgresql.png' : '/static/icons/sqlserver.png';
            const fallbackIcon = isPg 
                ? 'https://img.icons8.com/color/48/postgreesql.png' 
                : 'https://img.icons8.com/color/48/microsoft-sql-server.png';
            
            const status = getConnectionStatus(s.id, s.name, s.type, false);

            const itemDiv = document.createElement('div');
            itemDiv.className = 'ide-collapsed-conn-item';
            itemDiv.dataset.connKey = key;
            if (s.id) itemDiv.dataset.connId = s.id;
            itemDiv.dataset.connName = s.name;
            itemDiv.dataset.dbType = s.type;
            itemDiv.title = `${s.name} (${status})`;

            const img = document.createElement('img');
            img.src = iconImg;
            img.className = 'ide-collapsed-conn-icon';
            img.onerror = () => { img.onerror = null; img.src = fallbackIcon; };
            img.alt = s.name;

            const badge = document.createElement('span');
            badge.className = `ide-collapsed-conn-badge conn-status-badge status-${status}`;

            itemDiv.appendChild(img);
            itemDiv.appendChild(badge);

            itemDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof window.expandSidebar === 'function') {
                    window.expandSidebar();
                }
            });

            itemDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.ContextMenu) {
                    window.ContextMenu.show('connection', {
                        connName: s.name,
                        dbType: s.type,
                        config: s,
                        isActive: false
                    }, e.clientX, e.clientY);
                }
            });

            rail.appendChild(itemDiv);
        });
    }

    // ── Reconnect Connection ──────────────────────────────────────────────────
    async function reconnectConnection(connId, name, dbType, config) {
        const cleanName = String(name || '').replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim() || name;
        setConnectionStatus(connId, cleanName, dbType, 'reconnecting');
        if (typeof showToast === 'function') {
            showToast(`Đang kết nối lại "${cleanName}"...`, 'info');
        }

        // 1. Resolve full connection profile from saved connections
        let savedProfile = null;
        let savedList = (typeof getSavedConnections === 'function') ? (getSavedConnections() || []) : [];
        if ((!savedList || savedList.length === 0) && window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
            try {
                savedList = await window.AppStorage.getSavedConnections() || [];
            } catch (_) {}
        }
        if (Array.isArray(savedList) && savedList.length > 0) {
            const cleanLower = String(cleanName || '').trim().toLowerCase();
            savedProfile = savedList.find(s => s && (
                (s.name && s.name.trim().toLowerCase() === cleanLower) ||
                (s.server && s.server.trim().toLowerCase() === cleanLower) ||
                (connId && (s.id === connId || s.connection_id === connId))
            ));
        }
        let targetConfig = { ...(savedProfile || {}), ...(config || {}) };
        targetConfig.name = cleanName || targetConfig.name;
        if (dbType) targetConfig.type = dbType;

        // Try getting saved password if missing and not trusted/sqlite
        const isTrusted = targetConfig.trusted_connection === true || targetConfig.trusted_connection === 'true';
        const isSqlite = (dbType || targetConfig.type || '').toLowerCase() === 'sqlite';
        if (!targetConfig.password && !isTrusted && !isSqlite) {
            if (window.AppStorage && typeof window.AppStorage.getConnectionPassword === 'function') {
                try {
                    const pwdRes = await window.AppStorage.getConnectionPassword(targetConfig.id || targetConfig.name || cleanName);
                    const resolvedPwd = (typeof pwdRes === 'string') ? pwdRes : (pwdRes && pwdRes.password ? pwdRes.password : '');
                    if (resolvedPwd) {
                        targetConfig.password = resolvedPwd;
                    }
                } catch (_) {}
            }
        }

        let reconnectSuccess = false;
        let newConnId = connId;

        // Try direct backend session reconnect first if connId exists
        if (connId) {
            try {
                const res = await fetch(`/api/connections/${connId}/reconnect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(targetConfig.password ? { password: targetConfig.password } : {})
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    reconnectSuccess = true;
                    newConnId = data.connection?.connection_id || connId;
                }
            } catch (err) {
                console.warn('[Explorer] Reconnect via session endpoint failed, falling back:', err);
            }
        }

        // Fallback to reconnect() with credential check / password modal
        if (!reconnectSuccess) {
            if (targetConfig) {
                await reconnect(cleanName, dbType || targetConfig.type, targetConfig, async (conn) => {
                    newConnId = conn?.connection_id || connId;
                    reconnectSuccess = true;
                });
            }
        }

        if (reconnectSuccess && newConnId) {
            setConnectionStatus(newConnId, cleanName, dbType, 'connected');
            if (window.AppMetadataCache) {
                if (connId) window.AppMetadataCache.invalidateConnection(connId);
                if (newConnId) window.AppMetadataCache.invalidateConnection(newConnId);
            }
            Object.keys(categoryDataCache).forEach(k => {
                if ((connId && k.startsWith(`${connId}::`)) || (newConnId && k.startsWith(`${newConnId}::`))) {
                    delete categoryDataCache[k];
                }
            });

            if (typeof showToast === 'function') {
                showToast(`✓ Đã kết nối lại thành công "${cleanName}"`, 'success');
            }

            // Update all open tabs that used this connection
            if (window.AppTabs && typeof window.AppTabs.updateTabsConnectionId === 'function') {
                window.AppTabs.updateTabsConnectionId(cleanName, newConnId, connId);
            }

            // Reload active connections and tree
            await loadActiveConnections();
            renderCollapsedRail();

            // Auto-reload/expand the reconnected connection node in the tree so objects load immediately
            setTimeout(() => {
                const allTreeItems = document.querySelectorAll('.tree-item');
                for (const item of allTreeItems) {
                    const nd = item._nodeData || {};
                    const matchesName = (nd.connName === cleanName || nd.name === cleanName || item.dataset.connName === cleanName);
                    if (nd.type === 'connection' && matchesName) {
                        if (typeof item._reload === 'function') {
                            item._reload();
                        } else {
                            item.click();
                        }
                        break;
                    }
                }
            }, 100);

            return true;
        } else if (!reconnectSuccess) {
            setConnectionStatus(connId || newConnId, cleanName, dbType, 'lost');
            if (typeof showToast === 'function') {
                showToast(`Không tìm thấy cấu hình hoặc kết nối lại thất bại cho "${cleanName}".`, 'danger');
            }
            return false;
        }
    }

    // ── Check Connections Health (Ping Heartbeat) ─────────────────────────────
    async function checkConnectionsHealth() {
        try {
            const res = await fetch('/api/connections/ping-all', { method: 'POST' });
            if (!res.ok) return;
            const data = await res.json();
            if (data && data.success && data.statuses) {
                for (const [cId, info] of Object.entries(data.statuses)) {
                    const status = info.is_alive ? 'connected' : 'lost';
                    setConnectionStatus(cId, info.name, null, status);
                }
            }
        } catch (e) {
            console.warn('[Explorer] checkConnectionsHealth error:', e);
        }
    }

    setInterval(checkConnectionsHealth, 35000);
    window.addEventListener('focus', () => {
        checkConnectionsHealth();
    });

    // ── Cache Management & Refresh ─────────────────────────────────────────────
    function clearCategoryCache(connId = null, dbName = null, catType = null) {
        if (!connId) {
            for (const k of Object.keys(categoryDataCache)) delete categoryDataCache[k];
            for (const k of Object.keys(categoryPromiseCache)) delete categoryPromiseCache[k];
        } else {
            for (const k of Object.keys(categoryDataCache)) {
                const parts = k.split('::');
                const [cId, db, schema, type] = parts;
                if (cId === connId && (!dbName || db === dbName) && (!catType || type === catType)) {
                    delete categoryDataCache[k];
                }
            }
            for (const k of Object.keys(categoryPromiseCache)) {
                const parts = k.split('::');
                const [cId, db, schema, type] = parts;
                if (cId === connId && (!dbName || db === dbName) && (!catType || type === catType)) {
                    delete categoryPromiseCache[k];
                }
            }
        }
        if (window.AppMetadataCache) {
            if (connId && dbName) {
                if (typeof window.AppMetadataCache.invalidateDatabase === 'function') {
                    window.AppMetadataCache.invalidateDatabase(connId, dbName);
                }
            } else if (connId) {
                if (typeof window.AppMetadataCache.invalidateConnection === 'function') {
                    window.AppMetadataCache.invalidateConnection(connId);
                }
            } else {
                if (typeof window.AppMetadataCache.clearAll === 'function') {
                    window.AppMetadataCache.clearAll();
                }
            }
        }
    }

    async function refreshNode(nodeData) {
        if (!nodeData) {
            const refreshBtn = document.getElementById('ide-btn-refresh-tree');
            if (refreshBtn) refreshBtn.click();
            return;
        }

        const connId = nodeData.connId || nodeData.connectionId || window.ActiveConnectionId;
        const dbName = nodeData.database || (nodeData.type === 'database' ? nodeData.name : window.ActiveDatabase);
        const schema = nodeData.schema;
        const rawType = nodeData.catType || nodeData.objectType || (nodeData.type && nodeData.type.startsWith('group-') ? nodeData.type.replace('group-', '') : nodeData.type);

        // 1. Invalidate caches
        clearCategoryCache(connId, dbName, rawType);

        // Also notify backend to invalidate cache
        try {
            if (connId) {
                fetch(`/api/metadata/${connId}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ database: dbName, schema: schema, type: rawType })
                }).catch(() => {});
            }
        } catch (_) {}

        // 2. Find target DOM element in tree
        const treeRoot = document.getElementById('ide-tree-root');
        if (!treeRoot) return;

        let targetItem = null;
        if (nodeData instanceof HTMLElement) {
            targetItem = nodeData.closest('.tree-item');
        } else if (nodeData.targetEl instanceof HTMLElement) {
            targetItem = nodeData.targetEl.closest('.tree-item');
        }

        if (!targetItem) {
            const allItems = Array.from(treeRoot.querySelectorAll('.tree-item'));
            // Match group/category
            if (rawType && (rawType === 'tables' || rawType === 'views' || rawType === 'procedures' || rawType === 'functions' || rawType === 'triggers')) {
                targetItem = allItems.find(el => {
                    const d = el._nodeData || {};
                    return (d.connId === connId || el.dataset.connId === connId) &&
                           (!dbName || d.database === dbName || el.dataset.database === dbName) &&
                           (d.catType === rawType || d.objectType === rawType || el.dataset.nodeType === `group-${rawType}`);
                });
            }
            // Match database node
            if (!targetItem && (nodeData.type === 'database' || (!rawType && dbName))) {
                targetItem = allItems.find(el => {
                    const d = el._nodeData || {};
                    return (d.connId === connId || el.dataset.connId === connId) &&
                           (d.name === dbName || d.database === dbName || el.dataset.database === dbName) &&
                           (d.type === 'database' || el.dataset.nodeType === 'database');
                });
            }
            // Match connection node
            if (!targetItem && (nodeData.type === 'connection' || nodeData.type === 'server')) {
                targetItem = allItems.find(el => {
                    const d = el._nodeData || {};
                    return (d.connId === connId || el.dataset.connId === connId) &&
                           (d.type === 'connection' || el.dataset.nodeType === 'connection');
                });
            }
        }

        if (targetItem) {
            if (typeof targetItem._updateBadge === 'function') {
                targetItem._updateBadge(true);
            }
            if (typeof targetItem._reload === 'function') {
                await targetItem._reload(true);
            }
            targetItem.classList.add('tree-node-refreshed');
            setTimeout(() => targetItem.classList.remove('tree-node-refreshed'), 1000);
        } else {
            const refreshBtn = document.getElementById('ide-btn-refresh-tree');
            if (refreshBtn) refreshBtn.click();
        }
    }

    // ── Object Explorer Tree Search / Filter ────────────────────────────────────
    let treeFilterDebounceTimer = null;
    function applyTreeFilter(query) {
        const root = document.getElementById('ide-tree-root');
        if (!root) return;
        const q = (query || '').trim().toLowerCase();
        const clearBtn = document.getElementById('ide-explorer-search-clear');
        if (clearBtn) {
            if (q.length > 0) {
                clearBtn.classList.remove('d-none');
            } else {
                clearBtn.classList.add('d-none');
            }
        }

        const allLis = Array.from(root.querySelectorAll('li'));
        if (!q) {
            allLis.forEach(li => {
                li.classList.remove('tree-node-filtered-out');
                const label = li.querySelector(':scope > .tree-item > .tree-label');
                if (label && label._origText !== undefined) {
                    label.textContent = label._origText;
                    delete label._origText;
                }
            });
            return;
        }

        const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reg = new RegExp(`(${escapeRegExp(q)})`, 'gi');

        // First pass: mark matching labels and highlight text
        allLis.forEach(li => {
            const item = li.querySelector(':scope > .tree-item');
            const label = item ? item.querySelector(':scope > .tree-label') : null;
            if (!label) {
                li.dataset.matched = 'false';
                return;
            }

            if (label._origText === undefined) {
                label._origText = label.textContent;
            }
            const orig = label._origText;
            const matches = orig.toLowerCase().includes(q);

            if (matches) {
                label.innerHTML = orig.replace(reg, '<mark class="tree-search-highlight">$1</mark>');
                li.dataset.matched = 'true';
            } else {
                label.textContent = orig;
                li.dataset.matched = 'false';
            }
        });

        // Second pass: show matching nodes and their ancestors, hide other branches
        allLis.forEach(li => {
            const isSelfMatch = li.dataset.matched === 'true';
            const hasMatchedDescendant = !!li.querySelector('li[data-matched="true"]');
            if (isSelfMatch || hasMatchedDescendant) {
                li.classList.remove('tree-node-filtered-out');
                const childUl = li.querySelector(':scope > ul.tree-children');
                if (hasMatchedDescendant && childUl) {
                    childUl.style.display = 'block';
                    const toggle = li.querySelector(':scope > .tree-item > .tree-toggle');
                    if (toggle) {
                        toggle.classList.replace('fa-caret-right', 'fa-caret-down');
                    }
                }
            } else {
                li.classList.add('tree-node-filtered-out');
            }
        });
    }

    function initExplorerSearch() {
        const searchInput = document.getElementById('ide-explorer-search-input');
        const clearBtn = document.getElementById('ide-explorer-search-clear');
        if (!searchInput || searchInput._searchInitialized) return;
        searchInput._searchInitialized = true;

        searchInput.addEventListener('input', (e) => {
            clearTimeout(treeFilterDebounceTimer);
            const val = e.target.value;
            treeFilterDebounceTimer = setTimeout(() => {
                applyTreeFilter(val);
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                searchInput.value = '';
                applyTreeFilter('');
                searchInput.blur();
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                searchInput.value = '';
                applyTreeFilter('');
                searchInput.focus();
            });
        }
    }

    initExplorerSearch();

    // ── Global Refresh Objects & IntelliSense ──────────────────────────────────
    window.refreshActiveConnectionObjectsAndIntelliSense = async function () {
        // 0. Resolve active connection, database, and schema from active editor tab first, then globals
        const tabState = (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function')
            ? window.AppTabs.getActiveTabState()
            : null;
        const connId = (tabState && tabState.connectionId) || window.ActiveConnectionId || (typeof getActiveConnections === 'function' && getActiveConnections()[0]?.id);
        const dbName = (tabState && tabState.database) || window.ActiveDatabase;
        const schema = (tabState && tabState.schema) || window.ActiveSchema;

        // 1. Invalidate frontend Object Explorer category caches
        clearCategoryCache(connId, dbName);

        // 2. Invalidate Multi-Tier Cache (window.AppMetadataCache)
        if (window.AppMetadataCache) {
            if (dbName && typeof window.AppMetadataCache.invalidateDatabase === 'function') {
                window.AppMetadataCache.invalidateDatabase(connId, dbName);
            } else if (connId && typeof window.AppMetadataCache.invalidateConnection === 'function') {
                window.AppMetadataCache.invalidateConnection(connId);
            } else if (typeof window.AppMetadataCache.invalidateAll === 'function') {
                window.AppMetadataCache.invalidateAll();
            }
        }

        // 3. Invalidate AppIntelliSense and completion caches
        if (window.AppIntelliSense) {
            if (dbName && typeof window.AppIntelliSense.invalidateDatabase === 'function') {
                window.AppIntelliSense.invalidateDatabase(connId, dbName);
            } else if (connId && typeof window.AppIntelliSense.invalidateConnection === 'function') {
                window.AppIntelliSense.invalidateConnection(connId);
            }
            if (window.AppIntelliSense.dataProvider) {
                if (dbName && typeof window.AppIntelliSense.dataProvider.invalidateDatabase === 'function') {
                    window.AppIntelliSense.dataProvider.invalidateDatabase(connId, dbName);
                } else if (connId && typeof window.AppIntelliSense.dataProvider.invalidateConnection === 'function') {
                    window.AppIntelliSense.dataProvider.invalidateConnection(connId);
                }
                if (typeof window.AppIntelliSense.dataProvider.clearCache === 'function') {
                    window.AppIntelliSense.dataProvider.clearCache();
                }
            }
            const ctrl = (typeof window.AppIntelliSense.getController === 'function')
                ? window.AppIntelliSense.getController()
                : null;
            if (ctrl) {
                ctrl.activeCandidates = null;
                ctrl.rawCandidates = null;
                ctrl._lastContextCategory = null;
                if (typeof ctrl.hidePopup === 'function') ctrl.hidePopup();
            }
        }

        if (window.CompletionEngine && typeof window.CompletionEngine.invalidate === 'function') {
            window.CompletionEngine.invalidate(connId, dbName);
        }

        // 4. Invalidate Backend Metadata Cache (direct pywebview native call + fetch fallback)
        if (connId) {
            if (window.pywebview && window.pywebview.api) {
                if (typeof window.pywebview.api.refresh_metadata === 'function') {
                    try {
                        await window.pywebview.api.refresh_metadata(connId, dbName, schema);
                    } catch (_) {}
                } else if (typeof window.pywebview.api.invalidate_metadata_cache === 'function') {
                    try {
                        await window.pywebview.api.invalidate_metadata_cache(connId, dbName, schema, null);
                    } catch (_) {}
                }
            }
            try {
                await fetch(`/api/metadata/${connId}/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ database: dbName, schema: schema })
                });
            } catch (_) {}
        }

        // 5. Pre-warm fresh objects from database so autocomplete responds immediately
        if (connId && window.AppIntelliSense && window.AppIntelliSense.dataProvider) {
            try {
                await window.AppIntelliSense.dataProvider.fetchObjects(connId, dbName, schema);
            } catch (_) {}
        }

        // 6. Refresh Object Explorer tree node (database and category groups)
        await refreshNode({ connId, database: dbName, type: 'database', name: dbName });

        // 7. Toast notification
        if (typeof showToast === 'function') {
            showToast('✓ Đã làm mới danh sách objects và IntelliSense', 'success', 2500);
        }
    };

    const menuRefresh = document.getElementById('ide-menu-refresh-objects-intellisense');
    if (menuRefresh && !menuRefresh._bound) {
        menuRefresh._bound = true;
        menuRefresh.addEventListener('click', (e) => {
            e.preventDefault();
            window.refreshActiveConnectionObjectsAndIntelliSense();
        });
    }

    if (!window._refreshObjectsShortcutBound) {
        window._refreshObjectsShortcutBound = true;
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
                e.preventDefault();
                window.refreshActiveConnectionObjectsAndIntelliSense();
            }
        });
    }

    window.promptReconnectPassword = promptReconnectPassword;
    return {
        addConnectionNode,
        disconnect,
        deleteConnection,
        reconnect,
        reconnectConnection,
        reconnectByIdOrConfig: reconnectConnection,
        checkConnectionsHealth,
        renderCollapsedRail,
        setConnectionStatus,
        getConnectionStatus,
        promptReconnectPassword,
        loadActiveConnections,
        getActiveConnections,
        getSavedConnections,
        saveConnectionProfile,
        createGroup,
        renameGroup,
        deleteGroup,
        refreshNode,
        clearCategoryCache,
        filterTree: applyTreeFilter,
        showDatabaseFilterModal,
        showSchemaChecklistModal,
        getSchemaFilter: (connId, db) => schemaFilters[`${connId}::${db}`]
    };
}
