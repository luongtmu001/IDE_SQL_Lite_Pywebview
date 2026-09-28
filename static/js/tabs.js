// Tab State Management

function initTabs() {
    const tabsBar  = document.getElementById('ide-tabs-bar');
    const newTabBtn = document.getElementById('ide-new-tab-btn');

    let tabCounter = 0;
    // tabId -> { tabType, title, content, isDirty, designerData, connectionId, connectionName, database, schema, dbType, ... }
    const tabsData = new Map();
    let activeTabId = null;

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

    function createTab(opts = {}) {
        tabCounter++;
        const tabId = `tab-${tabCounter}`;
        const tabType = opts.tabType || 'query';
        const tabTitle = opts.title || `Query ${tabCounter}`;
        const icon = opts.icon || (tabType === 'designer' ? 'fa-drafting-compass' : 'fa-table-list');

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

        tabsData.set(tabId, {
            tabType:        tabType,
            title:          tabTitle,
            isDirty:        false,
            designerData:   opts.designerData   || null,
            content:        opts.content        || '-- Write your SQL query here\nSELECT * FROM ',
            connectionId:   connId,
            connectionName: connName,
            database:       db,
            schema:         sch,
            dbType:         typ,
            resultData:     null,
            activeView:     'results-grid',
            messageText:    '',
            planText:       ''
        });

        const tabEl = document.createElement('li');
        tabEl.className = 'nav-item ide-tab d-flex align-items-center';
        tabEl.dataset.tabId = tabId;
        tabEl.innerHTML = `
            <i class="fa-solid ${icon} me-1 tab-icon" style="font-size: 11px;"></i>
            <span class="tab-label text-truncate" style="max-width: 140px;" title="${tabTitle}">${tabTitle}</span>
            <span class="tab-dirty-dot ms-1 d-none text-warning" style="font-size: 10px;" title="Unsaved changes">●</span>
            <i class="fa-solid fa-xmark tab-close ms-2"></i>
        `;

        tabEl.addEventListener('click', e => {
            if (e.target.closest('.tab-close')) {
                closeTab(tabId, tabEl);
            } else {
                switchTab(tabId);
            }
        });

        tabEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            switchTab(tabId);
            showTabContextMenu(e, tabId);
        });

        // Append to the tabs list
        tabsBar.appendChild(tabEl);

        switchTab(tabId);
        return tabId;
    }

    function switchTab(tabId) {
        // Save current editor content if switching from a query tab
        if (activeTabId && tabsData.has(activeTabId)) {
            const prev = tabsData.get(activeTabId);
            if (prev.tabType !== 'designer' && window.AppEditor) {
                prev.content = window.AppEditor.getValue();
            }
        }

        // Update tab highlight
        document.querySelectorAll('.ide-tab[data-tab-id]').forEach(t => t.classList.remove('active'));
        const tabEl = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
        if (tabEl) tabEl.classList.add('active');

        activeTabId = tabId;
        const state = tabsData.get(tabId);

        // Toggle workspace views: Query View vs Table Designer View vs Table Data Editor View
        const designerContainer = document.getElementById('table-designer-container');
        const dataEditorContainer = document.getElementById('table-data-editor-container');
        const editorWrap = document.querySelector('.ide-editor-wrap');
        const resizer = document.querySelector('.ide-resizer-horizontal');
        const resultsPane = document.getElementById('ide-result-panel') || document.getElementById('ide-results-pane') || (resizer ? resizer.nextElementSibling : null);
        const queryControls = document.querySelector('.ide-action-bar .d-flex.align-items-center.gap-1.flex-shrink-0');

        if (state && state.tabType === 'designer') {
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (designerContainer) designerContainer.classList.remove('d-none');

            if (window.TableDesigner) {
                window.TableDesigner.activateTab(tabId);
            }
        } else if (state && state.tabType === 'data-editor') {
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (dataEditorContainer) dataEditorContainer.classList.remove('d-none');

            if (window.TableDataEditor) {
                window.TableDataEditor.activateTab(tabId);
            }
        } else {
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (editorWrap) editorWrap.classList.remove('d-none');
            const isResultHidden = window.isResultPanelHidden && window.isResultPanelHidden();
            if (!isResultHidden) {
                if (resizer) resizer.classList.remove('d-none');
                if (resultsPane) resultsPane.classList.remove('d-none');
            }
            if (queryControls) queryControls.classList.remove('opacity-50', 'pe-none');

            // Restore editor content
            if (state && window.AppEditor) {
                window.AppEditor.setValue(state.content || '');
                setTimeout(() => { if (window.AppEditor) { if (window.AppEditor.layout) window.AppEditor.layout(); else if (window.AppEditor.refresh) window.AppEditor.refresh(); } }, 10);
            }
        }

        // Sync active context globals to tab state
        if (state) {
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
    }

    function closeTab(tabId, tabEl) {
        const state = tabsData.get(tabId);
        const title = state ? state.title : 'Editor';
        const isDirty = state ? !!state.isDirty : false;
        showCloseConfirmModal(title, isDirty, () => forceCloseTab(tabId, tabEl));
    }

    function forceCloseTab(tabId, tabEl) {
        const state = tabsData.get(tabId);
        const title = state ? state.title : 'Editor';
        if (state && state.tabType === 'designer' && window.TableDesigner) {
            window.TableDesigner.closeTab(tabId);
        } else if (state && state.tabType === 'data-editor' && window.TableDataEditor) {
            window.TableDataEditor.closeTab(tabId);
        }

        tabsData.delete(tabId);
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

    function showTabContextMenu(e, tabId) {
        document.getElementById('ide-tab-context-menu')?.remove();
        const menu = document.createElement('ul');
        menu.id = 'ide-tab-context-menu';
        menu.className = 'dropdown-menu shadow-sm';
        menu.style.position = 'absolute';
        menu.style.display = 'block';
        menu.style.zIndex = '1070';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        
        const state = tabsData.get(tabId);
        const isQuery = state && state.tabType === 'query';
        const isSplit = window.isEditorSplit && window.isEditorSplit();

        let items = '<li><a class="dropdown-item" href="#" id="ctx-tab-save"><i class="fa-solid fa-floppy-disk me-2 text-primary"></i>Save (Ctrl+S)</a></li>';
        if (isQuery) {
            items += '<li><a class="dropdown-item" href="#" id="ctx-tab-split"><i class="fa-solid fa-columns me-2 text-info"></i>' + (isSplit ? 'Close Split View' : 'Split Tab') + '</a></li>';
        }
        items += '<li><hr class="dropdown-divider"></li>';
        items += '<li><a class="dropdown-item text-danger" href="#" id="ctx-tab-close"><i class="fa-solid fa-xmark me-2"></i>Close Tab</a></li>';
        menu.innerHTML = items;

        document.body.appendChild(menu);

        const closeMenu = () => menu.remove();
        setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 10);

        menu.querySelector('#ctx-tab-save').addEventListener('click', (ev) => {
            ev.preventDefault();
            saveActiveTab();
        });

        if (isQuery) {
            menu.querySelector('#ctx-tab-split').addEventListener('click', (ev) => {
                ev.preventDefault();
                if (window.toggleSplitEditor) {
                    window.toggleSplitEditor();
                } else if (window.splitEditor) {
                    window.splitEditor();
                }
            });
        }

        menu.querySelector('#ctx-tab-close').addEventListener('click', (ev) => {
            ev.preventDefault();
            const tabEl = document.querySelector('.ide-tab[data-tab-id="' + tabId + '"]');
            if (tabEl) closeTab(tabId, tabEl);
        });
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
            a.download = (state.title || 'query') + '.sql';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            setTabDirty(activeTabId, false);
            if (typeof showToast === 'function') showToast('Saved ' + state.title, 'success');
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
    }

    function getActiveTabState() {
        if (!activeTabId) return null;
        const state = tabsData.get(activeTabId);
        if (state && state.tabType !== 'designer' && window.AppEditor) {
            state.content = window.AppEditor.getValue();
        }
        return state;
    }

    function getActiveTabId() { return activeTabId; }

    function getTab(tabId) {
        return tabsData.get(tabId) || null;
    }

    function getAllTabs() {
        return tabsData;
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
        }
        document.dispatchEvent(new CustomEvent('ide-context-changed', { detail: ctx }));
        if (typeof window.updateActionBar === 'function') {
            window.updateActionBar();
        }
    }

    if (newTabBtn) newTabBtn.addEventListener('click', () => createTab());

    // Global keyboard shortcut: Ctrl+T (or Cmd+T) creates new query tab
    // Global keyboard shortcut: Ctrl+S (or Cmd+S) saves active tab
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't' && !e.altKey && !e.shiftKey) {
            // Avoid intercepting if user is inside a modal dialog
            if (document.activeElement && document.activeElement.closest('.modal.show')) return;
            e.preventDefault();
            createTab();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.altKey && !e.shiftKey) {
            if (document.activeElement && document.activeElement.closest('.modal.show')) return;
            e.preventDefault();
            saveActiveTab();
        }
    });

    // Start with one tab
    createTab();

    return { 
        createTab, 
        switchTab, 
        closeTab, 
        setTabDirty, 
        updateTabTitle, 
        getActiveTabState, 
        getActiveTabId, 
        getTab, 
        getAllTabs,
        updateActiveTabContext,
        setDefaultContext,
        getDefaultContext
    };
}
