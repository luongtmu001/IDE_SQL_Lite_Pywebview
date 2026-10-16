// Tab State Management

function initTabs() {
    const tabsBar  = document.getElementById('ide-tabs-bar');
    const newTabBtn = document.getElementById('ide-new-tab-btn');
    const overflowBtn = document.getElementById('ide-tabs-overflow-btn');
    const tabsContainer = document.querySelector('.ide-tabs-container');

    let tabCounter = 0;
    // tabId -> { tabType, title, content, isDirty, designerData, connectionId, connectionName, database, schema, dbType, ... }
    const tabsData = new Map();
    let activeTabId = null;

    // Tab Layout & Overflow State
    let tabDisplayMode = 'overflow';
    try {
        const savedMode = localStorage.getItem('ide_tab_display_mode');
        if (savedMode === 'all' || savedMode === 'overflow') {
            tabDisplayMode = savedMode;
        }
    } catch (_) {}

    let tabOrder = [];
    const pinnedTabs = new Set();
    let visibleTabIds = new Set();
    let overflowTabIds = new Set();

    function loadSavedDefaultContext() {
        try {
            if (window.AppSession && typeof window.AppSession.getDefaultConnectionContext === 'function') {
                const ctx = window.AppSession.getDefaultConnectionContext();
                if (ctx && typeof ctx === 'object') return ctx;
            }
            const raw = localStorage.getItem('ide_default_connection_context');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return {};
    }

    let defaultContext = loadSavedDefaultContext() || {};

    function setDefaultContext(ctx = {}) {
        defaultContext = { ...defaultContext, ...ctx };
        try {
            if (window.AppSession) { window.AppSession.setDefaultConnectionContext(defaultContext); } else { localStorage.setItem('ide_default_connection_context', JSON.stringify(defaultContext)); }
        } catch (_) {}
    }

    function getDefaultContext() {
        return { ...defaultContext };
    }

    if (defaultContext.connectionId && !window.ActiveConnectionId) {
        window.ActiveConnectionId   = defaultContext.connectionId;
        window.ActiveConnectionName = defaultContext.connectionName;
        window.ActiveDatabase       = defaultContext.database;
        window.ActiveSchema         = defaultContext.schema;
        window.ActiveDbType         = defaultContext.dbType;
    }

    function getUniqueFileName(candidateName, existingNames) {
        if (!candidateName) candidateName = 'Untitled.sql';
        
        const existingSet = new Set();
        if (existingNames) {
            for (const name of existingNames) {
                if (name) existingSet.add(String(name).trim().toLowerCase());
            }
        }

        const trimmed = String(candidateName).trim();
        if (!existingSet.has(trimmed.toLowerCase())) {
            return trimmed;
        }

        // Split extension (e.g., .sql, .xml, .txt)
        const dotIdx = trimmed.lastIndexOf('.');
        let baseStem = trimmed;
        let ext = '';
        if (dotIdx > 0) {
            baseStem = trimmed.substring(0, dotIdx);
            ext = trimmed.substring(dotIdx);
        }

        // If baseStem already ends in (N), strip it to find rootStem
        const match = baseStem.match(/^(.*?)(?:\((\d+)\))?$/);
        const rootStem = (match && match[1]) ? match[1].trim() : baseStem;

        // Increment i starting from 1 until finding an unused name
        let i = 1;
        while (true) {
            const testName = `${rootStem}(${i})${ext}`;
            if (!existingSet.has(testName.toLowerCase())) {
                return testName;
            }
            i++;
        }
    }
    window.getUniqueFileName = getUniqueFileName;

    function serializeSession() {
        const list = [];
        if (activeTabId && tabsData.has(activeTabId)) {
            const activeTab = tabsData.get(activeTabId);
            if (activeTab && isTextEditorTab(activeTab) && window.AppEditor) {
                const rawEd = window.AppEditor.rawEditor || (typeof window.resolveMonacoEditor === 'function' ? window.resolveMonacoEditor(window.AppEditor) : null);
                const isModelMounted = !rawEd || !activeTab.monacoModel || (typeof rawEd.getModel === 'function' && rawEd.getModel() === activeTab.monacoModel);
                if (isModelMounted) {
                    activeTab.content = window.AppEditor.getValue();
                    if (rawEd) {
                        if (typeof rawEd.getPosition === 'function') {
                            activeTab.savedCursorPosition = rawEd.getPosition();
                        }
                        if (typeof rawEd.saveViewState === 'function') {
                            activeTab.viewState = rawEd.saveViewState();
                        }
                        if (typeof rawEd.getScrollTop === 'function') {
                            activeTab.scroll = {
                                scrollTop: rawEd.getScrollTop(),
                                scrollLeft: typeof rawEd.getScrollLeft === 'function' ? rawEd.getScrollLeft() : 0
                            };
                        }
                    }
                }
            }
        }

        tabOrder.forEach(id => {
            const t = tabsData.get(id);
            if (t) {
                list.push({
                    id,
                    title: t.title,
                    tabType: t.tabType || 'query',
                    docId: t.docId,
                    filePath: t.filePath || null,
                    connectionId: t.connectionId,
                    connectionName: t.connectionName,
                    database: t.database,
                    schema: t.schema,
                    dbType: t.dbType,
                    environment: t.environment || '',
                    read_only: Boolean(t.read_only),
                    isDirty: Boolean(t.isDirty),
                    isPinned: pinnedTabs.has(id),
                    content: t.content,
                    cursor: t.savedCursorPosition || { lineNumber: 1, column: 1 },
                    scroll: t.scroll || null,
                    viewState: t.viewState || null
                });
            }
        });

        return {
            version: 1,
            savedAt: Date.now(),
            activeTabId,
            sidebarWidth: window.AppSession ? window.AppSession.getSidebarWidth() : 260,
            sidebarCollapsed: window.AppSession ? window.AppSession.isSidebarCollapsed() : false,
            resultsHeight: window.AppSession ? window.AppSession.getResultsHeight() : 280,
            defaultContext: getDefaultContext(),
            tabs: list
        };
    }
    window.serializeTabsSession = serializeSession;

    function syncTabsSession() {
        if (!window.AppSession) return;
        const sessionData = serializeSession();
        window.AppSession.setOpenTabs(sessionData.tabs);
        if (typeof window.AppSession.scheduleAutoSave === 'function') {
            window.AppSession.scheduleAutoSave(3000);
        }
    }

    if (window.AppSession && typeof window.AppSession.registerSerializer === 'function') {
        window.AppSession.registerSerializer(serializeSession);
    }

    function isTextEditorTab(tabState) {
        if (!tabState) return false;
        if (tabState.isTextEditor !== undefined) return Boolean(tabState.isTextEditor);
        const nonTextEditorTypes = ['object-search', 'designer', 'data-editor', 'dependency-graph', 'query-designer', 'activity-monitor', 'schema-compare'];
        return !nonTextEditorTypes.includes(tabState.tabType);
    }
    window.isTextEditorTab = isTextEditorTab;

    function createTab(opts = {}) {
        tabCounter++;
        const tabId = `tab-${tabCounter}`;
        const tabType = opts.tabType || 'query';
        const existingTabTitles = [];
        for (const t of tabsData.values()) {
            if (t && t.title) existingTabTitles.push(t.title);
        }
        let tabTitle = opts.title || `Query ${tabCounter}`;
        tabTitle = getUniqueFileName(tabTitle, existingTabTitles);
        const icon = opts.icon || (tabType === 'designer' ? 'fa-drafting-compass' : (tabType === 'dependency-graph' ? 'fa-diagram-project' : (tabType === 'object-search' ? 'fa-magnifying-glass' : (tabType === 'query-designer' ? 'fa-diagram-project' : (tabType === 'activity-monitor' ? 'fa-heart-pulse' : 'fa-table-list')))));

        // Prefer explicit options, then last focused tree node context, then current global context, then saved defaultContext
        const focusedCtx = window.LastFocusedTreeContext || {};
        const hasExplicitConn = opts.connectionId !== undefined || opts.connectionName !== undefined;
        const hasFocusedConn = Boolean(focusedCtx.connectionName || focusedCtx.connectionId);

        let connId, connName, db, typ, sch;

        if (hasExplicitConn) {
            connId   = opts.connectionId !== undefined ? opts.connectionId : defaultContext.connectionId;
            connName = opts.connectionName !== undefined ? opts.connectionName : defaultContext.connectionName;
            db       = opts.database !== undefined ? opts.database : defaultContext.database;
            typ      = opts.dbType !== undefined ? opts.dbType : defaultContext.dbType;
            sch      = opts.schema !== undefined ? opts.schema : defaultContext.schema;
        } else if (hasFocusedConn) {
            connId   = focusedCtx.connectionId || null;
            connName = focusedCtx.connectionName || null;
            db       = focusedCtx.database || null;
            typ      = focusedCtx.dbType || null;
            sch      = focusedCtx.schema || null;

            // If connId was null but the focused connection name is already active globally, adopt the active connection id
            if (!connId && connName && window.ActiveConnectionName === connName && (!typ || window.ActiveDbType === typ) && window.ActiveConnectionId) {
                connId = window.ActiveConnectionId;
            }
        } else {
            connId   = window.ActiveConnectionId !== undefined && window.ActiveConnectionId !== null ? window.ActiveConnectionId : defaultContext.connectionId;
            connName = window.ActiveConnectionName || defaultContext.connectionName;
            db       = window.ActiveDatabase || defaultContext.database;
            typ      = window.ActiveDbType || defaultContext.dbType;
            sch      = window.ActiveSchema || defaultContext.schema;
        }

        // PostgreSQL-specific resolution for default schema:
        // When adding a new text editor tab for PostgreSQL, if schema resolved to null/undefined or 'public',
        // check if a default schema was declared for this connection (unless user explicitly selected a 'schema' node).
        if (typ === 'postgresql') {
            const isExplicitSchemaSelect = opts.nodeType === 'schema' || (focusedCtx.nodeType === 'schema' && opts.schema === undefined);
            if (!isExplicitSchemaSelect) {
                let declaredSchema = opts.config?.schema || focusedCtx.config?.schema;
                if (!declaredSchema && window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                    const saved = window.AppExplorer.getSavedConnections() || [];
                    const profile = saved.find(s => s && s.type === 'postgresql' && (s.name === connName || s.connection_id === connId));
                    if (profile) {
                        if (profile.schema) declaredSchema = profile.schema;
                        if (!db && profile.database) db = profile.database;
                    }
                }
                if (!declaredSchema && window.AppExplorer && typeof window.AppExplorer.getSchemaFilter === 'function') {
                    const sf = window.AppExplorer.getSchemaFilter(connId, db);
                    if (Array.isArray(sf) && sf.length > 0 && sf[0]) {
                        declaredSchema = sf[0];
                    }
                }
                if (declaredSchema && (!sch || sch === 'public')) {
                    sch = declaredSchema;
                }
            }
        }

        const docId = opts.docId || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)));
        const filePath = opts.filePath || null;

        tabsData.set(tabId, {
            tabType:        tabType,
            isTextEditor:   isTextEditorTab({ tabType, isTextEditor: opts.isTextEditor }),
            savedCursorPosition: opts.savedCursorPosition || { lineNumber: 1, column: 1 },
            viewState:      opts.viewState      || null,
            title:          tabTitle,
            docId:          docId,
            filePath:       filePath,
            isDirty:        false,
            designerData:   opts.designerData   || null,
            context:        opts.context        || null,
            content:        opts.content        || '-- Write your SQL query here\nSELECT * FROM ',
            connectionId:   connId,
            connectionName: connName,
            database:       db,
            schema:         sch,
            dbType:         typ,
            environment:    opts.environment !== undefined ? opts.environment : '',
            read_only:      opts.read_only !== undefined ? Boolean(opts.read_only) : false,
            resultData:     null,
            activeView:     'results-grid',
            messageText:    '',
            planText:       '',
            isResultPanelHidden: opts.isResultPanelHidden !== undefined ? opts.isResultPanelHidden : true,
            originalText:   opts.originalText   !== undefined ? opts.originalText : '',
            modifiedText:   opts.modifiedText   !== undefined ? opts.modifiedText : '',
            originalTitle:  opts.originalTitle  || '',
            modifiedTitle:  opts.modifiedTitle  || '',
            originalTabId:  opts.originalTabId  || null,
            modifiedTabId:  opts.modifiedTabId  || null,
            language:       opts.language || (tabType === 'structured-data' ? (opts.structuredFormat || 'json') : 'sql'),
            structuredFormat: opts.structuredFormat || opts.language || null,
            originalValue:  opts.originalValue !== undefined ? opts.originalValue : (opts.content || ''),
            isDebugActive:  opts.isDebugActive  !== undefined ? Boolean(opts.isDebugActive) : false
        });

        const tabData = tabsData.get(tabId);
        if (tabData && (!tabData.environment || !tabData.read_only)) {
            let curConn = null;
            if (window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                const list = window.AppExplorer.getActiveConnections() || [];
                curConn = list.find(c => c && (String(c.connection_id) === String(connId) || c.name === connName));
            }
            if (curConn) {
                if (!tabData.environment && curConn.environment) tabData.environment = curConn.environment;
                if (!tabData.read_only && curConn.read_only) tabData.read_only = Boolean(curConn.read_only);
            }
        }

        if (tabData && tabData.isTextEditor && typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.createModel === 'function') {
            try {
                tabData.monacoModel = monaco.editor.createModel(tabData.content || '', tabData.language || 'sql');
                tabData.monacoModel.onDidChangeContent(() => {
                    tabData.content = tabData.monacoModel.getValue();
                });
            } catch (_) {}
        }

        const tabEl = document.createElement('li');
        tabEl.className = 'nav-item ide-tab d-flex align-items-center';
        tabEl.dataset.tabId = tabId;
        tabEl.dataset.docId = docId;
        if (filePath) tabEl.dataset.filePath = filePath;

        let envBadgeHtml = '';
        const tabEnv = (tabData?.environment || '').toLowerCase();
        if (tabEnv === 'prod') {
            envBadgeHtml = '<span class="badge bg-danger ms-1 tab-env-badge" style="font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;">PROD</span>';
        } else if (tabEnv === 'test') {
            envBadgeHtml = '<span class="badge bg-warning text-dark ms-1 tab-env-badge" style="font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;">TEST</span>';
        } else if (tabEnv === 'dev') {
            envBadgeHtml = '<span class="badge bg-primary ms-1 tab-env-badge" style="font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;">DEV</span>';
        }

        const roBadgeHtml = tabData?.read_only ? '<i class="fa-solid fa-lock ms-1 text-warning tab-ro-badge" style="font-size: 9px; cursor: pointer;" title="Chỉ đọc - Click để chuyển sang chế độ Ghi"></i>' : '';

        tabEl.innerHTML = `
            <i class="fa-solid ${icon} me-1 tab-icon" style="font-size: 11px;"></i>
            <span class="tab-label text-truncate" style="max-width: 140px;" title="${tabTitle}">${tabTitle}</span>
            ${envBadgeHtml}
            ${roBadgeHtml}
            <span class="tab-dirty-dot ms-1 d-none text-warning" style="font-size: 10px;" title="Unsaved changes">●</span>
            <span class="tab-close ms-2" title="Đóng tab" draggable="false">
                <i class="fa-solid fa-xmark"></i>
            </span>
        `;

        const closeBtn = tabEl.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.addEventListener('mousedown', e => {
                e.stopPropagation();
            });
            closeBtn.addEventListener('pointerdown', e => {
                e.stopPropagation();
            });
            closeBtn.addEventListener('click', e => {
                e.stopPropagation();
                e.preventDefault();
                closeTab(tabId, tabEl);
            });
        }

        tabEl.addEventListener('click', e => {
            if (e.target.closest('.tab-ro-badge')) {
                e.stopPropagation();
                e.preventDefault();
                const state = tabsData.get(tabId);
                if (window.SqlProtection && typeof window.SqlProtection.showSwitchToWriteModeDialog === 'function') {
                    window.SqlProtection.showSwitchToWriteModeDialog({
                        connectionId: state?.connectionId,
                        connectionName: state?.connectionName,
                        database: state?.database,
                        environment: state?.environment
                    });
                }
                return;
            }
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                e.preventDefault();
                closeTab(tabId, tabEl);
            } else {
                switchTab(tabId);
            }
        });

        // Middle-click to close tab (auxclick with button === 1)
        tabEl.addEventListener('auxclick', e => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                closeTab(tabId, tabEl);
            }
        });
        tabEl.addEventListener('mousedown', e => {
            if (e.button === 1) {
                e.preventDefault();
            }
        });

        // Double-click on tab label to rename
        tabEl.querySelector('.tab-label')?.addEventListener('dblclick', e => {
            e.stopPropagation();
            renameTab(tabId);
        });

        tabEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            switchTab(tabId);
            showTabContextMenu(e, tabId);
        });

        setupTabDragAndDrop(tabEl, tabId);

        // Append to the tabs list
        tabsBar.appendChild(tabEl);
        tabOrder.push(tabId);

        if (opts.pinned) {
            pinTab(tabId);
        }

        updateEmptyTabsState();
        switchTab(tabId);
        calculateTabLayout();
        syncTabsSession();
        return tabId;
    }

    function switchTab(tabId) {
        // Save current editor content and cursor/viewState if switching from an editor tab or diff tab
        if (activeTabId && tabsData.has(activeTabId)) {
            const prev = tabsData.get(activeTabId);
            if (isTextEditorTab(prev) && window.AppEditor) {
                prev.content = window.AppEditor.getValue();
                const rawEd = window.AppEditor.rawEditor || (typeof window.resolveMonacoEditor === 'function' ? window.resolveMonacoEditor(window.AppEditor) : null);
                if (rawEd && typeof rawEd.saveViewState === 'function') {
                    prev.viewState = rawEd.saveViewState();
                } else if (typeof window.AppEditor.saveViewState === 'function') {
                    prev.viewState = window.AppEditor.saveViewState();
                }
                if (rawEd && typeof rawEd.getPosition === 'function') {
                    const pos = rawEd.getPosition();
                    if (pos) prev.savedCursorPosition = { lineNumber: pos.lineNumber, column: pos.column };
                } else if (typeof window.AppEditor.getPosition === 'function') {
                    prev.savedCursorPosition = window.AppEditor.getPosition();
                }
                syncDiffTabsWithSourceTab(activeTabId, prev.content);
            } else if (prev.tabType === 'diff' && typeof window.getDiffEditorValues === 'function') {
                const diffVals = window.getDiffEditorValues();
                if (diffVals) {
                    prev.originalText = diffVals.original;
                    prev.modifiedText = diffVals.modified;
                }
            }
        }

        // Update tab highlight
        document.querySelectorAll('.ide-tab[data-tab-id]').forEach(t => t.classList.remove('active'));
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) tabEl.classList.add('active');

        activeTabId = tabId;
        if (window.AppSession) {
            window.AppSession.setActiveTabId(tabId);
        }
        const state = tabsData.get(tabId);
        updateEmptyTabsState();

        // Toggle Editor Status Bar based on isTextEditor
        const isCurrentTextEd = isTextEditorTab(state);
        const editorStatusBar = document.getElementById('ide-editor-status-bar');
        if (editorStatusBar) {
            if (!isCurrentTextEd) {
                editorStatusBar.classList.add('d-none');
            } else {
                editorStatusBar.classList.remove('d-none');
            }
        }

        if (window.FileHistorySidebar && typeof window.FileHistorySidebar.onTabChanged === 'function') {
            window.FileHistorySidebar.onTabChanged(tabId, state);
        }

        // Toggle workspace views: Query View vs Table Designer View vs Table Data Editor View vs Diff View vs Dependency Graph View vs SQL Visualizer View vs Activity Monitor View
        const designerContainer = document.getElementById('table-designer-container');
        const dataEditorContainer = document.getElementById('table-data-editor-container');
        const depContainer = document.getElementById('dependency-graph-container');
        const ocsContainer = document.getElementById('object-content-search-container');
        const visualizerContainer = document.getElementById('sql-visualizer-container');
        const actContainer = document.getElementById('activity-monitor-container');
        const scContainer = document.getElementById('schema-compare-container');
        const editorWrap = document.querySelector('.ide-editor-wrap');
        const resizer = document.querySelector('.ide-resizer-horizontal');
        const resultsPane = document.getElementById('ide-result-panel') || document.getElementById('ide-results-pane') || (resizer ? resizer.nextElementSibling : null);
        const queryControls = document.querySelector('.ide-action-bar .d-flex.align-items-center.gap-1.flex-shrink-0');
        const ideStatusbar = document.querySelector('.ide-statusbar');

        if (state && state.tabType === 'designer') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (designerContainer) designerContainer.classList.remove('d-none');

            if (window.TableDesigner) {
                window.TableDesigner.activateTab(tabId);
            }
        } else if (state && state.tabType === 'query-designer') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (visualizerContainer) visualizerContainer.classList.remove('d-none');

            if (window.SqlVisualizer) {
                window.SqlVisualizer.activateTab(tabId);
            }
        } else if (state && state.tabType === 'data-editor') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (dataEditorContainer) dataEditorContainer.classList.remove('d-none');

            if (window.TableDataEditor) {
                window.TableDataEditor.activateTab(tabId);
            }
        } else if (state && state.tabType === 'dependency-graph') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (depContainer) depContainer.classList.remove('d-none');

            if (window.PostgresDependencyGraph) {
                window.PostgresDependencyGraph.activateTab(tabId, state.context);
            }
        } else if (state && state.tabType === 'object-search') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (ocsContainer) ocsContainer.classList.remove('d-none');

            if (window.ObjectContentSearch) {
                if (!window.ObjectContentSearch.initialized) {
                    window.ObjectContentSearch.init();
                }
                const ocsCtx = Object.assign({
                    connectionId: state.connectionId,
                    connectionName: state.connectionName,
                    database: state.database,
                    schema: state.schema,
                    dbType: state.dbType
                }, state.context || {});
                window.ObjectContentSearch.activateTab(tabId, ocsCtx);
            }
        } else if (state && state.tabType === 'activity-monitor') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (actContainer) actContainer.classList.remove('d-none');

            if (window.ActivityMonitor) {
                if (!window.ActivityMonitor.container) {
                    window.ActivityMonitor.init({
                        containerId: 'activity-monitor-container',
                        connectionId: state.connectionId
                    });
                }
                window.ActivityMonitor.activateTab(tabId);
            }
        } else if (state && state.tabType === 'schema-compare') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (scContainer) scContainer.classList.remove('d-none');
            if (ideStatusbar) ideStatusbar.classList.add('d-none');

            if (window.SchemaCompare) {
                if (!window.SchemaCompare.container) {
                    window.SchemaCompare.init({
                        containerId: 'schema-compare-container',
                        sourceConnId: state.connectionId,
                        sourceDb: state.database,
                        sourceSchema: state.schema
                    });
                } else if (state && state.connectionId && typeof window.SchemaCompare.setSourceContext === 'function') {
                    window.SchemaCompare.setSourceContext(state.connectionId, state.database, state.schema, state.dbType);
                }
                window.SchemaCompare.activateTab(tabId);
            }
        } else if (state && state.tabType === 'diff') {
            if (scContainer) scContainer.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (editorWrap) editorWrap.classList.remove('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (ideStatusbar) ideStatusbar.classList.remove('d-none');

            // Refresh latest content and titles from source tabs if they still exist
            if (state.originalTabId && tabsData.has(state.originalTabId)) {
                const srcTab = tabsData.get(state.originalTabId);
                if (srcTab && srcTab.content !== undefined) {
                    state.originalText = srcTab.content;
                }
                if (srcTab && srcTab.title) {
                    state.originalTitle = srcTab.title;
                }
            }
            if (state.modifiedTabId && tabsData.has(state.modifiedTabId)) {
                const modTab = tabsData.get(state.modifiedTabId);
                if (modTab && modTab.content !== undefined) {
                    state.modifiedText = modTab.content;
                }
                if (modTab && modTab.title) {
                    state.modifiedTitle = modTab.title;
                }
            }

            if (typeof window.showDiffView === 'function') {
                window.showDiffView(state.originalText || '', state.modifiedText || '', state.originalTitle || 'Original', state.modifiedTitle || 'Modified');
            }
        } else {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (scContainer) scContainer.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (depContainer) depContainer.classList.add('d-none');
            if (ocsContainer) ocsContainer.classList.add('d-none');
            if (visualizerContainer) visualizerContainer.classList.add('d-none');
            if (actContainer) actContainer.classList.add('d-none');
            if (editorWrap) editorWrap.classList.remove('d-none');
            if (ideStatusbar) ideStatusbar.classList.remove('d-none');

            // Restore editor content immediately before UI panels/getters trigger to prevent stale content overwrites
            if (state && window.AppEditor) {
                const rawEd = window.AppEditor.rawEditor || (typeof window.resolveMonacoEditor === 'function' ? window.resolveMonacoEditor(window.AppEditor) : null);
                const nextVal = state.content || '';
                const lang = state.language || (state.tabType === 'structured-data' ? (state.structuredFormat || 'json') : 'sql');

                if (rawEd && typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.createModel === 'function') {
                    if (!state.monacoModel || state.monacoModel.isDisposed()) {
                        state.monacoModel = monaco.editor.createModel(nextVal, lang);
                        state.monacoModel.onDidChangeContent(() => {
                            state.content = state.monacoModel.getValue();
                        });
                    } else if (state.monacoModel.getValue() !== nextVal) {
                        state.monacoModel.setValue(nextVal);
                    }
                    if (rawEd.getModel() !== state.monacoModel) {
                        rawEd.setModel(state.monacoModel);
                    }
                } else {
                    const currentVal = window.AppEditor.getValue();
                    if (currentVal !== nextVal) {
                        window.AppEditor.setValue(nextVal);
                    }
                }

                if (state.viewState && rawEd && typeof rawEd.restoreViewState === 'function') {
                    try {
                        rawEd.restoreViewState(state.viewState);
                    } catch (_) {}
                } else if (state.savedCursorPosition) {
                    if (rawEd && typeof rawEd.setPosition === 'function') {
                        try {
                            rawEd.setPosition(state.savedCursorPosition);
                            if (typeof rawEd.revealPositionInCenterIfOutsideViewport === 'function') {
                                rawEd.revealPositionInCenterIfOutsideViewport(state.savedCursorPosition);
                            }
                        } catch (_) {}
                    } else if (typeof window.AppEditor.setPosition === 'function') {
                        window.AppEditor.setPosition(state.savedCursorPosition);
                    }
                }

                // Switch language model if structured data or text tab
                const targetLang = state.language || (state.tabType === 'structured-data' ? (state.structuredFormat || 'json') : 'sql');
                if (rawEd && typeof rawEd.getModel === 'function' && typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.setModelLanguage === 'function') {
                    const model = rawEd.getModel();
                    if (model && model.getLanguageId && model.getLanguageId() !== targetLang) {
                        try {
                            monaco.editor.setModelLanguage(model, targetLang);
                        } catch (_) {}
                    }
                }
            }

            const hasExecuted = Boolean(state && (state.resultData || state.messageText || state.planText));
            const shouldHide = (state && state.isResultPanelHidden !== undefined) ? state.isResultPanelHidden : !hasExecuted;
            if (shouldHide) {
                if (typeof window.hideResultPanel === 'function') {
                    window.hideResultPanel();
                } else {
                    if (resizer) resizer.classList.add('d-none');
                    if (resultsPane) resultsPane.classList.add('d-none');
                }
            } else {
                if (typeof window.showResultPanel === 'function') {
                    window.showResultPanel(false);
                } else {
                    if (resizer) resizer.classList.remove('d-none');
                    if (resultsPane) resultsPane.classList.remove('d-none');
                }
            }
            if (state && state.tabType === 'structured-data') {
                if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            } else {
                if (queryControls) queryControls.classList.remove('opacity-50', 'pe-none');
            }

            // Staggered layout refresh
            if (state && window.AppEditor) {
                setTimeout(() => { if (window.AppEditor) { if (window.AppEditor.layout) window.AppEditor.layout(); else if (window.AppEditor.refresh) window.AppEditor.refresh(); } }, 10);
            }
        }

        // Sync active context globals to tab state
        if (state) {
            // Check if connection was reconnected/renewed or if connection is active
            if (state.connectionName && window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                const activeList = window.AppExplorer.getActiveConnections() || [];
                const cleanTabConnName = String(state.connectionName).replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim();
                const matched = activeList.find(a => (
                    a && (
                        (a.name && (a.name.toLowerCase() === state.connectionName.toLowerCase() || a.name.toLowerCase() === cleanTabConnName.toLowerCase())) ||
                        (a.server && (a.server.toLowerCase() === state.connectionName.toLowerCase() || a.server.toLowerCase() === cleanTabConnName.toLowerCase()))
                    ) && (
                        !state.dbType || !a.type || a.type === state.dbType
                    )
                ));
                if (matched && matched.connection_id && state.connectionId !== matched.connection_id) {
                    state.connectionId = matched.connection_id;
                }
            }

            window.ActiveConnectionId   = state.connectionId;
            window.ActiveConnectionName = state.connectionName;
            window.ActiveDatabase       = state.database;
            window.ActiveSchema         = state.schema;
            window.ActiveDbType         = state.dbType;
        }

        // Notify action bar + other components
        document.dispatchEvent(new CustomEvent('ide-tab-switched', { detail: { tabId, state } }));
        if (typeof window.updateActionBar === 'function') {
            window.updateActionBar();
        }

        if (tabDisplayMode === 'overflow' && (overflowTabIds.has(tabId) || !visibleTabIds.has(tabId))) {
            calculateTabLayout();
        }
        syncTabsSession();
    }

    function updateEmptyTabsState() {
        const remaining = document.querySelectorAll('.ide-tab[data-tab-id]');
        const emptyPlaceholder = document.getElementById('ide-empty-tabs-placeholder');
        const editorWrap = document.querySelector('.ide-editor-wrap');
        const resizer = document.querySelector('.ide-resizer-horizontal');
        const resultsPane = document.getElementById('ide-result-panel') || document.getElementById('ide-results-pane') || (resizer ? resizer.nextElementSibling : null);
        const queryControls = document.querySelector('.ide-action-bar .d-flex.align-items-center.gap-1.flex-shrink-0');

        if (remaining.length === 0) {
            if (typeof window.hideDiffView === 'function') {
                window.hideDiffView();
            }
            document.getElementById('table-designer-container')?.classList.add('d-none');
            document.getElementById('table-data-editor-container')?.classList.add('d-none');
            document.getElementById('dependency-graph-container')?.classList.add('d-none');
            document.getElementById('object-content-search-container')?.classList.add('d-none');
            document.getElementById('sql-visualizer-container')?.classList.add('d-none');
            document.getElementById('activity-monitor-container')?.classList.add('d-none');
            document.getElementById('schema-compare-container')?.classList.add('d-none');
            document.getElementById('ide-editor-status-bar')?.classList.add('d-none');
            if (emptyPlaceholder) emptyPlaceholder.classList.remove('d-none');
            if (editorWrap) editorWrap.classList.remove('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (window.AppEditor) {
                window.AppEditor.setValue('');
                if (typeof window.AppEditor.updateOptions === 'function') {
                    window.AppEditor.updateOptions({ readOnly: true });
                } else if (typeof window.AppEditor.setOption === 'function') {
                    window.AppEditor.setOption('readOnly', 'nocursor');
                }
            }
            if (window.AppEditor2) {
                if (typeof window.AppEditor2.updateOptions === 'function') {
                    window.AppEditor2.updateOptions({ readOnly: true });
                } else if (typeof window.AppEditor2.setOption === 'function') {
                    window.AppEditor2.setOption('readOnly', 'nocursor');
                }
            }
            if (window.FileHistorySidebar && typeof window.FileHistorySidebar.onAllTabsClosed === 'function') {
                window.FileHistorySidebar.onAllTabsClosed();
            }
        } else {
            if (emptyPlaceholder) emptyPlaceholder.classList.add('d-none');
            if (queryControls) queryControls.classList.remove('opacity-50', 'pe-none');
            if (window.AppEditor) {
                if (typeof window.AppEditor.updateOptions === 'function') {
                    window.AppEditor.updateOptions({ readOnly: false });
                } else if (typeof window.AppEditor.setOption === 'function') {
                    window.AppEditor.setOption('readOnly', false);
                }
            }
            if (window.AppEditor2) {
                if (typeof window.AppEditor2.updateOptions === 'function') {
                    window.AppEditor2.updateOptions({ readOnly: false });
                } else if (typeof window.AppEditor2.setOption === 'function') {
                    window.AppEditor2.setOption('readOnly', false);
                }
            }
        }
    }

    function closeTab(tabId, tabEl) {
        if (!tabEl) tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        const state = tabsData.get(tabId);
        const title = state ? state.title : 'Editor';
        const isDirty = state ? !!state.isDirty : false;
        if (isDirty) {
            showCloseConfirmModal(title, true, () => forceCloseTab(tabId, tabEl));
        } else {
            forceCloseTab(tabId, tabEl);
        }
    }

    function forceCloseTab(tabId, tabEl) {
        const state = tabsData.get(tabId);
        const title = state ? state.title : 'Editor';

        // Snapshot khi đóng tab (📄 - entry_type = 2)
        if (state && state.tabType === 'query' && state.docId) {
            const closingContent = (window.AppEditor && activeTabId === tabId) ? window.AppEditor.getValue() : (state.content || '');
            if (closingContent && closingContent.trim()) {
                fetch('/api/history/log_execution', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doc_id: state.docId,
                        display_name: state.title,
                        file_path: state.filePath || null,
                        sql: closingContent,
                        entry_type: 2, // 2 = Snapshot/Close 📄
                        server: state.connectionName || window.ActiveConnectionName || 'Local',
                        database: state.database || window.ActiveDatabase || 'master',
                        status: 0,
                        duration_ms: 0
                    })
                }).then(() => {
                    document.dispatchEvent(new CustomEvent('ide-history-updated', { detail: { docId: state.docId } }));
                }).catch(() => {});
            }
        }

        if (state && state.tabType === 'designer' && window.TableDesigner) {
            window.TableDesigner.closeTab(tabId);
        } else if (state && state.tabType === 'data-editor' && window.TableDataEditor) {
            window.TableDataEditor.closeTab(tabId);
        } else if (state && state.tabType === 'dependency-graph' && window.PostgresDependencyGraph) {
            window.PostgresDependencyGraph.closeTab(tabId);
        } else if (state && state.tabType === 'object-search' && window.ObjectContentSearch) {
            window.ObjectContentSearch.closeTab(tabId);
        } else if (state && state.tabType === 'query-designer' && window.SqlVisualizer) {
            window.SqlVisualizer.closeTab(tabId);
        } else if (state && state.tabType === 'activity-monitor' && window.ActivityMonitor) {
            window.ActivityMonitor.stopAutoRefresh();
        } else if (state && state.tabType === 'diff') {
            if (typeof window.closeDiffView === 'function') {
                window.closeDiffView();
            }
        }

        if (state && state.monacoModel) {
            try { state.monacoModel.dispose(); } catch (_) {}
            state.monacoModel = null;
        }

        tabsData.delete(tabId);
        pinnedTabs.delete(tabId);
        tabOrder = tabOrder.filter(id => id !== tabId);
        document.dispatchEvent(new CustomEvent('ide-tab-closed', { detail: { tabId } }));
        tabEl.remove();

        if (typeof showToast === 'function') {
            showToast('Đã đóng tab "' + title + '"', 'secondary');
        }

        if (activeTabId === tabId) {
            activeTabId = null;
            const remaining = document.querySelectorAll('.ide-tab[data-tab-id]');
            if (remaining.length > 0) {
                switchTab(remaining[remaining.length - 1].dataset.tabId);
            } else {
                if (window.AppEditor) window.AppEditor.setValue('');
                window.ActiveConnectionId = null;
                window.ActiveConnectionName = null;
                window.ActiveDatabase = null;
                window.ActiveSchema = null;
                window.ActiveDbType = null;
                tabCounter = 0;
                document.dispatchEvent(new CustomEvent('ide-tab-switched', { detail: { tabId: null, state: null } }));
            }
        }
        updateEmptyTabsState();
        calculateTabLayout();
        syncTabsSession();
    }

    function showCloseConfirmModal(title, isDirty, onConfirm) {
        document.getElementById('ide-tab-close-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'ide-tab-close-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('aria-hidden', 'true');

        const headerClass = isDirty ? 'bg-warning-subtle text-warning' : 'bg-body-secondary text-body';
        const iconClass = isDirty ? 'fa-triangle-exclamation text-warning' : 'fa-circle-question text-primary';
        const confirmBtnClass = isDirty ? 'btn-danger' : 'btn-danger';
        const confirmBtnText = isDirty ? 'Đóng không lưu' : 'Đóng Tab';
        const bodyContent = isDirty
            ? `Tab "<strong>${title}</strong>" đang có thay đổi chưa được lưu.<br><span class="text-secondary small mt-1 d-inline-block">Dữ liệu chưa lưu sẽ bị mất khi bạn đóng tab này.</span>`
            : `Bạn có chắc chắn muốn đóng tab "<strong>${title}</strong>" không?`;

        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content shadow border-0">
                    <div class="modal-header py-2 ${headerClass}">
                        <h6 class="modal-title mb-0" style="font-size:13px; font-weight:600;">
                            <i class="fa-solid ${iconClass} me-2"></i>Xác nhận đóng Tab
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-3" style="font-size: 13px; line-height: 1.5;">
                        ${bodyContent}
                    </div>
                    <div class="modal-footer py-2 d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Hủy</button>
                        ${isDirty ? `<button type="button" class="btn btn-sm btn-primary" id="ide-tab-close-save"><i class="fa-solid fa-floppy-disk me-1"></i>Lưu & Đóng</button>` : ''}
                        <button type="button" class="btn btn-sm ${confirmBtnClass}" id="ide-tab-close-confirm">
                            <i class="fa-solid fa-xmark me-1"></i>${confirmBtnText}
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        modal.querySelector('#ide-tab-close-confirm').addEventListener('click', () => {
            bsModal.hide();
            onConfirm();
        });

        // §48 Save button: save first, then close if successful
        const saveBtn = modal.querySelector('#ide-tab-close-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                bsModal.hide();
                // Delegate to TableDataEditor.saveActiveTab which calls triggerSaveAll
                if (window.TableDataEditor && window.TableDataEditor.saveActiveTab) {
                    await window.TableDataEditor.saveActiveTab();
                    // After save, close if no more dirty state
                    const tabEl = document.querySelector('.ide-tab[data-tab-id]');
                    if (tabEl && !tabEl.querySelector('.tab-dirty-dot.d-block')) {
                        onConfirm();
                    }
                } else {
                    onConfirm();
                }
            });
        }
        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
    }

    function showBatchCloseConfirmModal(message, onConfirm) {
        document.getElementById('ide-tab-batch-close-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'ide-tab-batch-close-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('aria-hidden', 'true');

        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content shadow border-0">
                    <div class="modal-header py-2 bg-warning-subtle text-warning">
                        <h6 class="modal-title mb-0" style="font-size:13px; font-weight:600;">
                            <i class="fa-solid fa-triangle-exclamation me-2 text-warning"></i>Xác nhận đóng nhiều Tab
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-3" style="font-size: 13px; line-height: 1.5;">
                        ${message}<br><span class="text-secondary small mt-1 d-inline-block">Dữ liệu chưa lưu sẽ bị mất khi đóng các tab này.</span>
                    </div>
                    <div class="modal-footer py-2 d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Hủy</button>
                        <button type="button" class="btn btn-sm btn-danger" id="ide-tab-batch-close-confirm">
                            <i class="fa-solid fa-xmark me-1"></i>Đóng không lưu
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);
        modal.querySelector('#ide-tab-batch-close-confirm').addEventListener('click', () => {
            bsModal.hide();
            onConfirm();
        });
        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
    }

    function closeOtherTabs(targetTabId) {
        if (!tabsData.has(targetTabId)) return;
        switchTab(targetTabId);

        const allTabEls = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]'));
        const others = allTabEls.filter(el => el.dataset.tabId !== targetTabId);
        if (others.length === 0) return;

        const dirtyOthers = others.filter(el => {
            const s = tabsData.get(el.dataset.tabId);
            return s && s.isDirty;
        });

        const doClose = () => {
            others.forEach(el => {
                forceCloseTab(el.dataset.tabId, el);
            });
            if (typeof showToast === 'function') {
                showToast(`Đã đóng ${others.length} tab khác`, 'info');
            }
        };

        if (dirtyOthers.length > 0) {
            showBatchCloseConfirmModal(
                `Có ${dirtyOthers.length} tab chưa được lưu thay đổi. Bạn có chắc chắn muốn đóng tất cả các tab khác không?`,
                doClose
            );
        } else {
            doClose();
        }
    }

    function closeTabsToRight(targetTabId) {
        if (!tabsData.has(targetTabId)) return;
        const allTabEls = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]'));
        const targetIndex = allTabEls.findIndex(el => el.dataset.tabId === targetTabId);
        if (targetIndex === -1) return;

        const rightTabs = allTabEls.slice(targetIndex + 1);
        if (rightTabs.length === 0) return;

        const dirtyRights = rightTabs.filter(el => {
            const s = tabsData.get(el.dataset.tabId);
            return s && s.isDirty;
        });

        const doClose = () => {
            rightTabs.forEach(el => {
                forceCloseTab(el.dataset.tabId, el);
            });
            if (typeof showToast === 'function') {
                showToast(`Đã đóng ${rightTabs.length} tab bên phải`, 'info');
            }
        };

        if (dirtyRights.length > 0) {
            showBatchCloseConfirmModal(
                `Có ${dirtyRights.length} tab bên phải chưa được lưu thay đổi. Bạn có chắc chắn muốn đóng không?`,
                doClose
            );
        } else {
            doClose();
        }
    }

    function closeAllTabs() {
        const allTabEls = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]'));
        if (allTabEls.length === 0) return;

        const dirtyTabs = allTabEls.filter(el => {
            const s = tabsData.get(el.dataset.tabId);
            return s && s.isDirty;
        });

        const doClose = () => {
            allTabEls.forEach(el => {
                forceCloseTab(el.dataset.tabId, el);
            });
            if (typeof showToast === 'function') {
                showToast('Đã đóng tất cả các tab', 'info');
            }
        };

        if (dirtyTabs.length > 0) {
            showBatchCloseConfirmModal(
                `Có ${dirtyTabs.length} tab chưa được lưu thay đổi. Bạn có chắc chắn muốn đóng tất cả các tab không?`,
                doClose
            );
        } else {
            doClose();
        }
    }

    function duplicateTab(tabId) {
        if (!tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        let content = state.content || '';
        if (activeTabId === tabId && state.tabType !== 'designer' && state.tabType !== 'data-editor' && window.AppEditor) {
            content = window.AppEditor.getValue();
            state.content = content;
        }

        const newTitle = `${state.title || 'Tab'} (Copy)`;
        const newTabId = createTab({
            tabType: state.tabType,
            title: newTitle,
            content: content,
            connectionId: state.connectionId,
            connectionName: state.connectionName,
            database: state.database,
            schema: state.schema,
            dbType: state.dbType,
            designerData: state.designerData ? JSON.parse(JSON.stringify(state.designerData)) : null
        });

        const origEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        const newEl = document.querySelector(`.ide-tab[data-tab-id="${newTabId}"]`);
        if (origEl && newEl && origEl.nextSibling && origEl.nextSibling !== newEl) {
            tabsBar.insertBefore(newEl, origEl.nextSibling);
            const origIdx = tabOrder.indexOf(tabId);
            const newIdx = tabOrder.indexOf(newTabId);
            if (origIdx !== -1 && newIdx !== -1) {
                tabOrder.splice(newIdx, 1);
                tabOrder.splice(origIdx + 1, 0, newTabId);
            }
            calculateTabLayout();
        }

        if (typeof showToast === 'function') {
            showToast(`Đã nhân bản tab "${state.title}"`, 'success');
        }
        return newTabId;
    }

    function renameTab(tabId) {
        if (!tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        const currentTitle = state.title || '';

        document.getElementById('ide-tab-rename-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'ide-tab-rename-modal';
        modal.className = 'modal fade';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('aria-hidden', 'true');

        modal.innerHTML = `
            <div class="modal-dialog modal-sm modal-dialog-centered">
                <div class="modal-content shadow border-0">
                    <div class="modal-header py-2 bg-body-secondary">
                        <h6 class="modal-title mb-0" style="font-size:13px; font-weight:600;">
                            <i class="fa-solid fa-pen-to-square me-2 text-primary"></i>Đổi tên Tab (Rename Tab)
                        </h6>
                        <button type="button" class="btn-close btn-close-sm" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body py-3">
                        <label class="form-label small text-muted mb-1">Tên tiêu đề mới:</label>
                        <input type="text" id="ide-tab-rename-input" class="form-control form-control-sm" value="${currentTitle.replace(/"/g, '&quot;')}" spellcheck="false" autocomplete="off" />
                    </div>
                    <div class="modal-footer py-2 d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Hủy</button>
                        <button type="button" class="btn btn-sm btn-primary" id="ide-tab-rename-confirm">
                            <i class="fa-solid fa-check me-1"></i>Lưu
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);
        const inputEl = modal.querySelector('#ide-tab-rename-input');

        const doRename = () => {
            const newTitle = (inputEl.value || '').trim();
            if (!newTitle) {
                if (typeof showToast === 'function') showToast('Tiêu đề tab không được để trống.', 'warning');
                return;
            }
            updateTabTitle(tabId, newTitle);
            bsModal.hide();
            if (typeof showToast === 'function') {
                showToast(`Đã đổi tên tab thành "${newTitle}"`, 'success');
            }
        };

        modal.querySelector('#ide-tab-rename-confirm').addEventListener('click', doRename);
        inputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doRename();
            }
        });

        modal.addEventListener('shown.bs.modal', () => {
            inputEl.focus();
            inputEl.select();
        });
        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();
    }

    function fallbackCopy(text, onSuccess) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (onSuccess) onSuccess();
        } catch (_) {}
    }

    function copyTabTitle(tabId) {
        if (!tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        const title = state.title || '';
        const doSuccess = () => {
            if (typeof showToast === 'function') showToast(`✓ Đã sao chép tiêu đề: "${title}"`, 'success');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(title).then(doSuccess).catch(() => {
                fallbackCopy(title, doSuccess);
            });
        } else {
            fallbackCopy(title, doSuccess);
        }
    }

    function showTabContextMenu(e, tabId) {
        document.getElementById('ide-tab-context-menu')?.remove();

        const state = tabsData.get(tabId);
        if (!state) return;

        const isQuery = state.tabType === 'query';
        const isSplit = window.isEditorSplit && window.isEditorSplit();
        const allTabEls = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]'));
        const targetIndex = allTabEls.findIndex(el => el.dataset.tabId === tabId);
        const hasOthers = allTabEls.length > 1;
        const hasRight = targetIndex >= 0 && targetIndex < allTabEls.length - 1;

        const menu = document.createElement('div');
        menu.id = 'ide-tab-context-menu';
        menu.className = 'ide-context-menu';
        menu.setAttribute('tabindex', '-1');

        menu.innerHTML = `
            <button class="ide-ctx-item" id="ctx-tab-save">
                <i class="fa-solid fa-floppy-disk ide-ctx-icon text-primary"></i>
                <span class="ide-ctx-label">Save</span>
                <span class="ide-ctx-shortcut">Ctrl+S</span>
            </button>
            <div class="ide-ctx-separator"></div>
            <button class="ide-ctx-item" id="ctx-tab-close">
                <i class="fa-solid fa-xmark ide-ctx-icon"></i>
                <span class="ide-ctx-label">Close</span>
                <span class="ide-ctx-shortcut">Ctrl+W</span>
            </button>
            <button class="ide-ctx-item ${!hasOthers ? 'disabled' : ''}" id="ctx-tab-close-others" ${!hasOthers ? 'disabled' : ''}>
                <i class="fa-solid fa-rectangle-xmark ide-ctx-icon"></i>
                <span class="ide-ctx-label">Close Others</span>
            </button>
            <button class="ide-ctx-item ${!hasRight ? 'disabled' : ''}" id="ctx-tab-close-right" ${!hasRight ? 'disabled' : ''}>
                <i class="fa-solid fa-arrow-right-from-bracket ide-ctx-icon"></i>
                <span class="ide-ctx-label">Close to the Right</span>
            </button>
            <button class="ide-ctx-item danger" id="ctx-tab-close-all">
                <i class="fa-solid fa-trash-can ide-ctx-icon"></i>
                <span class="ide-ctx-label">Close All</span>
            </button>
            <div class="ide-ctx-separator"></div>
            <button class="ide-ctx-item" id="ctx-tab-pin">
                <i class="fa-solid fa-thumbtack ide-ctx-icon ${pinnedTabs.has(tabId) ? 'text-warning' : ''}"></i>
                <span class="ide-ctx-label">${pinnedTabs.has(tabId) ? 'Unpin Tab' : 'Pin Tab'}</span>
            </button>
            <button class="ide-ctx-item" id="ctx-tab-duplicate">
                <i class="fa-solid fa-clone ide-ctx-icon"></i>
                <span class="ide-ctx-label">Duplicate Tab</span>
            </button>
            <button class="ide-ctx-item" id="ctx-tab-rename">
                <i class="fa-solid fa-pen-to-square ide-ctx-icon"></i>
                <span class="ide-ctx-label">Rename Tab...</span>
            </button>
            <button class="ide-ctx-item" id="ctx-tab-copy-title">
                <i class="fa-regular fa-copy ide-ctx-icon"></i>
                <span class="ide-ctx-label">Copy Title</span>
            </button>
            ${isQuery ? `
            <div class="ide-ctx-separator"></div>
            <div class="ide-ctx-item has-submenu" id="ctx-tab-split">
                <i class="fa-solid fa-table-columns ide-ctx-icon text-info"></i>
                <span class="ide-ctx-label">Split Editor</span>
                <i class="fa-solid fa-chevron-right ide-ctx-arrow"></i>
                <div class="ide-ctx-submenu">
                    <button class="ide-ctx-item" data-split-dir="right">
                        <i class="fa-solid fa-arrow-right ide-ctx-icon text-info"></i>
                        <span class="ide-ctx-label">Split to Right (Sang phải)</span>
                    </button>
                    <button class="ide-ctx-item" data-split-dir="left">
                        <i class="fa-solid fa-arrow-left ide-ctx-icon text-info"></i>
                        <span class="ide-ctx-label">Split to Left (Sang trái)</span>
                    </button>
                    <button class="ide-ctx-item" data-split-dir="down">
                        <i class="fa-solid fa-arrow-down ide-ctx-icon text-info"></i>
                        <span class="ide-ctx-label">Split to Down (Xuống dưới)</span>
                    </button>
                    <button class="ide-ctx-item" data-split-dir="up">
                        <i class="fa-solid fa-arrow-up ide-ctx-icon text-info"></i>
                        <span class="ide-ctx-label">Split to Up (Lên trên)</span>
                    </button>
                    ${isSplit ? `
                    <div class="ide-ctx-separator"></div>
                    <button class="ide-ctx-item danger" data-split-action="close">
                        <i class="fa-solid fa-xmark ide-ctx-icon"></i>
                        <span class="ide-ctx-label">Close Split View</span>
                    </button>
                    ` : ''}
                </div>
            </div>
            <button class="ide-ctx-item" id="ctx-tab-compare">
                <i class="fa-solid fa-code-compare ide-ctx-icon text-warning"></i>
                <span class="ide-ctx-label">Compare with...</span>
            </button>
            <button class="ide-ctx-item" id="ctx-tab-compare-file">
                <i class="fa-regular fa-file-code ide-ctx-icon"></i>
                <span class="ide-ctx-label">Compare with File on Disk...</span>
            </button>
            ` : ''}
        `;

        // Position menu within viewport
        let posX = e.clientX || e.pageX;
        let posY = e.clientY || e.pageY;
        menu.style.left = posX + 'px';
        menu.style.top = posY + 'px';
        document.body.appendChild(menu);

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth - 8) {
            menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
        }
        if (rect.bottom > window.innerHeight - 8) {
            menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px';
        }

        // Auto-flip submenus if overflowing right edge
        menu.querySelectorAll('.has-submenu').forEach(subItem => {
            const submenu = subItem.querySelector('.ide-ctx-submenu');
            if (submenu) {
                const subRect = subItem.getBoundingClientRect();
                if (subRect.right + 200 > window.innerWidth) {
                    submenu.classList.add('open-left');
                }
            }
        });

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('contextmenu', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        const onDocClick = (ev) => {
            if (!menu.contains(ev.target)) {
                closeMenu();
            }
        };

        const onKeyDown = (ev) => {
            if (ev.key === 'Escape') {
                closeMenu();
            }
        };

        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('contextmenu', onDocClick);
            document.addEventListener('keydown', onKeyDown);
        }, 10);

        // Bind Actions
        menu.querySelector('#ctx-tab-save')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            switchTab(tabId);
            saveActiveTab();
        });

        menu.querySelector('#ctx-tab-close')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
            closeTab(tabId, tabEl);
        });

        menu.querySelector('#ctx-tab-close-others')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            closeOtherTabs(tabId);
        });

        menu.querySelector('#ctx-tab-close-right')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            closeTabsToRight(tabId);
        });

        menu.querySelector('#ctx-tab-close-all')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            closeAllTabs();
        });

        menu.querySelector('#ctx-tab-pin')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            if (pinnedTabs.has(tabId)) {
                unpinTab(tabId);
            } else {
                pinTab(tabId);
            }
        });

        menu.querySelector('#ctx-tab-duplicate')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            duplicateTab(tabId);
        });

        menu.querySelector('#ctx-tab-rename')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            renameTab(tabId);
        });

        menu.querySelector('#ctx-tab-copy-title')?.addEventListener('click', (ev) => {
            ev.preventDefault();
            closeMenu();
            copyTabTitle(tabId);
        });

        if (isQuery) {
            menu.querySelectorAll('[data-split-dir]').forEach(btn => {
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    closeMenu();
                    const dir = btn.dataset.splitDir;
                    switchTab(tabId);
                    if (window.splitEditor) {
                        window.splitEditor(tabId, dir);
                    }
                });
            });

            menu.querySelector('[data-split-action="close"]')?.addEventListener('click', (ev) => {
                ev.preventDefault();
                closeMenu();
                if (window.unsplitEditor) {
                    window.unsplitEditor();
                }
            });

            menu.querySelector('#ctx-tab-compare')?.addEventListener('click', (ev) => {
                ev.preventDefault();
                closeMenu();
                handleCompareTab(tabId);
            });

            menu.querySelector('#ctx-tab-compare-file')?.addEventListener('click', (ev) => {
                ev.preventDefault();
                closeMenu();
                handleCompareWithDisk(tabId);
            });
        }
    }

    function handleCompareTab(sourceTabId) {
        if (activeTabId && tabsData.has(activeTabId)) {
            const activeState = tabsData.get(activeTabId);
            if (activeState.tabType !== 'designer' && activeState.tabType !== 'diff' && window.AppEditor) {
                activeState.content = window.AppEditor.getValue();
            }
        }

        const sourceTab = tabsData.get(sourceTabId);
        if (!sourceTab) return;
        const sourceContent = sourceTab.content !== undefined ? sourceTab.content : '';

        const otherQueryTabs = Array.from(tabsData.entries()).filter(([id, t]) => id !== sourceTabId && t.tabType === 'query');

        if (otherQueryTabs.length === 0) {
            if (typeof showToast === 'function') {
                showToast('Chưa có tab truy vấn khác. Đang mở chọn file từ máy để so sánh...', 'info');
            }
            handleCompareWithDisk(sourceTabId);
            return;
        }

        if (otherQueryTabs.length === 1) {
            const [targetId, targetTab] = otherQueryTabs[0];
            const targetContent = targetTab.content !== undefined ? targetTab.content : '';
            createTab({
                tabType: 'diff',
                title: `Diff: ${sourceTab.title} ↔ ${targetTab.title}`,
                icon: 'fa-code-compare',
                originalText: sourceContent,
                modifiedText: targetContent,
                originalTitle: sourceTab.title,
                modifiedTitle: targetTab.title,
                originalTabId: sourceTabId,
                modifiedTabId: targetId
            });
            return;
        }

        showComparePickerModal(sourceTabId, otherQueryTabs);
    }

    function showComparePickerModal(sourceTabId, otherQueryTabs) {
        if (activeTabId && tabsData.has(activeTabId)) {
            const activeState = tabsData.get(activeTabId);
            if (activeState.tabType !== 'designer' && activeState.tabType !== 'diff' && window.AppEditor) {
                activeState.content = window.AppEditor.getValue();
            }
        }

        const sourceTab = tabsData.get(sourceTabId);
        if (!sourceTab) return;
        const sourceContent = sourceTab.content !== undefined ? sourceTab.content : '';

        let existing = document.getElementById('ide-compare-picker-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'ide-compare-picker-modal';
        modal.className = 'modal fade show';
        modal.style.display = 'block';
        modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
        modal.style.zIndex = '1060';

        const itemsHtml = otherQueryTabs.map(([id, t]) => `
            <button type="button" class="list-group-item list-group-item-action d-flex align-items-center justify-content-between p-2" data-target-id="${id}" style="background: var(--ide-bg-panel); color: var(--ide-text-main); border-color: var(--ide-border);">
                <div class="d-flex align-items-center gap-2 text-truncate">
                    <i class="fa-solid fa-table-list text-info"></i>
                    <span class="fw-semibold">${t.title}</span>
                </div>
                <span class="badge bg-secondary-subtle text-secondary" style="font-size: 10px;">Select</span>
            </button>
        `).join('');

        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 420px;">
                <div class="modal-content" style="background: var(--ide-bg-panel); color: var(--ide-text-main); border: 1px solid var(--ide-border); box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
                    <div class="modal-header py-2 px-3 border-bottom" style="border-color: var(--ide-border) !important;">
                        <h6 class="modal-title mb-0 d-flex align-items-center gap-2">
                            <i class="fa-solid fa-code-compare text-warning"></i>
                            So sánh với tab nào?
                        </h6>
                        <button type="button" class="btn-close btn-close-white" aria-label="Close"></button>
                    </div>
                    <div class="modal-body p-3">
                        <p class="small text-muted mb-2">So sánh tab <strong>"${sourceTab.title}"</strong> với:</p>
                        <div class="list-group">
                            ${itemsHtml}
                        </div>
                    </div>
                    <div class="modal-footer py-2 px-3 border-top d-flex justify-content-between" style="border-color: var(--ide-border) !important;">
                        <button type="button" class="btn btn-sm btn-outline-info btn-compare-disk">
                            <i class="fa-regular fa-file-code me-1"></i>Chọn file từ máy...
                        </button>
                        <button type="button" class="btn btn-sm btn-secondary btn-cancel-compare">Đóng</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();
        modal.querySelector('.btn-close').onclick = closeModal;
        modal.querySelector('.btn-cancel-compare').onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        modal.querySelector('.btn-compare-disk').onclick = () => {
            closeModal();
            handleCompareWithDisk(sourceTabId);
        };

        modal.querySelectorAll('[data-target-id]').forEach(btn => {
            btn.onclick = () => {
                const targetId = btn.dataset.targetId;
                const targetTab = tabsData.get(targetId);
                closeModal();
                if (!targetTab) return;
                const targetContent = targetTab.content !== undefined ? targetTab.content : '';
                createTab({
                    tabType: 'diff',
                    title: `Diff: ${sourceTab.title} ↔ ${targetTab.title}`,
                    icon: 'fa-code-compare',
                    originalText: sourceContent,
                    modifiedText: targetContent,
                    originalTitle: sourceTab.title,
                    modifiedTitle: targetTab.title,
                    originalTabId: sourceTabId,
                    modifiedTabId: targetId
                });
            };
        });
    }

    function handleCompareWithDisk(sourceTabId) {
        if (activeTabId && tabsData.has(activeTabId)) {
            const activeState = tabsData.get(activeTabId);
            if (activeState.tabType !== 'designer' && activeState.tabType !== 'diff' && window.AppEditor) {
                activeState.content = window.AppEditor.getValue();
            }
        }
        const sourceTab = sourceTabId ? tabsData.get(sourceTabId) : null;
        const sourceContent = sourceTab ? (sourceTab.content !== undefined ? sourceTab.content : '') : (window.AppEditor ? window.AppEditor.getValue() : '');
        const sourceTitle = sourceTab ? sourceTab.title : 'Editor';

        const input = document.getElementById('diff-file-input');
        if (!input) return;
        input.value = '';
        input.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const fileContent = ev.target.result;
                createTab({
                    tabType: 'diff',
                    title: `Diff: ${sourceTitle} ↔ ${file.name}`,
                    icon: 'fa-code-compare',
                    originalText: sourceContent,
                    modifiedText: fileContent,
                    originalTitle: sourceTitle + ' (Editor)',
                    modifiedTitle: file.name + ' (Disk)',
                    originalTabId: sourceTabId,
                    modifiedTabId: null
                });
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function openFilesFromDisk() {
        let input = document.getElementById('ide-open-file-input');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'ide-open-file-input';
            input.accept = '.sql,.txt,.json,.xml,.csv,*.*';
            input.multiple = true;
            input.className = 'd-none';
            document.body.appendChild(input);
        }
        input.value = '';
        input.onchange = (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            files.forEach(async file => {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const content = ev.target.result || '';
                    const pathCandidate = file.path || file.name;
                    let existingDocId = null;
                    try {
                        const checkRes = await fetch(`/api/history/document_by_path?path=${encodeURIComponent(pathCandidate)}`);
                        const checkData = await checkRes.json();
                        if (checkData && checkData.success && checkData.document) {
                            existingDocId = checkData.document.DocId;
                        }
                    } catch (_) {}

                    createTab({
                        title: file.name,
                        filePath: pathCandidate,
                        docId: existingDocId || undefined,
                        content: content,
                        isDirty: false
                    });
                };
                reader.readAsText(file);
            });
        };
        input.click();
    }

    function saveActiveTab() {
        if (!activeTabId) return;
        const state = tabsData.get(activeTabId);
        if (!state) return;
        
        if (state.tabType === 'query') {
            const content = window.AppEditor ? window.AppEditor.getValue() : state.content;
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const fileName = (state.title && state.title.endsWith('.sql')) ? state.title : ((state.title || 'query') + '.sql');
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            setTabDirty(activeTabId, false);
            if (typeof showToast === 'function') showToast('Saved ' + state.title, 'success');

            // Cập nhật Document trong Query History (gộp theo FilePath nếu đã có)
            if (state.docId) {
                fetch('/api/history/update_document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doc_id: state.docId,
                        display_name: state.title,
                        file_path: state.filePath || fileName
                    })
                }).then(r => r.json()).then(data => {
                    if (data && data.doc_id && data.doc_id !== state.docId) {
                        state.docId = data.doc_id;
                        const el = document.querySelector(`.ide-tab[data-tab-id="${activeTabId}"]`);
                        if (el) el.dataset.docId = data.doc_id;
                    }
                }).catch(() => {});

                // Snapshot khi Lưu file (📄 - entry_type = 2)
                if (content && content.trim()) {
                    fetch('/api/history/log_execution', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            doc_id: state.docId,
                            display_name: state.title,
                            file_path: state.filePath || fileName,
                            sql: content,
                            entry_type: 2, // 2 = Snapshot/Save 📄
                            server: state.connectionName || window.ActiveConnectionName || 'Local',
                            database: state.database || window.ActiveDatabase || 'master',
                            status: 0,
                            duration_ms: 0
                        })
                    }).then(() => {
                        document.dispatchEvent(new CustomEvent('ide-history-updated', { detail: { docId: state.docId } }));
                    }).catch(() => {});
                }
            }
        } else if (state.tabType === 'designer' && window.TableDesigner) {
            // Save logic for designer if any
        } else if (state.tabType === 'data-editor' && window.TableDataEditor) {
            if (typeof window.TableDataEditor.triggerSaveAll === 'function') {
                window.TableDataEditor.triggerSaveAll(activeTabId);
            }
        }
    }

    function setTabDirty(tabId, isDirty) {
        if (!tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        state.isDirty = !!isDirty;
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) {
            const dot = tabEl.querySelector('.tab-dirty-dot');
            if (dot) {
                if (isDirty) dot.classList.remove('d-none');
                else dot.classList.add('d-none');
            }
        }
    }

    function updateTabTitle(tabId, title) {
        if (!tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        state.title = title;
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) {
            const label = tabEl.querySelector('.tab-label');
            if (label) {
                label.textContent = title;
                label.title = title;
            }
        }
        if (state.docId) {
            fetch('/api/history/update_document', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: state.docId,
                    display_name: title,
                    file_path: state.filePath || null
                })
            }).then(r => r.json()).then(data => {
                if (data && data.doc_id && data.doc_id !== state.docId) {
                    state.docId = data.doc_id;
                    if (tabEl) tabEl.dataset.docId = data.doc_id;
                }
            }).catch(() => {});
        }
        calculateTabLayout();
    }

    function getActiveTabState() {
        if (!activeTabId) return null;
        return tabsData.get(activeTabId) || null;
    }

    function getActiveTabId() { return activeTabId; }

    function getTab(tabId) {
        return tabsData.get(tabId) || null;
    }

    function getAllTabs() {
        return tabsData;
    }

    function updateTabSafetyBadges(tabId) {
        if (!tabId || !tabsData.has(tabId)) return;
        const state = tabsData.get(tabId);
        const tabEl = tabsBar ? tabsBar.querySelector(`.ide-tab[data-tab-id="${tabId}"]`) : null;
        if (!tabEl || !state) return;

        let env = (state.environment || '').toLowerCase();
        let isRo = Boolean(state.read_only);

        if (!env || !isRo) {
            let curConn = null;
            if (window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                const list = window.AppExplorer.getActiveConnections() || [];
                curConn = list.find(c => c && (String(c.connection_id) === String(state.connectionId) || c.name === state.connectionName));
            }
            if (curConn) {
                if (!env && curConn.environment) env = (curConn.environment || '').toLowerCase();
                if (!isRo && curConn.read_only) isRo = Boolean(curConn.read_only);
            }
        }

        // Update env badge
        let envBadge = tabEl.querySelector('.tab-env-badge');
        if (env === 'prod') {
            if (!envBadge) {
                envBadge = document.createElement('span');
                envBadge.className = 'badge bg-danger ms-1 tab-env-badge';
                envBadge.style.cssText = 'font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;';
                tabEl.querySelector('.tab-label')?.after(envBadge);
            }
            envBadge.className = 'badge bg-danger ms-1 tab-env-badge';
            envBadge.textContent = 'PROD';
        } else if (env === 'test') {
            if (!envBadge) {
                envBadge = document.createElement('span');
                envBadge.className = 'badge bg-warning text-dark ms-1 tab-env-badge';
                envBadge.style.cssText = 'font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;';
                tabEl.querySelector('.tab-label')?.after(envBadge);
            }
            envBadge.className = 'badge bg-warning text-dark ms-1 tab-env-badge';
            envBadge.textContent = 'TEST';
        } else if (env === 'dev') {
            if (!envBadge) {
                envBadge = document.createElement('span');
                envBadge.className = 'badge bg-primary ms-1 tab-env-badge';
                envBadge.style.cssText = 'font-size: 8px; padding: 1px 3px; font-weight: 700; line-height: 1;';
                tabEl.querySelector('.tab-label')?.after(envBadge);
            }
            envBadge.className = 'badge bg-primary ms-1 tab-env-badge';
            envBadge.textContent = 'DEV';
        } else if (envBadge) {
            envBadge.remove();
        }

        // Update read-only badge
        let roBadge = tabEl.querySelector('.tab-ro-badge');
        if (isRo) {
            if (!roBadge) {
                roBadge = document.createElement('i');
                roBadge.className = 'fa-solid fa-lock ms-1 text-warning tab-ro-badge';
                roBadge.style.fontSize = '9px';
                roBadge.title = 'Chỉ đọc';
                const insertAfterEl = tabEl.querySelector('.tab-env-badge') || tabEl.querySelector('.tab-label');
                if (insertAfterEl) insertAfterEl.after(roBadge);
            }
        } else if (roBadge) {
            roBadge.remove();
        }
    }

    function updateActiveTabContext(ctx = {}) {
        // Always update globals and default context first
        if (ctx.connectionId   !== undefined) window.ActiveConnectionId   = ctx.connectionId;
        if (ctx.connectionName !== undefined) window.ActiveConnectionName = ctx.connectionName;
        if (ctx.database       !== undefined) window.ActiveDatabase       = ctx.database;
        if (ctx.schema         !== undefined) window.ActiveSchema         = ctx.schema;
        if (ctx.dbType         !== undefined) window.ActiveDbType         = ctx.dbType;
        setDefaultContext(ctx);

        if (activeTabId && tabsData.has(activeTabId)) {
            const state = tabsData.get(activeTabId);
            Object.assign(state, ctx);
            updateTabSafetyBadges(activeTabId);
        }
        document.dispatchEvent(new CustomEvent('ide-context-changed', { detail: ctx }));
        if (typeof window.updateActionBar === 'function') {
            window.updateActionBar();
        }
    }

    function updateTabsConnectionId(connName, newConnId, oldConnId = null) {
        if (!connName && !oldConnId) return;
        const cleanTargetName = connName ? String(connName).replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim().toLowerCase() : '';
        tabsData.forEach((state, tId) => {
            if (!state) return;
            const curConnName = state.connectionName ? String(state.connectionName).replace(/\s*\((SQL Server|PostgreSQL|SQLite)\)$/i, '').trim().toLowerCase() : '';
            const matchName = cleanTargetName && curConnName && curConnName === cleanTargetName;
            const matchOldId = oldConnId && state.connectionId === oldConnId;
            if (matchName || matchOldId) {
                state.connectionId = newConnId;
                if (connName) state.connectionName = connName;
                if (tId === activeTabId) {
                    window.ActiveConnectionId = newConnId;
                    if (connName) window.ActiveConnectionName = connName;
                    if (typeof window.updateActionBar === 'function') {
                        window.updateActionBar();
                    }
                }
            }
        });
    }

    function setupTabDragAndDrop(tabEl, tabId) {
        tabEl.setAttribute('draggable', 'true');

        tabEl.addEventListener('dragstart', (e) => {
            if (e.target.closest('.tab-close')) {
                e.preventDefault();
                return false;
            }
            e.dataTransfer.setData('text/plain', tabId);
            e.dataTransfer.effectAllowed = 'move';
            tabEl.classList.add('dragging');
        });

        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = tabEl.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            if (e.clientX < midX) {
                tabEl.classList.add('drag-over-left');
                tabEl.classList.remove('drag-over-right');
            } else {
                tabEl.classList.add('drag-over-right');
                tabEl.classList.remove('drag-over-left');
            }
        });

        tabEl.addEventListener('dragleave', () => {
            tabEl.classList.remove('drag-over-left', 'drag-over-right');
        });

        tabEl.addEventListener('drop', (e) => {
            e.preventDefault();
            tabEl.classList.remove('drag-over-left', 'drag-over-right');
            const sourceTabId = e.dataTransfer.getData('text/plain');
            if (!sourceTabId || sourceTabId === tabId) return;

            const sourceEl = document.querySelector(`.ide-tab[data-tab-id="${sourceTabId}"]`);
            if (!sourceEl) return;

            const sourcePinned = pinnedTabs.has(sourceTabId);
            const targetPinned = pinnedTabs.has(tabId);
            if (sourcePinned && !targetPinned) return;
            if (!sourcePinned && targetPinned) return;

            const rect = tabEl.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            if (e.clientX < midX) {
                tabsBar.insertBefore(sourceEl, tabEl);
            } else {
                tabsBar.insertBefore(sourceEl, tabEl.nextSibling);
            }

            const currentDomIds = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]')).map(el => el.dataset.tabId);
            tabOrder = currentDomIds;
            calculateTabLayout();
        });

        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('dragging', 'drag-over-left', 'drag-over-right');
            document.querySelectorAll('.ide-tab').forEach(el => el.classList.remove('drag-over-left', 'drag-over-right', 'dragging'));
        });
    }

    function pinTab(tabId) {
        if (!tabsData.has(tabId)) return;
        pinnedTabs.add(tabId);
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.classList.add('pinned');
            if (!tabEl.querySelector('.tab-pin-icon')) {
                const pinIcon = document.createElement('i');
                pinIcon.className = 'fa-solid fa-thumbtack tab-pin-icon me-1 text-warning';
                pinIcon.title = 'Pinned';
                const iconEl = tabEl.querySelector('.tab-icon');
                if (iconEl) iconEl.insertAdjacentElement('beforebegin', pinIcon);
                else tabEl.prepend(pinIcon);
            }
        }
        const pinned = tabOrder.filter(id => pinnedTabs.has(id));
        const unpinned = tabOrder.filter(id => !pinnedTabs.has(id));
        tabOrder = [...pinned, ...unpinned];

        const firstUnpinned = tabsBar.querySelector('.ide-tab[data-tab-id]:not(.pinned)');
        if (tabEl) {
            if (firstUnpinned) {
                tabsBar.insertBefore(tabEl, firstUnpinned);
            } else {
                tabsBar.appendChild(tabEl);
            }
        }
        calculateTabLayout();
    }

    function unpinTab(tabId) {
        if (!tabsData.has(tabId)) return;
        pinnedTabs.delete(tabId);
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) {
            tabEl.classList.remove('pinned');
            tabEl.querySelector('.tab-pin-icon')?.remove();
        }
        const pinned = tabOrder.filter(id => pinnedTabs.has(id));
        const unpinned = tabOrder.filter(id => !pinnedTabs.has(id));
        tabOrder = [...pinned, ...unpinned];
        calculateTabLayout();
    }

    function isTabPinned(tabId) {
        return pinnedTabs.has(tabId);
    }

    function calculateTabLayout(forcedContainerWidth = null) {
        const tabsContainerEl = document.querySelector('.ide-tabs-container');
        if (!tabsContainerEl || !tabsBar) return;

        if (tabDisplayMode === 'all') {
            tabsContainerEl.classList.add('display-all');
            tabsBar.classList.add('display-all');

            tabOrder.forEach(id => {
                const el = document.querySelector(`.ide-tab[data-tab-id="${id}"]`);
                if (el) el.classList.remove('tab-overflow-hidden');
            });
            visibleTabIds = new Set(tabOrder);
            overflowTabIds = new Set();
            if (window.AppEditor && typeof window.AppEditor.layout === 'function') {
                window.AppEditor.layout();
            }
            return;
        }

        tabsContainerEl.classList.remove('display-all');
        tabsBar.classList.remove('display-all');

        const containerWidth = forcedContainerWidth !== null ? forcedContainerWidth : tabsContainerEl.clientWidth;
        if (containerWidth <= 0) return;

        const tabEls = Array.from(tabsBar.querySelectorAll('.ide-tab[data-tab-id]'));
        if (tabEls.length === 0) {
            visibleTabIds = new Set();
            overflowTabIds = new Set();
            return;
        }

        // Measure widths: ensure element is measurable by temporarily unhiding if hidden
        const tabWidthMap = new Map();
        let totalTabsWidth = 0;
        tabEls.forEach(el => {
            const wasHidden = el.classList.contains('tab-overflow-hidden');
            if (wasHidden) {
                el.style.visibility = 'hidden';
                el.classList.remove('tab-overflow-hidden');
            }
            const rect = el.getBoundingClientRect();
            const w = (rect.width || el.offsetWidth || 120) + 2;
            tabWidthMap.set(el.dataset.tabId, w);
            totalTabsWidth += w;
            if (wasHidden) {
                el.classList.add('tab-overflow-hidden');
                el.style.visibility = '';
            }
        });

        const newTabBtnWidth = 32;
        const overflowBtnWidth = 32;
        const reservedWidth = newTabBtnWidth + overflowBtnWidth + 24;

        if (totalTabsWidth <= (containerWidth - reservedWidth)) {
            // All tabs fit!
            visibleTabIds = new Set(tabOrder);
            overflowTabIds = new Set();
            tabEls.forEach(el => el.classList.remove('tab-overflow-hidden'));
            return;
        }

        // Tab overflow exists!
        const availableWidth = Math.max(80, containerWidth - reservedWidth);

        // Prioritize pinned tabs: [Pinned Tabs] -> [Normal Tabs] -> [Overflow Tabs]
        const pinnedList = tabOrder.filter(id => pinnedTabs.has(id));
        const normalList = tabOrder.filter(id => !pinnedTabs.has(id));

        let pinnedUsed = 0;
        const visiblePinned = [];
        for (const pid of pinnedList) {
            const w = tabWidthMap.get(pid) || 100;
            if (pinnedUsed + w <= availableWidth) {
                visiblePinned.push(pid);
                pinnedUsed += w;
            } else {
                break;
            }
        }

        const remainingForNormal = Math.max(0, availableWidth - pinnedUsed);
        let visibleNormal = [];

        if (normalList.length > 0 && remainingForNormal > 0) {
            let activeIdx = normalList.indexOf(activeTabId);
            if (activeIdx === -1) {
                let used = 0;
                for (const nid of normalList) {
                    const w = tabWidthMap.get(nid) || 120;
                    if (used + w <= remainingForNormal) {
                        visibleNormal.push(nid);
                        used += w;
                    } else {
                        break;
                    }
                }
            } else {
                // Ensure activeTabId is in visible window
                let fitsFromStart = true;
                let used = 0;
                const fromStartList = [];
                for (let i = 0; i <= activeIdx; i++) {
                    used += (tabWidthMap.get(normalList[i]) || 120);
                    if (used > remainingForNormal) {
                        fitsFromStart = false;
                        break;
                    }
                    fromStartList.push(normalList[i]);
                }

                if (fitsFromStart) {
                    for (let i = activeIdx + 1; i < normalList.length; i++) {
                        const w = tabWidthMap.get(normalList[i]) || 120;
                        if (used + w <= remainingForNormal) {
                            used += w;
                            fromStartList.push(normalList[i]);
                        } else {
                            break;
                        }
                    }
                    visibleNormal = fromStartList;
                } else {
                    let start = activeIdx;
                    let end = activeIdx;
                    let usedW = tabWidthMap.get(normalList[activeIdx]) || 120;

                    while (end + 1 < normalList.length && (usedW + (tabWidthMap.get(normalList[end + 1]) || 120) <= remainingForNormal)) {
                        end++;
                        usedW += (tabWidthMap.get(normalList[end]) || 120);
                    }
                    while (start - 1 >= 0 && (usedW + (tabWidthMap.get(normalList[start - 1]) || 120) <= remainingForNormal)) {
                        start--;
                        usedW += (tabWidthMap.get(normalList[start]) || 120);
                    }
                    for (let i = start; i <= end; i++) {
                        visibleNormal.push(normalList[i]);
                    }
                }
            }
        }

        visibleTabIds = new Set([...visiblePinned, ...visibleNormal]);
        overflowTabIds = new Set(tabOrder.filter(id => !visibleTabIds.has(id)));

        // Apply classes to DOM
        tabEls.forEach(el => {
            const id = el.dataset.tabId;
            if (visibleTabIds.has(id)) {
                el.classList.remove('tab-overflow-hidden');
            } else {
                el.classList.add('tab-overflow-hidden');
            }
        });

        if (window.AppEditor && typeof window.AppEditor.layout === 'function') {
            window.AppEditor.layout();
        }
    }

    function showTabOverflowMenu(btnEl) {
        const existing = document.getElementById('ide-tab-overflow-menu');
        if (existing) {
            existing.remove();
            btnEl?.classList.remove('active');
            return;
        }

        const menu = document.createElement('div');
        menu.id = 'ide-tab-overflow-menu';
        btnEl?.classList.add('active');

        // Phân loại: tab đang hiển thị trên màn hình (visible) vs tab bị khuất (overflow)
        const visibleTabs = [];
        const overflowTabs = [];

        tabOrder.forEach(tabId => {
            if (visibleTabIds.has(tabId)) {
                visibleTabs.push(tabId);
            } else {
                overflowTabs.push(tabId);
            }
        });

        const renderTabItem = (tabId) => {
            const data = tabsData.get(tabId);
            if (!data) return '';
            const title = data.title || 'Untitled';
            const isVisible = visibleTabIds.has(tabId);
            const isActive = tabId === activeTabId;
            const isPinned = pinnedTabs.has(tabId);
            const isDirty = !!data.isDirty;

            const iconClass = data.tabType === 'designer' 
                ? 'fa-drafting-compass text-info' 
                : data.tabType === 'diff' 
                    ? 'fa-code-compare text-warning' 
                    : 'fa-table-list text-primary';

            return `
                <button type="button" class="ide-overflow-item ${isVisible ? 'is-visible' : 'is-overflow'} ${isActive ? 'active' : ''}" data-tab-id="${tabId}" title="${title}">
                    <div class="d-flex align-items-center gap-2 overflow-hidden flex-grow-1">
                        ${isPinned ? '<i class="fa-solid fa-thumbtack text-warning flex-shrink-0" style="font-size: 10px;" title="Pinned"></i>' : ''}
                        <i class="fa-solid ${iconClass} flex-shrink-0" style="font-size: 11px;"></i>
                        <span class="tab-list-title text-truncate">${title}</span>
                        ${isDirty ? '<span class="text-warning flex-shrink-0" style="font-size: 10px;">●</span>' : ''}
                    </div>
                    ${isActive ? '<i class="fa-solid fa-check text-primary flex-shrink-0 ms-2" style="font-size: 11px;"></i>' : ''}
                </button>
            `;
        };

        // Ưu tiên hiển thị các file đang mở trên màn hình lên trước (thứ tự từ trái sang phải)
        let itemsHtml = visibleTabs.map(renderTabItem).join('');

        // Tiếp theo là các file bị ẩn / overflow (nếu có)
        if (overflowTabs.length > 0) {
            itemsHtml += `
                <div class="ide-ctx-separator my-1" style="height: 1px; background: var(--ide-border, #3c3f41);" title="Overflow Tabs"></div>
                ${overflowTabs.map(renderTabItem).join('')}
            `;
        }

        const isAllMode = tabDisplayMode === 'all';
        const showAllHtml = `
            <div class="ide-ctx-separator my-1" style="height: 1px; background: var(--ide-border, #3c3f41);"></div>
            <button type="button" class="ide-overflow-toggle" id="ide-overflow-toggle-show-all">
                <i class="fa-solid ${isAllMode ? 'fa-square-check text-primary' : 'fa-square text-muted'}" style="font-size: 13px;"></i>
                <span>Show All Tabs</span>
            </button>
        `;

        menu.innerHTML = itemsHtml + showAllHtml;
        document.body.appendChild(menu);

        if (btnEl) {
            const btnRect = btnEl.getBoundingClientRect();
            let top = btnRect.bottom + 4;
            let left = btnRect.right - menu.offsetWidth;

            if (left < 10) left = 10;
            if (left + menu.offsetWidth > window.innerWidth - 10) {
                left = window.innerWidth - menu.offsetWidth - 10;
            }
            if (top + menu.offsetHeight > window.innerHeight - 10) {
                top = Math.max(10, btnRect.top - menu.offsetHeight - 4);
            }

            menu.style.top = `${top}px`;
            menu.style.left = `${left}px`;
        }

        const closeOverflowMenu = () => {
            menu.remove();
            btnEl?.classList.remove('active');
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        const onDocClick = (e) => {
            if (!menu.contains(e.target) && (!btnEl || !btnEl.contains(e.target))) {
                closeOverflowMenu();
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeOverflowMenu();
            }
        };

        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onKeyDown);
        }, 10);

        menu.querySelectorAll('.ide-overflow-item[data-tab-id]').forEach(itemBtn => {
            itemBtn.addEventListener('click', () => {
                const targetId = itemBtn.dataset.tabId;
                closeOverflowMenu();
                if (targetId) {
                    switchTab(targetId);
                    if (tabDisplayMode === 'overflow' && !visibleTabIds.has(targetId)) {
                        calculateTabLayout();
                    }
                }
            });
        });

        menu.querySelector('#ide-overflow-toggle-show-all')?.addEventListener('click', () => {
            closeOverflowMenu();
            tabDisplayMode = tabDisplayMode === 'all' ? 'overflow' : 'all';
            try {
                localStorage.setItem('ide_tab_display_mode', tabDisplayMode);
            } catch (_) {}
            calculateTabLayout();
        });
    }

    function getTabDisplayMode() {
        return tabDisplayMode;
    }

    function setTabDisplayMode(mode) {
        if (mode !== 'overflow' && mode !== 'all') return;
        tabDisplayMode = mode;
        try {
            localStorage.setItem('ide_tab_display_mode', mode);
        } catch (_) {}
        calculateTabLayout();
    }

    function createNewQueryTab(opts = {}) {
        const focusedCtx = window.LastFocusedTreeContext || {};
        const hasFocusedConn = Boolean(focusedCtx.connectionName || focusedCtx.connectionId);

        // Only inherit activeState connection if neither opts nor focused tree context specified one
        if (!opts.connectionId && !opts.connectionName) {
            if (hasFocusedConn) {
                opts = {
                    connectionId: focusedCtx.connectionId,
                    connectionName: focusedCtx.connectionName,
                    database: focusedCtx.database,
                    schema: focusedCtx.schema,
                    dbType: focusedCtx.dbType,
                    ...opts
                };
            } else {
                const activeState = getActiveTabState();
                if (activeState) {
                    opts = {
                        connectionId: activeState.connectionId,
                        connectionName: activeState.connectionName,
                        database: activeState.database,
                        schema: activeState.schema,
                        dbType: activeState.dbType,
                        ...opts
                    };
                }
            }
        }
        return createTab(opts);
    }

    if (newTabBtn) newTabBtn.addEventListener('click', () => createNewQueryTab());
    document.addEventListener('click', (e) => {
        if (e.target.closest('#ide-empty-new-query-btn')) {
            e.preventDefault();
            createNewQueryTab();
        }
    });
    if (overflowBtn) {
        overflowBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showTabOverflowMenu(overflowBtn);
        });
    }

    const tabsContainerEl = document.querySelector('.ide-tabs-container');
    if (tabsContainerEl && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            calculateTabLayout();
        });
        ro.observe(tabsContainerEl);
    }
    window.addEventListener('resize', () => {
        calculateTabLayout();
    });
    document.addEventListener('ide-sidebar-toggled', () => {
        setTimeout(calculateTabLayout, 50);
    });
    document.addEventListener('ide-results-panel-resized', () => {
        setTimeout(calculateTabLayout, 50);
    });

    // Wire Action Bar Toolbar buttons for Split and Compare
    const btnCompareToolbar = document.getElementById('ide-btn-compare');
    if (btnCompareToolbar) {
        btnCompareToolbar.onclick = () => {
            let targetTabId = activeTabId;
            if (targetTabId && tabsData.has(targetTabId) && tabsData.get(targetTabId).tabType !== 'query') {
                const firstQuery = Array.from(tabsData.entries()).find(([_, t]) => t.tabType === 'query');
                targetTabId = firstQuery ? firstQuery[0] : null;
            }
            if (targetTabId) {
                handleCompareTab(targetTabId);
            } else {
                handleCompareWithDisk(null);
            }
        };
    }

    const btnSplitToolbar = document.getElementById('ide-btn-split-editor');
    if (btnSplitToolbar) {
        btnSplitToolbar.onclick = () => {
            if (window.toggleSplitEditor) {
                window.toggleSplitEditor();
            }
        };
    }

    function getTabsList() {
        const list = [];
        const rawEd = window.AppEditor ? (window.AppEditor.rawEditor || (typeof window.resolveMonacoEditor === 'function' ? window.resolveMonacoEditor(window.AppEditor) : null)) : null;
        tabsData.forEach((val, key) => {
            const isEdMounted = !rawEd || !val.monacoModel || (typeof rawEd.getModel === 'function' && rawEd.getModel() === val.monacoModel);
            const content = (key === activeTabId && window.AppEditor && isEdMounted) ? window.AppEditor.getValue() : val.content;
            list.push({
                id: key,
                title: val.title,
                tabType: val.tabType,
                docId: val.docId,
                filePath: val.filePath,
                content: content
            });
        });
        return list;
    }

    function syncDiffTabsWithSourceTab(changedTabId, newContent) {
        if (!changedTabId) return;
        tabsData.forEach((tabState, tabId) => {
            if (tabState && tabState.tabType === 'diff') {
                if (tabState.originalTabId === changedTabId) {
                    tabState.originalText = newContent;
                    if (tabId === activeTabId && typeof window.updateDiffOriginalModel === 'function') {
                        window.updateDiffOriginalModel(newContent);
                    }
                }
                if (tabState.modifiedTabId === changedTabId) {
                    tabState.modifiedText = newContent;
                    if (tabId === activeTabId && typeof window.updateDiffModifiedModel === 'function') {
                        window.updateDiffModifiedModel(newContent);
                    }
                }
            }
        });
    }

    function updateTabContentFromDiff(tabId, val) {
        const t = tabsData.get(tabId);
        if (t && t.content !== val) {
            t.content = val;
            if (t.monacoModel && !t.monacoModel.isDisposed() && t.monacoModel.getValue() !== val) {
                t.monacoModel.setValue(val);
            }
            setTabDirty(tabId, true);
        }
    }

    window.getTabsList = getTabsList;
    window.getActiveTabId = () => activeTabId;
    window.getTabData = (id) => tabsData.get(id);
    window.syncDiffTabsWithSourceTab = syncDiffTabsWithSourceTab;
    window.updateTabContentFromDiff = updateTabContentFromDiff;
    window.updateTabContent = (id, content) => {
        const t = tabsData.get(id);
        if (t) {
            t.content = content;
            if (t.monacoModel && !t.monacoModel.isDisposed() && t.monacoModel.getValue() !== content) {
                t.monacoModel.setValue(content);
            }
            setTabDirty(id, true);
            syncDiffTabsWithSourceTab(id, content);
        }
    };
    window.closeActiveDiffTab = () => {
        const state = activeTabId ? tabsData.get(activeTabId) : null;
        if (state && state.tabType === 'diff') {
            if (typeof window.closeDiffView === 'function') {
                window.closeDiffView();
            } else if (typeof window.hideDiffView === 'function') {
                window.hideDiffView();
            }
            closeTab(activeTabId);
        } else {
            // When compare view was opened over a regular text editor tab (e.g. from File History Sidebar)
            if (typeof window.closeDiffView === 'function') {
                window.closeDiffView();
            } else if (typeof window.hideDiffView === 'function') {
                window.hideDiffView();
            }
            if (window.AppEditor) {
                if (typeof window.AppEditor.focus === 'function') window.AppEditor.focus();
                if (typeof window.AppEditor.layout === 'function') window.AppEditor.layout();
            }
            if (typeof showToast === 'function') {
                showToast('Đã đóng màn hình so sánh (Diff View)', 'info');
            }
        }
    };

    window.openHistoryQueryInNewTab = function (sql, title, server, database) {
        try {
            const tabTitle = title || getUniqueFileName('SQLQuery', '.sql');
            createTab({
                title: tabTitle,
                content: sql || '',
                connectionName: server || window.ActiveConnectionName,
                database: database || window.ActiveDatabase
            });
            return true;
        } catch (err) {
            console.error('Error opening history query in new tab:', err);
            return false;
        }
    };

    // Global keyboard shortcut: Ctrl+N or Ctrl+T creates new query tab
    // Global keyboard shortcut: Ctrl+W closes active tab, Ctrl+Shift+W closes all tabs
    // Global keyboard shortcut: Ctrl+S saves active tab
    document.addEventListener('keydown', (e) => {
        const isCtrlOrCmd = e.ctrlKey || e.metaKey;
        if (!isCtrlOrCmd) return;

        // Avoid intercepting if user is inside a modal dialog
        if (document.activeElement && document.activeElement.closest('.modal.show')) return;

        const key = e.key.toLowerCase();

        // Ctrl+N or Ctrl+T: New Query Tab (inheriting active tab context)
        if ((key === 'n' || key === 't') && !e.altKey && !e.shiftKey) {
            // Let TableDataEditor handle Ctrl+N if active inside table-data-editor container
            if (key === 'n' && document.activeElement && document.activeElement.closest('#table-data-editor-container')) {
                return;
            }
            e.preventDefault();
            createNewQueryTab();
            return;
        }

        // Ctrl+W: Close active tab, Ctrl+Shift+W: Close all tabs
        if (key === 'w' && !e.altKey) {
            e.preventDefault();
            if (e.shiftKey) {
                closeAllTabs();
            } else {
                if (activeTabId) {
                    closeTab(activeTabId);
                }
            }
            return;
        }

        // Ctrl+O: Open file(s)
        if (key === 'o' && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            openFilesFromDisk();
            return;
        }

        // Ctrl+S: Save active tab
        if (key === 's' && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            saveActiveTab();
            return;
        }
    });

    // Wire File menu items and Import button
    document.getElementById('ide-menu-open-file')?.addEventListener('click', (e) => {
        e.preventDefault();
        openFilesFromDisk();
    });
    document.getElementById('ide-btn-import-file')?.addEventListener('click', (e) => {
        e.preventDefault();
        openFilesFromDisk();
    });
    document.getElementById('ide-menu-new-query')?.addEventListener('click', (e) => {
        e.preventDefault();
        createNewQueryTab();
    });
    document.getElementById('ide-menu-save')?.addEventListener('click', (e) => {
        e.preventDefault();
        saveActiveTab();
    });
    document.getElementById('ide-menu-close-tab')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
    });

    // Drag & drop external files (.sql, .txt, etc.) into IDE to open as tabs
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    });
    window.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            if (e.dataTransfer.getData('text/plain') && !e.dataTransfer.files.length) return;
            const files = Array.from(e.dataTransfer.files);
            const textFiles = files.filter(f => {
                const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : '';
                return ['.sql', '.txt', '.json', '.xml', '.csv', '.prg', '.log'].includes(ext) || !ext;
            });
            if (textFiles.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                textFiles.forEach(async file => {
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        const pathCandidate = file.path || file.name;
                        let existingDocId = null;
                        try {
                            const checkRes = await fetch(`/api/history/document_by_path?path=${encodeURIComponent(pathCandidate)}`);
                            const checkData = await checkRes.json();
                            if (checkData && checkData.success && checkData.document) {
                                existingDocId = checkData.document.DocId;
                            }
                        } catch (_) {}

                        createTab({
                            title: file.name,
                            filePath: pathCandidate,
                            docId: existingDocId || undefined,
                            content: ev.target.result || '',
                            isDirty: false
                        });
                    };
                    reader.readAsText(file);
                });
            }
        }
    });

    // Start with one tab or restore tabs from session if available (preserving docId, draft, cursor, scroll, connection)
    let restoredAny = false;
    if (window.AppSession && typeof window.AppSession.getOpenTabs === 'function') {
        const savedTabs = window.AppSession.getOpenTabs();
        if (Array.isArray(savedTabs) && savedTabs.length > 0) {
            savedTabs.forEach(st => {
                if (st && st.title) {
                    const savedContent = (window.AppSession.getTabDraft && st.id) ? window.AppSession.getTabDraft(st.id) : null;
                    const tabObj = createTab({
                        title: st.title,
                        tabType: st.tabType || 'query',
                        docId: st.docId,
                        filePath: st.filePath,
                        connectionId: st.connectionId,
                        connectionName: st.connectionName,
                        database: st.database,
                        schema: st.schema,
                        dbType: st.dbType,
                        environment: st.environment || '',
                        read_only: Boolean(st.read_only),
                        savedCursorPosition: st.cursor || { lineNumber: 1, column: 1 },
                        viewState: st.viewState || null,
                        content: savedContent || undefined
                    });
                    if (tabObj && st.isPinned) {
                        pinTab(tabObj.id);
                    }
                    if (tabObj && st.isDirty) {
                        tabObj.isDirty = true;
                        const closeBtn = document.querySelector(`.ide-tab[data-tab-id="${tabObj.id}"] .ide-tab-close`);
                        if (closeBtn) closeBtn.classList.add('dirty');
                    }
                    restoredAny = true;
                }
            });
            const lastActiveId = window.AppSession.getActiveTabId();
            if (lastActiveId && tabsData.has(lastActiveId)) {
                switchTab(lastActiveId);
            }
        }
    }
    if (!restoredAny) {
        createTab();
    }

    // Tải và khôi phục sâu từ Backend session.json (nếu có nội dung hoặc cursor bổ sung)
    if (window.AppSession && typeof window.AppSession.loadSession === 'function') {
        window.AppSession.loadSession().then(session => {
            if (session && Array.isArray(session.tabs) && session.tabs.length > 0) {
                session.tabs.forEach(st => {
                    if (st && st.id && tabsData.has(st.id)) {
                        const tabState = tabsData.get(st.id);
                        if (st.cursor) tabState.savedCursorPosition = st.cursor;
                        if (st.viewState) tabState.viewState = st.viewState;
                        if (st.scroll) tabState.scroll = st.scroll;
                        if (st.connectionLost) {
                            tabState.connectionId = null;
                            tabState.connectionName = null;
                        }
                        if (st.content !== undefined && !tabState.content) {
                            tabState.content = st.content;
                        }
                    }
                });
                if (session.activeTabId && tabsData.has(session.activeTabId)) {
                    switchTab(session.activeTabId);
                }
            }
        }).catch(err => {
            console.warn('[Tabs] Async backend session restore error:', err);
        });
    }

    function openActivityMonitorTab(opts = {}) {
        const title = opts.title || 'Activity Monitor';
        // Reuse existing tab if already opened
        for (const [id, tab] of tabsData.entries()) {
            if (tab && tab.tabType === 'activity-monitor') {
                switchTab(id);
                return id;
            }
        }
        const created = createTab({
            title: title,
            tabType: 'activity-monitor',
            icon: 'fa-heart-pulse',
            connectionId: opts.connectionId,
            connectionName: opts.connectionName,
            dbType: opts.dbType,
            database: opts.database,
            schema: opts.schema
        });
        return created ? (typeof created === 'string' ? created : created.id) : null;
    }
    window.openActivityMonitorTab = openActivityMonitorTab;

    function openSchemaCompareTab(opts = {}) {
        const title = opts.title || 'So sánh';
        for (const [id, tab] of tabsData.entries()) {
            if (tab && tab.tabType === 'schema-compare') {
                switchTab(id);
                const tabEl = tabsBar?.querySelector(`.ide-tab[data-tab-id="${id}"]`);
                if (tabEl) {
                    tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
                if (window.SchemaCompare) {
                    window.SchemaCompare.activateTab(id);
                    if (opts.connectionId && typeof window.SchemaCompare.setSourceContext === 'function') {
                        window.SchemaCompare.setSourceContext(opts.connectionId, opts.database, opts.schema, opts.dbType);
                    }
                }
                if (typeof showToast === 'function') {
                    showToast('Đang hiển thị tab So sánh Schema', 'info', 1500);
                }
                return id;
            }
        }
        const created = createTab({
            title: title,
            tabType: 'schema-compare',
            icon: 'fa-code-compare',
            connectionId: opts.connectionId,
            connectionName: opts.connectionName,
            dbType: opts.dbType,
            database: opts.database,
            schema: opts.schema
        });
        return created ? (typeof created === 'string' ? created : created.id) : null;
    }
    window.openSchemaCompareTab = openSchemaCompareTab;

    // Export helpers on window for ease of access and automated testing
    window.calculateTabLayout = calculateTabLayout;
    window.showTabOverflowMenu = showTabOverflowMenu;
    window.pinTab = pinTab;
    window.unpinTab = unpinTab;
    window.isTabPinned = isTabPinned;
    window.getTabDisplayMode = getTabDisplayMode;
    window.setTabDisplayMode = setTabDisplayMode;
    window.getVisibleTabIds = () => Array.from(visibleTabIds);
    window.getOverflowTabIds = () => Array.from(overflowTabIds);
    window.getTabOrder = () => [...tabOrder];

    return { 
        createTab,
        addTab: createTab,
        openActivityMonitorTab,
        openSchemaCompareTab,
        openFilesFromDisk,
        openFile: openFilesFromDisk,
        updateEmptyTabsState,
        switchTab, 
        closeTab, 
        closeOtherTabs,
        closeTabsToRight,
        closeAllTabs,
        duplicateTab,
        renameTab,
        copyTabTitle,
        saveTab: saveActiveTab,
        setTabDirty, 
        updateTabTitle, 
        getActiveTabState, 
        getActiveTabId, 
        getTab, 
        getAllTabs,
        getTabsList,
        updateActiveTabContext,
        updateTabsConnectionId,
        setDefaultContext,
        getDefaultContext,
        syncDiffTabsWithSourceTab,
        updateTabContentFromDiff,
        // Tab Layout & Overflow APIs
        calculateTabLayout,
        showTabOverflowMenu,
        pinTab,
        unpinTab,
        isTabPinned,
        getTabDisplayMode,
        setTabDisplayMode,
        getVisibleTabIds: () => Array.from(visibleTabIds),
        getOverflowTabIds: () => Array.from(overflowTabIds),
        getTabOrder: () => [...tabOrder],
        isTextEditorTab
    };
}
