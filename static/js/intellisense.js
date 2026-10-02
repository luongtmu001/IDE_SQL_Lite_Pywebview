// Web IDE IntelliSense Architecture — Phase 1 Refactored
// Separates EditorAdapter, IntelliSenseController, and IntelliSensePopupUI
// Compliant with Section 63 of intellisense_improvement_plan_v2.md and intellisense_overview.md

(function (window) {
    'use strict';

    const ICON_MAP = {
        table: 'fa-table text-primary',
        view: 'fa-table-columns text-info',
        procedure: 'fa-gears text-warning',
        function: 'fa-code text-success',
        trigger: 'fa-bolt text-danger',
        synonym: 'fa-link text-secondary',
        column: 'fa-columns text-info',
        pk_column: 'fa-key text-warning',
        keyword: 'fa-font text-primary',
        sql_function: 'fa-calculator text-success',
        temp_table: 'fa-clock text-warning',
        table_variable: 'fa-cube text-info',
        scalar_variable: 'fa-cube text-warning',
        parameter: 'fa-cube text-warning',
        data_type: 'fa-cube text-info',
        user_data_type: 'fa-shapes text-warning',
        snippet: 'fa-wand-magic-sparkles text-warning',
        join_condition: 'fa-link text-warning'
    };

    function formatDisplayType(type) {
        const map = {
            table: 'Table',
            view: 'View',
            procedure: 'Procedure',
            function: 'Function',
            trigger: 'Trigger',
            synonym: 'Synonym',
            sequence: 'Sequence',
            column: 'Column',
            keyword: 'Keyword',
            sql_function: 'Function',
            temp_table: 'Temp Table',
            table_variable: 'Table Var',
            scalar_variable: 'Variable',
            parameter: 'Parameter',
            data_type: 'Data Type',
            user_data_type: 'UDT',
            snippet: 'Snippet',
            join_condition: 'FK Join'
        };
        return map[type] || (type.charAt(0).toUpperCase() + type.slice(1));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. DATA PROVIDER / CACHE MANAGER
    // ─────────────────────────────────────────────────────────────────────────────
    class IntelliSenseDataProvider {
        constructor() {
            // Client-side caches
            this.objectsCache = new Map();
            this.columnsCache = new Map();
            this.parametersCache = new Map();
            this.foreignKeysCache = new Map();
            this.definitionsCache = new Map();
            this.dataTypesCache = new Map();

            // Metadata Adapter (Phase 4)
            this._provider = (window.MetadataProviderFactory && typeof window.MetadataProviderFactory.getProvider === 'function')
                ? window.MetadataProviderFactory.getProvider()
                : null;
        }

        getProvider(connectionId, dbType) {
            if (window.MetadataProviderFactory) {
                if (dbType && typeof window.MetadataProviderFactory.getProvider === 'function') {
                    return window.MetadataProviderFactory.getProvider(dbType);
                }
                if (connectionId && typeof window.MetadataProviderFactory.getProviderForConnection === 'function') {
                    return window.MetadataProviderFactory.getProviderForConnection(connectionId);
                }
                if (typeof window.MetadataProviderFactory.getProvider === 'function') {
                    return window.MetadataProviderFactory.getProvider();
                }
            }
            return this._provider;
        }

        get cache() {
            return window.AppMetadataCache || null;
        }

        async fetchObjects(connectionId, database, schema, dbType) {
            if (!connectionId) return [];
            const cacheKey = `${connectionId}::${database || ''}::${schema || ''}`;
            
            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getObjects(connectionId, database, schema);
                if (cached) return cached;
            } else if (this.objectsCache.has(cacheKey)) {
                return this.objectsCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getObjects === 'function') {
                    const items = await provider.getObjects(connectionId, database, schema);
                    if (items && Array.isArray(items)) {
                        if (this.cache) this.cache.setObjects(connectionId, database, schema, items);
                        this.objectsCache.set(cacheKey, items);
                        return items;
                    }
                }
                const url = `/api/metadata/${connectionId}/intellisense/objects?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.success && Array.isArray(data.items)) {
                    if (this.cache) this.cache.setObjects(connectionId, database, schema, data.items);
                    this.objectsCache.set(cacheKey, data.items);
                    return data.items;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchObjects error:', e);
            }
            return [];
        }

        async fetchColumns(connectionId, database, schema, table, dbType) {
            if (!connectionId || !table) return [];
            const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${table}`;

            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getColumns(connectionId, database, schema, table);
                if (cached) return cached;
            } else if (this.columnsCache.has(cacheKey)) {
                return this.columnsCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getColumns === 'function') {
                    const items = await provider.getColumns(connectionId, database, schema, table);
                    if (items && Array.isArray(items)) {
                        if (this.cache) this.cache.setColumns(connectionId, database, schema, table, items);
                        this.columnsCache.set(cacheKey, items);
                        return items;
                    }
                }
                const url = `/api/metadata/${connectionId}/intellisense/columns?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&table=${encodeURIComponent(table)}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.success && Array.isArray(data.items)) {
                    if (this.cache) this.cache.setColumns(connectionId, database, schema, table, data.items);
                    this.columnsCache.set(cacheKey, data.items);
                    return data.items;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchColumns error:', e);
            }
            return [];
        }

        async fetchParameters(connectionId, database, schema, name, dbType) {
            if (!connectionId || !name) return [];
            const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${name}`;

            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getParameters(connectionId, database, schema, name);
                if (cached) return cached;
            } else if (this.parametersCache.has(cacheKey)) {
                return this.parametersCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getParameters === 'function') {
                    const items = await provider.getParameters(connectionId, database, schema, name);
                    if (items && Array.isArray(items)) {
                        if (this.cache) this.cache.setParameters(connectionId, database, schema, name, items);
                        this.parametersCache.set(cacheKey, items);
                        return items;
                    }
                }
                const url = `/api/metadata/${connectionId}/intellisense/parameters?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name)}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.success && Array.isArray(data.items)) {
                    if (this.cache) this.cache.setParameters(connectionId, database, schema, name, data.items);
                    this.parametersCache.set(cacheKey, data.items);
                    return data.items;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchParameters error:', e);
            }
            return [];
        }

        async fetchDefinition(connectionId, database, schema, name, type, dbType) {
            if (!connectionId || !name) return null;
            const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${name}::${type || ''}`;

            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getDefinition(connectionId, database, schema, name, type);
                if (cached) return cached;
            } else if (this.definitionsCache.has(cacheKey)) {
                return this.definitionsCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getDefinition === 'function') {
                    const def = await provider.getDefinition(connectionId, database, schema, name, type);
                    if (def) {
                        if (this.cache) this.cache.setDefinition(connectionId, database, schema, name, type, def);
                        this.definitionsCache.set(cacheKey, def);
                        return def;
                    }
                }
                const url = `/api/metadata/${connectionId}/definition?database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(schema || '')}&name=${encodeURIComponent(name)}&type=${encodeURIComponent(type || '')}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.success && data.definition) {
                    if (this.cache) this.cache.setDefinition(connectionId, database, schema, name, type, data.definition);
                    this.definitionsCache.set(cacheKey, data.definition);
                    return data.definition;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchDefinition error:', e);
            }
            return null;
        }

        async fetchForeignKeys(connectionId, database, schema, table, dbType) {
            if (!connectionId) return [];
            const cacheKey = `${connectionId}::${database || ''}::${schema || ''}::${table || ''}`;

            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getForeignKeys(connectionId, database, schema, table);
                if (cached) return cached;
            } else if (this.foreignKeysCache.has(cacheKey)) {
                return this.foreignKeysCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getForeignKeys === 'function') {
                    const items = await provider.getForeignKeys(connectionId, database, schema, table);
                    if (items && Array.isArray(items)) {
                        if (this.cache) this.cache.setForeignKeys(connectionId, database, schema, table, items);
                        this.foreignKeysCache.set(cacheKey, items);
                        return items;
                    }
                }
                const params = new URLSearchParams();
                if (database) params.append('database', database);
                if (schema) params.append('schema', schema);
                if (table) params.append('table', table);
                const q = params.toString() ? `?${params.toString()}` : '';
                const res = await fetch(`/api/metadata/${connectionId}/foreign_keys${q}`);
                const data = await res.json();
                if (data.success && Array.isArray(data.items)) {
                    if (this.cache) this.cache.setForeignKeys(connectionId, database, schema, table, data.items);
                    this.foreignKeysCache.set(cacheKey, data.items);
                    return data.items;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchForeignKeys error:', e);
            }
            return [];
        }

        async fetchDataTypes(connectionId, database, dbType) {
            const defaultTypes = (window.SqlContextAnalyzer && window.SqlContextAnalyzer.SQL_DATA_TYPES) ? window.SqlContextAnalyzer.SQL_DATA_TYPES : [
                "BIGINT", "BINARY", "BIT", "BOOLEAN", "BYTEA", "CHAR", "DATE", "DATETIME",
                "DATETIME2", "DATETIMEOFFSET", "DECIMAL", "DOUBLE PRECISION", "FLOAT", "IMAGE",
                "INT", "INTEGER", "JSON", "JSONB", "MONEY", "NCHAR", "NTEXT", "NUMERIC",
                "NVARCHAR", "REAL", "SERIAL", "BIGSERIAL", "SMALLDATETIME", "SMALLINT",
                "SMALLMONEY", "SMALLSERIAL", "TEXT", "TIME", "TIMESTAMP", "TIMESTAMPTZ",
                "TINYINT", "UNIQUEIDENTIFIER", "UUID", "VARBINARY", "VARCHAR", "XML"
            ];

            if (!connectionId) return { types: defaultTypes, user_types: [] };

            const cacheKey = `${connectionId}::${database || ''}`;

            // Check Multi-Tier Cache (Phase 5)
            if (this.cache) {
                const cached = this.cache.getSupportedTypes(connectionId, database);
                if (cached) return cached;
            } else if (this.dataTypesCache.has(cacheKey)) {
                return this.dataTypesCache.get(cacheKey);
            }

            try {
                const provider = this.getProvider(connectionId, dbType);
                if (provider && typeof provider.getSupportedTypes === 'function') {
                    const items = await provider.getSupportedTypes(connectionId, database);
                    if (items && Array.isArray(items) && items.length > 0) {
                        const resObj = {
                            types: items,
                            user_types: []
                        };
                        if (this.cache) this.cache.setSupportedTypes(connectionId, database, resObj);
                        this.dataTypesCache.set(cacheKey, resObj);
                        return resObj;
                    }
                }
                const url = `/api/metadata/${connectionId}/intellisense/types?database=${encodeURIComponent(database || '')}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.success) {
                    const resObj = {
                        types: (data.types && data.types.length > 0) ? data.types : defaultTypes,
                        user_types: data.user_types || []
                    };
                    if (this.cache) this.cache.setSupportedTypes(connectionId, database, resObj);
                    this.dataTypesCache.set(cacheKey, resObj);
                    return resObj;
                }
            } catch (e) {
                console.warn('[IntelliSense] fetchDataTypes error:', e);
            }

            return { types: defaultTypes, user_types: [] };
        }

        clearCache() {
            if (this.cache && typeof this.cache.invalidateAll === 'function') {
                this.cache.invalidateAll();
            }
            this.objectsCache.clear();
            this.columnsCache.clear();
            this.parametersCache.clear();
            this.definitionsCache.clear();
            this.dataTypesCache.clear();
        }

        invalidateObject(connectionId, database, schema, objectName) {
            if (this.cache && typeof this.cache.invalidateObject === 'function') {
                this.cache.invalidateObject(connectionId, database, schema, objectName);
            }
            const colKey = `${connectionId}::${database || ''}::${schema || ''}::${objectName}`;
            this.columnsCache.delete(colKey);
            const objKey = `${connectionId}::${database || ''}::${schema || ''}`;
            this.objectsCache.delete(objKey);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. INTELLISENSE POPUP UI PRESENTER
    // ─────────────────────────────────────────────────────────────────────────────
    class IntelliSensePopupUI {
        constructor() {
            this.popup = null;
            this.listPanel = null;
            this.listEl = null;
            this.splitterEl = null;
            this.detailsPanel = null;
            this.summaryTabBtn = null;
            this.scriptTabBtn = null;
            this.summaryContent = null;
            this.scriptContent = null;
            this.countBadge = null;

            this.candidates = [];
            this.selectedIndex = -1;
            this.isVisible = false;
            this.mouseEnteredPopup = false;
            this.popupHasBeenDragged = false;
            this.isDraggingPopup = false;

            this.onItemChosen = null;
            this.onDismiss = null;
        }

        init() {
            this.popup = document.getElementById('ide-intellisense-popup');
            if (!this.popup) return;

            this.listPanel = document.getElementById('ide-intellisense-list-panel');
            this.listEl = document.getElementById('ide-intellisense-list');
            this.splitterEl = document.getElementById('ide-intellisense-splitter');
            this.detailsPanel = document.getElementById('ide-intellisense-details-panel');

            this.summaryTabBtn = document.getElementById('ide-is-tab-summary-btn');
            this.scriptTabBtn = document.getElementById('ide-is-tab-script-btn');
            this.summaryContent = document.getElementById('ide-is-summary-content');
            this.scriptContent = document.getElementById('ide-is-script-content');
            this.countBadge = document.getElementById('ide-intellisense-count');

            this._initSplitter();
            this._initPopupDrag();
            this._initMouseEvents();
        }

        _initSplitter() {
            if (!this.splitterEl || !this.listPanel) return;
            let isDragging = false;
            let startX = 0;
            let startWidth = 0;

            this.splitterEl.addEventListener('mousedown', (e) => {
                isDragging = true;
                startX = e.clientX;
                startWidth = this.listPanel.getBoundingClientRect().width;
                this.splitterEl.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const delta = e.clientX - startX;
                let newWidth = startWidth + delta;
                if (newWidth < 220) newWidth = 220;
                if (newWidth > 600) newWidth = 600;
                this.listPanel.style.width = newWidth + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (!isDragging) return;
                isDragging = false;
                this.splitterEl.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            });
        }

        _initPopupDrag() {
            if (!this.popup) return;
            const header = this.popup.querySelector('.ide-intellisense-header');
            if (!header) return;

            let startX = 0;
            let startY = 0;
            let startLeft = 0;
            let startTop = 0;

            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('#ide-intellisense-count')) return;
                this.isDraggingPopup = true;
                this.popupHasBeenDragged = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = this.popup.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                header.style.cursor = 'grabbing';
                document.body.style.userSelect = 'none';
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!this.isDraggingPopup) return;
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                this.popup.style.left = (startLeft + deltaX) + 'px';
                this.popup.style.top = (startTop + deltaY) + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (!this.isDraggingPopup) return;
                this.isDraggingPopup = false;
                if (header) header.style.cursor = 'move';
                document.body.style.userSelect = '';
            });
        }

        _initMouseEvents() {
            if (!this.popup) return;

            this.popup.addEventListener('mouseenter', () => {
                this.mouseEnteredPopup = true;
            });

            document.addEventListener('mousemove', (e) => {
                if (!this.isVisible || !this.mouseEnteredPopup || this.isDraggingPopup) return;
                const rect = this.popup.getBoundingClientRect();
                const threshold = 35;
                const isInsideWithMargin = (
                    e.clientX >= rect.left - threshold &&
                    e.clientX <= rect.right + threshold &&
                    e.clientY >= rect.top - threshold &&
                    e.clientY <= rect.bottom + threshold
                );
                if (!isInsideWithMargin) {
                    this.hide();
                    if (typeof this.onDismiss === 'function') this.onDismiss();
                }
            });

            document.addEventListener('mousedown', (e) => {
                if (!this.isVisible) return;
                if (!this.popup.contains(e.target)) {
                    this.hide();
                    if (typeof this.onDismiss === 'function') this.onDismiss();
                }
            });
        }

        render(candidates, cursorCoords, tabCtx, dataProvider) {
            if (!this.popup || !candidates || candidates.length === 0) {
                this.hide();
                return;
            }

            this.candidates = candidates;

            if (this.popupHasBeenDragged && this.isVisible) {
                // User manually dragged popup; preserve chosen position
            } else {
                let top = (cursorCoords ? cursorCoords.bottom : 100) + 4;
                let left = cursorCoords ? cursorCoords.left : 100;

                const popupHeight = 280;
                const popupWidth = 744;
                if (top + popupHeight > window.innerHeight - 10 && cursorCoords && cursorCoords.top - popupHeight > 10) {
                    top = cursorCoords.top - popupHeight - 4;
                }
                if (left + popupWidth > window.innerWidth - 10) {
                    left = window.innerWidth - popupWidth - 10;
                }
                if (left < 10) left = 10;

                this.popup.style.top = top + 'px';
                this.popup.style.left = left + 'px';
            }

            this.popup.classList.remove('d-none');
            this.isVisible = true;
            this.mouseEnteredPopup = false;

            // Render list
            this.listEl.innerHTML = '';
            this.candidates.forEach((cand, idx) => {
                const row = document.createElement('div');
                row.className = `ide-intellisense-item ${cand.type === 'keyword' ? 'is-keyword' : ''}`;
                row.dataset.index = idx;

                const iconClass = ICON_MAP[cand.type] || (cand.isPk ? ICON_MAP.pk_column : 'fa-circle-dot text-secondary');
                row.innerHTML = `
                    <i class="fa-solid ${iconClass} item-icon"></i>
                    <span class="item-name">${cand.name}</span>
                    <span class="badge-type">[${cand.displayType}]</span>
                `;

                row.addEventListener('mouseenter', () => {
                    this.selectIndex(idx, false, tabCtx, dataProvider);
                });

                row.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectIndex(idx, false, tabCtx, dataProvider);
                    if (typeof this.onItemChosen === 'function') {
                        this.onItemChosen(cand);
                    }
                });

                this.listEl.appendChild(row);
            });

            if (this.countBadge) {
                this.countBadge.textContent = this.candidates.length;
            }

            // Neutral initial state: no item is auto-selected until user explicitly navigates or clicks
            this.selectedIndex = -1;
            if (this.summaryContent) {
                this.summaryContent.innerHTML = `<div class="p-2 text-muted small fst-italic"><i class="fa-solid fa-arrow-pointer me-1"></i>Sử dụng phím mũi tên hoặc click để chọn gợi ý.</div>`;
            }
            if (this.scriptContent) {
                this.scriptContent.textContent = '-- Chọn một đối tượng để xem chi tiết';
            }
        }

        selectIndex(index, shouldScroll, tabCtx, dataProvider) {
            if (index < 0 || index >= this.candidates.length) return;
            this.selectedIndex = index;

            const items = this.listEl.querySelectorAll('.ide-intellisense-item');
            items.forEach((item, idx) => {
                if (idx === index) {
                    item.classList.add('active');
                    if (shouldScroll) {
                        item.scrollIntoView({ block: 'nearest' });
                    }
                } else {
                    item.classList.remove('active');
                }
            });

            this.updateDetailPreview(this.candidates[index], tabCtx, dataProvider);
        }

        moveSelection(delta, tabCtx, dataProvider) {
            if (this.candidates.length === 0) return;
            let newIndex;
            if (this.selectedIndex === -1) {
                newIndex = (delta > 0) ? 0 : this.candidates.length - 1;
            } else {
                newIndex = this.selectedIndex + delta;
                if (newIndex < 0) newIndex = 0;
                if (newIndex >= this.candidates.length) newIndex = this.candidates.length - 1;
            }
            this.selectIndex(newIndex, true, tabCtx, dataProvider);
        }

        async updateDetailPreview(item, tabCtx, dataProvider) {
            if (!item || !this.summaryContent || !this.scriptContent || !dataProvider) return;
            tabCtx = tabCtx || {};

            // 1. Render Summary View
            if (item.type === 'table' || item.type === 'view') {
                this.summaryContent.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i>Loading columns...</div>`;
                const cols = await dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name);
                if (cols.length > 0) {
                    let html = `
                        <div class="mb-1 fw-bold text-truncate" style="font-size: 11px;">
                            <i class="fa-solid ${ICON_MAP[item.type]} me-1"></i>${item.schema ? item.schema + '.' : ''}${item.name}
                        </div>
                        <table class="ide-is-summary-table">
                            <thead>
                                <tr><th>Name</th><th>Data Type</th><th>Null</th><th>PK</th></tr>
                            </thead>
                            <tbody>
                    `;
                    cols.forEach(c => {
                        html += `
                            <tr>
                                <td class="font-monospace">${c.name}</td>
                                <td class="text-info">${c.data_type || ''}</td>
                                <td class="text-muted">${c.is_nullable ? 'YES' : 'NO'}</td>
                                <td>${c.is_pk ? '<i class="fa-solid fa-key text-warning"></i>' : ''}</td>
                            </tr>
                        `;
                    });
                    html += '</tbody></table>';
                    this.summaryContent.innerHTML = html;
                } else {
                    this.summaryContent.innerHTML = `<div class="p-2 small text-muted">No column information available.</div>`;
                }
            } else if (item.type === 'procedure' || item.type === 'function') {
                this.summaryContent.innerHTML = `<div class="p-2 text-center text-muted small"><i class="fa-solid fa-spinner fa-spin me-1"></i>Loading parameters...</div>`;
                const params = await dataProvider.fetchParameters(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name);
                if (params.length > 0) {
                    let html = `
                        <div class="mb-1 fw-bold text-truncate" style="font-size: 11px;">
                            <i class="fa-solid ${ICON_MAP[item.type]} me-1"></i>${item.schema ? item.schema + '.' : ''}${item.name}
                        </div>
                        <table class="ide-is-summary-table">
                            <thead>
                                <tr><th>Parameter</th><th>Type</th><th>Output</th></tr>
                            </thead>
                            <tbody>
                    `;
                    params.forEach(p => {
                        html += `
                            <tr>
                                <td class="font-monospace">${p.name}</td>
                                <td class="text-info">${p.data_type || ''}</td>
                                <td class="text-muted">${p.is_output ? 'OUT' : 'IN'}</td>
                            </tr>
                        `;
                    });
                    html += '</tbody></table>';
                    this.summaryContent.innerHTML = html;
                } else {
                    this.summaryContent.innerHTML = `<div class="p-2 small text-muted">Routine has no parameters.</div>`;
                }
            } else if (item.type === 'column' || item.type === 'pk_column') {
                this.summaryContent.innerHTML = `
                    <div class="p-2">
                        <div class="fw-bold font-monospace mb-1"><i class="fa-solid fa-columns text-info me-1"></i>${item.name}</div>
                        ${item.tableName ? `<div class="small text-muted mb-1">Table: <span class="font-monospace text-primary">${item.schema ? item.schema + '.' : ''}${item.tableName}${item.tableAlias ? ' (' + item.tableAlias + ')' : ''}</span></div>` : ''}
                        <div class="small text-muted">Data Type: <span class="text-info fw-semibold">${item.dataType || 'Unknown'}</span></div>
                        <div class="small text-muted">Nullable: <span class="fw-semibold">${item.isNullable ? 'YES' : 'NO'}</span></div>
                        <div class="small text-muted">Primary Key: <span class="fw-semibold">${item.isPk ? 'YES' : 'NO'}</span></div>
                    </div>
                `;
                this.scriptContent.textContent = `-- Column: ${item.name} ${item.dataType || ''}\n-- Table: ${item.tableName || 'N/A'}`;
            } else if (item.type === 'data_type' || item.type === 'user_data_type') {
                this.summaryContent.innerHTML = `
                    <div class="p-2">
                        <div class="fw-bold font-monospace mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-cube'} me-1"></i>${item.name}</div>
                        <div class="small text-muted">Category: <span class="fw-semibold text-info">${item.displayType}</span></div>
                        <div class="small text-muted mt-1">SQL data type for columns, variables, and parameters.</div>
                    </div>
                `;
                this.scriptContent.textContent = `-- Data Type: ${item.name}\n-- Category: ${item.displayType}`;
            } else if (item.type === 'snippet') {
                const snip = item.snippetData || {};
                const placeholders = snip.placeholders || [];
                let phHtml = '';
                if (placeholders.length > 0) {
                    phHtml = `
                        <div class="mt-2">
                            <div class="small fw-semibold text-secondary mb-1">Placeholders:</div>
                            <div class="d-flex flex-wrap gap-1">
                                ${placeholders.map(p => `<span class="badge bg-secondary-subtle text-warning font-monospace" style="font-size:0.75rem;">$${p.name}$ = "${p.defaultValue !== undefined ? p.defaultValue : ''}"</span>`).join('')}
                            </div>
                        </div>
                    `;
                }
                this.summaryContent.innerHTML = `
                    <div class="p-2">
                        <div class="fw-bold mb-1"><i class="fa-solid fa-wand-magic-sparkles text-warning me-1"></i>${item.name}</div>
                        <div class="small text-muted mb-1">Loại: <span class="fw-semibold text-warning">SQL Snippet</span></div>
                        <div class="small text-light">${item.description || 'Không có mô tả'}</div>
                        ${phHtml}
                        <div class="small text-muted mt-2 fst-italic">Nhấn <b>Tab</b> hoặc <b>Enter</b> để chèn snippet.</div>
                    </div>
                `;
                if (window.AppSnippets && typeof window.AppSnippets.expandSnippetBody === 'function') {
                    const exp = window.AppSnippets.expandSnippetBody(snip);
                    this.scriptContent.textContent = exp.expandedText || snip.body || '';
                } else {
                    this.scriptContent.textContent = snip.body || '';
                }
            } else if (item.type === 'temp_table' || item.type === 'table_variable') {
                if (item.columns && item.columns.length > 0) {
                    let html = `
                        <div class="mb-1 fw-bold text-truncate" style="font-size: 11px;">
                            <i class="fa-solid ${ICON_MAP[item.type] || 'fa-clock'} me-1"></i>${item.name} (${item.displayType})
                        </div>
                        <table class="ide-is-summary-table">
                            <thead>
                                <tr><th>Column</th><th>Data Type</th></tr>
                            </thead>
                            <tbody>
                    `;
                    item.columns.forEach(c => {
                        const colName = c.name || c;
                        const dt = c.dataType || c.data_type || '';
                        html += `
                            <tr>
                                <td class="font-monospace">${colName}</td>
                                <td class="text-info">${dt}</td>
                            </tr>
                        `;
                    });
                    html += '</tbody></table>';
                    this.summaryContent.innerHTML = html;
                } else {
                    this.summaryContent.innerHTML = `
                        <div class="p-2">
                            <div class="fw-bold mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-clock'} me-1"></i>${item.name}</div>
                            <div class="small text-muted">Type: <span class="fw-semibold text-warning">${item.displayType}</span></div>
                        </div>
                    `;
                }
                this.scriptContent.textContent = `-- Local Script Object: ${item.name} (${item.displayType})`;
            } else if (item.type === 'scalar_variable' || item.type === 'parameter') {
                this.summaryContent.innerHTML = `
                    <div class="p-2">
                        <div class="fw-bold mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-cube'} me-1"></i>${item.name}</div>
                        <div class="small text-muted mb-1">Type: <span class="fw-semibold text-warning">${item.displayType}</span></div>
                        ${item.dataType ? `<div class="small text-muted">Data Type: <span class="font-monospace text-info">${item.dataType}</span></div>` : ''}
                    </div>
                `;
                this.scriptContent.textContent = `-- Variable / Parameter: ${item.name} ${item.dataType || ''}`;
            } else {
                this.summaryContent.innerHTML = `
                    <div class="p-2">
                        <div class="fw-bold mb-1"><i class="fa-solid ${ICON_MAP[item.type] || 'fa-info-circle'} me-1"></i>${item.name}</div>
                        <div class="small text-muted">Type: <span class="fw-semibold">${item.displayType}</span></div>
                        ${item.targetObject ? `<div class="small text-muted mt-1">Target: <span class="font-monospace text-secondary">${item.targetObject}</span></div>` : ''}
                    </div>
                `;
            }

            // 2. Render Script Definition View
            this.scriptContent.textContent = '-- Loading definition...';
            if (['table', 'view', 'procedure', 'function', 'trigger'].includes(item.type)) {
                const def = await dataProvider.fetchDefinition(tabCtx.connectionId, tabCtx.database, item.schema || tabCtx.schema, item.name, item.type);
                this.scriptContent.textContent = def || '-- Definition script not available.';
            } else if (!['column', 'pk_column', 'data_type', 'user_data_type', 'temp_table', 'table_variable', 'scalar_variable', 'parameter'].includes(item.type)) {
                this.scriptContent.textContent = `-- Definition not available for [${item.displayType}]`;
            }
        }

        getSelectedItem() {
            if (this.selectedIndex >= 0 && this.selectedIndex < this.candidates.length) {
                return this.candidates[this.selectedIndex];
            }
            return null;
        }

        hide() {
            if (!this.popup) return;
            this.popup.classList.add('d-none');
            this.isVisible = false;
            this.mouseEnteredPopup = false;
            this.popupHasBeenDragged = false;
            this.isDraggingPopup = false;
            this.selectedIndex = -1;
            this.candidates = [];
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. INTELLISENSE CONTROLLER (Orchestrator)
    // ─────────────────────────────────────────────────────────────────────────────
    class IntelliSenseController {
        constructor(dataProvider, popupUI) {
            this.dataProvider = dataProvider;
            this.popupUI = popupUI;
            this.activeAdapter = null;
            this.activeContext = null;
            this.activeCandidates = null;
            this.debounceTimer = null;
            this.isConfirmingCompletion = false;
            this._currentRequestId = 0;

            // Trigger & Lifecycle Controller (Plan Section 5, 10, 52)
            this.triggerController = (window.IntelliSenseTriggerController)
                ? new window.IntelliSenseTriggerController()
                : (window.DefaultTriggerController || null);

            // Wire popupUI callbacks
            this.popupUI.onItemChosen = (item) => {
                if (this.activeAdapter) {
                    this.chooseItem(this.activeAdapter, item);
                }
            };
            this.popupUI.onDismiss = () => {
                this.activeContext = null;
                this.activeCandidates = null;
                if (this.triggerController) {
                    this.triggerController.clearActiveCandidates();
                    this.triggerController.clearActiveToken();
                    this.triggerController.setState(window.CompletionState ? window.CompletionState.IDLE : 'IDLE', 'dismissed');
                }
            };

            this._initGlobalListeners();
        }

        get completionEngine() {
            if (window.DefaultCompletionEngine) {
                // Ensure dataProvider and cache are synced
                if (!window.DefaultCompletionEngine.dataProvider && this.dataProvider) {
                    window.DefaultCompletionEngine.setDataProvider(this.dataProvider);
                }
                if (!window.DefaultCompletionEngine.metadataCache && window.AppMetadataCache) {
                    window.DefaultCompletionEngine.setMetadataCache(window.AppMetadataCache);
                }
                return window.DefaultCompletionEngine;
            }
            return null;
        }

        _initGlobalListeners() {
            document.addEventListener('ide-tab-switched', () => {
                this.hidePopup();
            });
            document.addEventListener('ide-context-changed', () => {
                this.hidePopup();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'F12') {
                    e.preventDefault();
                    this.goToDefinition();
                }
            });
        }

        normalizeAdapter(editorOrAdapter) {
            if (!editorOrAdapter) return null;
            if (window.EditorAdapter && editorOrAdapter instanceof window.EditorAdapter) {
                return editorOrAdapter;
            }
            if (typeof editorOrAdapter.getTextBeforeCursor === 'function' && typeof editorOrAdapter.getCursorPosition === 'function') {
                return editorOrAdapter;
            }
            if (window.EditorAdapter) {
                return new window.EditorAdapter(editorOrAdapter);
            }
            return editorOrAdapter;
        }

        attachEditor(editorOrAdapter) {
            const adapter = this.normalizeAdapter(editorOrAdapter);
            if (!adapter || adapter._intellisenseAttached) return;
            adapter._intellisenseAttached = true;
            this.activeAdapter = adapter;

            adapter.on('change', (editor, changeObj) => {
                if (changeObj && changeObj.origin === 'setValue') return;
                if (this.isConfirmingCompletion) {
                    this.isConfirmingCompletion = false;
                    if (this.debounceTimer) {
                        clearTimeout(this.debounceTimer);
                        this.debounceTimer = null;
                    }
                    return;
                }

                const fullSql = adapter.getText();
                const cursorOffset = adapter.getCursorOffset();
                let context = null;
                if (window.SqlContextAnalyzer && typeof window.SqlContextAnalyzer.analyze === 'function') {
                    context = window.SqlContextAnalyzer.analyze(fullSql, cursorOffset);
                }
                this.activeContext = context;

                if (this.triggerController) {
                    const isVisible = this.popupUI.isVisible;
                    const hasSelection = (typeof adapter.hasSelection === 'function') ? adapter.hasSelection() : false;
                    const decision = this.triggerController.decideChange(changeObj, context, isVisible, hasSelection);

                    if (decision.action === 'close') {
                        this.hidePopup();
                        return;
                    }

                    if (decision.action === 'refresh') {
                        // Section 31: Fast local filtering without re-querying backend!
                        if (this.debounceTimer) clearTimeout(this.debounceTimer);
                        this.debounceTimer = setTimeout(() => {
                            this.refresh(adapter, context);
                        }, 25);
                        return;
                    }

                    if (decision.action === 'trigger') {
                        const delay = (decision.reason === 'character') ? 40 : 100;
                        if (this.debounceTimer) clearTimeout(this.debounceTimer);
                        this.debounceTimer = setTimeout(() => {
                            this.trigger(adapter, false, decision.reason);
                        }, delay);
                        return;
                    }

                    // decision.action === 'none'
                    return;
                }

                // Fallback debounce
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.trigger(adapter, false);
                }, 120);
            });

            adapter.on('cursorActivity', () => {
                if (!this.popupUI.isVisible) return; // NEVER auto-trigger on cursor movement alone! (Section 33)

                const curOffset = adapter.getCursorOffset();
                const curPos = adapter.getCursor();

                if (this.triggerController) {
                    const decision = this.triggerController.decideCursor(curOffset, curPos ? curPos.line : undefined, true);
                    if (decision.action === 'close') {
                        this.hidePopup();
                    }
                } else if (this.activeContext) {
                    if (Math.abs(curOffset - this.activeContext.cursorIndex) > 10) {
                        this.hidePopup();
                    }
                }
            });

            adapter.on('keydown', (editor, e) => {
                if (this.handleKeyDown(adapter, e)) {
                    if (typeof e.preventDefault === 'function') e.preventDefault();
                    if (typeof e.stopPropagation === 'function') e.stopPropagation();
                }
            });
        }

        handleKeyDown(adapter, e) {
            const isVisible = this.popupUI.isVisible;
            const hasSelection = (typeof adapter.hasSelection === 'function') ? adapter.hasSelection() : false;

            if (this.triggerController) {
                const decision = this.triggerController.decideKeyDown(e, isVisible, hasSelection);
                const tabCtx = this.getActiveTabContext();

                if (decision.action === 'trigger') {
                    this.trigger(adapter, true, 'explicit');
                    return true;
                }
                if (decision.action === 'close') {
                    this.hidePopup();
                    return true;
                }
                if (decision.action === 'accept') {
                    const selected = this.popupUI.getSelectedItem();
                    if (selected) {
                        this.chooseItem(adapter, selected);
                        return true;
                    } else {
                        // Neutral state (no item selected): dismiss popup and let Enter insert newline in editor!
                        this.hidePopup();
                        return false;
                    }
                }
                if (decision.action === 'navigate') {
                    this.popupUI.moveSelection(decision.step || 1, tabCtx, this.dataProvider);
                    return true;
                }
                return false;
            }

            // Fallback keydown handler
            const tabCtx = this.getActiveTabContext();

            if (!this.popupUI.isVisible) {
                if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
                    this.trigger(adapter, true);
                    return true;
                }
                return false;
            }

            switch (e.key) {
                case 'ArrowDown':
                    this.popupUI.moveSelection(1, tabCtx, this.dataProvider);
                    return true;
                case 'ArrowUp':
                    this.popupUI.moveSelection(-1, tabCtx, this.dataProvider);
                    return true;
                case 'PageDown':
                    this.popupUI.moveSelection(8, tabCtx, this.dataProvider);
                    return true;
                case 'PageUp':
                    this.popupUI.moveSelection(-8, tabCtx, this.dataProvider);
                    return true;
                case 'Enter':
                case 'Tab':
                    const selected = this.popupUI.getSelectedItem();
                    if (selected) {
                        this.chooseItem(adapter, selected);
                        return true;
                    } else {
                        this.hidePopup();
                        return false;
                    }
                case 'Escape':
                    this.hidePopup();
                    return true;
            }
            return false;
        }

        getActiveTabContext() {
            if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
                const state = window.AppTabs.getActiveTabState();
                if (state) {
                    return {
                        connectionId: state.connectionId,
                        database: state.database,
                        schema: state.schema,
                        dbType: state.dbType || 'sqlserver'
                    };
                }
            }
            return {
                connectionId: window.ActiveConnectionId,
                database: window.ActiveDatabase,
                schema: window.ActiveSchema,
                dbType: window.ActiveDbType || 'sqlserver'
            };
        }

        refresh(adapter, context) {
            if (!this.popupUI.isVisible) return;
            const currentContext = context || this.activeContext;
            if (!currentContext) {
                this.hidePopup();
                return;
            }

            // Section 20, 21, 22: Inside comment or string literal -> close
            if (currentContext.isInsideComment || currentContext.isInsideString) {
                this.hidePopup();
                return;
            }

            // Type-Switching reactive detection: if context type or statement/tables changed
            const stmtStart = currentContext.statementRange ? currentContext.statementRange.start : 0;
            const tablesSignature = (currentContext.queryTables || []).map(t => (t.table || '').toLowerCase()).sort().join(',');
            const currentCat = `${stmtStart}::${tablesSignature}::` + ((currentContext.isAlterContext && currentContext.alterObjectType)
                ? `alter_${currentContext.alterObjectType}`
                : ((currentContext.execContext && currentContext.execContext.isExec) ? 'exec' : (currentContext.clause || '')));

            if (this._lastContextCategory && currentCat && this._lastContextCategory !== currentCat) {
                this.activeCandidates = null;
                this.rawCandidates = null;
                this._lastContextCategory = currentCat;
                const tabCtx = this.getActiveTabContext();
                this.collectAndShowCandidates(adapter, currentContext, tabCtx);
                return;
            }
            this._lastContextCategory = currentCat;

            const wordLower = (currentContext.currentWord || '').toLowerCase();
            const tabCtx = this.getActiveTabContext();

            // Section 31 & 47: Fast local filtering without re-querying backend!
            const pool = this.rawCandidates || this.activeCandidates;
            if (pool && pool.length > 0) {
                this.activeCandidates = pool;
                const ranked = this.rankAndFilterCandidates(this.activeCandidates, wordLower, currentContext);
                if (!ranked || ranked.length === 0) {
                    this.hidePopup();
                    return;
                }
                this.activeCandidates = ranked;
                const cursorCoords = adapter.getCursorCoordinates();
                this.popupUI.render(ranked, cursorCoords, tabCtx, this.dataProvider);
                if (this.triggerController) {
                    this.triggerController.setActiveCandidates(ranked);
                    this.triggerController.setState(window.CompletionState ? window.CompletionState.VISIBLE : 'VISIBLE', 'refreshed');
                }
                return;
            }

            // Fallback re-fetch if no cached candidates
            this.collectAndShowCandidates(adapter, currentContext, tabCtx);
        }

        async trigger(editorOrAdapter, isManual = false, reason = 'automatic') {
            const adapter = this.normalizeAdapter(editorOrAdapter) || this.activeAdapter;
            if (!adapter || !window.SqlContextAnalyzer) return;
            this.activeAdapter = adapter;

            if (this.triggerController) {
                this.triggerController.setState(window.CompletionState ? window.CompletionState.OPENING : 'OPENING', reason);
            }

            const cursorOffset = adapter.getCursorOffset();
            const fullSql = adapter.getText();

            const context = window.SqlContextAnalyzer.analyze(fullSql, cursorOffset);
            const prevStmtStart = (this.activeContext && this.activeContext.statementRange) ? this.activeContext.statementRange.start : 0;
            const currStmtStart = (context && context.statementRange) ? context.statementRange.start : 0;
            if (prevStmtStart !== currStmtStart) {
                this.activeCandidates = null;
                this.rawCandidates = null;
            }
            this.activeContext = context;

            // Section 20, 21, 22: Inside comment or string literal -> strictly disabled
            if (context.isInsideComment || context.isInsideString) {
                this.hidePopup();
                return;
            }

            const isTriggerWord = context.currentWord.length > 0;
            const isDot = context.triggerChar === '.';
            const isFollowUp = context.hasFollowUp;
            const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');
            const isAlterContext = context.isAlterContext;
            const isExec = Boolean(context.execContext && context.execContext.isExec);
            const isRoutineBody = Boolean(context.isInRoutineBody);
            const isQuoted = Boolean(context.isQuotedIdentifier);
            const isEager = Boolean(reason && (reason.includes('space') || reason === 'automatic' || reason === 'explicit'));

            if (!isManual && !isTriggerWord && !isDot && !isFollowUp && !isFromClause && !isAlterContext && !isExec && !isEager && !isRoutineBody && !isQuoted) {
                this.hidePopup();
                return;
            }

            const tabCtx = this.getActiveTabContext();
            await this.collectAndShowCandidates(adapter, context, tabCtx);
        }

        async collectAndShowCandidates(adapter, context, tabCtx) {
            const requestId = ++this._currentRequestId;

            // Phase 6: Delegate to CompletionEngine pipeline (Section 21, 22)
            if (this.completionEngine && typeof this.completionEngine.getCompletions === 'function') {
                const fullText = adapter.getText();
                const cursor = adapter.getCursor();
                const ranked = await this.completionEngine.getCompletions(fullText, cursor, context, tabCtx);
                if (requestId !== this._currentRequestId) {
                    return; // Dropped stale response
                }
                if (!ranked || ranked.length === 0) {
                    this.hidePopup();
                    return;
                }
                this.rawCandidates = (ranked && ranked.rawCandidates) ? ranked.rawCandidates : ranked;
                this.activeCandidates = ranked;
                if (this.triggerController) {
                    this.triggerController.setActiveCandidates(ranked);
                    const wordLen = (context.currentWord || '').length;
                    const offset = adapter.getCursorOffset();
                    const tokenStart = (context.prefixRange && context.prefixRange.start !== undefined)
                        ? context.prefixRange.start
                        : (offset - wordLen);
                    this.triggerController.setActiveToken({
                        word: context.currentWord,
                        qualifier: context.qualifier,
                        start: tokenStart,
                        end: offset,
                        line: cursor ? cursor.line : 0
                    });
                    this.triggerController.setState(window.CompletionState ? window.CompletionState.VISIBLE : 'VISIBLE', 'rendered');
                }
                const cursorCoords = adapter.getCursorCoordinates();
                this.popupUI.render(ranked, cursorCoords, tabCtx, this.dataProvider);
                return;
            }

            const wordLower = context.currentWord.toLowerCase();
            const allCandidates = [];

            // 1. Level 1: SQL Keywords
            if (context.hasFollowUp && context.followUpKeywords.length > 0) {
                context.followUpKeywords.forEach(kw => {
                    if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: kw,
                            type: 'keyword',
                            level: 1,
                            displayType: 'Keyword'
                        });
                    }
                });
            } else if (!context.qualifier) {
                const keywordsToUse = (window.SqlContextAnalyzer && window.SqlContextAnalyzer.getKeywordsForDbType)
                    ? window.SqlContextAnalyzer.getKeywordsForDbType(tabCtx.dbType)
                    : window.SqlContextAnalyzer.SQL_KEYWORDS;

                keywordsToUse.forEach(kw => {
                    if (!wordLower || kw.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: kw,
                            type: 'keyword',
                            level: 1,
                            displayType: 'Keyword'
                        });
                    }
                });

                // SQL built-in functions
                window.SqlContextAnalyzer.SQL_FUNCTIONS.forEach(fn => {
                    if (!wordLower || fn.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: fn,
                            type: 'sql_function',
                            level: 1,
                            displayType: 'Function'
                        });
                    }
                });

                // SQL Snippets (Templates)
                if (window.AppSnippets && typeof window.AppSnippets.getSnippets === 'function') {
                    const allSnips = window.AppSnippets.getSnippets();
                    allSnips.forEach(snip => {
                        const prefixLower = (snip.prefix || '').toLowerCase();
                        if (prefixLower && (!wordLower || prefixLower.startsWith(wordLower) || prefixLower.includes(wordLower))) {
                            allCandidates.push({
                                name: snip.prefix,
                                type: 'snippet',
                                level: prefixLower.startsWith(wordLower) ? 0.9 : 1.5,
                                displayType: 'Snippet',
                                description: snip.description || '',
                                snippetData: snip
                            });
                        }
                    });
                }
            }

            // 2. Level 2: Local Script Objects (in file scope)
            if (!context.qualifier) {
                (context.localTempTables || []).forEach(tbl => {
                    if (!wordLower || tbl.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: tbl,
                            type: 'temp_table',
                            level: 2,
                            displayType: 'Temp Table'
                        });
                    }
                });

                (context.localTableVars || []).forEach(v => {
                    if (!wordLower || v.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: v,
                            type: 'table_variable',
                            level: 2,
                            displayType: 'Table Var'
                        });
                    }
                });

                // If tables in query, suggest columns (Level 1.1) in SELECT clause
                if (tabCtx.connectionId && context.queryTables && context.queryTables.length > 0) {
                    const isExprClause = (context.clause === 'SELECT' || !context.clause || ['WHERE', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING'].includes(context.clause));
                    if (isExprClause) {
                        for (const tbl of context.queryTables) {
                            const targetSchema = tbl.schema || tabCtx.schema;
                            const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, tbl.table);
                            cols.forEach(c => {
                                if (!wordLower || c.name.toLowerCase().startsWith(wordLower)) {
                                    allCandidates.push({
                                        name: c.name,
                                        type: c.is_pk ? 'pk_column' : 'column',
                                        level: 1.1,
                                        displayType: 'Column',
                                        dataType: c.data_type,
                                        isNullable: c.is_nullable,
                                        isPk: c.is_pk,
                                        schema: targetSchema,
                                        tableName: tbl.table,
                                        tableAlias: tbl.alias
                                    });
                                }
                            });
                        }
                    }
                }

                // Suggest SQL Data Types
                const dtData = await this.dataProvider.fetchDataTypes(tabCtx.connectionId, tabCtx.database);
                if (dtData.types && dtData.types.length > 0) {
                    dtData.types.forEach(dt => {
                        const dtName = dt.toUpperCase();
                        if (!wordLower || dtName.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: dtName,
                                type: 'data_type',
                                level: 1.8,
                                displayType: 'Data Type'
                            });
                        }
                    });
                }
                if (dtData.user_types && dtData.user_types.length > 0) {
                    dtData.user_types.forEach(udt => {
                        if (!wordLower || udt.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: udt,
                                type: 'user_data_type',
                                level: 1.9,
                                displayType: 'UDT'
                            });
                        }
                    });
                }
            }

            // 3. Level 2: Database Objects & Columns
            if (context.qualifier) {
                const qualLower = context.qualifier.toLowerCase();
                let targetTable = null;
                let targetSchema = tabCtx.schema;

                if (context.resolvedObject && context.resolvedObject.object) {
                    targetTable = context.resolvedObject.object;
                    if (context.resolvedObject.schema) targetSchema = context.resolvedObject.schema;
                } else if (context.aliasMap && context.aliasMap[qualLower]) {
                    const mapped = context.aliasMap[qualLower];
                    targetTable = mapped.table || mapped.object;
                    if (mapped.schema) targetSchema = mapped.schema;
                } else {
                    targetTable = context.qualifier;
                }

                // A. Columns from active database connection
                if (tabCtx.connectionId && targetTable) {
                    const cols = await this.dataProvider.fetchColumns(tabCtx.connectionId, tabCtx.database, targetSchema, targetTable);
                    cols.forEach(c => {
                        if (!wordLower || c.name.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: c.name,
                                type: c.is_pk ? 'pk_column' : 'column',
                                level: 2,
                                displayType: 'Column',
                                dataType: c.data_type,
                                isNullable: c.is_nullable,
                                isPk: c.is_pk,
                                schema: targetSchema,
                                tableName: targetTable
                            });
                        }
                    });
                }

                // B. Columns discovered from query expressions/references (local script scope)
                if (context.resolvedObject && Array.isArray(context.resolvedObject.columns)) {
                    context.resolvedObject.columns.forEach(col => {
                        const cName = col.name || col;
                        if (!wordLower || cName.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: cName,
                                type: col.is_pk ? 'pk_column' : 'column',
                                level: 2,
                                displayType: 'Column',
                                dataType: col.data_type || '',
                                isNullable: col.is_nullable !== false,
                                isPk: Boolean(col.is_pk),
                                schema: targetSchema || '',
                                tableName: targetTable || context.qualifier
                            });
                        }
                    });
                }

                // C. If qualifier is not an alias, it could be a schema name (e.g. dbo.)
                const isKnownAlias = Boolean(context.resolvedObject && context.resolvedObject.isAlias);
                if (tabCtx.connectionId && !isKnownAlias) {
                    const dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, context.qualifier);
                    dbObjects.forEach(obj => {
                        if (!wordLower || obj.name.toLowerCase().startsWith(wordLower)) {
                            allCandidates.push({
                                name: obj.name,
                                type: obj.type,
                                level: 2,
                                displayType: formatDisplayType(obj.type),
                                schema: obj.schema,
                                targetObject: obj.target_object
                            });
                        }
                    });
                }
            } else if (tabCtx.connectionId) {
                const dbObjects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
                dbObjects.forEach(obj => {
                    if (!wordLower || obj.name.toLowerCase().startsWith(wordLower)) {
                        allCandidates.push({
                            name: obj.name,
                            type: obj.type,
                            level: 2,
                            displayType: formatDisplayType(obj.type),
                            schema: obj.schema,
                            targetObject: obj.target_object
                        });
                    }
                });
            }

            // Deduplicate & Rank
            const ranked = this.rankAndFilterCandidates(allCandidates, wordLower, context);
            if (ranked.length === 0) {
                this.hidePopup();
                return;
            }
            this.rawCandidates = allCandidates;
            this.activeCandidates = ranked;
            if (this.triggerController) {
                this.triggerController.setActiveCandidates(ranked);
                const curPos = adapter.getCursor();
                const wordLen = (context.currentWord || '').length;
                const offset = adapter.getCursorOffset();
                this.triggerController.setActiveToken({
                    word: context.currentWord,
                    qualifier: context.qualifier,
                    start: offset - wordLen,
                    end: offset,
                    line: curPos ? curPos.line : 0
                });
                this.triggerController.setState(window.CompletionState ? window.CompletionState.VISIBLE : 'VISIBLE', 'rendered');
            }

            const cursorCoords = adapter.getCursorCoordinates();
            this.popupUI.render(ranked, cursorCoords, tabCtx, this.dataProvider);
        }

        rankAndFilterCandidates(list, wordLower, context) {
            let candidates = list || [];
            if (this.completionEngine && this.completionEngine.filter && typeof this.completionEngine.filter.filter === 'function') {
                candidates = this.completionEngine.filter.filter(candidates, wordLower);
            } else if (wordLower) {
                const wl = wordLower.toLowerCase();
                candidates = candidates.filter(item => {
                    const name = (item.name || item.label || '').toLowerCase();
                    return name.includes(wl);
                });
            }

            if (this.completionEngine && this.completionEngine.ranker && typeof this.completionEngine.ranker.rank === 'function') {
                return this.completionEngine.ranker.rank(candidates, context, wordLower);
            }

            const seen = new Set();
            const unique = [];

            candidates.forEach(item => {
                const key = `${(item.name || '').toLowerCase()}::${item.type}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    unique.push(item);
                }
            });

            const isFromClause = (context.clause === 'FROM' || context.clause === 'JOIN');

            unique.sort((a, b) => {
                if (context.isAlterContext && context.alterObjectType) {
                    const aMatches = a.type === context.alterObjectType;
                    const bMatches = b.type === context.alterObjectType;
                    if (aMatches && !bMatches) return -1;
                    if (!aMatches && bMatches) return 1;
                }

                if (isFromClause && !context.qualifier) {
                    const aIsSource = ['table', 'view', 'temp_table', 'table_variable', 'synonym'].includes(a.type);
                    const bIsSource = ['table', 'view', 'temp_table', 'table_variable', 'synonym'].includes(b.type);
                    if (aIsSource && !bIsSource) return -1;
                    if (!aIsSource && bIsSource) return 1;
                }

                if (context.clause === 'SELECT' && !context.qualifier) {
                    const aIsCol = (a.type === 'column' || a.type === 'pk_column');
                    const bIsCol = (b.type === 'column' || b.type === 'pk_column');
                    if (aIsCol && !bIsCol) return -1;
                    if (!aIsCol && bIsCol) return 1;
                }

                if (a.level !== b.level) {
                    return a.level - b.level;
                }

                if (wordLower) {
                    const aExact = a.name.toLowerCase() === wordLower;
                    const bExact = b.name.toLowerCase() === wordLower;
                    if (aExact && !bExact) return -1;
                    if (!aExact && bExact) return 1;
                }

                return a.name.localeCompare(b.name);
            });

            return unique.slice(0, 150);
        }

        async chooseItem(editorOrAdapter, item) {
            const adapter = this.normalizeAdapter(editorOrAdapter) || this.activeAdapter;
            if (!adapter || !item) {
                this.hidePopup();
                return;
            }

            if (this.triggerController) {
                this.triggerController.setState(window.CompletionState ? window.CompletionState.ACCEPTING : 'ACCEPTING', 'item_selected');
            }

            const currentContext = this.activeContext;
            this.isConfirmingCompletion = true;
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            this.popupUI.hide();

            const cursor = adapter.getCursor();
            const line = adapter.getLine(cursor.line);
            const wordLen = currentContext ? (currentContext.currentWord || '').length : 0;
            let fromPos = { line: cursor.line, ch: cursor.ch - wordLen };
            let toPos = cursor;

            // Phase 2: Quoting Dialect & Replacement Range Chuẩn Xác
            if (currentContext && currentContext.replacementRange && typeof adapter.posFromIndex === 'function') {
                fromPos = adapter.posFromIndex(currentContext.replacementRange.start);
                toPos = adapter.posFromIndex(currentContext.replacementRange.end);
            }

            // 1. Snippet completion
            if (item.type === 'snippet' && item.snippetData && window.AppSnippets && typeof window.AppSnippets.expandSnippetBody === 'function') {
                const expanded = window.AppSnippets.expandSnippetBody(item.snippetData);
                adapter.operation(() => {
                    adapter.replaceRange(expanded.expandedText, fromPos, toPos);
                    const startOffset = adapter.indexFromPos(fromPos);
                    const absSelStart = startOffset + expanded.selectionStart;
                    const absSelEnd = startOffset + expanded.selectionEnd;
                    const posStart = adapter.posFromIndex(absSelStart);
                    const posEnd = adapter.posFromIndex(absSelEnd);
                    if (absSelStart !== absSelEnd) {
                        adapter.setSelection(posStart, posEnd);
                    } else {
                        adapter.setCursor(posStart);
                    }
                    adapter.focus();
                });
                return;
            }

            // 2. ALTER / CREATE OR ALTER / CREATE OR REPLACE context (Generate script)
            const userTypedLine = line.substring(0, cursor.ch).trim();
            const hasAlterKeyword = /\b(ALTER|CREATE\s+OR\s+(?:ALTER|REPLACE))\s+(?:PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER|VIEW)\b/i.test(userTypedLine);
            const isAlterContext = Boolean((currentContext && currentContext.isAlterContext) || hasAlterKeyword);

            if (isAlterContext && ['procedure', 'function', 'trigger', 'view'].includes(item.type)) {
                const tabCtx = this.getActiveTabContext();
                const schema = item.schema || tabCtx.schema || 'dbo';
                const defScript = await this.dataProvider.fetchDefinition(
                    tabCtx.connectionId,
                    tabCtx.database,
                    schema,
                    item.name,
                    item.type,
                    tabCtx.dbType
                );

                if (defScript) {
                    let transformedScript = defScript;
                    const isCreateOrAlter = /\bCREATE\s+OR\s+ALTER\b/i.test(userTypedLine);
                    const isCreateOrReplace = /\bCREATE\s+OR\s+REPLACE\b/i.test(userTypedLine);
                    const isAlterOnly = /\bALTER\b/i.test(userTypedLine) && !isCreateOrAlter;

                    if (isAlterOnly) {
                        transformedScript = transformedScript.replace(
                            /\b(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i,
                            'ALTER $1'
                        );
                    } else if (isCreateOrAlter) {
                        transformedScript = transformedScript.replace(
                            /\b(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i,
                            'CREATE OR ALTER $1'
                        );
                    } else if (isCreateOrReplace) {
                        transformedScript = transformedScript.replace(
                            /\b(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i,
                            'CREATE OR REPLACE $1'
                        );
                    }

                    adapter.replaceRange(transformedScript, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });

                    const placeCursorAfterObjectName = () => {
                        const newText = adapter.getText();
                        const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(
                            `\\b(?:ALTER|CREATE(?:\\s+OR\\s+(?:ALTER|REPLACE))?)\\s+(?:PROCEDURE|PROC|FUNCTION|FUNC|TRIGGER|VIEW)\\s+(?:\\[?[\\w#@$]+\\]?\\.|\"[^\"]+\"\\.|\`[^\`]+\`\\.|[\\w#@$]+\\.)?(?:\\[${escapedName}\\]|\"${escapedName}\"|\`${escapedName}\`|${escapedName})`,
                            'i'
                        );
                        const match = regex.exec(newText);
                        if (match) {
                            const targetIdx = match.index + match[0].length;
                            const targetPos = adapter.posFromIndex(targetIdx);
                            adapter.setCursor(targetPos);
                            adapter.scrollIntoView(targetPos, 50);
                        }
                        adapter.focus();
                    };

                    placeCursorAfterObjectName();
                    setTimeout(placeCursorAfterObjectName, 30);
                    setTimeout(placeCursorAfterObjectName, 100);
                    return;
                }
            }

            // 3. Standard completion insertion
            let textToInsert = item.insertText || item.name;
            const hasFollowUp = (item.type === 'keyword' && window.SqlContextAnalyzer.FOLLOW_UP_KEYWORDS && window.SqlContextAnalyzer.FOLLOW_UP_KEYWORDS[item.name]);
            if (hasFollowUp && !textToInsert.endsWith(' ')) {
                textToInsert += ' ';
            }

            adapter.replaceRange(textToInsert, fromPos, toPos);
            if (typeof adapter.posFromIndex === 'function' && typeof adapter.indexFromPos === 'function') {
                const startIdx = adapter.indexFromPos(fromPos);
                const endIdx = startIdx + textToInsert.length;
                adapter.setCursor(adapter.posFromIndex(endIdx));
            }
            adapter.focus();
        }

        async goToDefinition() {
            const adapter = this.activeAdapter || this.normalizeAdapter(window.AppEditor);
            if (!adapter) return;

            const cursor = adapter.getCursor();
            const wordRange = adapter.findWordAt(cursor);
            const word = adapter.getRange(wordRange.anchor, wordRange.head).trim();
            if (!word) return;

            const tabCtx = this.getActiveTabContext();
            if (!tabCtx.connectionId) return;

            const objects = await this.dataProvider.fetchObjects(tabCtx.connectionId, tabCtx.database, tabCtx.schema);
            const match = objects.find(o => o.name.toLowerCase() === word.toLowerCase());

            if (match) {
                const defScript = await this.dataProvider.fetchDefinition(tabCtx.connectionId, tabCtx.database, match.schema || tabCtx.schema, match.name, match.type);
                if (defScript) {
                    if (window.AppTabs && typeof window.AppTabs.createTab === 'function') {
                        window.AppTabs.createTab({
                            title: `${match.name}.sql`,
                            content: defScript,
                            database: tabCtx.database,
                            schema: match.schema || tabCtx.schema,
                            connectionId: tabCtx.connectionId,
                            connectionName: window.ActiveConnectionName
                        });
                    }
                    return;
                }
            }

            if (typeof showToast === 'function') {
                showToast(`Could not resolve definition for '${word}'.`, 'warning');
            }
        }

        hidePopup() {
            this._currentRequestId++;
            if (this.completionEngine && typeof this.completionEngine.cancelPending === 'function') {
                this.completionEngine.cancelPending();
            }
            this.popupUI.hide();
            this.activeContext = null;
            this.activeCandidates = null;
            this.rawCandidates = null;
            this._lastContextCategory = null;
            if (this.triggerController) {
                this.triggerController.clearActiveCandidates();
                this.triggerController.clearActiveToken();
                this.triggerController.setState(window.CompletionState ? window.CompletionState.IDLE : 'IDLE', 'hidden');
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. INSTANTIATION & BACKWARD COMPATIBLE GLOBAL FACADE
    // ─────────────────────────────────────────────────────────────────────────────
    const dataProvider = new IntelliSenseDataProvider();
    const popupUI = new IntelliSensePopupUI();
    const controller = new IntelliSenseController(dataProvider, popupUI);

    function init() {
        popupUI.init();
    }

    // Expose Public API
    window.AppIntelliSense = {
        init,
        attachEditor: (ed) => controller.attachEditor(ed),
        triggerIntelliSense: (ed, isManual, reason) => controller.trigger(ed, isManual, reason),
        refresh: (ed, ctx) => controller.refresh(ed, ctx),
        hidePopup: () => controller.hidePopup(),
        goToDefinition: () => controller.goToDefinition(),
        isPopupVisible: () => popupUI.isVisible,
        chooseCurrentItem: (ed) => {
            const selected = popupUI.getSelectedItem();
            if (selected) controller.chooseItem(ed, selected);
        },
        // Expose underlying components for Phase 2-8 testing and extension
        getController: () => controller,
        getPopupUI: () => popupUI,
        getDataProvider: () => dataProvider,
        getCompletionEngine: () => controller.completionEngine,
        getTriggerController: () => controller.triggerController,
        get triggerController() { return controller.triggerController; },
        get dataProvider() { return dataProvider; }
    };

    document.addEventListener('DOMContentLoaded', () => {
        init();
    });

})(window);
