/**
 * PostgreSQL Dependency Graph - Filter & Search Controller
 * Manages search query, object type filters, confidence filters, depth and direction.
 */
(function (global) {
    'use strict';

    class PostgresDependencyFilter {
        constructor(toolbarContainer, options = {}) {
            this.container = toolbarContainer;
            this.options = options;
            this.searchQuery = '';
            this.selectedTypes = new Set(['VIEW', 'MATERIALIZED_VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'CONSTRAINT', 'FOREIGN_KEY', 'INDEX', 'COLUMN', 'TABLE']);
            this.selectedConfidence = new Set(['CONFIRMED', 'LIKELY', 'POSSIBLE', 'UNKNOWN']);
            this.currentDepth = 2;
            this.currentDirection = 'dependents'; // 'dependents' | 'dependencies'
            this.currentLayout = options.layout || 'list'; // Default to list view
        }

        render() {
            if (!this.container) return;

            this.container.innerHTML = `
                <!-- Left: Refresh, Layout, Direction -->
                <div class="ide-dep-toolbar-group">
                    <button type="button" class="ide-dep-btn" id="ide-dep-btn-refresh" title="Refresh Graph from Database">
                        <i class="fa-solid fa-arrows-rotate"></i>
                    </button>
                    <div class="vr mx-1 opacity-25"></div>
                    <div class="btn-group btn-group-sm" role="group">
                        <button type="button" class="ide-dep-btn ${this.currentDirection === 'dependents' ? 'active' : ''}" id="ide-dep-btn-dir-dependents" title="Xem các đối tượng phụ thuộc vào nó (View, Procedure, FK dùng nó)">
                            <i class="fa-solid fa-arrow-down-wide-short me-1"></i> Dependents (Dùng nó)
                        </button>
                        <button type="button" class="ide-dep-btn ${this.currentDirection === 'dependencies' ? 'active' : ''}" id="ide-dep-btn-dir-dependencies" title="Xem các đối tượng mà nó phụ thuộc (Bảng cha, Sequence...)">
                            <i class="fa-solid fa-arrow-up-wide-short me-1"></i> Dependencies (Nó dùng)
                        </button>
                    </div>
                    <div class="vr mx-1 opacity-25"></div>
                    <div class="btn-group btn-group-sm" role="group">
                        <button type="button" class="ide-dep-btn ${this.currentLayout === 'tree' ? 'active' : ''}" id="ide-dep-btn-layout-tree" title="Hierarchical Tree Layout">
                            <i class="fa-solid fa-sitemap"></i> Tree
                        </button>
                        <button type="button" class="ide-dep-btn ${this.currentLayout === 'force' ? 'active' : ''}" id="ide-dep-btn-layout-force" title="Force Directed Graph Layout">
                            <i class="fa-solid fa-circle-nodes"></i> Force
                        </button>
                        <button type="button" class="ide-dep-btn ${this.currentLayout === 'both' ? 'active' : ''}" id="ide-dep-btn-layout-both" title="Dual View (Tree & Graph)">
                            <i class="fa-solid fa-columns"></i> Both
                        </button>
                        <button type="button" class="ide-dep-btn ${this.currentLayout === 'list' ? 'active' : ''}" id="ide-dep-btn-layout-list" title="Danh sách đối tượng (List View)">
                            <i class="fa-solid fa-list-ul"></i> List
                        </button>
                    </div>
                </div>

                <!-- Center: Depth and Filter Dropdowns -->
                <div class="ide-dep-toolbar-group">
                    <label class="small text-muted me-1">Depth:</label>
                    <select class="ide-dep-select" id="ide-dep-select-depth" title="Graph Depth Limit">
                        <option value="1" ${this.currentDepth === 1 ? 'selected' : ''}>1 Level (Direct)</option>
                        <option value="2" ${this.currentDepth === 2 ? 'selected' : ''}>2 Levels</option>
                        <option value="3" ${this.currentDepth === 3 ? 'selected' : ''}>3 Levels</option>
                        <option value="4" ${this.currentDepth === 4 ? 'selected' : ''}>All Levels</option>
                    </select>

                    <div class="dropdown">
                        <button class="ide-dep-btn dropdown-toggle" type="button" id="ide-dep-filter-btn" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="fa-solid fa-filter me-1"></i> Filter Types
                        </button>
                        <ul class="dropdown-menu shadow p-2 ide-dep-dropdown" aria-labelledby="ide-dep-filter-btn" style="min-width: 180px; font-size: 12px;">
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="VIEW" checked> Views</label></li>
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="FUNCTION" checked> Functions</label></li>
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="TRIGGER" checked> Triggers</label></li>
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="FOREIGN_KEY" checked> Foreign Keys</label></li>
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="INDEX" checked> Indexes</label></li>
                            <li><label class="dropdown-item py-1"><input type="checkbox" class="form-check-input me-2 dep-type-chk" value="CONSTRAINT" checked> Constraints</label></li>
                        </ul>
                    </div>
                </div>

                <!-- Right: Search, Zoom Controls & Close Button -->
                <div class="ide-dep-toolbar-group">
                    <div class="position-relative">
                        <input type="text" class="ide-dep-search-input" id="ide-dep-search-input" placeholder="Search object..." value="${this.searchQuery}">
                    </div>
                    <div class="vr mx-1 opacity-25"></div>
                    <button type="button" class="ide-dep-btn" id="ide-dep-btn-zoom-in" title="Zoom In">
                        <i class="fa-solid fa-magnifying-glass-plus"></i>
                    </button>
                    <button type="button" class="ide-dep-btn" id="ide-dep-btn-zoom-out" title="Zoom Out">
                        <i class="fa-solid fa-magnifying-glass-minus"></i>
                    </button>
                    <button type="button" class="ide-dep-btn" id="ide-dep-btn-fit" title="Fit to Screen">
                        <i class="fa-solid fa-expand"></i>
                    </button>
                    <button type="button" class="ide-dep-btn" id="ide-dep-btn-reset" title="Reset View">
                        <i class="fa-solid fa-arrows-to-dot"></i>
                    </button>
                    <div class="vr mx-1 opacity-25"></div>
                    <button type="button" class="ide-dep-btn ide-dep-btn-close text-danger" id="ide-dep-btn-close" title="Close Dependency View (Đóng)">
                        <i class="fa-solid fa-xmark me-1"></i> Close
                    </button>
                </div>
            `;

            this.bindEvents();
        }

        setDirection(dir, emit = true) {
            this.currentDirection = dir;
            const depBtn = this.container?.querySelector('#ide-dep-btn-dir-dependents');
            const depndBtn = this.container?.querySelector('#ide-dep-btn-dir-dependencies');
            if (depBtn) depBtn.classList.toggle('active', dir === 'dependents');
            if (depndBtn) depndBtn.classList.toggle('active', dir === 'dependencies');
            if (emit) this.emit('directionChange', dir);
        }

        setLayout(layout, emit = true) {
            this.currentLayout = layout;
            const treeBtn = this.container?.querySelector('#ide-dep-btn-layout-tree');
            const forceBtn = this.container?.querySelector('#ide-dep-btn-layout-force');
            const bothBtn = this.container?.querySelector('#ide-dep-btn-layout-both');
            const listBtn = this.container?.querySelector('#ide-dep-btn-layout-list');
            if (treeBtn) treeBtn.classList.toggle('active', layout === 'tree');
            if (forceBtn) forceBtn.classList.toggle('active', layout === 'force');
            if (bothBtn) bothBtn.classList.toggle('active', layout === 'both');
            if (listBtn) listBtn.classList.toggle('active', layout === 'list');

            const zoomGroup = this.container?.querySelectorAll('#ide-dep-btn-zoom-in, #ide-dep-btn-zoom-out, #ide-dep-btn-fit, #ide-dep-btn-reset');
            zoomGroup?.forEach(btn => {
                btn.disabled = (layout === 'list');
                btn.style.opacity = (layout === 'list') ? '0.4' : '1';
            });

            if (emit) this.emit('layoutChange', layout);
        }

        setDepth(depth, emit = true) {
            this.currentDepth = parseInt(depth, 10) || 2;
            const depthSelect = this.container?.querySelector('#ide-dep-select-depth');
            if (depthSelect) depthSelect.value = String(this.currentDepth);
            if (emit) this.emit('depthChange', this.currentDepth);
        }

        bindEvents() {
            const refreshBtn = this.container.querySelector('#ide-dep-btn-refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    refreshBtn.classList.add('rotating');
                    setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
                    this.emit('refresh');
                });
            }

            const closeBtn = this.container.querySelector('#ide-dep-btn-close');
            if (closeBtn) closeBtn.addEventListener('click', () => this.emit('close'));

            const dirDepBtn = this.container.querySelector('#ide-dep-btn-dir-dependents');
            const dirDepndBtn = this.container.querySelector('#ide-dep-btn-dir-dependencies');
            if (dirDepBtn) {
                dirDepBtn.addEventListener('click', () => {
                    if (this.currentDirection !== 'dependents') {
                        this.setDirection('dependents', true);
                    }
                });
            }
            if (dirDepndBtn) {
                dirDepndBtn.addEventListener('click', () => {
                    if (this.currentDirection !== 'dependencies') {
                        this.setDirection('dependencies', true);
                    }
                });
            }

            const treeBtn = this.container.querySelector('#ide-dep-btn-layout-tree');
            if (treeBtn) {
                treeBtn.addEventListener('click', () => {
                    if (this.currentLayout !== 'tree') {
                        this.setLayout('tree', true);
                    }
                });
            }

            const forceBtn = this.container.querySelector('#ide-dep-btn-layout-force');
            if (forceBtn) {
                forceBtn.addEventListener('click', () => {
                    if (this.currentLayout !== 'force') {
                        this.setLayout('force', true);
                    }
                });
            }

            const bothBtn = this.container.querySelector('#ide-dep-btn-layout-both');
            if (bothBtn) {
                bothBtn.addEventListener('click', () => {
                    if (this.currentLayout !== 'both') {
                        this.setLayout('both', true);
                    }
                });
            }

            const listBtn = this.container.querySelector('#ide-dep-btn-layout-list');
            if (listBtn) {
                listBtn.addEventListener('click', () => {
                    if (this.currentLayout !== 'list') {
                        this.setLayout('list', true);
                    }
                });
            }

            const depthSelect = this.container.querySelector('#ide-dep-select-depth');
            if (depthSelect) depthSelect.addEventListener('change', (e) => {
                this.currentDepth = parseInt(e.target.value, 10);
                this.emit('depthChange', this.currentDepth);
            });

            const chks = this.container.querySelectorAll('.dep-type-chk');
            chks.forEach(chk => {
                chk.addEventListener('change', () => {
                    const val = chk.value;
                    if (chk.checked) {
                        this.selectedTypes.add(val);
                        if (val === 'VIEW') this.selectedTypes.add('MATERIALIZED_VIEW');
                        if (val === 'FUNCTION') this.selectedTypes.add('PROCEDURE');
                    } else {
                        this.selectedTypes.delete(val);
                        if (val === 'VIEW') this.selectedTypes.delete('MATERIALIZED_VIEW');
                        if (val === 'FUNCTION') this.selectedTypes.delete('PROCEDURE');
                    }
                    this.emit('typeFilterChange', Array.from(this.selectedTypes));
                });
            });

            const searchInput = this.container.querySelector('#ide-dep-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = (e.target.value || '').trim();
                    this.emit('searchChange', this.searchQuery);
                });
            }

            const zoomIn = this.container.querySelector('#ide-dep-btn-zoom-in');
            if (zoomIn) zoomIn.addEventListener('click', () => this.emit('zoomIn'));

            const zoomOut = this.container.querySelector('#ide-dep-btn-zoom-out');
            if (zoomOut) zoomOut.addEventListener('click', () => this.emit('zoomOut'));

            const fitBtn = this.container.querySelector('#ide-dep-btn-fit');
            if (fitBtn) fitBtn.addEventListener('click', () => this.emit('fitScreen'));

            const resetBtn = this.container.querySelector('#ide-dep-btn-reset');
            if (resetBtn) resetBtn.addEventListener('click', () => this.emit('resetZoom'));

            if (this.currentLayout === 'list') {
                const zoomGroup = this.container.querySelectorAll('#ide-dep-btn-zoom-in, #ide-dep-btn-zoom-out, #ide-dep-btn-fit, #ide-dep-btn-reset');
                zoomGroup.forEach(btn => {
                    btn.disabled = true;
                    btn.style.opacity = '0.4';
                });
            }
        }

        emit(eventName, data) {
            if (typeof this.options[eventName] === 'function') {
                this.options[eventName](data);
            }
        }

        matchesFilter(node) {
            if (!node) return false;
            if (node.level === 0) return true; // Always show root

            const type = (node.object_type || '').toUpperCase();
            if (!this.selectedTypes.has(type)) return false;

            const conf = (node.confidence || 'CONFIRMED').toUpperCase();
            if (!this.selectedConfidence.has(conf)) return false;

            return true;
        }

        matchesSearch(node) {
            if (!this.searchQuery) return true;
            const q = this.searchQuery.toLowerCase();
            const name = (node.name || '').toLowerCase();
            const disp = (node.display_name || '').toLowerCase();
            const schema = (node.schema || '').toLowerCase();
            return name.includes(q) || disp.includes(q) || schema.includes(q);
        }
    }

    global.PostgresDependencyFilter = PostgresDependencyFilter;
})(window);
