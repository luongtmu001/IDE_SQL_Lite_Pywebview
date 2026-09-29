// Context Menu — SSMS-like, object-type aware
// Usage: window.ContextMenu.show(type, nodeData, x, y)

(function () {

    // ── Command Registry ──────────────────────────────────────────────────────
    const registry = {
        table: [
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { id: 'edit-data', label: 'Edit Data (Top 200 Rows)', icon: 'fa-pen-to-square' },
            { id: 'select-count', label: 'Select Count(*)', icon: 'fa-hashtag' },
            { separator: true },
            { id: 'new-table', label: 'New Table...', icon: 'fa-plus' },
            { id: 'copy-table', label: 'Copy Table', icon: 'fa-clone' },
            { id: 'design', label: 'Design Table', icon: 'fa-drafting-compass' },
            { separator: true },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'script-drop', label: 'Script as DROP', icon: 'fa-trash', danger: true },
            { separator: true },
            { id: 'indexes', label: 'Indexes', icon: 'fa-arrow-down-a-z', disabled: true },
            { id: 'dependencies', label: 'Dependencies', icon: 'fa-diagram-project', disabled: true },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Table', icon: 'fa-circle-minus', danger: true },
        ],
        'group-tables': [
            { id: 'new-table', label: 'New Table...', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        view: [
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { separator: true },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop View', icon: 'fa-circle-minus', danger: true },
        ],
        materialized_view: [
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { separator: true },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { id: 'refresh-matview', label: 'Refresh Data', icon: 'fa-arrows-rotate' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Materialized View', icon: 'fa-circle-minus', danger: true },
        ],
        procedure: [
            { id: 'execute', label: 'Execute', icon: 'fa-play' },
            { separator: true },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies', icon: 'fa-diagram-project', disabled: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Procedure', icon: 'fa-circle-minus', danger: true },
        ],
        function: [
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Function', icon: 'fa-circle-minus', danger: true },
        ],
        trigger: [
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-alter', label: 'Script as ALTER', icon: 'fa-pen-to-square' },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Trigger', icon: 'fa-circle-minus', danger: true },
        ],
        sequence: [
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-drop', label: 'Script as DROP', icon: 'fa-trash', danger: true },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Sequence', icon: 'fa-circle-minus', danger: true },
        ],
        'group-sequences': [
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        user_type: [
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { id: 'script-create', label: 'Script as CREATE', icon: 'fa-code' },
            { id: 'script-drop', label: 'Script as DROP', icon: 'fa-trash', danger: true },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Type', icon: 'fa-circle-minus', danger: true },
        ],
        'group-user_types': [
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        database: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { id: 'properties', label: 'Properties', icon: 'fa-circle-info', disabled: true },
        ],
        schema: [
            { id: 'new-table', label: 'New Table...', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        sidebar: [
            { id: 'new-connection', label: 'New Connection...', icon: 'fa-plug' },
            { id: 'new-group', label: 'New Group...', icon: 'fa-folder-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        group: [
            { id: 'new-group', label: 'New Group...', icon: 'fa-folder-plus' },
            { id: 'rename-group', label: 'Rename Group...', icon: 'fa-pen' },
            { id: 'delete-group', label: 'Delete Group', icon: 'fa-trash', danger: true },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        connection: [
            // Dynamically built in show() based on isActive state
        ],
    };

    // ── Action handlers ────────────────────────────────────────────────────────
    function handleAction(actionId, nodeData) {
        const { type, name, schema, database, connId, dbType } = nodeData || {};
        const safeSchema = schema || 'dbo';

        switch (actionId) {
            case 'select-top':
                {
                    const sql = dbType === 'postgresql'
                        ? `SELECT *\nFROM "${schema || 'public'}"."${name}"\nLIMIT 1000;`
                        : `SELECT TOP 1000 *\nFROM [${safeSchema}].[${name}];`;
                    openScriptInNewTab(sql, `SelectTop_${name}`, nodeData, true);
                }
                break;
            case 'select-count':
                {
                    const sql = dbType === 'postgresql'
                        ? `SELECT COUNT(*) AS "RowCount"\nFROM "${schema || 'public'}"."${name}";`
                        : `SELECT COUNT(*) AS [RowCount]\nFROM [${safeSchema}].[${name}];`;
                    openScriptInNewTab(sql, `Count_${name}`, nodeData, true);
                }
                break;
            case 'new-query':
                openScriptInNewTab('-- New Query\n', 'Query', nodeData, false);
                break;
            case 'refresh':
                if (window.AppExplorer) window.AppExplorer.refreshNode(nodeData);
                break;
            case 'script-create':
            case 'script-alter':
            case 'view-definition':
                fetchDefinition(nodeData, actionId);
                break;
            case 'script-drop':
                {
                    const dropKeyword = (type === 'user_type' || type === 'user_types') ? 'TYPE' : (type || 'TABLE').toUpperCase();
                    const sql = dbType === 'postgresql'
                        ? `DROP ${dropKeyword} "${schema || 'public'}"."${name}";`
                        : `DROP ${dropKeyword} [${safeSchema}].[${name}];`;
                    openScriptInNewTab(sql, `DROP_${name}`, nodeData, false);
                }
                break;
            case 'execute':
                {
                    const sql = dbType === 'postgresql'
                        ? `CALL "${schema || 'public'}"."${name}"();`
                        : `EXEC [${safeSchema}].[${name}];`;
                    openScriptInNewTab(sql, `EXEC_${name}`, nodeData, false);
                }
                break;
            case 'connect':
                if (nodeData.dbType === 'group_marker' || nodeData.config?.type === 'group_marker' || (nodeData.connName && nodeData.connName.startsWith('__group__'))) {
                    console.warn('[ContextMenu] Cannot connect to a group');
                    break;
                }
                if (window.AppExplorer && nodeData.config) {
                    window.AppExplorer.reconnect(nodeData.connName, nodeData.dbType, nodeData.config);
                }
                break;
            case 'open-profiler':
                const profilerTargetConn = nodeData.connId || nodeData.name || window.LastFocusedTreeContext?.connectionId;
                const profilerTargetType = nodeData.dbType || window.LastFocusedTreeContext?.dbType;
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_profiler_window === 'function') {
                    if (window.AppLoader) window.AppLoader.show('Đang mở SQL Trace Profiler...');
                    window.pywebview.api.open_profiler_window(profilerTargetConn, profilerTargetType);
                    setTimeout(() => { if (window.AppLoader) window.AppLoader.hide(); }, 700);
                }
                break;
            case 'refresh-matview':
                {
                    const sql = `REFRESH MATERIALIZED VIEW "${schema || 'public'}"."${name}";`;
                    openScriptInNewTab(sql, `REFRESH_${name}`, nodeData, true);
                }
                break;
            case 'disconnect':
                if (window.AppExplorer) window.AppExplorer.disconnect(connId || nodeData?.connectionId || nodeData?.id);
                break;
            case 'new-connection': {
                const connBtn = document.getElementById('ide-btn-connect');
                if (connBtn) connBtn.click();
                break;
            }
            case 'new-group': {
                const parentGroup = (nodeData && nodeData.type === 'group') ? nodeData.name : null;
                if (typeof window.showGroupInputModal === 'function') {
                    window.showGroupInputModal({
                        parentGroup: parentGroup,
                        title: parentGroup ? `Tạo nhóm con trong "${parentGroup}"` : 'Tạo nhóm mới',
                        onConfirm: async (groupName) => {
                            const fullGroupPath = parentGroup ? `${parentGroup}/${groupName}` : groupName;
                            if (window.AppExplorer && typeof window.AppExplorer.createGroup === 'function') {
                                await window.AppExplorer.createGroup(fullGroupPath);
                                if (typeof showToast === 'function') {
                                    showToast(`✓ Đã tạo nhóm "${groupName}"`, 'success');
                                }
                            }
                        }
                    });
                } else {
                    const groupName = prompt('Nhập tên nhóm mới:');
                    if (groupName && groupName.trim() && window.AppExplorer) {
                        const fullGroupPath = parentGroup ? `${parentGroup}/${groupName.trim()}` : groupName.trim();
                        window.AppExplorer.createGroup(fullGroupPath);
                    }
                }
                break;
            }
            case 'rename-group': {
                const fullPath = nodeData.name;
                const baseName = nodeData.label || fullPath.split('/').pop();
                const parentGroup = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/')) : null;
                if (typeof window.showGroupInputModal === 'function') {
                    window.showGroupInputModal({
                        title: `Đổi tên nhóm "${baseName}"`,
                        parentGroup: parentGroup,
                        initialValue: baseName,
                        onConfirm: async (newName) => {
                            if (!newName || newName.trim() === baseName) return;
                            const newFullPath = parentGroup ? `${parentGroup}/${newName.trim()}` : newName.trim();
                            if (window.AppExplorer && typeof window.AppExplorer.renameGroup === 'function') {
                                await window.AppExplorer.renameGroup(fullPath, newFullPath);
                            }
                        }
                    });
                }
                break;
            }
            case 'delete-group': {
                if (window.AppExplorer && typeof window.AppExplorer.deleteGroup === 'function') {
                    window.AppExplorer.deleteGroup(nodeData.name);
                }
                break;
            }
            case 'edit-connection':
                if (window.AppConnections && nodeData.config) {
                    window.AppConnections.editConnection(nodeData.config);
                }
                break;
            case 'delete-connection':
                if (confirm(`Are you sure you want to delete connection ${nodeData.connName}?`)) {
                    if (window.AppExplorer) window.AppExplorer.deleteConnection(connId, nodeData.connName, nodeData.dbType);
                }
                break;
            case 'drop':
                confirmDrop(nodeData);
                break;
            case 'edit-data':
                if (window.TableDataEditor) {
                    window.TableDataEditor.openTable(nodeData);
                }
                break;
            case 'design':
                if (window.TableDesigner) {
                    window.TableDesigner.openTable(nodeData);
                }
                break;
            case 'new-table':
                if (window.TableDesigner) {
                    window.TableDesigner.openNewTable(nodeData);
                }
                break;
            case 'copy-table':
                if (window.TableDesigner) {
                    window.TableDesigner.copyTable(nodeData);
                }
                break;
            default:
                console.log('Context action not implemented:', actionId, nodeData);
        }
    }

    function openScriptInNewTab(sql, title, nodeData = {}, autoExecute = false) {
        if (!window.AppTabs) return;
        const tabTitle = (title || 'Query') + (title && !title.endsWith('.sql') ? '.sql' : '');
        window.AppTabs.createTab({
            title: tabTitle,
            content: sql,
            connectionId:   nodeData.connId   || window.ActiveConnectionId,
            connectionName: nodeData.connName || window.ActiveConnectionName,
            database:       nodeData.database || window.ActiveDatabase,
            schema:         nodeData.schema   || window.ActiveSchema,
            dbType:         nodeData.dbType   || window.ActiveDbType,
            nodeType:       nodeData.type     || null,
            config:         nodeData.config   || null
        });

        if (autoExecute && window.AppQuery) {
            setTimeout(() => {
                window.AppQuery.executeQuery();
            }, 150);
        }
    }

    async function fetchDefinition(nodeData, mode) {
        const { connId, database, schema, name, type, tableName, dbType } = nodeData;
        if (!connId) return;

        let titlePrefix = 'CREATE_';
        if (mode === 'script-alter') titlePrefix = 'ALTER_';
        if (mode === 'view-definition') titlePrefix = 'DEF_';

        try {
            const res = await fetch(`/api/metadata/${connId}/definition?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name || '')}&type=${encodeURIComponent(type || '')}`);
            const data = await res.json();
            if (data.definition) {
                let sql = data.definition;
                if (mode === 'script-alter') {
                    const isPg = (dbType === 'postgresql' || window.ActiveDbType === 'postgresql');
                    if (type === 'trigger') {
                        if (/^\s*CREATE\s+TRIGGER\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\s+TRIGGER\b/im, 'ALTER TRIGGER');
                        } else if (/^\s*CREATE\s+OR\s+REPLACE\s+TRIGGER\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\s+OR\s+REPLACE\s+TRIGGER\b/im, 'ALTER TRIGGER');
                        } else if (isPg) {
                            sql = `-- In PostgreSQL, triggers are altered by modifying the trigger function or DROP/CREATE:\n${sql}`;
                        }
                    } else if (isPg) {
                        // In PostgreSQL: views, functions, and procedures use CREATE OR REPLACE
                        if (type === 'materialized_view' || type === 'materialized_views') {
                            sql = `-- To alter a materialized view definition in PostgreSQL, DROP and recreate:\nDROP MATERIALIZED VIEW IF EXISTS "${schema || 'public'}"."${name}";\n\n${sql}`;
                        }
                    } else {
                        // SQL Server / others
                        if (/^\s*CREATE\s+OR\s+REPLACE\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\s+OR\s+REPLACE\b/im, 'CREATE OR ALTER');
                        } else if (/^\s*CREATE\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\b/im, 'ALTER');
                        }
                    }
                }
                openScriptInNewTab(sql, `${titlePrefix}${name}`, nodeData, false);
                return;
            }
        } catch (e) {
            console.error('fetchDefinition error', e);
        }

        if (type === 'trigger') {
            openScriptInNewTab(`-- Definition for trigger [${schema}].[${name}]\n-- Could not be retrieved automatically.`, `${titlePrefix}${name}`, nodeData, false);
            return;
        }

        // Fallback for tables or objects without DDL in sys.sql_modules
        try {
            const childRes = await fetch(`/api/metadata/${connId}/object_children?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name || '')}&type=${encodeURIComponent(type || '')}&child_type=columns`);
            const childData = await childRes.json();
            if (childData.items?.length) {
                const cols = childData.items.map(c => {
                    let len = c.length === null ? '' : (c.length > 0 ? `(${c.length})` : '(max)');
                    return `    [${c.name}] ${c.type.toUpperCase()}${len} ${c.nullable ? 'NULL' : 'NOT NULL'}`;
                }).join(',\n');
                const ddl = `CREATE TABLE [${schema || 'dbo'}].[${name}] (\n${cols}\n);`;
                openScriptInNewTab(ddl, `${titlePrefix}${name}`, nodeData, false);
                return;
            }
        } catch (_) {}

        openScriptInNewTab(`-- Definition for [${schema || 'dbo'}].[${name}]\n-- Could not be retrieved automatically.`, `${titlePrefix}${name}`, nodeData, false);
    }

    function confirmDrop(nodeData) {
        const { type, name, schema, tableName, dbType } = nodeData;
        if (!confirm(`Are you sure you want to DROP ${type} [${schema}].[${name}]?\n\nThis action cannot be undone.`)) return;
        const dropKeyword = (type === 'user_type' || type === 'user_types') ? 'TYPE' : (type || 'TABLE').toUpperCase();
        let sql;
        if (type === 'trigger') {
            if (dbType === 'postgresql') {
                sql = `DROP TRIGGER "${name}" ON "${schema || 'public'}"."${tableName || 'table'}";`;
            } else {
                sql = `DROP TRIGGER [${schema || 'dbo'}].[${name}];`;
            }
        } else {
            sql = dbType === 'postgresql'
                ? `DROP ${dropKeyword} "${schema || 'public'}"."${name}";`
                : `DROP ${dropKeyword} [${schema || 'dbo'}].[${name}];`;
        }
        openScriptInNewTab(sql, `DROP_${name}`, nodeData, true);
    }

    // ── Menu rendering ────────────────────────────────────────────────────────
    let menuEl = null;
    let currentItems = [];
    let focusedIdx = -1;

    function show(type, nodeData, x, y) {
        hide();

        if (type === 'connection') {
            if (nodeData?.dbType === 'group_marker' || nodeData?.config?.type === 'group_marker' || (nodeData?.name && nodeData.name.startsWith('__group__')) || (nodeData?.connName && nodeData.connName.startsWith('__group__'))) {
                type = 'group';
            }
        }

        let items;
        if (type === 'connection') {
            // Build connection menu dynamically based on active state
            if (nodeData.isActive) {
                items = [
                    { id: 'disconnect', label: 'Disconnect', icon: 'fa-plug-circle-xmark' },
                    { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
                    { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
                    { id: 'open-profiler', label: 'SQL Trace Profiler...', icon: 'fa-bolt text-warning' },
                    { separator: true },
                    { id: 'new-group', label: 'New Group...', icon: 'fa-folder-plus' },
                    { separator: true },
                    { id: 'edit-connection', label: 'Edit Connection', icon: 'fa-pen' },
                    { id: 'delete-connection', label: 'Delete Connection', icon: 'fa-trash', danger: true },
                ];
            } else {
                items = [
                    { id: 'connect', label: 'Connect', icon: 'fa-plug' },
                    { id: 'open-profiler', label: 'SQL Trace Profiler...', icon: 'fa-bolt text-warning' },
                    { separator: true },
                    { id: 'new-group', label: 'New Group...', icon: 'fa-folder-plus' },
                    { separator: true },
                    { id: 'edit-connection', label: 'Edit Connection', icon: 'fa-pen' },
                    { id: 'delete-connection', label: 'Delete Connection', icon: 'fa-trash', danger: true },
                ];
            }
        } else {
            items = registry[type] || registry['database'];
        }
        currentItems = items.filter(i => !i.separator);

        menuEl = document.createElement('div');
        menuEl.className = 'ide-context-menu';
        menuEl.setAttribute('role', 'menu');
        menuEl.setAttribute('tabindex', '-1');

        // Header
        const header = document.createElement('div');
        header.className = 'ide-ctx-header';
        header.textContent = nodeData?.name || type;
        menuEl.appendChild(header);

        const sep0 = document.createElement('div');
        sep0.className = 'ide-ctx-separator';
        menuEl.appendChild(sep0);

        focusedIdx = -1;
        const buttons = [];

        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'ide-ctx-separator';
                menuEl.appendChild(sep);
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'ide-ctx-item' + (item.danger ? ' danger' : '') + (item.disabled ? ' disabled' : '');
            btn.setAttribute('role', 'menuitem');
            if (item.disabled) btn.disabled = true;
            btn.innerHTML = `
                <i class="fa-solid ${item.icon || 'fa-circle'} ide-ctx-icon"></i>
                <span class="ide-ctx-label">${item.label}</span>
                ${item.shortcut ? `<span class="ide-ctx-shortcut">${item.shortcut}</span>` : ''}
            `;
            btn.addEventListener('click', () => {
                hide();
                handleAction(item.id, nodeData);
            });
            menuEl.appendChild(btn);
            buttons.push(btn);
        });

        // Position calculation (viewport-aware)
        document.body.appendChild(menuEl);
        const mw = menuEl.offsetWidth;
        const mh = menuEl.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        menuEl.style.left = Math.min(x, vw - mw - 8) + 'px';
        menuEl.style.top  = Math.min(y, vh - mh - 8) + 'px';
        menuEl.focus();

        // Keyboard navigation
        menuEl.addEventListener('keydown', e => {
            if (e.key === 'Escape') { hide(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                moveFocus(buttons, 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                moveFocus(buttons, -1);
            } else if (e.key === 'Enter' && focusedIdx >= 0) {
                buttons[focusedIdx]?.click();
            }
        });
    }

    function moveFocus(buttons, dir) {
        buttons.forEach(b => b.classList.remove('focused'));
        focusedIdx = (focusedIdx + dir + buttons.length) % buttons.length;
        buttons[focusedIdx]?.classList.add('focused');
        buttons[focusedIdx]?.scrollIntoView({ block: 'nearest' });
    }

    function hide() {
        if (menuEl) { menuEl.remove(); menuEl = null; }
        focusedIdx = -1;
    }

    // Close on click outside or Esc
    document.addEventListener('click', e => {
        if (menuEl && !menuEl.contains(e.target)) hide();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });

    window.ContextMenu = { show, hide };
})();
