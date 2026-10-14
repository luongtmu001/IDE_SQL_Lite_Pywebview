/**
 * PostgreSQL Dependency Graph - Main Controller
 * Coordinates API calls, Filter Toolbar, D3 Graph Renderer, and Detail Panel.
 * Integrates into IDE Tabs and Context Menu.
 */
(function (global) {
    'use strict';

    class PostgresDependencyController {
        constructor() {
            this.container = null;
            this.api = global.PostgresDependencyApi;
            this.renderer = null;
            this.listView = null;
            this.filter = null;
            this.panel = null;

            this.currentContext = null;
            this.currentGraph = null;
            this.currentTree = null;
            this.activeTabId = null;

            // Per-tab state storage: Map<tabId, { tabId, tabKey, context, graph, tree, direction, depth, layout, directionCache }>
            this.tabStates = new Map();

            // Default fallback cache
            this.directionCache = new Map();

            this.initResizeListener();
        }

        getActiveTabState() {
            if (!this.activeTabId) return null;
            return this.tabStates.get(this.activeTabId) || null;
        }

        initContainer() {
            this.container = document.getElementById('dependency-graph-container');
            if (!this.container) return;

            const needsBuild = !this.renderer || !this.filter || !this.panel || this.container.children.length === 0;
            if (needsBuild) {
                this.container.innerHTML = `
                    <div class="ide-dependency-graph-wrapper">
                        <!-- Toolbar -->
                        <div class="ide-dep-toolbar" id="ide-dep-toolbar-root"></div>
                        
                        <!-- Main View Body -->
                        <div class="ide-dep-body">
                            <!-- Canvas -->
                            <div class="ide-dep-canvas-container" id="ide-dep-canvas-wrap">
                                <svg class="ide-dep-canvas-svg" id="ide-dep-svg-canvas"></svg>
                                <!-- Loading / Empty Overlay -->
                                <div class="ide-dep-overlay d-none" id="ide-dep-loading-overlay">
                                    <div class="ide-dep-spinner"></div>
                                    <div class="small fw-semibold text-light" id="ide-dep-loading-text">Analyzing dependencies...</div>
                                </div>
                            </div>

                            <!-- List View Container -->
                            <div class="ide-dep-list-container d-none" id="ide-dep-list-wrap"></div>

                            <!-- Detail Drawer Panel -->
                            <div class="ide-dep-detail-panel" id="ide-dep-detail-panel-root"></div>
                        </div>
                    </div>
                `;

                const toolbarEl = this.container.querySelector('#ide-dep-toolbar-root');
                const svgEl = this.container.querySelector('#ide-dep-svg-canvas');
                const listWrapEl = this.container.querySelector('#ide-dep-list-wrap');
                const panelEl = this.container.querySelector('#ide-dep-detail-panel-root');

                // Initialize Components
                this.filter = new global.PostgresDependencyFilter(toolbarEl, {
                    refresh: () => {
                        console.log('[PostgresDependency] Manual refresh requested.');
                        const state = this.getActiveTabState();
                        if (state) state.directionCache.clear();
                        this.directionCache.clear();
                        this.loadData({ forceRefresh: true });
                    },
                    directionChange: (dir) => {
                        const state = this.getActiveTabState();
                        if (state) state.direction = dir;
                        this.loadData({ direction: dir, forceRefresh: false });
                    },
                    layoutChange: (layout) => {
                        const state = this.getActiveTabState();
                        if (state) state.layout = layout;
                        this.handleLayoutChange(layout);
                    },
                    depthChange: (depth) => {
                        const state = this.getActiveTabState();
                        if (state) {
                            state.depth = depth;
                            state.directionCache.clear();
                        }
                        this.directionCache.clear();
                        this.loadData({ depth: depth, forceRefresh: true });
                    },
                    typeFilterChange: () => {
                        if (this.renderer && this.filter) {
                            this.renderer.setFilter(node => this.filter.matchesFilter(node));
                        }
                        if (this.listView && this.filter) {
                            this.listView.setFilter(node => this.filter.matchesFilter(node));
                        }
                    },
                    searchChange: (query) => {
                        if (this.renderer) this.renderer.setSearchQuery(query);
                        if (this.listView) this.listView.setSearchQuery(query);
                    },
                    zoomIn: () => this.renderer && this.renderer.zoomIn(),
                    zoomOut: () => this.renderer && this.renderer.zoomOut(),
                    fitScreen: () => this.renderer && this.renderer.fitScreen(),
                    resetZoom: () => this.renderer && this.renderer.resetZoom(),
                    close: () => this.handleToolbarClose()
                });
                this.filter.render();

                this.renderer = new global.PostgresDependencyGraphRenderer(svgEl, {
                    layout: this.filter.currentLayout,
                    filterFn: node => this.filter.matchesFilter(node),
                    onNodeSelect: (node) => {
                        if (this.panel) this.panel.setSelectedNode(node);
                    },
                    onNodeDblClick: (node) => {
                        if (this.panel) this.panel.setSelectedNode(node);
                        if (this.panel && typeof this.panel.handleOpenDefinition === 'function') {
                            this.panel.handleOpenDefinition();
                        }
                    }
                });

                if (global.PostgresDependencyListView && listWrapEl) {
                    this.listView = new global.PostgresDependencyListView(listWrapEl, {
                        filterFn: node => this.filter ? this.filter.matchesFilter(node) : true,
                        onNodeSelect: (node) => {
                            if (this.panel) this.panel.setSelectedNode(node);
                        },
                        onOpenDefinition: (node) => {
                            this.openObjectDefinition(node);
                        }
                    });
                }

                this.panel = new global.PostgresDependencyPanel(panelEl, {
                    onOpenDefinition: (sql, title, node) => {
                        const tabsMgr = window.AppTabs || window.Tabs;
                        if (tabsMgr && typeof tabsMgr.createTab === 'function') {
                            tabsMgr.createTab({
                                title: title || `${node.name}.sql`,
                                content: sql,
                                tabType: 'query',
                                connectionId: this.currentContext?.connId,
                                database: this.currentContext?.database,
                                schema: node.schema
                            });
                        } else if (window.createTab) {
                            window.createTab({
                                title: title || `${node.name}.sql`,
                                content: sql,
                                tabType: 'query',
                                connectionId: this.currentContext?.connId,
                                database: this.currentContext?.database,
                                schema: node.schema
                            });
                        }
                    }
                });
                this.panel.renderEmptyState();
                this.handleLayoutChange(this.filter?.currentLayout || 'list');
            }
        }

        handleLayoutChange(layout) {
            const canvasWrap = this.container?.querySelector('#ide-dep-canvas-wrap');
            const listWrap = this.container?.querySelector('#ide-dep-list-wrap');

            if (layout === 'list') {
                if (canvasWrap) canvasWrap.classList.add('d-none');
                if (listWrap) {
                    listWrap.classList.remove('d-none');
                    if (this.listView) {
                        this.listView.setData(this.currentGraph);
                    }
                }
            } else {
                if (listWrap) listWrap.classList.add('d-none');
                if (canvasWrap) canvasWrap.classList.remove('d-none');
                if (this.renderer) {
                    this.renderer.setLayout(layout);
                    this.updateDimensions();
                }
            }
        }

        async openObjectDefinition(node) {
            if (!node) return;
            const connId = this.currentContext?.connId || window.ActiveConnectionId;
            const database = this.currentContext?.database || window.ActiveDatabase;

            try {
                if (window.AppLoader) window.AppLoader.show(`Đang tải mã nguồn DDL cho ${node.name}...`);
                const res = await this.api.getObjectDefinition(connId, {
                    type: node.object_type,
                    schema: node.schema,
                    name: node.name,
                    oid: node.oid,
                    database: database
                });
                if (window.AppLoader) window.AppLoader.hide();

                if (res && res.success && res.definition) {
                    const tabsMgr = window.AppTabs || window.Tabs;
                    const tabTitle = `${node.name}.sql`;
                    if (tabsMgr && typeof tabsMgr.createTab === 'function') {
                        tabsMgr.createTab({
                            title: tabTitle,
                            content: res.definition,
                            tabType: 'query',
                            connectionId: connId,
                            database: database,
                            schema: node.schema
                        });
                    } else if (window.createTab) {
                        window.createTab({
                            title: tabTitle,
                            content: res.definition,
                            tabType: 'query',
                            connectionId: connId,
                            database: database,
                            schema: node.schema
                        });
                    }
                } else {
                    alert(res?.error || `Không thể lấy mã nguồn DDL cho đối tượng ${node.name}.`);
                }
            } catch (err) {
                if (window.AppLoader) window.AppLoader.hide();
                console.error('[PostgresDependency] Error opening definition:', err);
                alert(`Lỗi khi tải mã nguồn DDL: ${err.message}`);
            }
        }

        initResizeListener() {
            window.addEventListener('resize', () => {
                if (this.container && !this.container.classList.contains('d-none')) {
                    this.updateDimensions();
                }
            });
        }

        updateDimensions() {
            const canvasWrap = this.container?.querySelector('#ide-dep-canvas-wrap');
            if (canvasWrap && this.renderer) {
                let w = canvasWrap.clientWidth;
                let h = canvasWrap.clientHeight;
                if (!w || !h || w <= 50 || h <= 50) {
                    const rect = canvasWrap.getBoundingClientRect();
                    if (rect.width > 0) w = rect.width;
                    if (rect.height > 0) h = rect.height;
                }
                if (w > 0 && h > 0) {
                    this.renderer.resize(w, h);
                }
            }
        }

        showLoading(msg = 'Analyzing dependencies...') {
            const overlay = this.container?.querySelector('#ide-dep-loading-overlay');
            const txt = this.container?.querySelector('#ide-dep-loading-text');
            if (overlay) overlay.classList.remove('d-none');
            if (txt) txt.textContent = msg;
        }

        hideLoading() {
            const overlay = this.container?.querySelector('#ide-dep-loading-overlay');
            if (overlay) overlay.classList.add('d-none');
        }

        /**
         * Open Dependency Graph tab for a selected column or object
         * @param {Object} nodeData - context from Object Explorer or editor
         */
        async openGraph(nodeData = {}) {
            this.initContainer();

            const connId = nodeData.connectionId || nodeData.connId || window.ActiveConnectionId;
            const database = nodeData.database || window.ActiveDatabase;
            const schema = nodeData.schema || window.ActiveSchema || 'public';

            const rawType = (nodeData.type || '').toLowerCase();
            const rawObjType = (nodeData.object_type || '').toUpperCase();
            let isColumn = false;
            if (typeof nodeData.isColumn === 'boolean') {
                isColumn = nodeData.isColumn;
            } else {
                isColumn = Boolean(
                    rawObjType === 'COLUMN'
                    || rawType === 'column'
                    || rawType === 'columns'
                    || rawType === 'leaf-columns'
                    || Boolean(nodeData.column)
                    || Boolean(nodeData.columnName)
                    || (Boolean(nodeData.tableName) && Boolean(nodeData.name) && nodeData.tableName !== nodeData.name)
                );
            }

            const table = (isColumn
                ? (nodeData.table || nodeData.tableName || nodeData.parent_name || '')
                : (nodeData.tableName || nodeData.table || (rawType === 'table' ? nodeData.name : '') || nodeData.name || '')
            ).trim();

            const rawCol = isColumn ? (nodeData.column || nodeData.columnName || nodeData.name || '') : '';
            const column = (rawCol.split('(')[0] || '').trim();
            const name = isColumn ? column : (nodeData.name || table).trim();
            const objType = isColumn ? 'COLUMN' : (nodeData.object_type || (rawType === 'table' ? 'TABLE' : (nodeData.type || 'TABLE'))).toUpperCase();

            const tabKey = isColumn 
                ? `dep:col:${connId}:${database || ''}:${schema}:${table}:${column}`
                : `dep:obj:${connId}:${database || ''}:${schema}:${objType}:${name}`;

            const typeLabel = isColumn 
                ? 'Col' 
                : (objType === 'TABLE' ? 'Table' : (objType === 'VIEW' ? 'View' : (objType === 'MATERIALIZED_VIEW' ? 'MatView' : (objType === 'PROCEDURE' ? 'Proc' : (objType === 'FUNCTION' ? 'Func' : objType)))));

            const title = isColumn 
                ? `Dep Col: ${table}.${column}` 
                : `Dep ${typeLabel}: ${name}`;

            this.currentContext = {
                connId,
                database,
                schema,
                table,
                column: isColumn ? column : '',
                name,
                objType,
                isColumn,
                tabKey
            };

            if (this.panel) {
                this.panel.setConnectionContext(connId, database);
            }

            // Create or switch to Dependency Graph Tab in AppTabs
            const tabsMgr = window.AppTabs || window.Tabs;
            let existingTabId = null;
            if (tabsMgr && typeof tabsMgr.getAllTabs === 'function') {
                const allTabs = tabsMgr.getAllTabs();
                for (const [id, t] of allTabs) {
                    if (t.tabType === 'dependency-graph' && t.context) {
                        const tc = t.context;
                        if (tc.tabKey && tc.tabKey === tabKey) {
                            existingTabId = id;
                            break;
                        }
                        const sameConn = (tc.connId === connId && (tc.database || '') === (database || ''));
                        const sameSchema = (tc.schema || 'public').toLowerCase() === schema.toLowerCase();
                        if (sameConn && sameSchema) {
                            if (isColumn && tc.isColumn) {
                                if ((tc.table || '').toLowerCase() === table.toLowerCase() && 
                                    (tc.column || tc.name || '').toLowerCase() === column.toLowerCase()) {
                                    existingTabId = id;
                                    break;
                                }
                            } else if (!isColumn && !tc.isColumn) {
                                if ((tc.name || tc.table || '').toLowerCase() === name.toLowerCase() && 
                                    (tc.objType || 'TABLE').toUpperCase() === objType.toUpperCase()) {
                                    existingTabId = id;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            let targetTabId = null;
            if (existingTabId && tabsMgr && typeof tabsMgr.switchTab === 'function') {
                tabsMgr.switchTab(existingTabId);
                targetTabId = existingTabId;
            } else if (tabsMgr && typeof tabsMgr.createTab === 'function') {
                targetTabId = tabsMgr.createTab({
                    title: title,
                    icon: 'fa-diagram-project',
                    tabType: 'dependency-graph',
                    connectionId: connId,
                    database: database,
                    schema: schema,
                    context: { ...this.currentContext }
                });
            } else if (window.createTab) {
                const tab = window.createTab({
                    title: title,
                    icon: 'fa-diagram-project',
                    tabType: 'dependency-graph',
                    connectionId: connId,
                    database: database,
                    schema: schema,
                    context: { ...this.currentContext }
                });
                targetTabId = tab?.id || window.getActiveTabId?.();
            }

            this.activeTabId = targetTabId || (tabsMgr?.getActiveTabId ? tabsMgr.getActiveTabId() : null);

            let state = this.tabStates.get(this.activeTabId);
            if (!state) {
                state = {
                    tabId: this.activeTabId,
                    tabKey: tabKey,
                    context: { ...this.currentContext },
                    graph: null,
                    tree: null,
                    direction: 'dependents',
                    depth: 2,
                    layout: 'list',
                    directionCache: new Map()
                };
                this.tabStates.set(this.activeTabId, state);
            } else {
                state.context = { ...this.currentContext };
            }

            if (this.filter) {
                this.filter.setDirection(state.direction || 'dependents', false);
                this.filter.setLayout(state.layout || 'list', false);
            }
            this.handleLayoutChange(state.layout || 'list');

            this.activateTab(this.activeTabId, this.currentContext);
            if (!state.graph) {
                await this.loadData({ direction: state.direction || 'dependents', forceRefresh: true });
            }
        }

        activateTab(tabId, context = null) {
            this.activeTabId = tabId;
            this.initContainer();

            if (this.container) {
                this.container.classList.remove('d-none');
            }

            let state = this.tabStates.get(tabId);
            if (!state && context) {
                state = {
                    tabId,
                    tabKey: context.tabKey || '',
                    context: { ...context },
                    graph: null,
                    tree: null,
                    direction: 'dependents',
                    depth: 2,
                    layout: 'list',
                    directionCache: new Map()
                };
                this.tabStates.set(tabId, state);
            }

            if (state && state.context) {
                this.currentContext = state.context;
                if (this.panel && state.context.connId) {
                    this.panel.setConnectionContext(state.context.connId, state.context.database);
                }
            } else if (context) {
                this.currentContext = context;
                if (this.panel && context.connId) {
                    this.panel.setConnectionContext(context.connId, context.database);
                }
            }

            if (state && state.graph) {
                this.currentGraph = state.graph;
                this.currentTree = state.tree;

                if (this.filter) {
                    this.filter.setDirection(state.direction || 'dependents', false);
                    this.filter.setLayout(state.layout || 'list', false);
                    if (typeof this.filter.setDepth === 'function') {
                        this.filter.setDepth(state.depth || 2, false);
                    }
                }
                this.handleLayoutChange(state.layout || 'list');

                if (this.listView) {
                    this.listView.setData(state.graph);
                }
                if (this.renderer) {
                    this.renderer.setData(state.graph, state.tree);
                }
                if (this.panel) {
                    this.panel.setGraph(state.graph);
                    if (state.graph.root) {
                        this.panel.setSelectedNode(state.graph.root);
                    }
                }
                setTimeout(() => this.updateDimensions(), 50);
                setTimeout(() => this.updateDimensions(), 150);
            } else if (this.currentContext) {
                this.loadData({ direction: state?.direction || 'dependents', forceRefresh: true });
            }
        }

        closeTab(tabId) {
            if (this.tabStates.has(tabId)) {
                this.tabStates.delete(tabId);
            }
            if (!tabId || tabId === this.activeTabId) {
                this.activeTabId = null;
                this.currentContext = null;
                this.currentGraph = null;
                this.currentTree = null;

                const tabsMgr = window.AppTabs || window.Tabs;
                let hasOtherDepTabs = false;
                if (tabsMgr && typeof tabsMgr.getAllTabs === 'function') {
                    for (const [id, t] of tabsMgr.getAllTabs()) {
                        if (id !== tabId && t.tabType === 'dependency-graph') {
                            hasOtherDepTabs = true;
                            break;
                        }
                    }
                }
                if (!hasOtherDepTabs && this.container) {
                    this.container.classList.add('d-none');
                }
            }
        }

        handleToolbarClose() {
            const tabsMgr = window.AppTabs || window.Tabs;
            if (tabsMgr && this.activeTabId) {
                tabsMgr.closeTab(this.activeTabId);
            } else {
                this.closeTab(this.activeTabId);
            }
        }

        async loadData(overrideParams = {}) {
            const state = this.getActiveTabState();
            const ctx = state?.context || this.currentContext;
            if (!ctx) return;

            if (state && state.loadingPromise) {
                return state.loadingPromise;
            }

            const direction = overrideParams.direction || state?.direction || this.filter?.currentDirection || 'dependents';
            const depth = overrideParams.depth || state?.depth || this.filter?.currentDepth || 2;
            const forceRefresh = !!overrideParams.forceRefresh;

            if (state) {
                state.direction = direction;
                state.depth = depth;
            }

            const doLoad = async () => {

            // 1. In-memory Cache Check per Tab State:
            const dirCache = state?.directionCache || this.directionCache;
            if (!forceRefresh && dirCache.has(direction)) {
                const cached = dirCache.get(direction);
                if (cached && cached.depth === depth && cached.graph) {
                    console.log(`[PostgresDependency] Serving tab '${this.activeTabId}' direction '${direction}' from cache.`);
                    this.currentGraph = cached.graph;
                    this.currentTree = cached.tree;
                    if (state) {
                        state.graph = cached.graph;
                        state.tree = cached.tree;
                    }

                    this.updateDimensions();

                    if (this.renderer) {
                        this.renderer.setData(this.currentGraph, this.currentTree);
                    }
                    if (this.listView) {
                        this.listView.setData(this.currentGraph);
                    }
                    if (this.filter?.currentLayout === 'list') {
                        this.handleLayoutChange('list');
                    }
                    if (this.panel) {
                        this.panel.setGraph(this.currentGraph);
                        if (this.currentGraph.root) {
                            this.panel.setSelectedNode(this.currentGraph.root);
                        }
                    }
                    return;
                }
            }

            // 2. Fetch from Database
            const targetLabel = ctx.isColumn ? `${ctx.table}.${ctx.column || ctx.name}` : (ctx.table || ctx.name);
            this.showLoading(`Loading dependencies for ${targetLabel}...`);

            try {
                let res = null;
                if (ctx.isColumn || ctx.objType === 'COLUMN') {
                    res = await this.api.getColumnDependencies(ctx.connId, {
                        schema: ctx.schema,
                        table: ctx.table,
                        column: ctx.column || ctx.name,
                        direction: direction,
                        depth: depth,
                        database: ctx.database,
                        includeSource: true
                    });
                } else {
                    res = await this.api.getObjectDependencies(ctx.connId, {
                        type: (ctx.objType || 'TABLE').toLowerCase(),
                        schema: ctx.schema,
                        name: ctx.name || ctx.table,
                        direction: direction,
                        depth: depth,
                        database: ctx.database
                    });
                }

                this.hideLoading();

                console.log('[PostgresDependency] Data received from API:', {
                    tabId: this.activeTabId,
                    isColumn: ctx.isColumn,
                    nodesCount: res?.graph?.nodes?.length,
                    edgesCount: res?.graph?.edges?.length,
                    direction: direction,
                    depth: depth,
                    root: res?.graph?.root
                });

                if (res && res.success && res.graph) {
                    this.currentGraph = res.graph;
                    this.currentTree = res.tree;

                    if (state) {
                        state.graph = res.graph;
                        state.tree = res.tree;
                        state.directionCache.set(direction, {
                            graph: res.graph,
                            tree: res.tree,
                            depth: depth
                        });
                    } else {
                        this.directionCache.set(direction, {
                            graph: res.graph,
                            tree: res.tree,
                            depth: depth
                        });
                    }

                    this.updateDimensions();

                    if (this.renderer) {
                        this.renderer.setData(this.currentGraph, this.currentTree);
                    }
                    if (this.listView) {
                        this.listView.setData(this.currentGraph);
                    }
                    if (this.filter?.currentLayout === 'list') {
                        this.handleLayoutChange('list');
                    }
                    if (this.panel) {
                        this.panel.setGraph(this.currentGraph);
                        if (this.currentGraph.root) {
                            this.panel.setSelectedNode(this.currentGraph.root);
                        }
                    }

                    if (res.graph.nodes && res.graph.nodes.length <= 1) {
                        const hint = direction === 'dependencies' 
                            ? "Không tìm thấy đối tượng ở chiều 'Dependencies (Nó dùng)'. Vui lòng bấm 'Dependents (Dùng nó)' trên thanh công cụ để xem các View và Stored Procedure đang dùng bảng này."
                            : (ctx.isColumn 
                                ? `Không tìm thấy View hay Function/Procedure nào SELECT cột '${ctx.column || ctx.name}' ở chiều 'Dependents'.`
                                : "Không tìm thấy View, Procedure hay Foreign Key nào đang dùng đối tượng này ở chiều 'Dependents'.");
                        console.info('[PostgresDependency]', hint);
                        if (typeof showToast === 'function') {
                            showToast(hint, 'info');
                        }
                    }
                } else {
                    alert(res?.error || 'Unable to retrieve dependency data from PostgreSQL catalog.');
                }
            } catch (err) {
                this.hideLoading();
                console.error('Error loading dependency graph:', err);
                alert(`Error loading dependency graph: ${err.message}`);
            }
        };

        const promise = doLoad();
        if (state) state.loadingPromise = promise;
        try {
            return await promise;
        } finally {
            if (state) state.loadingPromise = null;
        }
    }
    }

    // Expose Global Singleton
    global.PostgresDependencyGraph = new PostgresDependencyController();
})(window);
