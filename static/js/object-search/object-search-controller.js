/**
 * object-search-controller.js
 * Main Controller orchestrating UI layout, store, viewer, and match navigation.
 */
(function (global) {
    'use strict';

    class ObjectContentSearchController {
        constructor() {
            this.container = null;
            this.store = new global.ObjectSearchStore();
            this.ddlViewer = null;
            this.matchPanel = null;
            this.activeTabId = null;
            this.tabSessions = new Map();
            this.initialized = false;
        }

        init(containerId = 'object-content-search-container') {
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.error('[ObjectSearch] Container element not found:', containerId);
                return;
            }

            this._renderLayout();
            this._initComponents();
            this._bindEvents();
            this._setupResizers();
            this._syncScopeFromEnv();
            this.initialized = true;
        }

        _renderLayout() {
            this.container.innerHTML = `
                <!-- Top Toolbar -->
                <div class="ocs-toolbar d-flex align-items-center justify-content-between">
                    <!-- Scope Selectors: Connection, Database & Schema (Isolated, Fixed Length, Never Shrinks) -->
                    <div class="ocs-scope-selectors flex-shrink-0" title="Chọn Server, Database và Schema tìm kiếm">
                        <!-- Connection Dropdown -->
                        <div class="dropdown d-inline-block">
                            <button class="ocs-scope-btn dropdown-toggle" type="button" id="ocs-ctx-connection"
                                data-bs-toggle="dropdown" aria-expanded="false" title="Đổi Server / Connection"
                                data-bs-popper-config='{"strategy":"fixed"}'>
                                <i class="fa-solid fa-server text-success me-1" style="font-size: 11px;"></i>
                                <span id="ocs-conn-label" class="text-truncate" style="max-width: 110px;">No server</span>
                            </button>
                            <ul class="dropdown-menu shadow" id="ocs-conn-menu" aria-labelledby="ocs-ctx-connection"
                                style="min-width: 210px; max-height: 280px; overflow-y: auto; font-size: 12px;">
                                <li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading connections…</span></li>
                            </ul>
                        </div>

                        <span class="text-muted small px-1" style="font-size: 11px;">›</span>

                        <!-- Database Dropdown -->
                        <div class="dropdown d-inline-block">
                            <button class="ocs-scope-btn dropdown-toggle" type="button" id="ocs-ctx-database"
                                data-bs-toggle="dropdown" aria-expanded="false" title="Đổi Database"
                                data-bs-popper-config='{"strategy":"fixed"}'>
                                <i class="fa-solid fa-database text-info me-1" style="font-size: 11px;"></i>
                                <span id="ocs-db-label" class="text-truncate" style="max-width: 110px;">master</span>
                            </button>
                            <ul class="dropdown-menu shadow" id="ocs-db-menu" aria-labelledby="ocs-ctx-database"
                                style="min-width: 190px; max-height: 280px; overflow-y: auto; font-size: 12px;">
                                <li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading databases…</span></li>
                            </ul>
                        </div>

                        <span class="text-muted small px-1" style="font-size: 11px;">›</span>

                        <!-- Schema Dropdown -->
                        <div class="dropdown d-inline-block">
                            <button class="ocs-scope-btn dropdown-toggle" type="button" id="ocs-ctx-schema"
                                data-bs-toggle="dropdown" aria-expanded="false" title="Đổi Schema (Mặc định: Tất cả schemas)"
                                data-bs-popper-config='{"strategy":"fixed"}'>
                                <i class="fa-solid fa-layer-group text-warning me-1" style="font-size: 11px;"></i>
                                <span id="ocs-schema-label" class="text-truncate" style="max-width: 100px;">All Schemas</span>
                            </button>
                            <ul class="dropdown-menu shadow" id="ocs-schema-menu" aria-labelledby="ocs-ctx-schema"
                                style="min-width: 180px; max-height: 280px; overflow-y: auto; font-size: 12px;">
                                <li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading schemas…</span></li>
                            </ul>
                        </div>
                    </div>

                    <!-- Divider between Connection cluster and Search Cluster -->
                    <div class="ocs-toolbar-divider"></div>

                    <span id="ocs-scope-text" class="d-none"></span>

                    <!-- Search Cluster (Fills all remaining available space in center) -->
                    <div class="ocs-search-cluster flex-grow-1" title="Nhập từ khóa và tìm kiếm">
                        <span class="ocs-search-addon"><i class="fa-solid fa-magnifying-glass"></i></span>
                        <input type="text" id="ocs-keyword-input" class="ocs-keyword-input"
                            placeholder="Tìm kiếm trong nội dung DDL (nhập từ khóa rồi Enter)..." autocomplete="off">
                        <button type="button" id="ocs-btn-clear" class="ocs-clear-btn-inline d-none" title="Xóa từ khóa (Esc)">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                        <div class="ocs-search-cluster-inner-divider"></div>
                        <button type="button" class="ocs-toggle-btn" id="ocs-btn-case" title="Phân biệt chữ hoa / thường (Alt+C)">Aa</button>
                        <button type="button" class="ocs-toggle-btn" id="ocs-btn-whole" title="Khớp toàn bộ từ (Alt+W)">\\b</button>
                        <button type="button" class="ocs-toggle-btn" id="ocs-btn-regex" title="Biểu thức chính quy (Alt+R)">.*</button>
                        <button id="ocs-btn-search" title="Bắt đầu tìm kiếm (Enter)">
                            <i class="fa-solid fa-magnifying-glass me-1"></i>Tìm
                        </button>
                        <div class="dropdown d-inline-block h-100">
                            <button id="ocs-btn-history" class="dropdown-toggle h-100" data-bs-toggle="dropdown" aria-expanded="false" title="Lịch sử tìm kiếm">
                                <i class="fa-solid fa-clock-rotate-left"></i>
                            </button>
                            <ul id="ocs-history-menu" class="dropdown-menu shadow" style="font-size: 12px; min-width: 180px;">
                                <li><span class="dropdown-item text-muted">Chưa có lịch sử</span></li>
                            </ul>
                        </div>
                    </div>

                    <!-- Divider between Search cluster and Filters -->
                    <div class="ocs-toolbar-divider"></div>

                    <!-- Right Cluster: Object Type Checkboxes + Match Navigation Controls -->
                    <div class="d-flex align-items-center gap-2 flex-shrink-0">
                        <!-- Object Type Checkboxes -->
                        <div class="ocs-filter-group flex-shrink-0">
                            <div class="form-check form-check-inline m-0">
                                <input class="form-check-input" type="checkbox" id="ocs-cb-view" value="VIEW" checked>
                                <label class="form-check-label" for="ocs-cb-view">View</label>
                            </div>
                            <div class="form-check form-check-inline m-0">
                                <input class="form-check-input" type="checkbox" id="ocs-cb-procedure" value="PROCEDURE" checked>
                                <label class="form-check-label" for="ocs-cb-procedure">Procedure</label>
                            </div>
                            <div class="form-check form-check-inline m-0">
                                <input class="form-check-input" type="checkbox" id="ocs-cb-function" value="FUNCTION" checked>
                                <label class="form-check-label" for="ocs-cb-function">Function</label>
                            </div>
                            <div class="form-check form-check-inline m-0">
                                <input class="form-check-input" type="checkbox" id="ocs-cb-trigger" value="TRIGGER" checked>
                                <label class="form-check-label" for="ocs-cb-trigger">Trigger</label>
                            </div>
                        </div>

                        <!-- Divider -->
                        <div class="ocs-toolbar-divider"></div>

                        <!-- Match Navigation Controls -->
                        <div class="ocs-nav-controls flex-shrink-0">
                            <span id="ocs-match-counter" class="ocs-match-counter">0 / 0</span>
                            <button type="button" id="ocs-btn-prev" class="ocs-nav-btn" title="Vị trí trước (Shift+F3)" disabled>
                                <i class="fa-solid fa-chevron-up"></i>
                            </button>
                            <button type="button" id="ocs-btn-next" class="ocs-nav-btn" title="Vị trí tiếp (F3)" disabled>
                                <i class="fa-solid fa-chevron-down"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Main 3-Pane Body -->
                <div class="ocs-body d-flex flex-grow-1 overflow-hidden">
                    <!-- Left: Object Results List -->
                    <div class="ocs-results-pane d-flex flex-column" id="ocs-results-pane">
                        <div class="ocs-results-header d-flex flex-column gap-1">
                            <div class="d-flex align-items-center justify-content-between">
                                <span class="fw-semibold text-uppercase" style="font-size: 11.5px; letter-spacing: 0.5px;">
                                    OBJECT RESULTS
                                </span>
                                <span id="ocs-result-summary" class="badge bg-secondary-subtle text-secondary-emphasis" style="font-size: 11px;">0 Objects</span>
                            </div>
                            <div class="d-flex align-items-center gap-1 mt-1">
                                <input type="text" id="ocs-filter-results" class="form-control form-control-sm ocs-filter-results-input flex-grow-1"
                                    placeholder="Lọc danh sách...">
                                <select id="ocs-sort-results" class="form-select form-select-sm" style="width: auto; font-size: 11px; height: 26px; padding: 2px 20px 2px 6px;">
                                    <option value="default">Loại &bull; Tên</option>
                                    <option value="name">Tên (A-Z)</option>
                                    <option value="count">Số khớp (Nhiều nhất)</option>
                                </select>
                            </div>
                        </div>

                        <div class="ocs-results-list flex-grow-1 position-relative" id="ocs-results-list">
                            <div class="ocs-empty-state">
                                <i class="fa-solid fa-magnifying-glass ocs-empty-icon"></i>
                                <div class="fw-semibold mb-1">Tìm kiếm nội dung DDL</div>
                                <div class="small">Nhập từ khóa và bấm Tìm kiếm để xem danh sách Views, Procedures, Functions, Triggers chứa từ khóa.</div>
                            </div>
                        </div>
                    </div>

                    <!-- Vertical Resizer -->
                    <div class="ocs-resizer-vertical" id="ocs-resizer-left"></div>

                    <!-- Right: DDL Viewer + Match Panel -->
                    <div class="ocs-viewer-pane d-flex flex-column flex-grow-1 overflow-hidden">
                        <!-- Viewer Header -->
                        <div class="ocs-viewer-header d-flex align-items-center justify-content-between">
                            <div class="d-flex align-items-center gap-2 text-truncate">
                                <span id="ocs-active-type-badge" class="ocs-type-badge view d-none">VIEW</span>
                                <span id="ocs-active-obj-name" class="fw-semibold text-truncate">Chưa chọn object</span>
                                <span id="ocs-active-match-count" class="badge bg-secondary-subtle text-secondary-emphasis d-none">0 matches</span>
                            </div>

                            <div class="d-flex align-items-center gap-1">
                                <button id="ocs-btn-open-tab" class="btn btn-outline-secondary btn-sm" title="Mở DDL trong tab Query mới để chỉnh sửa / thực thi (Ctrl+Enter)" disabled>
                                    <i class="fa-solid fa-arrow-up-right-from-square me-1"></i>Mở Tab Editor
                                </button>
                                <button id="ocs-btn-copy-ddl" class="btn btn-outline-secondary btn-sm" title="Sao chép toàn bộ DDL" disabled>
                                    <i class="fa-solid fa-copy me-1"></i>Copy DDL
                                </button>
                            </div>
                        </div>

                        <!-- Monaco Viewer Container -->
                        <div class="position-relative flex-grow-1 overflow-hidden">
                            <div id="ocs-monaco-container" style="width: 100%; height: 100%;"></div>
                            <div id="ocs-ddl-loading" class="ocs-loading-overlay d-none">
                                <i class="fa-solid fa-spinner fa-spin me-2"></i>Đang tải definition...
                            </div>
                        </div>

                        <!-- Permission / DDL Warning Alert -->
                        <div id="ocs-ddl-error-banner" class="alert alert-warning m-2 py-1 px-2 d-none" style="font-size: 12px;"></div>

                        <!-- Horizontal Resizer -->
                        <div class="ocs-resizer-horizontal" id="ocs-resizer-match"></div>

                        <!-- Match Location Panel -->
                        <div class="ocs-match-panel d-flex flex-column" id="ocs-match-panel">
                            <div class="ocs-match-panel-header d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center gap-2">
                                    <i class="fa-solid fa-list-check text-info"></i>
                                    <span class="fw-semibold">MATCHES (<span id="ocs-match-panel-count">0</span>)</span>
                                </div>
                                <button id="ocs-btn-toggle-match-panel" class="btn btn-link btn-sm p-0 text-decoration-none text-muted" title="Thu gọn / Mở rộng">
                                    <i class="fa-solid fa-chevron-down"></i>
                                </button>
                            </div>
                            <div class="ocs-match-list flex-grow-1" id="ocs-match-list">
                                <div class="text-muted p-2 text-center" style="font-size: 11px;">
                                    Chưa có object nào được chọn.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        _initComponents() {
            const monacoEl = document.getElementById('ocs-monaco-container');
            this.ddlViewer = new global.DdlViewer(monacoEl);

            const panelEl = document.getElementById('ocs-match-panel');
            const listEl = document.getElementById('ocs-match-list');
            const countEl = document.getElementById('ocs-match-panel-count');
            const toggleBtn = document.getElementById('ocs-btn-toggle-match-panel');

            this.matchPanel = new global.MatchPanel(panelEl, listEl, countEl, toggleBtn, (matchIndex) => {
                this.store.setActiveMatchIndex(matchIndex);
            });

            // Subscribe to store updates
            this.store.subscribe((state, changeType, payload) => {
                this._onStoreChange(state, changeType, payload);
            });
        }

        _bindEvents() {
            const kwInput = document.getElementById('ocs-keyword-input');
            const btnSearch = document.getElementById('ocs-btn-search');
            const btnClear = document.getElementById('ocs-btn-clear');
            const cbView = document.getElementById('ocs-cb-view');
            const cbProc = document.getElementById('ocs-cb-procedure');
            const cbFunc = document.getElementById('ocs-cb-function');
            const cbTrig = document.getElementById('ocs-cb-trigger');
            const btnCase = document.getElementById('ocs-btn-case');
            const btnWhole = document.getElementById('ocs-btn-whole');
            const btnRegex = document.getElementById('ocs-btn-regex');
            const btnPrev = document.getElementById('ocs-btn-prev');
            const btnNext = document.getElementById('ocs-btn-next');
            const filterResInput = document.getElementById('ocs-filter-results');
            const sortResSelect = document.getElementById('ocs-sort-results');
            const btnOpenTab = document.getElementById('ocs-btn-open-tab');
            const btnCopyDdl = document.getElementById('ocs-btn-copy-ddl');
            const listEl = document.getElementById('ocs-results-list');

            // Input typing: show/hide clear button
            kwInput?.addEventListener('input', () => {
                this.store.state.keyword = kwInput.value;
                if (btnClear) {
                    btnClear.classList.toggle('d-none', !kwInput.value);
                }
                if (this.activeTabId && this.tabSessions.has(this.activeTabId)) {
                    this.tabSessions.get(this.activeTabId).keyword = kwInput.value;
                }
            });

            // Enter key triggers search
            kwInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.executeSearch();
                }
            });

            // Clear button
            btnClear?.addEventListener('click', () => {
                kwInput.value = '';
                this.store.state.keyword = '';
                btnClear.classList.add('d-none');
                if (this.activeTabId && this.tabSessions.has(this.activeTabId)) {
                    this.tabSessions.get(this.activeTabId).keyword = '';
                }
                kwInput.focus();
            });

            // Search button
            btnSearch?.addEventListener('click', () => {
                this.executeSearch();
            });

            // Object type filters
            const updateTypeFilters = () => {
                const types = [];
                if (cbView?.checked) types.push('VIEW');
                if (cbProc?.checked) types.push('PROCEDURE');
                if (cbFunc?.checked) types.push('FUNCTION');
                if (cbTrig?.checked) types.push('TRIGGER');
                this.store.state.objectTypes = types;
                this._renderResultsList();
                this._saveTabSession(this.activeTabId);
            };

            cbView?.addEventListener('change', updateTypeFilters);
            cbProc?.addEventListener('change', updateTypeFilters);
            cbFunc?.addEventListener('change', updateTypeFilters);
            cbTrig?.addEventListener('change', updateTypeFilters);

            // Toggle Options: Case Sensitive, Whole Word, Regex
            btnCase?.addEventListener('click', () => {
                this.store.state.caseSensitive = !this.store.state.caseSensitive;
                btnCase.classList.toggle('active', !!this.store.state.caseSensitive);
                this._saveTabSession(this.activeTabId);
            });
            btnWhole?.addEventListener('click', () => {
                this.store.state.wholeWord = !this.store.state.wholeWord;
                btnWhole.classList.toggle('active', !!this.store.state.wholeWord);
                this._saveTabSession(this.activeTabId);
            });
            btnRegex?.addEventListener('click', () => {
                this.store.state.isRegex = !this.store.state.isRegex;
                btnRegex.classList.toggle('active', !!this.store.state.isRegex);
                this._saveTabSession(this.activeTabId);
            });

            // Navigation
            btnPrev?.addEventListener('click', () => { this.store.prevMatch(); });
            btnNext?.addEventListener('click', () => { this.store.nextMatch(); });

            // In-list filter & sort
            filterResInput?.addEventListener('input', () => {
                this.store.state.filterText = filterResInput.value;
                this._renderResultsList();
                this._saveTabSession(this.activeTabId);
            });

            sortResSelect?.addEventListener('change', () => {
                this.store.state.sortBy = sortResSelect.value;
                this._renderResultsList();
                this._saveTabSession(this.activeTabId);
            });

            // Event delegation on Results List (high performance, no per-item listener binding)
            listEl?.addEventListener('click', (e) => {
                const actionBtn = e.target.closest('.ocs-action-btn');
                if (actionBtn) {
                    e.stopPropagation();
                    const itemEl = actionBtn.closest('.ocs-result-item');
                    if (!itemEl) return;
                    const schema = itemEl.dataset.schema;
                    const name = itemEl.dataset.name;
                    const type = itemEl.dataset.type;
                    const action = actionBtn.dataset.action;
                    if (action === 'pin') {
                        this.store.togglePin(schema, name);
                        this._renderResultsList();
                    } else if (action === 'copy') {
                        this._copyText(`${schema}.${name}`);
                        if (typeof showToast === 'function') {
                            showToast(`Đã copy: ${schema}.${name}`, 'info');
                        }
                    } else if (action === 'open-tab') {
                        const obj = { schema, name, type };
                        this.selectObject(obj).then(() => this.openDdlInEditorTab());
                    }
                    return;
                }

                const groupHeader = e.target.closest('.ocs-group-header');
                if (groupHeader) {
                    const groupEl = groupHeader.closest('.ocs-result-group');
                    if (groupEl) groupEl.classList.toggle('collapsed');
                    return;
                }

                const itemEl = e.target.closest('.ocs-result-item');
                if (itemEl) {
                    const schema = itemEl.dataset.schema;
                    const name = itemEl.dataset.name;
                    const type = itemEl.dataset.type;
                    const obj = (this.store.state.results || []).find(r => r.schema === schema && r.name === name) || { schema, name, type };
                    this.selectObject(obj);
                }
            });

            // Actions: Open in Tab & Copy DDL
            btnOpenTab?.addEventListener('click', () => {
                this.openDdlInEditorTab();
            });

            btnCopyDdl?.addEventListener('click', () => {
                this.copyDdlToClipboard();
            });

            // Keyboard shortcut (F3 for next, Shift+F3 for prev, Alt+C/W/R for toggles)
            this.container?.addEventListener('keydown', (e) => {
                if (e.key === 'F3') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.store.prevMatch();
                    } else {
                        this.store.nextMatch();
                    }
                } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
                    e.preventDefault();
                    btnCase?.click();
                } else if (e.altKey && (e.key === 'w' || e.key === 'W')) {
                    e.preventDefault();
                    btnWhole?.click();
                } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
                    e.preventDefault();
                    btnRegex?.click();
                }
            });

            // Initialize Connection & Database scope dropdowns
            this._initScopeDropdowns();
        }

        _setupResizers() {
            // Left Resizer
            const resizerLeft = document.getElementById('ocs-resizer-left');
            const resultsPane = document.getElementById('ocs-results-pane');
            if (resizerLeft && resultsPane) {
                // Restore persisted results pane width
                try {
                    const savedW = localStorage.getItem('ocs-results-pane-width');
                    if (savedW) {
                        const parsedW = parseInt(savedW, 10);
                        if (!isNaN(parsedW) && parsedW >= 200 && parsedW <= 700) {
                            resultsPane.style.width = `${parsedW}px`;
                        }
                    }
                } catch (_) {}

                let isDragging = false;
                let startX = 0;
                let startWidth = 0;
                let currentWidth = 0;
                let rafId = null;

                resizerLeft.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    startX = e.clientX;
                    startWidth = resultsPane.offsetWidth;
                    currentWidth = startWidth;
                    resizerLeft.classList.add('resizing');
                    document.body.classList.add('ocs-resizing-col');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    currentWidth = Math.max(200, Math.min(700, startWidth + (e.clientX - startX)));
                    if (!rafId) {
                        rafId = requestAnimationFrame(() => {
                            rafId = null;
                            if (!isDragging) return;
                            resultsPane.style.width = `${currentWidth}px`;
                            this.ddlViewer?.layout();
                        });
                    }
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        if (rafId) {
                            cancelAnimationFrame(rafId);
                            rafId = null;
                        }
                        resizerLeft.classList.remove('resizing');
                        document.body.classList.remove('ocs-resizing-col');
                        resultsPane.style.width = `${currentWidth}px`;
                        try {
                            localStorage.setItem('ocs-results-pane-width', currentWidth);
                        } catch (_) {}
                        this.ddlViewer?.layout();
                    }
                });
            }

            // Bottom Resizer
            const resizerMatch = document.getElementById('ocs-resizer-match');
            const matchPanel = document.getElementById('ocs-match-panel');
            if (resizerMatch && matchPanel) {
                // Restore persisted match panel height
                try {
                    const savedH = localStorage.getItem('ocs-match-panel-height');
                    if (savedH) {
                        const parsedH = parseInt(savedH, 10);
                        if (!isNaN(parsedH) && parsedH >= 50 && parsedH <= 500) {
                            matchPanel.style.height = `${parsedH}px`;
                        }
                    }
                } catch (_) {}

                let isDragging = false;
                let startY = 0;
                let startHeight = 0;
                let currentHeight = 0;
                let rafId = null;

                resizerMatch.addEventListener('mousedown', (e) => {
                    isDragging = true;
                    startY = e.clientY;
                    startHeight = matchPanel.offsetHeight;
                    currentHeight = startHeight;
                    resizerMatch.classList.add('resizing');
                    document.body.classList.add('ocs-resizing-row');
                    e.preventDefault();
                });

                document.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    currentHeight = Math.max(50, Math.min(500, startHeight - (e.clientY - startY)));
                    if (!rafId) {
                        rafId = requestAnimationFrame(() => {
                            rafId = null;
                            if (!isDragging) return;
                            matchPanel.style.height = `${currentHeight}px`;
                            this.ddlViewer?.layout();
                        });
                    }
                });

                document.addEventListener('mouseup', () => {
                    if (isDragging) {
                        isDragging = false;
                        if (rafId) {
                            cancelAnimationFrame(rafId);
                            rafId = null;
                        }
                        resizerMatch.classList.remove('resizing');
                        document.body.classList.remove('ocs-resizing-row');
                        matchPanel.style.height = `${currentHeight}px`;
                        try {
                            localStorage.setItem('ocs-match-panel-height', currentHeight);
                        } catch (_) {}
                        this.ddlViewer?.layout();
                    }
                });
            }
        }

        async executeSearch() {
            const kw = (this.store.state.keyword || '').trim();
            if (!kw) {
                if (typeof showToast === 'function') {
                    showToast('Vui lòng nhập từ khóa tìm kiếm', 'warning');
                }
                return;
            }

            // Sync scope from active connection only if not yet set
            if (!this.store.state.connectionId) {
                await this._syncScopeFromEnv();
            }

            this.store.setSearching(true);
            this.store.addToHistory(kw);
            this._renderHistoryMenu();

            const listEl = document.getElementById('ocs-results-list');
            if (listEl) {
                listEl.innerHTML = `
                    <div class="ocs-loading-state">
                        <i class="fa-solid fa-spinner fa-spin me-2"></i>Đang tìm kiếm objects...
                    </div>
                `;
            }

            try {
                const res = await global.ObjectSearchApi.search({
                    connectionId: this.store.state.connectionId,
                    keyword: kw,
                    database: this.store.state.database,
                    schema: this.store.state.schema,
                    objectTypes: this.store.state.objectTypes,
                    caseSensitive: this.store.state.caseSensitive,
                    wholeWord: this.store.state.wholeWord,
                    isRegex: this.store.state.isRegex
                });

                if (res && res.success) {
                    this.store.setResults(res.objects || []);
                    // Auto-select first object if any
                    const filtered = this.store.getFilteredResults();
                    if (filtered.length > 0) {
                        this.selectObject(filtered[0]);
                    } else {
                        this.ddlViewer?.clear();
                    }
                } else {
                    this.store.setResults([], res?.error || 'Tìm kiếm thất bại');
                }
            } catch (err) {
                this.store.setResults([], err.message);
            } finally {
                this._saveTabSession(this.activeTabId);
            }
        }

        async selectObject(obj) {
            if (!obj) return;
            this.store.state.selectedObject = obj;
            this.store.setLoadingDdl(true);

            // Update UI selection
            this._updateActiveResultItem();

            // Show loading overlay
            const overlay = document.getElementById('ocs-ddl-loading');
            if (overlay) overlay.classList.remove('d-none');

            // Update header info
            this._updateViewerHeader(obj);

            try {
                const res = await global.ObjectSearchApi.getDdl({
                    connectionId: this.store.state.connectionId,
                    schema: obj.schema,
                    name: obj.name,
                    objectType: obj.type,
                    database: this.store.state.database,
                    keyword: this.store.state.keyword,
                    caseSensitive: this.store.state.caseSensitive,
                    wholeWord: this.store.state.wholeWord,
                    isRegex: this.store.state.isRegex
                });

                if (overlay) overlay.classList.add('d-none');

                if (res && res.success) {
                    if (this.activeTabId && this.tabSessions.has(this.activeTabId)) {
                        const session = this.tabSessions.get(this.activeTabId);
                        if (typeof monaco !== 'undefined' && monaco.editor && monaco.editor.createModel) {
                            if (!session.monacoModel || session.monacoModel.isDisposed()) {
                                session.monacoModel = monaco.editor.createModel(res.ddl, 'sql');
                            } else {
                                if (session.monacoModel.getValue() !== res.ddl) {
                                    session.monacoModel.setValue(res.ddl);
                                }
                            }
                        }
                    }
                    this.store.setSelectedObject(obj, res);
                } else {
                    this.store.setSelectedObject(obj, null, res?.error || 'Không tải được DDL');
                }
            } catch (err) {
                if (overlay) overlay.classList.add('d-none');
                this.store.setSelectedObject(obj, null, err.message);
            } finally {
                this._saveTabSession(this.activeTabId);
            }
        }

        _onStoreChange(state, changeType, payload) {
            if (changeType === 'results_updated') {
                this._renderResultsList();
            } else if (changeType === 'selected_object_changed') {
                const { obj, ddlData, error } = payload;
                const errBanner = document.getElementById('ocs-ddl-error-banner');
                const btnOpenTab = document.getElementById('ocs-btn-open-tab');
                const btnCopyDdl = document.getElementById('ocs-btn-copy-ddl');

                if (error) {
                    if (errBanner) {
                        errBanner.textContent = error;
                        errBanner.classList.remove('d-none');
                    }
                    this.ddlViewer?.clear();
                    this.matchPanel?.setMatches([], '', -1);
                    if (btnOpenTab) btnOpenTab.disabled = true;
                    if (btnCopyDdl) btnCopyDdl.disabled = true;
                } else if (ddlData) {
                    if (errBanner) errBanner.classList.add('d-none');
                    const session = this.activeTabId ? this.tabSessions.get(this.activeTabId) : null;
                    if (session && session.monacoModel && !session.monacoModel.isDisposed()) {
                        this.ddlViewer?.setModel(session.monacoModel, ddlData.matches, state.activeMatchIndex);
                    } else {
                        this.ddlViewer?.setDefinition(ddlData.ddl, ddlData.matches, state.activeMatchIndex);
                    }
                    this.matchPanel?.setMatches(ddlData.matches, state.keyword, state.activeMatchIndex);
                    if (btnOpenTab) btnOpenTab.disabled = false;
                    if (btnCopyDdl) btnCopyDdl.disabled = false;
                }
                this._updateNavCounter();
            } else if (changeType === 'active_match_changed') {
                const activeIndex = payload;
                this.ddlViewer?.setActiveMatch(activeIndex);
                this.matchPanel?.setActiveIndex(activeIndex);
                this._updateNavCounter();
            } else if (changeType === 'scope_changed') {
                this._updateScopeBadge();
            }
        }

        _renderResultsList() {
            const listEl = document.getElementById('ocs-results-list');
            const summaryBadge = document.getElementById('ocs-result-summary');
            if (!listEl) return;

            const items = this.store.getFilteredResults();
            const totalMatches = items.reduce((sum, item) => sum + (item.match_count || 0), 0);

            if (summaryBadge) {
                summaryBadge.textContent = `${items.length} Objects (${totalMatches} matches)`;
            }

            if (this.store.state.error) {
                listEl.innerHTML = `
                    <div class="ocs-empty-state text-danger">
                        <i class="fa-solid fa-triangle-exclamation ocs-empty-icon"></i>
                        <div class="fw-semibold mb-1">Lỗi tìm kiếm</div>
                        <div class="small">${escapeHtml(this.store.state.error)}</div>
                    </div>
                `;
                return;
            }

            if (items.length === 0) {
                listEl.innerHTML = `
                    <div class="ocs-empty-state">
                        <i class="fa-solid fa-magnifying-glass-chart ocs-empty-icon"></i>
                        <div class="fw-semibold mb-1">Không tìm thấy kết quả</div>
                        <div class="small">Không có View, Procedure, Function hoặc Trigger nào chứa từ khóa "${escapeHtml(this.store.state.keyword)}".</div>
                    </div>
                `;
                return;
            }

            // Group by Object Type
            const groups = {
                'VIEW': { title: 'Views', icon: 'fa-table-columns', items: [] },
                'PROCEDURE': { title: 'Procedures', icon: 'fa-gears', items: [] },
                'FUNCTION': { title: 'Functions', icon: 'fa-cube', items: [] },
                'TRIGGER': { title: 'Triggers', icon: 'fa-bolt', items: [] }
            };

            items.forEach(item => {
                const t = (item.type || 'VIEW').toUpperCase();
                if (groups[t]) {
                    groups[t].items.push(item);
                } else {
                    if (!groups['OTHER']) groups['OTHER'] = { title: 'Others', icon: 'fa-box', items: [] };
                    groups['OTHER'].items.push(item);
                }
            });

            const htmlParts = [];
            Object.keys(groups).forEach(typeKey => {
                const group = groups[typeKey];
                if (!group || group.items.length === 0) return;

                htmlParts.push(`
                    <div class="ocs-result-group">
                        <div class="ocs-group-header">
                            <span class="ocs-group-title">
                                <i class="fa-solid ${group.icon} me-1 text-primary"></i>
                                ${group.title} (${group.items.length})
                            </span>
                            <i class="fa-solid fa-chevron-down ocs-group-chevron"></i>
                        </div>
                        <div class="ocs-group-items">
                `);

                group.items.forEach(obj => {
                    const isSel = this.store.state.selectedObject && 
                        this.store.state.selectedObject.name === obj.name && 
                        this.store.state.selectedObject.schema === obj.schema;
                    const isPinned = this.store.isPinned(obj.schema, obj.name);

                    htmlParts.push(`
                        <div class="ocs-result-item${isSel ? ' active' : ''}" data-name="${escapeHtml(obj.name)}" data-schema="${escapeHtml(obj.schema)}" data-type="${escapeHtml(obj.type)}">
                            <div class="ocs-result-item-info">
                                <span class="ocs-result-item-name" title="${escapeHtml(obj.name)}">
                                    ${isPinned ? '<i class="fa-solid fa-thumbtack text-warning me-1"></i>' : ''}${escapeHtml(obj.name)}
                                </span>
                                <span class="ocs-result-item-schema">${escapeHtml(obj.schema)} &bull; ${escapeHtml(obj.type)}</span>
                            </div>
                            <span class="ocs-match-badge">${obj.match_count} ${obj.match_count === 1 ? 'match' : 'matches'}</span>
                            <div class="ocs-item-actions">
                                <button class="ocs-action-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Bỏ ghim' : 'Ghim lên đầu'}" data-action="pin">
                                    <i class="fa-solid fa-thumbtack"></i>
                                </button>
                                <button class="ocs-action-btn" title="Sao chép tên object" data-action="copy">
                                    <i class="fa-solid fa-copy"></i>
                                </button>
                                <button class="ocs-action-btn" title="Mở DDL trong tab mới" data-action="open-tab">
                                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                </button>
                            </div>
                        </div>
                    `);
                });

                htmlParts.push(`
                        </div>
                    </div>
                `);
            });

            listEl.innerHTML = htmlParts.join('');
        }

        _updateActiveResultItem() {
            const listEl = document.getElementById('ocs-results-list');
            if (!listEl) return;
            const cur = this.store.state.selectedObject;
            listEl.querySelectorAll('.ocs-result-item').forEach(el => {
                if (cur && el.dataset.name === cur.name && el.dataset.schema === cur.schema) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
                }
            });
        }

        _updateViewerHeader(obj) {
            const titleEl = document.getElementById('ocs-active-obj-name');
            const typeBadge = document.getElementById('ocs-active-type-badge');
            const matchCountBadge = document.getElementById('ocs-active-match-count');

            if (!obj) {
                if (titleEl) {
                    titleEl.textContent = 'Chưa chọn object';
                    titleEl.title = '';
                }
                if (typeBadge) {
                    typeBadge.classList.add('d-none');
                }
                if (matchCountBadge) {
                    matchCountBadge.classList.add('d-none');
                }
                return;
            }

            if (titleEl) {
                titleEl.textContent = `${obj.schema}.${obj.name}`;
                titleEl.title = `${obj.schema}.${obj.name}`;
            }

            if (typeBadge) {
                typeBadge.textContent = obj.type;
                typeBadge.className = `ocs-type-badge ${(obj.type || 'view').toLowerCase()}`;
                typeBadge.classList.remove('d-none');
            }

            if (matchCountBadge) {
                matchCountBadge.textContent = `${obj.match_count || 0} matches`;
                matchCountBadge.classList.remove('d-none');
            }
        }

        _updateNavCounter() {
            const counter = document.getElementById('ocs-match-counter');
            const btnPrev = document.getElementById('ocs-btn-prev');
            const btnNext = document.getElementById('ocs-btn-next');
            const total = this.store.state.matches.length;
            const current = total > 0 ? (this.store.state.activeMatchIndex + 1) : 0;

            if (counter) {
                counter.textContent = `${current} / ${total}`;
            }

            const hasMatches = total > 0;
            if (btnPrev) btnPrev.disabled = !hasMatches;
            if (btnNext) btnNext.disabled = !hasMatches;
        }

        _updateScopeBadge() {
            const badgeText = document.getElementById('ocs-scope-text');
            const connLabel = document.getElementById('ocs-conn-label');
            const dbLabel = document.getElementById('ocs-db-label');
            const schemaLabel = document.getElementById('ocs-schema-label');

            const srv = this.store.state.connectionName || 'No server';
            const db = this.store.state.database || 'master';
            const sch = this.store.state.schema || 'All Schemas';

            if (badgeText) badgeText.textContent = `${srv} • ${db} • ${sch}`;
            if (connLabel) connLabel.textContent = srv;
            if (dbLabel) dbLabel.textContent = db;
            if (schemaLabel) schemaLabel.textContent = sch;
        }

        async _syncScopeFromEnv() {
            const activeTab = (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function')
                ? window.AppTabs.getActiveTabState()
                : null;

            let connId = (activeTab && activeTab.connectionId) || window.ActiveConnectionId || (window.State && window.State.activeConnectionId) || null;
            let connName = (activeTab && activeTab.connectionName) || window.ActiveConnectionName || null;
            let db = (activeTab && activeTab.database) || window.ActiveDatabase || null;
            let schema = (activeTab && activeTab.schema) || null;
            let dbType = (activeTab && activeTab.dbType) || window.ActiveDbType || null;

            // Fallback 1: check window.AppExplorer active connections
            if (!connId && window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                const activeList = window.AppExplorer.getActiveConnections() || [];
                if (activeList.length > 0) {
                    const first = activeList[0];
                    connId = first.connection_id;
                    connName = first.name || first.server || 'Server';
                    dbType = first.type || 'sqlserver';
                    db = first.config?.database || db;
                }
            }

            // Fallback 2: fetch /api/connections from backend
            if (!connId) {
                try {
                    const res = await fetch('/api/connections');
                    const data = await res.json();
                    if (data.success && Array.isArray(data.connections) && data.connections.length > 0) {
                        const first = data.connections[0];
                        connId = first.connection_id;
                        connName = first.name || first.server || 'Server';
                        dbType = first.type || 'sqlserver';
                        db = first.config?.database || db;
                    }
                } catch (_) {}
            }

            if (!connName) connName = connId ? 'Current Server' : 'No server';
            if (!db) db = 'master';
            if (!dbType) dbType = 'sqlserver';

            this.store.setScope(connId, connName, db, schema, dbType);
            this._updateScopeBadge();
        }

        async switchScopeConnection(connId, connName, dbType, preferredDb) {
            let db = preferredDb || null;
            if (!db) {
                try {
                    const res = await fetch(`/api/metadata/${connId}/databases`);
                    const data = await res.json();
                    if (data.success && Array.isArray(data.items) && data.items.length > 0) {
                        const first = data.items[0];
                        db = typeof first === 'string' ? first : (first.name || 'master');
                    }
                } catch (_) {}
            }
            if (!db) db = 'master';

            // Reset schema to null (All Schemas) when connection changes
            this.store.setScope(connId, connName, db, null, dbType);
            this._updateScopeBadge();

            // Reset kết quả tìm kiếm cho database mới
            this.store.setResults([]);
            this.ddlViewer?.clear();
            this.matchPanel?.setMatches([], '', -1);

            // Đồng bộ tab title và session của tab hiện tại
            const tabsMgr = window.AppTabs || window.Tabs;
            if (tabsMgr && this.activeTabId) {
                if (typeof tabsMgr.updateTabTitle === 'function') {
                    tabsMgr.updateTabTitle(this.activeTabId, `Search: ${db}`);
                }
                this._saveTabSession(this.activeTabId);
            }

            if (typeof showToast === 'function') {
                showToast(`Đã chuyển phạm vi tìm kiếm sang: ${connName} • ${db}`, 'info');
            }
        }

        _initScopeDropdowns() {
            const btnConn = document.getElementById('ocs-ctx-connection');
            const menuConn = document.getElementById('ocs-conn-menu');
            const btnDb = document.getElementById('ocs-ctx-database');
            const menuDb = document.getElementById('ocs-db-menu');

            // 1. Connection Dropdown Click
            btnConn?.addEventListener('click', async () => {
                if (!menuConn) return;
                menuConn.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading connections…</span></li>';
                try {
                    const res = await fetch('/api/connections');
                    const data = await res.json();
                    menuConn.innerHTML = '';

                    const activeList = (data.success && Array.isArray(data.connections)) ? data.connections : [];
                    const activeMap = {};
                    activeList.forEach(c => {
                        const dbType = c.type || c.config?.type || 'sqlserver';
                        const displayName = c.name || c.config?.name || c.server || c.config?.server || 'Server';
                        activeMap[displayName + '::' + dbType] = c;
                    });

                    let savedList = (data && Array.isArray(data.saved_connections)) ? data.saved_connections : [];
                    if (savedList.length === 0 && window.AppExplorer && typeof window.AppExplorer.getSavedConnections === 'function') {
                        savedList = window.AppExplorer.getSavedConnections() || [];
                    }

                    const allItems = [];
                    const seenKeys = new Set();

                    // Prioritize active connections first
                    activeList.forEach(c => {
                        const sName = c.name || c.config?.name || c.server || 'Server';
                        const sType = c.type || c.config?.type || 'sqlserver';
                        const key = sName + '::' + sType;
                        seenKeys.add(key);
                        allItems.push({
                            name: sName,
                            type: sType,
                            isActive: true,
                            connId: c.connection_id,
                            config: c.config || {}
                        });
                    });

                    // Add saved connections that are not active
                    savedList.forEach(s => {
                        if (!s || s.type === 'group_marker' || String(s.name || '').startsWith('__group__')) return;
                        const sName = s.name || s.server || 'Server';
                        const sType = s.type || 'sqlserver';
                        const key = sName + '::' + sType;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            allItems.push({
                                name: sName,
                                type: sType,
                                isActive: false,
                                connId: null,
                                config: s
                            });
                        }
                    });

                    if (allItems.length === 0) {
                        menuConn.innerHTML = '<li><span class="dropdown-item text-muted small">Chưa có kết nối nào</span></li>';
                        return;
                    }

                    allItems.forEach(c => {
                        const li = document.createElement('li');
                        const isCurrent = (c.connId && c.connId === this.store.state.connectionId) ||
                                          (c.name === this.store.state.connectionName);
                        const icon = c.isActive
                            ? '<i class="fa-solid fa-server me-2 text-success"></i>'
                            : '<i class="fa-solid fa-server me-2 text-secondary opacity-75"></i>';

                        li.innerHTML = `
                            <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                <span class="d-flex align-items-center overflow-hidden">
                                    ${icon}
                                    <strong class="text-truncate" style="max-width: 140px;">${escapeHtml(c.name)}</strong>
                                    <span class="text-muted ms-1 small" style="font-size: 10px;">(${c.type})</span>
                                </span>
                                <div class="d-flex align-items-center ms-2 flex-shrink-0">
                                    ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                                </div>
                            </a>
                        `;

                        li.querySelector('a').addEventListener('click', async (e) => {
                            e.preventDefault();
                            if (window.bootstrap && bootstrap.Dropdown) {
                                const dd = bootstrap.Dropdown.getInstance(btnConn);
                                if (dd) dd.hide();
                            }

                            if (c.isActive && c.connId) {
                                await this.switchScopeConnection(c.connId, c.name, c.type, c.config?.database);
                            } else if (window.AppExplorer && window.AppExplorer.reconnect) {
                                if (typeof showToast === 'function') {
                                    showToast(`Đang kết nối tới ${c.name}…`, 'info');
                                }
                                window.AppExplorer.reconnect(c.name, c.type, c.config, async (newConn) => {
                                    const newId = newConn.connection_id || newConn.id;
                                    await this.switchScopeConnection(newId, c.name, c.type, c.config?.database);
                                    if (typeof showToast === 'function') {
                                        showToast(`Đã chuyển kết nối tìm kiếm sang ${c.name}`, 'success');
                                    }
                                });
                            }
                        });

                        menuConn.appendChild(li);
                    });
                } catch (e) {
                    menuConn.innerHTML = `<li><span class="dropdown-item text-danger small">Lỗi tải connections: ${escapeHtml(e.message)}</span></li>`;
                }
            });

            // 2. Database Dropdown Click
            btnDb?.addEventListener('click', async () => {
                if (!menuDb) return;
                const connId = this.store.state.connectionId;
                if (!connId) {
                    menuDb.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-circle-exclamation me-2 text-warning"></i>Vui lòng chọn Server trước</span></li>';
                    return;
                }

                menuDb.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading databases…</span></li>';
                try {
                    const res = await fetch(`/api/metadata/${connId}/databases`);
                    const data = await res.json();
                    menuDb.innerHTML = '';

                    const items = (data.success && Array.isArray(data.items)) ? data.items : [];
                    if (items.length === 0) {
                        menuDb.innerHTML = '<li><span class="dropdown-item text-muted small">Không tìm thấy database nào</span></li>';
                        return;
                    }

                    // Optional search filter if > 8 databases
                    if (items.length > 8) {
                        const filterLi = document.createElement('li');
                        filterLi.className = 'px-2 py-1';
                        filterLi.innerHTML = `
                            <input type="text" class="form-control form-control-sm" placeholder="Lọc database..." style="font-size: 11px;">
                        `;
                        filterLi.addEventListener('click', e => e.stopPropagation());
                        const input = filterLi.querySelector('input');
                        input.addEventListener('input', () => {
                            const term = input.value.trim().toLowerCase();
                            menuDb.querySelectorAll('.ocs-db-menu-item').forEach(itemEl => {
                                const text = itemEl.getAttribute('data-dbname')?.toLowerCase() || '';
                                itemEl.classList.toggle('d-none', term && !text.includes(term));
                            });
                        });
                        menuDb.appendChild(filterLi);
                        menuDb.appendChild(document.createElement('hr')).className = 'dropdown-divider my-1';
                    }

                    items.forEach(it => {
                        const dbName = typeof it === 'string' ? it : (it.name || '');
                        if (!dbName) return;

                        const isCurrent = (dbName.toLowerCase() === (this.store.state.database || '').toLowerCase());
                        const li = document.createElement('li');
                        li.className = 'ocs-db-menu-item';
                        li.setAttribute('data-dbname', dbName);
                        li.innerHTML = `
                            <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                <span class="d-flex align-items-center overflow-hidden">
                                    <i class="fa-solid fa-database me-2 text-info" style="font-size: 11px;"></i>
                                    <span class="text-truncate" style="max-width: 150px;">${escapeHtml(dbName)}</span>
                                </span>
                                ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                            </a>
                        `;

                        li.querySelector('a').addEventListener('click', (e) => {
                            e.preventDefault();
                            if (window.bootstrap && bootstrap.Dropdown) {
                                const dd = bootstrap.Dropdown.getInstance(btnDb);
                                if (dd) dd.hide();
                            }
                            this.store.state.database = dbName;
                            this.store.state.schema = null; // Reset schema when database changes
                            this.store.notify('scope_changed');
                            this._updateScopeBadge();
                            // Clear previous search results for new database
                            this.store.setResults([]);
                            this.ddlViewer?.clear();
                            this.matchPanel?.setMatches([], '', -1);

                            // Đồng bộ tab title và session của tab hiện tại
                            const tabsMgr = window.AppTabs || window.Tabs;
                            if (tabsMgr && this.activeTabId) {
                                if (typeof tabsMgr.updateTabTitle === 'function') {
                                    tabsMgr.updateTabTitle(this.activeTabId, `Search: ${dbName}`);
                                }
                                this._saveTabSession(this.activeTabId);
                            }
                        });

                        menuDb.appendChild(li);
                    });
                } catch (e) {
                    menuDb.innerHTML = `<li><span class="dropdown-item text-danger small">Lỗi tải databases: ${escapeHtml(e.message)}</span></li>`;
                }
            });

            // 3. Schema Dropdown Click
            const btnSchema = document.getElementById('ocs-ctx-schema');
            const menuSchema = document.getElementById('ocs-schema-menu');

            btnSchema?.addEventListener('click', async () => {
                if (!menuSchema) return;
                const connId = this.store.state.connectionId;
                if (!connId) {
                    menuSchema.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-circle-exclamation me-2 text-warning"></i>Vui lòng chọn Server trước</span></li>';
                    return;
                }

                const currentDb = this.store.state.database || '';
                menuSchema.innerHTML = '<li><span class="dropdown-item text-muted small"><i class="fa-solid fa-spinner fa-spin me-2"></i>Loading schemas…</span></li>';
                try {
                    const url = currentDb 
                        ? `/api/metadata/${connId}/schemas?database=${encodeURIComponent(currentDb)}`
                        : `/api/metadata/${connId}/schemas`;
                    const res = await fetch(url);
                    const data = await res.json();
                    menuSchema.innerHTML = '';

                    const items = (data.success && Array.isArray(data.items)) ? data.items : [];

                    // Always add "All Schemas (*)" item at the top
                    const allLi = document.createElement('li');
                    const isAll = !this.store.state.schema;
                    allLi.innerHTML = `
                        <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isAll ? 'active' : ''}" href="#" style="cursor: pointer;">
                            <span class="d-flex align-items-center overflow-hidden">
                                <i class="fa-solid fa-layer-group me-2 text-warning" style="font-size: 11px;"></i>
                                <span class="fw-semibold">All Schemas (*)</span>
                            </span>
                            ${isAll ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                        </a>
                    `;
                    allLi.querySelector('a').addEventListener('click', (e) => {
                        e.preventDefault();
                        if (window.bootstrap && bootstrap.Dropdown) {
                            const dd = bootstrap.Dropdown.getInstance(btnSchema);
                            if (dd) dd.hide();
                        }
                        this.store.state.schema = null;
                        this.store.notify('scope_changed');
                        this._updateScopeBadge();
                        this._saveTabSession(this.activeTabId);
                    });
                    menuSchema.appendChild(allLi);

                    if (items.length > 0) {
                        const divider = document.createElement('hr');
                        divider.className = 'dropdown-divider my-1';
                        menuSchema.appendChild(divider);
                    }

                    // Optional search filter if > 8 schemas
                    if (items.length > 8) {
                        const filterLi = document.createElement('li');
                        filterLi.className = 'px-2 py-1';
                        filterLi.innerHTML = `
                            <input type="text" class="form-control form-control-sm" placeholder="Lọc schema..." style="font-size: 11px;">
                        `;
                        filterLi.addEventListener('click', e => e.stopPropagation());
                        const input = filterLi.querySelector('input');
                        input.addEventListener('input', () => {
                            const term = input.value.trim().toLowerCase();
                            menuSchema.querySelectorAll('.ocs-schema-menu-item').forEach(itemEl => {
                                const text = itemEl.getAttribute('data-schemaname')?.toLowerCase() || '';
                                itemEl.classList.toggle('d-none', term && !text.includes(term));
                            });
                        });
                        menuSchema.appendChild(filterLi);
                        menuSchema.appendChild(document.createElement('hr')).className = 'dropdown-divider my-1';
                    }

                    items.forEach(it => {
                        const sName = typeof it === 'string' ? it : (it.name || '');
                        if (!sName) return;

                        const isCurrent = (this.store.state.schema && this.store.state.schema.toLowerCase() === sName.toLowerCase());
                        const li = document.createElement('li');
                        li.className = 'ocs-schema-menu-item';
                        li.setAttribute('data-schemaname', sName);
                        li.innerHTML = `
                            <a class="dropdown-item d-flex align-items-center justify-content-between py-1 px-3 ${isCurrent ? 'active' : ''}" href="#" style="cursor: pointer;">
                                <span class="d-flex align-items-center overflow-hidden">
                                    <i class="fa-solid fa-folder me-2 text-warning opacity-75" style="font-size: 11px;"></i>
                                    <span class="text-truncate" style="max-width: 150px;">${escapeHtml(sName)}</span>
                                </span>
                                ${isCurrent ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                            </a>
                        `;

                        li.querySelector('a').addEventListener('click', (e) => {
                            e.preventDefault();
                            if (window.bootstrap && bootstrap.Dropdown) {
                                const dd = bootstrap.Dropdown.getInstance(btnSchema);
                                if (dd) dd.hide();
                            }
                            this.store.state.schema = sName;
                            this.store.notify('scope_changed');
                            this._updateScopeBadge();
                            this._saveTabSession(this.activeTabId);
                        });

                        menuSchema.appendChild(li);
                    });
                } catch (e) {
                    menuSchema.innerHTML = `<li><span class="dropdown-item text-danger small">Lỗi tải schemas: ${escapeHtml(e.message)}</span></li>`;
                }
            });
        }

        _renderHistoryMenu() {
            const menu = document.getElementById('ocs-history-menu');
            if (!menu) return;
            const list = this.store.state.searchHistory;

            if (list.length === 0) {
                menu.innerHTML = '<li><span class="dropdown-item text-muted">Chưa có lịch sử</span></li>';
                return;
            }

            menu.innerHTML = list.map(item => `
                <li><a class="dropdown-item ocs-history-item" href="#">${escapeHtml(item)}</a></li>
            `).join('');

            menu.querySelectorAll('.ocs-history-item').forEach(itemEl => {
                itemEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    const text = itemEl.textContent;
                    const kwInput = document.getElementById('ocs-keyword-input');
                    if (kwInput) {
                        kwInput.value = text;
                        this.store.state.keyword = text;
                        document.getElementById('ocs-btn-clear')?.classList.remove('d-none');
                        this.executeSearch();
                    }
                });
            });
        }

        openDdlInEditorTab() {
            const ddl = this.ddlViewer?.getDdlText();
            const cur = this.store.state.selectedObject;
            if (!ddl || !cur) return;

            const tabTitle = `${cur.name}.sql`;
            const tabsMgr = window.AppTabs || window.Tabs;
            const createFn = tabsMgr && (tabsMgr.createTab || tabsMgr.addTab);
            if (typeof createFn === 'function') {
                createFn.call(tabsMgr, {
                    title: tabTitle,
                    content: ddl,
                    connectionId: this.store.state.connectionId,
                    connectionName: this.store.state.connectionName,
                    database: this.store.state.database
                });
                if (typeof showToast === 'function') {
                    showToast(`Đã mở DDL của ${cur.schema}.${cur.name} trong tab mới`, 'success');
                }
            }
        }

        copyDdlToClipboard() {
            const ddl = this.ddlViewer?.getDdlText();
            if (!ddl) return;
            this._copyText(ddl);
            if (typeof showToast === 'function') {
                showToast('Đã sao chép DDL vào bộ nhớ đệm', 'success');
            }
        }

        _copyText(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(() => {});
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        }

        _createDefaultSession(context = {}) {
            return {
                connectionId: context.connectionId || window.ActiveConnectionId || null,
                connectionName: context.connectionName || window.ActiveConnectionName || 'Server',
                database: context.database || window.ActiveDatabase || 'master',
                schema: context.schema || null,
                dbType: context.dbType || window.ActiveDbType || 'sqlserver',
                keyword: context.keyword || '',
                objectTypes: ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'],
                caseSensitive: false,
                wholeWord: false,
                isRegex: false,
                results: [],
                filterText: '',
                sortBy: 'default',
                pinnedObjects: new Set(),
                selectedObject: null,
                ddlData: null,
                activeMatchIndex: -1,
                error: null,
                searchHistory: []
            };
        }

        _saveTabSession(tabId) {
            if (!tabId) return;
            const kwInput = document.getElementById('ocs-keyword-input');
            const kw = kwInput ? kwInput.value : this.store.state.keyword;
            const filterInput = document.getElementById('ocs-filter-results');
            const filterText = filterInput ? filterInput.value : this.store.state.filterText;
            const sortSelect = document.getElementById('ocs-sort-results');
            const sortBy = sortSelect ? sortSelect.value : this.store.state.sortBy;

            const existingSession = this.tabSessions.get(tabId) || {};

            const session = {
                connectionId: this.store.state.connectionId,
                connectionName: this.store.state.connectionName,
                database: this.store.state.database,
                schema: this.store.state.schema,
                dbType: this.store.state.dbType,
                keyword: kw || '',
                objectTypes: [...(this.store.state.objectTypes || ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'])],
                caseSensitive: !!this.store.state.caseSensitive,
                wholeWord: !!this.store.state.wholeWord,
                isRegex: !!this.store.state.isRegex,
                results: Array.isArray(this.store.state.results) ? [...this.store.state.results] : [],
                filterText: filterText || '',
                sortBy: sortBy || 'default',
                pinnedObjects: new Set(this.store.state.pinnedObjects || []),
                selectedObject: this.store.state.selectedObject ? Object.assign({}, this.store.state.selectedObject) : null,
                ddlData: this.store.state.ddl ? { ddl: this.store.state.ddl, matches: this.store.state.matches || [] } : (existingSession.ddlData || null),
                activeMatchIndex: this.store.state.activeMatchIndex !== undefined ? this.store.state.activeMatchIndex : -1,
                error: this.store.state.error || null,
                searchHistory: Array.isArray(this.store.state.searchHistory) ? [...this.store.state.searchHistory] : [],
                monacoModel: existingSession.monacoModel || null,
                viewState: (this.ddlViewer && this.ddlViewer.editor) ? this.ddlViewer.editor.saveViewState() : (existingSession.viewState || null)
            };

            this.tabSessions.set(tabId, session);

            // Đồng bộ sang AppTabs state nếu có
            const tabsMgr = window.AppTabs || window.Tabs;
            if (tabsMgr && typeof tabsMgr.getTab === 'function') {
                const tabState = tabsMgr.getTab(tabId);
                if (tabState) {
                    tabState.connectionId = session.connectionId;
                    tabState.connectionName = session.connectionName;
                    tabState.database = session.database;
                    tabState.schema = session.schema;
                    tabState.dbType = session.dbType;
                }
            }
        }

        _loadTabSession(session) {
            if (!session) return;

            // 1. Cập nhật state của store
            this.store.state.connectionId = session.connectionId;
            this.store.state.connectionName = session.connectionName;
            this.store.state.database = session.database;
            this.store.state.schema = session.schema;
            this.store.state.dbType = session.dbType;
            this.store.state.keyword = session.keyword || '';
            this.store.state.objectTypes = [...(session.objectTypes || ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER'])];
            this.store.state.caseSensitive = !!session.caseSensitive;
            this.store.state.wholeWord = !!session.wholeWord;
            this.store.state.isRegex = !!session.isRegex;
            this.store.state.results = session.results || [];
            this.store.state.filterText = session.filterText || '';
            this.store.state.sortBy = session.sortBy || 'default';
            this.store.state.pinnedObjects = new Set(session.pinnedObjects || []);
            this.store.state.selectedObject = session.selectedObject || null;
            this.store.state.ddl = session.ddlData ? session.ddlData.ddl : null;
            this.store.state.matches = session.ddlData ? (session.ddlData.matches || []) : [];
            this.store.state.activeMatchIndex = session.activeMatchIndex !== undefined ? session.activeMatchIndex : -1;
            this.store.state.error = session.error || null;
            this.store.state.isSearching = false;
            this.store.state.isLoadingDdl = false;
            if (Array.isArray(session.searchHistory)) {
                this.store.state.searchHistory = [...session.searchHistory];
            }

            // 2. Cập nhật UI controls
            const kwInput = document.getElementById('ocs-keyword-input');
            const btnClear = document.getElementById('ocs-btn-clear');
            if (kwInput) {
                kwInput.value = this.store.state.keyword;
            }
            if (btnClear) {
                btnClear.classList.toggle('d-none', !this.store.state.keyword);
            }

            // Checkboxes
            const cbView = document.getElementById('ocs-cb-view');
            const cbProc = document.getElementById('ocs-cb-procedure');
            const cbFunc = document.getElementById('ocs-cb-function');
            const cbTrig = document.getElementById('ocs-cb-trigger');
            if (cbView) cbView.checked = this.store.state.objectTypes.includes('VIEW');
            if (cbProc) cbProc.checked = this.store.state.objectTypes.includes('PROCEDURE');
            if (cbFunc) cbFunc.checked = this.store.state.objectTypes.includes('FUNCTION');
            if (cbTrig) cbTrig.checked = this.store.state.objectTypes.includes('TRIGGER');

            // Toggle buttons (Aa, \b, .*)
            const btnCase = document.getElementById('ocs-btn-case');
            const btnWhole = document.getElementById('ocs-btn-whole');
            const btnRegex = document.getElementById('ocs-btn-regex');
            if (btnCase) btnCase.classList.toggle('active', !!this.store.state.caseSensitive);
            if (btnWhole) btnWhole.classList.toggle('active', !!this.store.state.wholeWord);
            if (btnRegex) btnRegex.classList.toggle('active', !!this.store.state.isRegex);

            // In-list filter & sort
            const filterResInput = document.getElementById('ocs-filter-results');
            if (filterResInput) filterResInput.value = this.store.state.filterText;
            const sortResSelect = document.getElementById('ocs-sort-results');
            if (sortResSelect) sortResSelect.value = this.store.state.sortBy;

            // Scope Badge & Dropdown labels
            this._updateScopeBadge();

            // Render Results list
            this._renderResultsList();

            // Viewer & Match panel (Instant switch using pre-tokenized Monaco model)
            const errBanner = document.getElementById('ocs-ddl-error-banner');
            const btnOpenTab = document.getElementById('ocs-btn-open-tab');
            const btnCopyDdl = document.getElementById('ocs-btn-copy-ddl');

            if (this.store.state.selectedObject && session.ddlData) {
                this._updateViewerHeader(this.store.state.selectedObject);
                if (errBanner) errBanner.classList.add('d-none');
                if (session.monacoModel && !session.monacoModel.isDisposed()) {
                    this.ddlViewer?.setModel(session.monacoModel, session.ddlData.matches, session.activeMatchIndex);
                } else {
                    this.ddlViewer?.setDefinition(session.ddlData.ddl, session.ddlData.matches, session.activeMatchIndex);
                }
                if (session.viewState && this.ddlViewer && this.ddlViewer.editor) {
                    try {
                        this.ddlViewer.editor.restoreViewState(session.viewState);
                    } catch (_) {}
                }
                this.matchPanel?.setMatches(session.ddlData.matches, this.store.state.keyword, session.activeMatchIndex);
                if (btnOpenTab) btnOpenTab.disabled = false;
                if (btnCopyDdl) btnCopyDdl.disabled = false;
            } else {
                this._updateViewerHeader(null);
                if (errBanner) errBanner.classList.add('d-none');
                this.ddlViewer?.clear();
                this.matchPanel?.setMatches([], '', -1);
                if (btnOpenTab) btnOpenTab.disabled = true;
                if (btnCopyDdl) btnCopyDdl.disabled = true;
            }

            this._updateNavCounter();
            this._renderHistoryMenu();
        }

        async activateTab(tabId, context = {}) {
            if (this.activeTabId && this.activeTabId !== tabId) {
                this._saveTabSession(this.activeTabId);
            }

            this.activeTabId = tabId;

            let session = this.tabSessions.get(tabId);
            if (!session) {
                session = this._createDefaultSession(context);
                if (!session.connectionId) {
                    await this._syncScopeFromEnv();
                    session.connectionId = this.store.state.connectionId;
                    session.connectionName = this.store.state.connectionName;
                    session.database = this.store.state.database;
                    session.schema = this.store.state.schema;
                    session.dbType = this.store.state.dbType;
                }
                this.tabSessions.set(tabId, session);
            } else if (context && (context.connectionId || context.database)) {
                // Cho phép override nếu context truyền explicit scope
                session.connectionId = context.connectionId || session.connectionId;
                session.connectionName = context.connectionName || session.connectionName;
                session.database = context.database || session.database;
                session.schema = context.schema !== undefined ? context.schema : session.schema;
                session.dbType = context.dbType || session.dbType;
            }

            this._loadTabSession(session);
            this.ddlViewer?.applyTypographySettings();
            this.ddlViewer?.syncTheme();

            if (context.keyword && (!session.results || session.results.length === 0)) {
                const kwInput = document.getElementById('ocs-keyword-input');
                if (kwInput) {
                    kwInput.value = context.keyword;
                    this.store.state.keyword = context.keyword;
                    document.getElementById('ocs-btn-clear')?.classList.remove('d-none');
                    this.executeSearch();
                }
            }
        }

        closeTab(tabId) {
            const session = this.tabSessions.get(tabId);
            if (session && session.monacoModel && !session.monacoModel.isDisposed()) {
                session.monacoModel.dispose();
            }
            this.tabSessions.delete(tabId);
            if (this.activeTabId === tabId) {
                this.activeTabId = null;
            }
        }

        async openSearchTab(options = {}) {
            const tabsMgr = window.AppTabs || window.Tabs;
            if (!tabsMgr) return;

            // Đồng bộ scope từ options hoặc từ active environment
            let connId = options.connectionId;
            let connName = options.connectionName;
            let dbName = options.database;
            let schema = options.schema;
            let dbType = options.dbType;

            if (!connId) {
                await this._syncScopeFromEnv();
                connId = this.store.state.connectionId;
                connName = this.store.state.connectionName;
                dbName = this.store.state.database;
                schema = this.store.state.schema;
                dbType = this.store.state.dbType;
            }

            connName = connName || 'Server';
            dbName = dbName || 'master';

            const createFn = tabsMgr.createTab || tabsMgr.addTab;
            if (typeof createFn === 'function') {
                const tabTitle = `Search: ${dbName}`;
                createFn.call(tabsMgr, {
                    title: tabTitle,
                    icon: 'fa-magnifying-glass',
                    tabType: 'object-search',
                    connectionId: connId,
                    connectionName: connName,
                    database: dbName,
                    schema: schema || null,
                    dbType: dbType || 'sqlserver',
                    context: Object.assign({}, options, {
                        connectionId: connId,
                        connectionName: connName,
                        database: dbName,
                        schema: schema || null,
                        dbType: dbType
                    })
                });
            }
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Global Singleton instance
    global.ObjectContentSearch = new ObjectContentSearchController();
})(window);
