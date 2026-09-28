// Table Designer Component — SSMS & PostgreSQL Aware
// Follows .skill/design_table.md and _concept/Context_menu mockups

(function () {
    const designerSessions = new Map(); // tabId -> sessionState
    let activeSession = null;
    let modalDiffEditor = null;
    let modalDiffCm = null; // backward-compat fallback
    let modalInstance = null;

    // Supported Collations and Types cache
    const typesCache = new Map(); // connId -> typesInfo

    function getMonacoTheme() {
        const activeTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            return window.MonacoInit.getMonacoTheme(activeTheme);
        }
        return (activeTheme === 'light' || activeTheme === 'win-nt' || activeTheme === 'win-xp' || activeTheme.includes('light')) ? 'ide-light' : 'ide-dark';
    }

    function createMonacoEditor(containerEl, options = {}) {
        if (!containerEl || typeof monaco === 'undefined' || !monaco.editor) {
            return null;
        }
        const defaultOptions = {
            value: options.value || '',
            language: 'sql',
            theme: getMonacoTheme(),
            automaticLayout: true,
            mouseWheelZoom: true,
            readOnly: !!options.readOnly,
            fontSize: 12,
            fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
            lineNumbers: options.lineNumbers !== undefined ? options.lineNumbers : 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: options.wordWrap || 'on',
            folding: true,
            renderLineHighlight: 'all',
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true
        };
        try {
            const ed = monaco.editor.create(containerEl, Object.assign({}, defaultOptions, options));
            setTimeout(() => { if (ed && typeof ed.layout === 'function') ed.layout(); }, 30);
            return ed;
        } catch (err) {
            console.warn('[TableDesigner] Monaco init error, falling back:', err);
            return null;
        }
    }

    function getCodeMirrorTheme() {
        const activeTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        return (activeTheme === 'light' || activeTheme === 'win-nt' || activeTheme === 'win-xp' || activeTheme.includes('light')) ? 'default' : 'darcula';
    }

    // Dynamic theme change sync for Monaco and legacy instances
    document.addEventListener('ide-theme-changed', (e) => {
        const themeName = e.detail?.theme;
        let monacoTheme = 'ide-dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            monacoTheme = window.MonacoInit.getMonacoTheme(themeName);
        } else {
            monacoTheme = (themeName === 'light' || themeName === 'win-nt' || themeName === 'win-xp' || (themeName && themeName.includes('light'))) ? 'ide-light' : 'ide-dark';
        }

        if (modalDiffEditor && typeof modalDiffEditor.updateOptions === 'function') {
            modalDiffEditor.updateOptions({ theme: monacoTheme });
        }
        const cmTheme = (themeName === 'light' || themeName === 'win-nt' || themeName === 'win-xp' || (themeName && themeName.includes('light'))) ? 'default' : 'darcula';
        if (modalDiffCm && typeof modalDiffCm.setOption === 'function') {
            modalDiffCm.setOption('theme', cmTheme);
        }
        for (const session of designerSessions.values()) {
            if (session.triggerCm && typeof session.triggerCm.setOption === 'function') session.triggerCm.setOption('theme', cmTheme);
            if (session.previewCm && typeof session.previewCm.setOption === 'function') session.previewCm.setOption('theme', cmTheme);
            if (session.liveSqlCm && typeof session.liveSqlCm.setOption === 'function') session.liveSqlCm.setOption('theme', cmTheme);
            if (session.triggerEditor && typeof session.triggerEditor.updateOptions === 'function') session.triggerEditor.updateOptions({ theme: monacoTheme });
            if (session.previewEditor && typeof session.previewEditor.updateOptions === 'function') session.previewEditor.updateOptions({ theme: monacoTheme });
            if (session.liveSqlEditor && typeof session.liveSqlEditor.updateOptions === 'function') session.liveSqlEditor.updateOptions({ theme: monacoTheme });
        }
    });

    function getOrCreateSessionPane(container, tabId) {
        if (!container) return null;
        let pane = container.querySelector(`.td-tab-session-pane[data-tab-id="${tabId}"]`);
        if (!pane) {
            pane = document.createElement('div');
            pane.className = 'td-tab-session-pane';
            pane.dataset.tabId = tabId;
            container.appendChild(pane);
        }
        return pane;
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj || {}));
    }

    // ── Open Table Designer ──────────────────────────────────────────────────
    async function openTable(nodeData) {
        const { name, schema, database, connId, dbType, connName } = nodeData || {};
        const safeSchema = schema || (dbType === 'postgresql' ? 'public' : 'dbo');
        const quotePrefix = dbType === 'postgresql' ? '"' : '[';
        const quoteSuffix = dbType === 'postgresql' ? '"' : ']';
        const fullTableName = `${quotePrefix}${safeSchema}${quoteSuffix}.${quotePrefix}${name}${quoteSuffix}`;
        const tabTitle = `Design: ${fullTableName}`;

        // Check if tab already open
        if (window.AppTabs) {
            for (const [tId, s] of designerSessions.entries()) {
                if (s.connId === connId && s.database === database && s.schema === safeSchema && s.table === name) {
                    window.AppTabs.switchTab(tId);
                    return;
                }
            }
        }

        // Create new designer tab
        const tabId = window.AppTabs.createTab({
            tabType: 'designer',
            title: tabTitle,
            icon: 'fa-drafting-compass',
            connectionId: connId,
            connectionName: connName,
            database: database,
            schema: safeSchema,
            dbType: dbType
        });

        // Show loading state inside the dedicated session pane
        const container = document.getElementById('table-designer-container');
        let pane = null;
        if (container) {
            pane = getOrCreateSessionPane(container, tabId);
            container.querySelectorAll('.td-tab-session-pane').forEach(p => {
                if (p !== pane) p.classList.add('d-none');
            });
            Array.from(container.children).forEach(child => {
                if (!child.classList.contains('td-tab-session-pane')) {
                    child.remove();
                }
            });
            pane.classList.remove('d-none');
            pane.innerHTML = `
                <div class="d-flex flex-column align-items-center justify-content-center h-100 text-muted" style="min-height: 200px;">
                    <i class="fa-solid fa-circle-notch fa-spin fa-2x mb-3 text-info"></i>
                    <div>Loading table design for <strong>${escapeHtml(fullTableName)}</strong>...</div>
                </div>
            `;
        }

        try {
            // Fetch metadata
            const res = await fetch(`/api/metadata/${connId}/table-design?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&table=${encodeURIComponent(name)}`);
            const json = await res.json();
            if (!json.success) {
                throw new Error(json.error || 'Failed to load table schema');
            }

            // Fetch supported types if not cached
            const cacheKey = `${connId}_${database || ''}`;
            let typesInfo = typesCache.get(cacheKey);
            if (!typesInfo) {
                try {
                    const tRes = await fetch(`/api/metadata/${connId}/table-design/types?database=${encodeURIComponent(database || '')}`);
                    const tJson = await tRes.json();
                    if (tJson.success) {
                        typesInfo = tJson.data;
                        typesCache.set(cacheKey, typesInfo);
                    }
                } catch (_) {}
                if (!typesInfo) {
                    typesInfo = {
                        engine: dbType,
                        types: ['int', 'varchar', 'nvarchar', 'datetime', 'decimal', 'bit'],
                        user_types: [],
                        collations: ['DATABASE_DEFAULT']
                    };
                }
            }

            const session = {
                tabId,
                connId,
                connName,
                database,
                schema: safeSchema,
                table: name,
                dbType: json.data.engine || dbType,
                originalData: clone(json.data),
                modifiedData: clone(json.data),
                previewSql: json.preview_sql || '',
                supportedTypes: typesInfo,
                activeSubTab: 'fields',
                selectedFieldIndex: 0,
                selectedFieldIndices: new Set([0]),
                selectedTrigIndex: 0,
                sqlPanelHeight: 180,
                domPane: pane,
                isRendered: false,
                liveSqlEditor: null,
                previewEditor: null,
                triggerEditor: null,
                triggerCm: null,
                previewCm: null,
                liveSqlCm: null,
                liveSqlDebounceTimer: null
            };

            designerSessions.set(tabId, session);
            renderDesigner(session);
            activateTab(tabId);

        } catch (err) {
            console.error('Error opening table designer:', err);
            const errTarget = pane || container;
            if (errTarget) {
                errTarget.innerHTML = `
                    <div class="p-4 text-danger">
                        <h5><i class="fa-solid fa-triangle-exclamation me-2"></i>Failed to load table design</h5>
                        <p>${escapeHtml(err.message)}</p>
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.AppTabs.closeTab('${tabId}', document.querySelector('.ide-tab[data-tab-id=\\'${tabId}\\']'))">Close Tab</button>
                    </div>
                `;
            }
        }
    }

    // ── Open New Table Designer ──────────────────────────────────────────────
    async function openNewTable(nodeData) {
        const { schema, database, connId, dbType, connName } = nodeData || {};
        const safeSchema = schema || (dbType === 'postgresql' ? 'public' : 'dbo');

        // Determine unique default table name (Table_1, Table_2, ...)
        let counter = 1;
        let newTableName = `Table_${counter}`;
        const existingNames = new Set();
        for (const s of designerSessions.values()) {
            if (s.connId === connId && s.database === database) {
                existingNames.add((s.table || '').toLowerCase());
            }
        }
        while (existingNames.has(newTableName.toLowerCase())) {
            counter++;
            newTableName = `Table_${counter}`;
        }

        const tabTitle = `New Table: ${newTableName}`;

        const tabId = window.AppTabs.createTab({
            tabType: 'designer',
            title: tabTitle,
            icon: 'fa-plus',
            connectionId: connId,
            connectionName: connName,
            database: database,
            schema: safeSchema,
            dbType: dbType
        });

        // Fetch supported types if not cached
        const cacheKey = `${connId}_${database || ''}`;
        let typesInfo = typesCache.get(cacheKey);
        if (!typesInfo) {
            try {
                const tRes = await fetch(`/api/metadata/${connId}/table-design/types?database=${encodeURIComponent(database || '')}`);
                const tJson = await tRes.json();
                if (tJson.success) {
                    typesInfo = tJson.data;
                    typesCache.set(cacheKey, typesInfo);
                }
            } catch (_) {}
            if (!typesInfo) {
                typesInfo = {
                    engine: dbType,
                    types: ['int', 'varchar', 'nvarchar', 'datetime', 'decimal', 'bit'],
                    user_types: [],
                    collations: ['DATABASE_DEFAULT']
                };
            }
        }

        const isPg = (dbType === 'postgresql');
        const defaultCols = isPg ? [
            {
                name: 'id',
                type: 'serial',
                size: '',
                scale: '',
                nullable: false,
                is_pk: true,
                is_identity: false,
                default_value: '',
                collation: '',
                comment: ''
            }
        ] : [
            {
                name: 'Id',
                type: 'int',
                size: '',
                scale: '',
                nullable: false,
                is_pk: true,
                is_identity: true,
                default_value: '',
                collation: '',
                comment: ''
            }
        ];

        const initialData = {
            engine: dbType || 'sqlserver',
            database: database,
            schema: safeSchema,
            table: newTableName,
            columns: defaultCols,
            indexes: [],
            foreign_keys: [],
            uniques: [],
            checks: [],
            triggers: []
        };

        const container = document.getElementById('table-designer-container');
        const pane = container ? getOrCreateSessionPane(container, tabId) : null;

        const session = {
            tabId,
            isNew: true,
            connId,
            connName,
            database,
            schema: safeSchema,
            table: newTableName,
            dbType: dbType || 'sqlserver',
            originalData: null,
            modifiedData: clone(initialData),
            previewSql: '',
            supportedTypes: typesInfo,
            activeSubTab: 'fields',
            selectedFieldIndex: 0,
            selectedFieldIndices: new Set([0]),
            selectedTrigIndex: 0,
            sqlPanelHeight: 180,
            domPane: pane,
            isRendered: false,
            liveSqlEditor: null,
            previewEditor: null,
            triggerEditor: null,
            triggerCm: null,
            previewCm: null,
            liveSqlCm: null,
            liveSqlDebounceTimer: null
        };

        designerSessions.set(tabId, session);
        renderDesigner(session);
        activateTab(tabId);
        markDirty(session);
    }

    // ── Copy / Clone Table Designer ──────────────────────────────────────────
    async function copyTable(nodeData) {
        const { name, schema, database, connId, dbType, connName } = nodeData || {};
        const safeSchema = schema || (dbType === 'postgresql' ? 'public' : 'dbo');
        const copyTableName = `${name || 'Table'}_Copy`;
        const tabTitle = `New Table: ${copyTableName}`;

        const tabId = window.AppTabs.createTab({
            tabType: 'designer',
            title: tabTitle,
            icon: 'fa-clone',
            connectionId: connId,
            connectionName: connName,
            database: database,
            schema: safeSchema,
            dbType: dbType
        });

        // Show loading state inside the dedicated session pane
        const container = document.getElementById('table-designer-container');
        let pane = null;
        if (container) {
            pane = getOrCreateSessionPane(container, tabId);
            container.querySelectorAll('.td-tab-session-pane').forEach(p => {
                if (p !== pane) p.classList.add('d-none');
            });
            Array.from(container.children).forEach(child => {
                if (!child.classList.contains('td-tab-session-pane')) {
                    child.remove();
                }
            });
            pane.classList.remove('d-none');
            pane.innerHTML = `
                <div class="d-flex flex-column align-items-center justify-content-center h-100 text-muted" style="min-height: 200px;">
                    <i class="fa-solid fa-circle-notch fa-spin fa-2x mb-3 text-info"></i>
                    <div>Cloning structure from <strong>[${escapeHtml(safeSchema)}].[${escapeHtml(name)}]</strong>...</div>
                </div>
            `;
        }

        try {
            // Fetch source table metadata
            const res = await fetch(`/api/metadata/${connId}/table-design?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&table=${encodeURIComponent(name)}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Failed to load source table schema');

            // Fetch supported types if not cached
            const cacheKey = `${connId}_${database || ''}`;
            let typesInfo = typesCache.get(cacheKey);
            if (!typesInfo) {
                const tRes = await fetch(`/api/metadata/${connId}/table-design/types?database=${encodeURIComponent(database || '')}`);
                const tJson = await tRes.json();
                if (tJson.success) {
                    typesInfo = tJson.data;
                    typesCache.set(cacheKey, typesInfo);
                } else {
                    typesInfo = {
                        engine: dbType,
                        types: ['int', 'varchar', 'nvarchar', 'datetime', 'decimal', 'bit'],
                        collations: ['DATABASE_DEFAULT']
                    };
                }
            }

            const cloned = clone(json.data);
            cloned.table = copyTableName;
            cloned.schema = safeSchema;

            // Suffix indexes, uniques, checks to avoid naming collisions
            if (cloned.indexes) {
                cloned.indexes.forEach(idx => {
                    if (idx.name) idx.name = `${idx.name}_Copy`;
                });
            }
            if (cloned.foreign_keys) {
                cloned.foreign_keys.forEach(fk => {
                    if (fk.name) fk.name = `${fk.name}_Copy`;
                });
            }
            if (cloned.uniques) {
                cloned.uniques.forEach(u => {
                    if (u.name) u.name = `${u.name}_Copy`;
                });
            }
            if (cloned.checks) {
                cloned.checks.forEach(c => {
                    if (c.name) c.name = `${c.name}_Copy`;
                });
            }
            if (cloned.triggers) {
                cloned.triggers.forEach(tr => {
                    if (tr.name) tr.name = `${tr.name}_Copy`;
                    if (tr.definition) {
                        tr.definition = tr.definition.replaceAll(name, copyTableName);
                    }
                });
            }

            const session = {
                tabId,
                isNew: true,
                connId,
                connName,
                database,
                schema: safeSchema,
                table: copyTableName,
                dbType: json.data.engine || dbType,
                originalData: null,
                modifiedData: cloned,
                previewSql: '',
                supportedTypes: typesInfo,
                activeSubTab: 'fields',
                selectedFieldIndex: 0,
                selectedFieldIndices: new Set([0]),
                selectedTrigIndex: 0,
                sqlPanelHeight: 180,
                domPane: pane,
                isRendered: false,
                liveSqlEditor: null,
                previewEditor: null,
                triggerEditor: null,
                triggerCm: null,
                previewCm: null,
                liveSqlCm: null,
                liveSqlDebounceTimer: null
            };

            designerSessions.set(tabId, session);
            renderDesigner(session);
            activateTab(tabId);
            markDirty(session);

        } catch (err) {
            console.error('Error copying table:', err);
            const errTarget = pane || container;
            if (errTarget) {
                errTarget.innerHTML = `
                    <div class="p-4 text-danger">
                        <h5><i class="fa-solid fa-triangle-exclamation me-2"></i>Failed to copy table design</h5>
                        <p>${escapeHtml(err.message)}</p>
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.AppTabs.closeTab('${tabId}', document.querySelector('.ide-tab[data-tab-id=\\'${tabId}\\']'))">Close Tab</button>
                    </div>
                `;
            }
        }
    }

    // ── Column Manipulation Helpers (Move, Copy, Paste) ──────────────────────
    function moveColumnUp(session) {
        const sel = session.selectedFieldIndex;
        const cols = session.modifiedData.columns;
        if (sel > 0 && sel < cols.length) {
            const tmp = cols[sel];
            cols[sel] = cols[sel - 1];
            cols[sel - 1] = tmp;
            session.selectedFieldIndex = sel - 1;
            markDirty(session);
            renderDesigner(session);
        }
    }

    function moveColumnDown(session) {
        const sel = session.selectedFieldIndex;
        const cols = session.modifiedData.columns;
        if (sel >= 0 && sel < cols.length - 1) {
            const tmp = cols[sel];
            cols[sel] = cols[sel + 1];
            cols[sel + 1] = tmp;
            session.selectedFieldIndex = sel + 1;
            markDirty(session);
            renderDesigner(session);
        }
    }

    function copySelectedColumn(session) {
        const cols = session.modifiedData.columns || [];
        if (session.selectedFieldIndices && session.selectedFieldIndices.size > 0) {
            const sorted = Array.from(session.selectedFieldIndices).sort((a, b) => a - b);
            window._tdColumnClipboard = sorted.map(i => clone(cols[i])).filter(Boolean);
            showDesignerNotification(`Copied ${window._tdColumnClipboard.length} column(s) to clipboard.`);
        } else {
            const sel = session.selectedFieldIndex;
            if (sel >= 0 && sel < cols.length) {
                window._tdColumnClipboard = [clone(cols[sel])];
                showDesignerNotification(`Copied column "${cols[sel].name}" to clipboard.`);
            }
        }
    }

    function copyAllColumns(session) {
        const cols = session.modifiedData.columns;
        if (cols && cols.length > 0) {
            window._tdColumnClipboard = cols.map(c => clone(c));
            session.selectedFieldIndices = new Set(cols.map((_, i) => i));
            const container = document.getElementById('table-designer-container');
            if (container) {
                container.querySelectorAll('#td-pane-fields tbody tr').forEach(r => r.classList.add('selected', 'selected-multi'));
            }
            showDesignerNotification(`Copied all ${cols.length} columns to clipboard.`);
        }
    }

    function pasteColumns(session) {
        if (!window._tdColumnClipboard || !window._tdColumnClipboard.length) {
            showDesignerNotification('Clipboard is empty. Copy column(s) first.', 'warning');
            return;
        }
        const cols = session.modifiedData.columns;
        const existingNames = new Set(cols.map(c => (c.name || '').toLowerCase()));

        const toInsert = window._tdColumnClipboard.map(orig => {
            const c = clone(orig);
            let baseName = c.name || 'Column';
            let candidate = baseName;
            let counter = 1;
            while (existingNames.has(candidate.toLowerCase())) {
                candidate = `${baseName}_copy${counter > 1 ? counter : ''}`;
                counter++;
            }
            existingNames.add(candidate.toLowerCase());
            c.name = candidate;
            return c;
        });

        if (session.selectedFieldIndices && session.selectedFieldIndices.size > 1) {
            // Replace selected rows!
            const sorted = Array.from(session.selectedFieldIndices).sort((a, b) => a - b);
            const minIdx = sorted[0];
            for (let i = sorted.length - 1; i >= 0; i--) {
                cols.splice(sorted[i], 1);
            }
            cols.splice(minIdx, 0, ...toInsert);
            session.selectedFieldIndex = minIdx;
            session.selectedFieldIndices = new Set(toInsert.map((_, k) => minIdx + k));
            showDesignerNotification(`Replaced ${sorted.length} column(s) with ${toInsert.length} copied column(s).`);
        } else {
            const sel = session.selectedFieldIndex >= 0 && session.selectedFieldIndex < cols.length ? session.selectedFieldIndex : cols.length - 1;
            const insertIdx = sel >= 0 ? sel + 1 : cols.length;
            cols.splice(insertIdx, 0, ...toInsert);
            session.selectedFieldIndex = insertIdx + toInsert.length - 1;
            session.selectedFieldIndices = new Set(toInsert.map((_, k) => insertIdx + k));
            showDesignerNotification(`Pasted ${toInsert.length} column(s).`);
        }
        markDirty(session);
        renderDesigner(session);
    }

    function showDesignerNotification(msg, type = 'info') {
        const area = document.getElementById('td-notification-area');
        if (!area) return;
        const colorClass = type === 'warning' ? 'text-warning' : (type === 'danger' ? 'text-danger' : 'text-info');
        area.className = colorClass;
        area.innerHTML = `<i class="fa-solid fa-circle-info me-1"></i>${escapeHtml(msg)}`;
        area.style.opacity = '1';
        clearTimeout(area._timeout);
        area._timeout = setTimeout(() => {
            area.style.opacity = '0';
        }, 3000);
    }

    function addNewColumn(session) {
        const newColName = `Column_${session.modifiedData.columns.length + 1}`;
        const defType = session.supportedTypes.types[0] || 'varchar';
        session.modifiedData.columns.push({
            name: newColName,
            type: defType,
            size: defType.includes('char') ? '50' : '',
            scale: '',
            nullable: true,
            is_pk: false,
            is_identity: false,
            identity_seed: 1,
            identity_increment: 1,
            sequence_name: '',
            default_value: '',
            collation: '',
            comment: ''
        });
        session.selectedFieldIndex = session.modifiedData.columns.length - 1;
        markDirty(session);
        renderDesigner(session);
        setTimeout(() => {
            const rows = document.querySelectorAll('#td-pane-fields tbody tr');
            if (rows.length > 0) rows[rows.length - 1].querySelector('.td-f-name')?.focus();
        }, 50);
    }

    function insertColumnAbove(session) {
        const sel = session.selectedFieldIndex >= 0 ? session.selectedFieldIndex : 0;
        const newColName = `Column_${session.modifiedData.columns.length + 1}`;
        const defType = session.supportedTypes.types[0] || 'varchar';
        session.modifiedData.columns.splice(sel, 0, {
            name: newColName,
            type: defType,
            size: defType.includes('char') ? '50' : '',
            scale: '',
            nullable: true,
            is_pk: false,
            is_identity: false,
            identity_seed: 1,
            identity_increment: 1,
            sequence_name: '',
            default_value: '',
            collation: '',
            comment: ''
        });
        session.selectedFieldIndex = sel;
        markDirty(session);
        renderDesigner(session);
        setTimeout(() => {
            const rows = document.querySelectorAll('#td-pane-fields tbody tr');
            if (rows[sel]) rows[sel].querySelector('.td-f-name')?.focus();
        }, 50);
    }

    function addNewIndex(session) {
        const idxName = `IX_${session.table}_${session.modifiedData.indexes.length + 1}`;
        session.modifiedData.indexes.push({
            name: idxName,
            fields: session.modifiedData.columns.length > 0 ? [session.modifiedData.columns[0].name] : [],
            index_type: 'NONCLUSTERED',
            is_unique: false,
            comment: ''
        });
        markDirty(session);
        renderDesigner(session);
    }

    function addNewForeignKey(session) {
        const fkName = `FK_${session.table}_${session.modifiedData.foreign_keys.length + 1}`;
        session.modifiedData.foreign_keys.push({
            name: fkName,
            fields: session.modifiedData.columns.length > 0 ? [session.modifiedData.columns[0].name] : [],
            ref_schema: session.schema,
            ref_table: '',
            ref_fields: [],
            on_delete: 'NO ACTION',
            on_update: 'NO ACTION',
            is_enabled: true,
            not_for_replication: false,
            comment: ''
        });
        markDirty(session);
        renderDesigner(session);
    }

    function addNewUnique(session) {
        const uqName = `UQ_${session.table}_${session.modifiedData.uniques.length + 1}`;
        session.modifiedData.uniques.push({
            name: uqName,
            fields: session.modifiedData.columns.length > 0 ? [session.modifiedData.columns[0].name] : [],
            is_clustered: false,
            comment: ''
        });
        markDirty(session);
        renderDesigner(session);
    }

    function addNewCheck(session) {
        const chkName = `CK_${session.table}_${session.modifiedData.checks.length + 1}`;
        session.modifiedData.checks.push({
            name: chkName,
            check_clause: '',
            is_enabled: true,
            not_for_replication: false,
            comment: ''
        });
        markDirty(session);
        renderDesigner(session);
    }

    function addNewTrigger(session) {
        const trigName = `TR_${session.table}_${session.modifiedData.triggers.length + 1}`;
        const isPg = session.dbType === 'postgresql';
        const defaultDef = isPg
            ? `CREATE OR REPLACE TRIGGER "${trigName}"\nAFTER INSERT ON "${session.schema}"."${session.table}"\nFOR EACH ROW EXECUTE FUNCTION notify_change();`
            : `CREATE TRIGGER [${session.schema}].[${trigName}]\nON [${session.schema}].[${session.table}]\nAFTER INSERT\nAS\nBEGIN\n    SET NOCOUNT ON;\nEND;`;
        session.modifiedData.triggers.push({
            name: trigName,
            fires: 'After',
            is_insert: true,
            is_update: false,
            is_delete: false,
            is_enabled: true,
            definition: defaultDef,
            comment: ''
        });
        session.selectedTrigIndex = session.modifiedData.triggers.length - 1;
        markDirty(session);
        renderDesigner(session);
    }

    function addNewItemForActiveSubTab(session) {
        switch (session.activeSubTab) {
            case 'fields': addNewColumn(session); break;
            case 'indexes': addNewIndex(session); break;
            case 'foreign-keys': addNewForeignKey(session); break;
            case 'uniques': addNewUnique(session); break;
            case 'checks': addNewCheck(session); break;
            case 'trigger': addNewTrigger(session); break;
        }
    }

    function insertItemAboveForActiveSubTab(session) {
        if (session.activeSubTab === 'fields') {
            insertColumnAbove(session);
        } else {
            addNewItemForActiveSubTab(session);
        }
    }

    function cleanTypeStr(s) {
        return (s || '').toLowerCase().replace(/[\[\]"]/g, '').trim();
    }

    function matchType(a, b) {
        const ca = cleanTypeStr(a);
        const cb = cleanTypeStr(b);
        if (!ca || !cb) return false;
        if (ca === cb) return true;
        const caBase = ca.includes('.') ? ca.split('.').pop() : ca;
        const cbBase = cb.includes('.') ? cb.split('.').pop() : cb;
        return caBase === cbBase;
    }

    function renderTypeOptions(supportedTypes, selectedType) {
        const stdTypes = supportedTypes.types || ['int', 'varchar', 'nvarchar', 'datetime', 'decimal', 'bit'];
        const userTypes = supportedTypes.user_types || [];

        let bestMatch = null;
        if (selectedType) {
            if (selectedType.includes('.') || selectedType.includes('[')) {
                bestMatch = userTypes.find(t => matchType(t, selectedType));
            }
            if (!bestMatch) {
                bestMatch = stdTypes.find(t => matchType(t, selectedType)) || userTypes.find(t => matchType(t, selectedType));
            }
        }

        let html = '<optgroup label="Standard Types">';
        stdTypes.forEach(t => {
            const isSelected = (bestMatch ? t === bestMatch : false);
            html += `<option value="${escapeHtml(t)}" ${isSelected ? 'selected' : ''}>${escapeHtml(t)}</option>`;
        });
        html += '</optgroup>';

        if (userTypes.length > 0) {
            html += '<optgroup label="User-Defined Types (UDT)">';
            userTypes.forEach(t => {
                const isSelected = (bestMatch ? t === bestMatch : false);
                html += `<option value="${escapeHtml(t)}" ${isSelected ? 'selected' : ''}>${escapeHtml(t)}</option>`;
            });
            html += '</optgroup>';
        }

        if (selectedType && !bestMatch) {
            html += `<option value="${escapeHtml(selectedType)}" selected>${escapeHtml(selectedType)}</option>`;
        }
        return html;
    }

    function generatePreSaveAudit(session) {
        const orig = session.isNew ? { columns: [], indexes: [], foreign_keys: [], uniques: [], checks: [], triggers: [] } : (session.originalData || {});
        const mod = session.modifiedData || {};

        const origCols = orig.columns || [];
        const modCols = mod.columns || [];
        const colsChanged = JSON.stringify(origCols) !== JSON.stringify(modCols);

        const origTrigs = orig.triggers || [];
        const modTrigs = mod.triggers || [];
        const trigsChanged = JSON.stringify(origTrigs) !== JSON.stringify(modTrigs);

        const origFks = orig.foreign_keys || [];
        const modFks = mod.foreign_keys || [];
        const fksChanged = JSON.stringify(origFks) !== JSON.stringify(modFks);

        const origIdxs = orig.indexes || [];
        const modIdxs = mod.indexes || [];
        const idxsChanged = JSON.stringify(origIdxs) !== JSON.stringify(modIdxs);

        const origUqs = orig.uniques || [];
        const modUqs = mod.uniques || [];
        const uqsChanged = JSON.stringify(origUqs) !== JSON.stringify(modUqs);

        const origChks = orig.checks || [];
        const modChks = mod.checks || [];
        const chksChanged = JSON.stringify(origChks) !== JSON.stringify(modChks);

        const items = [];

        // Fields
        items.push({
            type: 'fields',
            name: 'Fields (Cột dữ liệu)',
            count: modCols.length,
            modified: colsChanged,
            detail: colsChanged ? `Đã thay đổi cấu trúc (${modCols.length} cột)` : `Chưa thay đổi (${modCols.length} cột)`
        });

        // Triggers
        items.push({
            type: 'triggers',
            name: 'Triggers (Bộ kích hoạt)',
            count: origTrigs.length,
            modified: trigsChanged,
            detail: trigsChanged ? `Đã chỉnh sửa triggers (${modTrigs.length})` : (origTrigs.length > 0 ? `Chưa sửa (${origTrigs.length} trigger hiện có)` : 'Không có trigger')
        });

        // Foreign Keys
        items.push({
            type: 'foreign_keys',
            name: 'Foreign Keys (Khóa ngoại)',
            count: origFks.length,
            modified: fksChanged,
            detail: fksChanged ? `Đã chỉnh sửa foreign keys (${modFks.length})` : (origFks.length > 0 ? `Chưa sửa (${origFks.length} khóa ngoại hiện có)` : 'Không có khóa ngoại')
        });

        // Constraints
        const constrChanged = uqsChanged || chksChanged;
        const constrCount = (origUqs.length || 0) + (origChks.length || 0);
        items.push({
            type: 'constraints',
            name: 'Constraints (Unique / Check)',
            count: constrCount,
            modified: constrChanged,
            detail: constrChanged ? 'Đã chỉnh sửa constraints' : (constrCount > 0 ? `Chưa sửa (${constrCount} ràng buộc hiện có)` : 'Không có ràng buộc')
        });

        // Indexes
        items.push({
            type: 'indexes',
            name: 'Indexes (Chỉ mục)',
            count: origIdxs.length,
            modified: idxsChanged,
            detail: idxsChanged ? `Đã chỉnh sửa indexes (${modIdxs.length})` : (origIdxs.length > 0 ? `Chưa sửa (${origIdxs.length} index hiện có)` : 'Không có index')
        });

        // Warning if columns changed but triggers or foreign keys exist and were untouched
        const hasUnmodifiedAudit = colsChanged && ((origTrigs.length > 0 && !trigsChanged) || (origFks.length > 0 && !fksChanged));

        return { items, hasUnmodifiedAudit };
    }

    function showFieldsContextMenu(x, y, session) {
        const existing = document.getElementById('td-fields-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'td-fields-context-menu';
        menu.className = 'td-row-context-menu';

        const items = [
            { label: 'Thêm dòng mới (cuối)', shortcut: 'Ctrl+N', icon: 'fa-plus text-success', action: () => addNewColumn(session) },
            { label: 'Chèn thêm dòng mới (trên)', shortcut: 'Ctrl+Insert', icon: 'fa-arrow-turn-up text-info', action: () => insertColumnAbove(session) },
            { sep: true },
            { label: 'Sao chép dòng', shortcut: 'Ctrl+C', icon: 'fa-copy', action: () => copySelectedColumn(session) },
            { label: 'Sao chép tất cả các dòng', icon: 'fa-clone', action: () => copyAllColumns(session) },
            { label: 'Dán dòng', shortcut: 'Ctrl+V', icon: 'fa-paste', action: () => pasteColumns(session) },
            { sep: true },
            { label: 'Di chuyển lên', icon: 'fa-arrow-up', action: () => moveColumnUp(session) },
            { label: 'Di chuyển xuống', icon: 'fa-arrow-down', action: () => moveColumnDown(session) },
            { sep: true },
            {
                label: 'Khóa chính (Primary Key)',
                icon: 'fa-key text-warning',
                action: () => {
                    const sel = session.selectedFieldIndex;
                    if (sel >= 0 && sel < session.modifiedData.columns.length) {
                        const col = session.modifiedData.columns[sel];
                        col.is_pk = !col.is_pk;
                        if (col.is_pk) col.nullable = false;
                        markDirty(session);
                        renderDesigner(session);
                    }
                }
            },
            { sep: true },
            {
                label: 'Xóa dòng',
                shortcut: 'Delete',
                icon: 'fa-trash text-danger',
                action: () => {
                    const sel = session.selectedFieldIndex;
                    if (sel >= 0 && sel < session.modifiedData.columns.length) {
                        session.modifiedData.columns.splice(sel, 1);
                        session.selectedFieldIndex = Math.max(0, Math.min(sel, session.modifiedData.columns.length - 1));
                        markDirty(session);
                        renderDesigner(session);
                    }
                }
            }
        ];

        items.forEach(it => {
            if (it.sep) {
                const s = document.createElement('div');
                s.className = 'td-ctx-sep';
                menu.appendChild(s);
                return;
            }
            const el = document.createElement('div');
            el.className = 'td-ctx-item';
            el.innerHTML = `
                <i class="fa-solid ${it.icon || 'fa-circle'}" style="width: 14px;"></i>
                <span>${escapeHtml(it.label)}</span>
                ${it.shortcut ? `<span class="td-ctx-shortcut ms-auto">${escapeHtml(it.shortcut)}</span>` : ''}
            `;
            el.addEventListener('click', () => {
                menu.remove();
                it.action();
            });
            menu.appendChild(el);
        });

        document.body.appendChild(menu);
        menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 300)}px`;

        const dismiss = e => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', dismiss);
                document.removeEventListener('contextmenu', dismiss);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', dismiss);
            document.addEventListener('contextmenu', dismiss);
        }, 10);
    }

    // ── Activate Tab (Per-Tab Caching for Instant Zero-Lag Switch) ─────────
    function activateTab(tabId) {
        const session = designerSessions.get(tabId);
        if (!session) return;
        activeSession = session;

        const container = document.getElementById('table-designer-container');
        if (!container) return;

        // Clean any stray non-pane elements
        Array.from(container.children).forEach(child => {
            if (!child.classList.contains('td-tab-session-pane')) {
                child.remove();
            }
        });

        // Hide all session panes
        container.querySelectorAll('.td-tab-session-pane').forEach(p => p.classList.add('d-none'));

        // If session pane does not exist yet, build it
        let pane = session.domPane;
        if (!pane || !container.contains(pane)) {
            pane = getOrCreateSessionPane(container, tabId);
            session.domPane = pane;
        }

        pane.classList.remove('d-none');

        if (!session.isRendered) {
            renderDesigner(session);
        } else {
            // Already rendered: reveal pane instantly without DOM rebuild and layout Monaco editors
            setTimeout(() => {
                if (session.liveSqlEditor && typeof session.liveSqlEditor.layout === 'function') {
                    session.liveSqlEditor.layout();
                }
                if (session.activeSubTab === 'sql-preview' && session.previewEditor && typeof session.previewEditor.layout === 'function') {
                    session.previewEditor.layout();
                }
                if (session.activeSubTab === 'trigger' && session.triggerEditor && typeof session.triggerEditor.layout === 'function') {
                    session.triggerEditor.layout();
                }
            }, 20);
        }
    }

    // ── Close Tab Cleanup ────────────────────────────────────────────────────
    function closeTab(tabId) {
        const s = designerSessions.get(tabId);
        if (s) {
            if (s.liveSqlDebounceTimer) {
                clearTimeout(s.liveSqlDebounceTimer);
            }
            if (s.liveSqlEditor) { try { s.liveSqlEditor.dispose(); } catch (_) {} s.liveSqlEditor = null; }
            if (s.previewEditor) { try { s.previewEditor.dispose(); } catch (_) {} s.previewEditor = null; }
            if (s.triggerEditor) { try { s.triggerEditor.dispose(); } catch (_) {} s.triggerEditor = null; }
            if (s.domPane && s.domPane.parentNode) {
                s.domPane.remove();
                s.domPane = null;
            }
        }
        designerSessions.delete(tabId);
        if (activeSession && activeSession.tabId === tabId) {
            activeSession = null;
        }
    }

    // ── Live SQL Update Helper ───────────────────────────────────────────────
    function updateLiveSql(session) {
        if (!session.liveSqlEditor && !session.liveSqlCm) return;
        clearTimeout(session.liveSqlDebounceTimer);
        session.liveSqlDebounceTimer = setTimeout(async () => {
            const pane = session.domPane || document.getElementById('table-designer-container');
            const statusBadge = pane ? pane.querySelector('#td-live-sql-status') : document.getElementById('td-live-sql-status');
            if (statusBadge) {
                statusBadge.textContent = 'Updating...';
                statusBadge.className = 'badge bg-warning text-dark';
            }

            try {
                let script = '';
                const filter = session.liveSqlFilter || 'all';

                const res = await fetch(`/api/metadata/${session.connId}/table-design/diff`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        original: session.isNew ? {} : session.originalData,
                        modified: session.modifiedData
                    })
                });
                const j = await res.json();
                if (j.success) {
                    if (j.preview_sql && !session.previewSql) {
                        session.previewSql = j.preview_sql;
                    }
                    const diff = j.diff || {};
                    const stmts = diff.statements || [];

                    if (filter === 'all') {
                        if (stmts.length > 0 && diff.migration_sql && diff.migration_sql.trim()) {
                            script = diff.migration_sql;
                        } else {
                            // When no pending changes, display the full table definition DDL
                            const currentDdl = (session.previewSql || j.preview_sql || '').trim();
                            if (currentDdl) {
                                script = '-- No pending schema changes. Current table definition:\n\n' + currentDdl + '\n';
                            } else {
                                script = '-- No schema changes detected.\n';
                            }
                        }
                    } else {
                        const filteredStmts = stmts.filter(st => {
                            const stType = (typeof st === 'object' ? st.type : null) || 'tables';
                            if (filter === 'tables') return stType === 'tables' || stType === 'fields';
                            if (filter === 'constraints') return stType === 'constraints' || stType === 'foreign_keys';
                            return stType === filter;
                        });

                        if (filteredStmts.length === 0) {
                            const filterLabels = {
                                tables: 'Table & Columns',
                                constraints: 'Constraints',
                                indexes: 'Indexes',
                                triggers: 'Triggers'
                            };
                            script = `-- No pending changes for: ${filterLabels[filter] || filter}\n`;
                        } else {
                            const joinSep = session.dbType === 'sqlserver' ? '\n\nGO\n\n' : '\n\n';
                            const sqlList = filteredStmts.map(st => (typeof st === 'object' ? st.sql : st));
                            script = sqlList.join(joinSep) + (session.dbType === 'sqlserver' ? '\n\nGO\n' : '\n');
                        }
                    }
                } else {
                    script = `-- Diff error: ${j.error}`;
                }

                if (session.liveSqlEditor) {
                    session.liveSqlEditor.setValue(script);
                } else if (session.liveSqlCm) {
                    session.liveSqlCm.setValue(script);
                    if (typeof session.liveSqlCm.refresh === 'function') {
                        session.liveSqlCm.refresh();
                    }
                }

                if (statusBadge) {
                    statusBadge.textContent = 'Live';
                    statusBadge.className = 'badge bg-secondary';
                }
            } catch (err) {
                console.error('Error updating live SQL:', err);
                if (statusBadge) {
                    statusBadge.textContent = 'Error';
                    statusBadge.className = 'badge bg-danger';
                }
            }
        }, 300);
    }

    // ── Row Selection & Inspector In-Place Update (No Scroll Jump) ───────────
    function updateFieldInspector(session) {
        const container = session.domPane || document.getElementById('table-designer-container');
        if (!container) return;
        const cols = session.modifiedData.columns || [];
        const sel = session.selectedFieldIndex;
        const col = (sel >= 0 && sel < cols.length) ? cols[sel] : null;

        const inspDefault = container.querySelector('#td-insp-default');
        const inspCollation = container.querySelector('#td-insp-collation');
        const inspIsId = container.querySelector('#td-insp-is-identity');
        const inspIdBox = container.querySelector('#td-insp-identity-box');
        const inspSeed = container.querySelector('#td-insp-identity-seed');
        const inspInc = container.querySelector('#td-insp-identity-inc');
        const inspUseSeq = container.querySelector('#td-insp-use-sequence');
        const inspSeqBox = container.querySelector('#td-insp-seq-box');
        const inspSeqName = container.querySelector('#td-insp-sequence-name');

        if (inspDefault) {
            inspDefault.value = col?.default_value || '';
            inspDefault.disabled = !col;
        }
        if (inspCollation) {
            inspCollation.value = col?.collation || '';
            inspCollation.disabled = !col;
        }
        if (inspIsId) {
            inspIsId.checked = !!col?.is_identity;
            inspIsId.disabled = !col;
        }
        if (inspIdBox) {
            if (col?.is_identity) inspIdBox.classList.remove('d-none');
            else inspIdBox.classList.add('d-none');
        }
        if (inspSeed) inspSeed.value = col?.identity_seed ?? 1;
        if (inspInc) inspInc.value = col?.identity_increment ?? 1;

        if (inspUseSeq) {
            inspUseSeq.checked = !!col?.sequence_name;
            inspUseSeq.disabled = !col;
        }
        if (inspSeqBox) {
            if (col?.sequence_name) inspSeqBox.classList.remove('d-none');
            else inspSeqBox.classList.add('d-none');
        }
        if (inspSeqName) inspSeqName.value = col?.sequence_name || '';
    }

    function selectFieldRow(session, idx, isShift = false, isCtrl = false) {
        if (!session.selectedFieldIndices) {
            session.selectedFieldIndices = new Set([session.selectedFieldIndex || 0]);
        }
        const cols = session.modifiedData.columns || [];
        if (idx < 0 || idx >= cols.length) return;

        if (isShift) {
            const anchor = session.selectedFieldIndex >= 0 ? session.selectedFieldIndex : 0;
            const start = Math.min(anchor, idx);
            const end = Math.max(anchor, idx);
            session.selectedFieldIndices.clear();
            for (let i = start; i <= end; i++) {
                session.selectedFieldIndices.add(i);
            }
        } else if (isCtrl) {
            if (session.selectedFieldIndices.has(idx)) {
                session.selectedFieldIndices.delete(idx);
                if (session.selectedFieldIndices.size === 0) {
                    session.selectedFieldIndices.add(idx);
                }
            } else {
                session.selectedFieldIndices.add(idx);
            }
            session.selectedFieldIndex = idx;
        } else {
            session.selectedFieldIndices.clear();
            session.selectedFieldIndices.add(idx);
            session.selectedFieldIndex = idx;
        }

        const container = session.domPane || document.getElementById('table-designer-container');
        if (container) {
            const rows = container.querySelectorAll('#td-pane-fields tbody tr[data-field-index]');
            const isMulti = session.selectedFieldIndices.size > 1;
            rows.forEach(r => {
                const rIdx = parseInt(r.dataset.fieldIndex, 10);
                const isSelected = session.selectedFieldIndices.has(rIdx);
                if (isSelected) {
                    r.classList.add('selected');
                    if (isMulti) r.classList.add('selected-multi');
                    else r.classList.remove('selected-multi');
                } else {
                    r.classList.remove('selected', 'selected-multi');
                }
            });
            updateFieldInspector(session);
        }
    }

    // ── Mark Dirty State ─────────────────────────────────────────────────────
    function markDirty(session) {
        const isDirty = session.isNew || (JSON.stringify(session.originalData) !== JSON.stringify(session.modifiedData));
        if (window.AppTabs) {
            window.AppTabs.setTabDirty(session.tabId, isDirty);
        }
        const container = session.domPane || document;
        const saveBtns = container.querySelectorAll('.td-btn--save');
        saveBtns.forEach(btn => {
            btn.disabled = !isDirty;
        });
        updateLiveSql(session);
    }

    // ── Render Complete Designer Interface ──────────────────────────────────
    function renderDesigner(session) {
        let pane = session.domPane;
        if (!pane) {
            const container = document.getElementById('table-designer-container');
            if (container) {
                pane = getOrCreateSessionPane(container, session.tabId);
                session.domPane = pane;
            }
        }
        if (!pane) return;

        // Clean up previously instantiated Monaco editors for this session before rebuilding HTML
        if (session.triggerEditor) { try { session.triggerEditor.dispose(); } catch (_) {} session.triggerEditor = null; }
        if (session.previewEditor) { try { session.previewEditor.dispose(); } catch (_) {} session.previewEditor = null; }
        if (session.liveSqlEditor) { try { session.liveSqlEditor.dispose(); } catch (_) {} session.liveSqlEditor = null; }

        // Preserve scroll position of current active grid
        const prevGrid = pane.querySelector('.td-tab-pane.active .td-grid-wrapper');
        const prevScrollTop = prevGrid ? prevGrid.scrollTop : 0;
        const prevScrollLeft = prevGrid ? prevGrid.scrollLeft : 0;

        const isDirty = session.isNew || (JSON.stringify(session.originalData) !== JSON.stringify(session.modifiedData));
        const subTab = session.activeSubTab;

        pane.innerHTML = `
            <div class="d-flex flex-column h-100 overflow-hidden">
                <!-- Table Header Bar (Schema & Editable Table Name) -->
                <div class="td-header-bar">
                    <div class="d-flex align-items-center gap-2">
                        <i class="fa-solid ${session.isNew ? 'fa-table-circle-plus text-success' : 'fa-table text-info'}" style="font-size: 13px;"></i>
                        <span class="text-muted" style="font-size: 11px; font-weight: 600;">Schema:</span>
                        <span class="badge bg-secondary" style="font-size: 11px;">${escapeHtml(session.schema)}</span>
                        <span class="text-muted">.</span>
                        <span class="text-muted" style="font-size: 11px; font-weight: 600;">Table Name:</span>
                        <input type="text" id="td-table-name-input" class="form-control form-control-sm td-name-input" style="width: 220px; height: 26px; font-size: 12px; font-weight: 600;" value="${escapeHtml(session.table)}" placeholder="Table name..." />
                        ${session.isNew ? '<span class="badge bg-success" style="font-size: 10px;"><i class="fa-solid fa-sparkles me-1"></i>New Table</span>' : ''}
                    </div>
                    <div id="td-notification-area" class="text-info" style="font-size: 11px; transition: opacity 0.3s ease;"></div>
                </div>

                <!-- Tab Specific Toolbar -->
                <div class="td-toolbar">
                    <button class="td-btn td-btn--save" id="td-btn-save" ${isDirty ? '' : 'disabled'} title="Save and apply changes to database">
                        <i class="fa-solid fa-floppy-disk"></i> Save
                    </button>
                    <span class="td-btn-sep"></span>
                    <div id="td-tab-actions" class="d-flex align-items-center gap-1">
                        ${renderToolbarActions(session)}
                    </div>
                </div>

                <!-- 7 Nav Tabs (Strict order) -->
                <ul class="td-nav-tabs">
                    <li class="td-nav-item ${subTab === 'fields' ? 'active' : ''}" data-subtab="fields">Fields</li>
                    <li class="td-nav-item ${subTab === 'indexes' ? 'active' : ''}" data-subtab="indexes">Indexes</li>
                    <li class="td-nav-item ${subTab === 'foreign-keys' ? 'active' : ''}" data-subtab="foreign-keys">Foreign Keys</li>
                    <li class="td-nav-item ${subTab === 'uniques' ? 'active' : ''}" data-subtab="uniques">Uniques</li>
                    <li class="td-nav-item ${subTab === 'checks' ? 'active' : ''}" data-subtab="checks">Checks</li>
                    <li class="td-nav-item ${subTab === 'trigger' ? 'active' : ''}" data-subtab="trigger">Trigger</li>
                    <li class="td-nav-item ${subTab === 'sql-preview' ? 'active' : ''}" data-subtab="sql-preview">SQL Preview</li>
                </ul>

                <!-- Panes -->
                <div class="td-tab-pane ${subTab === 'fields' ? 'active' : ''}" id="td-pane-fields">
                    ${renderFieldsPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'indexes' ? 'active' : ''}" id="td-pane-indexes">
                    ${renderIndexesPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'foreign-keys' ? 'active' : ''}" id="td-pane-foreign-keys">
                    ${renderForeignKeysPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'uniques' ? 'active' : ''}" id="td-pane-uniques">
                    ${renderUniquesPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'checks' ? 'active' : ''}" id="td-pane-checks">
                    ${renderChecksPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'trigger' ? 'active' : ''}" id="td-pane-trigger">
                    ${renderTriggerPane(session)}
                </div>
                <div class="td-tab-pane ${subTab === 'sql-preview' ? 'active' : ''}" id="td-pane-sql-preview">
                    ${renderSqlPreviewPane(session)}
                </div>

                <!-- Persistent Live SQL Splitter & Pane (Always Visible in all tabs) -->
                <div class="td-splitter-h" id="td-bottom-splitter" title="Kéo để thay đổi kích thước"></div>
                <div class="td-live-sql-pane" id="td-live-sql-pane" style="height: ${session.sqlPanelHeight || 180}px;">
                    <div class="td-live-sql-header">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-code text-info"></i>
                            <span class="fw-semibold">SQL Script</span>
                            <span class="badge bg-secondary" style="font-size: 10px;" id="td-live-sql-status">Live</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <div class="d-flex align-items-center gap-1">
                                <label class="small text-muted me-1 mb-0" for="td-live-sql-filter" style="font-size: 11px;">Filter:</label>
                                <select class="form-select form-select-sm py-0 px-2" id="td-live-sql-filter" style="font-size: 11px; height: 22px; width: auto;">
                                    <option value="all" ${(session.liveSqlFilter || 'all') === 'all' ? 'selected' : ''}>All</option>
                                    <option value="tables" ${session.liveSqlFilter === 'tables' ? 'selected' : ''}>Tables</option>
                                    <option value="constraints" ${session.liveSqlFilter === 'constraints' ? 'selected' : ''}>Constraints</option>
                                    <option value="indexes" ${session.liveSqlFilter === 'indexes' ? 'selected' : ''}>Indexes</option>
                                    <option value="triggers" ${session.liveSqlFilter === 'triggers' ? 'selected' : ''}>Triggers</option>
                                </select>
                            </div>
                            <button type="button" class="btn btn-sm btn-link text-decoration-none text-muted p-0" id="td-btn-copy-live-sql" title="Sao chép SQL">
                                <i class="fa-solid fa-copy me-1"></i>Copy SQL
                            </button>
                        </div>
                    </div>
                    <div class="td-live-sql-cm-wrap">
                        <div class="td-live-sql-editor"></div>
                        <textarea id="td-live-sql-editor" class="d-none"></textarea>
                    </div>
                </div>

                <!-- Status Bar -->
                <div class="td-status-bar">
                    <span>Number of Fields: <strong>${session.modifiedData.columns.length}</strong></span>
                    ${renderStatusBarDetails(session)}
                </div>
            </div>
        `;

        // Restore scroll position
        const newGrid = pane.querySelector('.td-tab-pane.active .td-grid-wrapper');
        if (newGrid && prevScrollTop > 0) {
            newGrid.scrollTop = prevScrollTop;
            newGrid.scrollLeft = prevScrollLeft;
        }

        bindEvents(session, pane);
        session.isRendered = true;
    }

    // ── Dynamic Toolbar Actions per Tab ──────────────────────────────────────
    function renderToolbarActions(session) {
        switch (session.activeSubTab) {
            case 'fields':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-field" title="Add Field"><i class="fa-solid fa-circle-plus"></i> Add Field</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-field" title="Delete Selected Field"><i class="fa-solid fa-circle-minus"></i> Delete Field</button>
                    <span class="td-btn-sep"></span>
                    <button class="td-btn" id="td-act-move-up-field" title="Move Field Up"><i class="fa-solid fa-arrow-up"></i> Move Up</button>
                    <button class="td-btn" id="td-act-move-down-field" title="Move Field Down"><i class="fa-solid fa-arrow-down"></i> Move Down</button>
                    <span class="td-btn-sep"></span>
                    <button class="td-btn" id="td-act-copy-field" title="Copy Selected Field"><i class="fa-solid fa-copy"></i> Copy</button>
                    <button class="td-btn" id="td-act-copy-all-fields" title="Copy All Fields"><i class="fa-solid fa-clone"></i> Copy All</button>
                    <button class="td-btn" id="td-act-paste-fields" title="Paste Field(s)"><i class="fa-solid fa-paste"></i> Paste</button>
                    <span class="td-btn-sep"></span>
                    <button class="td-btn td-btn--pk" id="td-act-toggle-pk" title="Toggle Primary Key"><i class="fa-solid fa-key"></i> Primary Key</button>
                `;
            case 'indexes':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-idx"><i class="fa-solid fa-circle-plus"></i> Add Index</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-idx"><i class="fa-solid fa-circle-minus"></i> Delete Index</button>
                `;
            case 'foreign-keys':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-fk"><i class="fa-solid fa-circle-plus"></i> Add Foreign Key</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-fk"><i class="fa-solid fa-circle-minus"></i> Delete Foreign Key</button>
                `;
            case 'uniques':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-uq"><i class="fa-solid fa-circle-plus"></i> Add Unique</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-uq"><i class="fa-solid fa-circle-minus"></i> Delete Unique</button>
                `;
            case 'checks':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-chk"><i class="fa-solid fa-circle-plus"></i> Add Check</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-chk"><i class="fa-solid fa-circle-minus"></i> Delete Check</button>
                `;
            case 'trigger':
                return `
                    <button class="td-btn td-btn--add" id="td-act-add-trig"><i class="fa-solid fa-circle-plus"></i> Add Trigger</button>
                    <button class="td-btn td-btn--delete" id="td-act-del-trig"><i class="fa-solid fa-circle-minus"></i> Delete Trigger</button>
                `;
            default:
                return '';
        }
    }

    function renderStatusBarDetails(session) {
        switch (session.activeSubTab) {
            case 'indexes':
                return `<span>Number of Indexes: <strong>${session.modifiedData.indexes.length}</strong></span>`;
            case 'foreign-keys':
                return `<span>Number of Foreign Keys: <strong>${session.modifiedData.foreign_keys.length}</strong></span>`;
            case 'uniques':
                return `<span>Number of Uniques: <strong>${session.modifiedData.uniques.length}</strong></span>`;
            case 'checks':
                return `<span>Number of Checks: <strong>${session.modifiedData.checks.length}</strong></span>`;
            case 'trigger':
                return `<span>Number of Triggers: <strong>${session.modifiedData.triggers.length}</strong></span>`;
            default:
                return '';
        }
    }

    // ── 1. Fields Tab Pane ───────────────────────────────────────────────────
    function renderFieldsPane(session) {
        const cols = session.modifiedData.columns || [];
        const selIdx = session.selectedFieldIndex >= 0 && session.selectedFieldIndex < cols.length ? session.selectedFieldIndex : 0;
        const selectedCol = cols[selIdx] || null;
        if (!session.selectedFieldIndices) {
            session.selectedFieldIndices = new Set([selIdx]);
        }

        let rowsHtml = '';
        cols.forEach((col, idx) => {
            const isSel = session.selectedFieldIndices.has(idx);
            const isMulti = session.selectedFieldIndices.size > 1;
            const pkIcon = col.is_pk ? '<i class="fa-solid fa-key text-warning" title="Primary Key"></i>' : '';
            rowsHtml += `
                <tr class="${isSel ? (isMulti ? 'selected selected-multi' : 'selected') : ''}" data-field-index="${idx}" draggable="true">
                    <td class="td-col-drag" title="Kéo để di chuyển vị trí dòng">
                        <i class="fa-solid fa-grip-vertical td-drag-handle"></i>
                    </td>
                    <td style="width: 200px;">
                        <input type="text" class="td-input td-f-name" value="${escapeHtml(col.name)}" />
                    </td>
                    <td style="width: 140px;">
                        <select class="td-select td-f-type">
                            ${renderTypeOptions(session.supportedTypes, col.type)}
                        </select>
                    </td>
                    <td style="width: 80px;">
                        <input type="text" class="td-input td-f-size" value="${escapeHtml(col.size || '')}" />
                    </td>
                    <td style="width: 80px;">
                        <input type="text" class="td-input td-f-scale" value="${escapeHtml(col.scale || '')}" />
                    </td>
                    <td style="width: 65px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-f-notnull" ${!col.nullable ? 'checked' : ''} />
                    </td>
                    <td style="width: 45px; text-align: center;">
                        ${pkIcon}
                    </td>
                    <td>
                        <input type="text" class="td-input td-f-comment" value="${escapeHtml(col.comment || '')}" placeholder="" />
                    </td>
                </tr>
            `;
        });

        // Quick add row at bottom of Fields grid
        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="8">
                    <button class="td-quick-add-btn" id="td-quick-add-field" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm dòng mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        const collations = session.supportedTypes.collations || ['DATABASE_DEFAULT'];

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 28px; text-align: center;" title="Kéo để đổi vị trí"></th>
                            <th style="width: 200px;">Name</th>
                            <th style="width: 140px;">Type</th>
                            <th style="width: 80px;">Size</th>
                            <th style="width: 80px;">Scale</th>
                            <th style="width: 65px; text-align: center;">Not null</th>
                            <th style="width: 45px; text-align: center;">Key</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <!-- Bottom Property Inspector (Selected Field) -->
            <div class="td-inspector-pane">
                <div class="td-inspector-row">
                    <span class="td-inspector-label">Default:</span>
                    <div class="td-inspector-control">
                        <input type="text" id="td-insp-default" class="form-control form-control-sm td-insp-input" style="width: 240px; height: 24px; font-size: 11px;" value="${escapeHtml(selectedCol?.default_value || '')}" ${!selectedCol ? 'disabled' : ''} />
                        <label class="form-check-label text-muted d-flex align-items-center gap-1 ms-2" style="font-size: 11px;">
                            <input type="checkbox" id="td-insp-with-values" class="td-checkbox" /> With Values
                        </label>
                    </div>
                </div>
                <div class="td-inspector-row">
                    <span class="td-inspector-label">Collation:</span>
                    <div class="td-inspector-control">
                        <select id="td-insp-collation" class="form-select form-select-sm td-insp-select" style="width: 240px; height: 24px; font-size: 11px;" ${!selectedCol ? 'disabled' : ''}>
                            <option value="">(Default)</option>
                            ${collations.map(c => `<option value="${c}" ${selectedCol && selectedCol.collation === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="td-inspector-row">
                    <span class="td-inspector-label">Tự tăng:</span>
                    <div class="td-inspector-control d-flex align-items-center flex-wrap gap-2">
                        <!-- Identity option -->
                        <label class="form-check-label d-flex align-items-center gap-1" style="font-size: 11px;">
                            <input type="checkbox" id="td-insp-is-identity" class="td-checkbox" ${selectedCol?.is_identity ? 'checked' : ''} ${!selectedCol ? 'disabled' : ''} />
                            <span class="fw-semibold">Identity</span>
                        </label>
                        <div id="td-insp-identity-box" class="d-flex align-items-center gap-1 ${selectedCol?.is_identity ? '' : 'd-none'}">
                            <span class="text-muted" style="font-size: 10px;">Seed:</span>
                            <input type="number" id="td-insp-identity-seed" class="form-control form-control-sm td-insp-input" style="width: 60px; height: 22px; font-size: 11px;" value="${selectedCol?.identity_seed ?? 1}" min="1" />
                            <span class="text-muted ms-1" style="font-size: 10px;">Inc:</span>
                            <input type="number" id="td-insp-identity-inc" class="form-control form-control-sm td-insp-input" style="width: 60px; height: 22px; font-size: 11px;" value="${selectedCol?.identity_increment ?? 1}" min="1" />
                        </div>

                        <span class="text-muted mx-1">|</span>

                        <!-- Sequence option -->
                        <label class="form-check-label d-flex align-items-center gap-1" style="font-size: 11px;">
                            <input type="checkbox" id="td-insp-use-sequence" class="td-checkbox" ${selectedCol?.sequence_name ? 'checked' : ''} ${!selectedCol ? 'disabled' : ''} />
                            <span class="fw-semibold">Sequence</span>
                        </label>
                        <div id="td-insp-seq-box" class="d-flex align-items-center gap-1 ${selectedCol?.sequence_name ? '' : 'd-none'}">
                            <span class="text-muted" style="font-size: 10px;">Tên Seq:</span>
                            <input type="text" id="td-insp-sequence-name" class="form-control form-control-sm td-insp-input" style="width: 170px; height: 22px; font-size: 11px;" placeholder="schema.seq_name" value="${escapeHtml(selectedCol?.sequence_name || '')}" />
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ── 2. Indexes Tab Pane ──────────────────────────────────────────────────
    function renderIndexesPane(session) {
        const indexes = session.modifiedData.indexes || [];
        let rowsHtml = '';

        indexes.forEach((idx, i) => {
            const colsStr = (idx.fields || []).map(f => typeof f === 'object' ? f.column : f).join(', ');
            rowsHtml += `
                <tr data-index-i="${i}">
                    <td style="width: 220px;">
                        <input type="text" class="td-input td-idx-name" value="${escapeHtml(idx.name)}" />
                    </td>
                    <td>
                        <input type="text" class="td-input td-idx-fields" value="${escapeHtml(colsStr)}" placeholder="col1, col2" />
                    </td>
                    <td style="width: 140px;">
                        <select class="td-select td-idx-type">
                            <option value="NONCLUSTERED" ${idx.index_type === 'NONCLUSTERED' ? 'selected' : ''}>Nonclustered</option>
                            <option value="CLUSTERED" ${idx.index_type === 'CLUSTERED' ? 'selected' : ''}>Clustered</option>
                            <option value="BTREE" ${idx.index_type === 'BTREE' ? 'selected' : ''}>B-Tree</option>
                            <option value="HASH" ${idx.index_type === 'HASH' ? 'selected' : ''}>Hash</option>
                        </select>
                    </td>
                    <td style="width: 70px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-idx-unique" ${idx.is_unique ? 'checked' : ''} />
                    </td>
                    <td>
                        <input type="text" class="td-input td-idx-comment" value="${escapeHtml(idx.comment || '')}" />
                    </td>
                </tr>
            `;
        });

        if (indexes.length === 0) {
            rowsHtml = `<tr><td colspan="5" class="text-center text-muted py-3">No indexes defined.</td></tr>`;
        }

        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="5">
                    <button class="td-quick-add-btn" id="td-quick-add-idx" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm index mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 220px;">Name</th>
                            <th>Fields</th>
                            <th style="width: 140px;">Index Type</th>
                            <th style="width: 70px; text-align: center;">Unique</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    // ── 3. Foreign Keys Tab Pane ─────────────────────────────────────────────
    function renderForeignKeysPane(session) {
        const fks = session.modifiedData.foreign_keys || [];
        let rowsHtml = '';

        fks.forEach((fk, i) => {
            const colsStr = (fk.fields || []).join(', ');
            const refColsStr = (fk.ref_fields || []).join(', ');
            const onActions = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'];

            rowsHtml += `
                <tr data-fk-i="${i}">
                    <td style="width: 200px;">
                        <input type="text" class="td-input td-fk-name" value="${escapeHtml(fk.name)}" />
                    </td>
                    <td style="width: 130px;">
                        <input type="text" class="td-input td-fk-fields" value="${escapeHtml(colsStr)}" placeholder="local_col" />
                    </td>
                    <td style="width: 110px;">
                        <input type="text" class="td-input td-fk-ref-schema" value="${escapeHtml(fk.ref_schema || 'dbo')}" />
                    </td>
                    <td style="width: 140px;">
                        <input type="text" class="td-input td-fk-ref-table" value="${escapeHtml(fk.ref_table || '')}" placeholder="target_table" />
                    </td>
                    <td style="width: 130px;">
                        <input type="text" class="td-input td-fk-ref-fields" value="${escapeHtml(refColsStr)}" placeholder="target_col" />
                    </td>
                    <td style="width: 110px;">
                        <select class="td-select td-fk-del">
                            ${onActions.map(a => `<option value="${a}" ${fk.on_delete === a ? 'selected' : ''}>${a}</option>`).join('')}
                        </select>
                    </td>
                    <td style="width: 110px;">
                        <select class="td-select td-fk-upd">
                            ${onActions.map(a => `<option value="${a}" ${fk.on_update === a ? 'selected' : ''}>${a}</option>`).join('')}
                        </select>
                    </td>
                    <td style="width: 60px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-fk-enable" ${fk.is_enabled ? 'checked' : ''} />
                    </td>
                    <td style="width: 110px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-fk-rep" ${fk.not_for_replication ? 'checked' : ''} />
                    </td>
                    <td>
                        <input type="text" class="td-input td-fk-comment" value="${escapeHtml(fk.comment || '')}" />
                    </td>
                </tr>
            `;
        });

        if (fks.length === 0) {
            rowsHtml = `<tr><td colspan="10" class="text-center text-muted py-3">No foreign keys defined.</td></tr>`;
        }

        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="10">
                    <button class="td-quick-add-btn" id="td-quick-add-fk" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm foreign key mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 200px;">Name</th>
                            <th style="width: 130px;">Fields</th>
                            <th style="width: 110px;">Referenced Schema</th>
                            <th style="width: 140px;">Referenced Table</th>
                            <th style="width: 130px;">Referenced Fields</th>
                            <th style="width: 110px;">On Delete</th>
                            <th style="width: 110px;">On Update</th>
                            <th style="width: 60px; text-align: center;">Enable</th>
                            <th style="width: 110px; text-align: center;">Not for Replication</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    // ── 4. Uniques Tab Pane ──────────────────────────────────────────────────
    function renderUniquesPane(session) {
        const uniques = session.modifiedData.uniques || [];
        let rowsHtml = '';

        uniques.forEach((uq, i) => {
            const colsStr = (uq.fields || []).join(', ');
            rowsHtml += `
                <tr data-uq-i="${i}">
                    <td style="width: 240px;">
                        <input type="text" class="td-input td-uq-name" value="${escapeHtml(uq.name)}" />
                    </td>
                    <td>
                        <input type="text" class="td-input td-uq-fields" value="${escapeHtml(colsStr)}" placeholder="col1, col2" />
                    </td>
                    <td style="width: 90px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-uq-clustered" ${uq.is_clustered ? 'checked' : ''} />
                    </td>
                    <td>
                        <input type="text" class="td-input td-uq-comment" value="${escapeHtml(uq.comment || '')}" />
                    </td>
                </tr>
            `;
        });

        if (uniques.length === 0) {
            rowsHtml = `<tr><td colspan="4" class="text-center text-muted py-3">No unique keys defined.</td></tr>`;
        }

        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="4">
                    <button class="td-quick-add-btn" id="td-quick-add-uq" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm unique constraint mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 240px;">Name</th>
                            <th>Fields</th>
                            <th style="width: 90px; text-align: center;">Clustered</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    // ── 5. Checks Tab Pane ───────────────────────────────────────────────────
    function renderChecksPane(session) {
        const checks = session.modifiedData.checks || [];
        let rowsHtml = '';

        checks.forEach((chk, i) => {
            rowsHtml += `
                <tr data-chk-i="${i}">
                    <td style="width: 240px;">
                        <input type="text" class="td-input td-chk-name" value="${escapeHtml(chk.name)}" />
                    </td>
                    <td>
                        <input type="text" class="td-input td-chk-clause" value="${escapeHtml(chk.check_clause)}" placeholder="[Column] > 0" />
                    </td>
                    <td style="width: 70px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-chk-enable" ${chk.is_enabled ? 'checked' : ''} />
                    </td>
                    <td style="width: 120px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-chk-rep" ${chk.not_for_replication ? 'checked' : ''} />
                    </td>
                    <td>
                        <input type="text" class="td-input td-chk-comment" value="${escapeHtml(chk.comment || '')}" />
                    </td>
                </tr>
            `;
        });

        if (checks.length === 0) {
            rowsHtml = `<tr><td colspan="5" class="text-center text-muted py-3">No check constraints defined.</td></tr>`;
        }

        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="5">
                    <button class="td-quick-add-btn" id="td-quick-add-chk" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm check constraint mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 240px;">Name</th>
                            <th>Check</th>
                            <th style="width: 70px; text-align: center;">Enable</th>
                            <th style="width: 120px; text-align: center;">Not for Replication</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        `;
    }

    // ── 6. Trigger Tab Pane ──────────────────────────────────────────────────
    function renderTriggerPane(session) {
        const triggers = session.modifiedData.triggers || [];
        const selIdx = session.selectedTrigIndex >= 0 && session.selectedTrigIndex < triggers.length ? session.selectedTrigIndex : 0;
        let rowsHtml = '';

        triggers.forEach((tr, i) => {
            const isSel = i === selIdx;
            rowsHtml += `
                <tr class="${isSel ? 'selected' : ''}" data-trig-i="${i}">
                    <td style="width: 220px;">
                        <input type="text" class="td-input td-trig-name" value="${escapeHtml(tr.name)}" />
                    </td>
                    <td style="width: 110px;">
                        <select class="td-select td-trig-fires">
                            <option value="After" ${tr.fires === 'After' ? 'selected' : ''}>After</option>
                            <option value="Instead Of" ${tr.fires === 'Instead Of' ? 'selected' : ''}>Instead Of</option>
                            <option value="Before" ${tr.fires === 'Before' ? 'selected' : ''}>Before</option>
                        </select>
                    </td>
                    <td style="width: 60px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-trig-ins" ${tr.is_insert ? 'checked' : ''} />
                    </td>
                    <td style="width: 60px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-trig-upd" ${tr.is_update ? 'checked' : ''} />
                    </td>
                    <td style="width: 60px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-trig-del" ${tr.is_delete ? 'checked' : ''} />
                    </td>
                    <td style="width: 60px; text-align: center;">
                        <input type="checkbox" class="td-checkbox td-trig-enable" ${tr.is_enabled ? 'checked' : ''} />
                    </td>
                    <td>
                        <input type="text" class="td-input td-trig-comment" value="${escapeHtml(tr.comment || '')}" />
                    </td>
                </tr>
            `;
        });

        if (triggers.length === 0) {
            rowsHtml = `<tr><td colspan="7" class="text-center text-muted py-3">No triggers defined.</td></tr>`;
        }

        rowsHtml += `
            <tr class="td-quick-add-row">
                <td colspan="7">
                    <button class="td-quick-add-btn" id="td-quick-add-trig" type="button">
                        <i class="fa-solid fa-plus text-success"></i> Thêm trigger mới <span class="td-ctx-shortcut ms-2">Ctrl+N</span>
                    </button>
                </td>
            </tr>
        `;

        return `
            <div class="td-grid-wrapper">
                <table class="td-table">
                    <thead>
                        <tr>
                            <th style="width: 220px;">Name</th>
                            <th style="width: 110px;">Fires</th>
                            <th style="width: 60px; text-align: center;">Insert</th>
                            <th style="width: 60px; text-align: center;">Update</th>
                            <th style="width: 60px; text-align: center;">Delete</th>
                            <th style="width: 60px; text-align: center;">Enable</th>
                            <th>Comment</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>

            <!-- Bottom Trigger Definition CodeMirror/Monaco Panel -->
            <div class="td-trigger-def-pane">
                <div class="td-subtab-header">
                    <span class="td-subtab-item active"><i class="fa-solid fa-code me-1"></i>Definition</span>
                </div>
                <div class="td-trigger-cm-wrap">
                    <div class="td-trigger-def-editor"></div>
                    <textarea id="td-trigger-def-editor" class="d-none"></textarea>
                </div>
            </div>
        `;
    }

    // ── 7. SQL Preview Tab Pane ──────────────────────────────────────────────
    function renderSqlPreviewPane(session) {
        return `
            <div class="td-preview-wrap">
                <div class="td-sql-preview-editor"></div>
                <textarea id="td-sql-preview-editor" class="d-none"></textarea>
                <div class="td-preview-footer">
                    <span class="text-muted">SQL Preview for "Save"</span>
                </div>
            </div>
        `;
    }

    // ── Event Bindings ───────────────────────────────────────────────────────
    function bindEvents(session, pane) {
        const container = pane || session.domPane || document.getElementById('table-designer-container');
        if (!container) return;

        // Sub-tabs click
        container.querySelectorAll('.td-nav-item').forEach(item => {
            item.addEventListener('click', async () => {
                const targetSubTab = item.dataset.subtab;
                session.activeSubTab = targetSubTab;

                // If moving to SQL Preview, fetch fresh preview from backend
                if (targetSubTab === 'sql-preview') {
                    try {
                        const res = await fetch(`/api/metadata/${session.connId}/table-design/preview`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(session.modifiedData)
                        });
                        const j = await res.json();
                        if (j.success) session.previewSql = j.preview_sql;
                    } catch (e) {
                        console.error('Failed to refresh SQL preview:', e);
                    }
                }

                renderDesigner(session);
            });
        });

        // Table Name Input
        const tableNameInput = container.querySelector('#td-table-name-input');
        if (tableNameInput) {
            tableNameInput.addEventListener('input', e => {
                const val = e.target.value.trim() || 'Untitled';
                session.table = val;
                session.modifiedData.table = val;
                markDirty(session);
                if (window.AppTabs) {
                    const title = session.isNew ? `New Table: ${val}` : `Design: [${session.schema}].[${val}]`;
                    window.AppTabs.updateTabTitle(session.tabId, title);
                }
            });
        }

        // Save button
        const saveBtn = container.querySelector('#td-btn-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => openSaveConfirmationModal(session));
        }

        // Keyboard shortcuts within designer: Ctrl+N (Add row at end), Ctrl+Insert (Insert row above)
        container.tabIndex = 0;
        container.onkeydown = (e) => {
            const isCtrl = (e.ctrlKey || e.metaKey) && !e.altKey;
            const targetTag = e.target.tagName;
            const isEditingText = (targetTag === 'INPUT' && e.target.type === 'text') || targetTag === 'TEXTAREA';

            if (isCtrl && !e.shiftKey && (e.key.toLowerCase() === 'n' || e.code === 'KeyN')) {
                e.preventDefault();
                e.stopPropagation();
                addNewItemForActiveSubTab(session);
                return;
            }
            if (isCtrl && !e.shiftKey && (e.key === 'Insert' || e.code === 'Insert')) {
                e.preventDefault();
                e.stopPropagation();
                insertItemAboveForActiveSubTab(session);
                return;
            }

            // In Fields tab: Multi-row Ctrl+A, Ctrl+C, Ctrl+V
            if (session.activeSubTab === 'fields') {
                if (isCtrl && !e.shiftKey && (e.key.toLowerCase() === 'a' || e.code === 'KeyA') && !isEditingText) {
                    e.preventDefault();
                    e.stopPropagation();
                    copyAllColumns(session);
                    return;
                }
                if (isCtrl && !e.shiftKey && (e.key.toLowerCase() === 'c' || e.code === 'KeyC') && !isEditingText) {
                    e.preventDefault();
                    e.stopPropagation();
                    copySelectedColumn(session);
                    return;
                }
                if (isCtrl && !e.shiftKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV') && !isEditingText) {
                    e.preventDefault();
                    e.stopPropagation();
                    pasteColumns(session);
                    return;
                }
            }
        };

        // Quick add buttons at bottom of grids
        container.querySelector('#td-quick-add-field')?.addEventListener('click', () => addNewColumn(session));
        container.querySelector('#td-quick-add-idx')?.addEventListener('click', () => addNewIndex(session));
        container.querySelector('#td-quick-add-fk')?.addEventListener('click', () => addNewForeignKey(session));
        container.querySelector('#td-quick-add-uq')?.addEventListener('click', () => addNewUnique(session));
        container.querySelector('#td-quick-add-chk')?.addEventListener('click', () => addNewCheck(session));
        container.querySelector('#td-quick-add-trig')?.addEventListener('click', () => addNewTrigger(session));

        // Toolbar: Fields actions
        const addFieldBtn = container.querySelector('#td-act-add-field');
        if (addFieldBtn) {
            addFieldBtn.addEventListener('click', () => addNewColumn(session));
        }

        const delFieldBtn = container.querySelector('#td-act-del-field');
        if (delFieldBtn) {
            delFieldBtn.addEventListener('click', () => {
                const cols = session.modifiedData.columns;
                if (session.selectedFieldIndices && session.selectedFieldIndices.size > 1) {
                    const sorted = Array.from(session.selectedFieldIndices).sort((a, b) => b - a);
                    sorted.forEach(i => {
                        if (i >= 0 && i < cols.length) cols.splice(i, 1);
                    });
                    session.selectedFieldIndex = Math.max(0, Math.min(session.selectedFieldIndex, cols.length - 1));
                    session.selectedFieldIndices = new Set([session.selectedFieldIndex]);
                } else {
                    const sel = session.selectedFieldIndex;
                    if (sel >= 0 && sel < cols.length) {
                        cols.splice(sel, 1);
                        session.selectedFieldIndex = Math.max(0, Math.min(sel, cols.length - 1));
                        session.selectedFieldIndices = new Set([session.selectedFieldIndex]);
                    }
                }
                markDirty(session);
                renderDesigner(session);
            });
        }

        const moveUpBtn = container.querySelector('#td-act-move-up-field');
        if (moveUpBtn) {
            moveUpBtn.addEventListener('click', () => moveColumnUp(session));
        }

        const moveDownBtn = container.querySelector('#td-act-move-down-field');
        if (moveDownBtn) {
            moveDownBtn.addEventListener('click', () => moveColumnDown(session));
        }

        const copyFieldBtn = container.querySelector('#td-act-copy-field');
        if (copyFieldBtn) {
            copyFieldBtn.addEventListener('click', () => copySelectedColumn(session));
        }

        const copyAllFieldsBtn = container.querySelector('#td-act-copy-all-fields');
        if (copyAllFieldsBtn) {
            copyAllFieldsBtn.addEventListener('click', () => copyAllColumns(session));
        }

        const pasteFieldsBtn = container.querySelector('#td-act-paste-fields');
        if (pasteFieldsBtn) {
            pasteFieldsBtn.addEventListener('click', () => pasteColumns(session));
        }

        const pkBtn = container.querySelector('#td-act-toggle-pk');
        if (pkBtn) {
            pkBtn.addEventListener('click', () => {
                const sel = session.selectedFieldIndex;
                if (sel >= 0 && sel < session.modifiedData.columns.length) {
                    const col = session.modifiedData.columns[sel];
                    col.is_pk = !col.is_pk;
                    if (col.is_pk) col.nullable = false;
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Toolbar: Indexes actions
        const addIdxBtn = container.querySelector('#td-act-add-idx');
        if (addIdxBtn) {
            addIdxBtn.addEventListener('click', () => addNewIndex(session));
        }

        const delIdxBtn = container.querySelector('#td-act-del-idx');
        if (delIdxBtn) {
            delIdxBtn.addEventListener('click', () => {
                if (session.modifiedData.indexes.length > 0) {
                    session.modifiedData.indexes.pop();
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Toolbar: Foreign Keys actions
        const addFkBtn = container.querySelector('#td-act-add-fk');
        if (addFkBtn) {
            addFkBtn.addEventListener('click', () => addNewForeignKey(session));
        }

        const delFkBtn = container.querySelector('#td-act-del-fk');
        if (delFkBtn) {
            delFkBtn.addEventListener('click', () => {
                if (session.modifiedData.foreign_keys.length > 0) {
                    session.modifiedData.foreign_keys.pop();
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Toolbar: Uniques actions
        const addUqBtn = container.querySelector('#td-act-add-uq');
        if (addUqBtn) {
            addUqBtn.addEventListener('click', () => addNewUnique(session));
        }

        const delUqBtn = container.querySelector('#td-act-del-uq');
        if (delUqBtn) {
            delUqBtn.addEventListener('click', () => {
                if (session.modifiedData.uniques.length > 0) {
                    session.modifiedData.uniques.pop();
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Toolbar: Checks actions
        const addChkBtn = container.querySelector('#td-act-add-chk');
        if (addChkBtn) {
            addChkBtn.addEventListener('click', () => addNewCheck(session));
        }

        const delChkBtn = container.querySelector('#td-act-del-chk');
        if (delChkBtn) {
            delChkBtn.addEventListener('click', () => {
                if (session.modifiedData.checks.length > 0) {
                    session.modifiedData.checks.pop();
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Toolbar: Trigger actions
        const addTrigBtn = container.querySelector('#td-act-add-trig');
        if (addTrigBtn) {
            addTrigBtn.addEventListener('click', () => addNewTrigger(session));
        }

        const delTrigBtn = container.querySelector('#td-act-del-trig');
        if (delTrigBtn) {
            delTrigBtn.addEventListener('click', () => {
                if (session.modifiedData.triggers.length > 0) {
                    session.modifiedData.triggers.splice(session.selectedTrigIndex, 1);
                    session.selectedTrigIndex = Math.max(0, session.selectedTrigIndex - 1);
                    markDirty(session);
                    renderDesigner(session);
                }
            });
        }

        // Fields table row selection and inline edits
        container.querySelectorAll('#td-pane-fields tbody tr[data-field-index]').forEach(tr => {
            const idx = parseInt(tr.dataset.fieldIndex, 10);

            tr.addEventListener('click', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                    if (session.selectedFieldIndex !== idx) {
                        selectFieldRow(session, idx, false, false);
                    }
                    return;
                }
                selectFieldRow(session, idx, e.shiftKey, e.ctrlKey || e.metaKey);
            });

            tr.addEventListener('focusin', () => {
                if (session.selectedFieldIndex !== idx) {
                    selectFieldRow(session, idx, false, false);
                }
            });

            // Drag and Drop row reordering
            tr.addEventListener('dragstart', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                    e.preventDefault();
                    return;
                }
                e.dataTransfer.setData('text/plain', idx.toString());
                e.dataTransfer.effectAllowed = 'move';
                tr.classList.add('td-row-dragging');
            });

            tr.addEventListener('dragend', () => {
                tr.classList.remove('td-row-dragging');
                container.querySelectorAll('.td-drag-over-top, .td-drag-over-bottom').forEach(el => {
                    el.classList.remove('td-drag-over-top', 'td-drag-over-bottom');
                });
            });

            tr.addEventListener('dragover', e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = tr.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) {
                    tr.classList.add('td-drag-over-top');
                    tr.classList.remove('td-drag-over-bottom');
                } else {
                    tr.classList.add('td-drag-over-bottom');
                    tr.classList.remove('td-drag-over-top');
                }
            });

            tr.addEventListener('dragleave', () => {
                tr.classList.remove('td-drag-over-top', 'td-drag-over-bottom');
            });

            tr.addEventListener('drop', e => {
                e.preventDefault();
                tr.classList.remove('td-drag-over-top', 'td-drag-over-bottom');
                const srcIdxStr = e.dataTransfer.getData('text/plain');
                if (!srcIdxStr) return;
                const srcIdx = parseInt(srcIdxStr, 10);
                const targetIdx = parseInt(tr.dataset.fieldIndex, 10);
                if (isNaN(srcIdx) || isNaN(targetIdx) || srcIdx === targetIdx) return;

                const rect = tr.getBoundingClientRect();
                const insertBefore = e.clientY < (rect.top + rect.height / 2);
                let finalTarget = targetIdx;
                if (!insertBefore && targetIdx < srcIdx) finalTarget = targetIdx + 1;
                if (insertBefore && targetIdx > srcIdx) finalTarget = targetIdx - 1;

                const cols = session.modifiedData.columns;
                const [moved] = cols.splice(srcIdx, 1);
                cols.splice(finalTarget, 0, moved);
                session.selectedFieldIndex = finalTarget;
                session.selectedFieldIndices = new Set([finalTarget]);
                markDirty(session);
                renderDesigner(session);
            });

            tr.addEventListener('contextmenu', e => {
                e.preventDefault();
                e.stopPropagation();
                if (!session.selectedFieldIndices || !session.selectedFieldIndices.has(idx)) {
                    selectFieldRow(session, idx, false, false);
                }
                showFieldsContextMenu(e.clientX, e.clientY, session);
            });

            const col = session.modifiedData.columns[idx];
            if (!col) return;

            tr.querySelector('.td-f-name')?.addEventListener('input', e => {
                col.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-f-type')?.addEventListener('change', e => {
                col.type = e.target.value;
                markDirty(session);
            });
            tr.querySelector('.td-f-size')?.addEventListener('input', e => {
                col.size = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-f-scale')?.addEventListener('input', e => {
                col.scale = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-f-notnull')?.addEventListener('change', e => {
                col.nullable = !e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-f-comment')?.addEventListener('input', e => {
                col.comment = e.target.value;
                markDirty(session);
            });
        });

        // Field Inspector: Default & Collation & Identity & Sequence
        const inspDefault = container.querySelector('#td-insp-default');
        if (inspDefault) {
            inspDefault.addEventListener('input', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (col) {
                    col.default_value = e.target.value.trim();
                    markDirty(session);
                }
            });
        }

        const inspCollation = container.querySelector('#td-insp-collation');
        if (inspCollation) {
            inspCollation.addEventListener('change', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (col) {
                    col.collation = e.target.value;
                    markDirty(session);
                }
            });
        }

        const inspIsIdentity = container.querySelector('#td-insp-is-identity');
        const inspIdentityBox = container.querySelector('#td-insp-identity-box');
        const inspSeed = container.querySelector('#td-insp-identity-seed');
        const inspInc = container.querySelector('#td-insp-identity-inc');
        const inspUseSeq = container.querySelector('#td-insp-use-sequence');
        const inspSeqBox = container.querySelector('#td-insp-seq-box');
        const inspSeqName = container.querySelector('#td-insp-sequence-name');

        if (inspIsIdentity) {
            inspIsIdentity.addEventListener('change', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (!col) return;
                col.is_identity = e.target.checked;
                if (col.is_identity) {
                    col.nullable = false;
                    col.sequence_name = '';
                    if (inspUseSeq) inspUseSeq.checked = false;
                    if (inspSeqBox) inspSeqBox.classList.add('d-none');
                    if (inspIdentityBox) inspIdentityBox.classList.remove('d-none');
                    const tr = container.querySelector(`#td-pane-fields tbody tr[data-field-index="${session.selectedFieldIndex}"]`);
                    if (tr) {
                        const notnullCb = tr.querySelector('.td-f-notnull');
                        if (notnullCb) notnullCb.checked = true;
                    }
                } else {
                    if (inspIdentityBox) inspIdentityBox.classList.add('d-none');
                }
                markDirty(session);
            });
        }

        if (inspSeed) {
            inspSeed.addEventListener('input', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (col) {
                    col.identity_seed = parseInt(e.target.value, 10) || 1;
                    markDirty(session);
                }
            });
        }

        if (inspInc) {
            inspInc.addEventListener('input', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (col) {
                    col.identity_increment = parseInt(e.target.value, 10) || 1;
                    markDirty(session);
                }
            });
        }

        if (inspUseSeq) {
            inspUseSeq.addEventListener('change', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (!col) return;
                if (e.target.checked) {
                    col.sequence_name = col.sequence_name || (session.dbType === 'postgresql' ? `${session.table}_${col.name}_seq` : `seq_${session.table}_${col.name}`);
                    col.is_identity = false;
                    if (inspIsIdentity) inspIsIdentity.checked = false;
                    if (inspIdentityBox) inspIdentityBox.classList.add('d-none');
                    if (inspSeqBox) inspSeqBox.classList.remove('d-none');
                    if (inspSeqName) inspSeqName.value = col.sequence_name;
                } else {
                    col.sequence_name = '';
                    if (inspSeqBox) inspSeqBox.classList.add('d-none');
                }
                markDirty(session);
            });
        }

        if (inspSeqName) {
            inspSeqName.addEventListener('input', e => {
                const col = session.modifiedData.columns[session.selectedFieldIndex];
                if (col) {
                    col.sequence_name = e.target.value.trim();
                    markDirty(session);
                }
            });
        }

        // Indexes inline edits
        container.querySelectorAll('#td-pane-indexes tbody tr').forEach(tr => {
            const i = parseInt(tr.dataset.indexI, 10);
            const idxObj = session.modifiedData.indexes[i];
            if (!idxObj) return;

            tr.querySelector('.td-idx-name')?.addEventListener('input', e => {
                idxObj.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-idx-fields')?.addEventListener('input', e => {
                const split = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                idxObj.fields = split;
                markDirty(session);
            });
            tr.querySelector('.td-idx-type')?.addEventListener('change', e => {
                idxObj.index_type = e.target.value;
                markDirty(session);
            });
            tr.querySelector('.td-idx-unique')?.addEventListener('change', e => {
                idxObj.is_unique = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-idx-comment')?.addEventListener('input', e => {
                idxObj.comment = e.target.value;
                markDirty(session);
            });
        });

        // Foreign keys inline edits
        container.querySelectorAll('#td-pane-foreign-keys tbody tr').forEach(tr => {
            const i = parseInt(tr.dataset.fkI, 10);
            const fk = session.modifiedData.foreign_keys[i];
            if (!fk) return;

            tr.querySelector('.td-fk-name')?.addEventListener('input', e => {
                fk.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-fk-fields')?.addEventListener('input', e => {
                fk.fields = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                markDirty(session);
            });
            tr.querySelector('.td-fk-ref-schema')?.addEventListener('input', e => {
                fk.ref_schema = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-fk-ref-table')?.addEventListener('input', e => {
                fk.ref_table = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-fk-ref-fields')?.addEventListener('input', e => {
                fk.ref_fields = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                markDirty(session);
            });
            tr.querySelector('.td-fk-del')?.addEventListener('change', e => {
                fk.on_delete = e.target.value;
                markDirty(session);
            });
            tr.querySelector('.td-fk-upd')?.addEventListener('change', e => {
                fk.on_update = e.target.value;
                markDirty(session);
            });
            tr.querySelector('.td-fk-enable')?.addEventListener('change', e => {
                fk.is_enabled = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-fk-rep')?.addEventListener('change', e => {
                fk.not_for_replication = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-fk-comment')?.addEventListener('input', e => {
                fk.comment = e.target.value;
                markDirty(session);
            });
        });

        // Uniques inline edits
        container.querySelectorAll('#td-pane-uniques tbody tr').forEach(tr => {
            const i = parseInt(tr.dataset.uqI, 10);
            const uq = session.modifiedData.uniques[i];
            if (!uq) return;

            tr.querySelector('.td-uq-name')?.addEventListener('input', e => {
                uq.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-uq-fields')?.addEventListener('input', e => {
                uq.fields = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                markDirty(session);
            });
            tr.querySelector('.td-uq-clustered')?.addEventListener('change', e => {
                uq.is_clustered = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-uq-comment')?.addEventListener('input', e => {
                uq.comment = e.target.value;
                markDirty(session);
            });
        });

        // Checks inline edits
        container.querySelectorAll('#td-pane-checks tbody tr').forEach(tr => {
            const i = parseInt(tr.dataset.chkI, 10);
            const chk = session.modifiedData.checks[i];
            if (!chk) return;

            tr.querySelector('.td-chk-name')?.addEventListener('input', e => {
                chk.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-chk-clause')?.addEventListener('input', e => {
                chk.check_clause = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-chk-enable')?.addEventListener('change', e => {
                chk.is_enabled = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-chk-rep')?.addEventListener('change', e => {
                chk.not_for_replication = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-chk-comment')?.addEventListener('input', e => {
                chk.comment = e.target.value;
                markDirty(session);
            });
        });

        // Trigger selection and inline edits
        container.querySelectorAll('#td-pane-trigger tbody tr').forEach(tr => {
            tr.addEventListener('click', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                const idx = parseInt(tr.dataset.trigI, 10);
                session.selectedTrigIndex = idx;
                renderDesigner(session);
            });

            const i = parseInt(tr.dataset.trigI, 10);
            const trig = session.modifiedData.triggers[i];
            if (!trig) return;

            tr.querySelector('.td-trig-name')?.addEventListener('input', e => {
                trig.name = e.target.value.trim();
                markDirty(session);
            });
            tr.querySelector('.td-trig-fires')?.addEventListener('change', e => {
                trig.fires = e.target.value;
                markDirty(session);
            });
            tr.querySelector('.td-trig-ins')?.addEventListener('change', e => {
                trig.is_insert = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-trig-upd')?.addEventListener('change', e => {
                trig.is_update = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-trig-del')?.addEventListener('change', e => {
                trig.is_delete = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-trig-enable')?.addEventListener('change', e => {
                trig.is_enabled = e.target.checked;
                markDirty(session);
            });
            tr.querySelector('.td-trig-comment')?.addEventListener('input', e => {
                trig.comment = e.target.value;
                markDirty(session);
            });
        });

        // Trigger Definition Editor (Monaco with CodeMirror fallback)
        if (session.activeSubTab === 'trigger') {
            const curTrig = session.modifiedData.triggers[session.selectedTrigIndex] || null;
            const trigVal = curTrig ? (curTrig.definition || '') : '';
            const trigMonacoDiv = container.querySelector('.td-trigger-def-editor');
            const trigDefArea = container.querySelector('#td-trigger-def-editor');

            if (trigMonacoDiv && typeof monaco !== 'undefined' && monaco.editor) {
                session.triggerEditor = createMonacoEditor(trigMonacoDiv, {
                    value: trigVal,
                    readOnly: !curTrig
                });
                if (session.triggerEditor) {
                    session.triggerEditor.onDidChangeModelContent(() => {
                        if (curTrig) {
                            curTrig.definition = session.triggerEditor.getValue();
                            markDirty(session);
                        }
                    });
                }
            } else if (trigDefArea && window.CodeMirror) {
                session.triggerCm = window.CodeMirror.fromTextArea(trigDefArea, {
                    mode: 'text/x-sql',
                    theme: getCodeMirrorTheme(),
                    lineNumbers: true,
                    matchBrackets: true,
                    readOnly: !curTrig
                });
                session.triggerCm.setValue(trigVal);
                session.triggerCm.on('change', cm => {
                    if (curTrig) {
                        curTrig.definition = cm.getValue();
                        markDirty(session);
                    }
                });
                setTimeout(() => session.triggerCm.refresh(), 50);
            }
        }

        // SQL Preview Editor (Monaco with CodeMirror fallback)
        if (session.activeSubTab === 'sql-preview') {
            const prevMonacoDiv = container.querySelector('.td-sql-preview-editor');
            const previewArea = container.querySelector('#td-sql-preview-editor');
            const prevVal = session.previewSql || '-- No preview available\n';

            if (prevMonacoDiv && typeof monaco !== 'undefined' && monaco.editor) {
                session.previewEditor = createMonacoEditor(prevMonacoDiv, {
                    value: prevVal,
                    readOnly: true
                });
            } else if (previewArea && window.CodeMirror) {
                session.previewCm = window.CodeMirror.fromTextArea(previewArea, {
                    mode: 'text/x-sql',
                    theme: getCodeMirrorTheme(),
                    lineNumbers: true,
                    readOnly: true
                });
                session.previewCm.setValue(prevVal);
                setTimeout(() => session.previewCm.refresh(), 50);
            }
        }

        // Persistent Live SQL Editor (Monaco with CodeMirror fallback)
        const liveSqlMonacoDiv = container.querySelector('.td-live-sql-editor');
        const liveSqlArea = container.querySelector('#td-live-sql-editor');
        if (liveSqlMonacoDiv && typeof monaco !== 'undefined' && monaco.editor) {
            session.liveSqlEditor = createMonacoEditor(liveSqlMonacoDiv, {
                value: '-- Generating SQL script...\n',
                readOnly: true
            });
            updateLiveSql(session);
        } else if (liveSqlArea && window.CodeMirror && typeof window.CodeMirror.fromTextArea === 'function') {
            session.liveSqlCm = window.CodeMirror.fromTextArea(liveSqlArea, {
                mode: 'text/x-sql',
                theme: getCodeMirrorTheme(),
                lineNumbers: true,
                readOnly: true
            });
            updateLiveSql(session);
            setTimeout(() => {
                if (session.liveSqlCm && typeof session.liveSqlCm.refresh === 'function') {
                    session.liveSqlCm.refresh();
                }
            }, 60);
        } else if (liveSqlArea) {
            liveSqlArea.classList.remove('d-none');
            session.liveSqlCm = {
                setValue: (val) => { liveSqlArea.value = val; },
                getValue: () => liveSqlArea.value,
                refresh: () => {},
                setOption: () => {}
            };
            updateLiveSql(session);
        }

        // If Monaco loads slightly after initial render, upgrade to Monaco automatically
        if (typeof monaco === 'undefined' || !monaco.editor) {
            if (typeof window._onMonacoReady === 'function') {
                window._onMonacoReady(() => {
                    if (activeSession === session && session.domPane && !session.liveSqlEditor) {
                        renderDesigner(session);
                    }
                });
            }
        }

        // Copy Live SQL Button
        const copyLiveSqlBtn = container.querySelector('#td-btn-copy-live-sql');
        if (copyLiveSqlBtn) {
            copyLiveSqlBtn.addEventListener('click', () => {
                const sql = session.liveSqlEditor ? session.liveSqlEditor.getValue() : (session.liveSqlCm ? session.liveSqlCm.getValue() : '');
                if (sql) {
                    if (window.copyToClipboard) {
                        window.copyToClipboard(sql);
                    } else {
                        navigator.clipboard?.writeText(sql);
                    }
                    showDesignerNotification('Copied SQL script to clipboard.');
                }
            });
        }

        // Filter Live SQL Dropdown
        const liveSqlFilterSelect = container.querySelector('#td-live-sql-filter');
        if (liveSqlFilterSelect) {
            liveSqlFilterSelect.addEventListener('change', e => {
                session.liveSqlFilter = e.target.value;
                updateLiveSql(session);
            });
        }

        // Splitter Drag Handle for Live SQL Pane
        const splitter = container.querySelector('#td-bottom-splitter');
        const liveSqlPane = container.querySelector('#td-live-sql-pane');
        if (splitter && liveSqlPane) {
            splitter.addEventListener('mousedown', e => {
                e.preventDefault();
                const startY = e.clientY;
                const startHeight = liveSqlPane.offsetHeight;
                splitter.classList.add('resizing');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';

                function onMouseMove(me) {
                    const delta = startY - me.clientY;
                    const maxH = (container.offsetHeight || 600) - 150;
                    const newH = Math.max(60, Math.min(startHeight + delta, maxH));
                    session.sqlPanelHeight = newH;
                    liveSqlPane.style.height = `${newH}px`;
                    if (session.liveSqlEditor) session.liveSqlEditor.layout();
                    else if (session.liveSqlCm) session.liveSqlCm.refresh();
                }

                function onMouseUp() {
                    splitter.classList.remove('resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    if (session.liveSqlEditor) session.liveSqlEditor.layout();
                    else if (session.liveSqlCm) session.liveSqlCm.refresh();
                }

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });
        }
    }

    // ── Save Confirmation Modal & Compare Script Diff Flow ──────────────────
    async function openSaveConfirmationModal(session) {
        const modalEl = document.getElementById('table-design-confirm-modal');
        if (!modalEl) return;

        // Fetch Diff from backend
        let diffData = null;
        try {
            const res = await fetch(`/api/metadata/${session.connId}/table-design/diff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original: session.isNew ? {} : session.originalData,
                    modified: session.modifiedData
                })
            });
            const j = await res.json();
            if (!j.success) throw new Error(j.error || 'Failed to calculate diff');
            diffData = j.diff;
        } catch (e) {
            alert('Error generating migration diff: ' + e.message);
            return;
        }

        // Populate modal UI
        const quotePrefix = session.dbType === 'postgresql' ? '"' : '[';
        const quoteSuffix = session.dbType === 'postgresql' ? '"' : ']';
        const fullTableName = `${quotePrefix}${session.schema}${quoteSuffix}.${quotePrefix}${session.table}${quoteSuffix}`;

        document.getElementById('td-modal-target-table').textContent = fullTableName;
        const engineBadge = document.getElementById('td-modal-engine-badge');
        engineBadge.textContent = session.dbType === 'postgresql' ? 'PostgreSQL' : 'SQL Server';

        // Pre-Save Audit Section: Unmodified vs Modified Components Warning
        const audit = generatePreSaveAudit(session);
        const auditBadge = document.getElementById('td-modal-audit-summary-badge');
        const auditNotice = document.getElementById('td-modal-audit-notice');
        const auditList = document.getElementById('td-modal-audit-list');

        if (auditBadge && auditNotice && auditList) {
            if (audit.hasUnmodifiedAudit) {
                auditBadge.className = 'badge bg-warning text-dark';
                auditBadge.textContent = 'Cảnh báo có thành phần chưa sửa';
                auditNotice.innerHTML = '<span class="text-warning fw-semibold"><i class="fa-solid fa-triangle-exclamation me-1"></i>Lưu ý:</span> Cấu trúc cột đã thay đổi nhưng có Trigger hoặc Khóa ngoại chưa được kiểm tra / sửa đổi tương ứng. Hãy rà soát kỹ trước khi áp dụng!';
            } else {
                auditBadge.className = 'badge bg-success';
                auditBadge.textContent = 'Đã rà soát';
                auditNotice.textContent = 'Tổng hợp trạng thái các thành phần của bảng trước khi thực thi:';
            }

            auditList.innerHTML = audit.items.map(it => `
                <div class="td-audit-item ${it.modified ? 'modified' : (it.count > 0 ? 'unmodified' : '')}" data-audit-type="${it.type}" title="Bấm để lọc câu lệnh script của thành phần này">
                    <div class="d-flex align-items-center gap-2">
                        <i class="fa-solid ${it.modified ? 'fa-pen-to-square text-success' : (it.count > 0 ? 'fa-triangle-exclamation text-warning' : 'fa-circle-check text-muted')}"></i>
                        <div>
                            <div class="fw-semibold">${escapeHtml(it.name)}</div>
                            <div class="text-muted" style="font-size: 10px;">${escapeHtml(it.detail)}</div>
                        </div>
                    </div>
                    <span class="badge ${it.modified ? 'bg-success' : (it.count > 0 ? 'bg-warning text-dark' : 'bg-secondary')}" style="font-size: 10px;">
                        ${it.modified ? 'Đã sửa' : (it.count > 0 ? 'Chưa sửa' : 'Không có')}
                    </span>
                </div>
            `).join('');
        }

        // Destructive warning
        const warnBox = document.getElementById('td-modal-destructive-warning');
        const warnList = document.getElementById('td-modal-warnings-list');
        if (diffData.has_destructive) {
            warnBox.classList.remove('d-none');
            warnList.innerHTML = diffData.warnings.map(w => `<div>• ${escapeHtml(w)}</div>`).join('');
        } else {
            warnBox.classList.add('d-none');
            warnList.innerHTML = '';
        }

        // Initialize or update Diff Editor (Editable)
        const diffEditorContainer = document.getElementById('td-modal-diff-editor');
        const diffTextarea = document.getElementById('td-modal-diff-sql');
        const applyBtn = document.getElementById('td-modal-btn-apply');

        function getModalDiffValue() {
            if (modalDiffEditor) return modalDiffEditor.getValue();
            if (modalDiffCm) return modalDiffCm.getValue();
            return diffData.migration_sql || '';
        }

        function setModalDiffValue(val) {
            if (modalDiffEditor) {
                modalDiffEditor.setValue(val);
                modalDiffEditor.layout();
            } else if (modalDiffCm) {
                modalDiffCm.setValue(val);
                modalDiffCm.refresh();
            }
        }

        function updateApplyBtnState() {
            const val = getModalDiffValue().trim();
            if (applyBtn) {
                applyBtn.disabled = !val;
            }
        }

        if (diffEditorContainer && typeof monaco !== 'undefined' && monaco.editor) {
            if (diffTextarea) diffTextarea.classList.add('d-none');
            diffEditorContainer.classList.remove('d-none');
            if (!modalDiffEditor) {
                modalDiffEditor = createMonacoEditor(diffEditorContainer, {
                    value: diffData.migration_sql || '-- No changes detected.\n',
                    readOnly: false
                });
                if (modalDiffEditor) {
                    modalDiffEditor.onDidChangeModelContent(() => {
                        updateApplyBtnState();
                    });
                }
            } else {
                modalDiffEditor.updateOptions({ readOnly: false });
                modalDiffEditor.setValue(diffData.migration_sql || '-- No changes detected.\n');
            }
        } else if (diffTextarea && window.CodeMirror) {
            if (diffEditorContainer) diffEditorContainer.classList.add('d-none');
            diffTextarea.classList.remove('d-none');
            if (!modalDiffCm) {
                modalDiffCm = window.CodeMirror.fromTextArea(diffTextarea, {
                    mode: 'text/x-sql',
                    theme: getCodeMirrorTheme(),
                    lineNumbers: true,
                    readOnly: false
                });
                modalDiffCm.on('change', () => {
                    updateApplyBtnState();
                });
            } else {
                modalDiffCm.setOption('readOnly', false);
                modalDiffCm.setValue(diffData.migration_sql || '-- No changes detected.\n');
            }
        }

        // Component filtering for Compare Script
        let activeFilter = null;
        const filterStatusBadge = document.getElementById('td-modal-filter-status');
        const resetFilterBtn = document.getElementById('td-modal-btn-reset-filter');

        function setAuditFilter(type) {
            activeFilter = type;
            if (auditList) {
                auditList.querySelectorAll('.td-audit-item').forEach(el => {
                    if (el.dataset.auditType === type) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
            }

            if (!type || type === 'all') {
                if (filterStatusBadge) {
                    filterStatusBadge.className = 'badge bg-secondary';
                    filterStatusBadge.textContent = 'Hiển thị: Tất cả';
                }
                if (resetFilterBtn) resetFilterBtn.classList.add('d-none');
                setModalDiffValue(diffData.migration_sql || '-- No changes detected.\n');
            } else {
                const typeNames = {
                    tables: 'Tables (Bảng & Cột)',
                    fields: 'Fields (Cột)',
                    triggers: 'Triggers',
                    foreign_keys: 'Foreign Keys',
                    constraints: 'Constraints',
                    indexes: 'Indexes'
                };
                if (filterStatusBadge) {
                    filterStatusBadge.className = 'badge bg-info text-dark';
                    filterStatusBadge.textContent = `Lọc: ${typeNames[type] || type}`;
                }
                if (resetFilterBtn) resetFilterBtn.classList.remove('d-none');

                const stmts = (diffData.statements || []).filter(st => {
                    const stType = (typeof st === 'object' ? st.type : null) || 'tables';
                    if (type === 'fields' || type === 'tables') return stType === 'fields' || stType === 'tables';
                    if (type === 'foreign_keys' || type === 'constraints') return stType === 'foreign_keys' || stType === 'constraints';
                    return stType === type;
                });

                let filteredSql = '';
                if (stmts.length === 0) {
                    filteredSql = `-- Không có câu lệnh thay đổi nào cho: ${typeNames[type] || type}\n`;
                } else {
                    const joinSep = session.dbType === 'sqlserver' ? '\n\nGO\n\n' : '\n\n';
                    filteredSql = stmts.map(st => (typeof st === 'object' ? st.sql : st)).join(joinSep) + (session.dbType === 'sqlserver' ? '\n\nGO\n' : '\n');
                }
                setModalDiffValue(filteredSql);
            }
            updateApplyBtnState();
            setTimeout(() => {
                if (modalDiffEditor) modalDiffEditor.layout();
                if (modalDiffCm) modalDiffCm.refresh();
            }, 50);
        }

        if (auditList) {
            auditList.querySelectorAll('.td-audit-item').forEach(item => {
                item.addEventListener('click', () => {
                    const targetType = item.dataset.auditType;
                    if (activeFilter === targetType) {
                        setAuditFilter(null);
                    } else {
                        setAuditFilter(targetType);
                    }
                });
            });
        }

        if (resetFilterBtn) {
            resetFilterBtn.addEventListener('click', () => {
                setAuditFilter(null);
            });
        }

        setAuditFilter(null);

        // Wire Apply Changes button
        updateApplyBtnState();
        applyBtn.onclick = async () => {
            const finalSql = getModalDiffValue().trim();
            if (!finalSql) {
                alert('No migration SQL to execute.');
                return;
            }

            applyBtn.disabled = true;
            applyBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin me-1"></i> Applying...';

            try {
                const appRes = await fetch(`/api/metadata/${session.connId}/table-design/apply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        database: session.database,
                        schema: session.schema,
                        table: session.table,
                        migration_sql: finalSql
                    })
                });
                const appJson = await appRes.json();
                if (!appJson.success) throw new Error(appJson.error || 'Failed to apply schema changes');

                // Success: Update originalData to match modifiedData
                session.isNew = false;
                session.originalData = clone(session.modifiedData);
                markDirty(session);

                // Update tab title to existing format
                if (window.AppTabs) {
                    window.AppTabs.updateTabTitle(session.tabId, `Design: ${fullTableName}`);
                }

                // Reload fresh table metadata from database to verify persistence
                try {
                    const refreshRes = await fetch(`/api/metadata/${session.connId}/table-design?database=${encodeURIComponent(session.database || '')}&schema=${encodeURIComponent(session.schema)}&table=${encodeURIComponent(session.table)}`);
                    const refJson = await refreshRes.json();
                    if (refJson.success) {
                        session.originalData = clone(refJson.data);
                        session.modifiedData = clone(refJson.data);
                        session.previewSql = refJson.preview_sql;
                    }
                } catch (_) {}

                // Invalidate/refresh explorer node
                if (window.AppExplorer) {
                    window.AppExplorer.refreshNode({
                        connId: session.connId,
                        database: session.database,
                        schema: session.schema,
                        name: session.table,
                        type: 'table',
                        dbType: session.dbType
                    });
                }

                // Close modal
                if (modalInstance) modalInstance.hide();

                // Re-render designer
                renderDesigner(session);

            } catch (err) {
                console.error('Apply changes error:', err);
                alert('Database update failed: ' + err.message);
            } finally {
                applyBtn.disabled = false;
                applyBtn.innerHTML = '<i class="fa-solid fa-check me-1"></i> Apply Changes';
            }
        };

        modalInstance = new bootstrap.Modal(modalEl);
        modalInstance.show();
        setTimeout(() => {
            if (modalDiffEditor) modalDiffEditor.layout();
            if (modalDiffCm) modalDiffCm.refresh();
        }, 200);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Export API
    window.TableDesigner = {
        openTable,
        openNewTable,
        copyTable,
        activateTab,
        closeTab
    };

})();
