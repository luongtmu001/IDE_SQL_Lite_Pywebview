/**
 * BravoWindow — A single floating BRAVO Tool window instance.
 * Each window has its own DOM element, backend session, and feature state.
 */
(function (global) {
    'use strict';

    let _zCounter = 2000;

    class BravoWindow {
        constructor(windowId, options = {}) {
            this.id = windowId;
            this.options = options;
            this.isStandalone = !!(options.isStandalone || windowId === 'standalone');

            // State
            this.bravoSessionId = null;
            this.activeConnectionId = options.connectionId || null;
            this.activeConnectionName = options.connectionName || 'No connection';
            this.activeDatabase = options.database || '—';
            this.activeSchema = options.schema || '—';
            this.activeDbType = options.dbType || 'sqlserver';
            this.activeFeatureId = options.featureId || null;
            this._activeFeatureModule = null;

            // Timing
            this._execStartTime = null;
            this._timingInterval = null;

            // Dropdowns
            this._openDropdown = null;

            // Window state
            this._minimized = false;

            // Build the DOM
            this._el = null;
            this._buildDOM();
            this._initDrag();
            this._initResize();
            this._restoreGeometry();
            this._initSession();
            this._renderNav();
            this._applyTheme();

            // Listen for theme changes
            this._themeObserver = new MutationObserver(() => this._applyTheme());
            this._themeObserver.observe(document.documentElement, {
                attributes: true, attributeFilter: ['data-bs-theme']
            });

            // Close dropdowns on outside click
            this._onDocClick = (e) => {
                if (this._openDropdown && !this._openDropdown.contains(e.target)
                    && !e.target.closest('.bravo-ctx-select')) {
                    this._closeDropdowns();
                }
            };
            document.addEventListener('click', this._onDocClick, true);

            // Open animation
            this._el.classList.add('bravo-anim-open');
            setTimeout(() => this._el.classList.remove('bravo-anim-open'), 300);

            // Focus on click
            this._el.addEventListener('pointerdown', () => this._bringToFront(), true);
        }

        // ── DOM Build ─────────────────────────────────────────────────────────
        _buildDOM() {
            const el = document.createElement('div');
            el.className = 'bravo-window' + (this.isStandalone ? ' bravo-standalone' : '');
            el.id = `bravo-window-${this.id}`;
            el.innerHTML = `
                <!-- Title bar -->
                ${this.isStandalone ? '' : `
                <div class="bravo-titlebar" id="bravo-tb-${this.id}">
                    <i class="fa-solid fa-layer-group bravo-titlebar-icon"></i>
                    <span class="bravo-titlebar-title">BRAVO Tool</span>
                    <span class="bravo-titlebar-badge bravo-env-dev" id="bravo-env-badge-${this.id}" title="Environment">DEV</span>
                    <div class="bravo-titlebar-actions">
                        <button class="bravo-win-btn minimize" id="bravo-min-${this.id}" title="Thu nhỏ">
                            <i class="fa-solid fa-minus"></i>
                        </button>
                        <button class="bravo-win-btn close" id="bravo-close-${this.id}" title="Đóng">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                `}

                <!-- Body: nav + content -->
                <div class="bravo-body" style="position:relative;">
                    <!-- Connection Toast Notification Overlay -->
                    <div class="bravo-conn-toast" id="bravo-toast-${this.id}" style="display:none;"></div>
                    <!-- Left nav -->
                    <div class="bravo-nav" id="bravo-nav-${this.id}">
                        <div class="bravo-nav-header">
                            <span class="bravo-nav-title">Chức năng</span>
                            <button type="button" class="bravo-nav-toggle-btn" id="bravo-nav-toggle-${this.id}" title="Thu gọn / Mở rộng Sidebar">
                                <i class="fa-solid fa-chevron-left"></i>
                            </button>
                        </div>
                        <div id="bravo-nav-items-${this.id}"></div>
                    </div>
                    <!-- Nav resize handle -->
                    <div class="bravo-nav-resizer" id="bravo-nav-resizer-${this.id}"></div>
                    <!-- Right content -->
                    <div class="bravo-content" id="bravo-content-${this.id}">
                        <div class="bravo-content-header" id="bravo-content-hdr-${this.id}" style="display:none;">
                            <i class="fa-solid fa-puzzle-piece" id="bravo-content-hdr-icon-${this.id}" style="color:var(--ide-accent);font-size:13px;"></i>
                            <span class="bravo-content-title" id="bravo-content-hdr-title-${this.id}"></span>
                            <span class="bravo-content-subtitle" id="bravo-content-hdr-sub-${this.id}"></span>
                        </div>
                        <div class="bravo-content-body" id="bravo-content-body-${this.id}">
                            <div class="bravo-content-empty">
                                <i class="fa-solid fa-layer-group"></i>
                                <p>Chọn một chức năng bên trái để bắt đầu.</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Status bar -->
                <div class="bravo-statusbar" id="bravo-status-${this.id}">
                    <div class="bravo-status-state">
                        <span class="bravo-status-dot" id="bravo-status-dot-${this.id}"></span>
                        <span id="bravo-status-text-${this.id}">Ready</span>
                    </div>
                    <span class="bravo-status-timing" id="bravo-status-timing-${this.id}"></span>
                    <span class="bravo-status-target" id="bravo-status-target-${this.id}">
                        Target: <strong>—</strong>
                    </span>
                    <button class="bravo-status-cancel" id="bravo-cancel-${this.id}">
                        <i class="fa-solid fa-stop me-1"></i>Cancel
                    </button>
                </div>

                <!-- SE resize handle -->
                <div class="bravo-resize-handle se" id="bravo-rh-se-${this.id}"></div>
                <div class="bravo-resize-handle e"  id="bravo-rh-e-${this.id}"></div>
                <div class="bravo-resize-handle s"  id="bravo-rh-s-${this.id}"></div>
                <div class="bravo-resize-handle w"  id="bravo-rh-w-${this.id}"></div>
                <div class="bravo-resize-handle n"  id="bravo-rh-n-${this.id}"></div>
            `;

            document.body.appendChild(el);
            this._el = el;

            // Wire buttons
            if (!this.isStandalone) {
                el.querySelector(`#bravo-close-${this.id}`)?.addEventListener('click', () => this.close());
                el.querySelector(`#bravo-min-${this.id}`)?.addEventListener('click', () => this.toggleMinimize());
            }

            // Wire nav resizer
            this._initNavResize();
        }

        // ── Session ───────────────────────────────────────────────────────────
        async _initSession() {
            try {
                const res = await fetch('/api/bravo/session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        connection_id: this.activeConnectionId,
                        window_id: this.id
                    })
                });
                const data = await res.json();
                if (data.success) {
                    this.bravoSessionId = data.bravo_session_id;
                }
            } catch (e) {
                console.warn('[BRAVO] Could not create backend session:', e);
            }

            // Load connections
            await this._loadConnections();

            // Auto-resolve active database and schema if needed
            if (this.activeConnectionId) {
                if (!this.activeDatabase || this.activeDatabase === '—') {
                    await this._loadDatabases();
                } else if (!this.activeSchema || this.activeSchema === '—') {
                    await this._loadSchemas();
                }
            }

            this._updateTopbar();
            this._notifyContextChange();
        }

        // ── Load connections (Active + Saved profiles) ───────────────────────
        async _loadConnections() {
            try {
                // 1. Fetch active backend connections
                const res = await fetch('/api/connections');
                const data = await res.json();
                const activeConns = data.connections || [];

                // 2. Fetch saved connections from localStorage
                let savedConns = [];
                try {
                    const raw = window.AppStorage ? JSON.stringify(await window.AppStorage.getSavedConnections()) : localStorage.getItem('ide_saved_connections');
                    if (raw) savedConns = JSON.parse(raw);
                } catch (e) {}

                const map = new Map();

                // Add saved connections first (exclude group markers)
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

                // Add or update active connections
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

                // If no active connection yet, try to inherit from IDE
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

        // ── Status Target & Window Title update ──────────────────────────────
        updateStatusTarget(connName, dbName) {
            const id = this.id;
            const target = this._el ? this._el.querySelector(`#bravo-status-target-${id}`) : null;
            if (target) {
                const safeText = (s) => (s || '—').toString().replace(/</g, '&lt;');
                const conn = connName || this.activeConnectionName || '—';
                const db   = dbName || this.activeDatabase || '—';
                target.innerHTML = `Target: <strong>${safeText(conn)}</strong> → <strong>${safeText(db)}</strong>`;
            }
        }

        _updateTopbar() {
            this.updateStatusTarget(this.activeConnectionName, this.activeDatabase);
            if (this.bravoSessionId) {
                fetch(`/api/bravo/session/${this.bravoSessionId}`, { method: 'GET' }).catch(() => {});
            }
        }

        // ── Nav ───────────────────────────────────────────────────────────────
        _renderNav() {
            const navItems = this._el.querySelector(`#bravo-nav-items-${this.id}`);
            if (!navItems) return;
            const features = window.BravoFeatureRegistry ? window.BravoFeatureRegistry.getAll() : [];
            navItems.innerHTML = '';
            features.forEach(f => {
                const item = document.createElement('div');
                item.className = 'bravo-nav-item' + (this.activeFeatureId === f.id ? ' active' : '');
                item.dataset.featureId = f.id;
                item.title = f.displayName;
                item.innerHTML = `<i class="fa-solid ${f.icon || 'fa-puzzle-piece'}"></i><span class="bravo-nav-text">${f.displayName}</span>`;
                item.addEventListener('click', () => this.loadFeature(f.id));
                navItems.appendChild(item);
            });

            // Auto-load first feature if none active
            if (!this.activeFeatureId && features.length > 0) {
                this.loadFeature(features[0].id);
            }
        }

        // ── Feature loading ───────────────────────────────────────────────────
        loadFeature(featureId) {
            const registry = window.BravoFeatureRegistry;
            if (!registry) return;
            const feature = registry.get(featureId);
            if (!feature) return;

            // Destroy previous
            if (this._activeFeatureModule && this._activeFeatureModule.destroy) {
                try { this._activeFeatureModule.destroy(); } catch (e) {}
            }

            this.activeFeatureId = featureId;
            this._activeFeatureModule = feature;

            // Update nav highlight
            this._el.querySelectorAll('.bravo-nav-item').forEach(item => {
                item.classList.toggle('active', item.dataset.featureId === featureId);
            });

            // Update content header
            const hdr     = this._el.querySelector(`#bravo-content-hdr-${this.id}`);
            const hdrIcon = this._el.querySelector(`#bravo-content-hdr-icon-${this.id}`);
            const hdrTitle = this._el.querySelector(`#bravo-content-hdr-title-${this.id}`);
            const hdrSub  = this._el.querySelector(`#bravo-content-hdr-sub-${this.id}`);
            if (hdr) hdr.style.display = 'flex';
            if (hdrIcon) hdrIcon.className = `fa-solid ${feature.icon || 'fa-puzzle-piece'}`;
            if (hdrTitle) hdrTitle.textContent = feature.displayName;
            if (hdrSub) hdrSub.textContent = feature.description || '';

            // Mount content
            const contentBody = this._el.querySelector(`#bravo-content-body-${this.id}`);
            if (contentBody) {
                contentBody.innerHTML = '';
                const ctx = {
                    windowId: this.id,
                    bravoSessionId: this.bravoSessionId,
                    connectionId: this.activeConnectionId,
                    connectionName: this.activeConnectionName,
                    database: this.activeDatabase,
                    schema: this.activeSchema,
                    dbType: this.activeDbType,
                    setStatus: (msg, state) => this.setStatus(msg, state),
                    startTiming: () => this.startTiming(),
                    stopTiming: () => this.stopTiming(),
                    showToast: (msg, isSuccess) => this.showConnectionToast(msg, isSuccess),
                    onContextChanged: (newCtx) => {
                        if (!newCtx) return;
                        this.activeConnectionId = newCtx.connectionId;
                        this.activeConnectionName = newCtx.connectionName;
                        this.activeDatabase = newCtx.database;
                        this.activeSchema = newCtx.schema;
                        this.activeDbType = newCtx.dbType;
                        this.updateStatusTarget(this.activeConnectionName, this.activeDatabase);
                        this._syncWindowTitle();
                    }
                };
                try {
                    feature.mount(contentBody, ctx);
                } catch (e) {
                    contentBody.innerHTML = `<div class="bravo-content-empty">
                        <i class="fa-solid fa-triangle-exclamation" style="color:var(--ide-danger)"></i>
                        <p>Lỗi load feature: ${e.message}</p>
                    </div>`;
                }
            }

            // Save state
            this._saveGeometry();
        }

        // ── Status bar ────────────────────────────────────────────────────────
        setStatus(msg, state = 'idle') {
            const dot  = this._el.querySelector(`#bravo-status-dot-${this.id}`);
            const text = this._el.querySelector(`#bravo-status-text-${this.id}`);
            const cancelBtn = this._el.querySelector(`#bravo-cancel-${this.id}`);
            if (dot) {
                dot.className = 'bravo-status-dot';
                if (state === 'running') dot.classList.add('running');
                if (state === 'error') dot.classList.add('error');
            }
            if (text) text.textContent = msg || 'Ready';
            if (cancelBtn) cancelBtn.classList.toggle('visible', state === 'running');
        }

        startTiming() {
            this._execStartTime = performance.now();
            const timing = this._el.querySelector(`#bravo-status-timing-${this.id}`);
            if (this._timingInterval) clearInterval(this._timingInterval);
            this._timingInterval = setInterval(() => {
                if (timing) timing.textContent = Math.round(performance.now() - this._execStartTime) + 'ms';
            }, 100);
        }

        stopTiming() {
            if (this._timingInterval) {
                clearInterval(this._timingInterval);
                this._timingInterval = null;
            }
            const timing = this._el.querySelector(`#bravo-status-timing-${this.id}`);
            if (timing && this._execStartTime) {
                timing.textContent = Math.round(performance.now() - this._execStartTime) + 'ms';
            }
        }

        // ── Theme sync ────────────────────────────────────────────────────────
        _applyTheme() {
            // Floating window inherits CSS variables automatically — nothing extra needed.
            // This hook is available for feature modules that need to react.
            const curTheme = document.documentElement.getAttribute('data-bs-theme') || document.documentElement.dataset.bsTheme || 'dark';
            if (this._activeFeatureModule && this._activeFeatureModule.onThemeChange) {
                this._activeFeatureModule.onThemeChange(curTheme);
            }
        }

        // ── Window geometry ───────────────────────────────────────────────────
        _restoreGeometry() {
            if (this.isStandalone || this.id === 'standalone') {
                this._el.style.left = '0px';
                this._el.style.top = '0px';
                this._el.style.width = '100vw';
                this._el.style.height = '100vh';
                return;
            }
            const key = `bravo-window-state-${this.id}`;
            const defaultState = {
                left: Math.max(80, (window.innerWidth - 900) / 2),
                top:  Math.max(60, (window.innerHeight - 600) / 2),
                width: 900,
                height: 600,
                featureId: null
            };
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem('bravo-window-state') || '{}'); } catch (e) {}
            const state = Object.assign(defaultState, saved);

            // Clamp into viewport
            state.left  = Math.max(0, Math.min(state.left, window.innerWidth  - 300));
            state.top   = Math.max(0, Math.min(state.top,  window.innerHeight - 100));
            state.width  = Math.max(720, Math.min(state.width,  window.innerWidth));
            state.height = Math.max(440, Math.min(state.height, window.innerHeight));

            this._el.style.left   = state.left + 'px';
            this._el.style.top    = state.top  + 'px';
            this._el.style.width  = state.width  + 'px';
            this._el.style.height = state.height + 'px';

            if (state.featureId && !this.activeFeatureId) {
                this.activeFeatureId = state.featureId;
            }
        }

        _saveGeometry() {
            if (this.isStandalone || this.id === 'standalone') return;
            const rect = this._el.getBoundingClientRect();
            const state = {
                left: rect.left, top: rect.top,
                width: rect.width, height: rect.height,
                featureId: this.activeFeatureId
            };
            try { localStorage.setItem('bravo-window-state', JSON.stringify(state)); } catch (e) {}
        }

        // ── Drag ─────────────────────────────────────────────────────────────
        _initDrag() {
            if (this.isStandalone) return;
            const titlebar = this._el.querySelector(`#bravo-tb-${this.id}`);
            let dragging = false, startX = 0, startY = 0, startL = 0, startT = 0;

            titlebar.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.bravo-win-btn')) return;
                dragging = true;
                this._bringToFront();
                const rect = this._el.getBoundingClientRect();
                startX = e.clientX; startY = e.clientY;
                startL = rect.left; startT = rect.top;
                titlebar.setPointerCapture(e.pointerId);
            });

            titlebar.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                let l = startL + (e.clientX - startX);
                let t = startT + (e.clientY - startY);
                const w = this._el.offsetWidth, h = this._el.offsetHeight;
                l = Math.max(0, Math.min(l, window.innerWidth  - w));
                t = Math.max(0, Math.min(t, window.innerHeight - h));
                this._el.style.left = l + 'px';
                this._el.style.top  = t + 'px';
            });

            const stopDrag = () => {
                if (!dragging) return;
                dragging = false;
                this._saveGeometry();
            };
            titlebar.addEventListener('pointerup', stopDrag);
            titlebar.addEventListener('pointercancel', stopDrag);
        }

        // ── Resize (window edges) ─────────────────────────────────────────────
        _initResize() {
            if (this.isStandalone) return;
            const handles = ['se', 'e', 's', 'w', 'n'];
            handles.forEach(dir => {
                const handle = this._el.querySelector(`#bravo-rh-${dir}-${this.id}`);
                if (!handle) return;
                let active = false;
                let startX, startY, startW, startH, startL, startT;

                handle.addEventListener('pointerdown', (e) => {
                    active = true;
                    this._bringToFront();
                    const rect = this._el.getBoundingClientRect();
                    startX = e.clientX; startY = e.clientY;
                    startW = rect.width; startH = rect.height;
                    startL = rect.left;  startT = rect.top;
                    handle.setPointerCapture(e.pointerId);
                    e.preventDefault();
                });

                handle.addEventListener('pointermove', (e) => {
                    if (!active) return;
                    const dx = e.clientX - startX;
                    const dy = e.clientY - startY;
                    let w = startW, h = startH, l = startL, t = startT;

                    if (dir.includes('e') || dir === 'se') w = Math.max(720, startW + dx);
                    if (dir.includes('s') || dir === 'se') h = Math.max(440, startH + dy);
                    if (dir === 'w') { w = Math.max(720, startW - dx); l = startL + (startW - w); }
                    if (dir === 'n') { h = Math.max(440, startH - dy); t = startT + (startH - h); }

                    this._el.style.width  = w + 'px';
                    this._el.style.height = h + 'px';
                    this._el.style.left   = l + 'px';
                    this._el.style.top    = t + 'px';
                });

                const stop = () => {
                    if (!active) return;
                    active = false;
                    this._saveGeometry();
                };
                handle.addEventListener('pointerup', stop);
                handle.addEventListener('pointercancel', stop);
            });
        }

        // ── Window Title Sync & Context Change Notification ──────────────────
        _syncWindowTitle() {
            let title = 'BRAVO Tool';
            if (this.activeConnectionName && this.activeDatabase && this.activeDatabase !== '—') {
                title = `${this.activeConnectionName} - ${this.activeDatabase} - BRAVO Tool`;
            } else if (this.activeConnectionName && this.activeConnectionName !== 'No connection' && this.activeConnectionName !== 'Chưa kết nối') {
                title = `${this.activeConnectionName} - BRAVO Tool`;
            }
            document.title = title;
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.set_window_title === 'function') {
                window.pywebview.api.set_window_title(title).catch(() => {});
            }
        }

        _notifyContextChange() {
            if (this.isStandalone) {
                const tbTitle = this._el ? this._el.querySelector(`#bravo-tb-title-${this.id}`) : null;
                if (tbTitle) {
                    if (this.activeConnectionName && this.activeDatabase && this.activeDatabase !== '—') {
                        tbTitle.textContent = `BRAVO Tool — [${this.activeConnectionName}] › [${this.activeDatabase}]`;
                    } else if (this.activeConnectionName && this.activeConnectionName !== 'No connection') {
                        tbTitle.textContent = `BRAVO Tool — [${this.activeConnectionName}]`;
                    } else {
                        tbTitle.textContent = 'BRAVO Tool — Layout Editor';
                    }
                }
            }
            const ctx = {
                windowId: this.id,
                bravoSessionId: this.bravoSessionId,
                connectionId: this.activeConnectionId,
                connectionName: this.activeConnectionName,
                database: this.activeDatabase,
                schema: this.activeSchema,
                dbType: this.activeDbType,
                setStatus: (msg, state) => this.setStatus(msg, state),
                isAlive: () => !this._destroyed
            };
            if (this._activeFeatureModule && typeof this._activeFeatureModule.onContextChange === 'function') {
                try {
                    this._activeFeatureModule.onContextChange(ctx);
                } catch (err) {
                    console.error('[BRAVO] Error notifying feature context change:', err);
                }
            }
        }

        // ── Nav panel resize ──────────────────────────────────────────────────
        _initNavResize() {
            const resizer = this._el.querySelector(`#bravo-nav-resizer-${this.id}`);
            const nav     = this._el.querySelector(`#bravo-nav-${this.id}`);
            const toggleBtn = this._el.querySelector(`#bravo-nav-toggle-${this.id}`);
            if (!nav) return;

            const defaultWidth = 200;
            const collapsedWidth = 44;

            const setCollapsedState = (collapsed, targetWidth = null) => {
                if (collapsed) {
                    nav.classList.add('collapsed');
                    nav.style.width = (targetWidth || collapsedWidth) + 'px';
                    if (toggleBtn) toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
                } else {
                    nav.classList.remove('collapsed');
                    nav.style.width = (targetWidth || defaultWidth) + 'px';
                    if (toggleBtn) toggleBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
                }
            };

            // Wire Toggle Button
            if (toggleBtn) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isCollapsed = nav.classList.contains('collapsed') || nav.offsetWidth <= 60;
                    setCollapsedState(!isCollapsed);
                });
            }

            // Wire Resizer drag
            if (resizer) {
                let active = false, startX = 0, startW = 0;

                resizer.addEventListener('pointerdown', (e) => {
                    active = true;
                    resizer.classList.add('dragging');
                    startX = e.clientX;
                    startW = nav.offsetWidth;
                    resizer.setPointerCapture(e.pointerId);
                    e.preventDefault();
                });
                resizer.addEventListener('pointermove', (e) => {
                    if (!active) return;
                    const w = Math.max(collapsedWidth, Math.min(startW + (e.clientX - startX), 360));
                    if (w <= 60) {
                        setCollapsedState(true, collapsedWidth);
                    } else {
                        setCollapsedState(false, w);
                    }
                });
                const stop = () => {
                    if (!active) return;
                    active = false;
                    resizer.classList.remove('dragging');
                };
                resizer.addEventListener('pointerup', stop);
                resizer.addEventListener('pointercancel', stop);
            }
        }

        // ── Window management ─────────────────────────────────────────────────
        _bringToFront() {
            _zCounter++;
            this._el.style.zIndex = _zCounter;
            this._el.classList.add('focused');
            document.querySelectorAll('.bravo-window').forEach(w => {
                if (w !== this._el) w.classList.remove('focused');
            });
        }

        // ── Toast notification & Connection status check ──────────────────────
        showConnectionToast(msg, isSuccess = true) {
            const toast = this._el.querySelector(`#bravo-toast-${this.id}`);
            if (!toast) return;
            toast.className = `bravo-conn-toast ${isSuccess ? 'success' : 'warning'} fade-in`;
            toast.innerHTML = `<i class="fa-solid ${isSuccess ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> <span>${msg}</span>`;
            toast.style.display = 'flex';

            if (this._toastTimer) clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                toast.classList.remove('fade-in');
                toast.classList.add('fade-out');
                setTimeout(() => {
                    toast.style.display = 'none';
                    toast.classList.remove('fade-out');
                }, 300);
            }, 1000);
        }

        async checkConnectionStatus() {
            if (!this.activeConnectionId) {
                this.showConnectionToast('Chưa có kết nối nào', false);
                return false;
            }
            try {
                await this._loadConnections();

                // Check by connection_id or id
                let conn = (this._connections || []).find(c => 
                    String(c.connection_id) === String(this.activeConnectionId) || 
                    String(c.id) === String(this.activeConnectionId)
                );

                // Fallback check by name if active
                if (!conn) {
                    conn = (this._connections || []).find(c => c.isActive && c.name === this.activeConnectionName);
                    if (conn) {
                        this.activeConnectionId = conn.connection_id;
                    }
                }

                if (conn && conn.isActive) {
                    const name = conn.name || this.activeConnectionName || 'Connection';
                    this.showConnectionToast(`Đang kết nối: ${name}`, true);
                    return true;
                }

                // If active backend connection expired, attempt to auto-reconnect using stored profile config
                if (conn && conn.config) {
                    try {
                        const res = await fetch('/api/connections', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(conn.config)
                        });
                        const data = await res.json();
                        if (data.success && data.connection) {
                            this.activeConnectionId = data.connection.connection_id;
                            this.activeConnectionName = conn.name;
                            await this._loadConnections();
                            this.showConnectionToast(`Đang kết nối: ${this.activeConnectionName}`, true);
                            return true;
                        }
                    } catch (eReconn) {}
                }

                const dispName = this.activeConnectionName || 'Connection';
                this.showConnectionToast(`Kết nối "${dispName}" không khả dụng`, false);
                return false;
            } catch (e) {
                this.showConnectionToast('Lỗi kiểm tra kết nối', false);
                return false;
            }
        }

        // ── Hide (minimize) and restore ───────────────────────────────────────
        toggleMinimize() {
            if (this.isStandalone && window.pywebview && window.pywebview.api && window.pywebview.api.minimize_window) {
                window.pywebview.api.minimize_window();
                return;
            }
            if (this._minimized) {
                this.restore();
            } else {
                this.hide();
            }
        }

        hide() {
            if (!this.activeConnectionId) {
                // Rule 2: No active connection -> Do NOT preserve profile, destroy/close directly!
                this.close();
                return;
            }
            this._minimized = true;
            this._el.classList.add('bravo-anim-hide');
            setTimeout(() => {
                this._el.style.display = 'none';
                this._el.classList.remove('bravo-anim-hide');
                document.dispatchEvent(new CustomEvent('bravo-window-hidden', { detail: { windowId: this.id } }));
            }, 200);
        }

        restore() {
            this._minimized = false;
            this._el.style.display = 'flex';
            this._el.classList.add('bravo-anim-open');
            this._bringToFront();
            setTimeout(() => {
                this._el.classList.remove('bravo-anim-open');
            }, 300);
            // Check connection status upon restore
            this.checkConnectionStatus();
            document.dispatchEvent(new CustomEvent('bravo-window-restored', { detail: { windowId: this.id } }));
        }

        async close() {
            if (this.isStandalone && window.pywebview && window.pywebview.api && window.pywebview.api.close_window) {
                try {
                    await window.pywebview.api.close_window();
                    return;
                } catch (e) {
                    console.warn('[BRAVO] Native window close error:', e);
                }
            }
            // Destroy active feature
            if (this._activeFeatureModule && this._activeFeatureModule.destroy) {
                try { this._activeFeatureModule.destroy(); } catch (e) {}
            }
            // Release backend session
            if (this.bravoSessionId) {
                fetch(`/api/bravo/session/${this.bravoSessionId}`, { method: 'DELETE' }).catch(() => {});
            }
            // Teardown
            this._themeObserver.disconnect();
            document.removeEventListener('click', this._onDocClick, true);
            this._el.remove();
            document.dispatchEvent(new CustomEvent('bravo-window-closed', { detail: { windowId: this.id } }));
        }
    }

    global.BravoWindow = BravoWindow;

})(window);
