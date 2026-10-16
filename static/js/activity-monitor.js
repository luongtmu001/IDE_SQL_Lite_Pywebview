/**
 * Activity Monitor (Sessions & Blocking Locks) JavaScript Component.
 * Supports both In-Tab embedding and standalone Pop-out window mode.
 * Strictly Zero Inline CSS Rule Compliant.
 */
(function (global) {
    'use strict';

    class ActivityMonitorComponent {
        constructor() {
            this.container = null;
            this.isPopout = false;
            this.currentConnId = null;
            this.currentDbType = null;
            this.currentSpid = null;
            this.sessionsData = [];
            this.headBlockerPids = [];
            this.selectedSession = null;
            this.refreshTimer = null;
            this.refreshIntervalSec = 3;
            this.stateFilter = 'all';
            this.searchQuery = '';
            this.isLoading = false;
            this.lastUpdated = null;
        }

        async init(options) {
            options = options || {};
            const containerId = options.containerId || 'activity-monitor-container';
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.error('[ActivityMonitor] Container element not found:', containerId);
                return;
            }

            this.isPopout = !!options.isPopout;
            this.renderLayout();
            this.bindEvents();

            await this.loadConnections(options.connectionId);
            if (this.currentConnId) {
                this.refresh();
                this.startAutoRefresh();
            }
        }

        renderLayout() {
            // Strictly zero inline styling. Using CSS classes defined in activity-monitor.css
            const popoutBtnHtml = this.isPopout
                ? `<span class="badge bg-secondary">Cửa sổ độc lập</span>`
                : `<button type="button" class="activity-btn-action activity-btn-popout" id="actBtnPopout" title="Mở thành cửa sổ riêng biệt (Pop-out ra màn hình 2)">
                     <i class="fa-solid fa-arrow-up-right-from-square"></i> Pop-out
                   </button>`;

            this.container.innerHTML = `
                <div class="activity-monitor-root">
                    <!-- Top Toolbar -->
                    <header class="activity-toolbar">
                        <div class="activity-toolbar-left">
                            <div class="activity-brand-badge">
                                <i class="fa-solid fa-heart-pulse"></i>
                                <span>Activity Monitor</span>
                            </div>
                            <select id="actConnSelect" class="activity-conn-select" title="Chọn kết nối cần giám sát">
                                <option value="">-- Chọn kết nối DB --</option>
                            </select>
                            <button type="button" class="activity-btn-action" id="actBtnRefresh" title="Làm mới dữ liệu ngay lập tức">
                                <i class="fa-solid fa-rotate" id="actRefreshIcon"></i> Làm mới
                            </button>
                            <select id="actIntervalSelect" class="activity-refresh-interval-select" title="Tần suất tự động làm mới">
                                <option value="0">Tự làm mới: Tắt</option>
                                <option value="2">Mỗi 2 giây</option>
                                <option value="3" selected>Mỗi 3 giây</option>
                                <option value="5">Mỗi 5 giây</option>
                                <option value="10">Mỗi 10 giây</option>
                            </select>
                        </div>

                        <div class="activity-toolbar-center">
                            <select id="actStateFilter" class="activity-filter-state-select" title="Lọc theo trạng thái phiên">
                                <option value="all">Tất cả phiên</option>
                                <option value="active">Chỉ đang chạy (Active)</option>
                                <option value="blocked">Chỉ bị khóa (Blocked)</option>
                                <option value="head_blockers">Gốc gây khóa (Head Blockers)</option>
                            </select>
                            <div class="activity-search-group">
                                <i class="fa-solid fa-magnifying-glass activity-search-icon"></i>
                                <input type="text" id="actSearchInput" class="activity-search-input" placeholder="Tìm kiếm SPID, DB, User, Host, SQL...">
                                <button type="button" id="actSearchClearBtn" class="activity-search-clear-btn d-none" title="Xóa tìm kiếm">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>

                        <div class="activity-toolbar-right">
                            ${popoutBtnHtml}
                        </div>
                    </header>

                    <!-- KPI Summary Bar -->
                    <section class="activity-kpi-bar">
                        <div class="activity-kpi-card" id="kpiCardTotal" title="Nhấn để xem tất cả phiên">
                            <div class="activity-kpi-icon-wrap kpi-total-icon">
                                <i class="fa-solid fa-server"></i>
                            </div>
                            <div class="activity-kpi-content">
                                <span class="activity-kpi-number" id="kpiValTotal">0</span>
                                <span class="activity-kpi-label">Tổng số phiên</span>
                            </div>
                        </div>

                        <div class="activity-kpi-card" id="kpiCardActive" title="Nhấn để lọc các phiên đang chạy truy vấn">
                            <div class="activity-kpi-icon-wrap kpi-active-icon">
                                <i class="fa-solid fa-play"></i>
                            </div>
                            <div class="activity-kpi-content">
                                <span class="activity-kpi-number" id="kpiValActive">0</span>
                                <span class="activity-kpi-label">Đang thực thi</span>
                            </div>
                        </div>

                        <div class="activity-kpi-card" id="kpiCardBlocked" title="Nhấn để lọc các phiên đang bị chờ/chặn bởi khóa">
                            <div class="activity-kpi-icon-wrap kpi-blocked-icon">
                                <i class="fa-solid fa-lock"></i>
                            </div>
                            <div class="activity-kpi-content">
                                <span class="activity-kpi-number" id="kpiValBlocked">0</span>
                                <span class="activity-kpi-label">Bị khóa chặn</span>
                            </div>
                        </div>

                        <div class="activity-kpi-card" id="kpiCardHeadBlockers" title="Nhấn để xem các phiên Gốc Gây Khóa">
                            <div class="activity-kpi-icon-wrap kpi-head-blocker-icon">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <div class="activity-kpi-content">
                                <span class="activity-kpi-number" id="kpiValHeadBlockers">0</span>
                                <span class="activity-kpi-label">Gốc gây khóa</span>
                            </div>
                            <span class="kpi-pulse-badge d-none" id="kpiHeadBadge">Alert!</span>
                        </div>
                    </section>

                    <!-- Main Split Layout -->
                    <main class="activity-main-layout">
                        <!-- Sessions Table Pane -->
                        <section class="activity-grid-pane">
                            <div class="activity-table-container" id="actTableContainer">
                                <table class="activity-table" id="actSessionsTable">
                                    <thead>
                                        <tr>
                                            <th class="col-spid">SPID</th>
                                            <th class="col-status">Trạng thái</th>
                                            <th class="col-block-role">Vai trò khóa</th>
                                            <th class="col-db">Database</th>
                                            <th class="col-user">User</th>
                                            <th class="col-host">Host</th>
                                            <th class="col-program">Ứng dụng</th>
                                            <th class="col-cpu">CPU (ms)</th>
                                            <th class="col-reads">Reads</th>
                                            <th class="col-writes">Writes</th>
                                            <th class="col-elapsed">Thời gian</th>
                                            <th class="col-wait">Wait Type</th>
                                            <th class="col-sql">Lệnh SQL tóm tắt</th>
                                            <th class="col-actions">Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody id="actSessionsTbody">
                                        <tr>
                                            <td colspan="14">
                                                <div class="activity-state-message">
                                                    <i class="fa-solid fa-server activity-state-icon"></i>
                                                    <span class="activity-state-text">Vui lòng chọn kết nối để bắt đầu giám sát phiên và khóa chặn.</span>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <!-- Resizable Horizontal Splitter -->
                        <div class="activity-splitter" id="actSplitter" title="Kéo để điều chỉnh chiều cao bảng chi tiết SQL"></div>

                        <!-- SQL Inspector Pane -->
                        <section class="activity-sql-pane" id="actSqlPane">
                            <div class="activity-sql-header">
                                <div class="activity-sql-title">
                                    <i class="fa-solid fa-code"></i>
                                    <span id="actSqlInspectorTitle">Chi tiết câu lệnh SQL (Chưa chọn phiên nào)</span>
                                </div>
                                <div class="activity-sql-actions">
                                    <button type="button" class="activity-btn-action" id="actBtnCopySql" title="Sao chép toàn bộ lệnh SQL">
                                        <i class="fa-solid fa-copy"></i> Copy SQL
                                    </button>
                                </div>
                            </div>
                            <pre class="activity-sql-body" id="actSqlInspectorBody">-- Nhấn vào bất kỳ dòng nào trên bảng để xem chi tiết câu lệnh SQL đang thực thi</pre>
                        </section>
                    </main>

                    <!-- Bottom Status Bar -->
                    <footer class="activity-statusbar">
                        <div class="activity-statusbar-left">
                            <span class="status-indicator-dot" id="actStatusDot"></span>
                            <span id="actStatusMsg">Sẵn sàng</span>
                        </div>
                        <div class="activity-statusbar-right">
                            <span id="actSpidSelfMsg">SPID của bạn: —</span>
                            <span id="actLastUpdatedMsg">Cập nhật lúc: —</span>
                        </div>
                    </footer>

                    <!-- Confirmation Modal Dialog -->
                    <div class="activity-modal-backdrop d-none" id="actConfirmModal">
                        <div class="activity-modal-dialog">
                            <div class="activity-modal-header">
                                <span id="actModalTitle">Xác nhận thao tác</span>
                                <button type="button" class="activity-modal-close-btn" id="actModalCloseBtn">&times;</button>
                            </div>
                            <div class="activity-modal-body">
                                <div class="activity-modal-warning-box">
                                    <i class="fa-solid fa-triangle-exclamation activity-modal-warning-icon"></i>
                                    <div id="actModalWarningText">Nội dung cảnh báo an toàn.</div>
                                </div>
                                <div id="actModalDetailDesc">Chi tiết phiên...</div>
                                <div class="activity-modal-sql-preview" id="actModalSqlPreview"></div>
                            </div>
                            <div class="activity-modal-footer">
                                <button type="button" class="btn-modal-cancel" id="actModalCancelBtn">Hủy bỏ</button>
                                <button type="button" class="btn-modal-danger" id="actModalConfirmBtn">Xác nhận thực hiện</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        bindEvents() {
            const connSelect = document.getElementById('actConnSelect');
            if (connSelect) {
                connSelect.addEventListener('change', (e) => {
                    this.onConnectionChanged(e.target.value);
                });
            }

            const refreshBtn = document.getElementById('actBtnRefresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    this.refresh();
                });
            }

            const intervalSelect = document.getElementById('actIntervalSelect');
            if (intervalSelect) {
                intervalSelect.addEventListener('change', (e) => {
                    this.refreshIntervalSec = parseInt(e.target.value, 10) || 0;
                    this.startAutoRefresh();
                });
            }

            const stateFilter = document.getElementById('actStateFilter');
            if (stateFilter) {
                stateFilter.addEventListener('change', (e) => {
                    this.stateFilter = e.target.value;
                    this.applyFilterAndRender();
                });
            }

            const searchInput = document.getElementById('actSearchInput');
            const searchClearBtn = document.getElementById('actSearchClearBtn');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value.trim().toLowerCase();
                    if (searchClearBtn) {
                        if (this.searchQuery.length > 0) {
                            searchClearBtn.classList.remove('d-none');
                        } else {
                            searchClearBtn.classList.add('d-none');
                        }
                    }
                    this.applyFilterAndRender();
                });
            }

            if (searchClearBtn) {
                searchClearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    this.searchQuery = '';
                    searchClearBtn.classList.add('d-none');
                    this.applyFilterAndRender();
                });
            }

            // KPI card clicks act as quick filters
            document.getElementById('kpiCardTotal')?.addEventListener('click', () => {
                this.setFilterState('all');
            });
            document.getElementById('kpiCardActive')?.addEventListener('click', () => {
                this.setFilterState('active');
            });
            document.getElementById('kpiCardBlocked')?.addEventListener('click', () => {
                this.setFilterState('blocked');
            });
            document.getElementById('kpiCardHeadBlockers')?.addEventListener('click', () => {
                this.setFilterState('head_blockers');
            });

            // Pop-out button
            const popoutBtn = document.getElementById('actBtnPopout');
            if (popoutBtn) {
                popoutBtn.addEventListener('click', () => {
                    this.popOut();
                });
            }

            // Copy SQL button
            const copySqlBtn = document.getElementById('actBtnCopySql');
            if (copySqlBtn) {
                copySqlBtn.addEventListener('click', () => {
                    this.copyCurrentSql();
                });
            }

            // Modal actions
            document.getElementById('actModalCloseBtn')?.addEventListener('click', () => this.hideModal());
            document.getElementById('actModalCancelBtn')?.addEventListener('click', () => this.hideModal());

            // Resizable Splitter
            this.initSplitter();
        }

        initSplitter() {
            const splitter = document.getElementById('actSplitter');
            const sqlPane = document.getElementById('actSqlPane');
            if (!splitter || !sqlPane) return;

            let isDragging = false;
            let startY = 0;
            let startH = 0;

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const dy = startY - e.clientY;
                const newHeight = Math.max(70, Math.min(startH + dy, window.innerHeight - 250));
                sqlPane.style.height = `${newHeight}px`; // dynamic geometry resizing
            };

            const onMouseUp = () => {
                if (isDragging) {
                    isDragging = false;
                    splitter.classList.remove('splitter-active');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };

            splitter.addEventListener('mousedown', (e) => {
                isDragging = true;
                startY = e.clientY;
                startH = sqlPane.offsetHeight;
                splitter.classList.add('splitter-active');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        setFilterState(state) {
            this.stateFilter = state;
            const filterEl = document.getElementById('actStateFilter');
            if (filterEl) filterEl.value = state;
            this.applyFilterAndRender();
        }

        async loadConnections(preferredConnId) {
            const selectEl = document.getElementById('actConnSelect');
            if (!selectEl) return;

            selectEl.innerHTML = '<option value="">-- Chọn kết nối DB --</option>';

            try {
                let connections = [];
                if (window.waitForPywebview) {
                    const api = await window.waitForPywebview();
                    if (api && typeof api.get_saved_connections === 'function') {
                        const res = await api.get_saved_connections();
                        if (res && res.success && Array.isArray(res.connections)) {
                            connections = res.connections;
                        }
                    }
                }

                if ((!connections || connections.length === 0) && window.ConnectionManager) {
                    connections = window.ConnectionManager.getSavedConnections() || [];
                }

                connections.forEach((conn) => {
                    const opt = document.createElement('option');
                    opt.value = conn.id;
                    opt.textContent = `${conn.name} (${conn.db_type || 'mssql'})`;
                    opt.dataset.dbType = conn.db_type || 'mssql';
                    selectEl.appendChild(opt);
                });

                if (preferredConnId && connections.some(c => c.id === preferredConnId)) {
                    selectEl.value = preferredConnId;
                    this.onConnectionChanged(preferredConnId);
                } else if (connections.length > 0) {
                    // Try to pick active connection if known
                    const activeId = window.ConnectionManager?.getActiveConnectionId?.();
                    if (activeId && connections.some(c => c.id === activeId)) {
                        selectEl.value = activeId;
                        this.onConnectionChanged(activeId);
                    } else {
                        selectEl.value = connections[0].id;
                        this.onConnectionChanged(connections[0].id);
                    }
                }
            } catch (err) {
                console.error('[ActivityMonitor] Error loading connections:', err);
            }
        }

        onConnectionChanged(connId) {
            this.currentConnId = connId || null;
            const selectEl = document.getElementById('actConnSelect');
            if (selectEl && selectEl.selectedOptions && selectEl.selectedOptions[0]) {
                this.currentDbType = selectEl.selectedOptions[0].dataset.dbType || 'mssql';
            }
            this.selectedSession = null;
            this.resetSqlInspector();

            if (this.currentConnId) {
                this.updateStatus('Đang kết nối và lấy dữ liệu...', 'dot-paused');
                this.refresh();
            } else {
                this.sessionsData = [];
                this.headBlockerPids = [];
                this.updateKPIs(0, 0, 0, 0);
                this.renderEmptyTable('Vui lòng chọn kết nối để bắt đầu giám sát.');
                this.updateStatus('Chưa chọn kết nối', 'dot-paused');
            }
        }

        async refresh() {
            if (!this.currentConnId || this.isLoading) return;
            this.isLoading = true;

            const icon = document.getElementById('actRefreshIcon');
            if (icon) icon.classList.add('fa-spin');

            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (!api || typeof api.activity_get_sessions !== 'function') {
                    throw new Error('API giám sát phiên (activity_get_sessions) không khả dụng.');
                }

                const res = await api.activity_get_sessions(this.currentConnId, null, false);
                if (!res || !res.success) {
                    throw new Error(res?.error || 'Lỗi không xác định khi tải dữ liệu phiên.');
                }

                this.sessionsData = res.sessions || [];
                this.headBlockerPids = res.head_blocker_pids || [];
                this.currentSpid = res.current_spid || null;

                const counts = res.counts || {
                    total: this.sessionsData.length,
                    active: this.sessionsData.filter(s => s.status === 'running').length,
                    blocked: this.sessionsData.filter(s => s.is_blocked).length,
                    head_blockers: this.headBlockerPids.length
                };

                this.updateKPIs(counts.total, counts.active, counts.blocked, counts.head_blockers);
                this.applyFilterAndRender();

                const now = new Date();
                this.lastUpdated = now.toLocaleTimeString();
                document.getElementById('actLastUpdatedMsg').textContent = `Cập nhật lúc: ${this.lastUpdated}`;
                document.getElementById('actSpidSelfMsg').textContent = `SPID của bạn: ${this.currentSpid || '—'}`;

                this.updateStatus(`Hoạt động bình thường (${this.sessionsData.length} phiên)`, '');
            } catch (err) {
                console.error('[ActivityMonitor] Refresh error:', err);
                this.updateStatus(`Lỗi: ${err.message}`, 'dot-error');
            } finally {
                this.isLoading = false;
                if (icon) icon.classList.remove('fa-spin');
            }
        }

        startAutoRefresh() {
            this.stopAutoRefresh();
            if (this.refreshIntervalSec > 0) {
                this.refreshTimer = setInterval(() => {
                    this.refresh();
                }, this.refreshIntervalSec * 1000);
            }
        }

        stopAutoRefresh() {
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
        }

        updateKPIs(total, active, blocked, headBlockers) {
            document.getElementById('kpiValTotal').textContent = total || 0;
            document.getElementById('kpiValActive').textContent = active || 0;
            document.getElementById('kpiValBlocked').textContent = blocked || 0;
            document.getElementById('kpiValHeadBlockers').textContent = headBlockers || 0;

            const badge = document.getElementById('kpiHeadBadge');
            if (badge) {
                if (headBlockers > 0) {
                    badge.classList.remove('d-none');
                } else {
                    badge.classList.add('d-none');
                }
            }

            // Sync visual selected state on cards based on current filter
            document.getElementById('kpiCardTotal')?.classList.toggle('kpi-selected', this.stateFilter === 'all');
            document.getElementById('kpiCardActive')?.classList.toggle('kpi-selected', this.stateFilter === 'active');
            document.getElementById('kpiCardBlocked')?.classList.toggle('kpi-selected', this.stateFilter === 'blocked');
            document.getElementById('kpiCardHeadBlockers')?.classList.toggle('kpi-selected', this.stateFilter === 'head_blockers');
        }

        applyFilterAndRender() {
            let list = this.sessionsData;

            // Apply state filter
            if (this.stateFilter === 'active') {
                list = list.filter(s => s.status === 'running' || (s.command && s.command !== 'AWAITING COMMAND'));
            } else if (this.stateFilter === 'blocked') {
                list = list.filter(s => s.is_blocked);
            } else if (this.stateFilter === 'head_blockers') {
                list = list.filter(s => s.is_head_blocker);
            }

            // Apply search query
            if (this.searchQuery) {
                const q = this.searchQuery;
                list = list.filter(s => {
                    return (
                        String(s.session_id).includes(q) ||
                        (s.database_name && s.database_name.toLowerCase().includes(q)) ||
                        (s.login_name && s.login_name.toLowerCase().includes(q)) ||
                        (s.host_name && s.host_name.toLowerCase().includes(q)) ||
                        (s.program_name && s.program_name.toLowerCase().includes(q)) ||
                        (s.sql_text && s.sql_text.toLowerCase().includes(q)) ||
                        (s.wait_type && s.wait_type.toLowerCase().includes(q))
                    );
                });
            }

            this.renderTable(list);
        }

        renderTable(sessions) {
            const tbody = document.getElementById('actSessionsTbody');
            if (!tbody) return;

            if (!sessions || sessions.length === 0) {
                this.renderEmptyTable('Không tìm thấy phiên làm việc nào phù hợp với bộ lọc.');
                return;
            }

            tbody.innerHTML = '';
            sessions.forEach((s) => {
                const tr = document.createElement('tr');
                tr.className = 'activity-row';
                tr.dataset.sessionId = s.session_id;

                // State classes
                if (s.is_head_blocker) {
                    tr.classList.add('row-head-blocker');
                } else if (s.is_blocked) {
                    tr.classList.add('row-blocked');
                } else if (s.is_current_session) {
                    tr.classList.add('row-current-user');
                }

                if (this.selectedSession && this.selectedSession.session_id === s.session_id) {
                    tr.classList.add('row-selected');
                }

                // Status Badge class
                let statusBadgeClass = 'badge-status-sleeping';
                if (s.status === 'running') statusBadgeClass = 'badge-status-running';
                else if (s.status === 'suspended') statusBadgeClass = 'badge-status-suspended';
                else if (s.status === 'rollback') statusBadgeClass = 'badge-status-rollback';

                // Blocking Role column
                let roleHtml = '<span class="text-muted">—</span>';
                if (s.is_head_blocker) {
                    roleHtml = `<span class="badge-role-head-blocker"><i class="fa-solid fa-triangle-exclamation"></i> Gốc gây khóa</span>`;
                } else if (s.is_blocked) {
                    roleHtml = `<span class="badge-role-blocked"><i class="fa-solid fa-lock"></i> Chặn bởi #${s.blocking_session_id}</span>`;
                }

                // Self badge
                let selfBadgeHtml = '';
                if (s.is_current_session) {
                    selfBadgeHtml = `<span class="badge-role-self">BẠN</span>`;
                }

                // Action buttons (Cancel / Kill)
                const isSelf = s.is_current_session;
                const cancelDisabled = isSelf || (s.status !== 'running' && !s.command);
                const killDisabled = isSelf;

                tr.innerHTML = `
                    <td class="col-spid"><strong>${s.session_id}</strong>${selfBadgeHtml}</td>
                    <td class="col-status"><span class="badge-act-status ${statusBadgeClass}">${this.escapeHtml(s.status || 'unknown')}</span></td>
                    <td class="col-block-role">${roleHtml}</td>
                    <td class="col-db" title="${this.escapeHtml(s.database_name || '')}">${this.escapeHtml(s.database_name || '—')}</td>
                    <td class="col-user" title="${this.escapeHtml(s.login_name || '')}">${this.escapeHtml(s.login_name || '—')}</td>
                    <td class="col-host" title="${this.escapeHtml(s.host_name || '')}">${this.escapeHtml(s.host_name || '—')}</td>
                    <td class="col-program" title="${this.escapeHtml(s.program_name || '')}">${this.escapeHtml(s.program_name || '—')}</td>
                    <td class="col-cpu">${(s.cpu_time_ms || 0).toLocaleString()}</td>
                    <td class="col-reads">${(s.reads || 0).toLocaleString()}</td>
                    <td class="col-writes">${(s.writes || 0).toLocaleString()}</td>
                    <td class="col-elapsed">${this.formatDuration(s.total_elapsed_time_ms)}</td>
                    <td class="col-wait" title="${this.escapeHtml(s.wait_type || '')}">${this.escapeHtml(s.wait_type || '—')}</td>
                    <td class="col-sql" title="${this.escapeHtml(s.sql_text || '')}">${this.escapeHtml(s.sql_text ? s.sql_text.substring(0, 150) : '—')}</td>
                    <td class="col-actions">
                        <button type="button" class="activity-row-action-btn btn-act-cancel" data-action="cancel" ${cancelDisabled ? 'disabled' : ''} title="${isSelf ? 'Không thể huỷ phiên của chính mình' : 'Huỷ câu lệnh đang chạy (Cancel Query)'}">
                            <i class="fa-solid fa-ban"></i>
                        </button>
                        <button type="button" class="activity-row-action-btn btn-act-kill" data-action="kill" ${killDisabled ? 'disabled' : ''} title="${isSelf ? 'Không thể ngắt phiên của chính mình' : 'Buộc dừng phiên (Kill/Terminate Session)'}">
                            <i class="fa-solid fa-power-off"></i>
                        </button>
                    </td>
                `;

                // Row click to inspect SQL
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return; // ignore click on buttons
                    this.selectRow(s, tr);
                });

                // Row action buttons
                tr.querySelector('.btn-act-cancel')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.confirmAction('cancel', s);
                });

                tr.querySelector('.btn-act-kill')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.confirmAction('kill', s);
                });

                tbody.appendChild(tr);
            });
        }

        renderEmptyTable(msg) {
            const tbody = document.getElementById('actSessionsTbody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="14">
                            <div class="activity-state-message">
                                <i class="fa-solid fa-circle-info activity-state-icon"></i>
                                <span class="activity-state-text">${this.escapeHtml(msg)}</span>
                            </div>
                        </td>
                    </tr>
                `;
            }
        }

        selectRow(session, rowEl) {
            this.selectedSession = session;

            // Update row selections
            document.querySelectorAll('.activity-row.row-selected').forEach(r => r.classList.remove('row-selected'));
            if (rowEl) rowEl.classList.add('row-selected');

            const titleEl = document.getElementById('actSqlInspectorTitle');
            const bodyEl = document.getElementById('actSqlInspectorBody');

            if (titleEl) {
                const spidText = session.session_id ? `SPID: ${session.session_id}` : 'Chưa rõ SPID';
                const dbText = session.database_name ? ` (DB: ${session.database_name})` : '';
                const userText = session.login_name ? ` [User: ${session.login_name}]` : '';
                titleEl.textContent = `Chi tiết câu lệnh SQL — ${spidText}${dbText}${userText}`;
            }

            if (bodyEl) {
                bodyEl.textContent = session.sql_text || '-- Phiên này hiện không thực thi câu lệnh SQL nào (Awaiting next command)';
            }
        }

        resetSqlInspector() {
            const titleEl = document.getElementById('actSqlInspectorTitle');
            const bodyEl = document.getElementById('actSqlInspectorBody');
            if (titleEl) titleEl.textContent = 'Chi tiết câu lệnh SQL (Chưa chọn phiên nào)';
            if (bodyEl) bodyEl.textContent = '-- Nhấn vào bất kỳ dòng nào trên bảng để xem chi tiết câu lệnh SQL đang thực thi';
        }

        copyCurrentSql() {
            const bodyEl = document.getElementById('actSqlInspectorBody');
            if (!bodyEl) return;
            const text = bodyEl.textContent || '';
            if (!text || text.startsWith('--')) {
                return;
            }

            if (window.copyToClipboard) {
                window.copyToClipboard(text);
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
            }

            const copyBtn = document.getElementById('actBtnCopySql');
            if (copyBtn) {
                const orig = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fa-solid fa-check text-success"></i> Đã chép!';
                setTimeout(() => {
                    copyBtn.innerHTML = orig;
                }, 1500);
            }
        }

        confirmAction(actionType, session) {
            const modal = document.getElementById('actConfirmModal');
            const titleEl = document.getElementById('actModalTitle');
            const warningEl = document.getElementById('actModalWarningText');
            const descEl = document.getElementById('actModalDetailDesc');
            const sqlPreviewEl = document.getElementById('actModalSqlPreview');
            const confirmBtn = document.getElementById('actModalConfirmBtn');

            if (!modal) return;

            if (session.is_current_session) {
                alert('An toàn: Không được phép huỷ hoặc ngắt kết nối phiên làm việc của chính bạn.');
                return;
            }

            if (actionType === 'cancel') {
                titleEl.textContent = `Hủy truy vấn đang chạy (SPID: ${session.session_id})`;
                warningEl.textContent = 'Câu lệnh truy vấn đang chạy trên phiên này sẽ bị hủy (CANCEL/KILL QUERY). Phiên kết nối vẫn được giữ nguyên.';
                confirmBtn.className = 'btn-modal-warning';
                confirmBtn.textContent = 'Hủy truy vấn ngay';
            } else {
                titleEl.textContent = `Buộc dừng kết nối phiên (KILL SPID: ${session.session_id})`;
                warningEl.textContent = 'CẢNH BÁO: Phiên làm việc sẽ bị đóng ngay lập tức! Bất kỳ giao dịch (Transaction) dở dang nào sẽ bị ROLLBACK hoàn toàn.';
                confirmBtn.className = 'btn-modal-danger';
                confirmBtn.textContent = 'Buộc dừng (KILL) phiên';
            }

            descEl.innerHTML = `
                <div><strong>Database:</strong> ${this.escapeHtml(session.database_name || '—')}</div>
                <div><strong>Login / Host:</strong> ${this.escapeHtml(session.login_name || '—')} / ${this.escapeHtml(session.host_name || '—')}</div>
                <div><strong>Trạng thái:</strong> ${this.escapeHtml(session.status || 'unknown')}</div>
            `;

            sqlPreviewEl.textContent = session.sql_text || '(Không có câu lệnh SQL)';

            confirmBtn.onclick = async () => {
                this.hideModal();
                await this.executeAction(actionType, session.session_id);
            };

            modal.classList.remove('d-none');
        }

        hideModal() {
            const modal = document.getElementById('actConfirmModal');
            if (modal) modal.classList.add('d-none');
        }

        async executeAction(actionType, sessionId) {
            this.updateStatus(`Đang thực hiện ${actionType.toUpperCase()} trên SPID ${sessionId}...`, 'dot-paused');
            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (!api) throw new Error('API Native bridge không phản hồi.');

                let res = null;
                if (actionType === 'cancel') {
                    res = await api.activity_cancel_session(this.currentConnId, sessionId);
                } else {
                    res = await api.activity_kill_session(this.currentConnId, sessionId);
                }

                if (!res || !res.success) {
                    throw new Error(res?.error || 'Thao tác không thành công.');
                }

                this.updateStatus(`Thành công: Đã gửi lệnh ${actionType.toUpperCase()} tới SPID ${sessionId}.`, '');
                // Immediate refresh to observe effect
                setTimeout(() => this.refresh(), 800);
            } catch (err) {
                console.error(`[ActivityMonitor] Error executing ${actionType}:`, err);
                alert(`Lỗi khi thực hiện thao tác: ${err.message}`);
                this.updateStatus(`Lỗi: ${err.message}`, 'dot-error');
            }
        }

        async popOut() {
            if (!this.currentConnId) {
                alert('Vui lòng chọn một kết nối trước khi bung ra cửa sổ riêng.');
                return;
            }

            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.open_activity_monitor_window === 'function') {
                    await api.open_activity_monitor_window(this.currentConnId, this.currentDbType);
                } else {
                    alert('Chức năng mở cửa sổ riêng biệt chỉ hỗ trợ trong môi trường pywebview desktop.');
                }
            } catch (err) {
                console.error('[ActivityMonitor] Pop-out error:', err);
                alert(`Không thể mở cửa sổ độc lập: ${err.message}`);
            }
        }

        updateStatus(msg, dotClass) {
            const msgEl = document.getElementById('actStatusMsg');
            const dotEl = document.getElementById('actStatusDot');
            if (msgEl) msgEl.textContent = msg;
            if (dotEl) {
                dotEl.className = 'status-indicator-dot';
                if (dotClass) dotEl.classList.add(dotClass);
            }
        }

        formatDuration(ms) {
            if (!ms || ms <= 0) return '0s';
            const totalSec = Math.floor(ms / 1000);
            if (totalSec < 60) return `${totalSec}s`;
            const min = Math.floor(totalSec / 60);
            const sec = totalSec % 60;
            if (min < 60) return `${min}m ${sec}s`;
            const hr = Math.floor(min / 60);
            const remMin = min % 60;
            return `${hr}h ${remMin}m`;
        }

        escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        activateTab(tabId) {
            // Called by tabs.js when switching to activity-monitor tab
            if (this.currentConnId) {
                this.refresh();
                this.startAutoRefresh();
            } else {
                this.loadConnections();
            }
        }
    }

    global.ActivityMonitor = new ActivityMonitorComponent();
})(window);
