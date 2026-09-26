/**
 * BravoConnectionBar — Reusable Database Connection Breadcrumb Bar Component.
 * Can be mounted inside any container or feature (e.g. Layout Editor, Table Designer, etc.).
 *
 * Features:
 * - New connection button (+) -> Opens connection modal
 * - DB Type selector (SQL Server / PostgreSQL)
 * - Connection selector (Active & Saved profiles with RAM password prompt support)
 * - Database selector (With live search filter & clear button)
 * - Schema selector (Context-sensitive to selected Database)
 * - Environment badge (DEV)
 * - Outside-click dropdown closing & fixed coordinate positioning (escapes overflow containers)
 * - Emits onChange(context) when any connection dimension changes
 */
(function (global) {
    'use strict';

    let _instCounter = 0;

    class BravoConnectionBar {
        /**
         * @param {Object} options
         * @param {HTMLElement} options.container - Container element to mount into
         * @param {string} [options.idPrefix] - Optional ID prefix
         * @param {Object} [options.initialContext] - { connectionId, connectionName, database, schema, dbType }
         * @param {boolean} [options.showNewConnBtn=true] - Whether to show the (+) button
         * @param {boolean} [options.showEnvBadge=true] - Whether to show the DEV badge
         * @param {string} [options.envBadgeText='DEV'] - Environment badge text
         * @param {Function} [options.onChange] - Callback function(context)
         * @param {Function} [options.onStatus] - Callback function(message, state)
         */
        constructor(options = {}) {
            this.options = options;
            this.id = options.idPrefix || `bravo-cb-${++_instCounter}`;
            this.container = options.container || null;

            // State
            const initCtx = options.initialContext || {};
            this.activeDbType = initCtx.dbType || 'sqlserver';
            this.activeConnectionId = initCtx.connectionId || null;
            this.activeConnectionName = initCtx.connectionName || 'No connection';
            this.activeDatabase = initCtx.database || '—';
            this.activeSchema = initCtx.schema || '—';

            this._connections = [];
            this._openDropdown = null;
            this._el = null;
            this._destroyed = false;

            // Callbacks
            this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
            this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

            // Outside click handler
            this._onDocClick = (e) => {
                if (this._openDropdown && !this._openDropdown.contains(e.target)
                    && !e.target.closest('.bravo-ctx-select')) {
                    this._closeDropdowns();
                }
            };
            document.addEventListener('click', this._onDocClick, true);

            // Build & wire DOM if container is provided
            if (this.container) {
                this.mount(this.container);
            }
        }

        // ── Mount into container ──────────────────────────────────────────────
        mount(container) {
            if (!container) return;
            this.container = container;
            this._buildDOM();
            this._wireEvents();
            this._loadConnections().then(() => {
                if (this.activeConnectionId) {
                    if (!this.activeDatabase || this.activeDatabase === '—') {
                        this._loadDatabases();
                    } else if (!this.activeSchema || this.activeSchema === '—') {
                        this._loadSchemas();
                    }
                }
                this._updateUI();
            });
        }

        // ── Build DOM ─────────────────────────────────────────────────────────
        _buildDOM() {
            const id = this.id;
            const showNewConn = this.options.showNewConnBtn !== false;
            const showEnv = this.options.showEnvBadge !== false;
            const envText = this.options.envBadgeText || 'DEV';

            const el = document.createElement('div');
            el.className = 'bravo-connection-bar bravo-topbar';
            el.id = `${id}-bar`;
            el.innerHTML = `
                ${showNewConn ? `
                <!-- New connection button -->
                <button class="bravo-ctx-new-conn" id="${id}-new-conn" title="Tạo kết nối mới (IDE SQL)">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <div style="width:1px; height:18px; background:var(--ide-border); margin:0 4px; flex-shrink:0;"></div>
                ` : ''}

                <!-- DB Type -->
                <div class="bravo-ctx-select" id="${id}-dbtype" title="Loại Database">
                    <i class="fa-solid fa-server bravo-ctx-icon"></i>
                    <span class="bravo-ctx-value" id="${id}-dbtype-val">SQL Server</span>
                    <i class="fa-solid fa-chevron-down bravo-ctx-arrow"></i>
                    <div class="bravo-dropdown" id="${id}-dbtype-dd" style="display:none;"></div>
                </div>
                <span class="bravo-ctx-sep">›</span>

                <!-- Connection -->
                <div class="bravo-ctx-select" id="${id}-conn" title="Kết nối">
                    <i class="fa-solid fa-plug-circle-bolt bravo-ctx-icon"></i>
                    <span class="bravo-ctx-value" id="${id}-conn-val">No connection</span>
                    <i class="fa-solid fa-chevron-down bravo-ctx-arrow"></i>
                    <div class="bravo-dropdown" id="${id}-conn-dd" style="display:none;"></div>
                </div>
                <span class="bravo-ctx-sep">›</span>

                <!-- Database -->
                <div class="bravo-ctx-select" id="${id}-db" title="Database">
                    <i class="fa-solid fa-database bravo-ctx-icon"></i>
                    <span class="bravo-ctx-value" id="${id}-db-val">—</span>
                    <i class="fa-solid fa-chevron-down bravo-ctx-arrow"></i>
                    <div class="bravo-dropdown" id="${id}-db-dd" style="display:none;"></div>
                </div>
                <span class="bravo-ctx-sep">›</span>

                <!-- Schema -->
                <div class="bravo-ctx-select" id="${id}-schema" title="Schema">
                    <i class="fa-solid fa-folder-tree bravo-ctx-icon"></i>
                    <span class="bravo-ctx-value" id="${id}-schema-val">—</span>
                    <i class="fa-solid fa-chevron-down bravo-ctx-arrow"></i>
                    <div class="bravo-dropdown" id="${id}-schema-dd" style="display:none;"></div>
                </div>

                ${showEnv ? `
                <!-- Env badge -->
                <span class="bravo-env-badge bravo-env-dev" id="${id}-env" style="margin-left:auto;">
                    <i class="fa-solid fa-circle" style="font-size:6px;"></i> ${envText}
                </span>
                ` : ''}
            `;

            this.container.innerHTML = '';
            this.container.appendChild(el);
            this._el = el;
        }

        // ── Wire Events & Dropdowns ───────────────────────────────────────────
        _wireEvents() {
            const id = this.id;
            const newConnBtn = this._el.querySelector(`#${id}-new-conn`);
            const dbTypeSel  = this._el.querySelector(`#${id}-dbtype`);
            const connSel    = this._el.querySelector(`#${id}-conn`);
            const dbSel      = this._el.querySelector(`#${id}-db`);
            const schemaSel  = this._el.querySelector(`#${id}-schema`);

            // 1. New connection button
            if (newConnBtn) {
                newConnBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    const onConnCreated = (evt) => {
                        const conn = evt.detail?.connection;
                        const payload = evt.detail?.payload;
                        if (conn) {
                            this.activeConnectionId = conn.connection_id;
                            this.activeConnectionName = conn.name || payload?.name || 'Connection';
                            this.activeDatabase = conn.database || payload?.database || '—';
                            this.activeDbType = conn.type || payload?.type || 'sqlserver';

                            this._loadConnections().then(() => {
                                this._updateUI();
                                this._notifyChange();
                                this._showToast(`Đã kết nối: ${this.activeConnectionName}`, true);
                            });
                        }
                    };

                    document.addEventListener('connection-created', onConnCreated, { once: true });
                    document.addEventListener('bravo-connection-created', onConnCreated, { once: true });

                    const modalEl = document.getElementById('connectionModal');
                    if (modalEl && typeof bootstrap !== 'undefined') {
                        modalEl.style.zIndex = '10050';
                        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
                        bsModal.show();
                        setTimeout(() => {
                            document.querySelectorAll('.modal-backdrop').forEach(b => b.style.zIndex = '10040');
                        }, 50);
                    } else {
                        const addConnBtn = document.getElementById('ide-btn-connect') || document.querySelector('[data-action="new-connection"]');
                        if (addConnBtn) addConnBtn.click();
                    }
                });
            }

            // Helper: Toggle dropdown with fixed viewport coordinates
            const toggleDropdown = (sel, fillFn) => {
                const dd = sel.querySelector('.bravo-dropdown');
                if (!dd) return;
                if (dd.style.display === 'none') {
                    this._closeDropdowns();
                    fillFn(dd);
                    const rect = sel.getBoundingClientRect();
                    dd.style.top  = (rect.bottom + 4) + 'px';
                    dd.style.left = rect.left + 'px';
                    dd.style.display = 'block';
                    this._openDropdown = dd;
                } else {
                    this._closeDropdowns();
                }
            };

            // 2. DB Type dropdown
            if (dbTypeSel) {
                dbTypeSel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleDropdown(dbTypeSel, (dd) => {
                        const types = [
                            { value: 'sqlserver', label: 'SQL Server', icon: 'fa-database' },
                            { value: 'postgresql', label: 'PostgreSQL', icon: 'fa-database' }
                        ];
                        dd.innerHTML = types.map(t => `
                            <div class="bravo-dropdown-item ${this.activeDbType === t.value ? 'active' : ''}"
                                 data-value="${t.value}">
                                <i class="fa-solid ${t.icon}"></i>${t.label}
                            </div>`).join('');

                        dd.querySelectorAll('.bravo-dropdown-item').forEach(item => {
                            item.addEventListener('click', (evt) => {
                                evt.stopPropagation();
                                const newType = item.dataset.value;
                                if (this.activeDbType !== newType) {
                                    this.activeDbType = newType;
                                    const currentConn = (this._connections || []).find(c => String(c.connection_id) === String(this.activeConnectionId));
                                    if (!currentConn || (currentConn.type || '').toLowerCase() !== newType.toLowerCase()) {
                                        this.activeConnectionId = null;
                                        this.activeConnectionName = 'No connection';
                                        this.activeDatabase = '—';
                                        this.activeSchema = '—';
                                    }
                                    this._updateUI();
                                    this._notifyChange();
                                }
                                this._closeDropdowns();
                            });
                        });
                    });
                });
            }

            // 3. Connection dropdown
            if (connSel) {
                connSel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleDropdown(connSel, (dd) => {
                        const filtered = (this._connections || []).filter(c => {
                            if (!this.activeDbType) return true;
                            return (c.type || 'sqlserver').toLowerCase() === this.activeDbType.toLowerCase();
                        });

                        if (!filtered.length) {
                            dd.innerHTML = `<div class="bravo-dropdown-empty">Chưa có kết nối nào cho ${this.activeDbType || 'db'}</div>`;
                            return;
                        }

                        dd.innerHTML = filtered.map(c => `
                            <div class="bravo-dropdown-item ${String(this.activeConnectionId) === String(c.connection_id) ? 'active' : ''}"
                                 data-id="${c.connection_id}">
                                <i class="fa-solid ${c.isActive ? 'fa-plug-circle-bolt text-success' : 'fa-bookmark text-muted'} me-1"></i>
                                <span>${c.name}</span>
                                <span class="ms-auto small opacity-50" style="font-size:10px;">${c.isActive ? 'Active' : 'Saved'}</span>
                            </div>`).join('');

                        dd.querySelectorAll('.bravo-dropdown-item').forEach(item => {
                            item.addEventListener('click', async (evt) => {
                                evt.stopPropagation();
                                this._closeDropdowns();

                                const connId = item.dataset.id;
                                const target = this._connections.find(c => String(c.connection_id) === String(connId));
                                if (!target || target.type === 'group_marker' || String(target.name || '').startsWith('__group__')) return;

                                if (target.isActive) {
                                    this.activeConnectionId = target.connection_id;
                                    this.activeConnectionName = target.name;
                                    this.activeDbType = target.type;
                                    this.activeDatabase = target.database || '—';
                                    this.activeSchema = '—';
                                    this._updateUI();
                                    this._showToast(`Đã kết nối: ${this.activeConnectionName}`, true);
                                    await this._loadDatabases();
                                    this._notifyChange();
                                } else if (target.config) {
                                    const config = target.config;
                                    const isTrusted = config.trusted_connection || config.type === 'sqlite';
                                    let needPasswordPrompt = !isTrusted;

                                    if (!isTrusted) {
                                        try {
                                            const checkRes = await fetch('/api/connections/check-credential', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify(config)
                                            });
                                            const checkData = await checkRes.json();
                                            if (checkData.success && checkData.has_password) {
                                                needPasswordPrompt = false;
                                            }
                                        } catch (errCheck) {
                                            needPasswordPrompt = true;
                                        }
                                    }

                                    if (needPasswordPrompt) {
                                        const promptFn = (window.AppExplorer && typeof window.AppExplorer.promptReconnectPassword === 'function' && window.AppExplorer.promptReconnectPassword)
                                                      || (typeof window.promptReconnectPassword === 'function' && window.promptReconnectPassword);

                                        if (promptFn) {
                                            const modalEl = document.getElementById('reconnectPasswordModal');
                                            if (modalEl) {
                                                modalEl.style.zIndex = '10060';
                                                setTimeout(() => {
                                                    document.querySelectorAll('.modal-backdrop').forEach(b => b.style.zIndex = '10050');
                                                }, 50);
                                            }
                                            promptFn(
                                                target.name,
                                                target.type,
                                                config,
                                                async (conn) => {
                                                    if (conn) {
                                                        this.activeConnectionId = conn.connection_id;
                                                        this.activeConnectionName = target.name;
                                                        this.activeDbType = target.type;
                                                        this.activeDatabase = conn.database || target.database || '—';
                                                        this.activeSchema = '—';
                                                        await this._loadConnections();
                                                        this._updateUI();
                                                        this._showToast(`Đã kết nối: ${this.activeConnectionName}`, true);
                                                        await this._loadDatabases();
                                                        this._notifyChange();
                                                    }
                                                }
                                            );
                                            return;
                                        }
                                    }

                                    // Password cached or not required
                                    this._showToast(`Đang kết nối tới ${target.name}...`, true);
                                    try {
                                        const res = await fetch('/api/connections', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(config)
                                        });
                                        const data = await res.json();
                                        if (data.success && data.connection) {
                                            this.activeConnectionId = data.connection.connection_id;
                                            this.activeConnectionName = target.name;
                                            this.activeDbType = target.type;
                                            this.activeDatabase = data.connection.database || target.database || '—';
                                            this.activeSchema = '—';
                                            await this._loadConnections();
                                            this._updateUI();
                                            this._showToast(`Đã kết nối: ${this.activeConnectionName}`, true);
                                            await this._loadDatabases();
                                            this._notifyChange();
                                        } else {
                                            this._showToast(`Lỗi kết nối: ${data.error || 'Unknown error'}`, false);
                                        }
                                    } catch (err) {
                                        this._showToast(`Lỗi kết nối server`, false);
                                    }
                                }
                            });
                        });
                    });
                });
            }

            // 4. Database dropdown
            if (dbSel) {
                dbSel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.activeConnectionId) {
                        this._showToast('Vui lòng chọn kết nối trước', false);
                        return;
                    }
                    toggleDropdown(dbSel, async (dd) => {
                        dd.innerHTML = '<div class="bravo-dropdown-empty"><i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải...</div>';
                        try {
                            const res = await fetch(`/api/metadata/${this.activeConnectionId}/databases`);
                            const data = await res.json();
                            const dbs = (data.items || []).map(d => typeof d === 'string' ? d : d.name);
                            if (!dbs.length) {
                                dd.innerHTML = '<div class="bravo-dropdown-empty">Không có database</div>';
                                return;
                            }

                            dd.innerHTML = `
                                <div class="bravo-db-header">
                                    <div class="d-flex align-items-center justify-content-between">
                                        <span class="bravo-db-header-title">Select Database</span>
                                        <button type="button" class="bravo-db-filter-btn" title="Lọc database">
                                            <i class="fa-solid fa-filter"></i>
                                        </button>
                                    </div>
                                    <div class="bravo-db-filter-box d-none">
                                        <div class="bravo-db-filter-group">
                                            <i class="fa-solid fa-magnifying-glass bravo-db-filter-icon"></i>
                                            <input type="text" class="bravo-db-filter-input" placeholder="Lọc database..." autocomplete="off" spellcheck="false">
                                            <button type="button" class="bravo-db-filter-clear d-none" title="Xóa lọc">
                                                <i class="fa-solid fa-xmark"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="bravo-db-items-container">
                                    ${dbs.map(d => `
                                        <div class="bravo-dropdown-item ${this.activeDatabase === d ? 'active' : ''}" data-value="${d}">
                                            <i class="fa-solid fa-database"></i>${d}
                                        </div>`).join('')}
                                </div>
                                <div class="bravo-db-no-match d-none">Không tìm thấy database phù hợp</div>
                            `;

                            const headerEl = dd.querySelector('.bravo-db-header');
                            const filterBtn = dd.querySelector('.bravo-db-filter-btn');
                            const filterBox = dd.querySelector('.bravo-db-filter-box');
                            const filterInput = dd.querySelector('.bravo-db-filter-input');
                            const filterClear = dd.querySelector('.bravo-db-filter-clear');
                            const noMatchEl = dd.querySelector('.bravo-db-no-match');
                            const items = Array.from(dd.querySelectorAll('.bravo-dropdown-item'));

                            headerEl.addEventListener('click', (ev) => ev.stopPropagation());
                            headerEl.addEventListener('keydown', (ev) => ev.stopPropagation());

                            const applyBravoFilter = (query) => {
                                const q = (query || '').trim().toLowerCase();
                                let visibleCount = 0;
                                items.forEach(item => {
                                    const val = (item.dataset.value || '').toLowerCase();
                                    if (!q || val.includes(q)) {
                                        item.style.display = '';
                                        visibleCount++;
                                    } else {
                                        item.style.display = 'none';
                                    }
                                });
                                noMatchEl.classList.toggle('d-none', visibleCount > 0);
                                filterClear.classList.toggle('d-none', !q);
                            };

                            filterBtn.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                const isHidden = filterBox.classList.contains('d-none');
                                if (isHidden) {
                                    filterBox.classList.remove('d-none');
                                    filterBtn.classList.add('active');
                                    setTimeout(() => filterInput.focus(), 50);
                                } else {
                                    filterBox.classList.add('d-none');
                                    filterBtn.classList.remove('active');
                                    filterInput.value = '';
                                    applyBravoFilter('');
                                }
                            });

                            filterInput.addEventListener('input', (ev) => {
                                applyBravoFilter(ev.target.value);
                            });

                            filterClear.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                filterInput.value = '';
                                applyBravoFilter('');
                                filterInput.focus();
                            });

                            filterInput.addEventListener('keydown', (ev) => {
                                if (ev.key === 'Escape') {
                                    ev.stopPropagation();
                                    if (filterInput.value) {
                                        filterInput.value = '';
                                        applyBravoFilter('');
                                    } else {
                                        filterBox.classList.add('d-none');
                                        filterBtn.classList.remove('active');
                                    }
                                }
                            });

                            items.forEach(item => {
                                item.addEventListener('click', async (evt) => {
                                    evt.stopPropagation();
                                    this.activeDatabase = item.dataset.value;
                                    this.activeSchema = '—';
                                    this._updateUI();
                                    this._closeDropdowns();
                                    await this._loadSchemas();
                                    this._notifyChange();
                                });
                            });
                        } catch (e) {
                            dd.innerHTML = '<div class="bravo-dropdown-empty">Lỗi tải database</div>';
                        }
                    });
                });
            }

            // 5. Schema dropdown
            if (schemaSel) {
                schemaSel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.activeConnectionId) {
                        this._showToast('Vui lòng chọn kết nối trước', false);
                        return;
                    }
                    toggleDropdown(schemaSel, async (dd) => {
                        dd.innerHTML = '<div class="bravo-dropdown-empty"><i class="fa-solid fa-spinner fa-spin me-1"></i>Đang tải...</div>';
                        try {
                            const dbQuery = (this.activeDatabase && this.activeDatabase !== '—') ? `?database=${encodeURIComponent(this.activeDatabase)}` : '';
                            const res = await fetch(`/api/metadata/${this.activeConnectionId}/schemas${dbQuery}`);
                            const data = await res.json();
                            const schemas = (data.items || []).map(s => typeof s === 'string' ? s : s.name);
                            dd.innerHTML = schemas.length
                                ? schemas.map(s => `
                                    <div class="bravo-dropdown-item ${this.activeSchema === s ? 'active' : ''}" data-value="${s}">
                                        <i class="fa-solid fa-folder-tree"></i>${s}
                                    </div>`).join('')
                                : '<div class="bravo-dropdown-empty">Không có schema</div>';
                            dd.querySelectorAll('.bravo-dropdown-item').forEach(item => {
                                item.addEventListener('click', (evt) => {
                                    evt.stopPropagation();
                                    this.activeSchema = item.dataset.value;
                                    this._updateUI();
                                    this._closeDropdowns();
                                    this._notifyChange();
                                });
                            });
                        } catch (e) {
                            dd.innerHTML = '<div class="bravo-dropdown-empty">Lỗi tải schema</div>';
                        }
                    });
                });
            }
        }

        // ── Load Connections (Active + Saved) ─────────────────────────────────
        async _loadConnections() {
            try {
                const res = await fetch('/api/connections');
                const data = await res.json();
                const activeConns = data.connections || [];

                let savedConns = [];
                try {
                    const raw = window.AppStorage ? JSON.stringify(await window.AppStorage.getSavedConnections()) : localStorage.getItem('ide_saved_connections');
                    if (raw) savedConns = JSON.parse(raw);
                } catch (e) {}

                const map = new Map();

                savedConns.forEach(sc => {
                    if (!sc || sc.type === 'group_marker' || String(sc.name || '').startsWith('__group__')) return;
                    const key = (sc.server || sc.host || sc.name || 'conn').toLowerCase() + ':' + (sc.type || 'sqlserver').toLowerCase();
                    map.set(key, {
                        connection_id: sc.connection_id || `saved_${sc.name}`,
                        name: sc.name || sc.server || 'Saved Profile',
                        type: sc.type || 'sqlserver',
                        database: sc.database || '',
                        config: sc,
                        isActive: false
                    });
                });

                activeConns.forEach(ac => {
                    const cfg = ac.config || ac;
                    if (!ac || cfg.type === 'group_marker' || String(ac.name || cfg.name || '').startsWith('__group__')) return;
                    const key = (cfg.server || cfg.host || ac.name || 'conn').toLowerCase() + ':' + (ac.type || cfg.type || 'sqlserver').toLowerCase();
                    map.set(key, {
                        connection_id: ac.connection_id || ac.id,
                        name: ac.name || cfg.name || 'Active Connection',
                        type: ac.type || cfg.type || 'sqlserver',
                        database: ac.database || cfg.database || '',
                        config: cfg,
                        isActive: true
                    });
                });

                this._connections = Array.from(map.values());

                if (!this.activeConnectionId && window.ActiveConnectionId) {
                    this.activeConnectionId = window.ActiveConnectionId;
                    this.activeConnectionName = window.ActiveConnectionName || 'No connection';
                    this.activeDatabase = window.ActiveDatabase || '—';
                    this.activeSchema = window.ActiveSchema || '—';
                    this.activeDbType = window.ActiveDbType || 'sqlserver';
                }
            } catch (e) {
                this._connections = [];
            }
        }

        // ── Load Databases ────────────────────────────────────────────────────
        async _loadDatabases() {
            if (!this.activeConnectionId) return;
            try {
                const res = await fetch(`/api/metadata/${this.activeConnectionId}/databases`);
                const data = await res.json();
                if (data.success && data.items && data.items.length > 0) {
                    const first = typeof data.items[0] === 'string' ? data.items[0] : data.items[0].name;
                    this.activeDatabase = first;
                    this._updateUI();
                    await this._loadSchemas();
                }
            } catch (e) {}
        }

        // ── Load Schemas ──────────────────────────────────────────────────────
        async _loadSchemas() {
            if (!this.activeConnectionId || this.activeDatabase === '—') return;
            try {
                const res = await fetch(`/api/metadata/${this.activeConnectionId}/schemas?database=${encodeURIComponent(this.activeDatabase)}`);
                const data = await res.json();
                if (data.success && data.items && data.items.length > 0) {
                    const items = data.items.map(s => typeof s === 'string' ? s : (s.name || s));
                    if (this.activeSchema && this.activeSchema !== '—' && items.includes(this.activeSchema)) {
                        // keep current
                    } else {
                        this.activeSchema = items.includes('dbo') ? 'dbo' :
                                            items.includes('public') ? 'public' : items[0];
                    }
                } else if (!this.activeSchema || this.activeSchema === '—') {
                    this.activeSchema = (this.activeDbType === 'postgresql' ? 'public' : 'dbo');
                }
                this._updateUI();
            } catch (e) {
                if (!this.activeSchema || this.activeSchema === '—') {
                    this.activeSchema = (this.activeDbType === 'postgresql' ? 'public' : 'dbo');
                    this._updateUI();
                }
            }
        }

        // ── Update UI elements ────────────────────────────────────────────────
        _updateUI() {
            if (!this._el) return;
            const id = this.id;
            const dbTypeNames = { sqlserver: 'SQL Server', mssql: 'SQL Server', postgresql: 'PostgreSQL', postgres: 'PostgreSQL' };

            const dbTypeVal = this._el.querySelector(`#${id}-dbtype-val`);
            const connVal   = this._el.querySelector(`#${id}-conn-val`);
            const dbVal     = this._el.querySelector(`#${id}-db-val`);
            const schemaVal = this._el.querySelector(`#${id}-schema-val`);

            if (dbTypeVal) dbTypeVal.textContent = dbTypeNames[this.activeDbType] || this.activeDbType || 'SQL Server';
            if (connVal)   connVal.textContent   = this.activeConnectionName || 'No connection';
            if (dbVal)     dbVal.textContent     = this.activeDatabase || '—';
            if (schemaVal) schemaVal.textContent = this.activeSchema || '—';
        }

        _closeDropdowns() {
            if (this._openDropdown) {
                this._openDropdown.style.display = 'none';
                this._openDropdown = null;
            }
            if (this._el) {
                this._el.querySelectorAll('.bravo-dropdown').forEach(dd => dd.style.display = 'none');
            }
        }

        _notifyChange() {
            const ctx = this.getContext();
            if (typeof this.onChange === 'function') {
                try {
                    this.onChange(ctx);
                } catch (e) {
                    console.error('[BravoConnectionBar] Error in onChange handler:', e);
                }
            }
            // Also dispatch custom event on document
            try {
                document.dispatchEvent(new CustomEvent('bravo-context-changed', { detail: ctx }));
            } catch (_) {}
        }

        _showToast(msg, isSuccess = true) {
            if (typeof this.onStatus === 'function') {
                this.onStatus(msg, isSuccess ? 'idle' : 'error');
            }
        }

        // ── Public API ────────────────────────────────────────────────────────
        getContext() {
            return {
                connectionId: this.activeConnectionId,
                connectionName: this.activeConnectionName,
                database: this.activeDatabase,
                schema: this.activeSchema,
                dbType: this.activeDbType
            };
        }

        setContext(ctx = {}) {
            if (ctx.dbType) this.activeDbType = ctx.dbType;
            if (ctx.connectionId !== undefined) this.activeConnectionId = ctx.connectionId;
            if (ctx.connectionName !== undefined) this.activeConnectionName = ctx.connectionName;
            if (ctx.database !== undefined) this.activeDatabase = ctx.database;
            if (ctx.schema !== undefined) this.activeSchema = ctx.schema;
            this._updateUI();
        }

        async refresh() {
            await this._loadConnections();
            if (this.activeConnectionId) {
                await this._loadDatabases();
            }
            this._updateUI();
        }

        destroy() {
            this._destroyed = true;
            document.removeEventListener('click', this._onDocClick, true);
            if (this._el && this._el.parentNode) {
                this._el.parentNode.removeChild(this._el);
            }
            this._el = null;
            this._connections = [];
        }
    }

    global.BravoConnectionBar = BravoConnectionBar;
})(window);
