// Object Explorer — lazy loading, schema filters, context menu, filter modal

function initExplorer() {
    const rootUl    = document.getElementById('ide-tree-root');
    const refreshBtn = document.getElementById('ide-btn-refresh-tree');

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

    function escapeHtml(str) {
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
        const currentTabConnId = activeTabState?.connectionId || window.ActiveConnectionId;
        const currentTabConnName = activeTabState?.connectionName || window.ActiveConnectionName;

        const tabHasNoConnection = !currentTabConnId && !currentTabConnName;
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

    // ── Render a tree node ────────────────────────────────────────────────────
    function renderNode(container, opts) {
        const {
            name, type, icon, iconColor,
            hasChildren, loadCallback,
            nodeData = {}, rightEl = null,
            iconImg = null, iconFallback = null, iconClass = ''
        } = opts;

        const li   = document.createElement('li');
        const item = document.createElement('div');
        item.className = 'tree-item';
        item._nodeData = { ...nodeData, name, type };

        // Transfer data attrs for context menu
        if (nodeData.connId)   item.dataset.connId   = nodeData.connId;
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

        if (rightEl) {
            rightEl.addEventListener('click', e => e.stopPropagation());
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
                    childUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size: 11px;"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading…</div></li>';
                    try {
                        await loadCallback(childUl);
                        loaded = true;
                    } catch (err) {
                        childUl.innerHTML = `<li><div class="tree-item" style="color: var(--ide-danger); font-size: 11px;">Error: ${err.message}</div></li>`;
                    }
                }
            } else {
                childUl.style.display = 'none';
                toggle.classList.replace('fa-caret-down', 'fa-caret-right');
            }
        });

        container.appendChild(li);

        return {
            item,
            reload: async () => {
                loaded = false;
                if (childUl) { childUl.innerHTML = ''; childUl.style.display = 'none'; }
                toggle.classList.replace('fa-caret-down', 'fa-caret-right');
                item.click();
            }
        };
    }

    // ── Fetch databases ───────────────────────────────────────────────────────
    async function fetchDatabases(containerUl, connId, connName, dbType, config = null) {
        const res  = await fetch(`/api/metadata/${connId}/databases`);
        const data = await res.json();
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
            return;
        }

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

            // Schema filter checklist button
            const schemaFilterBtn = document.createElement('button');
            schemaFilterBtn.className = 'tree-filter-btn ide-schema-filter-btn';
            schemaFilterBtn.title = 'Filter Schemas';
            schemaFilterBtn.setAttribute('aria-label', 'Filter Schemas');
            schemaFilterBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';

            const isSchemaFiltered = Array.isArray(schemaFilters[filterKey]);
            if (isSchemaFiltered) {
                schemaFilterBtn.classList.add('filter-active');
                schemaFilterBtn.title = `Filter Schemas (${schemaFilters[filterKey].length} selected)`;
            }

            let dbNodeCtrl = null;

            schemaFilterBtn.addEventListener('click', e => {
                e.stopPropagation();
                showSchemaChecklistModal({
                    connId,
                    dbName,
                    filterKey,
                    onApply: () => {
                        if (dbNodeCtrl) dbNodeCtrl.reload();
                    }
                });
            });

            const dbDefaultSchema = (Array.isArray(schemaFilters[filterKey]) && schemaFilters[filterKey].length > 0)
                ? schemaFilters[filterKey][0]
                : (connDefaultSchema || null);
            dbNodeCtrl = renderNode(containerUl, {
                name: dbName, type: 'database', icon: 'database', iconColor: 'var(--ide-accent)',
                hasChildren: true,
                loadCallback: ul => fetchSchemas(ul, connId, connName, dbName, dbType, connDefaultSchema),
                nodeData: { connId, connName, database: dbName, schema: dbDefaultSchema, dbType },
                rightEl: schemaFilterBtn,
            });
        });
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
            renderNode(containerUl, {
                name: schemaName, type: 'schema', icon: 'folder', iconColor: '#E8C859',
                hasChildren: true,
                loadCallback: ul => fetchCategories(ul, connId, connName, dbName, schemaName, dbType),
                nodeData: { connId, connName, database: dbName, schema: schemaName, dbType },
            });
        });
    }

    // ── Fetch categories (Tables, Views, etc.) ────────────────────────────────
    async function fetchCategories(containerUl, connId, connName, dbName, schemaName, dbType) {
        containerUl.innerHTML = '';

        const isPg = (dbType || window.ActiveDbType || '').toLowerCase().includes('postgr');
        const categories = [
            { label: 'Tables',             type: 'tables',             icon: 'table',           color: '#6897BB' },
            { label: 'Views',              type: 'views',              icon: 'eye',             color: '#6897BB' },
            ...(isPg ? [{ label: 'Materialized Views', type: 'materialized_views', icon: 'layer-group', color: '#6897BB' }] : []),
            { label: 'Procedures',         type: 'procedures',         icon: 'code',            color: '#CC7832' },
            { label: 'Functions',          type: 'functions',          icon: 'calculator',      color: '#CC7832' },
            { label: 'Triggers',           type: 'triggers',           icon: 'bolt',            color: '#CC7832' },
            { label: 'Sequences',          type: 'sequences',          icon: 'arrow-down-1-9',  color: '#8892b0' },
            { label: 'User Defined Types', type: 'user_types',         icon: 'cube',            color: '#98c379' },
        ];

        categories.forEach(cat => {
            const fk = `${connId}::${dbName}::${cat.type}`;

            // Filter button
            const filterBtn = document.createElement('button');
            filterBtn.className = 'tree-filter-btn';
            filterBtn.title = `Filter ${cat.label}`;
            filterBtn.setAttribute('aria-label', `Filter ${cat.label}`);
            filterBtn.innerHTML = '<i class="fa-solid fa-filter"></i>';

            const hasActiveFilter = () => !!(filterState[fk]?.search);
            if (hasActiveFilter()) filterBtn.classList.add('filter-active');

            filterBtn.addEventListener('click', e => {
                e.stopPropagation();
                showFilterModal({
                    title: `Filter ${cat.label}`,
                    filterKey: fk,
                    connId, dbName, schemaName,
                    objectType: cat.type,
                    onApply: () => { catNodeCtrl.reload(); }
                });
            });

            let catNodeCtrl;
            catNodeCtrl = renderNode(containerUl, {
                name: cat.label, type: `group-${cat.type}`, icon: cat.icon, iconColor: cat.color,
                hasChildren: true,
                loadCallback: ul => fetchObjects(ul, connId, connName, dbName, schemaName, cat.type, dbType),
                nodeData: { connId, connName, database: dbName, schema: schemaName, dbType },
                rightEl: filterBtn,
            });
        });
    }

    // ── Fetch objects ─────────────────────────────────────────────────────────
    async function fetchObjects(containerUl, connId, connName, dbName, schema, objType, dbType) {
        const effectiveDbType = dbType || window.ActiveDbType;
        const fk = `${connId}::${dbName}::${objType}`;
        const filter = filterState[fk];

        const params = new URLSearchParams({ database: dbName, schema: schema || 'dbo', type: objType });
        if (filter?.search) params.set('search', filter.search);

        const res  = await fetch(`/api/metadata/${connId}/objects?${params}`);
        const data = await res.json();
        containerUl.innerHTML = '';

        if (!data.items?.length) {
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
            user_types: 'user_type'
        };

        const fragment = document.createDocumentFragment();
        data.items.forEach(obj => {
            const objName = obj.name || obj;
            const mappedType = typeMap[objType] || objType;
            const isLeaf = objType === 'sequences' || objType === 'user_types';
            renderNode(fragment, {
                name: objName, 
                type: mappedType, 
                icon: iconMap[objType] || 'file-code', 
                iconColor: objType === 'sequences' ? '#8892b0' : (objType === 'user_types' ? '#98c379' : '#c7cfcf'),
                hasChildren: !isLeaf,
                loadCallback: isLeaf ? null : (ul => fetchObjectFolders(ul, connId, connName, dbName, schema, mappedType, objName, effectiveDbType)),
                nodeData: { connId, connName, database: dbName, schema, type: mappedType, dbType: effectiveDbType },
            });
        });
        containerUl.appendChild(fragment);
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
                nodeData: { connId, connName, database: dbName, schema, dbType: effectiveDbType }
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
            containerUl.innerHTML = `<li><div class="tree-item" style="color:var(--ide-danger);font-size:11px;">Error: ${data.error || 'Unknown error'}</div></li>`;
            return;
        }

        if (!data.items?.length) {
            containerUl.innerHTML = '<li><div class="tree-item text-muted" style="font-size:11px;">(Empty)</div></li>';
            return;
        }

        const fragment = document.createDocumentFragment();
        data.items.forEach(child => {
            if (childType === 'triggers') {
                renderNode(fragment, {
                    name: child.name,
                    type: 'trigger',
                    icon: 'bolt',
                    iconColor: '#CC7832',
                    hasChildren: false,
                    nodeData: {
                        connId,
                        connName,
                        database: dbName,
                        schema: safeSchema,
                        name: child.name,
                        tableName: objName,
                        type: 'trigger',
                        dbType: effectiveDbType
                    }
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
                nodeData: { connId, connName, database: dbName, schema: safeSchema, name: child.name, tableName: objName, type: childType, dbType: effectiveDbType }
            });
        });
        containerUl.appendChild(fragment);
    }

    // ── Filter modal ──────────────────────────────────────────────────────────
    function showFilterModal({ title, filterKey, onApply }) {
        const current = filterState[filterKey] || {};

        // Remove old if any
        document.getElementById('ide-filter-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'ide-filter-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header py-2">
                        <h6 class="modal-title" style="font-size:13px;">${title}</h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body py-2">
                        <label class="form-label" style="font-size:11px; color: var(--ide-text-muted);">Name contains</label>
                        <input type="text" id="ide-filter-search" class="form-control form-control-sm" placeholder="e.g. customer" value="${current.search || ''}">
                    </div>
                    <div class="modal-footer py-1 d-flex justify-content-between">
                        <button class="btn btn-sm btn-link text-danger px-0" id="ide-filter-reset">Reset</button>
                        <div class="d-flex gap-1">
                            <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button class="btn btn-sm btn-primary" id="ide-filter-apply">Apply</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        modal.querySelector('#ide-filter-apply').addEventListener('click', () => {
            const search = modal.querySelector('#ide-filter-search').value.trim();
            filterState[filterKey] = { search };
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
        setTimeout(() => modal.querySelector('#ide-filter-search')?.focus(), 300);
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
        
        const rightEl = document.createElement('div');
        rightEl.className = 'tree-actions d-flex align-items-center gap-2';
        
        if (isActive) {
            rightEl.innerHTML = `
                <i class="fa-solid fa-circle" style="color: var(--ide-success); font-size: 8px;" title="Connected"></i>
                <button class="tree-filter-btn ide-conn-filter" title="Filter Databases" aria-label="Filter Databases">
                    <i class="fa-solid fa-filter"></i>
                </button>
                <i class="fa-solid fa-rotate-right tree-icon text-muted ide-conn-refresh" title="Refresh"></i>
                <i class="fa-solid fa-plug-circle-xmark tree-icon text-warning ide-conn-disconnect" title="Disconnect"></i>
            `;
        } else {
            rightEl.innerHTML = `
                <i class="fa-solid fa-circle" style="color: var(--ide-text-dim); font-size: 8px;" title="Disconnected"></i>
                <i class="fa-solid fa-plug tree-icon text-success ide-conn-connect" title="Connect"></i>
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
            }

            btnFilter.addEventListener('click', (e) => {
                e.stopPropagation();
                showDatabaseFilterModal({
                    connId,
                    connName: name,
                    onApply: () => {
                        if (dbNodeCtrl) dbNodeCtrl.reload();
                    }
                });
            });
        }
        
        const btnRefresh = rightEl.querySelector('.ide-conn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', (e) => {
                e.stopPropagation();
                if (dbNodeCtrl) dbNodeCtrl.reload();
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
                reconnect(name, dbType, config);
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
            loadCallback: isActive ? (ul => fetchDatabases(ul, connId, name, dbType, config)) : null,
            nodeData: { connId, connName: name, dbType, isActive, database: config ? config.database : null, schema: config ? config.schema : null, config },
            rightEl: rightEl
        });

        if (!isActive && dbNodeCtrl && dbNodeCtrl.item) {
            dbNodeCtrl.item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                reconnect(name, dbType, config);
            });
        }
        return dbNodeCtrl;
    }

    // ── Load active connections from server on page load ──────────────────────
    let _cachedSavedConnections = [];

    function getSavedConnections() {
        return _cachedSavedConnections;
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

        item.append(toggle, iconEl, label);
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
        const ctrl = addConnectionNodeToUl(targetUl, connId, c.name, c.type, isActive, c);
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
                        data.connections.forEach(c => {
                            if (!c) return;
                            const dbType = c.type || c.config?.type || 'sqlserver';
                            const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                            activeMap[displayName + '::' + dbType] = c;
                        });
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
                if (typeof onConnected === 'function') {
                    onConnected(data.connection, payload);
                } else if (typeof window.activateConnectionContext === 'function') {
                    window.activateConnectionContext(data.connection.connection_id, name, payload.type, payload.database, payload.schema);
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
                    if (typeof onConnected === 'function') {
                        onConnected(data.connection, config);
                    } else if (typeof window.activateConnectionContext === 'function') {
                        window.activateConnectionContext(data.connection.connection_id, name, dbType, config.database, config.schema);
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

        // Windows Auth or SQLite -> Connect immediately
        if (isTrusted || isSqlite) {
            await doConnect(name, config, onConnected);
            return;
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
        refreshBtn.addEventListener('click', () => {
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

    return {
        addConnectionNode,
        disconnect,
        deleteConnection,
        reconnect,
        promptReconnectPassword,
        loadActiveConnections,
        getSavedConnections,
        saveConnectionProfile,
        createGroup,
        renameGroup,
        deleteGroup,
        refreshNode: () => {},
        showDatabaseFilterModal,
        showSchemaChecklistModal,
        getSchemaFilter: (connId, db) => schemaFilters[`${connId}::${db}`]
    };
}
window.promptReconnectPassword = promptReconnectPassword;
