/**
 * BRAVO Feature: Danh sách chương trình (Program List)
 * Feature ID: program-list
 * Specification: BRAVO_programlist.md + Group Navigator + Modal Editor + Drag-Drop + Bulk Delete
 */
(function () {
    'use strict';

    if (typeof window.BravoFeatureRegistry === 'undefined') {
        console.warn('[BRAVO] BravoFeatureRegistry not loaded. program-list will not register.');
        return;
    }

    BravoFeatureRegistry.register({
        id: 'program-list',
        displayName: 'Danh sách chương trình',
        icon: 'fa-list-check',
        order: 5,
        description: 'Quản lý danh sách kết nối và khởi chạy nhanh các chương trình BRAVO',

        // ── Component State ──────────────────────────────────────────────────
        _container: null,
        _context: null,
        _programs: [],
        _groups: [],
        _activeGroupId: '__ALL__', // '__ALL__' | '__UNGROUPED__' | custom group ID / name
        _selectedIds: new Set(),
        _filterText: '',
        _filterVisible: false,
        _sortColumn: 'stt', // 'stt' | 'name'
        _sortAsc: true,
        _isChoosingFile: false,

        // Drag and Drop state
        _draggedId: null,
        _dragOverId: null,
        _dropPosition: 'bottom', // 'top' | 'bottom'

        // Navigator resizer state
        _isResizingNav: false,

        // Context Menu state
        _ctxMenuDocClickHandler: null,
        _ctxMenuKeyHandler: null,

        mount(containerEl, context) {
            this._container = containerEl;
            this._context = context;
            this._selectedIds = new Set();
            this._renderSkeleton();
            this._loadData();
        },

        destroy() {
            this._closeContextMenu();
            this._container = null;
            this._context = null;
            this._selectedIds.clear();
        },

        // ── Render Skeleton Layout ───────────────────────────────────────────
        _renderSkeleton() {
            if (!this._container) return;

            this._container.innerHTML = `
                <div class="bravo-pl-container" id="bravo-pl-main-container">
                    <!-- Left Sidebar: Categories / Groups Navigator -->
                    <div class="bravo-pl-nav" id="bravo-pl-nav-sidebar">
                        <div class="bravo-pl-nav-header">
                            <div class="bravo-pl-nav-title">
                                <i class="fa-solid fa-folder-tree"></i>
                                <span>Nhóm</span>
                            </div>
                            <button type="button" class="bravo-pl-btn-add-group" id="bravo-pl-btn-add-group" title="Tạo nhóm mới">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                        <div class="bravo-pl-nav-list" id="bravo-pl-nav-list">
                            <!-- Populated dynamically -->
                        </div>
                    </div>

                    <!-- Resizer between Navigator and Main -->
                    <div class="bravo-pl-nav-resizer" id="bravo-pl-nav-resizer" title="Kéo để điều chỉnh độ rộng nhóm"></div>

                    <!-- Right Panel: Main Content (Toolbar + Table) -->
                    <div class="bravo-pl-main">
                        <!-- Toolbar -->
                        <div class="bravo-pl-toolbar">
                            <div class="bravo-pl-toolbar-actions">
                                <button type="button" class="btn btn-sm btn-primary" id="bravo-pl-btn-new" title="Thêm chương trình mới">
                                    <i class="fa-solid fa-plus me-1"></i>Thêm mới
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="bravo-pl-btn-clone" title="Nhân bản (chọn 1 chương trình)" disabled>
                                    <i class="fa-solid fa-copy me-1"></i>Thêm bản sao
                                </button>
                                <button type="button" class="btn btn-sm btn-warning text-dark" id="bravo-pl-btn-edit" title="Sửa thông tin (chọn 1 chương trình)" disabled>
                                    <i class="fa-solid fa-pen-to-square me-1"></i>Sửa
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-info" id="bravo-pl-btn-move-group" title="Chuyển nhóm (chọn 1 hoặc nhiều chương trình)" disabled>
                                    <i class="fa-solid fa-arrow-right-arrow-left me-1"></i>Chuyển nhóm
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-danger" id="bravo-pl-btn-delete" title="Xóa các chương trình đã chọn" disabled>
                                    <i class="fa-solid fa-trash-can me-1"></i><span id="bravo-pl-btn-delete-text">Xóa</span>
                                </button>
                                <span class="border-end mx-1" style="height: 18px; border-color: var(--ide-border) !important;"></span>
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="bravo-pl-btn-up" title="Di chuyển lên trên (chọn 1 dòng)">
                                    <i class="fa-solid fa-arrow-up"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="bravo-pl-btn-down" title="Di chuyển xuống dưới (chọn 1 dòng)">
                                    <i class="fa-solid fa-arrow-down"></i>
                                </button>
                            </div>
                            <div class="bravo-pl-toolbar-right">
                                <div class="bravo-pl-badge" id="bravo-pl-count-badge">0 chương trình</div>
                            </div>
                        </div>

                        <!-- Filter Bar (Collapsible) -->
                        <div class="bravo-pl-filter-bar d-none" id="bravo-pl-filter-bar">
                            <div class="bravo-pl-filter-input-group">
                                <i class="fa-solid fa-magnifying-glass me-2 text-muted" style="font-size: 11px;"></i>
                                <input type="text" class="bravo-pl-filter-input" id="bravo-pl-filter-input" placeholder="Lọc theo tên, đường dẫn, username..." autocomplete="off">
                                <button type="button" class="bravo-pl-filter-clear d-none" id="bravo-pl-filter-clear" title="Xóa lọc">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="bravo-pl-table-container" id="bravo-pl-table-container">
                            <table class="bravo-pl-table" id="bravo-pl-table">
                                <thead>
                                    <tr>
                                        <th class="col-check">
                                            <input type="checkbox" class="bravo-pl-checkbox" id="bravo-pl-check-all" title="Chọn tất cả">
                                        </th>
                                        <th class="col-drag" title="Kéo thả để sắp xếp"></th>
                                        <th class="col-stt" id="bravo-pl-th-stt" title="Nhấn để sắp xếp theo STT">
                                            <span>STT</span>
                                            <i class="fa-solid fa-sort bravo-pl-sort-icon" id="bravo-pl-sort-stt-icon"></i>
                                        </th>
                                        <th class="col-name" id="bravo-pl-th-name">
                                            <div class="d-flex align-items-center justify-content-between">
                                                <div id="bravo-pl-name-sort-trigger" class="d-flex align-items-center" title="Nhấn để sắp xếp theo tên">
                                                    <span>Tên chương trình</span>
                                                    <i class="fa-solid fa-sort bravo-pl-sort-icon" id="bravo-pl-sort-name-icon"></i>
                                                </div>
                                                <button type="button" class="bravo-pl-filter-btn" id="bravo-pl-filter-toggle" title="Lọc tìm kiếm">
                                                    <i class="fa-solid fa-filter"></i>
                                                </button>
                                            </div>
                                        </th>
                                        <th class="col-group">Nhóm</th>
                                        <th class="col-path">Đường dẫn thực thi</th>
                                        <th class="col-actions">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody id="bravo-pl-tbody"></tbody>
                            </table>

                            <!-- Empty State -->
                            <div class="bravo-pl-empty-state d-none" id="bravo-pl-empty-state">
                                <i class="fa-solid fa-folder-open"></i>
                                <p id="bravo-pl-empty-text">Chưa có chương trình nào</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Custom Modal Container for All Dialogs -->
                <div id="bravo-pl-modal-container"></div>
            `;

            this._wireEvents();
            this._initNavResizer();
        },

        // ── Wire Main Events ─────────────────────────────────────────────────
        _wireEvents() {
            const container = this._container;
            if (!container) return;

            // Toolbar New button -> Open Modal in 'new' mode
            container.querySelector('#bravo-pl-btn-new')?.addEventListener('click', () => {
                this._openEditorModal({ mode: 'new' });
            });

            // Toolbar Clone button -> Open Modal in 'clone' mode
            container.querySelector('#bravo-pl-btn-clone')?.addEventListener('click', () => {
                if (this._selectedIds.size !== 1) return;
                const id = Array.from(this._selectedIds)[0];
                const prog = this._programs.find(p => p.id === id);
                if (prog) {
                    this._openEditorModal({ mode: 'clone', program: prog });
                }
            });

            // Toolbar Edit button -> Open Modal in 'edit' mode
            container.querySelector('#bravo-pl-btn-edit')?.addEventListener('click', () => {
                if (this._selectedIds.size !== 1) return;
                const id = Array.from(this._selectedIds)[0];
                const prog = this._programs.find(p => p.id === id);
                if (prog) {
                    this._openEditorModal({ mode: 'edit', program: prog });
                }
            });

            // Toolbar Move Group button
            container.querySelector('#bravo-pl-btn-move-group')?.addEventListener('click', () => {
                this._handleMoveGroup();
            });

            // Toolbar Delete button -> Confirm and delete (single or bulk)
            container.querySelector('#bravo-pl-btn-delete')?.addEventListener('click', () => {
                this._handleBulkDelete();
            });

            // Move Up button
            container.querySelector('#bravo-pl-btn-up')?.addEventListener('click', () => {
                this._moveSelectedRow(-1);
            });

            // Move Down button
            container.querySelector('#bravo-pl-btn-down')?.addEventListener('click', () => {
                this._moveSelectedRow(1);
            });

            // Navigator Add Group button
            container.querySelector('#bravo-pl-btn-add-group')?.addEventListener('click', () => {
                this._handleOpenAddGroupDialog();
            });

            // Filter toggle button
            const filterToggle = container.querySelector('#bravo-pl-filter-toggle');
            const filterBar = container.querySelector('#bravo-pl-filter-bar');
            const filterInput = container.querySelector('#bravo-pl-filter-input');
            const filterClear = container.querySelector('#bravo-pl-filter-clear');

            filterToggle?.addEventListener('click', (e) => {
                e.stopPropagation();
                this._filterVisible = !this._filterVisible;
                filterBar.classList.toggle('d-none', !this._filterVisible);
                filterToggle.classList.toggle('active', this._filterVisible);
                if (this._filterVisible) {
                    setTimeout(() => filterInput?.focus(), 50);
                } else {
                    if (filterInput) filterInput.value = '';
                    this._filterText = '';
                    filterClear?.classList.add('d-none');
                    this._renderTable();
                }
            });

            filterInput?.addEventListener('input', (e) => {
                this._filterText = (e.target.value || '').trim();
                filterClear?.classList.toggle('d-none', !this._filterText);
                this._renderTable();
            });

            filterClear?.addEventListener('click', () => {
                if (filterInput) filterInput.value = '';
                this._filterText = '';
                filterClear.classList.add('d-none');
                this._renderTable();
                filterInput?.focus();
            });

            filterInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    if (filterInput.value) {
                        filterInput.value = '';
                        this._filterText = '';
                        filterClear?.classList.add('d-none');
                        this._renderTable();
                    } else {
                        this._filterVisible = false;
                        filterBar?.classList.add('d-none');
                        filterToggle?.classList.remove('active');
                    }
                }
            });

            // Table Sort Headers
            container.querySelector('#bravo-pl-th-stt')?.addEventListener('click', () => {
                if (this._sortColumn === 'stt') {
                    this._sortAsc = !this._sortAsc;
                } else {
                    this._sortColumn = 'stt';
                    this._sortAsc = true;
                }
                this._updateSortIcons();
                this._renderTable();
            });

            container.querySelector('#bravo-pl-name-sort-trigger')?.addEventListener('click', () => {
                if (this._sortColumn === 'name') {
                    this._sortAsc = !this._sortAsc;
                } else {
                    this._sortColumn = 'name';
                    this._sortAsc = true;
                }
                this._updateSortIcons();
                this._renderTable();
            });

            // Select All Checkbox in Table Header
            const checkAll = container.querySelector('#bravo-pl-check-all');
            checkAll?.addEventListener('change', (e) => {
                const checked = e.target.checked;
                const visible = this._getFilteredPrograms();
                if (checked) {
                    visible.forEach(p => this._selectedIds.add(p.id));
                } else {
                    visible.forEach(p => this._selectedIds.delete(p.id));
                }
                this._updateRowSelectionUI();
                this._updateToolbarButtons();
            });
        },

        // ── Navigator Resizer ────────────────────────────────────────────────
        _initNavResizer() {
            const container = this._container;
            const resizer = container?.querySelector('#bravo-pl-nav-resizer');
            const navSidebar = container?.querySelector('#bravo-pl-nav-sidebar');
            if (!resizer || !navSidebar) return;

            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                if (!this._isResizingNav) return;
                const dx = e.clientX - startX;
                const newWidth = Math.max(160, Math.min(420, startWidth + dx));
                navSidebar.style.flex = `0 0 ${newWidth}px`;
                navSidebar.style.width = `${newWidth}px`;
            };

            const onMouseUp = () => {
                if (this._isResizingNav) {
                    this._isResizingNav = false;
                    resizer.classList.remove('resizing');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                }
            };

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._isResizingNav = true;
                resizer.classList.add('resizing');
                startX = e.clientX;
                startWidth = navSidebar.getBoundingClientRect().width;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        },

        // ── Data Loader & Storage API ────────────────────────────────────────
        async _loadData() {
            try {
                this._context?.setStatus?.('Đang tải dữ liệu...', 'running');

                // 1. Load Groups
                let groups = [];
                if (window.pywebview?.api?.get_program_groups) {
                    const res = await window.pywebview.api.get_program_groups();
                    if (res && res.success) groups = res.groups || [];
                } else {
                    try {
                        const res = await fetch('/api/bravo/programs/groups');
                        const data = await res.json();
                        if (data.success) groups = data.groups || [];
                    } catch (e) {
                        console.warn('Fallback groups load error:', e);
                    }
                }
                this._groups = groups;

                // 2. Load Programs
                let list = [];
                if (window.pywebview?.api?.get_program_list) {
                    const res = await window.pywebview.api.get_program_list();
                    if (res && res.success) list = res.programs || [];
                } else {
                    try {
                        const res = await fetch('/api/bravo/programs');
                        const data = await res.json();
                        if (data.success) list = data.programs || [];
                    } catch (e) {
                        console.warn('Fallback programs load error:', e);
                    }
                }

                // Sanitize and re-index stt if necessary
                list.forEach((p, idx) => {
                    if (typeof p.stt !== 'number') p.stt = idx + 1;
                    if (!p.id) p.id = 'prog_' + Date.now() + '_' + idx;
                    if (typeof p.group !== 'string') p.group = '';
                });

                this._programs = list;
                this._renderNavigator();
                this._updateSortIcons();
                this._renderTable();

                this._context?.setStatus?.('Sẵn sàng', 'idle');
            } catch (err) {
                console.error('[ProgramList] Load data error:', err);
                this._context?.setStatus?.('Lỗi tải dữ liệu chương trình', 'error');
            }
        },

        async _saveProgramsToBackend() {
            try {
                this._context?.setStatus?.('Đang lưu dữ liệu...', 'running');
                let ok = false;
                if (window.pywebview?.api?.save_program_list) {
                    const res = await window.pywebview.api.save_program_list(this._programs);
                    ok = Boolean(res && res.success);
                } else {
                    const res = await fetch('/api/bravo/programs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ programs: this._programs })
                    });
                    const data = await res.json();
                    ok = Boolean(data.success);
                }

                if (!ok) {
                    this._showNotification('Không thể lưu dữ liệu chương trình', 'danger');
                    this._context?.setStatus?.('Lỗi lưu dữ liệu', 'error');
                    return false;
                }

                this._context?.setStatus?.('Đã lưu dữ liệu', 'idle');
                return true;
            } catch (err) {
                console.error('[ProgramList] Save programs error:', err);
                this._showNotification('Lỗi khi lưu dữ liệu chương trình', 'danger');
                this._context?.setStatus?.('Lỗi lưu', 'error');
                return false;
            }
        },

        async _saveGroupsToBackend() {
            try {
                let ok = false;
                if (window.pywebview?.api?.save_program_groups) {
                    const res = await window.pywebview.api.save_program_groups(this._groups);
                    ok = Boolean(res && res.success);
                } else {
                    const res = await fetch('/api/bravo/programs/groups', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ groups: this._groups })
                    });
                    const data = await res.json();
                    ok = Boolean(data.success);
                }

                if (!ok) {
                    this._showNotification('Không thể lưu dữ liệu nhóm', 'danger');
                    return false;
                }
                return true;
            } catch (err) {
                console.error('[ProgramList] Save groups error:', err);
                this._showNotification('Lỗi khi lưu dữ liệu nhóm', 'danger');
                return false;
            }
        },

        // ── Render Navigator (Groups) ────────────────────────────────────────
        _renderNavigator() {
            const listEl = this._container?.querySelector('#bravo-pl-nav-list');
            if (!listEl) return;

            listEl.innerHTML = '';

            // 1. Group: "Tất cả"
            const allCount = this._programs.length;
            const itemAll = document.createElement('div');
            itemAll.className = 'bravo-pl-nav-item' + (this._activeGroupId === '__ALL__' ? ' active' : '');
            itemAll.dataset.groupId = '__ALL__';
            itemAll.innerHTML = `
                <i class="fa-solid fa-layer-group bravo-pl-nav-icon"></i>
                <span class="bravo-pl-nav-name" title="Tất cả chương trình">Tất cả</span>
                <span class="bravo-pl-nav-badge">${allCount}</span>
            `;
            itemAll.addEventListener('click', () => {
                this._activeGroupId = '__ALL__';
                this._renderNavigator();
                this._renderTable();
            });
            listEl.appendChild(itemAll);

            // 2. Group: "Chưa phân nhóm"
            const ungroupedCount = this._programs.filter(p => !p.group || !p.group.trim()).length;
            const itemUngrouped = document.createElement('div');
            itemUngrouped.className = 'bravo-pl-nav-item' + (this._activeGroupId === '__UNGROUPED__' ? ' active' : '');
            itemUngrouped.dataset.groupId = '__UNGROUPED__';
            itemUngrouped.innerHTML = `
                <i class="fa-solid fa-folder-open bravo-pl-nav-icon"></i>
                <span class="bravo-pl-nav-name" title="Chương trình chưa phân nhóm">Chưa phân nhóm</span>
                <span class="bravo-pl-nav-badge">${ungroupedCount}</span>
            `;
            itemUngrouped.addEventListener('click', () => {
                this._activeGroupId = '__UNGROUPED__';
                this._renderNavigator();
                this._renderTable();
            });
            listEl.appendChild(itemUngrouped);

            // Divider
            const divider = document.createElement('div');
            divider.className = 'bravo-pl-nav-divider';
            listEl.appendChild(divider);

            // 3. User Groups
            this._groups.forEach(g => {
                const count = this._programs.filter(p => this._isProgramInGroup(p, g.name)).length;
                const item = document.createElement('div');
                item.className = 'bravo-pl-nav-item' + (this._activeGroupId === g.id ? ' active' : '');
                item.dataset.groupId = g.id;

                item.innerHTML = `
                    <i class="fa-solid fa-folder bravo-pl-nav-icon"></i>
                    <span class="bravo-pl-nav-name" title="${this._escapeHtml(g.name)}">${this._escapeHtml(g.name)}</span>
                    <span class="bravo-pl-nav-badge">${count}</span>
                    <div class="bravo-pl-nav-actions">
                        <button type="button" class="bravo-pl-nav-btn btn-edit" title="Đổi tên nhóm">
                            <i class="fa-solid fa-pencil"></i>
                        </button>
                        <button type="button" class="bravo-pl-nav-btn btn-del" title="Xóa nhóm">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                `;

                // Select group
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.bravo-pl-nav-actions')) return;
                    this._activeGroupId = g.id;
                    this._renderNavigator();
                    this._renderTable();
                });

                // Edit group
                item.querySelector('.btn-edit')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._handleOpenEditGroupDialog(g);
                });

                // Delete group
                item.querySelector('.btn-del')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._handleConfirmDeleteGroup(g);
                });

                listEl.appendChild(item);
            });
        },

        // ── Helper: Check if program belongs to group (or its sub-groups) ───
        _isProgramInGroup(prog, groupName) {
            if (!prog || !groupName) return false;
            const pGrp = (prog.group || '').trim().toLowerCase();
            const target = groupName.trim().toLowerCase();
            return pGrp === target || pGrp.startsWith(target + '/');
        },

        // ── Filter & Sort Helper ─────────────────────────────────────────────
        _getFilteredPrograms() {
            const q = (this._filterText || '').toLowerCase();

            // 1. Filter by Active Group
            let list = this._programs.filter(p => {
                if (this._activeGroupId === '__ALL__') return true;
                if (this._activeGroupId === '__UNGROUPED__') return !p.group || !p.group.trim();
                const grp = this._groups.find(g => g.id === this._activeGroupId);
                return grp && this._isProgramInGroup(p, grp.name);
            });

            // 2. Filter by Search Query
            if (q) {
                list = list.filter(p => {
                    const name = (p.name || '').toLowerCase();
                    const path = (p.path || '').toLowerCase();
                    const user = (p.username || '').toLowerCase();
                    const grp  = (p.group || '').toLowerCase();
                    return name.includes(q) || path.includes(q) || user.includes(q) || grp.includes(q);
                });
            }

            // 3. Sort
            list.sort((a, b) => {
                let cmp = 0;
                if (this._sortColumn === 'stt') {
                    cmp = (a.stt || 0) - (b.stt || 0);
                } else if (this._sortColumn === 'name') {
                    cmp = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
                }
                return this._sortAsc ? cmp : -cmp;
            });

            return list;
        },

        // ── Render Table ─────────────────────────────────────────────────────
        _renderTable() {
            const tbody = this._container?.querySelector('#bravo-pl-tbody');
            const countBadge = this._container?.querySelector('#bravo-pl-count-badge');
            const emptyState = this._container?.querySelector('#bravo-pl-empty-state');
            const emptyText = this._container?.querySelector('#bravo-pl-empty-text');
            if (!tbody) return;

            const filtered = this._getFilteredPrograms();

            // Update badge
            if (countBadge) {
                const selCount = this._selectedIds.size;
                if (selCount > 0) {
                    countBadge.textContent = `Đã chọn ${selCount} / ${filtered.length} chương trình`;
                } else if (this._filterText || this._activeGroupId !== '__ALL__') {
                    countBadge.textContent = `${filtered.length} / ${this._programs.length} chương trình`;
                } else {
                    countBadge.textContent = `${this._programs.length} chương trình`;
                }
            }

            // Empty state
            tbody.innerHTML = '';
            if (filtered.length === 0) {
                if (emptyState) {
                    emptyState.classList.remove('d-none');
                    if (emptyText) {
                        emptyText.textContent = this._filterText ? `Không tìm thấy chương trình nào phù hợp với "${this._filterText}"`
                                                                : 'Chưa có chương trình nào trong mục này. Nhấn "Thêm mới" để tạo.';
                    }
                }
                this._updateCheckAllUI(0, 0);
                this._updateToolbarButtons();
                return;
            }

            if (emptyState) emptyState.classList.add('d-none');

            // Render Rows
            filtered.forEach(prog => {
                const tr = document.createElement('tr');
                const isSelected = this._selectedIds.has(prog.id);
                tr.className = 'bravo-pl-row' + (isSelected ? ' selected' : '');
                tr.dataset.id = prog.id;
                tr.draggable = true;

                tr.innerHTML = `
                    <td class="bravo-pl-cell-check">
                        <input type="checkbox" class="bravo-pl-checkbox bravo-pl-row-check" data-id="${prog.id}" ${isSelected ? 'checked' : ''} title="Chọn">
                    </td>
                    <td class="bravo-pl-cell-drag" title="Kéo thả để sắp xếp vị trí">
                        <i class="fa-solid fa-grip-vertical"></i>
                    </td>
                    <td class="bravo-pl-cell-stt">${prog.stt}</td>
                    <td class="bravo-pl-cell-name text-truncate" title="${this._escapeHtml(prog.name || '')}">
                        <i class="fa-solid fa-desktop bravo-pl-prog-icon"></i>
                        <span>${this._escapeHtml(prog.name || '(Chưa đặt tên)')}</span>
                    </td>
                    <td class="bravo-pl-cell-group">
                        ${prog.group ? `<span class="bravo-pl-group-pill" title="${this._escapeHtml(prog.group)}">${this._escapeHtml(prog.group)}</span>` : '<span class="text-muted" style="font-size: 11px;">—</span>'}
                    </td>
                    <td class="bravo-pl-cell-path text-truncate" title="${this._escapeHtml(prog.path || '')}">
                        ${this._escapeHtml(prog.path || '')}
                    </td>
                    <td class="bravo-pl-cell-actions">
                        <div class="bravo-pl-row-actions">
                            <button type="button" class="bravo-pl-act-btn act-run" data-id="${prog.id}" title="Khởi chạy chương trình">
                                <i class="fa-solid fa-play"></i>
                            </button>
                            <button type="button" class="bravo-pl-act-btn act-edit" data-id="${prog.id}" title="Sửa thông tin">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" class="bravo-pl-act-btn act-clone" data-id="${prog.id}" title="Nhân bản (Thêm bản sao)">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                            <button type="button" class="bravo-pl-act-btn act-delete" data-id="${prog.id}" title="Xóa chương trình">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                `;

                // Row Checkbox toggle
                const chk = tr.querySelector('.bravo-pl-row-check');
                chk?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (chk.checked) {
                        this._selectedIds.add(prog.id);
                    } else {
                        this._selectedIds.delete(prog.id);
                    }
                    this._updateRowSelectionUI();
                    this._updateToolbarButtons();
                });

                // Row click -> Single selection (or toggle if clicked with Ctrl)
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('.bravo-pl-row-actions') || e.target.closest('.bravo-pl-checkbox') || e.target.closest('.bravo-pl-cell-drag')) {
                        return;
                    }
                    if (e.ctrlKey || e.metaKey) {
                        if (this._selectedIds.has(prog.id)) {
                            this._selectedIds.delete(prog.id);
                        } else {
                            this._selectedIds.add(prog.id);
                        }
                    } else {
                        this._selectedIds.clear();
                        this._selectedIds.add(prog.id);
                    }
                    this._updateRowSelectionUI();
                    this._updateToolbarButtons();
                });

                // Row double click -> Launch Program
                tr.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.bravo-pl-row-actions') || e.target.closest('.bravo-pl-checkbox')) return;
                    this._runProgram(prog);
                });

                // In-Row Actions
                tr.querySelector('.act-run')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._runProgram(prog);
                });

                tr.querySelector('.act-edit')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openEditorModal({ mode: 'edit', program: prog });
                });

                tr.querySelector('.act-clone')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openEditorModal({ mode: 'clone', program: prog });
                });

                tr.querySelector('.act-delete')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._handleSingleDelete(prog);
                });

                // Context Menu on Right-Click
                tr.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openContextMenu(e, prog);
                });

                // ── HTML5 Drag and Drop Handlers ─────────────────────────────
                tr.addEventListener('dragstart', (e) => {
                    this._draggedId = prog.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', prog.id);
                    tr.classList.add('dragging');
                });

                tr.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (this._draggedId === prog.id) return;

                    const rect = tr.getBoundingClientRect();
                    const isTop = (e.clientY - rect.top) < (rect.height / 2);
                    this._dragOverId = prog.id;
                    this._dropPosition = isTop ? 'top' : 'bottom';

                    this._container?.querySelectorAll('.bravo-pl-row').forEach(r => {
                        r.classList.remove('drop-target-top', 'drop-target-bottom');
                    });
                    tr.classList.add(isTop ? 'drop-target-top' : 'drop-target-bottom');
                });

                tr.addEventListener('dragleave', (e) => {
                    if (e.currentTarget.contains(e.relatedTarget)) return;
                    tr.classList.remove('drop-target-top', 'drop-target-bottom');
                });

                tr.addEventListener('drop', (e) => {
                    e.preventDefault();
                    tr.classList.remove('drop-target-top', 'drop-target-bottom');
                    if (!this._draggedId || this._draggedId === prog.id) return;

                    this._handleDropReorder(this._draggedId, prog.id, this._dropPosition);
                });

                tr.addEventListener('dragend', () => {
                    this._draggedId = null;
                    this._dragOverId = null;
                    this._container?.querySelectorAll('.bravo-pl-row').forEach(r => {
                        r.classList.remove('dragging', 'drop-target-top', 'drop-target-bottom');
                    });
                });

                tbody.appendChild(tr);
            });

            this._updateCheckAllUI(this._selectedIds.size, filtered.length);
            this._updateToolbarButtons();
        },

        // ── Drag & Drop Reorder Logic ────────────────────────────────────────
        async _handleDropReorder(draggedId, targetId, position) {
            const dragIdx = this._programs.findIndex(p => p.id === draggedId);
            const targetIdx = this._programs.findIndex(p => p.id === targetId);
            if (dragIdx < 0 || targetIdx < 0) return;

            const [item] = this._programs.splice(dragIdx, 1);
            let insertIdx = this._programs.findIndex(p => p.id === targetId);

            if (position === 'bottom') {
                insertIdx += 1;
            }
            this._programs.splice(insertIdx, 0, item);

            // Re-assign STT sequentially
            this._programs.forEach((p, idx) => {
                p.stt = idx + 1;
            });

            await this._saveProgramsToBackend();
            this._renderTable();
        },

        // ── Selection UI & Toolbar States ────────────────────────────────────
        _updateRowSelectionUI() {
            const container = this._container;
            if (!container) return;

            const visible = this._getFilteredPrograms();
            let selectedCountInView = 0;

            container.querySelectorAll('.bravo-pl-row').forEach(tr => {
                const id = tr.dataset.id;
                const isSelected = this._selectedIds.has(id);
                tr.classList.toggle('selected', isSelected);
                const chk = tr.querySelector('.bravo-pl-row-check');
                if (chk) chk.checked = isSelected;
                if (isSelected) selectedCountInView++;
            });

            this._updateCheckAllUI(selectedCountInView, visible.length);

            // Update badge
            const countBadge = container.querySelector('#bravo-pl-count-badge');
            if (countBadge) {
                const totalSel = this._selectedIds.size;
                if (totalSel > 0) {
                    countBadge.textContent = `Đã chọn ${totalSel} / ${visible.length} chương trình`;
                } else {
                    countBadge.textContent = `${this._programs.length} chương trình`;
                }
            }
        },

        _updateCheckAllUI(selectedCount, totalVisible) {
            const checkAll = this._container?.querySelector('#bravo-pl-check-all');
            if (!checkAll) return;

            if (totalVisible === 0) {
                checkAll.checked = false;
                checkAll.indeterminate = false;
            } else if (selectedCount === totalVisible) {
                checkAll.checked = true;
                checkAll.indeterminate = false;
            } else if (selectedCount > 0) {
                checkAll.checked = false;
                checkAll.indeterminate = true;
            } else {
                checkAll.checked = false;
                checkAll.indeterminate = false;
            }
        },

        _updateToolbarButtons() {
            const container = this._container;
            if (!container) return;

            const selCount = this._selectedIds.size;
            const btnClone  = container.querySelector('#bravo-pl-btn-clone');
            const btnEdit   = container.querySelector('#bravo-pl-btn-edit');
            const btnMoveGroup = container.querySelector('#bravo-pl-btn-move-group');
            const btnDelete = container.querySelector('#bravo-pl-btn-delete');
            const btnDelText = container.querySelector('#bravo-pl-btn-delete-text');
            const btnUp     = container.querySelector('#bravo-pl-btn-up');
            const btnDown   = container.querySelector('#bravo-pl-btn-down');

            // Requirement: không áp dụng multi cho Thêm bản sao và Sửa (chỉ active khi chọn đúng 1 dòng)
            const singleSelected = (selCount === 1);
            if (btnClone) btnClone.disabled = !singleSelected;
            if (btnEdit) btnEdit.disabled = !singleSelected;
            if (btnUp) btnUp.disabled = !singleSelected;
            if (btnDown) btnDown.disabled = !singleSelected;

            // Chuyển nhóm: active khi chọn >= 1 dòng
            if (btnMoveGroup) {
                btnMoveGroup.disabled = (selCount === 0);
            }

            // Xóa: active khi chọn >= 1 dòng
            if (btnDelete) {
                btnDelete.disabled = (selCount === 0);
                if (btnDelText) {
                    btnDelText.textContent = selCount > 1 ? `Xóa (${selCount})` : 'Xóa';
                }
            }
        },

        _updateSortIcons() {
            const iconStt = this._container?.querySelector('#bravo-pl-sort-stt-icon');
            const iconName = this._container?.querySelector('#bravo-pl-sort-name-icon');
            if (iconStt) {
                if (this._sortColumn === 'stt') {
                    iconStt.className = `fa-solid ${this._sortAsc ? 'fa-sort-up' : 'fa-sort-down'} bravo-pl-sort-icon active`;
                } else {
                    iconStt.className = 'fa-solid fa-sort bravo-pl-sort-icon';
                }
            }
            if (iconName) {
                if (this._sortColumn === 'name') {
                    iconName.className = `fa-solid ${this._sortAsc ? 'fa-sort-up' : 'fa-sort-down'} bravo-pl-sort-icon active`;
                } else {
                    iconName.className = 'fa-solid fa-sort bravo-pl-sort-icon';
                }
            }
        },

        // ── Move Row (Up/Down) to Reorder ────────────────────────────────────
        async _moveSelectedRow(delta) {
            if (this._selectedIds.size !== 1) {
                this._showNotification('Vui lòng chọn đúng 1 chương trình trong bảng để di chuyển', 'warning');
                return;
            }

            const selId = Array.from(this._selectedIds)[0];
            const idx = this._programs.findIndex(p => p.id === selId);
            if (idx < 0) return;

            const targetIdx = idx + delta;
            if (targetIdx < 0 || targetIdx >= this._programs.length) {
                return; // already at boundary
            }

            // Swap in array
            const temp = this._programs[idx];
            this._programs[idx] = this._programs[targetIdx];
            this._programs[targetIdx] = temp;

            // Re-assign STT sequentially
            this._programs.forEach((p, i) => {
                p.stt = i + 1;
            });

            await this._saveProgramsToBackend();
            this._renderTable();
        },

        // ── Duplicate Name Validation ────────────────────────────────────────
        _isDuplicateName(name, excludeId) {
            const cleanName = (name || '').trim().toLowerCase();
            if (!cleanName) return false;
            return this._programs.some(p => {
                if (excludeId && p.id === excludeId) return false;
                return (p.name || '').trim().toLowerCase() === cleanName;
            });
        },

        // ── Modal Editor (Dialog) ────────────────────────────────────────────
        _openEditorModal({ mode = 'new', program = null }) {
            const modalContainer = this._container?.querySelector('#bravo-pl-modal-container');
            if (!modalContainer) return;

            let titleText = 'Thêm chương trình mới';
            let initialName = '';
            let initialGroup = '';
            let initialPath = '';
            let initialUser = '';
            let initialPass = '';

            // Suggest default group from active navigator filter if valid
            if (this._activeGroupId !== '__ALL__' && this._activeGroupId !== '__UNGROUPED__') {
                const currentGrp = this._groups.find(g => g.id === this._activeGroupId);
                if (currentGrp) initialGroup = currentGrp.name;
            }

            if (mode === 'edit' && program) {
                titleText = `Chỉnh sửa: ${program.name}`;
                initialName = program.name || '';
                initialGroup = program.group || '';
                initialPath = program.path || '';
                initialUser = program.username || '';
                initialPass = program.password || '';
            } else if (mode === 'clone' && program) {
                titleText = `Tạo bản sao: ${program.name}`;
                let baseName = `${program.name} (Bản sao)`;
                let counter = 2;
                while (this._isDuplicateName(baseName, null)) {
                    baseName = `${program.name} (Bản sao ${counter})`;
                    counter++;
                }
                initialName = baseName;
                initialGroup = program.group || '';
                initialPath = program.path || '';
                initialUser = program.username || '';
                initialPass = program.password || '';
            }

            // Build Groups options HTML
            const buildGroupOptionsHtml = (selectedGroup) => {
                let html = `<option value="">[Chưa phân nhóm]</option>`;
                this._groups.forEach(g => {
                    const sel = (g.name === selectedGroup) ? 'selected' : '';
                    html += `<option value="${this._escapeHtml(g.name)}" ${sel}>${this._escapeHtml(g.name)}</option>`;
                });
                html += `<option value="__NEW_GROUP__">+ Tạo nhóm mới...</option>`;
                return html;
            };

            const overlay = document.createElement('div');
            overlay.className = 'bravo-pl-modal-overlay';
            overlay.innerHTML = `
                <div class="bravo-pl-modal-dialog bravo-pl-editor-dialog">
                    <div class="bravo-pl-modal-header">
                        <div class="bravo-pl-modal-title">
                            <i class="fa-solid fa-sliders text-primary"></i>
                            <span>${this._escapeHtml(titleText)}</span>
                        </div>
                        <button type="button" class="btn-close btn-close-white btn-sm" id="bravo-pl-editor-btn-x"></button>
                    </div>

                    <div class="bravo-pl-modal-body">
                        <!-- Alert Banner for Errors -->
                        <div class="bravo-pl-form-alert alert-danger d-none" id="bravo-pl-editor-alert">
                            <i class="fa-solid fa-circle-exclamation"></i>
                            <span id="bravo-pl-editor-alert-text"></span>
                        </div>

                        <form id="bravo-pl-editor-form" onsubmit="return false;">
                            <div class="bravo-pl-form-group">
                                <label class="bravo-pl-label" for="bravo-pl-modal-name">Tên chương trình <span class="text-danger">*</span></label>
                                <input type="text" class="bravo-pl-input form-control form-control-sm" id="bravo-pl-modal-name" value="${this._escapeHtml(initialName)}" placeholder="Ví dụ: BRAVO 10 Kế toán..." required autocomplete="off">
                            </div>

                            <div class="bravo-pl-form-group">
                                <label class="bravo-pl-label" for="bravo-pl-modal-group">Nhóm chương trình</label>
                                <select class="bravo-pl-select form-select form-select-sm" id="bravo-pl-modal-group">
                                    ${buildGroupOptionsHtml(initialGroup)}
                                </select>
                            </div>

                            <div class="bravo-pl-form-group">
                                <label class="bravo-pl-label" for="bravo-pl-modal-path">Đường dẫn thực thi <span class="text-danger">*</span></label>
                                <div class="input-group input-group-sm">
                                    <input type="text" class="bravo-pl-input form-control form-control-sm" id="bravo-pl-modal-path" value="${this._escapeHtml(initialPath)}" placeholder="C:\\BRAVO10\\Bravo10.exe" required autocomplete="off">
                                    <button type="button" class="btn btn-sm btn-outline-secondary bravo-pl-btn-browse" id="bravo-pl-modal-btn-browse" title="Chọn file chương trình (*.exe, *.bat, *.cmd)">
                                        <i class="fa-solid fa-folder-open"></i>
                                    </button>
                                </div>
                            </div>

                            <div class="bravo-pl-form-group">
                                <label class="bravo-pl-label" for="bravo-pl-modal-user">Username</label>
                                <input type="text" class="bravo-pl-input form-control form-control-sm" id="bravo-pl-modal-user" value="${this._escapeHtml(initialUser)}" placeholder="Ví dụ: admin..." autocomplete="off">
                            </div>

                            <div class="bravo-pl-form-group">
                                <label class="bravo-pl-label" for="bravo-pl-modal-pass">Password</label>
                                <div class="input-group input-group-sm">
                                    <input type="password" class="bravo-pl-input form-control form-control-sm" id="bravo-pl-modal-pass" value="${this._escapeHtml(initialPass)}" placeholder="Mật khẩu đăng nhập..." autocomplete="new-password">
                                    <button type="button" class="btn btn-sm btn-outline-secondary bravo-pl-btn-toggle-pass" id="bravo-pl-modal-btn-toggle-pass" title="Ẩn/Hiện mật khẩu">
                                        <i class="fa-solid fa-eye" id="bravo-pl-modal-pass-eye"></i>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>

                    <div class="bravo-pl-modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" id="bravo-pl-editor-btn-cancel">Hủy bỏ</button>
                        <button type="button" class="btn btn-sm btn-primary" id="bravo-pl-editor-btn-save">
                            <i class="fa-solid fa-floppy-disk me-1"></i>Lưu
                        </button>
                    </div>
                </div>
            `;

            const closeModal = () => {
                overlay.remove();
            };

            const nameInput = overlay.querySelector('#bravo-pl-modal-name');
            const groupSelect = overlay.querySelector('#bravo-pl-modal-group');
            const pathInput = overlay.querySelector('#bravo-pl-modal-path');
            const userInput = overlay.querySelector('#bravo-pl-modal-user');
            const passInput = overlay.querySelector('#bravo-pl-modal-pass');
            const alertBox = overlay.querySelector('#bravo-pl-editor-alert');
            const alertText = overlay.querySelector('#bravo-pl-editor-alert-text');

            const showAlert = (msg) => {
                if (alertBox && alertText) {
                    alertText.textContent = msg;
                    alertBox.classList.remove('d-none');
                }
            };

            const hideAlert = () => {
                if (alertBox) alertBox.classList.add('d-none');
            };

            // Close buttons
            overlay.querySelector('#bravo-pl-editor-btn-x')?.addEventListener('click', closeModal);
            overlay.querySelector('#bravo-pl-editor-btn-cancel')?.addEventListener('click', closeModal);

            // Password Toggle Visibility
            overlay.querySelector('#bravo-pl-modal-btn-toggle-pass')?.addEventListener('click', () => {
                if (!passInput) return;
                const eyeIcon = overlay.querySelector('#bravo-pl-modal-pass-eye');
                if (passInput.type === 'password') {
                    passInput.type = 'text';
                    if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye-slash';
                } else {
                    passInput.type = 'password';
                    if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';
                }
            });

            // Browse file
            overlay.querySelector('#bravo-pl-modal-btn-browse')?.addEventListener('click', async () => {
                await this._chooseExecutableFile(pathInput, nameInput);
            });

            // Group dropdown change: If [+ Tạo nhóm mới...] is selected
            groupSelect?.addEventListener('change', () => {
                if (groupSelect.value === '__NEW_GROUP__') {
                    this._handleOpenAddGroupDialog((newGroupName) => {
                        if (newGroupName) {
                            groupSelect.innerHTML = buildGroupOptionsHtml(newGroupName);
                            groupSelect.value = newGroupName;
                        } else {
                            groupSelect.value = '';
                        }
                    });
                }
            });

            // Save Action
            overlay.querySelector('#bravo-pl-editor-btn-save')?.addEventListener('click', async () => {
                hideAlert();
                const nameVal = (nameInput?.value || '').trim();
                let groupVal = groupSelect?.value || '';
                if (groupVal === '__NEW_GROUP__') groupVal = '';
                const pathVal = (pathInput?.value || '').trim();
                const userVal = (userInput?.value || '').trim();
                const passVal = passInput?.value || '';

                if (!nameVal) {
                    showAlert('Vui lòng nhập Tên chương trình');
                    nameInput?.focus();
                    return;
                }
                if (!pathVal) {
                    showAlert('Vui lòng nhập hoặc chọn Đường dẫn chương trình thực thi');
                    pathInput?.focus();
                    return;
                }

                // Check Duplicate Name (Requirement 2)
                const excludeId = (mode === 'edit' && program) ? program.id : null;
                if (this._isDuplicateName(nameVal, excludeId)) {
                    showAlert(`Tên chương trình "${nameVal}" đã tồn tại. Vui lòng đặt tên khác!`);
                    nameInput?.focus();
                    return;
                }

                if (mode === 'edit' && program) {
                    program.name = nameVal;
                    program.group = groupVal;
                    program.path = pathVal;
                    program.username = userVal;
                    program.password = passVal;

                    const ok = await this._saveProgramsToBackend();
                    if (ok) {
                        this._showNotification(`Đã cập nhật chương trình "${nameVal}"`, 'success');
                        closeModal();
                        this._renderNavigator();
                        this._renderTable();
                    }
                } else {
                    // New or Clone mode
                    const newProg = {
                        id: 'prog_' + Date.now(),
                        stt: this._programs.length + 1,
                        name: nameVal,
                        group: groupVal,
                        path: pathVal,
                        username: userVal,
                        password: passVal
                    };

                    this._programs.push(newProg);
                    const ok = await this._saveProgramsToBackend();
                    if (ok) {
                        this._showNotification(`Đã thêm mới chương trình "${nameVal}"`, 'success');
                        closeModal();
                        this._selectedIds.clear();
                        this._selectedIds.add(newProg.id);
                        this._renderNavigator();
                        this._renderTable();
                    }
                }
            });

            modalContainer.appendChild(overlay);
            setTimeout(() => nameInput?.focus(), 50);
        },

        // ── Single Row Delete ────────────────────────────────────────────────
        _handleSingleDelete(prog) {
            this._showConfirmModal({
                title: 'Xác nhận xóa chương trình',
                icon: 'fa-triangle-exclamation text-danger',
                message: `Bạn có chắc chắn muốn xóa chương trình <strong>"${this._escapeHtml(prog.name)}"</strong> khỏi danh sách? Thao tác này không thể hoàn tác.`,
                confirmText: 'Xóa ngay',
                confirmBtnClass: 'btn-danger',
                onConfirm: async () => {
                    this._programs = this._programs.filter(p => p.id !== prog.id);
                    this._selectedIds.delete(prog.id);

                    // Re-index stt
                    this._programs.forEach((p, idx) => {
                        p.stt = idx + 1;
                    });

                    const ok = await this._saveProgramsToBackend();
                    if (ok) {
                        this._showNotification(`Đã xóa chương trình "${prog.name}"`, 'success');
                        this._renderNavigator();
                        this._renderTable();
                    }
                }
            });
        },

        // ── Bulk Delete (Multi-Select) ───────────────────────────────────────
        _handleBulkDelete() {
            const count = this._selectedIds.size;
            if (count === 0) return;

            if (count === 1) {
                const id = Array.from(this._selectedIds)[0];
                const prog = this._programs.find(p => p.id === id);
                if (prog) this._handleSingleDelete(prog);
                return;
            }

            this._showConfirmModal({
                title: 'Xác nhận xóa nhiều chương trình',
                icon: 'fa-triangle-exclamation text-danger',
                message: `Bạn có chắc chắn muốn xóa <strong>${count}</strong> chương trình đã chọn khỏi danh sách? Thao tác này không thể hoàn tác.`,
                confirmText: `Xóa ${count} chương trình`,
                confirmBtnClass: 'btn-danger',
                onConfirm: async () => {
                    this._programs = this._programs.filter(p => !this._selectedIds.has(p.id));
                    this._selectedIds.clear();

                    // Re-index stt
                    this._programs.forEach((p, idx) => {
                        p.stt = idx + 1;
                    });

                    const ok = await this._saveProgramsToBackend();
                    if (ok) {
                        this._showNotification(`Đã xóa ${count} chương trình khỏi danh sách`, 'success');
                        this._renderNavigator();
                        this._renderTable();
                    }
                }
            });
        },

        // ── Move to Group (Single or Multi-Select) ───────────────────────────
        _handleMoveGroup() {
            const selCount = this._selectedIds.size;
            if (selCount === 0) {
                this._showNotification('Vui lòng chọn ít nhất 1 chương trình để chuyển nhóm', 'warning');
                return;
            }

            // Check if no groups exist yet
            if (!this._groups || this._groups.length === 0) {
                this._showConfirmModal({
                    title: 'Chưa có nhóm chương trình',
                    icon: 'fa-triangle-exclamation text-warning',
                    message: 'Hiện tại chưa có nhóm nào được tạo trong hệ thống. Vui lòng tạo nhóm mới trước khi thực hiện chuyển nhóm!',
                    confirmText: 'Tạo nhóm mới',
                    confirmBtnClass: 'btn-primary',
                    onConfirm: () => {
                        this._handleOpenAddGroupDialog();
                    }
                });
                return;
            }

            const modalContainer = this._container?.querySelector('#bravo-pl-modal-container');
            if (!modalContainer) return;

            let optionsHtml = '';
            this._groups.forEach(g => {
                optionsHtml += `<option value="${this._escapeHtml(g.name)}">${this._escapeHtml(g.name)}</option>`;
            });
            optionsHtml += `<option value="">[Chưa phân nhóm / Bỏ nhóm]</option>`;

            const overlay = document.createElement('div');
            overlay.className = 'bravo-pl-modal-overlay';
            overlay.innerHTML = `
                <div class="bravo-pl-modal-dialog" style="max-width: 420px;">
                    <div class="bravo-pl-modal-header">
                        <div class="bravo-pl-modal-title">
                            <i class="fa-solid fa-arrow-right-arrow-left text-info"></i>
                            <span>Chuyển nhóm chương trình</span>
                        </div>
                        <button type="button" class="btn-close btn-close-white btn-sm" id="bravo-pl-move-btn-x"></button>
                    </div>
                    <div class="bravo-pl-modal-body">
                        <p class="mb-3">Chuyển <strong>${selCount}</strong> chương trình đã chọn sang nhóm:</p>
                        <div class="bravo-pl-form-group">
                            <label class="bravo-pl-label" for="bravo-pl-move-group-select">Chọn nhóm đích <span class="text-danger">*</span></label>
                            <select class="bravo-pl-select form-select form-select-sm" id="bravo-pl-move-group-select">
                                ${optionsHtml}
                            </select>
                        </div>
                    </div>
                    <div class="bravo-pl-modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" id="bravo-pl-move-btn-cancel">Hủy bỏ</button>
                        <button type="button" class="btn btn-sm btn-primary" id="bravo-pl-move-btn-ok">
                            <i class="fa-solid fa-check me-1"></i>Xác nhận chuyển
                        </button>
                    </div>
                </div>
            `;

            const closeModal = () => overlay.remove();
            overlay.querySelector('#bravo-pl-move-btn-x')?.addEventListener('click', closeModal);
            overlay.querySelector('#bravo-pl-move-btn-cancel')?.addEventListener('click', closeModal);

            overlay.querySelector('#bravo-pl-move-btn-ok')?.addEventListener('click', async () => {
                const select = overlay.querySelector('#bravo-pl-move-group-select');
                const targetGroup = select ? select.value : '';

                // Update group for all selected programs
                this._programs.forEach(p => {
                    if (this._selectedIds.has(p.id)) {
                        p.group = targetGroup;
                    }
                });

                const ok = await this._saveProgramsToBackend();
                if (ok) {
                    const grpDisplay = targetGroup ? `"${targetGroup}"` : 'Chưa phân nhóm';
                    this._showNotification(`Đã chuyển ${selCount} chương trình sang nhóm ${grpDisplay}`, 'success');
                    closeModal();
                    this._renderNavigator();
                    this._renderTable();
                }
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });

            modalContainer.appendChild(overlay);
        },

        // ── Context Menu (Right Click) ───────────────────────────────────────
        _closeContextMenu() {
            const existing = document.querySelector('.bravo-pl-context-menu');
            if (existing) existing.remove();
            if (this._ctxMenuDocClickHandler) {
                document.removeEventListener('click', this._ctxMenuDocClickHandler);
                document.removeEventListener('contextmenu', this._ctxMenuDocClickHandler);
                document.removeEventListener('keydown', this._ctxMenuKeyHandler);
                this._ctxMenuDocClickHandler = null;
                this._ctxMenuKeyHandler = null;
            }
        },

        _openContextMenu(e, prog) {
            this._closeContextMenu();

            // If the right-clicked row is not selected, select only it
            if (!this._selectedIds.has(prog.id)) {
                this._selectedIds.clear();
                this._selectedIds.add(prog.id);
                this._updateRowSelectionUI();
                this._updateToolbarButtons();
            }

            const selCount = this._selectedIds.size;
            const isSingle = (selCount === 1);
            const selectedProgram = isSingle ? this._programs.find(p => p.id === Array.from(this._selectedIds)[0]) : null;

            const menu = document.createElement('div');
            menu.className = 'bravo-pl-context-menu';

            menu.innerHTML = `
                <div class="bravo-pl-ctx-item" data-action="new">
                    <i class="fa-solid fa-plus bravo-pl-ctx-icon text-primary"></i>
                    <span>Thêm mới</span>
                </div>
                <div class="bravo-pl-ctx-item ${!isSingle ? 'disabled' : ''}" data-action="clone">
                    <i class="fa-solid fa-copy bravo-pl-ctx-icon text-info"></i>
                    <span>Thêm bản sao</span>
                </div>
                <div class="bravo-pl-ctx-item ${!isSingle ? 'disabled' : ''}" data-action="edit">
                    <i class="fa-solid fa-pen-to-square bravo-pl-ctx-icon text-warning"></i>
                    <span>Sửa</span>
                </div>
                <div class="bravo-pl-ctx-divider"></div>
                <div class="bravo-pl-ctx-item ${selCount === 0 ? 'disabled' : ''}" data-action="move-group">
                    <i class="fa-solid fa-arrow-right-arrow-left bravo-pl-ctx-icon text-info"></i>
                    <span>Chuyển nhóm${selCount > 1 ? ` (${selCount})` : ''}</span>
                </div>
                <div class="bravo-pl-ctx-divider"></div>
                <div class="bravo-pl-ctx-item ctx-danger ${selCount === 0 ? 'disabled' : ''}" data-action="delete">
                    <i class="fa-solid fa-trash-can bravo-pl-ctx-icon text-danger"></i>
                    <span>Xóa${selCount > 1 ? ` (${selCount})` : ''}</span>
                </div>
            `;

            // Position menu clamping to viewport
            const menuWidth = 185;
            const menuHeight = 200;
            const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
            const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);

            menu.style.left = `${Math.max(8, x)}px`;
            menu.style.top = `${Math.max(8, y)}px`;

            menu.addEventListener('click', (ev) => {
                const item = ev.target.closest('.bravo-pl-ctx-item');
                if (!item || item.classList.contains('disabled')) return;
                const action = item.dataset.action;
                this._closeContextMenu();

                if (action === 'new') {
                    this._openEditorModal({ mode: 'new' });
                } else if (action === 'clone') {
                    if (selectedProgram) this._openEditorModal({ mode: 'clone', program: selectedProgram });
                } else if (action === 'edit') {
                    if (selectedProgram) this._openEditorModal({ mode: 'edit', program: selectedProgram });
                } else if (action === 'move-group') {
                    this._handleMoveGroup();
                } else if (action === 'delete') {
                    this._handleBulkDelete();
                }
            });

            document.body.appendChild(menu);

            this._ctxMenuDocClickHandler = (ev) => {
                if (!menu.contains(ev.target)) {
                    this._closeContextMenu();
                }
            };
            this._ctxMenuKeyHandler = (ev) => {
                if (ev.key === 'Escape') {
                    this._closeContextMenu();
                }
            };

            setTimeout(() => {
                document.addEventListener('click', this._ctxMenuDocClickHandler);
                document.addEventListener('contextmenu', this._ctxMenuDocClickHandler);
                document.addEventListener('keydown', this._ctxMenuKeyHandler);
            }, 10);
        },

        // ── Group Management Dialogs ─────────────────────────────────────────
        _handleOpenAddGroupDialog(onCreatedCallback) {
            this._showPromptModal({
                title: 'Thêm nhóm chương trình mới',
                label: 'Tên nhóm mới',
                placeholder: 'Ví dụ: BRAVO 10, Kế toán, Máy khách...',
                confirmText: 'Tạo nhóm',
                onConfirm: async (name) => {
                    const cleanName = (name || '').trim();
                    if (!cleanName) return;

                    if (cleanName.toLowerCase() === 'tất cả' || cleanName.toLowerCase() === 'chưa phân nhóm') {
                        this._showNotification('Tên nhóm này trùng với mục mặc định của hệ thống', 'warning');
                        return;
                    }

                    if (this._groups.some(g => g.name.trim().toLowerCase() === cleanName.toLowerCase())) {
                        this._showNotification(`Nhóm "${cleanName}" đã tồn tại!`, 'warning');
                        return;
                    }

                    const newGroup = {
                        id: 'grp_' + Date.now(),
                        name: cleanName
                    };

                    this._groups.push(newGroup);
                    const ok = await this._saveGroupsToBackend();
                    if (ok) {
                        this._showNotification(`Đã tạo nhóm "${cleanName}"`, 'success');
                        this._activeGroupId = newGroup.id;
                        this._renderNavigator();
                        this._renderTable();
                        if (typeof onCreatedCallback === 'function') {
                            onCreatedCallback(cleanName);
                        }
                    }
                }
            });
        },

        _handleOpenEditGroupDialog(group) {
            this._showPromptModal({
                title: 'Đổi tên nhóm chương trình',
                label: 'Tên nhóm',
                value: group.name,
                confirmText: 'Cập nhật',
                onConfirm: async (newName) => {
                    const cleanName = (newName || '').trim();
                    if (!cleanName || cleanName === group.name) return;

                    if (this._groups.some(g => g.id !== group.id && g.name.trim().toLowerCase() === cleanName.toLowerCase())) {
                        this._showNotification(`Nhóm "${cleanName}" đã tồn tại!`, 'warning');
                        return;
                    }

                    const oldName = group.name;
                    const oldLower = oldName.trim().toLowerCase();
                    const oldPrefix = oldLower + '/';
                    group.name = cleanName;

                    // Update group name in all programs belonging to old group & sub-groups
                    this._programs.forEach(p => {
                        const pGrp = (p.group || '').trim();
                        if (pGrp.toLowerCase() === oldLower) {
                            p.group = cleanName;
                        } else if (pGrp.toLowerCase().startsWith(oldPrefix)) {
                            p.group = cleanName + pGrp.substring(oldName.length);
                        }
                    });

                    // Also update any child groups in this._groups
                    this._groups.forEach(g => {
                        if (g.id !== group.id && (g.name || '').trim().toLowerCase().startsWith(oldPrefix)) {
                            g.name = cleanName + g.name.trim().substring(oldName.length);
                        }
                    });

                    const okG = await this._saveGroupsToBackend();
                    const okP = await this._saveProgramsToBackend();
                    if (okG && okP) {
                        this._showNotification(`Đã đổi tên nhóm thành "${cleanName}"`, 'success');
                        this._renderNavigator();
                        this._renderTable();
                    }
                }
            });
        },

        _handleConfirmDeleteGroup(group) {
            const targetLower = (group.name || '').trim().toLowerCase();
            const prefixLower = targetLower + '/';

            // Count all affected programs in this group and all its subgroups
            const affectedCount = this._programs.filter(p => {
                const pGrp = (p.group || '').trim().toLowerCase();
                return pGrp === targetLower || pGrp.startsWith(prefixLower);
            }).length;

            this._showConfirmModal({
                title: 'Xác nhận xóa nhóm',
                icon: 'fa-triangle-exclamation text-danger',
                message: `Bạn có chắc chắn muốn xóa nhóm <strong>"${this._escapeHtml(group.name)}"</strong>?<br><small class="text-muted">Tất cả ${affectedCount} chương trình (kể cả nhóm con) sẽ được chuyển về <strong>Chưa phân nhóm</strong> mà không bị mất dữ liệu.</small>`,
                confirmText: 'Xóa nhóm',
                confirmBtnClass: 'btn-danger',
                onConfirm: async () => {
                    // Set all affected programs (and child groups) to ungrouped ('')
                    this._programs.forEach(p => {
                        const pGrp = (p.group || '').trim().toLowerCase();
                        if (pGrp === targetLower || pGrp.startsWith(prefixLower)) {
                            p.group = '';
                        }
                    });

                    // Remove the group and any sub-groups from this._groups
                    this._groups = this._groups.filter(g => {
                        const gLower = (g.name || '').trim().toLowerCase();
                        return g.id !== group.id && gLower !== targetLower && !gLower.startsWith(prefixLower);
                    });

                    // Switch active view directly to '__UNGROUPED__' so user immediately sees the moved programs
                    this._activeGroupId = '__UNGROUPED__';

                    const okG = await this._saveGroupsToBackend();
                    const okP = await this._saveProgramsToBackend();
                    if (okG && okP) {
                        this._showNotification(`Đã xóa nhóm "${group.name}". ${affectedCount} chương trình đã được chuyển về Chưa phân nhóm.`, 'success');
                        this._renderNavigator();
                        this._renderTable();
                    }
                }
            });
        },

        // ── Native File Dialog for Executable Selection ──────────────────────
        async _chooseExecutableFile(pathInput, nameInput) {
            if (this._isChoosingFile) return;
            this._isChoosingFile = true;
            try {
                let selectedPath = null;
                if (window.pywebview?.api?.select_program_file) {
                    const res = await window.pywebview.api.select_program_file();
                    if (res && res.success && res.path) {
                        selectedPath = res.path;
                    }
                } else {
                    const res = await fetch('/api/bravo/programs/select-file', { method: 'POST' });
                    const data = await res.json();
                    if (data.success && data.path) {
                        selectedPath = data.path;
                    }
                }

                if (selectedPath) {
                    if (pathInput) pathInput.value = selectedPath;
                    if (nameInput && !nameInput.value.trim()) {
                        const baseName = selectedPath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, "");
                        nameInput.value = baseName.toUpperCase();
                    }
                }
            } catch (err) {
                console.error('[ProgramList] Choose file error:', err);
                this._showNotification('Không thể mở hộp thoại chọn tệp', 'danger');
            } finally {
                this._isChoosingFile = false;
            }
        },

        // ── Run Executable ───────────────────────────────────────────────────
        async _runProgram(prog) {
            if (!prog || !prog.path) {
                this._showNotification('Chương trình chưa có đường dẫn thực thi', 'warning');
                return;
            }

            this._context?.setStatus?.(`Đang khởi chạy ${prog.name}...`, 'running');
            try {
                let res = null;
                if (window.pywebview?.api?.run_program) {
                    res = await window.pywebview.api.run_program(prog);
                } else {
                    const resp = await fetch('/api/bravo/programs/run', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ program: prog })
                    });
                    res = await resp.json();
                }

                if (res && res.success) {
                    this._showNotification(res.message || `Đã mở chương trình ${prog.name}`, 'success');
                    this._context?.setStatus?.('Sẵn sàng', 'idle');
                } else {
                    const err = res?.error || 'Không thể khởi chạy chương trình';
                    this._showNotification(`Lỗi khởi chạy: ${err}`, 'danger');
                    this._context?.setStatus?.(`Lỗi: ${err}`, 'error');
                }
            } catch (err) {
                console.error('[ProgramList] Run error:', err);
                this._showNotification(`Lỗi thực thi: ${err.message || err}`, 'danger');
                this._context?.setStatus?.('Lỗi thực thi', 'error');
            }
        },

        // ── Modals Utilities ─────────────────────────────────────────────────
        _showConfirmModal(options) {
            const modalContainer = this._container?.querySelector('#bravo-pl-modal-container');
            if (!modalContainer) return;

            const overlay = document.createElement('div');
            overlay.className = 'bravo-pl-modal-overlay';
            overlay.innerHTML = `
                <div class="bravo-pl-modal-dialog">
                    <div class="bravo-pl-modal-header">
                        <div class="bravo-pl-modal-title">
                            <i class="fa-solid ${options.icon || 'fa-circle-question'}"></i>
                            <span>${this._escapeHtml(options.title || 'Xác nhận')}</span>
                        </div>
                        <button type="button" class="btn-close btn-close-white btn-sm" id="bravo-pl-confirm-btn-x"></button>
                    </div>
                    <div class="bravo-pl-modal-body">
                        ${options.message || 'Bạn có chắc chắn muốn thực hiện thao tác này?'}
                    </div>
                    <div class="bravo-pl-modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" id="bravo-pl-confirm-btn-cancel">Hủy bỏ</button>
                        <button type="button" class="btn btn-sm ${options.confirmBtnClass || 'btn-primary'}" id="bravo-pl-confirm-btn-ok">
                            ${this._escapeHtml(options.confirmText || 'Đồng ý')}
                        </button>
                    </div>
                </div>
            `;

            const closeModal = () => overlay.remove();

            overlay.querySelector('#bravo-pl-confirm-btn-x')?.addEventListener('click', closeModal);
            overlay.querySelector('#bravo-pl-confirm-btn-cancel')?.addEventListener('click', closeModal);
            overlay.querySelector('#bravo-pl-confirm-btn-ok')?.addEventListener('click', () => {
                closeModal();
                if (typeof options.onConfirm === 'function') {
                    options.onConfirm();
                }
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });

            modalContainer.appendChild(overlay);
        },

        _showPromptModal(options) {
            const modalContainer = this._container?.querySelector('#bravo-pl-modal-container');
            if (!modalContainer) return;

            const overlay = document.createElement('div');
            overlay.className = 'bravo-pl-modal-overlay';
            overlay.innerHTML = `
                <div class="bravo-pl-modal-dialog">
                    <div class="bravo-pl-modal-header">
                        <div class="bravo-pl-modal-title">
                            <i class="fa-solid fa-folder-plus text-primary"></i>
                            <span>${this._escapeHtml(options.title || 'Nhập thông tin')}</span>
                        </div>
                        <button type="button" class="btn-close btn-close-white btn-sm" id="bravo-pl-prompt-btn-x"></button>
                    </div>
                    <div class="bravo-pl-modal-body">
                        <div class="bravo-pl-form-group">
                            <label class="bravo-pl-label">${this._escapeHtml(options.label || 'Tên')}</label>
                            <input type="text" class="bravo-pl-input form-control form-control-sm" id="bravo-pl-prompt-input" value="${this._escapeHtml(options.value || '')}" placeholder="${this._escapeHtml(options.placeholder || '')}" autocomplete="off">
                        </div>
                    </div>
                    <div class="bravo-pl-modal-footer">
                        <button type="button" class="btn btn-sm btn-secondary" id="bravo-pl-prompt-btn-cancel">Hủy bỏ</button>
                        <button type="button" class="btn btn-sm btn-primary" id="bravo-pl-prompt-btn-ok">
                            ${this._escapeHtml(options.confirmText || 'Lưu')}
                        </button>
                    </div>
                </div>
            `;

            const closeModal = () => overlay.remove();
            const input = overlay.querySelector('#bravo-pl-prompt-input');

            overlay.querySelector('#bravo-pl-prompt-btn-x')?.addEventListener('click', closeModal);
            overlay.querySelector('#bravo-pl-prompt-btn-cancel')?.addEventListener('click', closeModal);

            const handleOk = () => {
                const val = (input?.value || '').trim();
                if (!val) {
                    input?.focus();
                    return;
                }
                closeModal();
                if (typeof options.onConfirm === 'function') {
                    options.onConfirm(val);
                }
            };

            overlay.querySelector('#bravo-pl-prompt-btn-ok')?.addEventListener('click', handleOk);
            input?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleOk();
                if (e.key === 'Escape') closeModal();
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });

            modalContainer.appendChild(overlay);
            setTimeout(() => {
                input?.focus();
                input?.select();
            }, 50);
        },

        // ── Toast Notification ───────────────────────────────────────────────
        _showNotification(msg, type = 'info') {
            if (typeof window.showToast === 'function') {
                window.showToast(msg, type);
                return;
            }
            if (this._context?.setStatus) {
                this._context.setStatus(msg, type === 'danger' ? 'error' : 'idle');
            }
        },

        _escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }
    });
})();
