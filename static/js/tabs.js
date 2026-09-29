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
            planText:       '',
            originalText:   opts.originalText   !== undefined ? opts.originalText : '',
            modifiedText:   opts.modifiedText   !== undefined ? opts.modifiedText : '',
            originalTitle:  opts.originalTitle  || '',
            modifiedTitle:  opts.modifiedTitle  || '',
            originalTabId:  opts.originalTabId  !== undefined ? opts.originalTabId : null,
            modifiedTabId:  opts.modifiedTabId  !== undefined ? opts.modifiedTabId : null
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

        // Append to the tabs list
        tabsBar.appendChild(tabEl);

        switchTab(tabId);
        return tabId;
    }

    function switchTab(tabId) {
        // Save current editor content if switching from a query tab or diff tab
        if (activeTabId && tabsData.has(activeTabId)) {
            const prev = tabsData.get(activeTabId);
            if (prev.tabType !== 'designer' && prev.tabType !== 'diff' && window.AppEditor) {
                prev.content = window.AppEditor.getValue();
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
        const state = tabsData.get(tabId);

        // Toggle workspace views: Query View vs Table Designer View vs Table Data Editor View vs Diff View
        const designerContainer = document.getElementById('table-designer-container');
        const dataEditorContainer = document.getElementById('table-data-editor-container');
        const editorWrap = document.querySelector('.ide-editor-wrap');
        const resizer = document.querySelector('.ide-resizer-horizontal');
        const resultsPane = document.getElementById('ide-result-panel') || document.getElementById('ide-results-pane') || (resizer ? resizer.nextElementSibling : null);
        const queryControls = document.querySelector('.ide-action-bar .d-flex.align-items-center.gap-1.flex-shrink-0');

        if (state && state.tabType === 'designer') {
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
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
            if (typeof window.hideDiffView === 'function') window.hideDiffView();
            if (editorWrap) editorWrap.classList.add('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (designerContainer) designerContainer.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');
            if (dataEditorContainer) dataEditorContainer.classList.remove('d-none');

            if (window.TableDataEditor) {
                window.TableDataEditor.activateTab(tabId);
            }
        } else if (state && state.tabType === 'diff') {
            if (designerContainer) designerContainer.classList.add('d-none');
            if (dataEditorContainer) dataEditorContainer.classList.add('d-none');
            if (editorWrap) editorWrap.classList.remove('d-none');
            if (resizer) resizer.classList.add('d-none');
            if (resultsPane) resultsPane.classList.add('d-none');
            if (queryControls) queryControls.classList.add('opacity-50', 'pe-none');

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
        if (state && state.tabType === 'designer' && window.TableDesigner) {
            window.TableDesigner.closeTab(tabId);
        } else if (state && state.tabType === 'data-editor' && window.TableDataEditor) {
            window.TableDataEditor.closeTab(tabId);
        } else if (state && state.tabType === 'diff') {
            if (typeof window.closeDiffView === 'function') {
                window.closeDiffView();
            }
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
            <button class="ide-ctx-item" id="ctx-tab-split">
                <i class="fa-solid fa-table-columns ide-ctx-icon text-info"></i>
                <span class="ide-ctx-label">${isSplit ? 'Close Split View' : 'Split to Right'}</span>
            </button>
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
            menu.querySelector('#ctx-tab-split')?.addEventListener('click', (ev) => {
                ev.preventDefault();
                closeMenu();
                if (window.isEditorSplit && window.isEditorSplit()) {
                    window.unsplitEditor();
                } else {
                    switchTab(tabId);
                    if (window.splitEditor) {
                        window.splitEditor(tabId);
                    }
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
        tabsData.forEach((val, key) => {
            list.push({
                id: key,
                title: val.title,
                tabType: val.tabType,
                content: (key === activeTabId && window.AppEditor) ? window.AppEditor.getValue() : val.content
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
            setTabDirty(id, true);
            syncDiffTabsWithSourceTab(id, content);
        }
    };
    window.closeActiveDiffTab = () => {
        if (activeTabId) closeTab(activeTabId);
    };

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
        setDefaultContext,
        getDefaultContext,
        syncDiffTabsWithSourceTab,
        updateTabContentFromDiff
    };
}
