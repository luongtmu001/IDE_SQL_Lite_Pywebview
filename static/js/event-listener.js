/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PostgreSQL Event Listener — Frontend Controller
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles:
 *   1. Connection Wizard Modal (3 tabs: Local/Backend/Platform)
 *   2. Tabulator event grid with header filters
 *   3. Detail pane with tabs (Detail / Payload / Log)
 *   4. Filter presets and quick search
 *   5. Splitter drag-resize
 *   6. Auto-scroll, export, and UI state management
 */

(function () {
    'use strict';

    // ═══ State ═══
    let eventTable = null;       // Tabulator instance
    let eventData = [];          // In-memory event buffer
    let autoScroll = true;
    let isListening = false;
    let isPaused = false;
    let listenerState = 'STOPPED'; // CONNECTING | CONNECTED | LISTENING | DISCONNECTED | RECONNECTING | ERROR | STOPPED
    let eventCounter = 0;
    let rateCounter = 0;
    let rateInterval = null;
    let selectedEvent = null;
    let activeFilters = {};      // preset filter states
    const MAX_EVENTS = 10000;
    const LOG_MAX = 500;

    // ═══ DOM References ═══
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ═══ Tabulator Grid Setup ═══
    function initGrid() {
        eventTable = new Tabulator('#eventTable', {
            data: eventData,
            layout: 'fitColumns',
            height: '100%',
            placeholder: '<div style="padding:40px;text-align:center;color:var(--ide-text-dim,#5a6068);font-size:13px;">' +
                '<i class="fa-solid fa-tower-broadcast" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3;"></i>' +
                'Chưa có sự kiện nào. Kết nối và nhấn "Lắng nghe" để bắt đầu theo dõi.</div>',
            selectable: 1,
            reactiveData: false,
            movableColumns: true,
            resizableColumns: true,
            headerSort: true,
            virtualDom: true,
            virtualDomBuffer: 300,
            columns: [
                {
                    title: '#', field: 'row_num', width: 50, hozAlign: 'center',
                    headerSort: false, frozen: true,
                    formatter: function (cell) { return cell.getRow().getPosition(true) + 1; }
                },
                {
                    title: 'Timestamp', field: 'timestamp', width: 160,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc thời gian...',
                    formatter: function (cell) {
                        var v = cell.getValue();
                        if (!v) return '';
                        try {
                            var d = new Date(v);
                            return d.toLocaleString('vi-VN', { hour12: false });
                        } catch (e) { return v; }
                    }
                },
                {
                    title: 'Source', field: 'source_type', width: 110,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc nguồn...',
                    formatter: function (cell) {
                        var v = (cell.getValue() || '').toUpperCase();
                        var iconClass = 'src-icon ';
                        if (v.includes('POSTGRES')) iconClass += 'src-postgresql';
                        else if (v.includes('BACKEND')) iconClass += 'src-backend';
                        else if (v.includes('REDIS')) iconClass += 'src-redis';
                        return '<i class="fa-solid fa-circle ' + iconClass + '"></i>' + (cell.getValue() || '—');
                    }
                },
                {
                    title: 'Event Type', field: 'event_type', width: 130,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc loại...',
                    formatter: function (cell) {
                        var v = (cell.getValue() || '').toUpperCase();
                        var cls = 'et-badge ';
                        if (v.includes('DATABASE')) cls += 'et-database';
                        else if (v.includes('APPLICATION')) cls += 'et-application';
                        else if (v.includes('BACKEND')) cls += 'et-backend';
                        else if (v.includes('REDIS')) cls += 'et-redis';
                        else cls += 'et-system';
                        return '<span class="' + cls + '">' + (cell.getValue() || 'UNKNOWN') + '</span>';
                    }
                },
                {
                    title: 'Database', field: 'database', width: 120,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc DB...'
                },
                {
                    title: 'Schema', field: 'schema', width: 90,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc schema...'
                },
                {
                    title: 'Table', field: 'table', width: 140,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc bảng...',
                    formatter: function (cell) {
                        var v = cell.getValue();
                        return v ? '<span style="color:var(--ide-accent,#CC7832);font-weight:600;">' + v + '</span>' : '—';
                    }
                },
                {
                    title: 'Operation', field: 'operation', width: 100, hozAlign: 'center',
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc thao tác...',
                    formatter: function (cell) {
                        var v = (cell.getValue() || '').toUpperCase();
                        var cls = 'op-badge op-' + v.toLowerCase();
                        return '<span class="' + cls + '">' + v + '</span>';
                    }
                },
                {
                    title: 'Transaction', field: 'transaction_id', width: 100,
                    headerFilter: 'input', headerFilterPlaceholder: 'Lọc TXN...'
                },
                {
                    title: 'Latency', field: 'latency_ms', width: 90, hozAlign: 'right',
                    headerFilter: 'input', headerFilterPlaceholder: 'ms...',
                    formatter: function (cell) {
                        var v = cell.getValue();
                        if (v == null) return '—';
                        var color = v > 100 ? '#ff5c5c' : v > 30 ? '#E8C859' : '#4ec9b0';
                        return '<span style="color:' + color + ';font-weight:500;">' + v + ' ms</span>';
                    }
                }
            ],
            rowClick: function (e, row) {
                selectedEvent = row.getData();
                renderEventDetail(selectedEvent);
            }
        });
    }

    // ═══ Event Detail Rendering ═══
    function renderEventDetail(evt) {
        if (!evt) return;
        $('#detEventId').textContent = evt.event_id || '—';
        $('#detSource').textContent = evt.source || '—';
        $('#detEventType').textContent = evt.event_type || '—';
        $('#detDatabase').textContent = evt.database || '—';
        $('#detSchema').textContent = evt.schema || '—';
        $('#detTable').textContent = evt.table || '—';
        $('#detOperation').textContent = evt.operation || '—';
        $('#detTimestamp').textContent = evt.timestamp || '—';
        $('#detTransactionId').textContent = evt.transaction_id || '—';
        $('#detLSN').textContent = (evt.metadata && evt.metadata.lsn) || '—';

        var latency = evt.latency_ms;
        $('#detLatency').textContent = latency != null ? latency + ' ms' : '—';

        // Metadata
        var meta = evt.metadata || {};
        $('#detMetadata').textContent = JSON.stringify(meta, null, 2);

        // Payload
        var payload = evt.payload || {};
        $('#detPayload').textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    }

    // ═══ Detail Tab Switching ═══
    function initDetailTabs() {
        $$('.el-detail-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = this.getAttribute('data-tab');
                $$('.el-detail-tab').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                $$('.el-modal-tab-content[data-tab-content]').forEach(function (c) { c.classList.remove('active'); });
                var content = $('[data-tab-content="' + target + '"]');
                if (content) content.classList.add('active');
            });
        });
    }

    // ═══ Connection Modal ═══
    function openConnModal() {
        $('#connModalBackdrop').classList.remove('d-none');
    }
    function closeConnModal() {
        $('#connModalBackdrop').classList.add('d-none');
    }

    function initConnModal() {
        // Open triggers
        $('#btnConnect').addEventListener('click', openConnModal);
        $('#elConnStatus').addEventListener('click', openConnModal);
        $('#connModalCloseBtn').addEventListener('click', closeConnModal);
        $('#connModalBackdrop').addEventListener('click', function (e) {
            if (e.target === this) closeConnModal();
        });

        // Tab switching
        $$('.el-modal-tab[data-conn-tab]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = this.getAttribute('data-conn-tab');
                $$('.el-modal-tab[data-conn-tab]').forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                $$('.el-modal-tab-content[data-conn-content]').forEach(function (c) { c.classList.remove('active'); });
                var content = $('[data-conn-content="' + target + '"]');
                if (content) content.classList.add('active');
            });
        });

        // Backend Model radio toggle
        document.querySelectorAll('input[name="backendModel"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                var dual = $('#dualBackendSection');
                if (this.value === 'dual') {
                    dual.style.display = 'block';
                } else {
                    dual.style.display = 'none';
                }
            });
        });

        // Sub-tabs (Bravo Hosting / Import)
        $$('#backendSubTabs .el-sub-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#backendSubTabs .el-sub-tab').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                var target = this.getAttribute('data-sub-tab');
                if (target === 'hosting') {
                    $('#subTabHosting').style.display = 'block';
                    $('#subTabImport').style.display = 'none';
                } else {
                    $('#subTabHosting').style.display = 'none';
                    $('#subTabImport').style.display = 'block';
                }
            });
        });

        // Password toggle buttons
        initPasswordToggle('btnToggleToken', 'backendToken');
        initPasswordToggle('btnToggleRedisPass', 'redisPassword');
        initPasswordToggle('btnTogglePlatformPass', 'platformPassword');

        // Test Connection
        $('#btnTestConn').addEventListener('click', handleTestConnection);

        // Connect Now
        $('#btnConnectNow').addEventListener('click', handleConnect);
    }

    function initPasswordToggle(btnId, inputId) {
        var btn = $('#' + btnId);
        if (!btn) return;
        btn.addEventListener('click', function () {
            var input = $('#' + inputId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                btn.querySelector('i').classList.remove('fa-eye');
                btn.querySelector('i').classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                btn.querySelector('i').classList.remove('fa-eye-slash');
                btn.querySelector('i').classList.add('fa-eye');
            }
        });
    }

    // ═══ Test Connection ═══
    function handleTestConnection() {
        var activeTab = getActiveConnTab();
        var resultsId = activeTab + 'TestResults';
        var resultsEl = $('#' + resultsId);
        if (!resultsEl) return;

        resultsEl.classList.add('show');
        resultsEl.innerHTML = '';

        var steps = [];
        if (activeTab === 'local') {
            steps = ['Backend reachable', 'Event listener supported', 'PostgreSQL event source available'];
        } else if (activeTab === 'backend') {
            steps = ['Backend reachable', 'Authentication successful', 'Event listener supported', 'PostgreSQL event source available'];
        } else {
            steps = ['Platform reachable', 'Authentication successful', 'Application found', 'PostgreSQL access available'];
        }

        // Simulate step-by-step test
        steps.forEach(function (step, i) {
            var div = document.createElement('div');
            div.className = 'el-test-item pending';
            div.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin check-icon"></i><span>' + step + '</span>';
            resultsEl.appendChild(div);

            setTimeout(function () {
                div.className = 'el-test-item success';
                div.innerHTML = '<i class="fa-solid fa-circle-check check-icon"></i><span>✓ ' + step + '</span>';
            }, 600 * (i + 1));
        });

        addLog('INFO', 'Kiểm tra kết nối (' + activeTab + ')...');
    }

    function getActiveConnTab() {
        var active = $('.el-modal-tab.active[data-conn-tab]');
        return active ? active.getAttribute('data-conn-tab') : 'local';
    }

    // ═══ Connect ═══
    function handleConnect() {
        var tab = getActiveConnTab();
        addLog('CONNECT', 'Đang kết nối qua phương thức: ' + tab + '...');
        setListenerState('CONNECTING');

        // Simulate connection
        setTimeout(function () {
            setListenerState('CONNECTED');
            addLog('CONNECT', 'Kết nối thành công.');
            closeConnModal();
            $('#btnStartListen').disabled = false;
            updateConnStatusLabel(tab);
        }, 800);
    }

    function updateConnStatusLabel(tab) {
        var label = 'Đã kết nối';
        if (tab === 'local') label = 'Local Backend';
        else if (tab === 'backend') {
            var host = $('#backendHost').value || '...';
            label = host;
        } else if (tab === 'platform') {
            label = 'Bravo Platform';
        }
        $('#elConnLabel').textContent = label;
    }

    // ═══ Listener State ═══
    function setListenerState(state) {
        listenerState = state;
        var dot = $('#elStatusDot');
        var counterDot = $('#elCounterDot');
        dot.className = 'status-dot ' + state.toLowerCase();
        if (counterDot) counterDot.className = 'status-dot ' + state.toLowerCase();

        // Update status message
        var messages = {
            'CONNECTING': 'Đang kết nối...',
            'CONNECTED': 'Đã kết nối. Nhấn "Lắng nghe" để bắt đầu theo dõi.',
            'LISTENING': 'Đang lắng nghe sự kiện PostgreSQL...',
            'DISCONNECTED': 'Mất kết nối.',
            'RECONNECTING': 'Đang tái kết nối...',
            'ERROR': 'Lỗi kết nối.',
            'STOPPED': 'Đã dừng.'
        };
        $('#elStatusMessage').textContent = messages[state] || 'Sẵn sàng.';
    }

    // ═══ Action Buttons ═══
    function initActions() {
        // Start Listening
        $('#btnStartListen').addEventListener('click', function () {
            isListening = true;
            isPaused = false;
            setListenerState('LISTENING');
            addLog('CONNECT', 'Bắt đầu lắng nghe sự kiện.');
            this.disabled = true;
            $('#btnPause').disabled = false;
            $('#btnStop').disabled = false;

            // Start rate counter
            startRateCounter();

            // Start simulated events for demo
            startDemoEvents();
        });

        // Pause
        $('#btnPause').addEventListener('click', function () {
            isPaused = !isPaused;
            if (isPaused) {
                this.innerHTML = '<i class="fa-solid fa-play"></i> Tiếp tục';
                this.classList.remove('btn-outline-warning');
                this.classList.add('btn-warning');
                addLog('INFO', 'Tạm dừng lắng nghe.');
            } else {
                this.innerHTML = '<i class="fa-solid fa-pause"></i> Tạm dừng';
                this.classList.remove('btn-warning');
                this.classList.add('btn-outline-warning');
                addLog('INFO', 'Tiếp tục lắng nghe.');
            }
        });

        // Stop
        $('#btnStop').addEventListener('click', function () {
            isListening = false;
            isPaused = false;
            setListenerState('STOPPED');
            addLog('DISCONNECT', 'Đã dừng lắng nghe.');
            this.disabled = true;
            $('#btnPause').disabled = true;
            $('#btnPause').innerHTML = '<i class="fa-solid fa-pause"></i> Tạm dừng';
            $('#btnPause').classList.remove('btn-warning');
            $('#btnPause').classList.add('btn-outline-warning');
            $('#btnStartListen').disabled = false;
            stopRateCounter();
            stopDemoEvents();
        });

        // Clear
        $('#btnClear').addEventListener('click', function () {
            eventData.length = 0;
            eventCounter = 0;
            if (eventTable) eventTable.replaceData([]);
            updateCounterText();
            addLog('INFO', 'Đã xóa toàn bộ sự kiện.');
        });

        // Auto-Scroll
        $('#btnAutoScroll').addEventListener('click', function () {
            autoScroll = !autoScroll;
            this.classList.toggle('active', autoScroll);
        });

        // Copy Event
        $('#btnCopyEvent').addEventListener('click', function () {
            if (!selectedEvent) return;
            var text = JSON.stringify(selectedEvent, null, 2);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
            } else if (window.pywebview && window.pywebview.api && window.pywebview.api.clipboard_write) {
                window.pywebview.api.clipboard_write(text);
            }
            addLog('INFO', 'Đã sao chép sự kiện vào clipboard.');
        });
    }

    // ═══ Filter Presets ═══
    function initFilterPresets() {
        $$('.el-preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                this.classList.toggle('active');
                var filterKey = this.getAttribute('data-filter');
                if (this.classList.contains('active')) {
                    activeFilters[filterKey] = true;
                } else {
                    delete activeFilters[filterKey];
                }
                applyFilters();
            });
        });

        // Clear all filters
        $('#btnClearFilters').addEventListener('click', function () {
            activeFilters = {};
            $$('.el-preset-btn').forEach(function (b) { b.classList.remove('active'); });
            applyFilters();
        });
    }

    function applyFilters() {
        if (!eventTable) return;
        var filterKeys = Object.keys(activeFilters);
        if (filterKeys.length === 0) {
            eventTable.clearFilter();
            updateFilterChips([]);
            return;
        }

        eventTable.setFilter(function (data) {
            for (var i = 0; i < filterKeys.length; i++) {
                var key = filterKeys[i];
                if (key === 'database_event' && (data.event_type || '').toUpperCase() !== 'DATABASE_EVENT') return false;
                if (key === 'application_event' && (data.event_type || '').toUpperCase() !== 'APPLICATION_EVENT') return false;
                if (key === 'insert' && (data.operation || '').toUpperCase() !== 'INSERT') return false;
                if (key === 'update' && (data.operation || '').toUpperCase() !== 'UPDATE') return false;
                if (key === 'delete' && (data.operation || '').toUpperCase() !== 'DELETE') return false;
            }
            return true;
        });

        updateFilterChips(filterKeys);
    }

    function updateFilterChips(keys) {
        var container = $('#elFilterChips');
        container.innerHTML = '';
        if (keys.length === 0) {
            container.innerHTML = '<span class="el-empty-filter-hint">Chưa áp dụng bộ lọc nào. Toàn bộ sự kiện đang được hiển thị.</span>';
            return;
        }
        keys.forEach(function (key) {
            var chip = document.createElement('span');
            chip.className = 'el-filter-chip';
            chip.innerHTML =
                '<span class="chip-label">' + key.replace('_', ' ').toUpperCase() + '</span>' +
                '<span class="chip-remove" data-key="' + key + '"><i class="fa-solid fa-xmark"></i></span>';
            chip.querySelector('.chip-remove').addEventListener('click', function () {
                delete activeFilters[key];
                var btn = document.querySelector('.el-preset-btn[data-filter="' + key + '"]');
                if (btn) btn.classList.remove('active');
                applyFilters();
            });
            container.appendChild(chip);
        });
    }

    // ═══ Quick Search ═══
    function initQuickSearch() {
        var searchInput = $('#elQuickSearch');
        var debounceTimer = null;
        searchInput.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            var val = this.value.trim();
            debounceTimer = setTimeout(function () {
                if (!eventTable) return;
                if (!val) {
                    eventTable.clearFilter();
                    return;
                }
                var lower = val.toLowerCase();
                eventTable.setFilter(function (data) {
                    return (data.table || '').toLowerCase().includes(lower) ||
                        (data.database || '').toLowerCase().includes(lower) ||
                        (data.operation || '').toLowerCase().includes(lower) ||
                        (data.schema || '').toLowerCase().includes(lower) ||
                        (data.source || '').toLowerCase().includes(lower) ||
                        (data.event_type || '').toLowerCase().includes(lower) ||
                        String(data.transaction_id || '').includes(lower);
                });
            }, 200);
        });
    }

    // ═══ Splitter Drag ═══
    function initSplitter() {
        var splitter = $('#elSplitter');
        var gridContainer = $('#elGridContainer');
        var detailContainer = $('#elDetail');
        var mainEl = $('#elMain');
        var dragging = false;

        splitter.addEventListener('mousedown', function (e) {
            dragging = true;
            splitter.classList.add('active');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var mainRect = mainEl.getBoundingClientRect();
            var offset = e.clientY - mainRect.top;
            var totalH = mainRect.height - 6; // splitter height
            var gridH = Math.max(80, Math.min(totalH - 100, offset));
            gridContainer.style.height = gridH + 'px';
            gridContainer.style.flex = 'none';
            detailContainer.style.flex = '1';
        });

        document.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            splitter.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    // ═══ Rate Counter ═══
    function startRateCounter() {
        rateCounter = 0;
        if (rateInterval) clearInterval(rateInterval);
        rateInterval = setInterval(function () {
            $('#elRateText').textContent = '(' + rateCounter + ' ev/s)';
            rateCounter = 0;
        }, 1000);
    }
    function stopRateCounter() {
        if (rateInterval) clearInterval(rateInterval);
        rateInterval = null;
        $('#elRateText').textContent = '(0 ev/s)';
    }
    function updateCounterText() {
        $('#elCounterText').textContent = 'Events: ' + eventCounter.toLocaleString();
    }

    // ═══ Log System ═══
    function addLog(level, message) {
        var logList = $('#elLogList');
        var entry = document.createElement('div');
        entry.className = 'el-log-entry';

        var now = new Date();
        var ts = now.toTimeString().split(' ')[0]; // HH:MM:SS

        var levelClass = 'log-info';
        if (level === 'CONNECT' || level === 'AUTHENTICATED' || level === 'LISTENING' || level === 'RECONNECTED') levelClass = 'log-connect';
        else if (level === 'DISCONNECT' || level === 'CONNECTION LOST') levelClass = 'log-disconnect';
        else if (level === 'EVENT' || level === 'EVENT RECEIVED') levelClass = 'log-event';
        else if (level === 'ERROR') levelClass = 'log-error';

        entry.innerHTML =
            '<span class="el-log-ts">' + ts + '</span>' +
            '<span class="el-log-level ' + levelClass + '">' + level + '</span>' +
            '<span class="el-log-msg">' + message + '</span>';

        logList.appendChild(entry);

        // Trim old entries
        while (logList.children.length > LOG_MAX) {
            logList.removeChild(logList.firstChild);
        }

        // Auto-scroll log
        logList.scrollTop = logList.scrollHeight;
    }

    // ═══ Add Event to Grid ═══
    function addEvent(evt) {
        if (isPaused) return;
        if (eventData.length >= MAX_EVENTS) {
            eventData.shift(); // Remove oldest
        }
        eventData.push(evt);
        eventCounter++;
        rateCounter++;

        if (eventTable) {
            eventTable.addRow(evt, false); // Add to bottom
            // Trim Tabulator rows if exceeding max
            var rows = eventTable.getRows();
            if (rows.length > MAX_EVENTS) {
                rows[0].delete();
            }
            if (autoScroll) {
                eventTable.scrollToRow(rows[rows.length - 1], 'bottom', false);
            }
        }

        updateCounterText();
    }

    // ═══ Demo Event Generator (for UI demonstration) ═══
    var demoTimer = null;
    var demoCounter = 0;
    var demoTables = ['B20Customer', 'B20Invoice', 'B20Product', 'B20Order', 'B20Payment', 'B00Param', 'B20Inventory', 'B20Employee'];
    var demoOps = ['INSERT', 'UPDATE', 'DELETE', 'UPDATE', 'UPDATE', 'INSERT']; // weighted toward UPDATE
    var demoSources = ['postgresql', 'backend', 'redis'];
    var demoEventTypes = ['DATABASE_EVENT', 'DATABASE_EVENT', 'APPLICATION_EVENT', 'DATABASE_EVENT', 'BACKEND_EVENT'];
    var demoSchemas = ['public', 'public', 'bravo', 'audit'];

    function generateDemoEvent() {
        demoCounter++;
        var table = demoTables[Math.floor(Math.random() * demoTables.length)];
        var op = demoOps[Math.floor(Math.random() * demoOps.length)];
        var source = demoSources[Math.floor(Math.random() * demoSources.length)];
        var eventType = demoEventTypes[Math.floor(Math.random() * demoEventTypes.length)];
        var schema = demoSchemas[Math.floor(Math.random() * demoSchemas.length)];

        return {
            event_id: crypto.randomUUID ? crypto.randomUUID() : 'evt-' + demoCounter + '-' + Date.now(),
            source: source,
            source_type: source,
            event_type: eventType,
            database: 'BravoDB',
            schema: schema,
            table: table,
            operation: op,
            timestamp: new Date().toISOString(),
            transaction_id: 100000 + Math.floor(Math.random() * 900000),
            latency_ms: Math.floor(Math.random() * 150),
            payload: {
                action: op,
                table: table,
                affected_rows: Math.floor(Math.random() * 5) + 1
            },
            metadata: {
                lsn: '0/' + (Math.floor(Math.random() * 999999999)).toString(16).toUpperCase(),
                consumer: 'ide-listener',
                channel: source === 'redis' ? 'bravo_event' : null
            }
        };
    }

    function startDemoEvents() {
        stopDemoEvents();
        demoTimer = setInterval(function () {
            if (!isListening || isPaused) return;
            var evt = generateDemoEvent();
            addEvent(evt);
        }, 800 + Math.random() * 1200);
    }

    function stopDemoEvents() {
        if (demoTimer) {
            clearInterval(demoTimer);
            demoTimer = null;
        }
    }

    // ═══ Export ═══
    function initExport() {
        $('#exportJsonBtn').addEventListener('click', function (e) {
            e.preventDefault();
            var json = JSON.stringify(eventData, null, 2);
            downloadFile('events.json', json, 'application/json');
        });
        $('#exportCsvBtn').addEventListener('click', function (e) {
            e.preventDefault();
            if (eventTable) {
                eventTable.download('csv', 'events.csv');
            }
        });
    }

    function downloadFile(name, content, type) {
        var blob = new Blob([content], { type: type });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ═══ Keyboard Shortcuts ═══
    function initKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Ctrl+F → focus quick search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                $('#elQuickSearch').focus();
                $('#elQuickSearch').select();
            }
        });
    }

    // ═══ External API for pywebview ═══
    window.onEventListenerInit = function () {
        // Called when window is loaded via pywebview
    };

    // Receive events from Python backend
    window.onEventReceived = function (evt) {
        addEvent(evt);
    };

    window.onBatchEventsReceived = function (events) {
        if (!Array.isArray(events)) return;
        events.forEach(function (evt) { addEvent(evt); });
    };

    // ═══ Init ═══
    document.addEventListener('DOMContentLoaded', function () {
        initGrid();
        initDetailTabs();
        initConnModal();
        initActions();
        initFilterPresets();
        initQuickSearch();
        initSplitter();
        initExport();
        initKeyboard();

        addLog('INFO', 'PostgreSQL Event Listener sẵn sàng.');
    });

})();
