/**
 * User & Role Permissions Viewer JavaScript Component.
 * Supports viewing Overview, Role Membership, Database Permissions, Object Permissions.
 * Adheres strictly to Zero Inline Styling and utilizes IDE CSS variables.
 */
(function (global) {
    'use strict';

    class UserPermissionsViewerComponent {
        constructor() {
            this.container = null;
            this.currentTabId = null;
            this.context = null;
            this.activeSubTab = 'overview';
            this.data = {
                properties: {},
                memberships: [],
                permissions: []
            };
            this.isLoading = false;
        }

        init(options) {
            options = options || {};
            const containerId = options.containerId || 'user-permissions-container';
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.error('[UserPermissionsViewer] Container element not found:', containerId);
                return;
            }
        }

        activateTab(tabId, context) {
            this.currentTabId = tabId;
            this.context = context || {};
            if (!this.container) {
                this.init({ containerId: 'user-permissions-container' });
            }
            if (!this.container) return;

            this.renderLayout();
            this.loadData();
        }

        async loadData() {
            if (!this.context) return;
            const connId = this.context.connectionId || this.context.connId;
            const name = this.context.name || this.context.principalName;
            const database = this.context.database;

            if (!connId || !name) {
                this.renderError('Thiếu thông tin kết nối hoặc tên Principal.');
                return;
            }

            this.isLoading = true;
            this.renderLoading();

            try {
                const dbParam = database ? `&database=${encodeURIComponent(database)}` : '';
                const [propsRes, memRes, permRes] = await Promise.all([
                    fetch(`/api/database-users/properties?conn_id=${encodeURIComponent(connId)}&name=${encodeURIComponent(name)}${dbParam}`),
                    fetch(`/api/database-users/memberships?conn_id=${encodeURIComponent(connId)}&name=${encodeURIComponent(name)}${dbParam}`),
                    fetch(`/api/database-users/permissions?conn_id=${encodeURIComponent(connId)}&name=${encodeURIComponent(name)}${dbParam}`)
                ]);

                const propsData = await propsRes.json();
                const memData = await memRes.json();
                const permData = await permRes.json();

                this.data.properties = (propsData && propsData.success && propsData.data) ? propsData.data : {};
                this.data.memberships = (memData && memData.success && Array.isArray(memData.items)) ? memData.items : [];
                this.data.permissions = (permRes.ok && permData && permData.success && Array.isArray(permData.items)) ? permData.items : [];

                this.isLoading = false;
                this.renderSubTabContent();
                this.updateBadges();
            } catch (err) {
                this.isLoading = false;
                this.renderError('Lỗi kết nối khi tải quyền hạn: ' + err.message);
            }
        }

        renderLayout() {
            const name = this.context.name || 'User';
            const dbType = (this.context.dbType || '').toLowerCase().includes('postgr') ? 'PostgreSQL' : 'SQL Server';
            const scope = this.context.database ? `DB: [${this.context.database}]` : 'Cluster Scope';

            this.container.innerHTML = `
                <div class="user-permissions-root">
                    <!-- Header -->
                    <div class="up-header">
                        <div class="up-header-title-wrap">
                            <i class="fa-solid fa-user-shield up-header-icon"></i>
                            <div>
                                <div class="d-flex align-items-center gap-2">
                                    <span class="up-principal-name">${this.escapeHtml(name)}</span>
                                    <span class="badge bg-secondary" style="font-size:10px;">${dbType}</span>
                                    <span class="badge bg-dark border border-secondary text-muted" style="font-size:10px;">${this.escapeHtml(scope)}</span>
                                </div>
                            </div>
                        </div>
                        <div class="up-header-actions">
                            <button type="button" class="btn btn-sm btn-outline-secondary" id="upBtnRefresh" title="Làm mới">
                                <i class="fa-solid fa-rotate-right me-1"></i>Refresh
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-primary" id="upBtnScriptCreate" title="Sinh script CREATE trong Editor">
                                <i class="fa-solid fa-code me-1"></i>Script CREATE
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-danger" id="upBtnScriptDrop" title="Sinh script DROP trong Editor">
                                <i class="fa-solid fa-trash me-1"></i>Script DROP
                            </button>
                        </div>
                    </div>

                    <!-- Nav Tabs -->
                    <div class="up-nav-tabs">
                        <button type="button" class="up-tab-btn active" data-subtab="overview">
                            <i class="fa-solid fa-id-card"></i> Overview
                        </button>
                        <button type="button" class="up-tab-btn" data-subtab="memberships">
                            <i class="fa-solid fa-users"></i> Role Membership
                            <span class="up-tab-badge" id="upBadgeMemberships">0</span>
                        </button>
                        <button type="button" class="up-tab-btn" data-subtab="database_perms">
                            <i class="fa-solid fa-database"></i> Database Permissions
                            <span class="up-tab-badge" id="upBadgeDbPerms">0</span>
                        </button>
                        <button type="button" class="up-tab-btn" data-subtab="object_perms">
                            <i class="fa-solid fa-table"></i> Object Permissions
                            <span class="up-tab-badge" id="upBadgeObjPerms">0</span>
                        </button>
                    </div>

                    <!-- Content -->
                    <div class="up-tab-content-wrap" id="upContentWrap">
                        <!-- Rendered dynamically -->
                    </div>
                </div>
            `;

            this.bindEvents();
        }

        bindEvents() {
            // Subtab navigation
            const tabBtns = this.container.querySelectorAll('.up-tab-btn');
            tabBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    tabBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.activeSubTab = btn.dataset.subtab;
                    this.renderSubTabContent();
                });
            });

            // Action buttons
            const btnRefresh = this.container.querySelector('#upBtnRefresh');
            if (btnRefresh) {
                btnRefresh.addEventListener('click', () => this.loadData());
            }

            const btnCreate = this.container.querySelector('#upBtnScriptCreate');
            if (btnCreate) {
                btnCreate.addEventListener('click', () => this.scriptUser('CREATE'));
            }

            const btnDrop = this.container.querySelector('#upBtnScriptDrop');
            if (btnDrop) {
                btnDrop.addEventListener('click', () => this.scriptUser('DROP'));
            }
        }

        async scriptUser(action) {
            const connId = this.context.connectionId || this.context.connId;
            const name = this.context.name || this.context.principalName;
            const database = this.context.database;

            try {
                if (window.showToast) window.showToast(`Đang sinh script ${action} cho [${name}]...`, 'info');
                const res = await fetch('/api/database-users/script', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conn_id: connId,
                        name: name,
                        action: action,
                        mode: 'full',
                        database: database
                    })
                });
                const data = await res.json();
                if (data && data.success && data.script) {
                    if (window.AppTabs && typeof window.AppTabs.createTab === 'function') {
                        window.AppTabs.createTab({
                            title: `${action}_${name}.sql`,
                            content: data.script,
                            connectionId: connId,
                            database: database,
                            dbType: this.context.dbType
                        });
                    }
                } else {
                    const err = (data && data.error) || 'Không thể sinh script.';
                    alert('Lỗi: ' + err);
                }
            } catch (err) {
                alert('Lỗi sinh script: ' + err.message);
            }
        }

        updateBadges() {
            const badgeMem = this.container.querySelector('#upBadgeMemberships');
            if (badgeMem) badgeMem.textContent = this.data.memberships.length;

            const dbPerms = this.data.permissions.filter(p => p.scope_type === 'database');
            const objPerms = this.data.permissions.filter(p => p.scope_type === 'object' || p.scope_type === 'schema');

            const badgeDb = this.container.querySelector('#upBadgeDbPerms');
            if (badgeDb) badgeDb.textContent = dbPerms.length;

            const badgeObj = this.container.querySelector('#upBadgeObjPerms');
            if (badgeObj) badgeObj.textContent = objPerms.length;
        }

        renderSubTabContent() {
            const contentWrap = this.container.querySelector('#upContentWrap');
            if (!contentWrap) return;

            if (this.isLoading) {
                this.renderLoading();
                return;
            }

            if (this.activeSubTab === 'overview') {
                this.renderOverview(contentWrap);
            } else if (this.activeSubTab === 'memberships') {
                this.renderMemberships(contentWrap);
            } else if (this.activeSubTab === 'database_perms') {
                this.renderDatabasePermissions(contentWrap);
            } else if (this.activeSubTab === 'object_perms') {
                this.renderObjectPermissions(contentWrap);
            }
        }

        renderOverview(container) {
            const p = this.data.properties || {};
            const isPg = (p.engine === 'postgresql');

            let cardsHtml = '';
            if (isPg) {
                cardsHtml = `
                    <div class="up-cards-grid">
                        <div class="up-prop-card">
                            <span class="up-prop-label">Role Name</span>
                            <span class="up-prop-value">${this.escapeHtml(p.name || this.context.name)}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Can Login</span>
                            <span class="up-prop-value">${p.can_login ? '✓ YES (User Account)' : '✗ NO (Role Only)'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Superuser</span>
                            <span class="up-prop-value">${p.is_superuser ? '✓ YES (Superuser)' : 'NO'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Can Create DB</span>
                            <span class="up-prop-value">${p.can_create_db ? 'YES' : 'NO'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Can Create Role</span>
                            <span class="up-prop-value">${p.can_create_role ? 'YES' : 'NO'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Inherit Privileges</span>
                            <span class="up-prop-value">${p.inherit_privileges ? 'YES' : 'NO'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Connection Limit</span>
                            <span class="up-prop-value">${p.connection_limit !== undefined ? p.connection_limit : '-1 (Unlimited)'}</span>
                        </div>
                    </div>
                `;
            } else {
                cardsHtml = `
                    <div class="up-cards-grid">
                        <div class="up-prop-card">
                            <span class="up-prop-label">User Name</span>
                            <span class="up-prop-value">${this.escapeHtml(p.name || this.context.name)}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Principal Type</span>
                            <span class="up-prop-value">${this.escapeHtml(p.type_desc || 'SQL_USER')}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Server Login Mapping</span>
                            <span class="up-prop-value">${p.login_name ? this.escapeHtml(p.login_name) : '<i class="text-muted">(None / Without Login)</i>'}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Default Schema</span>
                            <span class="up-prop-value">${this.escapeHtml(p.default_schema || 'dbo')}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Authentication Type</span>
                            <span class="up-prop-value">${this.escapeHtml(p.authentication_type || 'INSTANCE')}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Create Date</span>
                            <span class="up-prop-value">${this.escapeHtml(p.create_date || '--')}</span>
                        </div>
                        <div class="up-prop-card">
                            <span class="up-prop-label">Modify Date</span>
                            <span class="up-prop-value">${this.escapeHtml(p.modify_date || '--')}</span>
                        </div>
                    </div>
                `;
            }

            container.innerHTML = `
                <div class="up-notice-banner">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>Hiển thị thông tin phân quyền và vai trò theo metadata catalog đã xác thực từ cơ sở dữ liệu.</span>
                </div>
                ${cardsHtml}
            `;
        }

        renderMemberships(container) {
            const list = this.data.memberships || [];
            if (!list.length) {
                container.innerHTML = `
                    <div class="up-empty-state">
                        <i class="fa-solid fa-users-slash up-empty-icon"></i>
                        <h6>Không thuộc Role nào</h6>
                        <small class="text-muted">Principal này hiện chưa được gán thành viên của bất kỳ Database Role nào.</small>
                    </div>
                `;
                return;
            }

            let rowsHtml = '';
            list.forEach(m => {
                const rName = m.role_name;
                const rType = m.role_type || (m.is_fixed_role ? 'FIXED ROLE' : 'ROLE');
                const adminOpt = m.admin_option ? '<span class="badge bg-success">Admin Option</span>' : '';
                rowsHtml += `
                    <tr>
                        <td><strong>${this.escapeHtml(rName)}</strong></td>
                        <td><span class="badge bg-secondary">${this.escapeHtml(rType)}</span></td>
                        <td>${adminOpt}</td>
                    </tr>
                `;
            });

            container.innerHTML = `
                <div class="up-table-container">
                    <div class="up-table-toolbar">
                        <span class="small fw-semibold text-muted">Danh sách Role thành viên (${list.length})</span>
                    </div>
                    <table class="up-data-table">
                        <thead>
                            <tr>
                                <th>Role Name</th>
                                <th>Type</th>
                                <th>Option</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            `;
        }

        renderDatabasePermissions(container) {
            const perms = (this.data.permissions || []).filter(p => p.scope_type === 'database');
            if (!perms.length) {
                container.innerHTML = `
                    <div class="up-empty-state">
                        <i class="fa-solid fa-shield-cat up-empty-icon"></i>
                        <h6>Không có quyền Database trực tiếp</h6>
                        <small class="text-muted">Không tìm thấy bản ghi GRANT/DENY trực tiếp ở cấp độ cơ sở dữ liệu.</small>
                    </div>
                `;
                return;
            }

            let rowsHtml = '';
            perms.forEach(p => {
                const isDeny = (p.state === 'DENY');
                const stateBadge = isDeny
                    ? `<span class="up-badge up-badge-deny">DENY</span>`
                    : `<span class="up-badge up-badge-grant">GRANT</span>`;

                const isRole = (p.source === 'ROLE');
                const sourceBadge = isRole
                    ? `<span class="up-badge up-badge-source-role" title="Qua role: ${this.escapeHtml(p.via_role || '')}">ROLE (${this.escapeHtml(p.via_role || '')})</span>`
                    : `<span class="up-badge up-badge-source-direct">DIRECT</span>`;

                rowsHtml += `
                    <tr>
                        <td><strong>${this.escapeHtml(p.permission_name)}</strong></td>
                        <td>${stateBadge}</td>
                        <td>${sourceBadge}</td>
                        <td>${this.escapeHtml(p.grantor || '--')}</td>
                    </tr>
                `;
            });

            container.innerHTML = `
                <div class="up-table-container">
                    <div class="up-table-toolbar">
                        <span class="small fw-semibold text-muted">Quyền phạm vi Database (${perms.length})</span>
                    </div>
                    <table class="up-data-table">
                        <thead>
                            <tr>
                                <th>Permission</th>
                                <th>State</th>
                                <th>Source</th>
                                <th>Grantor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            `;
        }

        renderObjectPermissions(container) {
            const perms = (this.data.permissions || []).filter(p => p.scope_type === 'object' || p.scope_type === 'schema');
            if (!perms.length) {
                container.innerHTML = `
                    <div class="up-empty-state">
                        <i class="fa-solid fa-table-list up-empty-icon"></i>
                        <h6>Không có quyền Object riêng lẻ</h6>
                        <small class="text-muted">Principal chưa được cấp quyền riêng biệt trên các Bảng, View, Procedure hoặc Schema cụ thể.</small>
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <div class="up-table-container">
                    <div class="up-table-toolbar">
                        <span class="small fw-semibold text-muted">Quyền Object / Schema (${perms.length})</span>
                        <input type="text" class="up-search-input" id="upObjFilterInput" placeholder="Lọc đối tượng...">
                    </div>
                    <div style="max-height: 520px; overflow-y: auto;">
                        <table class="up-data-table" id="upObjTable">
                            <thead>
                                <tr>
                                    <th>Schema</th>
                                    <th>Object Name</th>
                                    <th>Object Type</th>
                                    <th>Permission</th>
                                    <th>State</th>
                                    <th>Source</th>
                                </tr>
                            </thead>
                            <tbody id="upObjTableBody">
                                <!-- Rendered dynamically -->
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const tbody = container.querySelector('#upObjTableBody');
            const renderRows = (filter = '') => {
                const q = filter.trim().toLowerCase();
                let filtered = perms;
                if (q) {
                    filtered = perms.filter(p =>
                        (p.object_name && p.object_name.toLowerCase().includes(q)) ||
                        (p.schema_name && p.schema_name.toLowerCase().includes(q)) ||
                        (p.permission_name && p.permission_name.toLowerCase().includes(q))
                    );
                }

                if (!filtered.length) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">Không có đối tượng khớp bộ lọc.</td></tr>`;
                    return;
                }

                let html = '';
                filtered.forEach(p => {
                    const isDeny = (p.state === 'DENY');
                    const stateBadge = isDeny
                        ? `<span class="up-badge up-badge-deny">DENY</span>`
                        : `<span class="up-badge up-badge-grant">GRANT</span>`;

                    const isRole = (p.source === 'ROLE');
                    const sourceBadge = isRole
                        ? `<span class="up-badge up-badge-source-role" title="Qua role: ${this.escapeHtml(p.via_role || '')}">ROLE (${this.escapeHtml(p.via_role || '')})</span>`
                        : `<span class="up-badge up-badge-source-direct">DIRECT</span>`;

                    html += `
                        <tr>
                            <td>${this.escapeHtml(p.schema_name || 'dbo')}</td>
                            <td><strong>${this.escapeHtml(p.object_name || p.schema_name || '--')}</strong></td>
                            <td><span class="badge bg-secondary" style="font-size:10px;">${this.escapeHtml(p.object_type || p.scope_type)}</span></td>
                            <td>${this.escapeHtml(p.permission_name)}</td>
                            <td>${stateBadge}</td>
                            <td>${sourceBadge}</td>
                        </tr>
                    `;
                });
                tbody.innerHTML = html;
            };

            renderRows();

            const filterInput = container.querySelector('#upObjFilterInput');
            if (filterInput) {
                filterInput.addEventListener('input', (e) => {
                    renderRows(e.target.value);
                });
            }
        }

        renderLoading() {
            const contentWrap = this.container.querySelector('#upContentWrap');
            if (contentWrap) {
                contentWrap.innerHTML = `
                    <div class="up-loading-overlay">
                        <i class="fa-solid fa-spinner fa-spin fa-2x text-primary"></i>
                        <span>Đang tải thông tin phân quyền...</span>
                    </div>
                `;
            }
        }

        renderError(msg) {
            const contentWrap = this.container.querySelector('#upContentWrap');
            if (contentWrap) {
                contentWrap.innerHTML = `
                    <div class="alert alert-danger m-3" role="alert">
                        <i class="fa-solid fa-triangle-exclamation me-2"></i>${this.escapeHtml(msg)}
                    </div>
                `;
            }
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
    }

    global.UserPermissionsViewer = new UserPermissionsViewerComponent();

})(typeof window !== 'undefined' ? window : this);
