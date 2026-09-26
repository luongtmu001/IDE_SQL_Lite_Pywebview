// SQL Trace Profiler Controller
// Manages Virtual Scrolling Grid (Tabulator), CodeMirror SQL viewer,
// In-Memory Filter Engine, Ring Buffer pruning, and IPC bridge.

(function (global) {
    'use strict';

    const MAX_ROWS = 15000;
    let table = null;
    let cmEditor = null;

    let isRunning = false;
    let isPaused = false;
    let autoScroll = true;
    let currentSessionId = null;

    let activeFilterRules = [];
    let allCapturedEvents = []; // in-memory full ring buffer
    let eventRateCounter = 0;
    let lastRateTime = Date.now();

    // ── Themed Popup Alert Helper ─────────────────────────────────────────────
    function showProfilerAlert(title, message, isError = false) {
        const backdrop = document.getElementById('profilerPopupBackdrop');
        const titleEl = document.getElementById('profilerPopupTitle');
        const msgEl = document.getElementById('profilerPopupMessage');
        const okBtn = document.getElementById('profilerPopupOkBtn');
        const closeBtn = document.getElementById('profilerPopupCloseBtn');

        if (!backdrop || !msgEl) {
            alert(message);
            return;
        }

        if (titleEl) {
            const iconClass = isError ? 'fa-solid fa-circle-exclamation text-danger me-2' : 'fa-solid fa-circle-info text-info me-2';
            titleEl.innerHTML = `<i class="${iconClass}"></i><span>${title || (isError ? 'Lỗi' : 'Thông báo')}</span>`;
        }
        msgEl.textContent = message;
        backdrop.classList.remove('d-none');

        const closePopup = () => {
            backdrop.classList.add('d-none');
            okBtn?.removeEventListener('click', closePopup);
            closeBtn?.removeEventListener('click', closePopup);
        };

        okBtn?.addEventListener('click', closePopup, { once: true });
        closeBtn?.addEventListener('click', closePopup, { once: true });
    }

    // ── 1. Initialization ─────────────────────────────────────────────────────
    async function initProfiler() {
        initCodeMirror();
        initTabulator();
        initSplitter();
        initEventHandlers();
        await loadConnections();

        // Rate measurement interval (every 1s)
        setInterval(updateThroughputRate, 1000);

        // Listen for IDE theme changes
        document.addEventListener('ide-theme-changed', (e) => {
            const themeName = e.detail?.theme || document.documentElement.getAttribute('data-bs-theme') || 'dark';
            const isDark = (themeName !== 'light' && themeName !== 'win-nt' && themeName !== 'win-xp');
            if (cmEditor) {
                cmEditor.setOption('theme', isDark ? 'darcula' : 'default');
                cmEditor.refresh();
            }
        });
    }

    // ── 2. CodeMirror Detail View ─────────────────────────────────────────────
    function initCodeMirror() {
        const textarea = document.getElementById('detailSqlTextarea');
        if (!textarea) return;

        const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        const cmTheme = (currentTheme === 'light' || currentTheme === 'win-nt' || currentTheme === 'win-xp')
            ? 'default' : 'darcula';

        cmEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'text/x-sql',
            theme: cmTheme,
            lineNumbers: true,
            readOnly: true,
            lineWrapping: true
        });
        cmEditor.setValue('-- Chọn một dòng ở bảng phía trên để xem câu lệnh SQL đầy đủ...');
        window.AppEditor = cmEditor;

        setTimeout(() => {
            if (cmEditor) cmEditor.refresh();
        }, 150);
    }

    // ── 3. Tabulator Virtual Grid ─────────────────────────────────────────────
    function initTabulator() {
        table = new Tabulator('#traceTable', {
            height: '100%',
            renderVertical: 'virtual',
            layout: 'fitColumns',
            data: [],
            index: 'id',
            placeholder: 'Chưa có sự kiện nào. Hãy chọn kết nối và nhấn "Bắt đầu" để ghi nhận trace.',
            columns: [
                { title: 'ID', field: 'id', width: 75, sorter: 'number', hozAlign: 'right' },
                { title: 'Time', field: 'time', width: 90, hozAlign: 'center' },
                {
                    title: 'Event',
                    field: 'event',
                    width: 170,
                    formatter: cell => {
                        const val = cell.getValue() || '';
                        let colorClass = 'text-muted';
                        if (val.includes('statement')) colorClass = 'text-info';
                        else if (val.includes('rpc') || val.includes('EXECUTE')) colorClass = 'text-warning';
                        else if (val.includes('COMMAND')) colorClass = 'text-success';
                        return `<span class="${colorClass} fw-semibold">${val}</span>`;
                    }
                },
                { title: 'SPID', field: 'spid', width: 75, sorter: 'number', hozAlign: 'center' },
                { title: 'Database', field: 'db', width: 130 },
                { title: 'App Name', field: 'app', width: 140 },
                {
                    title: 'Duration (ms)',
                    field: 'duration',
                    width: 110,
                    sorter: 'number',
                    hozAlign: 'right',
                    formatter: cell => {
                        const val = Number(cell.getValue()) || 0;
                        let color = '#4ec9b0'; // Teal (<50ms)
                        if (val >= 500) color = '#f14c4c'; // Red (>500ms)
                        else if (val >= 100) color = '#cca700'; // Yellow/Orange (>100ms)
                        return `<span style="color:${color}; font-weight:700;">${val.toFixed(2)}</span>`;
                    }
                },
                {
                    title: 'SQL Statement',
                    field: 'sql',
                    formatter: cell => {
                        const val = cell.getValue() || '';
                        return `<span class="text-truncate">${val.replace(/[\r\n]+/g, ' ')}</span>`;
                    }
                }
            ]
        });

        // Row Click: View SQL in Detail Pane
        table.on('rowClick', function (e, row) {
            const data = row.getData();
            if (!data) return;

            document.getElementById('detailTitle').textContent = `Query Text Detail (ID: ${data.id})`;
            document.getElementById('detailSubInfo').textContent = `SPID: ${data.spid} | DB: ${data.db} | App: ${data.app} | Duration: ${data.duration} ms`;

            if (cmEditor) {
                cmEditor.setValue(data.sql || '-- Không có nội dung SQL');
                cmEditor.refresh();
            }
        });
    }

    // ── 4. Batch Ingestion from Python (Dual-Trigger Pipeline) ────────────────
    global.ingestTraceBatch = function (batch) {
        if (!batch || !batch.length || isPaused) return;

        eventRateCounter += batch.length;
        allCapturedEvents.push(...batch);

        table.addData(batch, false).then(() => {
            const count = table.getDataCount('active');
            updateEventCounter(count);

            if (autoScroll && batch.length) {
                const lastItem = batch[batch.length - 1];
                table.scrollToRow(lastItem.id, 'bottom', false).catch(() => { });
            }

            // Ring Buffer Pruning: cut oldest records if count > MAX_ROWS
            if (count > MAX_ROWS) {
                const pruneCount = count - MAX_ROWS;
                const currentData = table.getData();
                const idsToDelete = currentData.slice(0, pruneCount).map(r => r.id);
                table.deleteRow(idsToDelete);

                if (allCapturedEvents.length > MAX_ROWS) {
                    allCapturedEvents.splice(0, pruneCount);
                }
            }
        }).catch(err => {
            console.warn('[Profiler] addData error:', err);
        });
    };

    function updateEventCounter(count) {
        const textEl = document.getElementById('counterText');
        if (textEl) textEl.textContent = `Events: ${count.toLocaleString()}`;
    }

    function updateThroughputRate() {
        const now = Date.now();
        const elapsedSec = (now - lastRateTime) / 1000.0;
        if (elapsedSec >= 0.8) {
            const rate = Math.round(eventRateCounter / elapsedSec);
            const rateEl = document.getElementById('rateText');
            if (rateEl) {
                rateEl.textContent = `(${rate} ev/s)`;
            }
            eventRateCounter = 0;
            lastRateTime = now;
        }
    }

    // ── 5. Connection Manager Integration ─────────────────────────────────────
    async function loadConnections() {
        const select = document.getElementById('profConnSelect');
        if (!select) return;

        select.innerHTML = '<option value="">-- Chọn kết nối (SQL Server / PostgreSQL) --</option>';

        try {
            let conns = [];
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.profiler_list_connections === 'function') {
                const res = await window.pywebview.api.profiler_list_connections();
                if (res && res.success) conns = res.connections || [];
            } else if (window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
                conns = await window.AppStorage.getSavedConnections();
            }

            conns.forEach(c => {
                if (!c || c.type === 'group_marker' || String(c.name || '').startsWith('__group__')) return;
                const type = (c.type || '').toLowerCase();
                const isSupported = type.includes('sql') || type.includes('postgre') || type.includes('mssql');
                if (isSupported) {
                    const opt = document.createElement('option');
                    opt.value = c.id || c.name;
                    opt.textContent = `${c.name || 'Connection'} [${type.toUpperCase()}] (${c.server || c.host || 'local'})`;
                    opt.dataset.type = type;
                    opt.dataset.name = c.name;
                    select.appendChild(opt);
                }
            });

            select.onchange = () => {
                const selectedOpt = select.selectedOptions[0];
                const badge = document.getElementById('profEngineBadge');
                if (selectedOpt && selectedOpt.dataset.type) {
                    const t = selectedOpt.dataset.type;
                    badge.textContent = t.includes('post') ? 'POSTGRESQL' : 'SQL SERVER';
                    badge.className = `badge engine-badge ${t.includes('post') ? 'postgres' : 'mssql'}`;
                } else {
                    badge.textContent = 'Chưa chọn';
                    badge.className = 'badge engine-badge bg-secondary';
                }
            };
        } catch (e) {
            console.error('[Profiler] loadConnections error:', e);
        }
    }

    // Called when window opened with a pre-selected connection ID
    global.onProfilerInitConn = function (connId) {
        const select = document.getElementById('profConnSelect');
        if (select && connId) {
            select.value = connId;
            if (select.onchange) select.onchange();
        }
    };

    // ── 6. Toolbar Actions (Start / Pause / Stop / Clear) ─────────────────────
    async function startTrace() {
        const select = document.getElementById('profConnSelect');
        const connId = select ? select.value : '';

        if (!connId) {
            showProfilerAlert('Chưa chọn kết nối', 'Vui lòng chọn một kết nối SQL Server hoặc PostgreSQL trước khi bắt đầu!', true);
            return;
        }

        updateStatusMessage('Đang khởi tạo phiên giám sát trên máy chủ database...');
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.profiler_start_trace === 'function') {
                const res = await window.pywebview.api.profiler_start_trace(connId);
                if (res && res.success) {
                    isRunning = true;
                    isPaused = false;
                    currentSessionId = res.session_id;

                    updateControlButtons();
                    updateStatusIndicator('running');
                    updateStatusMessage(`Đang giám sát thời gian thực [${res.db_type.toUpperCase()}]. Đã kích hoạt session ${res.session_id}.`);
                    return;
                } else {
                    showProfilerAlert('Lỗi khởi động Profiler', 'Không thể bắt đầu Profiler: ' + (res?.error || 'Lỗi không xác định'), true);
                    updateStatusMessage('Khởi động thất bại: ' + (res?.error || ''));
                }
            }
        } catch (e) {
            console.error('[Profiler] startTrace error:', e);
            showProfilerAlert('Lỗi kết nối', 'Lỗi: ' + e.message, true);
            updateStatusMessage('Lỗi: ' + e.message);
        }
    }

    async function pauseTrace() {
        if (!currentSessionId) return;

        isPaused = !isPaused;
        const btn = document.getElementById('btnPause');
        if (btn) {
            btn.innerHTML = isPaused ? '<i class="fa-solid fa-play"></i> Tiếp tục' : '<i class="fa-solid fa-pause"></i> Tạm dừng';
            btn.classList.toggle('btn-warning', isPaused);
            btn.classList.toggle('btn-outline-warning', !isPaused);
        }

        updateStatusIndicator(isPaused ? 'paused' : 'running');
        updateStatusMessage(isPaused ? 'Đã tạm dừng thu thập dữ liệu.' : 'Đang tiếp tục thu thập dữ liệu...');

        try {
            if (window.pywebview && window.pywebview.api) {
                if (isPaused) await window.pywebview.api.profiler_pause_trace(currentSessionId);
                else await window.pywebview.api.profiler_resume_trace(currentSessionId);
            }
        } catch (e) {
            console.warn('[Profiler] pause/resume IPC error:', e);
        }
    }

    async function stopTrace() {
        if (!currentSessionId) return;

        updateStatusMessage('Đang dừng và giải phóng phiên giám sát trên server...');
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.profiler_stop_trace === 'function') {
                await window.pywebview.api.profiler_stop_trace(currentSessionId);
            }
        } catch (e) {
            console.warn('[Profiler] stopTrace error:', e);
        } finally {
            isRunning = false;
            isPaused = false;
            currentSessionId = null;
            updateControlButtons();
            updateStatusIndicator('stopped');
            updateStatusMessage('Phiên giám sát đã dừng. Tài nguyên trên máy chủ đã được thu hồi.');
        }
    }

    function clearTrace() {
        if (table) table.clearData();
        allCapturedEvents = [];
        updateEventCounter(0);
        if (cmEditor) cmEditor.setValue('-- Chọn một dòng ở bảng phía trên để xem câu lệnh SQL đầy đủ...');
        document.getElementById('detailTitle').textContent = 'Query Text Detail';
        document.getElementById('detailSubInfo').textContent = 'Chọn một dòng ở bảng phía trên để xem câu lệnh SQL đầy đủ';
        updateStatusMessage('Đã xóa trắng bảng dữ liệu.');
    }

    function updateControlButtons() {
        const btnStart = document.getElementById('btnStart');
        const btnPause = document.getElementById('btnPause');
        const btnStop = document.getElementById('btnStop');
        const select = document.getElementById('profConnSelect');

        if (btnStart) btnStart.disabled = isRunning;
        if (btnPause) {
            btnPause.disabled = !isRunning;
            btnPause.innerHTML = '<i class="fa-solid fa-pause"></i> Tạm dừng';
            btnPause.className = 'btn btn-sm btn-outline-warning';
        }
        if (btnStop) btnStop.disabled = !isRunning;
        if (select) select.disabled = isRunning;
    }

    function updateStatusIndicator(state) {
        const ind = document.getElementById('statusIndicator');
        if (!ind) return;
        ind.className = `pulse-indicator pulse-${state}`;
    }

    function updateStatusMessage(msg) {
        const el = document.getElementById('statusMessage');
        if (el) el.textContent = msg;
    }

    // ── 7. Filter & In-Memory Filtering (Popup Modal & Expand Summary) ───────
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function openFilterModal() {
        const modal = document.getElementById('filterModalBackdrop');
        if (modal) {
            modal.classList.remove('d-none');
            renderAllFilterViews();
            setTimeout(() => {
                document.getElementById('filterValue')?.focus();
            }, 50);
        }
    }

    function closeFilterModal() {
        const modal = document.getElementById('filterModalBackdrop');
        if (modal) {
            modal.classList.add('d-none');
        }
    }

    function toggleFilterExpand() {
        const panel = document.getElementById('filterExpandablePanel');
        const chevron = document.getElementById('filterExpandChevron');
        const toggleText = document.getElementById('expandToggleText');
        if (!panel) return;

        const isHidden = panel.classList.contains('d-none');
        if (isHidden) {
            panel.classList.remove('d-none');
            if (chevron) chevron.classList.add('expanded');
            if (toggleText) toggleText.textContent = 'Thu gọn <';
        } else {
            panel.classList.add('d-none');
            if (chevron) chevron.classList.remove('expanded');
            if (toggleText) toggleText.textContent = 'Expand >';
        }

        if (table) table.redraw();
    }

    function addFilterRule() {
        const fieldEl = document.getElementById('filterField');
        const opEl = document.getElementById('filterOperator');
        const input = document.getElementById('filterValue');
        if (!fieldEl || !opEl || !input) return;

        const field = fieldEl.value;
        const op = opEl.value;
        let val = (input.value || '').trim();

        if (!val) {
            input.focus();
            return;
        }
        if (field === 'duration' || field === 'spid') {
            val = Number(val) || 0;
        }

        activeFilterRules.push({ field, type: op, value: val });
        input.value = '';
        renderAllFilterViews();
        applyFilterRules();
        input.focus();
    }

    function removeFilterRule(idx) {
        activeFilterRules.splice(idx, 1);
        renderAllFilterViews();
        applyFilterRules();
    }

    function resetAllFilters() {
        activeFilterRules = [];
        renderAllFilterViews();
        applyFilterRules();
    }

    function renderAllFilterViews() {
        const count = activeFilterRules.length;

        // 1. Toolbar Badge
        const toolbarBadge = document.getElementById('filterCountBadge');
        const filterBtn = document.getElementById('btnFilterToggle');
        if (toolbarBadge) {
            toolbarBadge.textContent = count;
            toolbarBadge.classList.toggle('d-none', count === 0);
        }
        if (filterBtn) {
            filterBtn.classList.toggle('has-filters', count > 0);
        }

        // 2. Summary Bar Counter Badge
        const summaryBadge = document.getElementById('activeFilterCounterBadge');
        if (summaryBadge) {
            summaryBadge.textContent = count;
            summaryBadge.className = count > 0 ? 'badge bg-primary ms-1' : 'badge bg-secondary ms-1';
        }

        // 3. Active Chips in Summary Bar (Phần 3)
        const chipsContainer = document.getElementById('activeFilterChips');
        if (chipsContainer) {
            if (count === 0) {
                chipsContainer.innerHTML = '<span class="text-muted small empty-filter-hint">Chưa áp dụng bộ lọc nào. Toàn bộ sự kiện đang được hiển thị.</span>';
            } else {
                chipsContainer.innerHTML = activeFilterRules.map((rule, idx) => {
                    const label = escapeHtml(rule.field);
                    const op = escapeHtml(rule.type);
                    const val = escapeHtml(String(rule.value));
                    return `<span class="filter-chip" title="${label} ${op} ${val}">` +
                        `<span class="chip-label">${label}</span> ` +
                        `<span class="chip-op">${op}</span> ` +
                        `<span class="chip-val">${val}</span>` +
                        `<i class="fa-solid fa-xmark chip-remove" onclick="window.removeFilterRuleItem(${idx})" title="Xóa điều kiện này"></i>` +
                        `</span>`;
                }).join('');
            }
        }

        // 4. Expanded Detail Table Body (Phần 3 chi tiết)
        const detailTbody = document.getElementById('filterRulesDetailBody');
        if (detailTbody) {
            if (count === 0) {
                detailTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">Chưa áp dụng bộ lọc nào.</td></tr>';
            } else {
                detailTbody.innerHTML = activeFilterRules.map((rule, idx) => `
                    <tr>
                        <td><span class="text-info fw-semibold">${escapeHtml(rule.field)}</span></td>
                        <td><code>${escapeHtml(rule.type)}</code></td>
                        <td><b>${escapeHtml(String(rule.value))}</b></td>
                        <td style="text-align: center;">
                            <button type="button" class="btn btn-xs btn-outline-danger" onclick="window.removeFilterRuleItem(${idx})" title="Xóa luật này">
                                <i class="fa-solid fa-xmark"></i> Xóa
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // 5. Modal Table Body (Phần 2)
        const modalTbody = document.getElementById('filterRulesModalBody');
        if (modalTbody) {
            if (count === 0) {
                modalTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Chưa áp dụng bộ lọc nào. Toàn bộ câu lệnh sẽ được hiển thị.</td></tr>';
            } else {
                modalTbody.innerHTML = activeFilterRules.map((rule, idx) => `
                    <tr>
                        <td><span class="text-info fw-semibold">${escapeHtml(rule.field)}</span></td>
                        <td><code>${escapeHtml(rule.type)}</code></td>
                        <td><b>${escapeHtml(String(rule.value))}</b></td>
                        <td style="text-align: center;">
                            <button type="button" class="btn btn-xs btn-outline-danger" onclick="window.removeFilterRuleItem(${idx})" title="Xóa luật này">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // 6. Sync Preset Buttons
        syncPresetButtonsState();
    }

    global.removeFilterRuleItem = removeFilterRule;

    function syncPresetButtonsState() {
        const slowBtn = document.getElementById('presetSlowQueriesBtn');
        if (slowBtn) {
            const isSlow = activeFilterRules.some(r => r.field === 'duration' && r.type === '>=' && Number(r.value) === 100);
            slowBtn.classList.toggle('active', isSlow);
        }

        const errBtn = document.getElementById('presetErrorsBtn');
        if (errBtn) {
            const isErr = activeFilterRules.some(r => r.field === 'sql' && r.type === 'like' && String(r.value).toUpperCase() === 'ROLLBACK');
            errBtn.classList.toggle('active', isErr);
        }

        const sysBtn = document.getElementById('presetExcludeSysBtn');
        if (sysBtn) {
            const isSys = activeFilterRules.some(r => r.field === 'sql' && r.type === 'not_like' && String(r.value).includes('sys.'));
            sysBtn.classList.toggle('active', isSys);
        }
    }

    function applyFilterRules() {
        if (!table) return;
        table.clearFilter();

        const tabulatorFilters = [];

        // 1. Structured rules
        activeFilterRules.forEach(r => {
            if (r.type === 'like') {
                tabulatorFilters.push({ field: r.field, type: 'like', value: r.value });
            } else if (r.type === 'not_like') {
                tabulatorFilters.push((data) => {
                    const str = String(data[r.field] || '').toLowerCase();
                    return !str.includes(String(r.value).toLowerCase());
                });
            } else if (r.type === 'starts') {
                tabulatorFilters.push((data) => {
                    const str = String(data[r.field] || '').toLowerCase();
                    return str.startsWith(String(r.value).toLowerCase());
                });
            } else {
                tabulatorFilters.push({ field: r.field, type: r.type, value: r.value });
            }
        });

        // 2. Quick search box filter
        const quickVal = (document.getElementById('quickSearchInput')?.value || '').trim().toLowerCase();
        if (quickVal) {
            tabulatorFilters.push((data) => {
                return String(data.sql || '').toLowerCase().includes(quickVal) ||
                    String(data.app || '').toLowerCase().includes(quickVal) ||
                    String(data.db || '').toLowerCase().includes(quickVal) ||
                    String(data.spid || '').includes(quickVal);
            });
        }

        if (tabulatorFilters.length > 0) {
            table.setFilter(tabulatorFilters);
        }
    }

    // Presets (Phần 1: Nhóm lọc nhanh)
    function setupFilterPresets() {
        const slowBtn = document.getElementById('presetSlowQueriesBtn');
        if (slowBtn) {
            slowBtn.onclick = () => {
                const idx = activeFilterRules.findIndex(r => r.field === 'duration' && r.type === '>=' && Number(r.value) === 100);
                if (idx >= 0) {
                    activeFilterRules.splice(idx, 1);
                } else {
                    activeFilterRules.push({ field: 'duration', type: '>=', value: 100 });
                }
                renderAllFilterViews();
                applyFilterRules();
            };
        }

        const errBtn = document.getElementById('presetErrorsBtn');
        if (errBtn) {
            errBtn.onclick = () => {
                const idx = activeFilterRules.findIndex(r => r.field === 'sql' && r.type === 'like' && String(r.value).toUpperCase() === 'ROLLBACK');
                if (idx >= 0) {
                    activeFilterRules.splice(idx, 1);
                } else {
                    activeFilterRules.push({ field: 'sql', type: 'like', value: 'ROLLBACK' });
                }
                renderAllFilterViews();
                applyFilterRules();
            };
        }

        const sysBtn = document.getElementById('presetExcludeSysBtn');
        if (sysBtn) {
            sysBtn.onclick = () => {
                const hasSys = activeFilterRules.some(r => r.field === 'sql' && r.type === 'not_like' && String(r.value).includes('sys.'));
                if (hasSys) {
                    activeFilterRules = activeFilterRules.filter(r => !(r.field === 'sql' && r.type === 'not_like' && (r.value === 'sys.' || r.value === 'INFORMATION_SCHEMA' || r.value === 'pg_catalog')));
                } else {
                    activeFilterRules.push({ field: 'sql', type: 'not_like', value: 'sys.' });
                    activeFilterRules.push({ field: 'sql', type: 'not_like', value: 'INFORMATION_SCHEMA' });
                    activeFilterRules.push({ field: 'sql', type: 'not_like', value: 'pg_catalog' });
                }
                renderAllFilterViews();
                applyFilterRules();
            };
        }
    }

    // ── 8. Draggable Splitter Bar ─────────────────────────────────────────────
    function initSplitter() {
        const splitter = document.getElementById('splitterBar');
        const gridContainer = document.getElementById('gridContainer');
        const main = document.getElementById('profilerMain');
        if (!splitter || !gridContainer || !main) return;

        let isDragging = false;

        splitter.addEventListener('mousedown', (e) => {
            isDragging = true;
            splitter.classList.add('active');
            document.body.style.cursor = 'row-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const mainRect = main.getBoundingClientRect();
            const offsetTop = e.clientY - mainRect.top;
            const percentage = (offsetTop / mainRect.height) * 100;

            if (percentage >= 20 && percentage <= 85) {
                gridContainer.style.height = `${percentage}%`;
                if (table) table.redraw();
                if (cmEditor) cmEditor.refresh();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                splitter.classList.remove('active');
                document.body.style.cursor = '';
                if (table) table.redraw();
                if (cmEditor) cmEditor.refresh();
            }
        });
    }

    // ── 9. Export Trace Data ──────────────────────────────────────────────────
    function exportJson() {
        const data = table ? table.getData('active') : allCapturedEvents;
        const str = JSON.stringify(data, null, 2);
        downloadFile(str, `trace_export_${Date.now()}.json`, 'application/json');
    }

    function exportCsv() {
        if (table) {
            table.download('csv', `trace_export_${Date.now()}.csv`);
        }
    }

    function downloadFile(content, fileName, contentType) {
        const a = document.createElement('a');
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // ── 10. Event Handlers Registration ───────────────────────────────────────
    function initEventHandlers() {
        // Start / Pause / Stop / Clear
        document.getElementById('btnStart')?.addEventListener('click', startTrace);
        document.getElementById('btnPause')?.addEventListener('click', pauseTrace);
        document.getElementById('btnStop')?.addEventListener('click', stopTrace);
        document.getElementById('btnClear')?.addEventListener('click', clearTrace);

        // Auto-Scroll Toggle
        const scrollBtn = document.getElementById('btnAutoScroll');
        if (scrollBtn) {
            scrollBtn.addEventListener('click', () => {
                autoScroll = !autoScroll;
                scrollBtn.innerHTML = `<i class="fa-solid fa-arrows-down-to-line me-1"></i> Auto-Scroll: ${autoScroll ? 'BẬT' : 'TẮT'}`;
                scrollBtn.classList.toggle('active', autoScroll);
            });
        }

        // Filter Modal (Phần 2)
        document.getElementById('btnFilterToggle')?.addEventListener('click', openFilterModal);
        document.getElementById('btnOpenFilterModalFromSummary')?.addEventListener('click', openFilterModal);
        document.getElementById('closeFilterModalBtn')?.addEventListener('click', closeFilterModal);
        document.getElementById('cancelFilterModalBtn')?.addEventListener('click', closeFilterModal);
        document.getElementById('applyFilterModalBtn')?.addEventListener('click', closeFilterModal);

        // Close modal when clicking backdrop outside card
        document.getElementById('filterModalBackdrop')?.addEventListener('click', (e) => {
            if (e.target.id === 'filterModalBackdrop') {
                closeFilterModal();
            }
        });

        // Close modal on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.getElementById('filterModalBackdrop');
                if (modal && !modal.classList.contains('d-none')) {
                    closeFilterModal();
                }
            }
        });

        // Filter rules controls
        document.getElementById('addFilterRuleBtn')?.addEventListener('click', addFilterRule);
        document.getElementById('filterValue')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addFilterRule();
            }
        });
        document.getElementById('resetFiltersModalBtn')?.addEventListener('click', resetAllFilters);
        document.getElementById('btnClearAllFiltersSummary')?.addEventListener('click', resetAllFilters);

        // Filter Expand Toggle (Phần 3)
        document.getElementById('btnToggleFilterExpand')?.addEventListener('click', toggleFilterExpand);

        // Presets (Phần 1)
        setupFilterPresets();

        // Quick Search Input
        const searchInput = document.getElementById('quickSearchInput');
        const clearSearchBtn = document.getElementById('quickSearchClearBtn');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                if (clearSearchBtn) clearSearchBtn.classList.toggle('d-none', !searchInput.value);
                applyFilterRules();
            });
        }
        if (clearSearchBtn && searchInput) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearSearchBtn.classList.add('d-none');
                applyFilterRules();
            });
        }

        // Export Dropdown
        document.getElementById('exportJsonBtn')?.addEventListener('click', exportJson);
        document.getElementById('exportCsvBtn')?.addEventListener('click', exportCsv);

        // Detail Actions: Format & Copy SQL
        document.getElementById('copySqlBtn')?.addEventListener('click', () => {
            if (!cmEditor) return;
            const sql = cmEditor.getValue();
            navigator.clipboard.writeText(sql).then(() => {
                showProfilerAlert('Thành công', '✓ Đã sao chép câu lệnh SQL vào clipboard!', false);
            }).catch(() => {
                showProfilerAlert('Thất bại', 'Không thể sao chép vào clipboard.', true);
            });
        });

        document.getElementById('formatSqlBtn')?.addEventListener('click', () => {
            if (!cmEditor) return;
            let sql = cmEditor.getValue();
            if (!sql || sql.startsWith('--')) return;

            // Simple beautifier: uppercase key keywords and clean extra spacing
            const keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'ORDER BY', 'GROUP BY', 'HAVING', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM'];
            keywords.forEach(k => {
                const regex = new RegExp(`\\b${k}\\b`, 'gi');
                sql = sql.replace(regex, k);
            });
            cmEditor.setValue(sql);
        });

        // Window closing safety hook
        window.addEventListener('beforeunload', () => {
            if (isRunning && currentSessionId) {
                stopTrace();
            }
        });
    }

    // Auto-run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initProfiler);
    } else {
        initProfiler();
    }

})(window);
