// Context Menu — SSMS-like, object-type aware
// Usage: window.ContextMenu.show(type, nodeData, x, y)

(function () {

    // ── SSMS Script As Submenu Builder ──────────────────────────────────────
    function makeScriptAsSubmenu(label, type) {
        const isTable = (type === 'table');
        const isView = (type === 'view' || type === 'materialized_view');
        const isRoutine = (type === 'procedure' || type === 'function');
        const isTrigger = (type === 'trigger');

        const actions = [];
        // CREATE
        actions.push({
            id: 'create-sub',
            label: 'CREATE To',
            icon: 'fa-file-circle-plus',
            submenu: [
                { id: 'script-as:CREATE:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                { id: 'script-as:CREATE:clip', label: 'Clipboard', icon: 'fa-copy' }
            ]
        });

        // ALTER (for view, routine, trigger, table)
        actions.push({
            id: 'alter-sub',
            label: 'ALTER To',
            icon: 'fa-pen-to-square',
            submenu: [
                { id: 'script-as:ALTER:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                { id: 'script-as:ALTER:clip', label: 'Clipboard', icon: 'fa-copy' }
            ]
        });

        // DROP
        actions.push({
            id: 'drop-sub',
            label: 'DROP To',
            icon: 'fa-trash',
            danger: true,
            submenu: [
                { id: 'script-as:DROP:tab', label: 'New Query Editor Window', icon: 'fa-file-lines', danger: true },
                { id: 'script-as:DROP:clip', label: 'Clipboard', icon: 'fa-copy', danger: true }
            ]
        });

        // DROP and CREATE
        actions.push({
            id: 'dropcreate-sub',
            label: 'DROP And CREATE To',
            icon: 'fa-rotate-left',
            submenu: [
                { id: 'script-as:DROP_AND_CREATE:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                { id: 'script-as:DROP_AND_CREATE:clip', label: 'Clipboard', icon: 'fa-copy' }
            ]
        });

        // SELECT (for table, view)
        if (isTable || isView) {
            actions.push({ separator: true });
            actions.push({
                id: 'select-sub',
                label: 'SELECT To',
                icon: 'fa-table-list',
                submenu: [
                    { id: 'script-as:SELECT:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                    { id: 'script-as:SELECT:clip', label: 'Clipboard', icon: 'fa-copy' }
                ]
            });
        }

        // INSERT, UPDATE, DELETE (for table)
        if (isTable) {
            actions.push({
                id: 'insert-sub',
                label: 'INSERT To',
                icon: 'fa-circle-plus',
                submenu: [
                    { id: 'script-as:INSERT:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                    { id: 'script-as:INSERT:clip', label: 'Clipboard', icon: 'fa-copy' }
                ]
            });
            actions.push({
                id: 'update-sub',
                label: 'UPDATE To',
                icon: 'fa-pen-nib',
                submenu: [
                    { id: 'script-as:UPDATE:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                    { id: 'script-as:UPDATE:clip', label: 'Clipboard', icon: 'fa-copy' }
                ]
            });
            actions.push({
                id: 'delete-sub',
                label: 'DELETE To',
                icon: 'fa-eraser',
                submenu: [
                    { id: 'script-as:DELETE:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                    { id: 'script-as:DELETE:clip', label: 'Clipboard', icon: 'fa-copy' }
                ]
            });
        }

        // EXECUTE (for routine)
        if (isRoutine) {
            actions.push({ separator: true });
            actions.push({
                id: 'exec-sub',
                label: 'EXECUTE To',
                icon: 'fa-play',
                submenu: [
                    { id: 'script-as:EXECUTE:tab', label: 'New Query Editor Window', icon: 'fa-file-lines' },
                    { id: 'script-as:EXECUTE:clip', label: 'Clipboard', icon: 'fa-copy' }
                ]
            });
        }

        return {
            id: `script-${type}-as`,
            label: label || `Script ${type} as`,
            icon: 'fa-code',
            submenu: actions
        };
    }

    // ── Command Registry ──────────────────────────────────────────────────────
    const registry = {
        table: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { id: 'edit-data', label: 'Edit Data (Top 200 Rows)', icon: 'fa-pen-to-square' },
            { id: 'select-count', label: 'Select Count(*)', icon: 'fa-hashtag' },
            { separator: true },
            { id: 'new-table', label: 'New Table...', icon: 'fa-plus' },
            { id: 'copy-table', label: 'Copy Table', icon: 'fa-clone' },
            { id: 'design', label: 'Design Table', icon: 'fa-drafting-compass' },
            { separator: true },
            makeScriptAsSubmenu('Script Table as', 'table'),
            { separator: true },
            { id: 'indexes', label: 'Indexes', icon: 'fa-arrow-down-a-z', disabled: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Table', icon: 'fa-circle-minus', danger: true },
        ],
        'group-tables': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'new-table', label: 'New Table...', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        view: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { separator: true },
            { id: 'design-view', label: 'Design View (Trực quan hóa SQL)', icon: 'fa-diagram-project' },
            { separator: true },
            makeScriptAsSubmenu('Script View as', 'view'),
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop View', icon: 'fa-circle-minus', danger: true },
        ],
        'group-views': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        materialized_view: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'select-top', label: 'Select Top 1000', icon: 'fa-table-list' },
            { separator: true },
            { id: 'design-view', label: 'Design View (Trực quan hóa SQL)', icon: 'fa-diagram-project' },
            { separator: true },
            makeScriptAsSubmenu('Script Materialized View as', 'materialized_view'),
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { id: 'refresh-matview', label: 'Refresh Data', icon: 'fa-arrows-rotate' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Materialized View', icon: 'fa-circle-minus', danger: true },
        ],
        'group-materialized_views': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        procedure: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'execute', label: 'Execute', icon: 'fa-play' },
            { separator: true },
            makeScriptAsSubmenu('Script Stored Procedure as', 'procedure'),
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Procedure', icon: 'fa-circle-minus', danger: true },
        ],
        'group-procedures': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        function: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            makeScriptAsSubmenu('Script Function as', 'function'),
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Function', icon: 'fa-circle-minus', danger: true },
        ],
        'group-functions': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        column: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'copy-name', label: 'Copy Column Name', icon: 'fa-copy' },
        ],
        columns: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'copy-name', label: 'Copy Column Name', icon: 'fa-copy' },
        ],
        'leaf-columns': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'dependencies', label: 'Dependencies (Phụ thuộc)', icon: 'fa-diagram-project' },
            { separator: true },
            { id: 'copy-name', label: 'Copy Column Name', icon: 'fa-copy' },
        ],
        trigger: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            makeScriptAsSubmenu('Script Trigger as', 'trigger'),
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Trigger', icon: 'fa-circle-minus', danger: true },
        ],
        'group-triggers': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        sequence: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            makeScriptAsSubmenu('Script Sequence as', 'sequence'),
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Sequence', icon: 'fa-circle-minus', danger: true },
        ],
        'group-sequences': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        synonym: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            makeScriptAsSubmenu('Script Synonym as', 'synonym'), // script-create, script-drop
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Synonym', icon: 'fa-circle-minus', danger: true },
        ],
        'group-synonyms': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        user_type: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'view-definition', label: 'View Definition', icon: 'fa-eye' },
            makeScriptAsSubmenu('Script Type as', 'user_type'),
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'drop', label: 'Drop Type', icon: 'fa-circle-minus', danger: true },
        ],
        'group-user_types': [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        database: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { id: 'open-schema-compare', label: 'So sánh Schema...', icon: 'fa-code-compare text-success' },
            { id: 'object-search', label: 'Search Object Content...', icon: 'fa-magnifying-glass' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { id: 'properties', label: 'Properties', icon: 'fa-circle-info', disabled: true },
        ],
        schema: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { id: 'open-schema-compare', label: 'So sánh Schema...', icon: 'fa-code-compare text-success' },
            { separator: true },
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
        linked_server: [
            { id: 'test-linked-server', label: 'Test Connection', icon: 'fa-plug' },
            { separator: true },
            {
                id: 'script-linked-server',
                label: 'Script Linked Server as',
                icon: 'fa-code',
                submenu: [
                    { id: 'script-ls-create', label: 'CREATE To', icon: 'fa-file-lines' },
                    { id: 'script-ls-drop', label: 'DROP To', icon: 'fa-trash', danger: true },
                    { id: 'script-ls-drop-create', label: 'DROP And CREATE To', icon: 'fa-pen-to-square' },
                ]
            },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
            { separator: true },
            { id: 'delete-linked-server', label: 'Delete', icon: 'fa-trash', danger: true },
        ],
        linked_servers_group: [
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
        remote_database: [
            { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
            { separator: true },
            { id: 'refresh', label: 'Refresh', icon: 'fa-rotate-right' },
        ],
    };

    // ── Unified Script As Handler ─────────────────────────────────────────────
    async function handleScriptAs(nodeData, action, dest = 'tab') {
        const connId   = nodeData?.connId   || nodeData?.connectionId || window.ActiveConnectionId;
        const connName = nodeData?.connName || nodeData?.connectionName || window.ActiveConnectionName;
        const database = nodeData?.database || window.ActiveDatabase;
        const schema   = nodeData?.schema   || window.ActiveSchema || 'dbo';
        const name     = nodeData?.name;
        const type     = nodeData?.type     || 'table';
        const dbType   = nodeData?.dbType   || window.ActiveDbType;

        if (!connId || !name) return;

        if (window.AppLoader) window.AppLoader.show(`Đang tạo script ${action} [${name}]...`);
        try {
            let data = null;
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.script_object === 'function') {
                data = await window.pywebview.api.script_object(connId, database, schema, name, type, action);
            } else {
                const url = `/api/metadata/${connId}/script?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name || '')}&type=${encodeURIComponent(type || '')}&action=${encodeURIComponent(action || 'CREATE')}&_t=${Date.now()}`;
                const res = await fetch(url, { cache: 'no-store' });
                data = await res.json();
            }
            if (window.AppLoader) window.AppLoader.hide();

            if (data && data.success && data.script) {
                const sql = data.script;
                if (dest === 'clip') {
                    if (typeof window.copyText === 'function') {
                        window.copyText(sql);
                    } else if (typeof copyText === 'function') {
                        copyText(sql);
                    } else if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(sql);
                    }
                    if (typeof showToast === 'function') {
                        showToast(`✓ Đã sao chép script ${action} [${name}] vào Clipboard`, 'success');
                    } else {
                        alert(`Đã sao chép script vào Clipboard.`);
                    }
                } else {
                    const resolvedNodeData = {
                        ...nodeData,
                        connId,
                        connectionId: connId,
                        connName,
                        connectionName: connName,
                        database,
                        schema,
                        dbType
                    };
                    const tabTitle = `${action}_${name}`;
                    openScriptInNewTab(sql, tabTitle, resolvedNodeData, false);
                }
            } else {
                const err = (data && data.error) ? data.error : 'Không thể sinh script cho đối tượng này.';
                if (typeof showToast === 'function') showToast(`✗ Lỗi: ${err}`, 'danger');
                else alert(`Lỗi sinh script: ${err}`);
            }
        } catch (err) {
            if (window.AppLoader) window.AppLoader.hide();
            const errMsg = err ? (err.message || String(err)) : 'Unknown error';
            if (typeof showToast === 'function') showToast(`✗ Lỗi kết nối: ${errMsg}`, 'danger');
            else alert(`Lỗi: ${errMsg}`);
        }
    }

    // ── Action handlers ────────────────────────────────────────────────────────
    function handleAction(actionId, nodeData) {
        const { type, name, schema, database, connId, dbType } = nodeData || {};
        const safeSchema = schema || 'dbo';

        // Check for parameterized Script As actions: script-as:<action>:<dest>
        if (actionId && actionId.startsWith('script-as:')) {
            const parts = actionId.split(':');
            const act = parts[1] || 'CREATE';
            const dest = parts[2] || 'tab';
            handleScriptAs(nodeData, act, dest);
            return;
        }

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
            case 'test-linked-server':
                {
                    const srvName = nodeData?.server || nodeData?.name;
                    const cId = nodeData?.connId || nodeData?.connectionId || window.ActiveConnectionId;
                    if (!cId || !srvName) break;
                    if (typeof showToast === 'function') {
                        showToast(`Đang kiểm tra kết nối tới Linked Server '${srvName}'...`, 'info');
                    }
                    fetch(`/api/metadata/${cId}/linked_server/test`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ server: srvName })
                    })
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.success) {
                            const msg = data.message || `Kết nối tới Linked Server '${srvName}' thành công.`;
                            if (typeof showToast === 'function') showToast(`✓ ${msg}`, 'success');
                            else alert(`✓ ${msg}`);
                        } else {
                            const err = (data && data.error) || 'Kiểm tra kết nối thất bại.';
                            if (typeof showToast === 'function') showToast(`✗ ${err}`, 'danger');
                            else alert(`✗ ${err}`);
                        }
                    })
                    .catch(err => {
                        if (typeof showToast === 'function') showToast(`✗ Lỗi kết nối: ${err.message}`, 'danger');
                        else alert(`✗ Lỗi kết nối: ${err.message}`);
                    });
                }
                break;
            case 'script-ls-create':
            case 'script-ls-drop':
            case 'script-ls-drop-create':
                {
                    const srvName = nodeData?.server || nodeData?.name;
                    const cId = nodeData?.connId || nodeData?.connectionId || window.ActiveConnectionId;
                    if (!cId || !srvName) break;
                    let mode = 'create';
                    let titlePrefix = 'CREATE_';
                    if (actionId === 'script-ls-drop') {
                        mode = 'drop';
                        titlePrefix = 'DROP_';
                    } else if (actionId === 'script-ls-drop-create') {
                        mode = 'drop_and_create';
                        titlePrefix = 'DROP_AND_CREATE_';
                    }
                    fetch(`/api/metadata/${cId}/linked_server/script?server=${encodeURIComponent(srvName)}&mode=${mode}`)
                        .then(r => r.json())
                        .then(data => {
                            if (data && data.success && data.script) {
                                openScriptInNewTab(data.script, `${titlePrefix}${srvName}`, nodeData, false);
                            } else {
                                const err = (data && data.error) || 'Không thể tạo script cho Linked Server.';
                                if (typeof showToast === 'function') showToast(`✗ ${err}`, 'danger');
                                else alert(`✗ ${err}`);
                            }
                        })
                        .catch(err => {
                            if (typeof showToast === 'function') showToast(`✗ Lỗi: ${err.message}`, 'danger');
                            else alert(`✗ Lỗi: ${err.message}`);
                        });
                }
                break;
            case 'delete-linked-server':
                {
                    const srvName = nodeData?.server || nodeData?.name;
                    const cId = nodeData?.connId || nodeData?.connectionId || window.ActiveConnectionId;
                    if (!cId || !srvName) break;
                    const confirmed = confirm(`Bạn có chắc chắn muốn xóa Linked Server [${srvName}]?\n\nThao tác này sẽ xóa máy chủ liên kết và các thông tin liên quan (sp_dropserver).`);
                    if (!confirmed) break;

                    fetch(`/api/metadata/${cId}/linked_server/drop`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ server: srvName })
                    })
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.success) {
                            if (typeof showToast === 'function') {
                                showToast(`✓ Đã xóa Linked Server '${srvName}' thành công.`, 'success');
                            }
                            if (window.AppMetadataCache && typeof window.AppMetadataCache.clearLinkedServers === 'function') {
                                window.AppMetadataCache.clearLinkedServers(cId);
                            }
                            if (window.AppExplorer && typeof window.AppExplorer.refreshNode === 'function') {
                                window.AppExplorer.refreshNode({ connId: cId, type: 'linked_servers_group' });
                            }
                        } else {
                            const err = (data && data.error) || 'Xóa Linked Server thất bại.';
                            if (typeof showToast === 'function') showToast(`✗ ${err}`, 'danger');
                            else alert(`✗ ${err}`);
                        }
                    })
                    .catch(err => {
                        if (typeof showToast === 'function') showToast(`✗ Lỗi khi xóa: ${err.message}`, 'danger');
                        else alert(`✗ Lỗi khi xóa: ${err.message}`);
                    });
                }
                break;
            case 'script-create':
                handleScriptAs(nodeData, 'CREATE', 'tab');
                break;
            case 'script-alter':
                handleScriptAs(nodeData, 'ALTER', 'tab');
                break;
            case 'script-drop':
                handleScriptAs(nodeData, 'DROP', 'tab');
                break;
            case 'view-definition':
                fetchDefinition(nodeData, actionId);
                break;
            case 'execute':
                handleScriptAs(nodeData, 'EXECUTE', 'tab');
                break;
            case 'reconnect':
            case 'connect':
                if (nodeData.dbType === 'group_marker' || nodeData.config?.type === 'group_marker' || (nodeData.connName && nodeData.connName.startsWith('__group__'))) {
                    console.warn('[ContextMenu] Cannot connect to a group');
                    break;
                }
                const targetConnName = nodeData.connName || String(nodeData.name || '').replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim();
                if (window.AppExplorer && typeof window.AppExplorer.reconnectConnection === 'function') {
                    window.AppExplorer.reconnectConnection(nodeData.connId, targetConnName, nodeData.dbType, nodeData.config);
                } else if (window.AppExplorer && nodeData.config) {
                    window.AppExplorer.reconnect(targetConnName, nodeData.dbType, nodeData.config);
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
            case 'open-activity-monitor':
                const actTargetConn = nodeData.connId || nodeData.name || window.LastFocusedTreeContext?.connectionId;
                const actTargetType = nodeData.dbType || window.LastFocusedTreeContext?.dbType;
                if (window.openActivityMonitorTab) {
                    window.openActivityMonitorTab({
                        connectionId: actTargetConn,
                        connectionName: nodeData.name || nodeData.connName,
                        dbType: actTargetType
                    });
                }
                break;
            case 'open-schema-compare':
                let scTargetConn = nodeData.connId || nodeData.connectionId || nodeData.id || nodeData.name || window.LastFocusedTreeContext?.connectionId;
                const scTargetType = nodeData.dbType || window.LastFocusedTreeContext?.dbType;
                if (scTargetConn && typeof scTargetConn === 'string') {
                    scTargetConn = scTargetConn.replace(/\s*\([^)]*\)\s*$/, '').trim();
                }
                const scDatabase = nodeData.database || (nodeData.type === 'database' ? nodeData.name : undefined);
                const scSchema = nodeData.schema || (nodeData.type === 'schema' ? nodeData.name : undefined);

                // Requirement: Object explorer context menu opens schema compare in a new TAB
                if (window.openSchemaCompareTab) {
                    window.openSchemaCompareTab({
                        connectionId: scTargetConn,
                        connectionName: nodeData.name || nodeData.connName,
                        dbType: scTargetType,
                        database: scDatabase,
                        schema: scSchema
                    });
                } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_schema_compare_window === 'function') {
                    if (window.AppLoader) window.AppLoader.show('Đang mở cửa sổ So sánh Schema...');
                    window.pywebview.api.open_schema_compare_window(scTargetConn, scDatabase, scSchema, null, null, null);
                    setTimeout(() => { if (window.AppLoader) window.AppLoader.hide(); }, 600);
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
            case 'design-view':
                if (window.SqlVisualizer) {
                    window.SqlVisualizer.openView(nodeData);
                }
                break;
            case 'dependencies':
                {
                    const dbType = (nodeData?.dbType || window.ActiveDbType || '').toLowerCase();
                    if (dbType !== 'postgresql') {
                        if (typeof showToast === 'function') {
                            showToast('Dependency Graph hiện tại chỉ hỗ trợ kết nối PostgreSQL.', 'info');
                        } else {
                            alert('Dependency Graph hiện tại chỉ hỗ trợ kết nối PostgreSQL.');
                        }
                        break;
                    }
                    if (window.PostgresDependencyGraph) {
                        const rawType = (nodeData?.type || '').toLowerCase();
                        const rawObjType = (nodeData?.object_type || '').toUpperCase();
                        const isCol = typeof nodeData?.isColumn === 'boolean'
                            ? nodeData.isColumn
                            : (
                                rawObjType === 'COLUMN'
                                || rawType === 'column'
                                || rawType === 'columns'
                                || rawType === 'leaf-columns'
                                || Boolean(nodeData?.column)
                                || Boolean(nodeData?.columnName)
                                || (Boolean(nodeData?.tableName) && Boolean(nodeData?.name) && nodeData?.tableName !== nodeData?.name)
                            );

                        const cleanCol = (nodeData?.column || nodeData?.columnName || (isCol ? nodeData?.name : '') || '').split('(')[0].trim();
                        const resolvedTable = isCol
                            ? (nodeData?.table || nodeData?.tableName || nodeData?.parent_name || '')
                            : (nodeData?.tableName || nodeData?.table || (rawType === 'table' ? nodeData?.name : '') || nodeData?.name || '');
                        const resolvedName = isCol ? cleanCol : (nodeData?.name || resolvedTable);

                        const targetData = {
                            ...nodeData,
                            connectionId: nodeData?.connId || nodeData?.connectionId || window.ActiveConnectionId,
                            database: nodeData?.database || window.ActiveDatabase,
                            schema: nodeData?.schema || window.ActiveSchema || 'public',
                            table: resolvedTable,
                            column: isCol ? cleanCol : '',
                            name: resolvedName,
                            object_type: isCol ? 'COLUMN' : (nodeData?.object_type || (rawType === 'table' ? 'TABLE' : (nodeData?.type || 'TABLE'))).toUpperCase(),
                            isColumn: isCol
                        };
                        window.PostgresDependencyGraph.openGraph(targetData);
                    }
                }
                break;
            case 'copy-name':
                {
                    const colNameToCopy = (nodeData?.column || nodeData?.columnName || nodeData?.name || '').split('(')[0].trim();
                    if (colNameToCopy) {
                        navigator.clipboard.writeText(colNameToCopy);
                        if (typeof showToast === 'function') showToast('Đã sao chép tên cột', 'success');
                    }
                }
                break;
            case 'object-search':
                if (window.ObjectContentSearch) {
                    window.ObjectContentSearch.openSearchTab({
                        connectionId: nodeData?.connectionId || connId,
                        connectionName: nodeData?.connName || nodeData?.connectionName,
                        database: nodeData?.type === 'database' ? nodeData?.name : (nodeData?.database || window.ActiveDatabase),
                        schema: nodeData?.schema || (nodeData?.type === 'schema' ? nodeData?.name : null),
                        dbType: nodeData?.dbType || window.ActiveDbType
                    });
                }
                break;
            case 'refresh':
                if (window.AppExplorer && typeof window.AppExplorer.refreshNode === 'function') {
                    window.AppExplorer.refreshNode(nodeData);
                }
                break;
            default:
                console.log('Context action not implemented:', actionId, nodeData);
        }
    }

    function openScriptInNewTab(sql, title, nodeData = {}, autoExecute = false) {
        if (!window.AppTabs) return;
        let tabTitle = (title || 'Query') + (title && !title.endsWith('.sql') ? '.sql' : '');
        if (typeof window.getUniqueFileName === 'function') {
            const existingTitles = [];
            if (typeof window.AppTabs.getAllTabs === 'function') {
                const allTabs = window.AppTabs.getAllTabs();
                if (allTabs && typeof allTabs.values === 'function') {
                    for (const t of allTabs.values()) {
                        if (t && t.title) existingTitles.push(t.title);
                    }
                }
            }
            tabTitle = window.getUniqueFileName(tabTitle, existingTitles);
        }
        const connId   = nodeData.connId   || nodeData.connectionId || window.ActiveConnectionId;
        const connName = nodeData.connName || nodeData.connectionName || window.ActiveConnectionName;
        const database = nodeData.database || window.ActiveDatabase;
        const schema   = nodeData.schema   || window.ActiveSchema;
        const dbType   = nodeData.dbType   || window.ActiveDbType;

        window.AppTabs.createTab({
            title: tabTitle,
            content: sql,
            connectionId:   connId,
            connectionName: connName,
            database:       database,
            schema:         schema,
            dbType:         dbType,
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
        const connId   = nodeData?.connId   || nodeData?.connectionId || window.ActiveConnectionId;
        const connName = nodeData?.connName || nodeData?.connectionName || window.ActiveConnectionName;
        const database = nodeData?.database || window.ActiveDatabase;
        const schema   = nodeData?.schema   || window.ActiveSchema || 'dbo';
        const name     = nodeData?.name;
        const type     = nodeData?.type;
        const dbType   = nodeData?.dbType   || window.ActiveDbType;
        if (!connId || !name) return;

        const resolvedNodeData = {
            ...nodeData,
            connId,
            connectionId: connId,
            connName,
            connectionName: connName,
            database,
            schema,
            dbType
        };

        let titlePrefix = 'CREATE_';
        if (mode === 'script-alter') titlePrefix = 'ALTER_';
        if (mode === 'view-definition') titlePrefix = 'DEF_';

        try {
            const res = await fetch(`/api/metadata/${connId}/definition?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name || '')}&type=${encodeURIComponent(type || '')}&_t=${Date.now()}`, { cache: 'no-store' });
            const data = await res.json();
            if (data.definition) {
                let sql = data.definition;
                const isPg = (dbType === 'postgresql' || window.ActiveDbType === 'postgresql');
                if (mode === 'script-alter') {
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
                        } else if (/^\s*CREATE\s+OR\s+ALTER\b/im.test(sql)) {
                            // Already CREATE OR ALTER, keep it intact
                        } else if (/^\s*CREATE\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\b/im, 'ALTER');
                        }
                    }
                } else if (mode === 'script-create') {
                    if (type === 'trigger') {
                        if (/^\s*ALTER\s+TRIGGER\b/im.test(sql)) {
                            sql = sql.replace(/^\s*ALTER\s+TRIGGER\b/im, 'CREATE TRIGGER');
                        }
                    } else if (!isPg) {
                        // SQL Server / others: convert ALTER to CREATE
                        if (/^\s*CREATE\s+OR\s+ALTER\b/im.test(sql)) {
                            sql = sql.replace(/^\s*CREATE\s+OR\s+ALTER\b/im, 'CREATE');
                        } else if (/^\s*ALTER\b/im.test(sql)) {
                            sql = sql.replace(/^\s*ALTER\b/im, 'CREATE');
                        }
                    }
                }
                openScriptInNewTab(sql, `${titlePrefix}${name}`, resolvedNodeData, false);
                return;
            }
        } catch (e) {
            console.error('fetchDefinition error', e);
        }

        if (type === 'trigger') {
            openScriptInNewTab(`-- Definition for trigger [${schema}].[${name}]\n-- Could not be retrieved automatically.`, `${titlePrefix}${name}`, resolvedNodeData, false);
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
                openScriptInNewTab(ddl, `${titlePrefix}${name}`, resolvedNodeData, false);
                return;
            }
        } catch (_) {}

        openScriptInNewTab(`-- Definition for [${schema || 'dbo'}].[${name}]\n-- Could not be retrieved automatically.`, `${titlePrefix}${name}`, resolvedNodeData, false);
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
        } else if (dbType === 'postgresql' && (type === 'function' || type === 'procedure')) {
            const base = nodeData.baseName || (name.includes('(') ? name.slice(0, name.indexOf('(')).trim() : name);
            const args = nodeData.identityArgs !== undefined ? nodeData.identityArgs : (name.includes('(') ? name.slice(name.indexOf('(') + 1, -1).trim() : '');
            sql = `DROP ${dropKeyword} "${schema || 'public'}"."${base}"(${args});`;
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
                    { id: 'reconnect', label: 'Reconnect', icon: 'fa-rotate-right' },
                    { id: 'disconnect', label: 'Disconnect', icon: 'fa-plug-circle-xmark' },
                    { id: 'refresh', label: 'Refresh', icon: 'fa-arrows-rotate' },
                    { id: 'new-query', label: 'New Query', icon: 'fa-plus' },
                    { id: 'open-profiler', label: 'SQL Trace Profiler...', icon: 'fa-bolt text-warning' },
                    { id: 'open-activity-monitor', label: 'Activity Monitor (Phiên & Khóa)...', icon: 'fa-heart-pulse text-danger' },
                    { id: 'open-schema-compare', label: 'So sánh Schema...', icon: 'fa-code-compare text-success' },
                    { separator: true },
                    { id: 'new-group', label: 'New Group...', icon: 'fa-folder-plus' },
                    { separator: true },
                    { id: 'edit-connection', label: 'Edit Connection', icon: 'fa-pen' },
                    { id: 'delete-connection', label: 'Delete Connection', icon: 'fa-trash', danger: true },
                ];
            } else {
                items = [
                    { id: 'reconnect', label: 'Connect / Reconnect', icon: 'fa-plug' },
                    { id: 'open-profiler', label: 'SQL Trace Profiler...', icon: 'fa-bolt text-warning' },
                    { id: 'open-activity-monitor', label: 'Activity Monitor (Phiên & Khóa)...', icon: 'fa-heart-pulse text-danger' },
                    { id: 'open-schema-compare', label: 'So sánh Schema...', icon: 'fa-code-compare text-success' },
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

        function renderMenuItem(it, container) {
            if (it.separator) {
                const sep = document.createElement('div');
                sep.className = 'ide-ctx-separator';
                container.appendChild(sep);
                return;
            }

            if (it.submenu && Array.isArray(it.submenu)) {
                const parentItem = document.createElement('div');
                parentItem.className = 'ide-ctx-item has-submenu' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
                parentItem.setAttribute('role', 'menuitem');
                parentItem.setAttribute('tabindex', '0');
                parentItem.innerHTML = `
                    <i class="fa-solid ${it.icon || 'fa-circle'} ide-ctx-icon"></i>
                    <span class="ide-ctx-label">${it.label}</span>
                    <i class="fa-solid fa-chevron-right ide-ctx-arrow"></i>
                `;
                const submenuEl = document.createElement('div');
                submenuEl.className = 'ide-ctx-submenu';
                submenuEl.setAttribute('role', 'menu');

                it.submenu.forEach(subIt => {
                    renderMenuItem(subIt, submenuEl);
                });

                parentItem.appendChild(submenuEl);

                parentItem.addEventListener('mouseenter', () => {
                    const rect = parentItem.getBoundingClientRect();
                    if (rect.right + 200 > window.innerWidth) {
                        submenuEl.classList.add('open-left');
                    } else {
                        submenuEl.classList.remove('open-left');
                    }
                });

                container.appendChild(parentItem);
                buttons.push(parentItem);
                return;
            }

            const btn = document.createElement('button');
            btn.className = 'ide-ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
            btn.setAttribute('role', 'menuitem');
            if (it.disabled) btn.disabled = true;
            btn.innerHTML = `
                <i class="fa-solid ${it.icon || 'fa-circle'} ide-ctx-icon"></i>
                <span class="ide-ctx-label">${it.label}</span>
                ${it.shortcut ? `<span class="ide-ctx-shortcut">${it.shortcut}</span>` : ''}
            `;
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                hide();
                handleAction(it.id, nodeData);
            });
            container.appendChild(btn);
            buttons.push(btn);
        }

        items.forEach(item => renderMenuItem(item, menuEl));

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
