// =============================================================================
// File History Sidebar Controller (Docked & Resizable on Right of Text Editor)
// =============================================================================

window.FileHistorySidebar = (function () {
    let isOpen = false;
    let currentDocId = null;
    let currentDocTitle = 'File Log';
    let currentEntries = [];
    let selectedEntry = null;
    let activeFilter = 'all';
    let searchQuery = '';
    let panelWidth = 380;
    let isDragging = false;

    // DOM Elements Cache
    let resizerEl = null;
    let panelEl = null;
    let docTitleEl = null;
    let runsBadgeEl = null;
    let searchInputEl = null;
    let clearSearchBtn = null;
    let entriesContainerEl = null;
    let detailFooterEl = null;
    let detailTimeEl = null;
    let detailStatusEl = null;
    let btnDiffEl = null;
    let btnApplyEl = null;
    let btnCopyEl = null;

    function init() {
        resizerEl = document.getElementById('ide-file-history-resizer');
        panelEl = document.getElementById('ide-file-history-panel');
        if (!resizerEl || !panelEl) return;

        docTitleEl = document.getElementById('fhs-doc-title');
        runsBadgeEl = document.getElementById('fhs-runs-badge');
        searchInputEl = document.getElementById('fhs-search-input');
        clearSearchBtn = document.getElementById('fhs-btn-clear-search');
        entriesContainerEl = document.getElementById('fhs-entries-container');
        detailFooterEl = document.getElementById('fhs-detail-footer');
        detailTimeEl = document.getElementById('fhs-detail-time');
        detailStatusEl = document.getElementById('fhs-detail-status');
        btnDiffEl = document.getElementById('fhs-btn-diff');
        btnApplyEl = document.getElementById('fhs-btn-apply');
        btnCopyEl = document.getElementById('fhs-btn-copy');

        // Restore saved width
        const savedWidth = localStorage.getItem('ide-file-history-width');
        if (savedWidth) {
            const w = parseInt(savedWidth, 10);
            if (!isNaN(w) && w >= 260 && w <= 900) {
                panelWidth = w;
                panelEl.style.width = `${w}px`;
            }
        } else if (panelEl) {
            panelEl.style.width = `${panelWidth}px`;
        }

        // Init Splitter Dragging
        initResizerDragging();

        // Header Buttons
        const btnClose = document.getElementById('fhs-btn-close');
        if (btnClose) {
            btnClose.addEventListener('click', () => close());
        }

        const btnRefresh = document.getElementById('fhs-btn-refresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                if (currentDocId) {
                    loadEntries(currentDocId, true);
                }
            });
        }

        const btnOpenFull = document.getElementById('fhs-btn-open-full');
        if (btnOpenFull) {
            btnOpenFull.addEventListener('click', () => {
                if (typeof window.openQueryHistoryWindow === 'function') {
                    window.openQueryHistoryWindow();
                }
            });
        }

        // Filter Pills
        document.querySelectorAll('.fhs-pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.fhs-pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeFilter = btn.dataset.filter || 'all';
                renderEntries();
            });
        });

        // Search Input
        if (searchInputEl) {
            searchInputEl.addEventListener('input', (e) => {
                searchQuery = e.target.value.trim().toLowerCase();
                if (clearSearchBtn) {
                    clearSearchBtn.classList.toggle('d-none', !searchQuery);
                }
                renderEntries();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInputEl) searchInputEl.value = '';
                searchQuery = '';
                clearSearchBtn.classList.add('d-none');
                renderEntries();
            });
        }

        // Detail Footer Action Buttons
        if (btnDiffEl) {
            btnDiffEl.addEventListener('click', () => {
                if (selectedEntry) diffWithEntry(selectedEntry);
            });
        }

        if (btnApplyEl) {
            btnApplyEl.addEventListener('click', () => {
                if (selectedEntry) applyEntryToEditor(selectedEntry);
            });
        }

        if (btnCopyEl) {
            btnCopyEl.addEventListener('click', () => {
                if (selectedEntry) copyEntrySql(selectedEntry);
            });
        }

        // Global Event Listeners
        document.addEventListener('ide-history-updated', (e) => {
            if (isOpen && e.detail && e.detail.docId === currentDocId) {
                loadEntries(currentDocId, false);
            }
        });
    }

    function initResizerDragging() {
        if (!resizerEl || !panelEl) return;

        let startX = 0;
        let startW = panelWidth;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const deltaX = startX - e.clientX;
            let newWidth = startW + deltaX;

            const minWidth = 260;
            const maxWidth = Math.min(850, Math.round(window.innerWidth * 0.75));

            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            panelWidth = newWidth;
            panelEl.style.width = `${newWidth}px`;

            layoutEditor();
        };

        const onMouseUp = () => {
            if (!isDragging) return;
            isDragging = false;
            resizerEl.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('ide-file-history-width', panelWidth);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            layoutEditor();
        };

        resizerEl.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startW = panelEl.offsetWidth || panelWidth;
            resizerEl.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    function layoutEditor() {
        if (window.AppEditor && typeof window.AppEditor.layout === 'function') {
            window.AppEditor.layout();
        }
        if (window.AppEditor2 && typeof window.AppEditor2.layout === 'function') {
            window.AppEditor2.layout();
        }
    }

    function getActiveTab() {
        if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
            return window.AppTabs.getActiveTabState();
        }
        return null;
    }

    async function toggle() {
        if (isOpen) {
            close();
        } else {
            await open();
        }
    }

    async function open(specificDocId = null) {
        const activeTab = getActiveTab();
        if (!activeTab && !specificDocId) {
            // Không có file nào đang mở -> mở cửa sổ log đầy đủ
            if (typeof window.openQueryHistoryWindow === 'function') {
                window.openQueryHistoryWindow();
            }
            return;
        }

        isOpen = true;
        if (resizerEl) resizerEl.classList.remove('d-none');
        if (panelEl) panelEl.classList.remove('d-none');

        const btnTrigger = document.getElementById('ide-btn-file-history');
        if (btnTrigger) btnTrigger.classList.add('active');

        layoutEditor();

        // Resolve docId
        let docId = specificDocId || (activeTab ? activeTab.docId : null);
        let title = activeTab ? (activeTab.title || 'SQLQuery.sql') : 'File Log';

        // Check file path resolution if docId is not known or fresh
        if (activeTab && activeTab.filePath) {
            try {
                const res = await fetch(`/api/history/document_by_path?path=${encodeURIComponent(activeTab.filePath)}`);
                const data = await res.json();
                if (data && data.success && data.document && data.document.DocId) {
                    docId = data.document.DocId;
                    activeTab.docId = docId;
                }
            } catch (_) {}
        }

        currentDocId = docId;
        currentDocTitle = title;

        if (docTitleEl) {
            docTitleEl.textContent = title;
            docTitleEl.title = (activeTab && activeTab.filePath) ? `${title} (${activeTab.filePath})` : title;
        }

        if (docId) {
            await loadEntries(docId);
        } else {
            showEmptyState('Chưa có bản ghi lịch sử cho file này (Nhấn F5 để thực thi và lưu log)');
        }
    }

    function close() {
        isOpen = false;
        if (resizerEl) resizerEl.classList.add('d-none');
        if (panelEl) panelEl.classList.add('d-none');

        const btnTrigger = document.getElementById('ide-btn-file-history');
        if (btnTrigger) btnTrigger.classList.remove('active');

        layoutEditor();
    }

    async function onTabChanged(tabId, tabState) {
        if (!isOpen) return;

        if (!tabState || tabState.tabType !== 'query') {
            if (docTitleEl) docTitleEl.textContent = tabState ? (tabState.title || 'Other Tab') : 'File Log';
            if (runsBadgeEl) runsBadgeEl.textContent = '0 runs';
            showEmptyState('Tab hiện tại không hỗ trợ lịch sử câu lệnh SQL');
            return;
        }

        currentDocTitle = tabState.title || 'SQLQuery.sql';
        if (docTitleEl) {
            docTitleEl.textContent = currentDocTitle;
            docTitleEl.title = tabState.filePath || currentDocTitle;
        }

        let docId = tabState.docId;
        if (tabState.filePath) {
            try {
                const res = await fetch(`/api/history/document_by_path?path=${encodeURIComponent(tabState.filePath)}`);
                const data = await res.json();
                if (data && data.success && data.document && data.document.DocId) {
                    docId = data.document.DocId;
                    tabState.docId = docId;
                }
            } catch (_) {}
        }

        currentDocId = docId;
        if (docId) {
            await loadEntries(docId);
        } else {
            showEmptyState('Chưa có bản ghi lịch sử cho file này (Nhấn F5 để chạy)');
        }
    }

    function onAllTabsClosed() {
        if (!isOpen) return;
        currentDocId = null;
        currentDocTitle = 'File Log';
        if (docTitleEl) docTitleEl.textContent = 'File Log';
        if (runsBadgeEl) runsBadgeEl.textContent = '0 runs';
        showEmptyState('Không có file nào đang mở.<br><button type="button" class="btn btn-sm btn-primary mt-2" onclick="window.openQueryHistoryWindow()"><i class="fa-solid fa-clock-rotate-left me-1"></i>Mở cửa sổ Query History</button>');
    }

    async function loadEntries(docId, showLoading = true) {
        if (!entriesContainerEl) return;
        if (showLoading) {
            entriesContainerEl.innerHTML = `
                <div class="fhs-empty-state">
                    <i class="fa-solid fa-spinner fa-spin text-info"></i>
                    <p>Đang tải log của file...</p>
                </div>
            `;
        }

        try {
            const res = await fetch(`/api/history/entries?doc_id=${encodeURIComponent(docId)}&limit=150`);
            const data = await res.json();

            if (data && data.success && Array.isArray(data.entries)) {
                currentEntries = data.entries.map(normalizeEntry);
                if (runsBadgeEl) {
                    runsBadgeEl.textContent = `${currentEntries.length} run${currentEntries.length !== 1 ? 's' : ''}`;
                }
                renderEntries();
            } else {
                currentEntries = [];
                if (runsBadgeEl) runsBadgeEl.textContent = '0 runs';
                showEmptyState('Chưa có lần chạy nào cho file này (Nhấn F5 để ghi log)');
            }
        } catch (err) {
            console.error('[FileHistorySidebar] Error loading entries:', err);
            showEmptyState('Lỗi nạp log của file: ' + err.message);
        }
    }

    function normalizeEntry(e) {
        return {
            entryId: e.EntryId || e.entry_id,
            docId: e.DocId || e.doc_id,
            entryType: e.EntryType !== undefined ? e.EntryType : (e.entry_type || 1),
            executedAt: e.ExecutedAt || e.executed_at,
            server: e.Server || e.server || 'Local',
            database: e.DatabaseName || e.database || 'master',
            durationMs: e.DurationMs !== undefined ? e.DurationMs : (e.duration_ms !== undefined ? e.duration_ms : null),
            status: e.Status !== undefined ? e.Status : (e.status !== undefined ? e.status : null),
            errorSummary: e.ErrorSummary || e.error_summary || null,
            runCount: e.RunCount || e.run_count || 1,
            tag: e.Tag || e.tag || '',
            note: e.Note || e.note || '',
            sql: e.Sql || e.sql || null
        };
    }

    function renderEntries() {
        if (!entriesContainerEl) return;

        let filtered = currentEntries.filter(entry => {
            // Pill Filter
            if (activeFilter === 'ok' && entry.status !== 0) return false;
            if (activeFilter === 'error' && entry.status !== 1) return false;
            if (activeFilter === 'snapshot' && entry.entryType !== 2) return false;

            // Search Query
            if (searchQuery) {
                const s = searchQuery;
                const matchServer = entry.server.toLowerCase().includes(s);
                const matchDb = entry.database.toLowerCase().includes(s);
                const matchTag = entry.tag.toLowerCase().includes(s);
                const matchNote = entry.note.toLowerCase().includes(s);
                const matchSql = entry.sql ? entry.sql.toLowerCase().includes(s) : false;
                if (!matchServer && !matchDb && !matchTag && !matchNote && !matchSql) {
                    return false;
                }
            }
            return true;
        });

        if (filtered.length === 0) {
            showEmptyState(currentEntries.length > 0 ? 'Không có bản ghi phù hợp với bộ lọc' : 'Chưa có bản ghi lịch sử cho file này (F5 để chạy)');
            if (detailFooterEl) detailFooterEl.classList.add('d-none');
            return;
        }

        entriesContainerEl.innerHTML = '';
        filtered.forEach(entry => {
            const card = createEntryCard(entry);
            entriesContainerEl.appendChild(card);
        });

        // Retain selection if valid
        if (selectedEntry) {
            const stillThere = filtered.find(e => e.entryId === selectedEntry.entryId);
            if (stillThere) {
                selectEntryCard(stillThere);
            } else {
                selectedEntry = null;
                if (detailFooterEl) detailFooterEl.classList.add('d-none');
            }
        }
    }

    function createEntryCard(entry) {
        const card = document.createElement('div');
        card.className = `fhs-entry-card ${selectedEntry && selectedEntry.entryId === entry.entryId ? 'active' : ''}`;
        card.dataset.entryId = entry.entryId;

        const isExec = entry.entryType === 1;
        const typeIcon = isExec
            ? '<i class="fa-solid fa-play text-success" title="Lần chạy F5" style="font-size: 10px;"></i>'
            : '<i class="fa-regular fa-file text-warning" title="Snapshot Lưu/Đóng" style="font-size: 10px;"></i>';

        let statusBadge = '';
        if (entry.status === 0) {
            statusBadge = '<span class="fhs-badge fhs-badge-ok">OK</span>';
        } else if (entry.status === 1) {
            statusBadge = '<span class="fhs-badge fhs-badge-err">Lỗi</span>';
        } else if (entry.status === 2) {
            statusBadge = '<span class="fhs-badge fhs-badge-snap">Hủy</span>';
        } else {
            statusBadge = '<span class="fhs-badge text-secondary">...</span>';
        }

        const runCountBadge = (entry.runCount > 1) ? `<span class="badge bg-secondary-subtle text-secondary border border-secondary" style="font-size: 9px;" title="Chạy giống nhau ${entry.runCount} lần">×${entry.runCount}</span>` : '';
        const tagBadge = entry.tag ? `<span class="fhs-badge fhs-badge-tag"><i class="fa-solid fa-tag me-1"></i>${escapeHtml(entry.tag)}</span>` : '';
        const noteIcon = entry.note ? `<i class="fa-solid fa-note-sticky text-warning ms-1" title="${escapeHtml(entry.note)}" style="font-size: 10px;"></i>` : '';

        const exactTime = formatExactTime(entry.executedAt);
        const relTime = formatTimeAgo(entry.executedAt);
        const durStr = entry.durationMs !== null ? `${entry.durationMs}ms` : '—';

        card.innerHTML = `
            <div class="fhs-entry-top">
                <div class="fhs-entry-time">
                    ${typeIcon}
                    <span>${exactTime}</span>
                    <span class="fhs-entry-time-rel">(${relTime})</span>
                    ${noteIcon}
                </div>
                <div class="d-flex align-items-center gap-1">
                    ${runCountBadge}
                    ${tagBadge}
                    ${statusBadge}
                </div>
            </div>
            <div class="fhs-entry-meta">
                <span class="text-truncate" style="max-width: 220px;" title="${escapeHtml(entry.database)} @ ${escapeHtml(entry.server)}">
                    <i class="fa-solid fa-database me-1 text-muted"></i>${escapeHtml(entry.database)}
                </span>
                <span><i class="fa-regular fa-clock me-1 text-muted"></i>${durStr}</span>
            </div>
            <div class="fhs-entry-sql-preview">Đang nạp câu lệnh SQL...</div>
            <div class="fhs-entry-actions">
                <button type="button" class="fhs-card-btn btn-diff" title="So sánh câu này với Editor hiện tại">
                    <i class="fa-solid fa-code-compare me-1"></i>Diff
                </button>
                <button type="button" class="fhs-card-btn btn-apply" title="Nạp lại nội dung vào Editor">
                    <i class="fa-solid fa-arrow-turn-down me-1"></i>Nạp
                </button>
                <button type="button" class="fhs-card-btn" title="Sao chép SQL">
                    <i class="fa-regular fa-copy me-1"></i>Copy
                </button>
            </div>
        `;

        // Lazy load uncompressed SQL preview
        loadSqlPreviewForCard(entry, card.querySelector('.fhs-entry-sql-preview'));

        // Click to select
        card.addEventListener('click', (e) => {
            if (e.target.closest('.fhs-entry-actions')) return;
            selectEntryCard(entry);
        });

        // Double click to Diff with active editor
        card.addEventListener('dblclick', () => {
            diffWithEntry(entry);
        });

        // Action buttons inside card
        const btnDiff = card.querySelector('.btn-diff');
        if (btnDiff) {
            btnDiff.addEventListener('click', (e) => {
                e.stopPropagation();
                diffWithEntry(entry);
            });
        }

        const btnApply = card.querySelector('.btn-apply');
        if (btnApply) {
            btnApply.addEventListener('click', (e) => {
                e.stopPropagation();
                applyEntryToEditor(entry);
            });
        }

        const btnCopy = card.querySelector('.fhs-entry-actions .fhs-card-btn:last-child');
        if (btnCopy) {
            btnCopy.addEventListener('click', (e) => {
                e.stopPropagation();
                copyEntrySql(entry);
            });
        }

        return card;
    }

    async function loadSqlPreviewForCard(entry, previewEl) {
        if (!previewEl) return;
        if (entry.sql !== null) {
            previewEl.textContent = entry.sql.slice(0, 160) || '-- (Empty query)';
            return;
        }

        try {
            const res = await fetch(`/api/history/entry/${entry.entryId}`);
            const data = await res.json();
            if (data && data.success && data.entry) {
                entry.sql = data.entry.Sql || data.entry.sql || '';
                if (data.entry.ErrorSummary) entry.errorSummary = data.entry.ErrorSummary;
                previewEl.textContent = entry.sql.slice(0, 160) || '-- (Empty query)';
            } else {
                previewEl.textContent = '-- (Không thể tải nội dung)';
            }
        } catch (_) {
            previewEl.textContent = '-- (Lỗi giải nén)';
        }
    }

    function selectEntryCard(entry) {
        selectedEntry = entry;
        document.querySelectorAll('.fhs-entry-card').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.entryId) === entry.entryId);
        });

        if (detailFooterEl) {
            detailFooterEl.classList.remove('d-none');
            if (detailTimeEl) {
                detailTimeEl.textContent = `${formatExactTime(entry.executedAt)} (${formatTimeAgo(entry.executedAt)})`;
            }
            if (detailStatusEl) {
                if (entry.status === 0) {
                    detailStatusEl.className = 'badge bg-success-subtle text-success border border-success';
                    detailStatusEl.textContent = 'OK';
                } else if (entry.status === 1) {
                    detailStatusEl.className = 'badge bg-danger-subtle text-danger border border-danger';
                    detailStatusEl.textContent = 'Lỗi';
                } else {
                    detailStatusEl.className = 'badge bg-warning-subtle text-warning border border-warning';
                    detailStatusEl.textContent = 'Hủy';
                }
            }
        }
    }

    async function ensureEntrySql(entry) {
        if (entry.sql !== null) return entry.sql;
        try {
            const res = await fetch(`/api/history/entry/${entry.entryId}`);
            const data = await res.json();
            if (data && data.success && data.entry) {
                entry.sql = data.entry.Sql || data.entry.sql || '';
                return entry.sql;
            }
        } catch (_) {}
        return '';
    }

    async function diffWithEntry(entry) {
        const sql = await ensureEntrySql(entry);
        const curSql = (window.AppEditor && typeof window.AppEditor.getValue === 'function')
            ? window.AppEditor.getValue()
            : '';

        if (typeof window.showDiffView === 'function') {
            const timeStr = formatExactTime(entry.executedAt);
            window.showDiffView(
                sql,
                curSql,
                `Lịch sử (${timeStr})`,
                `Editor hiện tại (${currentDocTitle})`,
                'sql'
            );
            showToast('Đang so sánh giữa bản ghi lịch sử và Editor hiện tại');
        } else {
            showToast('Tính năng Diff View chưa sẵn sàng');
        }
    }

    async function applyEntryToEditor(entry) {
        const sql = await ensureEntrySql(entry);
        const ed = (typeof window.getActiveAppEditor === 'function')
            ? window.getActiveAppEditor()
            : window.AppEditor;
        if (ed) {
            if (typeof ed.replaceContentWithUndo === 'function') {
                ed.replaceContentWithUndo(sql);
            } else if (ed.rawEditor && typeof ed.rawEditor.getModel === 'function' && ed.rawEditor.getModel()) {
                const model = ed.rawEditor.getModel();
                const fullRange = model.getFullModelRange();
                ed.rawEditor.pushUndoStop();
                ed.rawEditor.executeEdits('history-restore', [{
                    range: fullRange,
                    text: sql || '',
                    forceMoveMarkers: true
                }]);
                ed.rawEditor.pushUndoStop();
                ed.rawEditor.focus();
            } else if (window.AppEditor && typeof window.AppEditor.setValue === 'function') {
                window.AppEditor.setValue(sql);
            }
            showToast('Đã khôi phục câu lệnh SQL vào Text Editor (Ctrl+Z để hoàn tác)');
        }
    }

    async function copyEntrySql(entry) {
        const sql = await ensureEntrySql(entry);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(sql).then(() => {
                showToast('Đã sao chép SQL vào clipboard!');
            }).catch(() => {
                fallbackCopy(sql);
            });
        } else {
            fallbackCopy(sql);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('Đã sao chép SQL vào clipboard!');
        } catch (_) {}
        document.body.removeChild(ta);
    }

    function showEmptyState(msgHtml) {
        if (!entriesContainerEl) return;
        entriesContainerEl.innerHTML = `
            <div class="fhs-empty-state">
                <i class="fa-solid fa-file-waveform"></i>
                <p>${msgHtml}</p>
            </div>
        `;
    }

    function formatTimeAgo(ts) {
        if (!ts) return '';
        const timeMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
        const diffMs = Date.now() - timeMs;
        const mins = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (mins < 1) return 'vừa xong';
        if (mins < 60) return `${mins}m trước`;
        if (hours < 24) return `${hours}h trước`;
        if (days < 7) return `${days}d trước`;
        const d = new Date(timeMs);
        return `${d.getDate()}/${d.getMonth() + 1}`;
    }

    function formatExactTime(ts) {
        if (!ts) return '';
        const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function showToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else {
            console.log('[FileHistorySidebar]', msg);
        }
    }

    // Auto-init on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init,
        toggle,
        open,
        close,
        onTabChanged,
        onAllTabsClosed,
        onExecutionLogged: (docId) => {
            if (isOpen && docId === currentDocId) {
                loadEntries(docId, false);
            }
        },
        isOpen: () => isOpen,
        getCurrentDocId: () => currentDocId
    };
})();
