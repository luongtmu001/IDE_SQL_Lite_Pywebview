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

        // If database is detected but schema not found, default to 'dbo' or 'public'
        if (ctx.database && !ctx.schema) {
            ctx.schema = (ctx.dbType === 'postgresql' ? 'public' : 'dbo');
        }

        // Apply detected context to globals
        if (ctx.connectionId)   window.ActiveConnectionId   = ctx.connectionId;
        if (ctx.connectionName) window.ActiveConnectionName = ctx.connectionName;
        if (ctx.database)       window.ActiveDatabase       = ctx.database;
        if (ctx.schema)         window.ActiveSchema         = ctx.schema;
        if (ctx.dbType)         window.ActiveDbType         = ctx.dbType;

        window.LastFocusedTreeContext = { ...ctx };

        if (window.AppTabs) {
            if (window.AppTabs.setDefaultContext) {
                window.AppTabs.setDefaultContext(ctx);
            }
        }

        document.dispatchEvent(new CustomEvent('ide-context-changed', { detail: ctx }));
        return ctx;
    }

    // ── Delegate contextmenu on explorer (suppress browser menu) ─────────────
    rootUl.addEventListener('contextmenu', e => {
        const item = e.target.closest('.tree-item[data-node-type]');
        if (!item) return;
        e.preventDefault();

        // Selection highlight
        document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');

        const ctx = detectAndApplyTreeContext(item) || {};
        const nd = item._nodeData || {};
        if (window.ContextMenu) window.ContextMenu.show(nd.type || 'database', { ...nd, ...ctx }, e.clientX, e.clientY);
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
            nodeData = {}, rightEl = null
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

        const iconEl = document.createElement('i');
        iconEl.className = `fa-solid fa-${icon} tree-icon`;
        if (iconColor) iconEl.style.color = iconColor;

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
    async function fetchDatabases(containerUl, connId, connName, dbType) {
        const res  = await fetch(`/api/metadata/${connId}/databases`);
        const data = await res.json();
        containerUl.innerHTML = '';

        let items = data.items || [];
        const dbFilter = dbFilters[connId];
        if (dbFilter) {
            if (Array.isArray(dbFilter.selected)) {
                items = items.filter(db => dbFilter.selected.includes(db.name || db));
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

        items.forEach(db => {
            const dbName = db.name || db;
            const filterKey = `${connId}::${dbName}`;

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

            dbNodeCtrl = renderNode(containerUl, {
                name: dbName, type: 'database', icon: 'database', iconColor: 'var(--ide-accent)',
                hasChildren: true,
                loadCallback: ul => fetchSchemas(ul, connId, connName, dbName, dbType),
                nodeData: { connId, connName, database: dbName, dbType },
                rightEl: schemaFilterBtn,
            });
        });
    }

    // ── Fetch schemas ─────────────────────────────────────────────────────────
    async function fetchSchemas(containerUl, connId, connName, dbName, dbType) {
        const res  = await fetch(`/api/metadata/${connId}/schemas?database=${encodeURIComponent(dbName)}`);
        const data = await res.json();
        containerUl.innerHTML = '';

        let schemas = data.items || [];
        const activeFilter = schemaFilters[`${connId}::${dbName}`];
        if (Array.isArray(activeFilter)) {
            schemas = schemas.filter(s => activeFilter.includes(s.name || s));
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

        const categories = [
            { label: 'Tables',     type: 'tables',     icon: 'table',       color: '#6897BB' },
            { label: 'Views',      type: 'views',      icon: 'eye',         color: '#6897BB' },
            { label: 'Procedures', type: 'procedures', icon: 'code',        color: '#CC7832' },
            { label: 'Functions',  type: 'functions',  icon: 'calculator',  color: '#CC7832' },
            { label: 'Triggers',   type: 'triggers',   icon: 'bolt',        color: '#CC7832' },
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

        const iconMap = { tables: 'table', views: 'eye', procedures: 'code', functions: 'calculator', triggers: 'bolt' };
        const typeMap = { tables: 'table', views: 'view', procedures: 'procedure', functions: 'function', triggers: 'trigger' };

        data.items.forEach(obj => {
            const objName = obj.name || obj;
            const mappedType = typeMap[objType] || objType;
            renderNode(containerUl, {
                name: objName, type: mappedType, icon: iconMap[objType] || 'file-code', iconColor: '#c7cfcf',
                hasChildren: true,
                loadCallback: ul => fetchObjectFolders(ul, connId, connName, dbName, schema, mappedType, objName, effectiveDbType),
                nodeData: { connId, connName, database: dbName, schema, type: mappedType, dbType: effectiveDbType },
            });
        });
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
        } else if (objType === 'view') {
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

        data.items.forEach(child => {
            if (childType === 'triggers') {
                renderNode(containerUl, {
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

            renderNode(containerUl, {
                name: label, type: `leaf-${childType}`, icon: icon, iconColor: color,
                hasChildren: false,
                nodeData: { connId, connName, database: dbName, schema: safeSchema, name: child.name, tableName: objName, type: childType, dbType: effectiveDbType }
            });
        });
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

        dbNodeCtrl = renderNode(rootUl, {
            name: `${name} (${typeLabel})`,
            type: 'connection',
            icon: 'server',
            iconColor: isActive ? 'var(--ide-success)' : 'var(--ide-text-dim)',
            hasChildren: isActive,
            loadCallback: isActive ? (ul => fetchDatabases(ul, connId, name, dbType)) : null,
            nodeData: { connId, connName: name, dbType, isActive, config },
            rightEl: rightEl
        });

        if (!isActive && dbNodeCtrl && dbNodeCtrl.item) {
            dbNodeCtrl.item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                reconnect(name, dbType, config);
            });
        }
    }

    // ── Load active connections from server on page load ──────────────────────
    function getSavedConnections() {
        const str = localStorage.getItem("ide_saved_connections");
        return str ? JSON.parse(str) : [];
    }

    function saveConnectionProfile(config) {
        const saved = getSavedConnections();
        const idx = saved.findIndex(c => c.name === config.name && c.type === config.type);
        if (idx >= 0) saved[idx] = config;
        else saved.push(config);
        localStorage.setItem("ide_saved_connections", JSON.stringify(saved));
    }

    function removeConnectionProfile(name, type) {
        const saved = getSavedConnections();
        const filtered = saved.filter(c => !(c.name === name && c.type === type));
        localStorage.setItem("ide_saved_connections", JSON.stringify(filtered));
    }

    async function loadActiveConnections() {
        try {
            const res  = await fetch('/api/connections');
            const data = await res.json();
            
            const activeMap = {};
            if (data.success && data.connections?.length) {
                data.connections.forEach(c => {
                    const dbType = c.type || c.config?.type || 'sqlserver';
                    const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                    activeMap[displayName + '::' + dbType] = c;
                });
            }

            const saved = getSavedConnections();
            
            // Also merge active connections that might not be in saved yet
            Object.values(activeMap).forEach(c => {
                const dbType = c.type || c.config?.type || 'sqlserver';
                const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                if (!saved.find(s => s.name === displayName && s.type === dbType)) {
                    saved.push({ name: displayName, type: dbType, ...c.config });
                }
            });

            rootUl.innerHTML = '';
            
            saved.forEach(c => {
                const activeConn = activeMap[c.name + '::' + c.type];
                if (activeConn) {
                    addConnectionNode(activeConn.connection_id, c.name, c.type, true, c);
                } else {
                    addConnectionNode(null, c.name, c.type, false, c);
                }
            });

        } catch (e) {
            console.error('loadActiveConnections failed', e);
        }
    }

    // ── Disconnect ────────────────────────────────────────────────────────────
    async function disconnect(connId) {
        if (!connId) return;
        try {
            await fetch(`/api/connections/${connId}`, { method: 'DELETE' });
        } catch (_) {}
        loadActiveConnections();
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
                    window.activateConnectionContext(data.connection.connection_id, name, payload.type, payload.database);
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
                        window.activateConnectionContext(data.connection.connection_id, name, dbType, config.database);
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
        loadActiveConnections,
        getSavedConnections,
        saveConnectionProfile,
        refreshNode: () => {},
        showDatabaseFilterModal,
        showSchemaChecklistModal
    };
}
