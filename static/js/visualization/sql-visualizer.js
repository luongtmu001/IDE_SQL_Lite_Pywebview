/**
 * SQL Visualization — Main Visual Query Designer Controller
 * Follows .SKILL/sql_visualization.md
 */

(function (window) {
    'use strict';

    const SqlVisualization = window.SqlVisualization || {};
    const { QueryModel, HistoryManager, DefaultSqlParser, DefaultSqlGenerator, D3CanvasRenderer, TableNode, JoinEdge } = SqlVisualization;

    const sessions = new Map(); // tabId -> session
    let activeSession = null;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getMonacoTheme() {
        try {
            const activeTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
            if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
                return window.MonacoInit.getMonacoTheme(activeTheme);
            }
            return (activeTheme === 'light' || activeTheme === 'win-nt' || activeTheme === 'win-xp' || activeTheme.includes('light')) ? 'ide-light' : 'ide-dark';
        } catch (_) {
            return 'vs-dark';
        }
    }

    class SqlVisualizer {
        constructor() {}

        /**
         * Context menu entry point: open a View / Materialized View in Visual Designer
         */
        async openView(nodeData) {
            const { name, schema, database, connId, dbType, connName, type } = nodeData || {};
            const safeSchema = schema || (dbType === 'postgresql' ? 'public' : 'dbo');
            const targetName = name || 'View';
            const tabTitle = `Design: ${targetName}`;

            if (!window.AppTabs) {
                console.error('[SqlVisualizer] AppTabs not available');
                return;
            }

            const tabId = window.AppTabs.createTab({
                tabType: 'query-designer',
                title: tabTitle,
                icon: 'fa-diagram-project',
                connectionId: connId,
                connectionName: connName,
                database: database,
                schema: safeSchema,
                dbType: dbType
            });

            const container = document.getElementById('sql-visualizer-container');
            const pane = this._getOrCreateSessionPane(container, tabId);

            // Show initial loading screen inside pane
            pane.innerHTML = `
                <div class="d-flex flex-column align-items-center justify-content-center h-100 p-4 text-center">
                    <div class="spinner-border text-primary mb-3" role="status"></div>
                    <h6 class="fw-semibold">Đang tải cấu trúc [${safeSchema}].[${targetName}]...</h6>
                    <span class="text-secondary small">Phân tích View DDL và tạo sơ đồ trực quan</span>
                </div>
            `;

            try {
                // Fetch view definition
                let definition = '';
                const defRes = await fetch(`/api/metadata/${connId}/definition?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&name=${encodeURIComponent(targetName)}&type=${encodeURIComponent(type || 'view')}&_t=${Date.now()}`);
                const defJson = await defRes.json();
                if (defJson && defJson.definition) {
                    definition = defJson.definition;
                } else {
                    definition = dbType === 'postgresql'
                        ? `SELECT *\nFROM "${safeSchema}"."${targetName}";`
                        : `SELECT *\nFROM [${safeSchema}].[${targetName}];`;
                }

                // Initialize session
                const session = {
                    tabId,
                    nodeData,
                    connId,
                    connName,
                    database,
                    schema: safeSchema,
                    dbType: dbType || 'sqlserver',
                    originalDefinition: definition,
                    currentMode: 'split', // 'split' | 'design' | 'code'
                    queryModel: null,
                    historyManager: new HistoryManager(),
                    domPane: pane,
                    d3Renderer: null,
                    monacoEditor: null,
                    isSyncing: false,
                    splitRatio: 40 // editor width percentage in split view
                };

                sessions.set(tabId, session);

                // Parse definition into QueryModel
                const model = DefaultSqlParser.parse(definition, {
                    dialect: dbType === 'postgresql' ? 'postgresql' : 'sqlserver',
                    defaultSchema: safeSchema
                });
                session.queryModel = model;

                // Load column metadata for tables in the model
                await this._populateTableColumns(session);

                // Render session UI
                this._renderSessionUI(session);

                // Initial layout based on query type (Flow Graph or Table Hierarchy)
                if (session.d3Renderer) {
                    if (session.d3Renderer.shouldRenderFlowGraph()) {
                        session.d3Renderer.applyFlowTopologicalLayout();
                    } else {
                        session.d3Renderer.applyHierarchicalLayout();
                    }
                }

                session.historyManager.pushState(session.queryModel);
                this.activateTab(tabId);

            } catch (err) {
                console.error('[SqlVisualizer] Error loading view definition:', err);
                pane.innerHTML = `
                    <div class="p-4 text-danger">
                        <h5><i class="fa-solid fa-triangle-exclamation me-2"></i>Không thể mở Design View</h5>
                        <p>${escapeHtml(err.message)}</p>
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.AppTabs.closeTab('${tabId}')">Đóng tab</button>
                    </div>
                `;
            }
        }

        _getOrCreateSessionPane(container, tabId) {
            let pane = container.querySelector(`.vqd-tab-session-pane[data-tab-id="${tabId}"]`);
            if (!pane) {
                pane = document.createElement('div');
                pane.className = 'vqd-tab-session-pane h-100 flex-grow-1 flex-column overflow-hidden';
                pane.dataset.tabId = tabId;
                pane.style.display = 'flex';
                container.appendChild(pane);
            }
            return pane;
        }

        async _fetchTableColumns(connId, database, schema, tableName) {
            // 1. Try MetadataProviderFactory instance
            try {
                if (window.MetadataProviderFactory && typeof window.MetadataProviderFactory.getProviderForConnection === 'function') {
                    const provider = window.MetadataProviderFactory.getProviderForConnection(connId);
                    if (provider && typeof provider.getColumns === 'function') {
                        const res = await provider.getColumns(connId, database, schema, tableName);
                        if (Array.isArray(res) && res.length > 0) return res;
                    }
                }
            } catch (_) {}

            // 2. Try object_children endpoint directly (native support for SQL Server and PostgreSQL)
            try {
                const safeSchema = schema || 'dbo';
                const url = `/api/metadata/${connId}/object_children?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&name=${encodeURIComponent(tableName)}&type=tables&child_type=columns&_t=${Date.now()}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.success && Array.isArray(data.items) && data.items.length > 0) {
                        return data.items.map(c => ({
                            name: c.name || c.column_name || '',
                            type: c.type || c.data_type || 'varchar',
                            is_pk: !!(c.is_pk || c.isPk),
                            is_fk: !!(c.is_fk || c.isFk),
                            nullable: c.nullable !== undefined ? c.nullable : true
                        }));
                    }
                }
            } catch (_) {}

            // 3. Try intellisense columns endpoint
            try {
                const safeSchema = schema || 'dbo';
                const url = `/api/metadata/${connId}/intellisense/columns?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&table=${encodeURIComponent(tableName)}`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.success && Array.isArray(data.items) && data.items.length > 0) {
                        return data.items.map(c => ({
                            name: c.name || c.column_name || '',
                            type: c.type || c.type_name || c.data_type || 'varchar',
                            is_pk: !!(c.is_pk || c.isPk),
                            is_fk: !!(c.is_fk || c.isFk),
                            nullable: c.nullable !== undefined ? c.nullable : true
                        }));
                    }
                }
            } catch (_) {}

            return [];
        }

        async _fetchDatabaseObjects(connId, database, schema, dbType = 'sqlserver') {
            // 1. Try MetadataProviderFactory instance
            try {
                if (window.MetadataProviderFactory && typeof window.MetadataProviderFactory.getProviderForConnection === 'function') {
                    const provider = window.MetadataProviderFactory.getProviderForConnection(connId);
                    if (provider && typeof provider.getObjects === 'function') {
                        const res = await provider.getObjects(connId, database, schema);
                        if (Array.isArray(res) && res.length > 0) return res;
                    }
                }
            } catch (_) {}

            // 2. Try native REST /api/metadata/${connId}/objects for tables, views, and synonyms
            try {
                const safeSchema = schema || 'dbo';
                const fetches = [
                    fetch(`/api/metadata/${connId}/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&type=tables&_t=${Date.now()}`),
                    fetch(`/api/metadata/${connId}/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&type=views&_t=${Date.now()}`)
                ];

                // For SQL Server, also fetch synonyms
                if (!dbType || dbType === 'sqlserver') {
                    fetches.push(
                        fetch(`/api/metadata/${connId}/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&type=synonyms&_t=${Date.now()}`)
                    );
                }

                const responses = await Promise.all(fetches);
                let items = [];

                if (responses[0]?.ok) {
                    const d = await responses[0].json();
                    if (d && d.success && Array.isArray(d.items)) {
                        items = items.concat(d.items.map(t => typeof t === 'string' ? { name: t, type: 'table', schema: safeSchema } : { ...t, type: 'table' }));
                    }
                }
                if (responses[1]?.ok) {
                    const d = await responses[1].json();
                    if (d && d.success && Array.isArray(d.items)) {
                        items = items.concat(d.items.map(v => typeof v === 'string' ? { name: v, type: 'view', schema: safeSchema } : { ...v, type: 'view' }));
                    }
                }
                if (responses[2]?.ok) {
                    const d = await responses[2].json();
                    if (d && d.success && Array.isArray(d.items)) {
                        items = items.concat(d.items.map(s => typeof s === 'string' ? { name: s, type: 'synonym', schema: safeSchema } : { ...s, type: 'synonym' }));
                    }
                }

                if (items.length > 0) return items;
            } catch (_) {}

            // 3. Try intellisense objects endpoint
            try {
                const url = `/api/metadata/${connId}/intellisense/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}`;
                const res = await fetch(url);
                if (res.ok) {
                    const d = await res.json();
                    if (d && d.success && Array.isArray(d.items) && d.items.length > 0) {
                        return d.items;
                    }
                }
            } catch (_) {}

            return [];
        }

        async _populateTableColumns(session) {
            const { connId, database, queryModel } = session;
            if (!queryModel) return;

            const tablePromises = Array.from(queryModel.tables.values()).map(async (tableNode) => {
                if (tableNode.columns && tableNode.columns.length > 0) return;
                try {
                    const cols = await this._fetchTableColumns(connId, database, tableNode.schema, tableNode.tableName);
                    if (Array.isArray(cols) && cols.length > 0) {
                        tableNode.columns = cols.map(c => ({
                            name: c.name || '',
                            type: c.type || 'varchar',
                            isPk: !!(c.is_pk || c.isPk),
                            isFk: !!(c.is_fk || c.isFk),
                            nullable: c.nullable !== undefined ? c.nullable : true
                        }));
                    }
                } catch (e) {
                    console.warn(`[SqlVisualizer] Failed to load columns for ${tableNode.tableName}:`, e);
                }
            });

            await Promise.all(tablePromises);

            // Re-bind tableId on queryModel.selectItems if missing
            queryModel.selectItems.forEach(s => {
                if (!s.tableId && s.tableAlias) {
                    const t = queryModel.getTableByAlias(s.tableAlias);
                    if (t) s.tableId = t.id;
                }
            });
        }

        _renderSessionUI(session) {
            const pane = session.domPane;
            pane.innerHTML = `
                <!-- Visualizer Toolbar -->
                <div class="vqd-toolbar d-flex align-items-center justify-content-between px-2 py-1 user-select-none">
                    <!-- Left: View Mode Toggle & Actions -->
                    <div class="d-flex align-items-center gap-1 vqd-toolbar-left flex-wrap">
                        <div class="btn-group btn-group-sm vqd-mode-group me-2" role="group">
                            <button type="button" class="btn btn-outline-secondary vqd-mode-btn" data-mode="code" title="Code View (Monaco SQL Editor)">
                                <i class="fa-solid fa-code me-1"></i>Code
                            </button>
                            <button type="button" class="btn btn-outline-secondary vqd-mode-btn" data-mode="design" title="Design View (Canvas trực quan & Criteria)">
                                <i class="fa-solid fa-bezier-curve me-1"></i>Design
                            </button>
                            <button type="button" class="btn btn-outline-secondary vqd-mode-btn active" data-mode="split" title="Split View (Chia đôi màn hình)">
                                <i class="fa-solid fa-table-columns me-1"></i>Split
                            </button>
                        </div>

                        <div class="vqd-toolbar-actions d-flex align-items-center gap-1">
                            <!-- Action Buttons -->
                            <div class="btn-group btn-group-sm me-2">
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-refresh" title="Làm mới sơ đồ từ mã SQL hiện tại">
                                    <i class="fa-solid fa-rotate me-1 text-primary"></i>Refresh Design
                                </button>
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-generate" title="Sinh lại SQL từ sơ đồ thiết kế">
                                    <i class="fa-solid fa-wand-magic-sparkles me-1 text-success"></i>Generate SQL
                                </button>
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-layout" title="Tự động căn chỉnh vị trí sơ đồ">
                                    <i class="fa-solid fa-diagram-project me-1 text-info"></i>Auto Layout
                                </button>
                            </div>

                            <!-- Flow Graph Controls (Phase 4) -->
                            <div class="btn-group btn-group-sm me-2">
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-toggle-steps active" title="Bật/Tắt số thứ tự bước logic [1], [2]...">
                                    <i class="fa-solid fa-list-ol me-1 text-warning"></i>Steps
                                </button>
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-toggle-viewmode" title="Chuyển đổi Sơ đồ luồng (Flow Graph) / Bảng (Table Cards)">
                                    <i class="fa-solid fa-sitemap me-1 text-primary"></i>Flow
                                </button>
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-toggle-legend" title="Hiện/Ẩn chú giải Node">
                                    <i class="fa-solid fa-circle-info me-1 text-info"></i>Legend
                                </button>
                            </div>

                            <!-- Execution Plan Controls (Phase 6) -->
                            <div class="btn-group btn-group-sm me-2">
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-fetch-est-plan" title="Lấy Estimated Plan từ database (An toàn, không chạy query)">
                                    <i class="fa-solid fa-file-invoice me-1 text-info"></i>Est Plan
                                </button>
                                <button type="button" class="btn btn-outline-secondary vqd-action-btn vqd-btn-fetch-act-plan" title="Lấy Actual Plan từ database (Thực thi query, có cảnh báo)">
                                    <i class="fa-solid fa-play me-1 text-warning"></i>Act Plan
                                </button>
                            </div>

                            <!-- Zoom Buttons -->
                            <div class="btn-group btn-group-sm me-2">
                                <button type="button" class="btn btn-outline-secondary vqd-btn-zoom-in" title="Phóng to"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                                <button type="button" class="btn btn-outline-secondary vqd-btn-zoom-out" title="Thu nhỏ"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                                <button type="button" class="btn btn-outline-secondary vqd-btn-zoom-fit" title="Thu phóng vừa màn hình"><i class="fa-solid fa-expand"></i></button>
                                <button type="button" class="btn btn-outline-secondary vqd-btn-zoom-reset" title="Mặc định 100%"><i class="fa-solid fa-rotate-left"></i></button>
                            </div>

                            <!-- Undo / Redo -->
                            <div class="btn-group btn-group-sm">
                                <button type="button" class="btn btn-outline-secondary vqd-btn-undo" title="Hoàn tác (Undo)"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                                <button type="button" class="btn btn-outline-secondary vqd-btn-redo" title="Làm lại (Redo)"><i class="fa-solid fa-arrow-rotate-right"></i></button>
                            </div>
                        </div>
                    </div>

                    <!-- Right: Status Badge & DB Objects toggle & Toolbar Collapse toggle -->
                    <div class="d-flex align-items-center gap-2 vqd-toolbar-right">
                        <span class="vqd-sync-badge badge bg-success-subtle text-success border border-success-subtle">
                            <i class="fa-solid fa-check me-1"></i>Synced
                        </span>
                        <button type="button" class="btn btn-sm btn-outline-secondary vqd-btn-toggle-objects" title="Hiện/Ẩn danh sách bảng">
                            <i class="fa-solid fa-database me-1"></i>Objects
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary vqd-btn-toggle-toolbar" title="Thu gọn thanh công cụ">
                            <i class="fa-solid fa-chevron-up"></i>
                        </button>
                    </div>
                </div>

                <!-- Warning Banner (if unsupported SQL) -->
                <div class="vqd-warning-banner alert alert-warning py-1 px-3 mb-0 d-none align-items-center justify-content-between" style="font-size: 12px;">
                    <div>
                        <i class="fa-solid fa-triangle-exclamation me-2"></i>
                        <span class="vqd-warning-text">Cú pháp SQL phức tạp/chưa hỗ trợ trực quan hóa đầy đủ. Mã SQL gốc được bảo toàn nguyên vẹn.</span>
                    </div>
                    <button type="button" class="btn-close btn-close-sm vqd-btn-dismiss-warning" aria-label="Close"></button>
                </div>

                <!-- Main Workspace Area -->
                <div class="vqd-workspace flex-grow-1 d-flex overflow-hidden position-relative">
                    <!-- Left: SQL Editor Pane -->
                    <div class="vqd-editor-pane d-flex flex-column" style="width: ${session.splitRatio}%;">
                        <div class="vqd-pane-header px-2 py-1 small fw-semibold text-muted d-flex align-items-center justify-content-between border-bottom">
                            <span><i class="fa-solid fa-code me-1 text-primary"></i>SQL Definition</span>
                            <span class="badge bg-secondary-subtle text-secondary font-monospace" style="font-size: 10px;">${session.dbType.toUpperCase()}</span>
                        </div>
                        <div class="vqd-editor-container flex-grow-1"></div>
                    </div>

                    <!-- Vertical Split Resizer -->
                    <div class="vqd-split-resizer" title="Kéo để thay đổi tỷ lệ chia màn hình"></div>

                    <!-- Center / Right: Design Workspace (Canvas + Criteria / Inspector / Execution Plan) -->
                    <div class="vqd-design-pane flex-grow-1 d-flex flex-column overflow-hidden">
                        <!-- Canvas Container -->
                        <div class="vqd-canvas-wrapper flex-grow-1 position-relative overflow-hidden" style="min-height: 200px;">
                            <!-- D3 SVG Canvas injected here -->
                        </div>

                        <!-- Horizontal Resizer (Canvas ↕ Criteria/Inspector/Plan) -->
                        <div class="vqd-criteria-resizer" title="Kéo để điều chỉnh chiều cao panel phía dưới"></div>

                        <!-- Bottom Multi-Tab Panel (Criteria Grid, Node Inspector, Execution Plan) -->
                        <div class="vqd-bottom-panel vqd-criteria-pane d-flex flex-column" style="height: 190px; min-height: 120px;">
                            <div class="vqd-pane-header px-2 py-1 small fw-semibold text-muted d-flex align-items-center justify-content-between border-bottom border-top user-select-none">
                                <div class="nav nav-tabs vqd-bottom-tabs border-0" role="tablist">
                                    <button class="nav-link active py-1 px-2 small vqd-tab-btn" data-bottom-tab="criteria" type="button">
                                        <i class="fa-solid fa-table me-1 text-info"></i>Criteria Grid
                                    </button>
                                    <button class="nav-link py-1 px-2 small vqd-tab-btn" data-bottom-tab="inspector" type="button">
                                        <i class="fa-solid fa-circle-info me-1 text-primary"></i>Node Inspector
                                        <span class="badge bg-secondary-subtle text-secondary ms-1 vqd-inspector-step-badge d-none"></span>
                                    </button>
                                    <button class="nav-link py-1 px-2 small vqd-tab-btn" data-bottom-tab="execution-plan" type="button">
                                        <i class="fa-solid fa-gauge-high me-1 text-warning"></i>Execution Plan
                                        <span class="badge bg-info-subtle text-info ms-1 vqd-plan-type-badge d-none"></span>
                                    </button>
                                </div>
                                <div class="vqd-bottom-tab-actions d-flex align-items-center gap-1">
                                    <span class="small text-muted vqd-tab-hint" style="font-size: 11px;">Chọn cột, alias, sắp xếp và bộ lọc</span>
                                </div>
                            </div>

                            <div class="vqd-bottom-tab-content flex-grow-1 overflow-hidden position-relative">
                                <!-- Tab 1: Criteria Grid -->
                                <div class="vqd-tab-pane vqd-pane-criteria h-100 overflow-auto">
                                    <table class="table table-sm table-bordered vqd-criteria-table mb-0">
                                        <thead>
                                            <tr>
                                                <th style="width: 40px;" class="text-center">Output</th>
                                                <th style="width: 180px;">Column</th>
                                                <th style="width: 160px;">Table</th>
                                                <th style="width: 140px;">Alias</th>
                                                <th style="width: 110px;">Sort</th>
                                                <th>Criteria (Filter)</th>
                                                <th style="width: 40px;" class="text-center">Del</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <!-- Built dynamically -->
                                        </tbody>
                                    </table>
                                </div>

                                <!-- Tab 2: Node Inspector -->
                                <div class="vqd-tab-pane vqd-pane-inspector h-100 overflow-auto p-2 d-none">
                                    <div class="vqd-inspector-empty text-muted small text-center p-3">
                                        <i class="fa-solid fa-mouse-pointer me-1"></i>Chọn một node trên canvas hoặc đặt con trỏ vào câu lệnh trong SQL editor để xem thông tin chi tiết.
                                    </div>
                                    <div class="vqd-inspector-content d-none">
                                        <div class="d-flex align-items-center justify-content-between mb-2">
                                            <div class="d-flex align-items-center gap-2">
                                                <span class="badge bg-primary vqd-insp-step-badge">[1]</span>
                                                <span class="fw-bold vqd-insp-title">Node Title</span>
                                                <span class="badge bg-secondary vqd-insp-type-badge">Table</span>
                                                <span class="badge bg-success-subtle text-success vqd-insp-status-badge">Valid</span>
                                            </div>
                                            <button type="button" class="btn btn-xs btn-outline-secondary vqd-btn-copy-fragment" title="Copy đoạn SQL">
                                                <i class="fa-regular fa-copy me-1"></i>Copy SQL
                                            </button>
                                        </div>
                                        <div class="row g-2">
                                            <div class="col-md-7">
                                                <div class="fw-semibold small text-muted mb-1">SQL Fragment</div>
                                                <pre class="vqd-insp-sql-code p-2 rounded mb-0" style="font-size: 11px; max-height: 80px; overflow: auto; background: var(--bs-tertiary-bg);"></pre>
                                            </div>
                                            <div class="col-md-5">
                                                <div class="fw-semibold small text-muted mb-1">Dependencies & Columns</div>
                                                <div class="vqd-insp-deps small mb-1"></div>
                                                <div class="vqd-insp-cols small text-muted text-truncate"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Tab 3: Execution Plan -->
                                <div class="vqd-tab-pane vqd-pane-plan h-100 overflow-auto p-2 d-none">
                                    <div class="vqd-plan-empty text-muted small text-center p-3">
                                        <i class="fa-solid fa-gauge-high me-1"></i>Chưa tải Execution Plan. Bấm <strong>Est Plan</strong> hoặc <strong>Act Plan</strong> trên thanh công cụ để phân tích.
                                    </div>
                                    <div class="vqd-plan-content d-none">
                                        <div class="vqd-plan-summary d-flex align-items-center gap-3 p-1 mb-2 border-bottom small flex-wrap">
                                            <div><strong>Dialect:</strong> <span class="vqd-plan-sum-dialect text-primary"></span></div>
                                            <div><strong>Plan Type:</strong> <span class="vqd-plan-sum-type badge bg-info-subtle text-info"></span></div>
                                            <div><strong>Total Cost:</strong> <span class="vqd-plan-sum-cost fw-bold"></span></div>
                                            <div><strong>Operators:</strong> <span class="vqd-plan-sum-ops"></span></div>
                                            <div class="ms-auto"><button type="button" class="btn btn-xs btn-outline-primary vqd-btn-view-toggle-plan"><i class="fa-solid fa-sitemap me-1"></i>Toggle Canvas View</button></div>
                                        </div>
                                        <div class="vqd-operator-details p-1">
                                            <div class="text-muted small"><i class="fa-solid fa-info-circle me-1"></i>Click vào một Operator trên Execution Plan canvas để xem thuộc tính chi tiết (Cost, Rows, CPU/IO, Predicates).</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Objects Panel -->
                    <div class="vqd-objects-pane d-flex flex-column border-start" style="width: 250px; min-width: 220px;">
                        <div class="vqd-pane-header p-2 border-bottom">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
                                <input type="text" class="form-control vqd-objects-search" placeholder="Tìm bảng/cột...">
                            </div>
                        </div>
                        <div class="vqd-objects-list flex-grow-1 overflow-auto p-2">
                            <!-- Populated with Tables and Views -->
                        </div>
                    </div>
                </div>

                <!-- Join Context Popup Menu (Absolute overlay) -->
                <div class="vqd-join-context-menu dropdown-menu shadow d-none position-absolute" style="z-index: 1050; font-size: 12px;">
                    <h6 class="dropdown-header py-1" style="font-size: 11px;">Join Type</h6>
                    <button class="dropdown-item vqd-menu-join-type" data-type="INNER"><i class="fa-solid fa-code-merge me-2 text-primary"></i>INNER JOIN</button>
                    <button class="dropdown-item vqd-menu-join-type" data-type="LEFT"><i class="fa-solid fa-arrow-left me-2 text-success"></i>LEFT JOIN</button>
                    <button class="dropdown-item vqd-menu-join-type" data-type="RIGHT"><i class="fa-solid fa-arrow-right me-2 text-info"></i>RIGHT JOIN</button>
                    <button class="dropdown-item vqd-menu-join-type" data-type="FULL"><i class="fa-solid fa-arrows-left-right me-2 text-warning"></i>FULL JOIN</button>
                    <div class="dropdown-divider my-1"></div>
                    <button class="dropdown-item text-danger vqd-menu-delete-join"><i class="fa-solid fa-trash me-2"></i>Delete Join</button>
                </div>
            `;

            // Initialize Monaco Editor
            this._initMonacoEditor(session);

            // Initialize D3 Canvas Renderer
            const canvasWrapper = pane.querySelector('.vqd-canvas-wrapper');
            session.d3Renderer = new D3CanvasRenderer(canvasWrapper, {
                onModelChange: (type, detail) => this._onCanvasModelChange(session, type, detail),
                onTableRemove: (tableId) => this._onTableRemove(session, tableId),
                onJoinClick: (join, event) => this._showJoinContextMenu(session, join, event),
                onTableFocus: (tableId, tableNode) => this._onTableFocus(session, tableId, tableNode),
                onNodeSelect: (flowNode) => this._onFlowNodeSelect(session, flowNode),
                onOperatorSelect: (opNode) => this._onPlanOperatorSelect(session, opNode)
            });
            session.d3Renderer.render(session.queryModel);

            // Render Criteria Grid
            this._renderCriteriaGrid(session);

            // Populate Objects Panel
            this._loadDatabaseObjects(session);

            // Setup Event Handlers (Toolbar, Resizers, Context Menu)
            this._setupEventHandlers(session);

            // Sync initial state of Flow view button
            const btnViewMode = pane.querySelector('.vqd-btn-toggle-viewmode');
            if (btnViewMode && session.d3Renderer) {
                const isFlow = session.d3Renderer.shouldRenderFlowGraph();
                btnViewMode.classList.toggle('active', isFlow);
                btnViewMode.innerHTML = isFlow
                    ? '<i class="fa-solid fa-sitemap me-1 text-primary"></i>Flow'
                    : '<i class="fa-solid fa-table me-1 text-secondary"></i>Tables';
            }

            // Update Status Badge
            this._updateSyncStatusBadge(session);
        }

        _initMonacoEditor(session) {
            const editorContainer = session.domPane.querySelector('.vqd-editor-container');
            if (!editorContainer || typeof monaco === 'undefined' || !monaco.editor) return;

            const initialSql = session.originalDefinition || DefaultSqlGenerator.generate(session.queryModel);

            const ed = monaco.editor.create(editorContainer, {
                value: initialSql,
                language: 'sql',
                theme: getMonacoTheme(),
                automaticLayout: true,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                lineNumbers: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on'
            });

            session.monacoEditor = ed;

            // Handle user changes in Monaco Editor
            ed.onDidChangeModelContent(() => {
                if (session.isSyncing) return;
                session.queryModel.syncStatus = 'code_modified';
                this._updateSyncStatusBadge(session);
                if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
            });

            // Handle cursor position changes in Monaco Editor (Phase 5 Bidirectional mapping)
            ed.onDidChangeCursorPosition((e) => {
                if (session.isNavigatingFromCanvas || session.isSyncing) return;
                this._onEditorCursorMove(session, e.position.lineNumber, e.position.column);
            });
        }

        _setupEventHandlers(session) {
            const pane = session.domPane;

            // Mode buttons: code, design, split
            pane.querySelectorAll('.vqd-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.mode;
                    this.setMode(session, mode);
                });
            });

            // Refresh Design Button
            pane.querySelector('.vqd-btn-refresh')?.addEventListener('click', () => {
                this.refreshDesignFromSql(session);
            });

            // Generate SQL Button
            pane.querySelector('.vqd-btn-generate')?.addEventListener('click', () => {
                this.generateSqlFromDesign(session);
            });

            // Auto Layout Button
            pane.querySelector('.vqd-btn-layout')?.addEventListener('click', () => {
                if (session.d3Renderer) session.d3Renderer.autoLayout();
            });

            // Flow Graph: Toggle Step Numbers Button
            const btnSteps = pane.querySelector('.vqd-btn-toggle-steps');
            btnSteps?.addEventListener('click', () => {
                const isShown = session.d3Renderer?.toggleStepNumbers();
                btnSteps.classList.toggle('active', !!isShown);
            });

            // Flow Graph: Toggle View Mode (Flow Graph vs Table Cards)
            const btnViewMode = pane.querySelector('.vqd-btn-toggle-viewmode');
            btnViewMode?.addEventListener('click', () => {
                const current = session.d3Renderer?.getForceViewMode();
                const next = current === 'flow' ? 'tables' : 'flow';
                session.d3Renderer?.setForceViewMode(next);
                session.d3Renderer?.render(session.queryModel);
                session.d3Renderer?.zoomFit();
                btnViewMode.classList.toggle('active', next === 'flow');
                btnViewMode.innerHTML = next === 'flow' 
                    ? '<i class="fa-solid fa-sitemap me-1 text-primary"></i>Flow' 
                    : '<i class="fa-solid fa-table me-1 text-secondary"></i>Tables';
            });

            // Flow Graph: Toggle Legend Button
            const btnLegend = pane.querySelector('.vqd-btn-toggle-legend');
            btnLegend?.addEventListener('click', () => {
                const isShown = session.d3Renderer?.toggleLegend();
                btnLegend.classList.toggle('active', !!isShown);
            });

            // Zoom Buttons
            pane.querySelector('.vqd-btn-zoom-in')?.addEventListener('click', () => session.d3Renderer?.zoomIn());
            pane.querySelector('.vqd-btn-zoom-out')?.addEventListener('click', () => session.d3Renderer?.zoomOut());
            pane.querySelector('.vqd-btn-zoom-fit')?.addEventListener('click', () => session.d3Renderer?.zoomFit());
            pane.querySelector('.vqd-btn-zoom-reset')?.addEventListener('click', () => session.d3Renderer?.resetZoom());

            // Undo / Redo Buttons
            pane.querySelector('.vqd-btn-undo')?.addEventListener('click', () => this.undo(session));
            pane.querySelector('.vqd-btn-redo')?.addEventListener('click', () => this.redo(session));

            // Execution Plan Toolbar Buttons (Phase 6)
            pane.querySelector('.vqd-btn-fetch-est-plan')?.addEventListener('click', () => {
                this.fetchExecutionPlan(session, 'estimated');
            });
            pane.querySelector('.vqd-btn-fetch-act-plan')?.addEventListener('click', () => {
                this.fetchExecutionPlan(session, 'actual');
            });

            // Bottom Panel Tab Switching (Criteria Grid, Node Inspector, Execution Plan)
            pane.querySelectorAll('.vqd-tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const targetTab = btn.dataset.bottomTab;
                    this._activateBottomTab(session, targetTab);
                });
            });

            // Copy SQL Fragment Button
            pane.querySelector('.vqd-btn-copy-fragment')?.addEventListener('click', () => {
                const codeEl = pane.querySelector('.vqd-insp-sql-code');
                if (codeEl && codeEl.textContent) {
                    navigator.clipboard?.writeText(codeEl.textContent);
                    const btn = pane.querySelector('.vqd-btn-copy-fragment');
                    if (btn) {
                        const orig = btn.innerHTML;
                        btn.innerHTML = '<i class="fa-solid fa-check me-1 text-success"></i>Copied!';
                        setTimeout(() => { btn.innerHTML = orig; }, 1500);
                    }
                }
            });

            // Toggle Canvas View between Logical Flow and Physical Plan
            pane.querySelector('.vqd-btn-view-toggle-plan')?.addEventListener('click', () => {
                if (!session.d3Renderer) return;
                if (session.d3Renderer.activeViewTab === 'physical') {
                    session.d3Renderer.switchToGraphView();
                } else if (session.physicalPlan) {
                    session.d3Renderer.renderPhysicalPlan(session.physicalPlan);
                }
            });

            // Toggle Objects Panel
            pane.querySelector('.vqd-btn-toggle-objects')?.addEventListener('click', () => {
                const objPane = pane.querySelector('.vqd-objects-pane');
                if (objPane) objPane.classList.toggle('d-none');
            });

            // Dismiss warning
            pane.querySelector('.vqd-btn-dismiss-warning')?.addEventListener('click', () => {
                pane.querySelector('.vqd-warning-banner')?.classList.add('d-none');
            });

            // Toggle Toolbar Button
            const toggleToolbarBtn = pane.querySelector('.vqd-btn-toggle-toolbar');
            const toolbar = pane.querySelector('.vqd-toolbar');
            toggleToolbarBtn?.addEventListener('click', () => {
                const isCollapsed = toolbar.classList.toggle('vqd-toolbar-collapsed');
                const icon = toggleToolbarBtn.querySelector('i');
                if (icon) {
                    icon.className = `fa-solid ${isCollapsed ? 'fa-chevron-down' : 'fa-chevron-up'}`;
                }
                toggleToolbarBtn.setAttribute('title', isCollapsed ? 'Mở rộng thanh công cụ' : 'Thu gọn thanh công cụ');
                if (session.monacoEditor) {
                    setTimeout(() => session.monacoEditor.layout(), 250);
                }
            });

            // Resizer: Split Editor ↔ Design
            this._setupSplitResizer(session);

            // Resizer: Canvas ↕ Criteria
            this._setupCriteriaResizer(session);

            // Search filter for database objects with debounce
            const searchInput = pane.querySelector('.vqd-objects-search');
            let searchTimeout = null;
            const filterObjects = () => {
                const term = (searchInput?.value || '').toLowerCase().trim();
                pane.querySelectorAll('.vqd-object-item').forEach(item => {
                    const name = (item.dataset.name || '').toLowerCase();
                    const schema = (item.dataset.schema || '').toLowerCase();
                    const fullName = schema ? `${schema}.${name}` : name;
                    const isMatch = !term || name.includes(term) || fullName.includes(term);
                    item.classList.toggle('d-none', !isMatch);
                    if (!isMatch) {
                        item.style.setProperty('display', 'none', 'important');
                    } else {
                        item.style.removeProperty('display');
                    }
                });
            };
            searchInput?.addEventListener('input', () => {
                if (searchTimeout) clearTimeout(searchTimeout);
                searchTimeout = setTimeout(filterObjects, 40);
            });
            searchInput?.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') filterObjects();
            });
        }

        _setupSplitResizer(session) {
            const pane = session.domPane;
            const resizer = pane.querySelector('.vqd-split-resizer');
            const editorPane = pane.querySelector('.vqd-editor-pane');
            const workspace = pane.querySelector('.vqd-workspace');
            if (!resizer || !editorPane || !workspace) return;
            if (resizer._initialized) return;
            resizer._initialized = true;

            let isDragging = false;
            let currentPct = session.splitRatio || 50;
            let workspaceRect = null;
            let rafId = null;

            const onPointerDown = (e) => {
                isDragging = true;
                workspaceRect = workspace.getBoundingClientRect();
                resizer.setPointerCapture(e.pointerId);
                editorPane.style.setProperty('flex', 'none', 'important');
                document.body.style.cursor = 'col-resize';
                document.body.classList.add('vqd-resizing');
                e.preventDefault();
            };

            const onPointerMove = (e) => {
                if (!isDragging || !workspaceRect) return;
                const newWidthPx = e.clientX - workspaceRect.left;
                currentPct = Math.max(15, Math.min(80, (newWidthPx / workspaceRect.width) * 100));

                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    editorPane.style.width = `${currentPct}%`;
                    rafId = null;
                });
            };

            const onPointerUp = (e) => {
                if (!isDragging) return;
                isDragging = false;
                workspaceRect = null;
                try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
                document.body.style.cursor = '';
                document.body.classList.remove('vqd-resizing');
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                editorPane.style.removeProperty('flex');
                editorPane.style.width = `${currentPct}%`;
                session.splitRatio = currentPct;
                if (session.monacoEditor) {
                    session.monacoEditor.layout();
                }
            };

            resizer.addEventListener('pointerdown', onPointerDown);
            resizer.addEventListener('pointermove', onPointerMove);
            resizer.addEventListener('pointerup', onPointerUp);
            resizer.addEventListener('pointercancel', onPointerUp);
        }

        _setupCriteriaResizer(session) {
            const pane = session.domPane;
            const resizer = pane.querySelector('.vqd-criteria-resizer');
            const criteriaPane = pane.querySelector('.vqd-criteria-pane');
            if (!resizer || !criteriaPane) return;
            if (resizer._initialized) return;
            resizer._initialized = true;

            let isDragging = false;
            let startY = 0;
            let startH = 0;
            let rafId = null;
            let currentH = 180;

            const onPointerDown = (e) => {
                isDragging = true;
                startY = e.clientY;
                startH = criteriaPane.getBoundingClientRect().height;
                resizer.setPointerCapture(e.pointerId);
                criteriaPane.style.setProperty('flex', 'none', 'important');
                document.body.style.cursor = 'row-resize';
                document.body.classList.add('vqd-resizing');
                e.preventDefault();
            };

            const onPointerMove = (e) => {
                if (!isDragging) return;
                const dy = startY - e.clientY;
                const newH = Math.max(100, Math.min(500, startH + dy));
                if (newH !== currentH) {
                    currentH = newH;
                    if (rafId) cancelAnimationFrame(rafId);
                    rafId = requestAnimationFrame(() => {
                        criteriaPane.style.height = `${currentH}px`;
                        rafId = null;
                    });
                }
            };

            const onPointerUp = (e) => {
                if (!isDragging) return;
                isDragging = false;
                try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
                document.body.style.cursor = '';
                document.body.classList.remove('vqd-resizing');
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = null;
                }
                criteriaPane.style.removeProperty('flex');
                criteriaPane.style.height = `${currentH}px`;
            };

            resizer.addEventListener('pointerdown', onPointerDown);
            resizer.addEventListener('pointermove', onPointerMove);
            resizer.addEventListener('pointerup', onPointerUp);
            resizer.addEventListener('pointercancel', onPointerUp);
        }

        setMode(session, mode) {
            session.currentMode = mode;
            const pane = session.domPane;
            const editorPane = pane.querySelector('.vqd-editor-pane');
            const designPane = pane.querySelector('.vqd-design-pane');
            const splitResizer = pane.querySelector('.vqd-split-resizer');
            const modeBtns = pane.querySelectorAll('.vqd-mode-btn');

            modeBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });

            if (mode === 'code') {
                editorPane.classList.remove('d-none');
                editorPane.style.width = '100%';
                splitResizer.classList.add('d-none');
                designPane.classList.add('d-none');
            } else if (mode === 'design') {
                editorPane.classList.add('d-none');
                splitResizer.classList.add('d-none');
                designPane.classList.remove('d-none');
            } else {
                // split
                editorPane.classList.remove('d-none');
                editorPane.style.width = `${session.splitRatio}%`;
                splitResizer.classList.remove('d-none');
                designPane.classList.remove('d-none');
            }

            setTimeout(() => {
                if (session.monacoEditor) session.monacoEditor.layout();
                if (session.d3Renderer && (mode === 'design' || mode === 'split')) {
                    session.d3Renderer.zoomFit();
                }
            }, 30);
        }

        _onCanvasModelChange(session, changeType, detail) {
            // Visual layout changes do not affect SQL or Criteria Grid
            if (changeType === 'table-moved' || changeType === 'auto-layout') {
                return;
            }

            // Push history
            session.historyManager.pushState(session.queryModel);

            // Re-render criteria grid only if structural changes occurred (not in-place criteria edits)
            if (changeType !== 'criteria-changed') {
                this._renderCriteriaGrid(session);
            }

            // Two-way sync: Design -> SQL
            this.generateSqlFromDesign(session);
        }

        _onTableRemove(session, tableId) {
            session.queryModel.removeTable(tableId);
            session.d3Renderer.render(session.queryModel);
            this._onCanvasModelChange(session, 'table-removed', { tableId });
        }

        _showJoinContextMenu(session, join, event) {
            const menu = session.domPane.querySelector('.vqd-join-context-menu');
            if (!menu) return;

            const clientRect = session.domPane.getBoundingClientRect();
            const posX = event.clientX - clientRect.left;
            const posY = event.clientY - clientRect.top;

            menu.style.left = `${posX}px`;
            menu.style.top = `${posY}px`;
            menu.classList.remove('d-none');

            // Wire menu actions
            const hideMenu = () => {
                menu.classList.add('d-none');
                document.removeEventListener('click', hideMenu);
            };

            menu.querySelectorAll('.vqd-menu-join-type').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const newType = btn.dataset.type;
                    session.queryModel.updateJoinType(join.id, newType);
                    session.d3Renderer.render(session.queryModel);
                    this._onCanvasModelChange(session, 'join-type-changed', { joinId: join.id, newType });
                    hideMenu();
                };
            });

            const delBtn = menu.querySelector('.vqd-menu-delete-join');
            if (delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    session.queryModel.removeJoin(join.id);
                    session.d3Renderer.render(session.queryModel);
                    this._onCanvasModelChange(session, 'join-deleted', { joinId: join.id });
                    hideMenu();
                };
            }

            setTimeout(() => {
                document.addEventListener('click', hideMenu);
            }, 10);
        }

        _onTableFocus(session, tableId, tableNode) {
            if (session.focusedTableId === tableId && session.focusedTableNode === tableNode) {
                return;
            }
            session.focusedTableId = tableId;
            session.focusedTableNode = tableNode;

            // Update highlighting on criteria rows in-place without rebuilding DOM
            this._updateCriteriaGridHighlight(session);

            // Highlight in Monaco only when in Split or Code mode
            if (session.currentMode === 'split' || session.currentMode === 'code') {
                this._highlightTableInMonaco(session, tableNode);
            }
        }

        _updateCriteriaGridHighlight(session) {
            const tbody = session.domPane.querySelector('.vqd-criteria-table tbody');
            if (!tbody) return;

            // If filterTableOnly is active, full re-render is required to filter rows
            if (session.filterTableOnly) {
                this._renderCriteriaGrid(session);
                return;
            }

            // Fast header info update
            const headerInfoEl = session.domPane.querySelector('.vqd-criteria-header-info');
            if (headerInfoEl) {
                if (session.focusedTableId && session.focusedTableNode) {
                    const fn = session.focusedTableNode;
                    const tableCols = (fn.columns || []);
                    const selCount = tableCols.filter(c => session.queryModel.isColumnSelected(fn.id, c.name)).length;
                    headerInfoEl.innerHTML = `
                        <span class="badge bg-primary text-white me-1"><i class="fa-solid fa-table me-1"></i>${escapeHtml(fn.schema)}.${escapeHtml(fn.tableName)}</span>
                        <span class="badge bg-secondary text-white me-2">${selCount}/${tableCols.length} cột được chọn</span>
                        <button type="button" class="btn btn-xs btn-outline-primary py-0 vqd-btn-filter-table" style="font-size: 11px;">
                            <i class="fa-solid ${session.filterTableOnly ? 'fa-list' : 'fa-filter'} me-1"></i>${session.filterTableOnly ? 'Hiện tất cả bảng' : 'Chỉ hiện bảng này'}
                        </button>
                    `;
                    headerInfoEl.querySelector('.vqd-btn-filter-table')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        session.filterTableOnly = !session.filterTableOnly;
                        this._renderCriteriaGrid(session);
                    });
                } else {
                    headerInfoEl.innerHTML = `<span class="small text-muted" style="font-size: 11px;">Chọn cột, alias, sắp xếp và bộ lọc</span>`;
                }
            }

            // Fast class toggle on existing rows without destroying HTML
            let firstFocusedRow = null;
            tbody.querySelectorAll('tr').forEach(tr => {
                const tableId = tr.dataset.tableId;
                const tableAlias = (tr.dataset.tableAlias || '').toLowerCase();
                const isItemOfFocusedTable = session.focusedTableId && (
                    tableId === session.focusedTableId ||
                    (session.focusedTableNode && (
                        tableAlias === session.focusedTableNode.alias.toLowerCase() ||
                        tableAlias === session.focusedTableNode.tableName.toLowerCase()
                    ))
                );

                if (isItemOfFocusedTable) {
                    tr.classList.add('vqd-row-focused');
                    if (!firstFocusedRow) firstFocusedRow = tr;
                } else {
                    tr.classList.remove('vqd-row-focused');
                }
            });

            if (firstFocusedRow) {
                firstFocusedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        _highlightTableInMonaco(session, tableNode) {
            if (!session.monacoEditor) return;
            const ed = session.monacoEditor;
            const model = ed.getModel();
            if (!model) return;

            // Clear previous decorations if tableNode is null
            if (!tableNode) {
                if (session.tableDecorations && session.tableDecorations.length > 0) {
                    session.tableDecorations = ed.deltaDecorations(session.tableDecorations, []);
                }
                return;
            }

            const decorations = [];

            // 1. Highlight table name or alias in SQL
            const namesToMatch = [tableNode.tableName];
            if (tableNode.alias && tableNode.alias !== tableNode.tableName) {
                namesToMatch.push(tableNode.alias);
            }

            let firstMatchRange = null;

            namesToMatch.forEach(name => {
                if (!name) return;
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const matches = model.findMatches(`\\b${escaped}\\b`, false, true, false, null, true);
                matches.forEach(m => {
                    if (!firstMatchRange) firstMatchRange = m.range;
                    decorations.push({
                        range: m.range,
                        options: {
                            inlineClassName: 'vqd-monaco-highlight-table',
                            hoverMessage: { value: `**Bảng:** ${tableNode.schema}.${tableNode.tableName}` }
                        }
                    });
                });
            });

            // 2. Highlight selected columns of this table
            const allCols = tableNode.columns || [];
            const selectedCols = allCols.filter(c => session.queryModel.isColumnSelected(tableNode.id, c.name));
            selectedCols.forEach(col => {
                if (!col.name) return;
                const escapedCol = col.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const matches = model.findMatches(`\\b${escapedCol}\\b`, false, true, false, null, true);
                matches.forEach(m => {
                    decorations.push({
                        range: m.range,
                        options: {
                            inlineClassName: 'vqd-monaco-highlight-column',
                            hoverMessage: { value: `**Cột đã chọn:** ${tableNode.tableName}.${col.name}` }
                        }
                    });
                });
            });

            session.tableDecorations = ed.deltaDecorations(session.tableDecorations || [], decorations);

            // Scroll table into view in split mode
            if (firstMatchRange && (session.currentMode === 'split' || session.currentMode === 'code')) {
                ed.revealRangeInCenterIfOutsideViewport(firstMatchRange);
            }
        }

        _onFlowNodeSelect(session, flowNode) {
            if (!flowNode) {
                if (session.flowNodeDecorations && session.monacoEditor) {
                    session.flowNodeDecorations = session.monacoEditor.deltaDecorations(session.flowNodeDecorations, []);
                }
                const headerInfoEl = session.domPane.querySelector('.vqd-criteria-header-info');
                if (headerInfoEl && !session.focusedTableId) {
                    headerInfoEl.innerHTML = `<span class="small text-muted" style="font-size: 11px;">Chọn node trên sơ đồ để xem phạm vi mã nguồn và chi tiết</span>`;
                }
                return;
            }

            // Update Criteria Header with node info
            const headerInfoEl = session.domPane.querySelector('.vqd-criteria-header-info');
            if (headerInfoEl) {
                const stepNum = flowNode.logicalStep || 1;
                headerInfoEl.innerHTML = `
                    <span class="badge bg-primary text-white me-1">[${stepNum}] ${escapeHtml(flowNode.nodeType)}</span>
                    <span class="fw-semibold text-truncate me-2" style="max-width: 180px;">${escapeHtml(flowNode.label)}</span>
                    <span class="text-muted small text-truncate d-none d-md-inline" style="max-width: 250px;">${escapeHtml(flowNode.sqlFragment ? flowNode.sqlFragment.slice(0, 60) : '')}</span>
                `;
            }

            // Highlight source span in Monaco Editor (Section 10 & Phase 4/5)
            if (!session.monacoEditor) return;
            const ed = session.monacoEditor;
            const model = ed.getModel();
            if (!model) return;

            const decorations = [];
            let targetRange = null;

            if (flowNode.sourceRange && typeof flowNode.sourceRange.startLine === 'number' && flowNode.sourceRange.startLine > 0) {
                const sr = flowNode.sourceRange;
                targetRange = new monaco.Range(
                    sr.startLine,
                    sr.startColumn || 1,
                    sr.endLine || sr.startLine,
                    sr.endColumn || (sr.startColumn ? sr.startColumn + 10 : 20)
                );
            } else if (flowNode.sqlFragment) {
                // Fallback: search for first occurrence of sqlFragment snippet in model
                const snippet = flowNode.sqlFragment.trim().slice(0, 40);
                if (snippet) {
                    const matches = model.findMatches(snippet, false, false, false, null, true);
                    if (matches.length > 0) {
                        targetRange = matches[0].range;
                    }
                }
            }

            if (targetRange) {
                decorations.push({
                    range: targetRange,
                    options: {
                        inlineClassName: 'vqd-monaco-highlight-flow-node',
                        hoverMessage: { value: `**[${flowNode.logicalStep || 1}] ${flowNode.nodeType}:** ${flowNode.label}` }
                    }
                });
                if (session.currentMode === 'split' || session.currentMode === 'code') {
                    ed.revealRangeInCenterIfOutsideViewport(targetRange);
                }
            }

            session.flowNodeDecorations = ed.deltaDecorations(session.flowNodeDecorations || [], decorations);
        }

        _renderCriteriaGrid(session) {
            const tbody = session.domPane.querySelector('.vqd-criteria-table tbody');
            if (!tbody) return;
            tbody.innerHTML = '';

            // Update Criteria Header Info
            const headerInfoEl = session.domPane.querySelector('.vqd-criteria-header-info');
            if (headerInfoEl) {
                if (session.focusedTableId && session.focusedTableNode) {
                    const fn = session.focusedTableNode;
                    const tableCols = (fn.columns || []);
                    const selCount = tableCols.filter(c => session.queryModel.isColumnSelected(fn.id, c.name)).length;
                    headerInfoEl.innerHTML = `
                        <span class="badge bg-primary text-white me-1"><i class="fa-solid fa-table me-1"></i>${escapeHtml(fn.schema)}.${escapeHtml(fn.tableName)}</span>
                        <span class="badge bg-secondary text-white me-2">${selCount}/${tableCols.length} cột được chọn</span>
                        <button type="button" class="btn btn-xs btn-outline-primary py-0 vqd-btn-filter-table" style="font-size: 11px;">
                            <i class="fa-solid ${session.filterTableOnly ? 'fa-list' : 'fa-filter'} me-1"></i>${session.filterTableOnly ? 'Hiện tất cả bảng' : 'Chỉ hiện bảng này'}
                        </button>
                    `;
                    headerInfoEl.querySelector('.vqd-btn-filter-table')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        session.filterTableOnly = !session.filterTableOnly;
                        this._renderCriteriaGrid(session);
                    });
                } else {
                    headerInfoEl.innerHTML = `<span class="small text-muted" style="font-size: 11px;">Chọn cột, alias, sắp xếp và bộ lọc</span>`;
                }
            }

            const items = session.queryModel.selectItems || [];
            if (items.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-3 small">
                            Chưa chọn cột nào. Chọn các cột trong bảng trên canvas hoặc kéo cột vào đây.
                        </td>
                    </tr>
                `;
                return;
            }

            let firstFocusedRow = null;
            let visibleCount = 0;

            items.forEach((item, idx) => {
                const isItemOfFocusedTable = session.focusedTableId && (
                    item.tableId === session.focusedTableId ||
                    (session.focusedTableNode && item.tableAlias && (
                        item.tableAlias.toLowerCase() === session.focusedTableNode.alias.toLowerCase() ||
                        item.tableAlias.toLowerCase() === session.focusedTableNode.tableName.toLowerCase()
                    ))
                );

                if (session.filterTableOnly && session.focusedTableId && !isItemOfFocusedTable) {
                    return; // Skip non-focused tables if filter is active
                }

                visibleCount++;
                const tr = document.createElement('tr');
                tr.dataset.tableId = item.tableId || '';
                tr.dataset.tableAlias = item.tableAlias || '';
                if (isItemOfFocusedTable) {
                    tr.classList.add('vqd-row-focused');
                    if (!firstFocusedRow) firstFocusedRow = tr;
                }

                tr.innerHTML = `
                    <td class="text-center">
                        <input type="checkbox" class="form-check-input vqd-crit-output" ${item.output !== false ? 'checked' : ''}>
                    </td>
                    <td>
                        <span class="fw-semibold text-truncate d-inline-block" style="max-width: 170px;">${escapeHtml(item.column)}</span>
                    </td>
                    <td>
                        <span class="text-secondary text-truncate d-inline-block" style="max-width: 150px;">${escapeHtml(item.tableAlias || '')}</span>
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm py-0 vqd-crit-alias" value="${escapeHtml(item.alias || '')}" placeholder="Alias...">
                    </td>
                    <td>
                        <select class="form-select form-select-sm py-0 vqd-crit-sort">
                            <option value="" ${!item.sort ? 'selected' : ''}>(None)</option>
                            <option value="ASC" ${item.sort === 'ASC' ? 'selected' : ''}>Ascending</option>
                            <option value="DESC" ${item.sort === 'DESC' ? 'selected' : ''}>Descending</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" class="form-control form-control-sm py-0 vqd-crit-criteria" value="${escapeHtml(item.criteria || '')}" placeholder="Điều kiện (vd: = 1, > 100)...">
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn btn-sm btn-link text-danger p-0 vqd-crit-del" title="Xóa khỏi SELECT"><i class="fa-solid fa-xmark"></i></button>
                    </td>
                `;

                // Wire changes
                tr.querySelector('.vqd-crit-output').addEventListener('change', (e) => {
                    item.output = e.target.checked;
                    this._onCanvasModelChange(session, 'criteria-changed', {});
                });
                tr.querySelector('.vqd-crit-alias').addEventListener('change', (e) => {
                    item.alias = e.target.value.trim();
                    this._onCanvasModelChange(session, 'criteria-changed', {});
                });
                tr.querySelector('.vqd-crit-sort').addEventListener('change', (e) => {
                    item.sort = e.target.value;
                    this._onCanvasModelChange(session, 'criteria-changed', {});
                });
                tr.querySelector('.vqd-crit-criteria').addEventListener('change', (e) => {
                    item.criteria = e.target.value.trim();
                    this._onCanvasModelChange(session, 'criteria-changed', {});
                });
                tr.querySelector('.vqd-crit-del').addEventListener('click', () => {
                    session.queryModel.selectItems.splice(idx, 1);
                    session.d3Renderer.render(session.queryModel);
                    this._onCanvasModelChange(session, 'criteria-deleted', {});
                });

                tbody.appendChild(tr);
            });

            if (visibleCount === 0 && session.filterTableOnly) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center text-muted py-3 small">
                            Bảng đang chọn chưa có cột nào được đưa vào SELECT.
                        </td>
                    </tr>
                `;
            }

            if (firstFocusedRow) {
                setTimeout(() => {
                    firstFocusedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 50);
            }
        }

        _normalizeObjectType(rawType) {
            if (!rawType) return 'table';
            const t = String(rawType).toUpperCase().trim();
            if (t === 'U' || t === 'BASE TABLE' || t === 'TABLE' || t === 'USER_TABLE') return 'table';
            if (t === 'V' || t === 'VIEW') return 'view';
            if (t === 'SN' || t === 'SYNONYM') return 'synonym';
            return t.toLowerCase();
        }

        async _loadDatabaseObjects(session) {
            const listEl = session.domPane.querySelector('.vqd-objects-list');
            if (!listEl) return;

            listEl.innerHTML = '<div class="text-muted small p-2"><i class="fa-solid fa-spinner fa-spin me-2"></i>Đang tải danh sách bảng...</div>';

            try {
                const objects = await this._fetchDatabaseObjects(session.connId, session.database, session.schema, session.dbType);
                const tables = (objects || []).map(o => {
                    const rawName = o.name || o.table_name || o.tableName || o.object_name || '';
                    const rawType = o.type || o.object_type || o.table_type || 'table';
                    const rawSchema = o.schema || o.schema_name || o.schemaName || session.schema;
                    return {
                        name: rawName,
                        schema: rawSchema,
                        type: this._normalizeObjectType(rawType)
                    };
                }).filter(o => o.name && (o.type === 'table' || o.type === 'view' || o.type === 'synonym'));

                if (tables.length === 0) {
                    listEl.innerHTML = '<div class="text-muted small p-2">Không có bảng hoặc view nào.</div>';
                    return;
                }

                listEl.innerHTML = '';
                const searchInput = session.domPane.querySelector('.vqd-objects-search');
                const term = (searchInput?.value || '').toLowerCase().trim();

                tables.forEach(t => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'vqd-object-item d-flex align-items-center justify-content-between p-1 rounded mb-1';
                    itemEl.dataset.name = t.name;
                    itemEl.dataset.schema = t.schema || session.schema;
                    itemEl.dataset.type = t.type;
                    itemEl.draggable = true;

                    const fullName = `${t.schema || session.schema}.${t.name}`.toLowerCase();
                    const nameLower = (t.name || '').toLowerCase();
                    if (term && !nameLower.includes(term) && !fullName.includes(term)) {
                        itemEl.classList.add('d-none');
                        itemEl.style.setProperty('display', 'none', 'important');
                    }

                    let icon = 'fa-table text-primary';
                    let typeBadge = '';
                    if (t.type === 'view') {
                        icon = 'fa-eye text-info';
                        typeBadge = '<span class="badge bg-info-subtle text-info border border-info-subtle ms-auto me-1" style="font-size: 8px; padding: 2px 4px;">VIEW</span>';
                    } else if (t.type === 'synonym') {
                        icon = 'fa-arrow-up-right-from-square text-warning';
                        typeBadge = '<span class="badge bg-warning-subtle text-warning border border-warning-subtle ms-auto me-1" style="font-size: 8px; padding: 2px 4px;">SYNONYM</span>';
                    }

                    itemEl.innerHTML = `
                        <div class="d-flex align-items-center text-truncate me-1" style="font-size: 12px; cursor: grab;">
                            <i class="fa-solid ${icon} me-2" style="font-size: 11px;"></i>
                            <span class="text-truncate" title="${escapeHtml(t.schema || session.schema)}.${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                        </div>
                        <div class="d-flex align-items-center">
                            ${typeBadge}
                            <button type="button" class="btn btn-sm btn-link text-success p-0 vqd-btn-add-table" title="Thêm vào sơ đồ">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    `;

                    // Drag-and-drop to canvas
                    itemEl.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                            tableName: t.name,
                            schema: t.schema || session.schema,
                            sourceType: t.type
                        }));
                    });

                    // Plus button click
                    itemEl.querySelector('.vqd-btn-add-table').addEventListener('click', () => {
                        this.addTableToDesign(session, t.name, t.schema || session.schema, t.type);
                    });

                    listEl.appendChild(itemEl);
                });

                // Canvas drop target handler
                const canvasWrap = session.domPane.querySelector('.vqd-canvas-wrapper');
                canvasWrap.addEventListener('dragover', (e) => e.preventDefault());
                canvasWrap.addEventListener('drop', (e) => {
                    e.preventDefault();
                    try {
                        const raw = e.dataTransfer.getData('application/json');
                        if (raw) {
                            const data = JSON.parse(raw);
                            this.addTableToDesign(session, data.tableName, data.schema, data.sourceType);
                        }
                    } catch (_) {}
                });

            } catch (e) {
                console.error('[SqlVisualizer] Error loading objects:', e);
                listEl.innerHTML = `<div class="text-danger small p-2">Lỗi tải danh sách đối tượng: ${escapeHtml(e.message)}</div>`;
            }
        }

        async addTableToDesign(session, tableName, schema, sourceType = 'table') {
            const tableNode = new TableNode({
                database: session.database,
                schema: schema || session.schema,
                tableName: tableName,
                alias: tableName,
                sourceType: sourceType,
                x: 60 + (session.queryModel.tables.size * 50) % 400,
                y: 60 + (session.queryModel.tables.size * 40) % 300
            });

            // Fetch columns
            try {
                const cols = await this._fetchTableColumns(session.connId, session.database, tableNode.schema, tableName);
                if (Array.isArray(cols)) {
                    tableNode.columns = cols.map(c => ({
                        name: c.name || '',
                        type: c.type || 'varchar',
                        isPk: !!(c.is_pk || c.isPk),
                        isFk: !!(c.is_fk || c.isFk),
                        nullable: c.nullable !== undefined ? c.nullable : true
                    }));
                }
            } catch (_) {}

            session.queryModel.addTable(tableNode);
            session.d3Renderer.render(session.queryModel);
            this._onCanvasModelChange(session, 'table-added', { tableNode });
        }

        generateSqlFromDesign(session) {
            if (!session.monacoEditor) return;
            session.isSyncing = true;
            try {
                const newSql = DefaultSqlGenerator.generate(session.queryModel);
                const currentSql = session.monacoEditor.getValue();
                if (currentSql === newSql) {
                    session.queryModel.syncStatus = 'synced';
                    this._updateSyncStatusBadge(session);
                    return;
                }

                // Smoothly update Monaco without resetting editor cursor/scroll position
                const model = session.monacoEditor.getModel();
                if (model) {
                    session.monacoEditor.executeEdits('vqd-sync', [{
                        range: model.getFullModelRange(),
                        text: newSql
                    }]);
                    session.monacoEditor.pushUndoStop();
                } else {
                    session.monacoEditor.setValue(newSql);
                }

                session.queryModel.syncStatus = 'synced';
                this._updateSyncStatusBadge(session);
                if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
            } finally {
                session.isSyncing = false;
            }
        }

        async refreshDesignFromSql(session) {
            if (!session.monacoEditor) return;
            const sql = session.monacoEditor.getValue();
            session.isSyncing = true;

            try {
                const newModel = DefaultSqlParser.parse(sql, {
                    dialect: session.dbType === 'postgresql' ? 'postgresql' : 'sqlserver',
                    defaultSchema: session.schema,
                    existingModel: session.queryModel
                });

                session.queryModel = newModel;

                // Load any missing columns
                await this._populateTableColumns(session);

                // Render D3 Canvas & Criteria (Preserve existing coordinates)
                session.d3Renderer.render(session.queryModel);
                if (session.d3Renderer.shouldRenderFlowGraph()) {
                    session.d3Renderer.applyFlowTopologicalLayout(false);
                } else {
                    session.d3Renderer.applyHierarchicalLayout(false);
                }
                session.d3Renderer.zoomFit();
                this._renderCriteriaGrid(session);

                // Update view mode button state
                const btnViewMode = session.domPane.querySelector('.vqd-btn-toggle-viewmode');
                if (btnViewMode && session.d3Renderer) {
                    const isFlow = session.d3Renderer.shouldRenderFlowGraph();
                    btnViewMode.classList.toggle('active', isFlow);
                    btnViewMode.innerHTML = isFlow
                        ? '<i class="fa-solid fa-sitemap me-1 text-primary"></i>Flow'
                        : '<i class="fa-solid fa-table me-1 text-secondary"></i>Tables';
                }

                // Push history
                session.historyManager.pushState(session.queryModel);

                // Update warning banner if unsupported
                const warnBanner = session.domPane.querySelector('.vqd-warning-banner');
                if (newModel.parseStatus === 'unsupported') {
                    if (warnBanner) {
                        warnBanner.classList.remove('d-none');
                        const warnText = warnBanner.querySelector('.vqd-warning-text');
                        if (warnText) warnText.textContent = newModel.unsupportedFragments.join(' ') || 'Cú pháp SQL phức tạp/chưa hỗ trợ trực quan hóa đầy đủ.';
                    }
                } else {
                    if (warnBanner) warnBanner.classList.add('d-none');
                }

                this._updateSyncStatusBadge(session);
            } catch (err) {
                console.error('[SqlVisualizer] Refresh error:', err);
                session.queryModel.syncStatus = 'parse_error';
                this._updateSyncStatusBadge(session);
            } finally {
                session.isSyncing = false;
            }
        }

        undo(session) {
            const prevState = session.historyManager.undo(session.queryModel);
            if (prevState) {
                session.queryModel = prevState;
                session.d3Renderer.render(session.queryModel);
                this._renderCriteriaGrid(session);
                this.generateSqlFromDesign(session);
            }
        }

        redo(session) {
            const nextState = session.historyManager.redo();
            if (nextState) {
                session.queryModel = nextState;
                session.d3Renderer.render(session.queryModel);
                this._renderCriteriaGrid(session);
                this.generateSqlFromDesign(session);
            }
        }

        // ==========================================
        // Phase 5 & 6: Inspector, Navigation, and Physical Plan
        // ==========================================

        _activateBottomTab(session, tabName) {
            const pane = session.domPane;
            const validTabs = ['criteria', 'inspector', 'execution-plan'];
            const target = validTabs.includes(tabName) ? tabName : 'criteria';

            pane.querySelectorAll('.vqd-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.bottomTab === target);
            });

            pane.querySelector('.vqd-pane-criteria')?.classList.toggle('d-none', target !== 'criteria');
            pane.querySelector('.vqd-pane-inspector')?.classList.toggle('d-none', target !== 'inspector');
            pane.querySelector('.vqd-pane-plan')?.classList.toggle('d-none', target !== 'execution-plan');

            const hintEl = pane.querySelector('.vqd-tab-hint');
            if (hintEl) {
                if (target === 'criteria') {
                    hintEl.textContent = 'Chọn cột, alias, sắp xếp và bộ lọc';
                } else if (target === 'inspector') {
                    hintEl.textContent = 'Chi tiết Query Node & đoạn SQL tương ứng';
                } else if (target === 'execution-plan') {
                    hintEl.textContent = 'Thông số chi tiết Execution Plan vật lý';
                }
            }
        }

        _onEditorCursorMove(session, line, col) {
            if (!session.queryModel?.flowGraph) return;
            const node = session.queryModel.flowGraph.findNodeAtSourcePosition(line, col);
            if (node) {
                if (session.d3Renderer && session.d3Renderer.focusedNodeId !== node.id) {
                    session.d3Renderer.focusNode(node.id, false);
                }
                this._renderNodeInspector(session, node);

                if (session.monacoEditor && node.sourceRange) {
                    const sr = node.sourceRange;
                    if (sr.startLine > 0 && sr.endLine > 0) {
                        try {
                            const range = new monaco.Range(sr.startLine, sr.startColumn, sr.endLine, sr.endColumn);
                            session.nodeDecorations = session.monacoEditor.deltaDecorations(session.nodeDecorations || [], [
                                {
                                    range: range,
                                    options: {
                                        isWholeLine: false,
                                        className: 'vqd-monaco-highlight-flow-node'
                                    }
                                }
                            ]);
                        } catch (_) {}
                    }
                }
            }
        }

        _onFlowNodeSelect(session, flowNode) {
            if (!flowNode) {
                if (session.monacoEditor) {
                    session.nodeDecorations = session.monacoEditor.deltaDecorations(session.nodeDecorations || [], []);
                }
                this._clearNodeInspector(session);
                return;
            }

            if (session.monacoEditor && flowNode.sourceRange) {
                const sr = flowNode.sourceRange;
                if (sr.startLine > 0 && sr.endLine > 0) {
                    session.isNavigatingFromCanvas = true;
                    try {
                        const range = new monaco.Range(sr.startLine, sr.startColumn, sr.endLine, sr.endColumn);
                        session.monacoEditor.setSelection(range);
                        session.monacoEditor.revealRangeInCenter(range);

                        session.nodeDecorations = session.monacoEditor.deltaDecorations(session.nodeDecorations || [], [
                            {
                                range: range,
                                options: {
                                    isWholeLine: false,
                                    className: 'vqd-monaco-highlight-flow-node'
                                }
                            }
                        ]);
                    } catch (_) {}
                    setTimeout(() => { session.isNavigatingFromCanvas = false; }, 120);
                }
            }

            this._renderNodeInspector(session, flowNode);
            this._activateBottomTab(session, 'inspector');
        }

        _renderNodeInspector(session, flowNode) {
            const pane = session.domPane;
            const emptyEl = pane.querySelector('.vqd-inspector-empty');
            const contentEl = pane.querySelector('.vqd-inspector-content');
            if (!emptyEl || !contentEl) return;

            emptyEl.classList.add('d-none');
            contentEl.classList.remove('d-none');

            const stepBadge = pane.querySelector('.vqd-insp-step-badge');
            if (stepBadge) {
                stepBadge.textContent = `[${flowNode.logicalStep || 0}]`;
            }

            const headerStepBadge = pane.querySelector('.vqd-inspector-step-badge');
            if (headerStepBadge) {
                headerStepBadge.textContent = `[${flowNode.logicalStep || 0}]`;
                headerStepBadge.classList.remove('d-none');
            }

            const titleEl = pane.querySelector('.vqd-insp-title');
            if (titleEl) {
                titleEl.textContent = flowNode.label || flowNode.tableName || flowNode.nodeType || 'Node';
            }

            const typeBadge = pane.querySelector('.vqd-insp-type-badge');
            if (typeBadge) {
                typeBadge.textContent = flowNode.nodeType || 'Unknown';
            }

            const statusBadge = pane.querySelector('.vqd-insp-status-badge');
            if (statusBadge) {
                const status = flowNode.status || 'valid';
                if (status === 'valid') {
                    statusBadge.className = 'badge bg-success-subtle text-success vqd-insp-status-badge';
                    statusBadge.textContent = 'Valid';
                } else if (status === 'warning') {
                    statusBadge.className = 'badge bg-warning-subtle text-warning vqd-insp-status-badge';
                    statusBadge.textContent = 'Warning';
                } else if (status === 'recursive') {
                    statusBadge.className = 'badge bg-danger-subtle text-danger vqd-insp-status-badge';
                    statusBadge.textContent = 'Recursive';
                } else {
                    statusBadge.className = 'badge bg-secondary-subtle text-secondary vqd-insp-status-badge';
                    statusBadge.textContent = status;
                }
            }

            const codeEl = pane.querySelector('.vqd-insp-sql-code');
            if (codeEl) {
                codeEl.textContent = flowNode.sqlFragment || '-- Không có đoạn SQL riêng';
            }

            const depsEl = pane.querySelector('.vqd-insp-deps');
            if (depsEl && session.queryModel?.flowGraph) {
                const fg = session.queryModel.flowGraph;
                const preds = fg.getPredecessors(flowNode.id) || [];
                const succs = fg.getSuccessors(flowNode.id) || [];

                let html = '<div class="mb-1"><strong>Inbound Producers:</strong> ';
                if (preds.length === 0) {
                    html += '<span class="text-muted fst-italic">None (Root / Source)</span>';
                } else {
                    html += preds.map(p => `<span class="badge bg-secondary-subtle text-secondary me-1 vqd-nav-dep-badge" data-node-id="${escapeHtml(p.id)}" style="cursor:pointer;" title="Nhấn để focus node [${p.logicalStep || 0}]">[${p.logicalStep || 0}] ${escapeHtml(p.label || p.nodeType)}</span>`).join('');
                }
                html += '</div>';

                html += '<div><strong>Outbound Consumers:</strong> ';
                if (succs.length === 0) {
                    html += '<span class="text-muted fst-italic">None (Final Result)</span>';
                } else {
                    html += succs.map(s => `<span class="badge bg-primary-subtle text-primary me-1 vqd-nav-dep-badge" data-node-id="${escapeHtml(s.id)}" style="cursor:pointer;" title="Nhấn để focus node [${s.logicalStep || 0}]">[${s.logicalStep || 0}] ${escapeHtml(s.label || s.nodeType)}</span>`).join('');
                }
                html += '</div>';

                depsEl.innerHTML = html;

                depsEl.querySelectorAll('.vqd-nav-dep-badge').forEach(badge => {
                    badge.addEventListener('click', () => {
                        const targetId = badge.dataset.nodeId;
                        if (targetId && session.d3Renderer) {
                            session.d3Renderer.focusNode(targetId, true);
                        }
                    });
                });
            }

            const colsEl = pane.querySelector('.vqd-insp-cols');
            if (colsEl) {
                const cols = flowNode.columns || [];
                if (cols.length === 0) {
                    colsEl.innerHTML = '<strong>Output Columns:</strong> <span class="fst-italic">All (*)</span>';
                } else {
                    const colNames = cols.map(c => escapeHtml(c.name || '')).join(', ');
                    colsEl.innerHTML = `<strong>Output Columns (${cols.length}):</strong> ${colNames}`;
                }
            }
        }

        _clearNodeInspector(session) {
            const pane = session.domPane;
            pane.querySelector('.vqd-inspector-empty')?.classList.remove('d-none');
            pane.querySelector('.vqd-inspector-content')?.classList.add('d-none');
            const headerBadge = pane.querySelector('.vqd-inspector-step-badge');
            if (headerBadge) headerBadge.classList.add('d-none');
        }

        async fetchExecutionPlan(session, planType = 'estimated') {
            if (planType === 'actual') {
                const confirmed = window.confirm(
                    "⚠️ CẢNH BÁO THỰC THI TRUY VẤN:\n\n" +
                    "Lấy Actual Execution Plan sẽ thực thi câu lệnh SQL trực tiếp trên cơ sở dữ liệu để đo lường thống kê runtime thực tế (Rows, Thời gian thực thi, CPU/IO).\n\n" +
                    "Thao tác này có thể tốn thời gian hoặc làm thay đổi dữ liệu nếu câu lệnh chứa thao tác ghi.\n\n" +
                    "Bạn có chắc chắn muốn tiếp tục thực thi không?"
                );
                if (!confirmed) return;
            }

            const sql = session.monacoEditor?.getValue() || session.originalDefinition || '';
            if (!sql.trim()) {
                alert('Vui lòng nhập câu lệnh SQL trước khi lấy Execution Plan.');
                return;
            }

            const statusBadge = session.domPane.querySelector('.vqd-sync-badge');
            if (statusBadge) {
                statusBadge.className = 'vqd-sync-badge badge bg-warning-subtle text-warning border border-warning-subtle';
                statusBadge.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i>Loading ${planType === 'actual' ? 'Actual' : 'Estimated'} Plan...`;
            }

            try {
                let planData = null;

                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_query_plan === 'function') {
                    const res = await window.pywebview.api.get_query_plan(session.connId, session.database, sql, planType);
                    if (res && res.success) {
                        planData = res.plan;
                    } else {
                        throw new Error(res?.error || 'Không thể lấy execution plan từ pywebview IPC');
                    }
                } else {
                    const resp = await fetch('/api/metadata/query-plan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            conn_id: session.connId,
                            database: session.database,
                            sql: sql,
                            plan_type: planType
                        })
                    });
                    const resJson = await resp.json();
                    if (resJson && resJson.success) {
                        planData = resJson.plan;
                    } else {
                        throw new Error(resJson?.error || 'Lỗi khi yêu cầu execution plan từ server');
                    }
                }

                if (!planData) {
                    throw new Error('Dữ liệu Execution Plan rỗng');
                }

                session.physicalPlan = planData;

                if (session.d3Renderer) {
                    session.d3Renderer.renderPhysicalPlan(planData);
                }

                this._renderExecutionPlanSummary(session, planData);
                this._activateBottomTab(session, 'execution-plan');

                this._updateSyncStatusBadge(session);

            } catch (err) {
                console.error('[SqlVisualizer] Execution Plan Error:', err);
                alert(`Không thể lấy Execution Plan:\n${err.message}`);
                this._updateSyncStatusBadge(session);
            }
        }

        _renderExecutionPlanSummary(session, planData) {
            const pane = session.domPane;
            const emptyEl = pane.querySelector('.vqd-plan-empty');
            const contentEl = pane.querySelector('.vqd-plan-content');
            if (!emptyEl || !contentEl) return;

            emptyEl.classList.add('d-none');
            contentEl.classList.remove('d-none');

            pane.querySelector('.vqd-plan-sum-dialect').textContent = (planData.dialect || session.dbType || '').toUpperCase();
            pane.querySelector('.vqd-plan-sum-type').textContent = (planData.plan_type || 'estimated').toUpperCase();
            pane.querySelector('.vqd-plan-sum-cost').textContent = planData.total_cost || 0;
            pane.querySelector('.vqd-plan-sum-ops').textContent = `${(planData.nodes || []).length} operators (${(planData.edges || []).length} flows)`;

            const planBadge = pane.querySelector('.vqd-plan-type-badge');
            if (planBadge) {
                planBadge.textContent = (planData.plan_type || 'estimated').toUpperCase();
                planBadge.classList.remove('d-none');
            }
        }

        _onPlanOperatorSelect(session, operatorNode) {
            const pane = session.domPane;
            const detailsEl = pane.querySelector('.vqd-operator-details');
            if (!detailsEl) return;

            if (!operatorNode) {
                detailsEl.innerHTML = '<div class="text-muted small"><i class="fa-solid fa-info-circle me-1"></i>Click vào một Operator trên Execution Plan canvas để xem thuộc tính chi tiết (Cost, Rows, CPU/IO, Predicates).</div>';
                return;
            }

            const sevBadge = operatorNode.cost_severity === 'high' 
                ? '<span class="badge bg-danger ms-2">High Cost</span>'
                : (operatorNode.cost_severity === 'medium' ? '<span class="badge bg-warning text-dark ms-2">Medium Cost</span>' : '<span class="badge bg-secondary ms-2">Low Cost</span>');

            const rowsText = operatorNode.actual_rows !== null && operatorNode.actual_rows !== undefined
                ? `${Math.round(operatorNode.actual_rows).toLocaleString()} (estimated: ${Math.round(operatorNode.estimated_rows).toLocaleString()})`
                : `${Math.round(operatorNode.estimated_rows).toLocaleString()}`;

            const timeText = operatorNode.actual_time_ms !== null && operatorNode.actual_time_ms !== undefined
                ? `${operatorNode.actual_time_ms} ms (loops: ${operatorNode.actual_loops || 1})`
                : 'N/A (Estimated Plan)';

            const warningsHtml = (operatorNode.warnings && operatorNode.warnings.length > 0)
                ? `<div class="alert alert-warning py-1 px-2 mb-2 small"><i class="fa-solid fa-triangle-exclamation me-1"></i>${operatorNode.warnings.map(w => escapeHtml(w)).join('<br>')}</div>`
                : '';

            detailsEl.innerHTML = `
                <div class="card p-2 border bg-body-tertiary">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div class="d-flex align-items-center">
                            <h6 class="mb-0 fw-bold"><i class="fa-solid fa-microchip me-1 text-primary"></i>${escapeHtml(operatorNode.physical_op || operatorNode.operator_type)}</h6>
                            ${sevBadge}
                            <span class="badge bg-info-subtle text-info ms-2">${operatorNode.cost_percent}% Subtree Cost</span>
                        </div>
                        <span class="text-muted small">Operator ID: <code>${escapeHtml(operatorNode.id)}</code></span>
                    </div>
                    ${warningsHtml}
                    <div class="row g-2 small">
                        <div class="col-md-3"><strong>Logical Op:</strong> ${escapeHtml(operatorNode.logical_op || 'N/A')}</div>
                        <div class="col-md-3"><strong>Relation / Object:</strong> ${escapeHtml(operatorNode.relation_name || 'N/A')}</div>
                        <div class="col-md-3"><strong>Operator Cost:</strong> ${operatorNode.operator_cost} (Subtree: ${operatorNode.subtree_cost})</div>
                        <div class="col-md-3"><strong>Rows:</strong> ${rowsText}</div>
                        <div class="col-md-6"><strong>Runtime / Loops:</strong> ${timeText}</div>
                        <div class="col-md-6"><strong>Output Columns:</strong> ${(operatorNode.output_columns && operatorNode.output_columns.length > 0) ? operatorNode.output_columns.map(c => escapeHtml(c)).join(', ') : 'N/A'}</div>
                    </div>
                </div>
            `;

            this._activateBottomTab(session, 'execution-plan');
        }

        _updateSyncStatusBadge(session) {
            const badge = session.domPane.querySelector('.vqd-sync-badge');
            if (!badge) return;

            const status = session.queryModel ? session.queryModel.syncStatus : 'synced';
            if (status === 'synced') {
                badge.className = 'vqd-sync-badge badge bg-success-subtle text-success border border-success-subtle';
                badge.innerHTML = '<i class="fa-solid fa-check me-1"></i>Synced';
            } else if (status === 'design_modified') {
                badge.className = 'vqd-sync-badge badge bg-warning-subtle text-warning border border-warning-subtle';
                badge.innerHTML = '<i class="fa-solid fa-pen-ruler me-1"></i>Design Modified';
            } else if (status === 'code_modified') {
                badge.className = 'vqd-sync-badge badge bg-info-subtle text-info border border-info-subtle';
                badge.innerHTML = '<i class="fa-solid fa-code me-1"></i>SQL Modified';
            } else if (status === 'unsupported_sql') {
                badge.className = 'vqd-sync-badge badge bg-secondary-subtle text-secondary border border-secondary-subtle';
                badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i>Unsupported SQL';
            } else if (status === 'parse_error') {
                badge.className = 'vqd-sync-badge badge bg-danger-subtle text-danger border border-danger-subtle';
                badge.innerHTML = '<i class="fa-solid fa-circle-exclamation me-1"></i>Parse Error';
            }
        }

        activateTab(tabId) {
            const session = sessions.get(tabId);
            if (!session) return;
            activeSession = session;

            const container = document.getElementById('sql-visualizer-container');
            if (!container) return;

            // Hide other session panes
            container.querySelectorAll('.vqd-tab-session-pane').forEach(p => {
                p.classList.toggle('d-none', p.dataset.tabId !== tabId);
            });

            // Layout editor smoothly with rAF without re-building D3 SVG DOM
            if (session.monacoEditor) {
                requestAnimationFrame(() => {
                    session.monacoEditor?.layout();
                });
            }
        }

        closeTab(tabId) {
            const session = sessions.get(tabId);
            if (session) {
                if (session.monacoEditor) {
                    try { session.monacoEditor.dispose(); } catch (_) {}
                    session.monacoEditor = null;
                }
                if (session.domPane && session.domPane.parentNode) {
                    session.domPane.remove();
                }
            }
            sessions.delete(tabId);
            if (activeSession && activeSession.tabId === tabId) {
                activeSession = null;
            }
        }
    }

    const visualizerInstance = new SqlVisualizer();
    SqlVisualization.SqlVisualizer = SqlVisualizer;
    SqlVisualization.Instance = visualizerInstance;
    window.SqlVisualizer = visualizerInstance;

})(window);
