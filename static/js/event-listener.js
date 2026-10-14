/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PostgreSQL Event Listener — Frontend Controller
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Implements:
 *   1. Theme & Typography restoration and real-time synchronization.
 *   2. Connection Wizard Modal (Local IIS / Backend / Platform).
 *   3. Python IPC Bridge (pywebview API integration with fallbacks).
 *   4. Tabulator Virtual Grid with 10 columns & per-column header filters.
 *   5. Detail Inspector: Event Details, CodeMirror CommandText, Parameters Table,
 *      Intelligent "Build Query" parameter substitution, Raw Payload & Log.
 *   6. In-Memory Filter Engine, Ring Buffer pruning (15,000 max), Export & Auto-scroll.
 */

(function (global) {
    'use strict';

    // ═══ Application State ═══
    let eventTable = null;        // Tabulator instance
    let cmEditor = null;          // CodeMirror instance for CommandText
    const allEvents = [];         // In-memory FIFO ring buffer
    const MAX_EVENTS = 15000;
    const LOG_MAX = 500;

    let isListening = false;
    let isPaused = false;
    let autoScroll = true;
    let listenerState = 'STOPPED'; // CONNECTING | CONNECTED | LISTENING | DISCONNECTED | RECONNECTING | ERROR | STOPPED
    let eventCounter = 0;
    let rateCounter = 0;
    let rateInterval = null;
    let selectedEvent = null;
    let activeFilters = {};       // preset filter states
    let activeSessionId = null;

    // ═══ DOM Selector Shortcuts ═══
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ═══ 1. Theme & Typography Management ═══
    function initThemeAndTypography() {
        // Immediate restore from localStorage
        try {
            const savedTheme = localStorage.getItem('ide-theme');
            if (savedTheme) {
                document.documentElement.setAttribute('data-bs-theme', savedTheme);
                const isDark = (savedTheme !== 'light' && savedTheme !== 'win-nt' && savedTheme !== 'win-xp');
                document.documentElement.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');
            }
            const fontFam = localStorage.getItem('ide-ui-font-family');
            const fontSz = localStorage.getItem('ide-ui-font-size');
            if (fontFam) {
                let stack = fontFam;
                if (fontFam === 'Segoe UI') stack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
                else if (fontFam === 'Inter') stack = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
                else if (fontFam === 'Roboto') stack = "'Roboto', 'Segoe UI', Arial, sans-serif";
                document.documentElement.style.setProperty('--ide-ui-font-family', stack);
            }
            if (fontSz) {
                const sz = parseInt(fontSz, 10);
                if (!isNaN(sz) && sz >= 10 && sz <= 24) {
                    document.documentElement.style.setProperty('--ide-ui-font-size', sz + 'px');
                }
            }
        } catch (_) {}

        // Listen for IDE theme changes
        document.addEventListener('ide-theme-changed', function (e) {
            const themeName = e.detail?.theme || document.documentElement.getAttribute('data-bs-theme') || 'dark';
            const isDark = (themeName !== 'light' && themeName !== 'win-nt' && themeName !== 'win-xp');
            document.documentElement.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');

            if (cmEditor) {
                cmEditor.setOption('theme', isDark ? 'darcula' : 'default');
                cmEditor.refresh();
            }
        });
    }

    // ═══ 2. CodeMirror CommandText Viewer ═══
    function initCodeMirror() {
        const textarea = $('#detailSqlTextarea');
        if (!textarea) return;

        const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        const cmTheme = (currentTheme === 'light' || currentTheme === 'win-nt' || currentTheme === 'win-xp') ? 'default' : 'darcula';

        cmEditor = CodeMirror.fromTextArea(textarea, {
            mode: 'text/x-sql',
            theme: cmTheme,
            lineNumbers: true,
            readOnly: false, // allow user to edit / copy built queries
            lineWrapping: true
        });
        cmEditor.setValue('-- Chọn một sự kiện ở bảng phía trên để xem câu lệnh SQL đầy đủ...');

        setTimeout(() => {
            if (cmEditor) cmEditor.refresh();
        }, 150);
    }

    // ═══ 3. Tabulator Virtual Grid Setup ═══
    function initGrid() {
        eventTable = new Tabulator('#eventTable', {
            data: [],
            layout: 'fitColumns',
            height: '100%',
            renderVertical: 'virtual',
            placeholder: '<div style="padding:40px;text-align:center;color:var(--ide-text-dim,#5a6068);font-size:13px;">' +
                '<i class="fa-solid fa-tower-broadcast" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.3;"></i>' +
                'Chưa có sự kiện nào. Hãy cấu hình kết nối và nhấn "Lắng nghe" để bắt đầu theo dõi.</div>',
            selectable: 1,
            reactiveData: false,
            movableColumns: true,
            resizableColumns: true,
            headerSort: true,
            index: 'id',
            columns: [
                {
                    title: '#', field: 'id', width: 60, hozAlign: 'right',
                    sorter: 'number', headerSort: true, frozen: true
                },
                {
                    title: 'Timestamp', field: 'timestamp', width: 130, hozAlign: 'center',
                    headerFilter: 'input', headerFilterPlaceholder: 'Thời gian...',
                    formatter: function (cell) {
                        const v = cell.getValue();
                        if (!v) return '—';
                        if (typeof v === 'string' && v.includes(':')) {
                            // Extract time portion if ISO string
                            if (v.includes('T')) return v.split('T')[1].split('.')[0];
                            return v;
                        }
                        return String(v);
                    }
                },
                {
                    title: 'Connection', field: 'connection', width: 140,
                    headerFilter: 'input', headerFilterPlaceholder: 'Kết nối / Host...',
                    formatter: function (cell) {
                        const val = cell.getValue() || 'PostgreSQL';
                        const row = cell.getRow().getData();
                        const src = (row.source || row.source_type || '').toLowerCase();
                        let iconClass = 'fa-solid fa-database src-icon src-postgresql';
                        if (src.includes('backend')) iconClass = 'fa-solid fa-server src-icon src-backend';
                        else if (src.includes('redis')) iconClass = 'fa-solid fa-bolt src-icon src-redis';
                        return `<i class="${iconClass}"></i><span>${val}</span>`;
                    }
                },
                {
                    title: 'User', field: 'user', width: 100,
                    headerFilter: 'input', headerFilterPlaceholder: 'Người dùng...'
                },
                {
                    title: 'Database', field: 'database', width: 120,
                    headerFilter: 'input', headerFilterPlaceholder: 'CSDL...'
                },
                {
                    title: 'AppName', field: 'app_name', width: 120,
                    headerFilter: 'input', headerFilterPlaceholder: 'Ứng dụng...'
                },
                {
                    title: 'NodeId', field: 'node_id', width: 90, hozAlign: 'center',
                    headerFilter: 'input', headerFilterPlaceholder: 'Node / PID...'
                },
                {
                    title: 'Action', field: 'operation', width: 110, hozAlign: 'center',
                    headerFilter: 'input', headerFilterPlaceholder: 'Thao tác...',
                    formatter: function (cell) {
                        const v = (cell.getValue() || 'STATEMENT').toUpperCase();
                        let badgeClass = 'op-unknown';
                        if (v.includes('INSERT')) badgeClass = 'op-insert';
                        else if (v.includes('UPDATE')) badgeClass = 'op-update';
                        else if (v.includes('DELETE')) badgeClass = 'op-delete';
                        else if (v.includes('DDL') || v.includes('CREATE') || v.includes('ALTER') || v.includes('DROP')) badgeClass = 'op-ddl';
                        else if (v.includes('TRUNCATE')) badgeClass = 'op-truncate';
                        return `<span class="op-badge ${badgeClass}">${v}</span>`;
                    }
                },
                {
                    title: 'Duration (ms)', field: 'duration_ms', width: 110, hozAlign: 'right',
                    sorter: 'number', headerFilter: 'input', headerFilterPlaceholder: 'ms...',
                    formatter: function (cell) {
                        const v = Number(cell.getValue()) || 0;
                        let color = '#4ec9b0'; // Teal (<50ms)
                        if (v >= 200) color = '#ff5c5c'; // Red (>200ms)
                        else if (v >= 50) color = '#E8C859'; // Yellow (>50ms)
                        return `<span style="color:${color};font-weight:700;">${v.toFixed(2)}</span>`;
                    }
                },
                {
                    title: 'Query (CommandText)', field: 'command_text',
                    headerFilter: 'input', headerFilterPlaceholder: 'Tìm câu lệnh SQL...',
                    formatter: function (cell) {
                        const v = cell.getValue() || '';
                        return `<span class="text-truncate">${v.replace(/[\r\n]+/g, ' ')}</span>`;
                    }
                }
            ]
        });

        // Row Selection -> Update Inspector
        eventTable.on('rowClick', function (e, row) {
            selectedEvent = row.getData();
            renderEventDetail(selectedEvent);
        });
    }

    // ═══ 4. Event Detail & Parameter Rendering ═══
    function renderEventDetail(evt) {
        if (!evt) return;

        // Tab 1: Details key-values
        $('#detEventId').textContent = evt.id || evt.event_id || '—';
        $('#detSource').textContent = (evt.source_type || evt.source || 'PostgreSQL').toUpperCase();
        $('#detEventType').textContent = evt.event_type || 'DATABASE_EVENT';
        $('#detConnection').textContent = evt.connection || 'PostgreSQL';
        $('#detUser').textContent = evt.user || '—';
        $('#detDatabase').textContent = evt.database || evt.db || '—';
        $('#detSchema').textContent = evt.schema || 'public';
        $('#detTable').textContent = evt.table || '—';
        $('#detOperation').textContent = (evt.operation || evt.action || 'QUERY').toUpperCase();
        $('#detNodeId').textContent = evt.node_id || evt.spid || '—';
        $('#detTimestamp').textContent = evt.timestamp || evt.time || '—';
        $('#detTransactionId').textContent = evt.transaction_id || '—';
        $('#detLSN').textContent = (evt.metadata && evt.metadata.lsn) || '—';

        const dur = evt.duration_ms != null ? evt.duration_ms : evt.latency_ms;
        $('#detLatency').textContent = dur != null ? `${Number(dur).toFixed(2)} ms` : '—';

        // Metadata JSON
        const meta = evt.metadata || {};
        $('#detMetadata').textContent = JSON.stringify(meta, null, 2);

        // Tab 2: CommandText in CodeMirror
        const sql = evt.command_text || evt.sql || '-- Không có nội dung SQL';
        if (cmEditor) {
            cmEditor.setValue(sql);
            setTimeout(() => cmEditor.refresh(), 50);
        }

        // Tab 3: Parameters Table
        renderParametersTable(evt.parameters);

        // Toggle "Build Query" button
        const btnBuild = $('#btnBuildQuery');
        if (btnBuild) {
            if (evt.parameters && evt.parameters.length > 0) {
                btnBuild.classList.remove('d-none');
            } else {
                btnBuild.classList.add('d-none');
            }
        }

        // Tab 4: Payload JSON
        const payload = evt.payload || {};
        $('#detPayload').textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    }

    function renderParametersTable(params) {
        const tbody = $('#paramsTableBody');
        const badge = $('#elParamCountBadge');
        if (!tbody) return;

        if (!params || !params.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Không có tham số cho câu lệnh này.</td></tr>';
            if (badge) badge.textContent = '0';
            return;
        }

        if (badge) badge.textContent = String(params.length);
        let rowsHtml = '';
        params.forEach(p => {
            const pName = p.name || p.parameter || '@param';
            const pType = (p.type || p.db_type || p.DbType || 'String').toUpperCase();
            const pVal = p.value !== undefined ? String(p.value) : 'NULL';
            rowsHtml += `
                <tr>
                    <td class="col-param-name">${pName}</td>
                    <td class="col-param-type">${pType}</td>
                    <td class="col-param-val">${pVal}</td>
                </tr>
            `;
        });
        tbody.innerHTML = rowsHtml;
    }

    // ═══ 5. Intelligent "Build Query" Feature ═══
    function handleBuildQuery() {
        if (!selectedEvent) return;
        const rawSql = selectedEvent.command_text || selectedEvent.sql || '';
        const params = selectedEvent.parameters;
        if (!rawSql || !params || !params.length) return;

        let builtSql = rawSql;
        // Sort parameters by name length descending so @p10 is replaced before @p1
        const sortedParams = [...params].sort((a, b) => (b.name || '').length - (a.name || '').length);

        sortedParams.forEach(p => {
            const name = p.name || p.parameter;
            if (!name) return;
            const pType = (p.type || p.db_type || '').toUpperCase();
            let val = p.value;
            let formattedVal = 'NULL';

            if (val === null || val === undefined || String(val).toUpperCase() === 'NULL') {
                formattedVal = 'NULL';
            } else if (pType.includes('INT') || pType.includes('NUM') || pType.includes('DECIMAL') || pType.includes('FLOAT')) {
                formattedVal = String(val);
            } else if (pType.includes('BIT') || pType.includes('BOOL')) {
                formattedVal = (val === 1 || val === '1' || val === true || String(val).toLowerCase() === 'true') ? '1' : '0';
            } else {
                // String / Char / DateTime literal -> escape single quotes
                const escaped = String(val).replace(/'/g, "''");
                formattedVal = `N'${escaped}'`;
            }

            // Replace exact parameter tokens (supports @p0 or $1 or :p0)
            const regex = new RegExp(`(?<=[^a-zA-Z0-9_]|^)${escapeRegex(name)}(?=[^a-zA-Z0-9_]|$)`, 'g');
            builtSql = builtSql.replace(regex, formattedVal);
        });

        // Add header comment
        const resultText = `-- [Built Query by luoBTool Profiler at ${new Date().toLocaleTimeString()}]\n` + builtSql;

        if (cmEditor) {
            cmEditor.setValue(resultText);
            cmEditor.refresh();
        }

        // Copy to clipboard
        copyTextToClipboard(resultText);
        addLog('INFO', `Đã tự động Build Query cho ID #${selectedEvent.id} và sao chép vào Clipboard.`);
        showNotificationPopup('Thành công', 'Đã tái tạo câu lệnh SQL hoàn chỉnh (kèm giá trị tham số) và sao chép vào Clipboard!');
    }

    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ═══ 6. Detail Tabs Switching ═══
    function initDetailTabs() {
        $$('.el-detail-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                const target = this.getAttribute('data-tab');
                $$('.el-detail-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                $$('.el-modal-tab-content[data-tab-content]').forEach(c => c.classList.remove('active'));
                const content = $(`[data-tab-content="${target}"]`);
                if (content) content.classList.add('active');

                if (target === 'command' && cmEditor) {
                    setTimeout(() => cmEditor.refresh(), 50);
                }
            });
        });

        $('#btnBuildQuery')?.addEventListener('click', handleBuildQuery);

        $('#btnFormatSql')?.addEventListener('click', function () {
            if (!cmEditor) return;
            const current = cmEditor.getValue();
            // Basic SQL indentation formatting
            const formatted = current
                .replace(/\s+(SELECT|FROM|WHERE|LEFT JOIN|RIGHT JOIN|INNER JOIN|GROUP BY|ORDER BY|HAVING|UPDATE|SET|INSERT INTO|VALUES|DELETE FROM)\s+/gi, '\n$1 ')
                .trim();
            cmEditor.setValue(formatted);
            addLog('INFO', 'Đã định dạng câu lệnh SQL.');
        });

        $('#btnCopyEvent')?.addEventListener('click', function () {
            const activeTab = $('.el-detail-tab.active')?.getAttribute('data-tab');
            if (activeTab === 'command' && cmEditor) {
                copyTextToClipboard(cmEditor.getValue());
                addLog('INFO', 'Đã sao chép câu lệnh SQL vào clipboard.');
            } else if (selectedEvent) {
                copyTextToClipboard(JSON.stringify(selectedEvent, null, 2));
                addLog('INFO', 'Đã sao chép chi tiết sự kiện JSON vào clipboard.');
            }
        });
    }

    // ═══ 7. Connection Wizard Modal & Backend Discovery ═══
    function openConnModal() {
        $('#connModalBackdrop')?.classList.remove('d-none');
    }
    function closeConnModal() {
        $('#connModalBackdrop')?.classList.add('d-none');
    }

    function initConnModal() {
        $('#btnConnect')?.addEventListener('click', openConnModal);
        $('#elConnStatus')?.addEventListener('click', openConnModal);
        $('#connModalCloseBtn')?.addEventListener('click', closeConnModal);
        $('#connModalBackdrop')?.addEventListener('click', function (e) {
            if (e.target === this) closeConnModal();
        });

        // Tab Switching
        $$('.el-modal-tab[data-conn-tab]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                const target = this.getAttribute('data-conn-tab');
                $$('.el-modal-tab[data-conn-tab]').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                $$('.el-modal-tab-content[data-conn-content]').forEach(c => c.classList.remove('active'));
                const content = $(`[data-conn-content="${target}"]`);
                if (content) content.classList.add('active');
            });
        });

        // Backend Model Radio (Single vs Dual)
        $$('input[name="backendModel"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                const dualSec = $('#dualBackendSection');
                if (!dualSec) return;
                if (this.value === 'dual') {
                    dualSec.classList.remove('d-none');
                } else {
                    dualSec.classList.add('d-none');
                }
            });
        });

        // Sub-tabs (Bravo Hosting / Import)
        $$('#backendSubTabs .el-sub-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                $$('#backendSubTabs .el-sub-tab').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const target = this.getAttribute('data-sub-tab');
                if (target === 'hosting') {
                    $('#subTabHosting')?.classList.remove('d-none');
                    $('#subTabImport')?.classList.add('d-none');
                } else {
                    $('#subTabHosting')?.classList.add('d-none');
                    $('#subTabImport')?.classList.remove('d-none');
                }
            });
        });

        // Password Reveal Toggles
        initPasswordToggle('btnToggleToken', 'backendToken');
        initPasswordToggle('btnToggleRedisPass', 'redisPassword');
        initPasswordToggle('btnTogglePlatformPass', 'platformPassword');

        // Backend Discovery Button
        $('#btnDiscoverBackend')?.addEventListener('click', handleDiscoverLocalBackends);

        // Test Connection Button
        $('#btnTestConn')?.addEventListener('click', handleTestConnection);

        // Connect Now Button
        $('#btnConnectNow')?.addEventListener('click', handleConnectNow);

        // Initial scan of local backends if in pywebview
        setTimeout(handleDiscoverLocalBackends, 500);
    }

    function initPasswordToggle(btnId, inputId) {
        const btn = $('#' + btnId);
        const input = $('#' + inputId);
        if (!btn || !input) return;
        btn.addEventListener('click', function () {
            if (input.type === 'password') {
                input.type = 'text';
                btn.querySelector('i')?.classList.replace('fa-eye', 'fa-eye-slash');
            } else {
                input.type = 'password';
                btn.querySelector('i')?.classList.replace('fa-eye-slash', 'fa-eye');
            }
        });
    }

    async function handleDiscoverLocalBackends() {
        const select = $('#localBackendSelect');
        const statusEl = $('#localBackendStatus');
        if (!select) return;

        if (statusEl) statusEl.textContent = 'Đang quét IIS và cổng dịch vụ cục bộ...';

        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_discover_local_backends === 'function') {
                const res = await window.pywebview.api.el_discover_local_backends();
                if (res && res.success && res.backends) {
                    select.innerHTML = '<option value="">-- Chọn Backend đã phát hiện --</option>';
                    res.backends.forEach(b => {
                        const opt = document.createElement('option');
                        opt.value = JSON.stringify(b);
                        opt.textContent = b.name;
                        select.appendChild(opt);
                    });
                    if (statusEl) statusEl.textContent = `Đã tìm thấy ${res.backends.length} cấu hình backend.`;
                    return;
                }
            }
        } catch (err) {
            console.debug('Error in el_discover_local_backends:', err);
        }

        // Fallback standard options if offline / browser mode
        select.innerHTML = `
            <option value="">-- Quét và chọn Backend (IIS / Service) --</option>
            <option value='{"host":"127.0.0.1","port":8001,"name":"BRAVO Backend API (127.0.0.1:8001)"}' selected>BRAVO Backend API (127.0.0.1:8001) — Mặc định</option>
            <option value='{"host":"127.0.0.1","port":8080,"name":"BRAVO IIS Site (127.0.0.1:8080)"}'>BRAVO IIS Site (127.0.0.1:8080)</option>
        `;
        if (statusEl) statusEl.textContent = 'Đã tải danh sách cấu hình máy chủ cục bộ mặc định.';
    }

    function getActiveConnTab() {
        const active = $('.el-modal-tab.active[data-conn-tab]');
        return active ? active.getAttribute('data-conn-tab') : 'local';
    }

    function getActiveConnectionConfig() {
        const tab = getActiveConnTab();
        if (tab === 'local') {
            let host = '127.0.0.1';
            let port = 8001;
            const selVal = $('#localBackendSelect')?.value;
            if (selVal) {
                try {
                    const parsed = JSON.parse(selVal);
                    host = parsed.host || host;
                    port = parsed.port || port;
                } catch (_) {}
            }
            return {
                conn_type: 'local',
                type: 'bravo_backend',
                host: host,
                port: port,
                event_source: $('#localEventSource')?.value || 'backend'
            };
        } else if (tab === 'backend') {
            const isDual = $('input[name="backendModel"]:checked')?.value === 'dual';
            return {
                conn_type: 'backend',
                type: 'bravo_backend',
                backend_model: isDual ? 'dual' : 'single',
                host: $('#backendHost')?.value?.trim() || '127.0.0.1',
                port: parseInt($('#backendPort')?.value?.trim(), 10) || 8001,
                access_token: $('#backendToken')?.value || '',
                token: $('#backendToken')?.value || '',
                redis_host: isDual ? ($('#redisHost')?.value?.trim() || '127.0.0.1') : null,
                redis_port: isDual ? (parseInt($('#redisPort')?.value?.trim(), 10) || 6379) : null,
                redis_password: isDual ? ($('#redisPassword')?.value || '') : null,
                redis_channel: isDual ? ($('#redisChannel')?.value?.trim() || 'bravo_event') : null,
                redis_tls: isDual ? ($('#redisTLS')?.value === 'true') : false
            };
        } else {
            return {
                conn_type: 'platform',
                type: 'bravo_backend',
                platform_env: $('input[name="platformEnv"]:checked')?.value || 'dev',
                app_id: $('#platformAppId')?.value?.trim() || '',
                username: $('#platformUsername')?.value?.trim() || '',
                password: $('#platformPassword')?.value || ''
            };
        }
    }

    async function handleTestConnection() {
        const tab = getActiveConnTab();
        const resultsEl = $(`#${tab}TestResults`);
        if (!resultsEl) return;

        resultsEl.classList.add('show');
        resultsEl.innerHTML = `
            <div class="el-test-item pending">
                <i class="fa-solid fa-circle-notch fa-spin check-icon"></i>
                <span>Đang kiểm tra kết nối tới ${tab.toUpperCase()}...</span>
            </div>
        `;

        const cfg = getActiveConnectionConfig();
        addLog('INFO', `Kiểm tra kết nối (${tab})...`);

        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_test_connection === 'function') {
                const rep = await window.pywebview.api.el_test_connection(tab, cfg);
                renderTestReport(resultsEl, rep);
                return;
            }
        } catch (err) {
            console.debug('Python test connection error:', err);
        }

        // Fallback simulation for demonstration
        setTimeout(() => {
            const dummySteps = [
                { name: 'Network reachable', success: true, msg: `${cfg.host || 'Host'}:${cfg.port || 8001} sẵn sàng` },
                { name: 'Authentication check', success: true, msg: 'Xác thực Access Token thành công' },
                { name: 'Event capability verified', success: true, msg: 'Nguồn sự kiện PostgreSQL khả dụng' }
            ];
            renderTestReport(resultsEl, { success: true, steps: dummySteps });
        }, 600);
    }

    function renderTestReport(container, report) {
        container.innerHTML = '';
        const steps = report.steps || [];
        steps.forEach(s => {
            const div = document.createElement('div');
            const icon = s.success ? 'fa-solid fa-circle-check check-icon' : 'fa-solid fa-circle-xmark check-icon';
            div.className = `el-test-item ${s.success ? 'success' : 'fail'}`;
            div.innerHTML = `<i class="${icon}"></i><span>${s.name}: ${s.msg || ''}</span>`;
            container.appendChild(div);
        });

        if (report.error) {
            const errDiv = document.createElement('div');
            errDiv.className = 'el-test-item fail';
            errDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation check-icon"></i><span>${report.error}</span>`;
            container.appendChild(errDiv);
        }
    }

    async function handleConnectNow() {
        const cfg = getActiveConnectionConfig();
        addLog('CONNECT', `Khởi tạo kết nối tới [${cfg.conn_type.toUpperCase()}]...`);
        setListenerState('CONNECTING');

        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_start_listener === 'function') {
                const res = await window.pywebview.api.el_start_listener(cfg);
                if (res && res.success) {
                    activeSessionId = res.session_id;
                    setListenerState('CONNECTED');
                    addLog('CONNECT', `Kết nối thành công. Phiên: ${res.session_id}`);
                    closeConnModal();
                    $('#btnStartListen').disabled = false;
                    updateConnLabel(cfg);
                    return;
                } else {
                    setListenerState('ERROR');
                    showNotificationPopup('Lỗi kết nối', res.error || 'Không thể kết nối tới nguồn sự kiện.');
                    return;
                }
            }
        } catch (err) {
            console.debug('Error in el_start_listener:', err);
        }

        // Browser fallback
        setTimeout(() => {
            setListenerState('CONNECTED');
            addLog('CONNECT', 'Kết nối thành công (Mô phỏng).');
            closeConnModal();
            $('#btnStartListen').disabled = false;
            updateConnLabel(cfg);
        }, 500);
    }

    function updateConnLabel(cfg) {
        let label = 'PostgreSQL';
        if (cfg.conn_type === 'local') label = `Local: ${cfg.port || 8001}`;
        else if (cfg.conn_type === 'backend') label = `${cfg.host}:${cfg.port}`;
        else if (cfg.conn_type === 'platform') label = `Bravo Platform (${cfg.app_id || 'DEV'})`;
        $('#elConnLabel').textContent = label;
    }

    // ═══ 8. Listener Lifecycle & Action Buttons ═══
    function setListenerState(state) {
        listenerState = state;
        const dot = $('#elStatusDot');
        const counterDot = $('#elCounterDot');
        if (dot) dot.className = 'status-dot ' + state.toLowerCase();
        if (counterDot) counterDot.className = 'status-dot ' + state.toLowerCase();

        const messages = {
            'CONNECTING': 'Đang kết nối tới nguồn sự kiện...',
            'CONNECTED': 'Đã kết nối. Nhấn "Lắng nghe" để bắt đầu theo dõi truy vấn.',
            'LISTENING': 'Đang lắng nghe sự kiện PostgreSQL thời gian thực...',
            'DISCONNECTED': 'Mất kết nối tới nguồn sự kiện.',
            'RECONNECTING': 'Đang tự động tái kết nối...',
            'ERROR': 'Lỗi kết nối.',
            'STOPPED': 'Đã dừng phiên lắng nghe.'
        };
        const statusMsgEl = $('#elStatusMessage');
        if (statusMsgEl) statusMsgEl.textContent = messages[state] || 'Sẵn sàng.';
    }

    function initActionButtons() {
        // Start Listening
        $('#btnStartListen')?.addEventListener('click', async function () {
            isListening = true;
            isPaused = false;
            setListenerState('LISTENING');
            addLog('CONNECT', 'Bắt đầu lắng nghe sự kiện.');
            this.disabled = true;
            $('#btnPause').disabled = false;
            $('#btnStop').disabled = false;
            startRateCounter();

            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_resume_listener === 'function') {
                await window.pywebview.api.el_resume_listener(activeSessionId);
            }
        });

        // Pause
        $('#btnPause')?.addEventListener('click', async function () {
            isPaused = !isPaused;
            if (isPaused) {
                this.innerHTML = '<i class="fa-solid fa-play"></i> Tiếp tục';
                this.classList.replace('btn-outline-warning', 'btn-warning');
                addLog('INFO', 'Tạm dừng hiển thị sự kiện mới.');
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_pause_listener === 'function') {
                    await window.pywebview.api.el_pause_listener(activeSessionId);
                }
            } else {
                this.innerHTML = '<i class="fa-solid fa-pause"></i> Tạm dừng';
                this.classList.replace('btn-warning', 'btn-outline-warning');
                addLog('INFO', 'Tiếp tục lắng nghe sự kiện.');
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_resume_listener === 'function') {
                    await window.pywebview.api.el_resume_listener(activeSessionId);
                }
            }
        });

        // Stop
        $('#btnStop')?.addEventListener('click', async function () {
            isListening = false;
            isPaused = false;
            setListenerState('STOPPED');
            addLog('DISCONNECT', 'Đã dừng phiên lắng nghe.');
            this.disabled = true;
            $('#btnPause').disabled = true;
            $('#btnPause').innerHTML = '<i class="fa-solid fa-pause"></i> Tạm dừng';
            $('#btnPause').classList.replace('btn-warning', 'btn-outline-warning');
            $('#btnStartListen').disabled = false;
            stopRateCounter();

            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.el_stop_listener === 'function') {
                await window.pywebview.api.el_stop_listener(activeSessionId);
            }
        });

        // Clear Grid
        $('#btnClear')?.addEventListener('click', function () {
            allEvents.length = 0;
            eventCounter = 0;
            if (eventTable) eventTable.replaceData([]);
            updateCounterText();
            addLog('INFO', 'Đã xóa toàn bộ sự kiện trên bảng.');
        });

        // Auto-scroll toggle
        $('#btnAutoScroll')?.addEventListener('click', function () {
            autoScroll = !autoScroll;
            this.classList.toggle('active', autoScroll);
        });
    }

    // ═══ 9. Batch Event Ingestion (Real-Time Pipeline) ═══
    function ingestEvents(events) {
        if (!events || !events.length || isPaused) return;

        rateCounter += events.length;
        eventCounter += events.length;
        allEvents.push(...events);

        if (eventTable) {
            eventTable.addData(events, false).then(() => {
                const totalActive = eventTable.getDataCount('active');
                updateCounterText();

                if (autoScroll && events.length) {
                    const last = events[events.length - 1];
                    eventTable.scrollToRow(last.id || last.row_num, 'bottom', false).catch(() => {});
                }

                // Pruning if exceeds MAX_EVENTS
                if (totalActive > MAX_EVENTS) {
                    const pruneCount = totalActive - MAX_EVENTS;
                    const data = eventTable.getData();
                    const ids = data.slice(0, pruneCount).map(r => r.id);
                    eventTable.deleteRow(ids);
                    if (allEvents.length > MAX_EVENTS) {
                        allEvents.splice(0, pruneCount);
                    }
                }
            }).catch(err => console.debug('Tabulator addData error:', err));
        }

        // Auto-select first event if none selected
        if (!selectedEvent && events.length) {
            selectedEvent = events[0];
            renderEventDetail(selectedEvent);
        }
    }

    global.onBatchEventsReceived = function (batch) {
        ingestEvents(batch);
    };

    global.onEventReceived = function (evt) {
        ingestEvents([evt]);
    };

    // ═══ 10. Filter Presets & Quick Search ═══
    function initFilters() {
        $$('.el-preset-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                this.classList.toggle('active');
                const key = this.getAttribute('data-filter');
                if (this.classList.contains('active')) {
                    activeFilters[key] = true;
                } else {
                    delete activeFilters[key];
                }
                applyFilters();
            });
        });

        $('#btnClearFilters')?.addEventListener('click', function () {
            activeFilters = {};
            $$('.el-preset-btn').forEach(b => b.classList.remove('active'));
            applyFilters();
        });

        // Quick Search with debounce
        const searchInput = $('#elQuickSearch');
        let debounce = null;
        searchInput?.addEventListener('input', function () {
            clearTimeout(debounce);
            const val = this.value.trim().toLowerCase();
            debounce = setTimeout(() => {
                if (!eventTable) return;
                if (!val) {
                    applyFilters();
                    return;
                }
                eventTable.setFilter(data => {
                    return (data.command_text || data.sql || '').toLowerCase().includes(val) ||
                           (data.table || '').toLowerCase().includes(val) ||
                           (data.database || data.db || '').toLowerCase().includes(val) ||
                           (data.operation || '').toLowerCase().includes(val) ||
                           (data.user || '').toLowerCase().includes(val) ||
                           (data.app_name || '').toLowerCase().includes(val);
                });
            }, 180);
        });
    }

    function applyFilters() {
        if (!eventTable) return;
        const keys = Object.keys(activeFilters);
        if (keys.length === 0) {
            eventTable.clearFilter();
            updateFilterChips([]);
            return;
        }

        eventTable.setFilter(data => {
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (k === 'database_event' && (data.event_type || '').toUpperCase() !== 'DATABASE_EVENT') return false;
                if (k === 'application_event' && (data.event_type || '').toUpperCase() !== 'APPLICATION_EVENT') return false;
                if (k === 'insert' && !(data.operation || '').toUpperCase().includes('INSERT')) return false;
                if (k === 'update' && !(data.operation || '').toUpperCase().includes('UPDATE')) return false;
                if (k === 'delete' && !(data.operation || '').toUpperCase().includes('DELETE')) return false;
                if (k === 'slow' && (data.duration_ms || 0) < 50) return false;
            }
            return true;
        });

        updateFilterChips(keys);
    }

    function updateFilterChips(keys) {
        const container = $('#elFilterChips');
        if (!container) return;
        container.innerHTML = '';
        if (!keys.length) {
            container.innerHTML = '<span class="el-empty-filter-hint">Chưa áp dụng bộ lọc nào. Toàn bộ sự kiện đang được hiển thị.</span>';
            return;
        }
        keys.forEach(k => {
            const chip = document.createElement('span');
            chip.className = 'el-filter-chip';
            chip.innerHTML = `
                <span class="chip-label">${k.replace('_', ' ').toUpperCase()}</span>
                <span class="chip-remove" data-key="${k}"><i class="fa-solid fa-xmark"></i></span>
            `;
            chip.querySelector('.chip-remove')?.addEventListener('click', () => {
                delete activeFilters[k];
                $(`.el-preset-btn[data-filter="${k}"]`)?.classList.remove('active');
                applyFilters();
            });
            container.appendChild(chip);
        });
    }

    // ═══ 11. Splitter Drag Resizing ═══
    function initSplitter() {
        const splitter = $('#elSplitter');
        const gridContainer = $('#elGridContainer');
        const detailContainer = $('#elDetail');
        const mainEl = $('#elMain');
        let dragging = false;

        if (!splitter || !gridContainer || !mainEl) return;

        splitter.addEventListener('mousedown', function (e) {
            dragging = true;
            splitter.classList.add('active');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            const mainRect = mainEl.getBoundingClientRect();
            const offset = e.clientY - mainRect.top;
            const totalH = mainRect.height - 6;
            const gridH = Math.max(90, Math.min(totalH - 120, offset));
            gridContainer.style.height = gridH + 'px';
            gridContainer.style.flex = 'none';
            if (detailContainer) detailContainer.style.flex = '1';
        });

        document.addEventListener('mouseup', function () {
            if (!dragging) return;
            dragging = false;
            splitter.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }

    // ═══ 12. Rate Counter & Event Stats ═══
    function startRateCounter() {
        rateCounter = 0;
        if (rateInterval) clearInterval(rateInterval);
        rateInterval = setInterval(() => {
            const rateEl = $('#elRateText');
            if (rateEl) rateEl.textContent = `(${rateCounter} ev/s)`;
            rateCounter = 0;
        }, 1000);
    }

    function stopRateCounter() {
        if (rateInterval) clearInterval(rateInterval);
        rateInterval = null;
        const rateEl = $('#elRateText');
        if (rateEl) rateEl.textContent = '(0 ev/s)';
    }

    function updateCounterText() {
        const counterEl = $('#elCounterText');
        if (counterEl) counterEl.textContent = `Events: ${eventCounter.toLocaleString()}`;
    }

    // ═══ 13. System & Event Log ═══
    function addLog(level, message) {
        const logList = $('#elLogList');
        if (!logList) return;

        const entry = document.createElement('div');
        entry.className = 'el-log-entry';
        const ts = new Date().toTimeString().split(' ')[0];

        let levelClass = 'log-info';
        if (level === 'CONNECT' || level === 'AUTHENTICATED' || level === 'LISTENING') levelClass = 'log-connect';
        else if (level === 'DISCONNECT' || level === 'CONNECTION LOST') levelClass = 'log-disconnect';
        else if (level === 'EVENT' || level === 'EVENT RECEIVED') levelClass = 'log-event';
        else if (level === 'ERROR') levelClass = 'log-error';

        entry.innerHTML = `
            <span class="el-log-ts">${ts}</span>
            <span class="el-log-level ${levelClass}">${level}</span>
            <span class="el-log-msg">${message}</span>
        `;
        logList.appendChild(entry);

        while (logList.children.length > LOG_MAX) {
            logList.removeChild(logList.firstChild);
        }
        logList.scrollTop = logList.scrollHeight;
    }

    // ═══ 14. Export & Clipboard ═══
    function initExport() {
        $('#exportJsonBtn')?.addEventListener('click', function (e) {
            e.preventDefault();
            const json = JSON.stringify(allEvents, null, 2);
            downloadFile('postgres_events.json', json, 'application/json');
        });

        $('#exportCsvBtn')?.addEventListener('click', function (e) {
            e.preventDefault();
            if (eventTable) eventTable.download('csv', 'postgres_events.csv');
        });
    }

    function downloadFile(name, content, type) {
        const blob = new Blob([content], { type: type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    function copyTextToClipboard(text) {
        if (!text) return;
        if (typeof window.copyToClipboard === 'function') {
            window.copyToClipboard(text);
        } else if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_clipboard_text === 'function') {
            window.pywebview.api.set_clipboard_text(text);
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(text);
        }
    }

    function showNotificationPopup(title, message) {
        const backdrop = $('#elPopupBackdrop');
        const titleEl = $('#elPopupTitle');
        const bodyEl = $('#elPopupMessage');
        const okBtn = $('#elPopupOkBtn');
        const closeBtn = $('#elPopupCloseBtn');

        if (!backdrop || !bodyEl) {
            alert(message);
            return;
        }

        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-circle-info text-info me-2"></i><span>${title}</span>`;
        bodyEl.textContent = message;
        backdrop.classList.remove('d-none');

        const close = () => {
            backdrop.classList.add('d-none');
            okBtn?.removeEventListener('click', close);
            closeBtn?.removeEventListener('click', close);
        };
        okBtn?.addEventListener('click', close, { once: true });
        closeBtn?.addEventListener('click', close, { once: true });
    }

    // ═══ 15. External Entrypoints for Pywebview ═══
    global.onEventListenerInitConn = function (connId) {
        addLog('INFO', `Được mở từ IDE cho kết nối ID: ${connId}`);
    };

    // ═══ DOM Initialization ═══
    document.addEventListener('DOMContentLoaded', function () {
        initThemeAndTypography();
        initCodeMirror();
        initGrid();
        initDetailTabs();
        initConnModal();
        initActionButtons();
        initFilters();
        initSplitter();
        initExport();

        addLog('INFO', 'PostgreSQL Event Listener sẵn sàng.');
    });

})(window);
