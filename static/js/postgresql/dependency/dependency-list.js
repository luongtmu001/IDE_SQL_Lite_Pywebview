/**
 * PostgreSQL Dependency Graph - List View Component
 * Renders dependencies in a structured, grouped list/table view.
 * Features:
 * - Group by object type (View, Function, Procedure, Table, Trigger, etc.)
 * - Collapsible / expandable groups
 * - Name, Type, Description ("đọc", "tham chiếu", etc.)
 * - Direct "View DDL" button on each row
 * - Inspect / Focus button on each row
 * - Hover tooltip preview card matching IDE aesthetics
 * - Real-time search query and type filter integration
 */
(function (global) {
    'use strict';

    class PostgresDependencyListView {
        constructor(container, options = {}) {
            this.container = container;
            this.options = options;
            this.graphData = null;
            this.selectedNodeId = null;
            this.searchQuery = '';
            this.filterFn = options.filterFn || (() => true);

            this.isGrouped = true; // Default grouped by object type as requested
            this.collapsedGroups = new Set(); // Group keys that are collapsed
            this.hoverCard = null;

            this.initDom();
            this.initHoverCard();
        }

        initDom() {
            if (!this.container) return;

            this.container.innerHTML = `
                <!-- List View Toolbar -->
                <div class="ide-dep-list-toolbar">
                    <div class="d-flex align-items-center gap-2">
                        <button type="button" class="ide-dep-btn ${this.isGrouped ? 'active' : ''}" id="ide-dep-list-btn-group" title="Bật / Tắt gom nhóm theo loại đối tượng">
                            <i class="fa-solid fa-layer-group me-1"></i> <span id="ide-dep-list-group-label">Nhóm theo loại</span>
                        </button>
                        <button type="button" class="ide-dep-btn" id="ide-dep-list-btn-toggle-all" title="Mở rộng hoặc thu gọn tất cả các nhóm">
                            <i class="fa-solid fa-angles-down me-1"></i> <span id="ide-dep-list-toggle-all-label">Thu gọn tất cả</span>
                        </button>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-secondary-subtle text-secondary border border-secondary ide-dep-list-count-badge" id="ide-dep-list-total-badge">
                            0 đối tượng
                        </span>
                    </div>
                </div>

                <!-- Scrollable Table -->
                <div class="ide-dep-list-table-scroll">
                    <table class="ide-dep-table">
                        <thead>
                            <tr>
                                <th class="col-name">Tên</th>
                                <th class="col-type">Loại</th>
                                <th class="col-desc">Mô tả</th>
                                <th class="col-actions text-end">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody id="ide-dep-list-tbody">
                            <!-- Populated dynamically -->
                        </tbody>
                    </table>
                    <div class="ide-dep-list-empty d-none" id="ide-dep-list-empty-msg">
                        <i class="fa-solid fa-folder-open mb-2" style="font-size: 28px; opacity: 0.4;"></i>
                        <div id="ide-dep-list-empty-text">Không có đối tượng nào phù hợp với bộ lọc.</div>
                    </div>
                </div>
            `;

            this.bindToolbarEvents();
        }

        initHoverCard() {
            // Reusable hover card for object details preview
            let card = document.getElementById('ide-dep-list-hover-card');
            if (!card) {
                card = document.createElement('div');
                card.id = 'ide-dep-list-hover-card';
                card.className = 'ide-dep-hover-card d-none';
                document.body.appendChild(card);
            }
            this.hoverCard = card;
        }

        bindToolbarEvents() {
            const groupBtn = this.container.querySelector('#ide-dep-list-btn-group');
            if (groupBtn) {
                groupBtn.addEventListener('click', () => {
                    this.isGrouped = !this.isGrouped;
                    groupBtn.classList.toggle('active', this.isGrouped);
                    this.render();
                });
            }

            const toggleAllBtn = this.container.querySelector('#ide-dep-list-btn-toggle-all');
            if (toggleAllBtn) {
                toggleAllBtn.addEventListener('click', () => {
                    const allGroups = this.getAllGroupKeys();
                    if (this.collapsedGroups.size > 0) {
                        // Expand all
                        this.collapsedGroups.clear();
                        toggleAllBtn.querySelector('#ide-dep-list-toggle-all-label').textContent = 'Thu gọn tất cả';
                        toggleAllBtn.querySelector('i').className = 'fa-solid fa-angles-up me-1';
                    } else {
                        // Collapse all
                        allGroups.forEach(k => this.collapsedGroups.add(k));
                        toggleAllBtn.querySelector('#ide-dep-list-toggle-all-label').textContent = 'Mở rộng tất cả';
                        toggleAllBtn.querySelector('i').className = 'fa-solid fa-angles-down me-1';
                    }
                    this.render();
                });
            }
        }

        setData(graphData) {
            this.graphData = graphData;
            this.render();
        }

        setFilter(filterFn) {
            this.filterFn = filterFn;
            this.render();
        }

        setSearchQuery(query) {
            this.searchQuery = (query || '').trim().toLowerCase();
            this.render();
        }

        setSelectedNode(nodeId) {
            this.selectedNodeId = nodeId;
            const rows = this.container.querySelectorAll('.ide-dep-row');
            rows.forEach(r => {
                if (r.getAttribute('data-node-id') === nodeId) {
                    r.classList.add('selected');
                } else {
                    r.classList.remove('selected');
                }
            });
        }

        getAllGroupKeys() {
            if (!this.graphData || !this.graphData.nodes) return [];
            const keys = new Set();
            this.graphData.nodes.forEach(n => {
                keys.add(this.getGroupCategory(n.object_type).key);
            });
            return Array.from(keys);
        }

        getGroupCategory(rawType) {
            const t = (rawType || '').toUpperCase();
            switch (t) {
                case 'VIEW':
                case 'MATERIALIZED_VIEW':
                    return { key: 'view', label: 'View', icon: 'fa-solid fa-table-columns text-success', order: 1 };
                case 'FUNCTION':
                case 'PROCEDURE':
                    return { key: 'function', label: 'Function & Procedure', icon: 'fa-solid fa-code text-warning', order: 2 };
                case 'TRIGGER':
                    return { key: 'trigger', label: 'Trigger', icon: 'fa-solid fa-bolt text-danger', order: 3 };
                case 'TABLE':
                case 'FOREIGN_TABLE':
                    return { key: 'table', label: 'Table', icon: 'fa-solid fa-table text-primary', order: 4 };
                case 'FOREIGN_KEY':
                case 'CONSTRAINT':
                    return { key: 'constraint', label: 'Constraint & Foreign Key', icon: 'fa-solid fa-key text-warning', order: 5 };
                case 'INDEX':
                    return { key: 'index', label: 'Index', icon: 'fa-solid fa-list-ol text-info', order: 6 };
                case 'SEQUENCE':
                    return { key: 'sequence', label: 'Sequence', icon: 'fa-solid fa-arrow-down-1-9 text-secondary', order: 7 };
                default:
                    return { key: 'other', label: 'Other Objects', icon: 'fa-solid fa-cube text-secondary', order: 8 };
            }
        }

        getFriendlyTypeName(rawType) {
            const t = (rawType || '').toUpperCase();
            switch (t) {
                case 'VIEW': return 'View';
                case 'MATERIALIZED_VIEW': return 'Materialized View';
                case 'FUNCTION': return 'Function';
                case 'PROCEDURE': return 'Procedure';
                case 'TRIGGER': return 'Trigger';
                case 'TABLE': return 'Table';
                case 'FOREIGN_TABLE': return 'Foreign Table';
                case 'FOREIGN_KEY': return 'Foreign Key';
                case 'CONSTRAINT': return 'Constraint';
                case 'INDEX': return 'Index';
                case 'SEQUENCE': return 'Sequence';
                case 'COLUMN': return 'Column';
                default: return rawType || 'Object';
            }
        }

        getRelationDescription(node) {
            if (!this.graphData || !this.graphData.edges) {
                return 'đọc';
            }

            // Find matching edge for this node
            const edge = this.graphData.edges.find(e => e.target === node.id || e.source === node.id);
            if (!edge) {
                if (node.level === 0) return 'Đối tượng gốc';
                return 'đọc';
            }

            const rel = (edge.relation || '').toUpperCase();
            switch (rel) {
                case 'USES_COLUMN':
                case 'USES_TABLE':
                    return 'đọc';
                case 'REFERENCES_VIEW':
                    return 'đọc / tham chiếu';
                case 'CALLS_FUNCTION':
                    return 'gọi hàm';
                case 'HAS_TRIGGER':
                    return 'kích hoạt trigger';
                case 'FOREIGN_KEY_TO':
                    return 'khóa ngoại';
                case 'HAS_CONSTRAINT':
                    return 'ràng buộc';
                case 'HAS_INDEX':
                    return 'chỉ mục';
                case 'DEPENDS_ON':
                    return 'phụ thuộc';
                default:
                    if (node.object_type === 'VIEW' || node.object_type === 'MATERIALIZED_VIEW') return 'đọc';
                    return 'phụ thuộc';
            }
        }

        render() {
            const tbody = this.container?.querySelector('#ide-dep-list-tbody');
            const emptyMsg = this.container?.querySelector('#ide-dep-list-empty-msg');
            const totalBadge = this.container?.querySelector('#ide-dep-list-total-badge');
            if (!tbody) return;

            if (!this.graphData || !this.graphData.nodes || this.graphData.nodes.length === 0) {
                tbody.innerHTML = '';
                if (emptyMsg) emptyMsg.classList.remove('d-none');
                if (totalBadge) totalBadge.textContent = '0 đối tượng';
                return;
            }

            // Filter nodes by:
            // 1. Exclude the root column/table from the dependent list if desired, or keep based on level > 0
            // When user inspects table/column, they want to see its dependents / dependencies
            const rootId = this.graphData.root?.id;
            let filteredNodes = this.graphData.nodes.filter(n => {
                // Exclude the root node itself so only dependents/dependencies appear in the list
                if (rootId && n.id === rootId) {
                    return false;
                }
                // Custom type filter from dropdown
                if (this.filterFn && !this.filterFn(n)) {
                    return false;
                }
                // Search query
                if (this.searchQuery) {
                    const fullName = `${n.schema || ''}.${n.name || ''}`.toLowerCase();
                    const typeStr = (n.object_type || '').toLowerCase();
                    const descStr = this.getRelationDescription(n).toLowerCase();
                    if (!fullName.includes(this.searchQuery) && !typeStr.includes(this.searchQuery) && !descStr.includes(this.searchQuery)) {
                        return false;
                    }
                }
                return true;
            });

            if (totalBadge) {
                totalBadge.textContent = `${filteredNodes.length} đối tượng`;
            }

            if (filteredNodes.length === 0) {
                tbody.innerHTML = '';
                if (emptyMsg) {
                    emptyMsg.classList.remove('d-none');
                    const emptyText = this.container.querySelector('#ide-dep-list-empty-text');
                    if (emptyText) {
                        if (this.graphData.root?.object_type === 'COLUMN') {
                            emptyText.textContent = `Không tìm thấy View hay Function/Procedure nào SELECT cột '${this.graphData.root.name}' (chỉ JOIN mà không SELECT đã được lọc bỏ).`;
                        } else {
                            emptyText.textContent = 'Không có đối tượng nào phụ thuộc hoặc phù hợp với bộ lọc.';
                        }
                    }
                }
                return;
            }

            if (emptyMsg) emptyMsg.classList.add('d-none');

            // Render Rows
            if (this.isGrouped) {
                this.renderGrouped(tbody, filteredNodes);
            } else {
                this.renderFlat(tbody, filteredNodes);
            }

            this.bindRowEvents(tbody);
        }

        renderGrouped(tbody, nodes) {
            // Group by category
            const groupsMap = new Map();

            nodes.forEach(n => {
                const cat = this.getGroupCategory(n.object_type);
                if (!groupsMap.has(cat.key)) {
                    groupsMap.set(cat.key, { meta: cat, items: [] });
                }
                groupsMap.get(cat.key).items.push(n);
            });

            // Sort groups by defined display order
            const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.meta.order - b.meta.order);

            let html = '';
            for (const grp of sortedGroups) {
                const isCollapsed = this.collapsedGroups.has(grp.meta.key);
                const count = grp.items.length;

                // Group header row
                html += `
                    <tr class="ide-dep-group-header ${isCollapsed ? 'is-collapsed' : ''}" data-group-key="${grp.meta.key}">
                        <td colspan="4">
                            <div class="d-flex align-items-center justify-content-between">
                                <div class="d-flex align-items-center gap-2">
                                    <i class="fa-solid fa-chevron-down ide-dep-group-chevron"></i>
                                    <i class="${grp.meta.icon} ide-dep-group-icon"></i>
                                    <span class="fw-semibold ide-dep-group-title">${grp.meta.label}</span>
                                    <span class="badge bg-secondary-subtle text-secondary border border-secondary px-2 py-0" style="font-size: 10px;">
                                        ${count}
                                    </span>
                                </div>
                                <span class="small text-muted ide-dep-group-hint">${isCollapsed ? 'Click để mở rộng' : 'Click để thu gọn'}</span>
                            </div>
                        </td>
                    </tr>
                `;

                // Item rows
                for (const node of grp.items) {
                    html += this.renderRowHtml(node, isCollapsed);
                }
            }

            tbody.innerHTML = html;
        }

        renderFlat(tbody, nodes) {
            // Sort alphabetically by full name
            const sorted = [...nodes].sort((a, b) => {
                const na = `${a.schema}.${a.name}`.toLowerCase();
                const nb = `${b.schema}.${b.name}`.toLowerCase();
                return na.localeCompare(nb);
            });

            let html = '';
            for (const node of sorted) {
                html += this.renderRowHtml(node, false);
            }
            tbody.innerHTML = html;
        }

        renderRowHtml(node, isHidden = false) {
            const isSelected = this.selectedNodeId === node.id;
            const fullName = `${node.schema || 'public'}.${node.name || ''}`;
            const typeName = this.getFriendlyTypeName(node.object_type);
            const descText = this.getRelationDescription(node);

            return `
                <tr class="ide-dep-row ${isSelected ? 'selected' : ''} ${isHidden ? 'd-none' : ''}" 
                    data-node-id="${node.id}"
                    data-node-name="${encodeURIComponent(node.name || '')}"
                    data-node-schema="${encodeURIComponent(node.schema || 'public')}"
                    data-node-type="${encodeURIComponent(node.object_type || '')}"
                    data-node-full="${encodeURIComponent(fullName)}"
                    data-node-desc="${encodeURIComponent(descText)}">
                    <!-- Tên -->
                    <td class="col-name text-truncate">
                        <div class="d-flex align-items-center ide-dep-cell-name overflow-hidden">
                            <i class="fa-regular fa-eye ide-dep-eye-icon me-2 flex-shrink-0" title="Phụ thuộc / Được sử dụng"></i>
                            <span class="ide-dep-obj-name font-monospace text-truncate" title="${fullName}">${fullName}</span>
                        </div>
                    </td>

                    <!-- Loại -->
                    <td class="col-type">
                        <span class="ide-dep-obj-type">${typeName}</span>
                    </td>

                    <!-- Mô tả -->
                    <td class="col-desc">
                        <span class="ide-dep-obj-desc text-muted">${descText}</span>
                    </td>

                    <!-- Thao tác -->
                    <td class="col-actions text-end flex-shrink-0">
                        <div class="d-inline-flex align-items-center gap-1">
                            <!-- Nút Xem mã nguồn DDL -->
                            <button type="button" class="btn btn-sm ide-dep-row-action-btn ide-dep-btn-ddl" 
                                title="Xem mã nguồn DDL của đối tượng (Mở tab mới)" 
                                data-node-id="${node.id}">
                                <i class="fa-solid fa-file-code"></i>
                            </button>
                            <!-- Nút Xem chi tiết -->
                            <button type="button" class="btn btn-sm ide-dep-row-action-btn ide-dep-btn-inspect" 
                                title="Xem chi tiết thuộc tính" 
                                data-node-id="${node.id}">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        bindRowEvents(tbody) {
            // 1. Group Header Click (Collapse / Expand)
            tbody.querySelectorAll('.ide-dep-group-header').forEach(header => {
                header.addEventListener('click', (e) => {
                    const groupKey = header.getAttribute('data-group-key');
                    if (!groupKey) return;

                    const isCurrentlyCollapsed = this.collapsedGroups.has(groupKey);
                    if (isCurrentlyCollapsed) {
                        this.collapsedGroups.delete(groupKey);
                    } else {
                        this.collapsedGroups.add(groupKey);
                    }

                    // Re-render efficiently
                    this.render();
                });
            });

            // 2. Row Click & Double Click
            tbody.querySelectorAll('.ide-dep-row').forEach(row => {
                const nodeId = row.getAttribute('data-node-id');
                const node = this.graphData?.nodes?.find(n => n.id === nodeId);
                if (!node) return;

                // Click -> Select node and open Detail Drawer
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.ide-dep-row-action-btn')) return;
                    this.setSelectedNode(node.id);
                    if (typeof this.options.onNodeSelect === 'function') {
                        this.options.onNodeSelect(node);
                    }
                });

                // Double Click -> Open DDL
                row.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.ide-dep-row-action-btn')) return;
                    if (typeof this.options.onOpenDefinition === 'function') {
                        this.options.onOpenDefinition(node);
                    }
                });

                // Hover Popup Tooltip Card
                const nameCell = row.querySelector('.col-name');
                if (nameCell && this.hoverCard) {
                    nameCell.addEventListener('mouseenter', (e) => {
                        this.showHoverCard(e, node);
                    });
                    nameCell.addEventListener('mouseleave', () => {
                        this.hideHoverCard();
                    });
                    nameCell.addEventListener('mousemove', (e) => {
                        this.positionHoverCard(e);
                    });
                }
            });

            // 3. Action Buttons
            // DDL View Button
            tbody.querySelectorAll('.ide-dep-btn-ddl').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nodeId = btn.getAttribute('data-node-id');
                    const node = this.graphData?.nodes?.find(n => n.id === nodeId);
                    if (node && typeof this.options.onOpenDefinition === 'function') {
                        this.options.onOpenDefinition(node);
                    }
                });
            });

            // Inspect Button
            tbody.querySelectorAll('.ide-dep-btn-inspect').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const nodeId = btn.getAttribute('data-node-id');
                    const node = this.graphData?.nodes?.find(n => n.id === nodeId);
                    if (node) {
                        this.setSelectedNode(node.id);
                        if (typeof this.options.onNodeSelect === 'function') {
                            this.options.onNodeSelect(node);
                        }
                    }
                });
            });
        }

        showHoverCard(e, node) {
            if (!this.hoverCard) return;
            const fullName = `${node.schema || 'public'}.${node.name || ''}`;
            const typeName = this.getFriendlyTypeName(node.object_type);
            const descText = this.getRelationDescription(node);

            this.hoverCard.innerHTML = `
                <div class="ide-dep-hover-name font-monospace">${fullName}</div>
                <div class="ide-dep-hover-type">${typeName}</div>
                <div class="ide-dep-hover-desc text-muted">${descText}</div>
            `;
            this.hoverCard.classList.remove('d-none');
            this.positionHoverCard(e);
        }

        positionHoverCard(e) {
            if (!this.hoverCard || this.hoverCard.classList.contains('d-none')) return;
            const pad = 12;
            let left = e.clientX + pad;
            let top = e.clientY + pad;

            const rect = this.hoverCard.getBoundingClientRect();
            if (left + rect.width > window.innerWidth - 10) {
                left = Math.max(10, e.clientX - rect.width - pad);
            }
            if (top + rect.height > window.innerHeight - 10) {
                top = Math.max(10, e.clientY - rect.height - pad);
            }

            this.hoverCard.style.left = `${left}px`;
            this.hoverCard.style.top = `${top}px`;
        }

        hideHoverCard() {
            if (this.hoverCard) {
                this.hoverCard.classList.add('d-none');
            }
        }
    }

    global.PostgresDependencyListView = PostgresDependencyListView;
})(window);
