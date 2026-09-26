/**
 * Table Data Editor Controller — SSMS Query Designer & Edit Rows Style
 * File: static/js/table-data-editor.js
 * 
 * Features:
 *  - 3-Pane View: Criteria Pane (Filters & Sorting), SQL Pane, Editable Data Grid
 *  - 100% Height remaining allocation for Data Grid
 *  - SSMS Footer Navigation Bar (|◀, ◀, 1 of 200, ▶, ▶|, *, Cancel)
 *  - Context Menu matching SSMS with "Thêm dòng mới" (Insert Row)
 *  - Proactive Criteria Builder: Starts empty, user adds columns, chooses operator, enters value
 *  - Live Criteria-to-SQL synchronization
 *  - Confirmation Modal for UPDATE, DELETE, and INSERT with Diff table and SQL preview
 *  - Smart Auto-increment / Identity & Computed column protection on Duplicate and Paste
 *  - Structure-preserving Copy / Paste for NULL and empty cells
 */

(function (window) {
    'use strict';

    const sessions = new Map(); // tabId -> session
    let activeTabId = null;

    // Supported SQL Filter Operators
    const FILTER_OPERATORS = [
        { value: '=', label: '= (Bằng)' },
        { value: '<>', label: '<> (Khác)' },
        { value: 'LIKE', label: 'LIKE (Chứa chuỗi)' },
        { value: 'STARTS_WITH', label: 'Bắt đầu bằng' },
        { value: 'ENDS_WITH', label: 'Kết thúc bằng' },
        { value: '>', label: '> (Lớn hơn)' },
        { value: '>=', label: '>= (Lớn hơn hoặc bằng)' },
        { value: '<', label: '< (Nhỏ hơn)' },
        { value: '<=', label: '<= (Nhỏ hơn hoặc bằng)' },
        { value: 'IS NULL', label: 'IS NULL (Là rỗng)' },
        { value: 'IS NOT NULL', label: 'IS NOT NULL (Không rỗng)' },
        { value: 'IN', label: 'IN (...) (Thuộc danh sách)' },
        { value: 'BETWEEN', label: 'BETWEEN (Trong khoảng)' }
    ];

    // Helper: Escape HTML
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ── 1. Open Table Data Editor Tab ─────────────────────────────────────────
    async function openTable(nodeData) {
        const { name, schema, database, connId, dbType, connName } = nodeData || {};
        if (!name || !connId) return;

        const safeSchema = schema || (dbType === 'postgresql' ? 'public' : 'dbo');
        const quotePrefix = dbType === 'postgresql' ? '"' : '[';
        const quoteSuffix = dbType === 'postgresql' ? '"' : ']';
        const fullTableName = `${quotePrefix}${safeSchema}${quoteSuffix}.${quotePrefix}${name}${quoteSuffix}`;
        const tabTitle = `Edit: ${fullTableName}`;

        // Check if tab already open
        if (window.AppTabs) {
            for (const [tId, s] of sessions.entries()) {
                if (s.connId === connId && s.database === database && s.schema === safeSchema && s.table === name) {
                    window.AppTabs.switchTab(tId);
                    return;
                }
            }
        }

        // Create tab in AppTabs
        const tabId = window.AppTabs.createTab({
            tabType: 'data-editor',
            title: tabTitle,
            icon: 'fa-pen-to-square',
            connectionId: connId,
            connectionName: connName,
            database: database,
            schema: safeSchema,
            dbType: dbType
        });

        // Initialize session object
        const session = {
            tabId,
            connId,
            connName: connName || 'Chưa kết nối',
            database,
            schema: safeSchema,
            table: name,
            dbType: dbType || 'sqlserver',
            metadata: null,
            topN: 200,
            panesVisible: { criteria: false, sql: true, grid: true },
            criteriaRows: [], // Starts empty! User proactively adds filter conditions
            columns: [],
            rows: [],
            originalRows: [],
            dirtyRows: new Map(), // rowIndex -> { originalRow, changes: {}, isNew: bool }
            activeRowIndex: 0,
            activeColIndex: 0,
            selectedRowIndices: new Set(), // Set of selected row indices
            lastClickedRowIndex: 0,
            totalRows: 0,
            currentSql: '',
            autoCommitWithoutConfirm: false,
            // §23 Undo/Redo stack — each entry is a snapshot of {dirtyRows, rows, originalRows, totalRows}
            undoStack: [],
            redoStack: []
        };

        sessions.set(tabId, session);
        activeTabId = tabId;

        // Render loading inside container
        const container = document.getElementById('table-data-editor-container');
        if (container) {
            container.innerHTML = `
                <div class="d-flex flex-column align-items-center justify-content-center h-100 text-muted">
                    <i class="fa-solid fa-circle-notch fa-spin fa-2x mb-3 text-info"></i>
                    <div>Đang tải thông tin cấu trúc và dữ liệu bảng <strong>${esc(fullTableName)}</strong>...</div>
                </div>
            `;
        }

        try {
            // 1. Fetch metadata
            const metaRes = await fetch(`/api/table-data-editor/metadata?conn_id=${encodeURIComponent(connId)}&database=${encodeURIComponent(database || '')}&schema=${encodeURIComponent(safeSchema)}&table=${encodeURIComponent(name)}`);
            const metaJson = await metaRes.json();
            if (!metaJson.success) {
                throw new Error(metaJson.error || 'Không thể lấy thông tin cấu trúc bảng');
            }
            session.metadata = metaJson.metadata;

            // Criteria panel starts empty as requested by user!
            session.criteriaRows = [];

            // 2. Fetch Initial Data
            await refreshData(session);

            // 3. Render UI
            renderSessionUI(session);
        } catch (err) {
            console.error('[TableDataEditor] Init error:', err);
            if (container) {
                container.innerHTML = `
                    <div class="p-4 text-danger">
                        <h5><i class="fa-solid fa-triangle-exclamation me-2"></i>Lỗi khi mở bảng dữ liệu</h5>
                        <p class="small font-monospace">${esc(err.message || String(err))}</p>
                        <button class="btn btn-sm btn-outline-secondary" onclick="window.AppTabs.closeTab('${tabId}')">Đóng tab</button>
                    </div>
                `;
            }
        }
    }

    // ── 2. Refresh Data from Database ─────────────────────────────────────────
    async function refreshData(session) {
        // Build criteria payload for backend
        const criteria = (session.criteriaRows || []).map(r => {
            const mainCond = buildFilterExpr(r.operator, r.value, session.dbType);
            const orCond = buildFilterExpr(r.operator, r.orValue, session.dbType);
            return {
                column: r.column,
                filter: mainCond,
                ors: orCond ? [orCond] : [],
                sort_type: r.sort_type || 'None',
                sort_order: r.sort_order || ''
            };
        }).filter(c => c.column && (c.filter || c.ors.length > 0 || (c.sort_type && c.sort_type !== 'None')));

        const res = await fetch('/api/table-data-editor/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conn_id: session.connId,
                database: session.database,
                schema: session.schema,
                table: session.table,
                select_cols: null, // Select all columns (*)
                criteria: criteria,
                top_n: session.topN,
                custom_sql: session.currentSql || null
            })
        });

        const json = await res.json();
        if (!json.success) {
            throw new Error(json.error || 'Lỗi truy vấn dữ liệu bảng');
        }

        session.columns = json.columns || [];
        session.rows = json.rows || [];
        session.originalRows = JSON.parse(JSON.stringify(json.rows || []));
        session.totalRows = session.rows.length;
        session.dirtyRows.clear();
        session.currentSql = json.sql || '';
        session.activeRowIndex = 0;
        session.activeColIndex = 0;
        session.selectedRowIndices = new Set([0]);
        session.isRowHeaderSelected = false;
        if (session.rowErrors) session.rowErrors.clear();
    }

    // ── 3. Render Session UI (Toolbar, 3 Panes, Footer Nav) ───────────────────
    function renderSessionUI(session) {
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;

        const isCritVisible = session.panesVisible.criteria;
        const isSqlVisible = session.panesVisible.sql;
        const isGridVisible = session.panesVisible.grid;

        container.innerHTML = `
            <!-- Top Toolbar -->
            <div class="tde-toolbar">
                <button class="tde-btn tde-btn--icon" id="tde-btn-table-constraints" title="Xem danh sách ràng buộc của bảng (PK, Unique, FK, Check, Not Null, Sequence)">
                    <i class="fa-solid fa-circle-question"></i>
                </button>
                <span class="tde-vdivider"></span>

                <button class="tde-btn tde-btn--primary" id="tde-btn-execute" title="Execute SQL Query (Alt+X)">
                    <i class="fa-solid fa-play text-warning"></i><span>Execute</span>
                </button>
                <button class="tde-btn tde-btn--success" id="tde-btn-save-all" title="Lưu các thay đổi (Ctrl+S)">
                    <i class="fa-solid fa-floppy-disk"></i><span>Save</span>
                </button>
                <button class="tde-btn" id="tde-btn-discard" title="Hủy bỏ thay đổi chưa lưu & Tải lại">
                    <i class="fa-solid fa-rotate-left"></i><span>Discard</span>
                </button>
                <span class="tde-vdivider"></span>

                <button class="tde-btn tde-btn--success" id="tde-btn-add-row" title="Thêm dòng mới (Ctrl+N)">
                    <i class="fa-solid fa-plus text-success"></i><span>Add Row</span>
                </button>
                <button class="tde-btn tde-btn--danger" id="tde-btn-delete-row" title="Xóa dòng đang chọn (Delete)">
                    <i class="fa-solid fa-trash"></i><span>Delete Row</span>
                </button>
                <button class="tde-btn" id="tde-btn-duplicate-row" title="Thêm bản sao (Duplicate Row)">
                    <i class="fa-solid fa-clone text-info"></i><span>Duplicate</span>
                </button>
                <span class="tde-vdivider"></span>

                <!-- Pane Toggles -->
                <button class="tde-btn ${isCritVisible ? 'active' : ''}" id="tde-toggle-crit" title="Ẩn/Hiện Criteria Pane">
                    <i class="fa-solid fa-filter"></i><span>Criteria</span>
                </button>
                <button class="tde-btn ${isSqlVisible ? 'active' : ''}" id="tde-toggle-sql" title="Ẩn/Hiện SQL Pane">
                    <i class="fa-solid fa-code"></i><span>SQL</span>
                </button>
                <button class="tde-btn ${isGridVisible ? 'active' : ''}" id="tde-toggle-grid" title="Ẩn/Hiện Result Grid Pane">
                    <i class="fa-solid fa-table"></i><span>Grid</span>
                </button>
                <span class="tde-vdivider"></span>

                <!-- Top Limit Selector -->
                <div class="d-flex align-items-center gap-1 ms-1" title="Số dòng tối đa tải về">
                    <span class="text-muted small" style="font-size: 11px;">Top:</span>
                    <select class="tde-criteria-select" id="tde-select-top" style="width: 75px; padding: 2px 4px;">
                        <option value="100" ${session.topN === 100 ? 'selected' : ''}>100</option>
                        <option value="200" ${session.topN === 200 ? 'selected' : ''}>200</option>
                        <option value="500" ${session.topN === 500 ? 'selected' : ''}>500</option>
                        <option value="1000" ${session.topN === 1000 ? 'selected' : ''}>1000</option>
                        <option value="0" ${session.topN === 0 ? 'selected' : ''}>All</option>
                    </select>
                </div>

                <!-- Right Connection / PK Info -->
                <div class="ms-auto d-flex align-items-center gap-2">
                    <span class="tde-badge text-truncate" style="max-width: 220px;" title="Server & Database">
                        <i class="fa-solid fa-plug text-success"></i>${esc(session.connName)} / ${esc(session.database || '—')}
                    </span>
                    <span class="tde-badge" title="${session.metadata?.has_pk ? 'Khóa chính: ' + session.metadata.pk_columns.join(', ') : 'Bảng không có Primary Key'}">
                        <i class="fa-solid fa-key ${session.metadata?.has_pk ? 'text-warning' : 'text-danger'}"></i>
                        ${session.metadata?.has_pk ? session.metadata.pk_columns.join(', ') : 'No PK'}
                    </span>
                </div>
            </div>

            <!-- Main Area -->
            <div class="tde-main-area" id="tde-main-area">
                <!-- 1. Criteria Pane -->
                <div class="tde-pane tde-criteria-pane ${isCritVisible ? '' : 'd-none'}" id="tde-criteria-pane">
                    <div class="tde-pane-header">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-filter text-info"></i>
                            <span>CRITERIA PANE (ĐIỀU KIỆN LỌC & SẮP XẾP)</span>
                            <span class="badge bg-secondary-subtle text-muted" id="tde-crit-count-badge" style="font-size: 10px;">${session.criteriaRows.length} điều kiện</span>
                        </div>
                        <div class="d-flex align-items-center gap-1">
                            <button class="tde-btn tde-btn--sm" id="tde-crit-btn-add" title="Thêm cột muốn lọc">
                                <i class="fa-solid fa-plus text-success"></i><span>Thêm điều kiện</span>
                            </button>
                            <button class="tde-btn tde-btn--sm" id="tde-crit-btn-clear" title="Xóa tất cả điều kiện lọc" ${session.criteriaRows.length === 0 ? 'disabled' : ''}>
                                <i class="fa-solid fa-trash-can text-danger"></i><span>Xóa hết</span>
                            </button>
                        </div>
                    </div>
                    <div class="tde-criteria-table-wrap">
                        ${renderCriteriaTable(session)}
                    </div>
                </div>

                <!-- Splitter 1 -->
                <div class="tde-splitter-h ${isCritVisible && (isSqlVisible || isGridVisible) ? '' : 'd-none'}" id="tde-splitter-1"></div>

                <!-- 2. SQL Pane -->
                <div class="tde-pane tde-sql-pane ${isSqlVisible ? '' : 'd-none'}" id="tde-sql-pane">
                    <div class="tde-pane-header">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-code text-warning"></i>
                            <span>SQL PANE (CÂU TRUY VẤN SQL)</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <span class="small text-muted" style="font-size: 10.5px;">(Đồng bộ tự động từ Criteria hoặc chỉnh sửa trực tiếp)</span>
                        </div>
                    </div>
                    <div class="tde-sql-editor-wrap">
                        <textarea class="tde-sql-textarea" id="tde-sql-text" spellcheck="false">${esc(session.currentSql)}</textarea>
                    </div>
                </div>

                <!-- Splitter 2 -->
                <div class="tde-splitter-h ${isSqlVisible && isGridVisible ? '' : 'd-none'}" id="tde-splitter-2"></div>

                <!-- 3. Result Grid Pane (Occupies 100% of remaining area) -->
                <div class="tde-pane tde-grid-pane ${isGridVisible ? '' : 'd-none'}" id="tde-grid-pane">
                    <div class="tde-filter-active-bar d-none" id="tde-filter-active-bar">
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge bg-warning text-dark"><i class="fa-solid fa-filter me-1"></i>Đang lọc</span>
                            <span class="tde-filter-summary-text" id="tde-filter-summary-text"></span>
                        </div>
                        <button type="button" class="tde-btn-clear-all-filters" id="tde-btn-clear-all-filters" title="Xóa tất cả bộ lọc">
                            <i class="fa-solid fa-xmark me-1"></i>Xóa tất cả lọc
                        </button>
                    </div>
                    <div class="tde-grid-table-wrap" id="tde-grid-table-wrap">
                        ${renderDataGrid(session)}
                    </div>
                </div>
            </div>

            <!-- Footer Navigation Bar -->
            ${renderFooterNav(session)}
        `;

        wireEvents(session, container);
    }

    // ── 4. Render Criteria Table HTML ─────────────────────────────────────────
    function renderCriteriaTable(session) {
        const rows = session.criteriaRows || [];
        const columns = session.metadata?.columns || [];

        if (rows.length === 0) {
            return `
                <div class="d-flex flex-column align-items-center justify-content-center p-3 text-muted" style="height: 100%; min-height: 80px;">
                    <div class="mb-2" style="font-size: 11.5px;">
                        <i class="fa-solid fa-filter me-1 text-info"></i>Chưa có điều kiện lọc nào. Bấm nút <strong>"+ Thêm điều kiện"</strong> để thêm cột và giá trị cần lọc.
                    </div>
                    <button class="tde-btn tde-btn--sm" id="tde-crit-empty-add-btn">
                        <i class="fa-solid fa-plus text-success me-1"></i>Thêm cột muốn lọc
                    </button>
                </div>
            `;
        }

        let html = `
            <table class="tde-criteria-table" id="tde-criteria-table">
                <thead>
                    <tr>
                        <th style="width: 32px; text-align: center;">#</th>
                        <th style="width: 170px;">Cột muốn lọc</th>
                        <th style="width: 170px;">Loại lọc (Operator)</th>
                        <th style="width: 170px;">Giá trị lọc (Filter)</th>
                        <th style="width: 130px;">Hoặc (Or...)</th>
                        <th style="width: 120px;">Sắp xếp (Sort)</th>
                        <th style="width: 65px; text-align: center;">Thứ tự</th>
                        <th style="width: 40px; text-align: center;">Xóa</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach((r, idx) => {
            const isNullOp = (r.operator === 'IS NULL' || r.operator === 'IS NOT NULL');
            html += `
                <tr data-row-idx="${idx}">
                    <td class="text-center text-muted" style="font-size: 10.5px;">${idx + 1}</td>
                    <td>
                        <select class="tde-criteria-select tde-crit-col" data-idx="${idx}">
                            ${columns.map(col => `
                                <option value="${esc(col.name)}" ${r.column === col.name ? 'selected' : ''}>
                                    ${esc(col.name)} (${esc(col.type || '')})
                                </option>
                            `).join('')}
                        </select>
                    </td>
                    <td>
                        <select class="tde-criteria-select tde-crit-op" data-idx="${idx}">
                            ${FILTER_OPERATORS.map(op => `
                                <option value="${op.value}" ${r.operator === op.value ? 'selected' : ''}>
                                    ${esc(op.label)}
                                </option>
                            `).join('')}
                        </select>
                    </td>
                    <td>
                        <input type="text" class="tde-criteria-input tde-crit-val" data-idx="${idx}" 
                            value="${esc(r.value || '')}" 
                            placeholder="${isNullOp ? '(Không cần giá trị)' : 'Nhập giá trị lọc...'}" 
                            ${isNullOp ? 'disabled style="opacity: 0.4;"' : ''}>
                    </td>
                    <td>
                        <input type="text" class="tde-criteria-input tde-crit-or" data-idx="${idx}" 
                            value="${esc(r.orValue || '')}" 
                            placeholder="${isNullOp ? '(Không cần giá trị)' : 'Hoặc giá trị khác...'}" 
                            ${isNullOp ? 'disabled style="opacity: 0.4;"' : ''}>
                    </td>
                    <td>
                        <select class="tde-criteria-select tde-crit-sort" data-idx="${idx}">
                            <option value="None" ${(!r.sort_type || r.sort_type === 'None') ? 'selected' : ''}>Không</option>
                            <option value="ASC" ${r.sort_type === 'ASC' ? 'selected' : ''}>Tăng dần (ASC)</option>
                            <option value="DESC" ${r.sort_type === 'DESC' ? 'selected' : ''}>Giảm dần (DESC)</option>
                        </select>
                    </td>
                    <td>
                        <input type="number" class="tde-criteria-input tde-crit-order text-center" data-idx="${idx}" 
                            value="${esc(r.sort_order || '')}" min="1" max="99" style="width: 50px;">
                    </td>
                    <td class="text-center">
                        <button class="tde-crit-row-del-btn" data-idx="${idx}" title="Xóa điều kiện này">
                            <i class="fa-solid fa-xmark text-danger"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
        return html;
    }

    // Helper: Build filter expression for a row
    function buildFilterExpr(op, val, dbType) {
        if (!op) op = '=';
        val = (val || '').trim();
        if (op === 'IS NULL' || op === 'IS NOT NULL') {
            return op;
        }
        if (!val) return '';

        const isNum = !isNaN(Number(val)) && val !== '';

        if (op === 'LIKE') {
            return `LIKE '%${val.replace(/'/g, "''")}%'`;
        } else if (op === 'STARTS_WITH') {
            return `LIKE '${val.replace(/'/g, "''")}%'`;
        } else if (op === 'ENDS_WITH') {
            return `LIKE '%${val.replace(/'/g, "''")}'`;
        } else if (op === 'IN') {
            return val.startsWith('(') ? `IN ${val}` : `IN (${val})`;
        } else if (op === 'BETWEEN') {
            return `BETWEEN ${val}`;
        } else {
            // =, <>, >, >=, <, <=
            const quotedVal = isNum ? val : `'${val.replace(/'/g, "''")}'`;
            return `${op} ${quotedVal}`;
        }
    }

    // Helpers: Robust Column Attribute Detection (Case-insensitive)
    function isIdentityColumn(session, colName) {
        if (!colName || !session?.metadata) return false;
        const nameLower = String(colName).trim().toLowerCase();
        const idCols = (session.metadata.identity_columns || []).map(c => String(c).trim().toLowerCase());
        if (idCols.includes(nameLower)) return true;
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        return Boolean(colMeta?.is_identity || colMeta?.is_autoincrement || colMeta?.autoincrement);
    }

    function isComputedColumn(session, colName) {
        if (!colName || !session?.metadata) return false;
        const nameLower = String(colName).trim().toLowerCase();
        const compCols = (session.metadata.computed_columns || []).map(c => String(c).trim().toLowerCase());
        if (compCols.includes(nameLower)) return true;
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        return Boolean(colMeta?.is_computed);
    }

    // Sequence column: uses nextval()/NEXT VALUE FOR as default but user CAN edit
    function isSequenceColumn(session, colName) {
        if (!colName || !session?.metadata) return false;
        const nameLower = String(colName).trim().toLowerCase();
        const seqCols = (session.metadata.sequence_columns || []).map(c => String(c).trim().toLowerCase());
        if (seqCols.includes(nameLower)) return true;
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        if (colMeta?.is_sequence) return true;
        const defVal = String(colMeta?.default_value || '').toLowerCase();
        if (defVal.includes('nextval') || defVal.includes('next value for')) return true;
        return false;
    }

    function isPkColumn(session, colName) {
        if (!colName || !session?.metadata) return false;
        const nameLower = String(colName).trim().toLowerCase();
        const pkCols = (session.metadata.pk_columns || []).map(c => String(c).trim().toLowerCase());
        if (pkCols.includes(nameLower)) return true;
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        return Boolean(colMeta?.is_pk);
    }

    function hasDefaultValue(session, colName) {
        if (!colName || !session?.metadata) return false;
        const nameLower = String(colName).trim().toLowerCase();
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        return Boolean(colMeta?.default_value && String(colMeta.default_value).trim().length > 0);
    }

    // Helper: Identify all columns that have UNIQUE properties (uniques, unique indexes, manual PKs)
    // and exclude auto-generated columns (identity, sequence, computed)
    function getUniqueColumnsForDuplicate(session) {
        if (!session?.metadata) return [];
        const meta = session.metadata;
        const uniqueColNames = new Set();

        (meta.uniques || []).forEach(uq => {
            (uq.fields || []).forEach(f => uniqueColNames.add(String(f).trim().toLowerCase()));
        });

        (meta.unique_indexes || []).forEach(ui => {
            (ui.fields || []).forEach(f => uniqueColNames.add(String(f).trim().toLowerCase()));
        });

        // Manual PKs (not identity, not sequence) also have unique constraints
        (meta.pk_columns || []).forEach(pk => {
            const pkLower = String(pk).trim().toLowerCase();
            if (!isIdentityColumn(session, pkLower) && !isSequenceColumn(session, pkLower)) {
                uniqueColNames.add(pkLower);
            }
        });

        return (session.columns || []).filter(col => {
            if (isIdentityColumn(session, col) || isSequenceColumn(session, col) || isComputedColumn(session, col)) {
                return false;
            }
            return uniqueColNames.has(String(col).trim().toLowerCase());
        });
    }

    // rowErrors helpers — multi-constraint per row: Map<rowIdx, Map<constraintKey, errorInfo>>
    function rowErrorsHas(session, rIdx) {
        return session.rowErrors?.has(rIdx) && session.rowErrors.get(rIdx)?.size > 0;
    }

    function rowErrorsGet(session, rIdx) {
        // Return first error for backward compat display
        if (!session.rowErrors?.has(rIdx)) return null;
        const m = session.rowErrors.get(rIdx);
        return m?.size > 0 ? m.values().next().value : null;
    }

    function rowErrorsSet(session, rIdx, constraintKey, errorInfo) {
        if (!session.rowErrors) session.rowErrors = new Map();
        if (!session.rowErrors.has(rIdx)) session.rowErrors.set(rIdx, new Map());
        session.rowErrors.get(rIdx).set(constraintKey, errorInfo);
    }

    function rowErrorsDeleteConstraint(session, rIdx, constraintKey) {
        if (!session.rowErrors?.has(rIdx)) return;
        session.rowErrors.get(rIdx).delete(constraintKey);
        if (session.rowErrors.get(rIdx).size === 0) session.rowErrors.delete(rIdx);
    }

    function rowErrorsClear(session, rIdx) {
        session.rowErrors?.delete(rIdx);
    }

    // Returns Set of cIdx that have errors on this row
    function rowErrorCols(session, rIdx) {
        const errSet = new Set();
        if (!session.rowErrors?.has(rIdx)) return errSet;
        for (const info of session.rowErrors.get(rIdx).values()) {
            if (Array.isArray(info.cIdxList)) info.cIdxList.forEach(i => errSet.add(i));
            else if (info.cIdx != null) errSet.add(info.cIdx);
        }
        return errSet;
    }


    // ── §23 Undo/Redo helpers ─────────────────────────────────────────────────
    const UNDO_LIMIT = 50;

    function pushUndoSnapshot(session) {
        // Deep-clone current mutable state for undo
        const snap = {
            rows: session.rows.map(r => [...r]),
            originalRows: session.originalRows.map(r => [...r]),
            totalRows: session.totalRows,
            dirtyRows: new Map()
        };
        for (const [k, v] of session.dirtyRows.entries()) {
            snap.dirtyRows.set(k, {
                originalRow: v.originalRow ? [...v.originalRow] : null,
                changes: { ...v.changes },
                isNew: v.isNew,
                isDeleted: v.isDeleted
            });
        }
        session.undoStack.push(snap);
        if (session.undoStack.length > UNDO_LIMIT) session.undoStack.shift();
        // Any new edit clears redo stack
        session.redoStack = [];
    }

    function applyUndoSnapshot(session, snap) {
        session.rows = snap.rows.map(r => [...r]);
        session.originalRows = snap.originalRows.map(r => [...r]);
        session.totalRows = snap.totalRows;
        session.dirtyRows = new Map();
        for (const [k, v] of snap.dirtyRows.entries()) {
            session.dirtyRows.set(k, {
                originalRow: v.originalRow ? [...v.originalRow] : null,
                changes: { ...v.changes },
                isNew: v.isNew,
                isDeleted: v.isDeleted
            });
        }
        session.rowErrors = new Map(); // Clear errors after undo
    }

    function triggerUndo(session) {
        if (!session.undoStack || session.undoStack.length === 0) {
            if (typeof showToast === 'function') showToast('Không có hành động nào để Undo.', 'info');
            return;
        }
        // Push current state to redo before undoing
        const currentSnap = {
            rows: session.rows.map(r => [...r]),
            originalRows: session.originalRows.map(r => [...r]),
            totalRows: session.totalRows,
            dirtyRows: new Map()
        };
        for (const [k, v] of session.dirtyRows.entries()) {
            currentSnap.dirtyRows.set(k, { originalRow: v.originalRow ? [...v.originalRow] : null, changes: { ...v.changes }, isNew: v.isNew, isDeleted: v.isDeleted });
        }
        session.redoStack.push(currentSnap);
        const snap = session.undoStack.pop();
        applyUndoSnapshot(session, snap);
        renderSessionUI(session);
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
        if (typeof showToast === 'function') showToast(`Đã Undo. Còn ${session.undoStack.length} bước.`, 'secondary');
    }

    function triggerRedo(session) {
        if (!session.redoStack || session.redoStack.length === 0) {
            if (typeof showToast === 'function') showToast('Không có hành động nào để Redo.', 'info');
            return;
        }
        const currentSnap = {
            rows: session.rows.map(r => [...r]),
            originalRows: session.originalRows.map(r => [...r]),
            totalRows: session.totalRows,
            dirtyRows: new Map()
        };
        for (const [k, v] of session.dirtyRows.entries()) {
            currentSnap.dirtyRows.set(k, { originalRow: v.originalRow ? [...v.originalRow] : null, changes: { ...v.changes }, isNew: v.isNew, isDeleted: v.isDeleted });
        }
        session.undoStack.push(currentSnap);
        const snap = session.redoStack.pop();
        applyUndoSnapshot(session, snap);
        renderSessionUI(session);
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
        if (typeof showToast === 'function') showToast(`Đã Redo. Còn ${session.redoStack.length} bước.`, 'secondary');
    }

    // Helper: Compute minimum width for a column based on its header title & controls
    function getColumnHeaderMinWidth(session, colName) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '600 12px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
        const textWidth = ctx.measureText(colName || '').width;

        // Extra width: left/right padding 14px + filter button 20px + resizer 8px + gap 4px
        let extra = 46;
        const isPk = isPkColumn(session, colName);
        const isIdentity = isIdentityColumn(session, colName);
        const isSeq = isSequenceColumn(session, colName);
        const isComputed = isComputedColumn(session, colName);
        if (isPk || isIdentity || isSeq || isComputed) {
            extra += 18;
        }

        const minW = Math.ceil(textWidth + extra);
        return Math.max(36, minW);
    }

    // Helper: Calculate initial column width (bounded below by header min width)
    function calculateInitialColWidth(session, colName, cIdx) {
        const minW = getColumnHeaderMinWidth(session, colName);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '12px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
        let maxW = minW;
        const rows = session.rows || [];
        const sampleSize = Math.min(rows.length, 30);
        for (let i = 0; i < sampleSize; i++) {
            const val = rows[i]?.[cIdx];
            if (val !== null && val !== undefined) {
                const w = ctx.measureText(String(val)).width + 24;
                if (w > maxW) maxW = w;
            }
        }
        return Math.max(minW, Math.min(Math.ceil(maxW), 280));
    }

    // ── 5. Render Data Grid HTML ──────────────────────────────────────────────
    function renderDataGrid(session) {
        const columns = session.columns || [];
        const rows = session.rows || [];
        const activeRow = session.activeRowIndex;

        session.colWidths = session.colWidths || {};
        columns.forEach((col, cIdx) => {
            const minW = getColumnHeaderMinWidth(session, col);
            if (!session.colWidths[col]) {
                session.colWidths[col] = Math.max(minW, calculateInitialColWidth(session, col, cIdx));
            } else {
                session.colWidths[col] = Math.max(minW, session.colWidths[col]);
            }
        });

        let html = `
            <table class="tde-grid-table" id="tde-grid-table">
                <colgroup>
                    <col style="width: 44px; min-width: 44px; max-width: 44px;">
                    ${columns.map((col, cIdx) => {
                        const minW = getColumnHeaderMinWidth(session, col);
                        const w = session.colWidths[col] || minW;
                        return `<col data-col-idx="${cIdx}" data-col-name="${esc(col)}" style="width: ${w}px; min-width: ${minW}px;">`;
                    }).join('')}
                </colgroup>
                <thead>
                    <tr>
                        <th class="tde-th-rowhead"></th>
        `;

        columns.forEach((col, cIdx) => {
            const isPk = isPkColumn(session, col);
            const isIdentity = isIdentityColumn(session, col);
            const isComputed = isComputedColumn(session, col);
            const isSeq = isSequenceColumn(session, col);
            const minW = getColumnHeaderMinWidth(session, col);
            const w = session.colWidths[col] || minW;
            const thStyle = `width: ${w}px; min-width: ${minW}px;`;
            const thTitle = `${esc(col)}${isPk && !isIdentity && !isSeq ? ' (Primary Key - Khóa chính)' : ''}${isIdentity ? ' (Identity - Tự tăng, chỉ đọc)' : ''}${isSeq ? ' (Sequence - Có thể sửa)' : ''}${isComputed ? ' (Computed - Tính toán, chỉ đọc)' : ''}`;
            const isFiltered = Boolean(session.columnFilters && session.columnFilters[col]);

            html += `
                <th data-col-idx="${cIdx}" data-col-name="${esc(col)}" style="${thStyle}" title="${thTitle}">
                    <div class="tde-th-content">
                        <span class="tde-th-title">
                            ${isPk && !isIdentity && !isSeq ? '<i class="fa-solid fa-key text-warning me-1" style="font-size: 10px;" title="Primary Key"></i>' : ''}
                            ${isIdentity ? '<i class="fa-solid fa-fingerprint text-info me-1" style="font-size: 10px;" title="Identity (Tự tăng)"></i>' : ''}
                            ${isSeq ? '<i class="fa-solid fa-arrow-down-1-9 text-info me-1" style="font-size: 10px;" title="Sequence (Có thể sửa)"></i>' : ''}
                            ${isComputed ? '<i class="fa-solid fa-calculator text-warning me-1" style="font-size: 10px;" title="Computed (Tính toán)"></i>' : ''}
                            <span class="tde-th-name">${esc(col)}</span>
                        </span>
                        <button type="button" class="tde-th-filter-btn ${isFiltered ? 'tde-filter-active' : ''}" data-col-idx="${cIdx}" data-col-name="${esc(col)}" title="Lọc cột [${esc(col)}]">
                            <i class="fa-solid fa-filter"></i>
                        </button>
                    </div>
                    <div class="tde-col-resizer" data-col-name="${esc(col)}" data-col-idx="${cIdx}" title="Kéo để đổi độ rộng, nhấp đúp để tự co giãn"></div>
                </th>
            `;
        });

        html += `
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach((r, rIdx) => {
            const isDirty = session.dirtyRows.has(rIdx);
            const dirtyInfo = session.dirtyRows.get(rIdx);
            const isDeleted = Boolean(dirtyInfo?.isDeleted);
            const isNew = Boolean(dirtyInfo?.isNew);
            const isCurrentActive = (rIdx === activeRow);
            const rowErr = session.rowErrors?.get(rIdx);

            const firstRowErrObj = rowErrorsGet(session, rIdx);
            let rowIndicator = '';
            if (rowErr) {
                rowIndicator = `<i class="fa-solid fa-circle-exclamation text-danger" title="${esc(firstRowErrObj?.error)}" style="font-size: 10px;"></i>`;
            } else if (isCurrentActive) {
                rowIndicator = '<i class="fa-solid fa-play text-primary" style="font-size: 8px;"></i>';
            } else if (isDeleted) {
                rowIndicator = '<i class="fa-solid fa-trash text-danger" style="font-size: 8px;"></i>';
            } else if (isNew) {
                rowIndicator = '<i class="fa-solid fa-plus text-success" style="font-size: 8px;"></i>';
            } else if (isDirty) {
                rowIndicator = '<i class="fa-solid fa-pen text-warning" style="font-size: 8px;"></i>';
            }

            const isSelected = session.selectedRowIndices && session.selectedRowIndices.has(rIdx);
            const rowClasses = [];
            if (isCurrentActive) rowClasses.push('active');
            if (isSelected) rowClasses.push('tde-row-selected');
            if (isDirty) rowClasses.push('tde-row-dirty');
            if (isDeleted) rowClasses.push('tde-row-deleted');
            if (isNew) rowClasses.push('tde-row-new');
            if (rowErr) rowClasses.push('tde-row-error');

            html += `
                <tr data-row-idx="${rIdx}" class="${rowClasses.join(' ')}">
                    <td class="tde-rowhead-cell" data-row-idx="${rIdx}">${rowIndicator}</td>
            `;

            const rowErrCols = rowErrorCols(session, rIdx);
            const firstRowErr = rowErrorsGet(session, rIdx);

            columns.forEach((col, cIdx) => {
                const val = r[cIdx];
                const isCellDirty = isDirty && dirtyInfo?.changes && (col in dirtyInfo.changes);
                const isNull = (val === null || val === undefined);
                const isCellActive = (isCurrentActive && session.activeColIndex === cIdx);
                const isCellError = rowErrCols.has(cIdx);
                const isIdent = isIdentityColumn(session, col);
                const isComp = isComputedColumn(session, col);
                const isSeq = isSequenceColumn(session, col);
                const minW = getColumnHeaderMinWidth(session, col);
                const w = session.colWidths[col] || minW;
                const tdStyle = `width: ${w}px; min-width: ${minW}px; max-width: ${w}px;`;

                const cellClasses = [];
                if (isCellActive) cellClasses.push('tde-cell-active');
                if (isCellError) cellClasses.push('tde-cell-error');

                let displayContent = '';
                let cellTitle = '';

                if (isNew && isIdent) {
                    displayContent = '<span class="tde-auto-tag">&lt;Auto&gt;</span>';
                    cellClasses.push('tde-cell-readonly', 'tde-cell-auto');
                    cellTitle = 'Cột Identity (Tự tăng - CSDL tự sinh khi lưu)';
                } else if (isNew && isComp) {
                    displayContent = '<span class="tde-computed-tag">&lt;Computed&gt;</span>';
                    cellClasses.push('tde-cell-readonly', 'tde-cell-computed');
                    cellTitle = 'Cột Computed (Tính toán - CSDL tự tính khi lưu)';
                } else {
                    if (isIdent || isComp) {
                        cellClasses.push('tde-cell-readonly');
                    }
                    // Sequence icon hint on existing rows
                    if (isSeq && isNull && isNew) {
                        displayContent = '<span class="tde-sequence-tag">&lt;Seq&gt;</span>';
                        cellTitle = 'Cột Sequence — để trống để CSDL tự sinh, hoặc nhập giá trị tùy chỉnh';
                    } else {
                        if (isNull) {
                            cellClasses.push('tde-cell-null');
                            displayContent = 'NULL';
                        } else {
                            displayContent = (val === '' ? '' : esc(val));
                        }
                    }
                    if (isCellDirty) cellClasses.push('tde-cell-dirty');

                    const errMsg = isCellError && firstRowErr ? esc(firstRowErr.error) : '';
                    cellTitle = isCellError
                        ? errMsg
                        : (isCellDirty
                            ? 'Đã sửa. Giá trị gốc: ' + esc(dirtyInfo.originalRow ? dirtyInfo.originalRow[cIdx] : 'NULL')
                            : (isIdent ? esc(val ?? 'NULL') + ' (Identity - Chỉ đọc)'
                                : isComp ? esc(val ?? 'NULL') + ' (Computed - Chỉ đọc)'
                                : isSeq ? esc(val ?? 'NULL') + ' (Sequence - Có thể sửa)'
                                : esc(val ?? 'NULL')));
                }

                if (isCellError && firstRowErr) {
                    displayContent += `<span class="tde-cell-error-badge" title="${esc(firstRowErr.error)}">!</span>`;
                }

                html += `
                    <td class="${cellClasses.join(' ')}" 
                        data-row-idx="${rIdx}" data-col-idx="${cIdx}" data-col-name="${esc(col)}" ${isNew ? 'data-is-new="true"' : ''}
                        style="${tdStyle}"
                        title="${cellTitle}">
                        ${displayContent}
                    </td>
                `;
            });

            html += `</tr>`;
        });

        // Blank template row at bottom (*)
        const isNewRowSelected = session.selectedRowIndices && session.selectedRowIndices.has(rows.length);
        const hasNewRowErr = rowErrorsHas(session, rows.length);
        const firstNewRowErr = rowErrorsGet(session, rows.length);
        const newRowErrCols = rowErrorCols(session, rows.length);
        let starIndicator = hasNewRowErr
            ? `<i class="fa-solid fa-circle-exclamation text-danger" title="${esc(firstNewRowErr?.error)}" style="font-size: 10px;"></i>`
            : '*';

        html += `
            <tr data-row-idx="${rows.length}" class="tde-row-new ${activeRow === rows.length ? 'active' : ''} ${isNewRowSelected ? 'tde-row-selected' : ''} ${hasNewRowErr ? 'tde-row-error' : ''}">
                <td class="tde-rowhead-cell text-success font-monospace fw-bold" data-row-idx="${rows.length}" title="Thêm dòng mới">${starIndicator}</td>
        `;

        columns.forEach((col, cIdx) => {
            const isIdent = isIdentityColumn(session, col);
            const isComp = isComputedColumn(session, col);
            const isSeq = isSequenceColumn(session, col);
            const isCellActive = (activeRow === rows.length && session.activeColIndex === cIdx);
            const isCellError = newRowErrCols.has(cIdx);
            const minW = getColumnHeaderMinWidth(session, col);
            const w = session.colWidths[col] || minW;
            const tdStyle = `width: ${w}px; min-width: ${minW}px; max-width: ${w}px;`;

            const cellClasses = [];
            if (isCellActive) cellClasses.push('tde-cell-active');
            if (isCellError) cellClasses.push('tde-cell-error');

            let displayContent = '';
            let cellTitle = '';
            if (isIdent) {
                displayContent = '<span class="tde-auto-tag">&lt;Auto&gt;</span>';
                cellClasses.push('tde-cell-readonly', 'tde-cell-auto');
                cellTitle = 'Cột Identity (Tự tăng)';
            } else if (isComp) {
                displayContent = '<span class="tde-computed-tag">&lt;Computed&gt;</span>';
                cellClasses.push('tde-cell-readonly', 'tde-cell-computed');
                cellTitle = 'Cột Computed (Tính toán)';
            } else if (isSeq) {
                displayContent = '<span class="tde-sequence-tag">&lt;Seq&gt;</span>';
                cellClasses.push('tde-cell-null', 'text-muted');
                cellTitle = 'Cột Sequence — để trống để tự sinh, hoặc nhập giá trị tùy chỉnh';
            } else {
                displayContent = 'NULL';
                cellClasses.push('tde-cell-null', 'text-muted');
            }

            if (isCellError && firstNewRowErr) {
                displayContent += `<span class="tde-cell-error-badge" title="${esc(firstNewRowErr.error)}">!</span>`;
                cellTitle = esc(firstNewRowErr.error);
            }

            html += `
                <td class="${cellClasses.join(' ')}" 
                    data-row-idx="${rows.length}" data-col-idx="${cIdx}" data-col-name="${esc(col)}" data-is-new="true"
                    style="${tdStyle}"
                    title="${cellTitle}">
                    ${displayContent}
                </td>
            `;
        });

        html += `
                </tr>
            </tbody>
        </table>
        `;
        return html;
    }

    // ── 6. Render Footer Navigation HTML ──────────────────────────────────────
    function renderFooterNav(session) {
        const total = session.totalRows;
        const current = total > 0 ? (session.activeRowIndex + 1) : 0;
        const errCount = session.rowErrors ? session.rowErrors.size : 0;
        const dirtyCount = session.dirtyRows.size;
        const undoCount = session.undoStack ? session.undoStack.length : 0;

        return `
            <div class="tde-footer-nav">
                <div class="tde-nav-group">
                    <button class="tde-nav-btn" id="tde-nav-first" title="First Row" ${current <= 1 ? 'disabled' : ''}><i class="fa-solid fa-backward-step"></i></button>
                    <button class="tde-nav-btn" id="tde-nav-prev" title="Previous Row" ${current <= 1 ? 'disabled' : ''}><i class="fa-solid fa-caret-left"></i></button>
                    <input type="text" class="tde-nav-input" id="tde-nav-current" value="${current}">
                    <span>of ${total}</span>
                    <button class="tde-nav-btn" id="tde-nav-next" title="Next Row" ${current >= total ? 'disabled' : ''}><i class="fa-solid fa-caret-right"></i></button>
                    <button class="tde-nav-btn" id="tde-nav-last" title="Last Row" ${current >= total ? 'disabled' : ''}><i class="fa-solid fa-forward-step"></i></button>
                    <span class="tde-vdivider"></span>
                    <button class="tde-nav-btn" id="tde-nav-new" title="New Row (*) (Ctrl+N)"><i class="fa-solid fa-asterisk text-success"></i></button>
                </div>

                <div class="d-flex align-items-center gap-3">
                    ${dirtyCount > 0 ? `<span class="badge bg-warning text-dark" title="${dirtyCount} dòng chưa lưu"><i class="fa-solid fa-pen me-1"></i>${dirtyCount} chưa lưu</span>` : ''}
                    ${errCount > 0 ? `<span class="badge bg-danger" title="${errCount} dòng đang có lỗi constraint"><i class="fa-solid fa-circle-exclamation me-1"></i>${errCount} lỗi</span>` : ''}
                    ${undoCount > 0 ? `<span class="badge bg-secondary" style="cursor:pointer" id="tde-undo-badge" title="${undoCount} hành động có thể Undo (Ctrl+Z)"><i class="fa-solid fa-rotate-left me-1"></i>${undoCount} undo</span>` : ''}
                    <span>${total} dòng</span>
                </div>
            </div>
        `;
    }

    // ── 7. Wire UI Events ─────────────────────────────────────────────────────
    function wireEvents(session, container) {
        // Table Constraints Popover (?)
        const btnConstraints = container.querySelector('#tde-btn-table-constraints');
        if (btnConstraints) {
            let hoverTimer = null;
            let closeTimer = null;

            const cancelTimers = () => {
                if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
                if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            };

            btnConstraints.addEventListener('mouseenter', () => {
                cancelTimers();
                hoverTimer = setTimeout(() => {
                    const existing = document.getElementById('tde-table-constraints-popover');
                    if (!existing) {
                        showTableConstraintsPopover(session, btnConstraints);
                    }
                }, 180);
            });

            btnConstraints.addEventListener('mouseleave', () => {
                cancelTimers();
                closeTimer = setTimeout(() => {
                    const popover = document.getElementById('tde-table-constraints-popover');
                    if (popover && !popover.matches(':hover') && !btnConstraints.matches(':hover')) {
                        popover.remove();
                    }
                }, 250);
            });

            btnConstraints.addEventListener('click', (e) => {
                e.stopPropagation();
                cancelTimers();
                showTableConstraintsPopover(session, btnConstraints);
            });
        }

        // Execute Button
        container.querySelector('#tde-btn-execute')?.addEventListener('click', () => triggerExecute(session));
        // Save All Button
        container.querySelector('#tde-btn-save-all')?.addEventListener('click', () => triggerSaveAll(session));
        // Discard Button
        container.querySelector('#tde-btn-discard')?.addEventListener('click', () => triggerDiscard(session));
        // Add Row Button
        container.querySelector('#tde-btn-add-row')?.addEventListener('click', () => triggerAddNewRow(session));
        // Delete Row Button
        container.querySelector('#tde-btn-delete-row')?.addEventListener('click', () => triggerDeleteRow(session));
        // Duplicate Row Button
        container.querySelector('#tde-btn-duplicate-row')?.addEventListener('click', () => triggerDuplicateRow(session));

        // Top Limit Selector
        container.querySelector('#tde-select-top')?.addEventListener('change', (e) => {
            session.topN = Number(e.target.value);
            syncSqlFromCriteria(session);
            triggerExecute(session);
        });

        // Pane Toggle Buttons
        container.querySelector('#tde-toggle-crit')?.addEventListener('click', () => togglePane(session, 'criteria'));
        container.querySelector('#tde-toggle-sql')?.addEventListener('click', () => togglePane(session, 'sql'));
        container.querySelector('#tde-toggle-grid')?.addEventListener('click', () => togglePane(session, 'grid'));

        // Splitters Dragging
        setupSplitter(container.querySelector('#tde-splitter-1'), container.querySelector('#tde-criteria-pane'));
        setupSplitter(container.querySelector('#tde-splitter-2'), container.querySelector('#tde-sql-pane'));

        // Criteria Pane Add / Clear buttons
        container.querySelector('#tde-crit-btn-add')?.addEventListener('click', () => addCriteriaRow(session, container));
        container.querySelector('#tde-crit-empty-add-btn')?.addEventListener('click', () => addCriteriaRow(session, container));
        container.querySelector('#tde-crit-btn-clear')?.addEventListener('click', () => {
            session.criteriaRows = [];
            const wrap = container.querySelector('.tde-criteria-table-wrap');
            if (wrap) wrap.innerHTML = renderCriteriaTable(session);
            const countBadge = container.querySelector('#tde-crit-count-badge');
            if (countBadge) countBadge.innerText = '0 điều kiện';
            const clearBtn = container.querySelector('#tde-crit-btn-clear');
            if (clearBtn) clearBtn.disabled = true;
            syncSqlFromCriteria(session);
        });

        // Delegate criteria table events
        const critWrap = container.querySelector('.tde-criteria-table-wrap');
        if (critWrap) {
            critWrap.addEventListener('change', (e) => {
                const target = e.target;
                const idx = Number(target.dataset.idx);
                if (isNaN(idx) || !session.criteriaRows[idx]) return;

                if (target.classList.contains('tde-crit-col')) {
                    session.criteriaRows[idx].column = target.value;
                } else if (target.classList.contains('tde-crit-op')) {
                    session.criteriaRows[idx].operator = target.value;
                    const isNull = (target.value === 'IS NULL' || target.value === 'IS NOT NULL');
                    const tr = target.closest('tr');
                    if (tr) {
                        const valInput = tr.querySelector('.tde-crit-val');
                        const orInput = tr.querySelector('.tde-crit-or');
                        if (valInput) {
                            valInput.disabled = isNull;
                            valInput.style.opacity = isNull ? '0.4' : '1';
                            valInput.placeholder = isNull ? '(Không cần giá trị)' : 'Nhập giá trị lọc...';
                            if (isNull) valInput.value = '';
                        }
                        if (orInput) {
                            orInput.disabled = isNull;
                            orInput.style.opacity = isNull ? '0.4' : '1';
                            orInput.placeholder = isNull ? '(Không cần giá trị)' : 'Hoặc giá trị khác...';
                            if (isNull) orInput.value = '';
                        }
                    }
                } else if (target.classList.contains('tde-crit-sort')) {
                    session.criteriaRows[idx].sort_type = target.value;
                }
                syncSqlFromCriteria(session);
            });

            critWrap.addEventListener('input', (e) => {
                const target = e.target;
                const idx = Number(target.dataset.idx);
                if (isNaN(idx) || !session.criteriaRows[idx]) return;

                if (target.classList.contains('tde-crit-val')) {
                    session.criteriaRows[idx].value = target.value;
                } else if (target.classList.contains('tde-crit-or')) {
                    session.criteriaRows[idx].orValue = target.value;
                } else if (target.classList.contains('tde-crit-order')) {
                    session.criteriaRows[idx].sort_order = target.value;
                }
                syncSqlFromCriteria(session);
            });

            critWrap.addEventListener('click', (e) => {
                const delBtn = e.target.closest('.tde-crit-row-del-btn');
                if (delBtn) {
                    const idx = Number(delBtn.dataset.idx);
                    if (!isNaN(idx) && session.criteriaRows[idx]) {
                        session.criteriaRows.splice(idx, 1);
                        critWrap.innerHTML = renderCriteriaTable(session);
                        const countBadge = container.querySelector('#tde-crit-count-badge');
                        if (countBadge) countBadge.innerText = `${session.criteriaRows.length} điều kiện`;
                        const clearBtn = container.querySelector('#tde-crit-btn-clear');
                        if (clearBtn) clearBtn.disabled = (session.criteriaRows.length === 0);
                        syncSqlFromCriteria(session);
                    }
                }
            });

            critWrap.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    triggerExecute(session);
                }
            });
        }

        // SQL Textarea Direct Editing
        const sqlTextarea = container.querySelector('#tde-sql-text');
        if (sqlTextarea) {
            sqlTextarea.addEventListener('input', (e) => {
                session.currentSql = e.target.value;
            });
            sqlTextarea.addEventListener('keydown', (e) => {
                // Item 5: Alt+X or F5 to execute SQL query
                if ((e.altKey && (e.key === 'x' || e.key === 'X')) || e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                    e.preventDefault();
                    triggerExecute(session);
                }
            });
        }

        // Ctrl+Z Undo / Ctrl+Y Redo (§23) — on container level
        container.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                // Only intercept if no inline editor is active
                if (!container.querySelector('.tde-cell-editor')) {
                    e.preventDefault();
                    triggerUndo(session);
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
                if (!container.querySelector('.tde-cell-editor')) {
                    e.preventDefault();
                    triggerRedo(session);
                }
            }
        }, true);

        // Data Grid Interaction (Selection & Inline Editing)
        setupDataGridEvents(session, container);

        // Footer Navigation Buttons
        container.querySelector('#tde-nav-first')?.addEventListener('click', () => jumpToRow(session, 0));
        container.querySelector('#tde-nav-prev')?.addEventListener('click', () => jumpToRow(session, Math.max(0, session.activeRowIndex - 1)));
        container.querySelector('#tde-nav-next')?.addEventListener('click', () => jumpToRow(session, Math.min(session.rows.length - 1, session.activeRowIndex + 1)));
        container.querySelector('#tde-nav-last')?.addEventListener('click', () => jumpToRow(session, session.rows.length - 1));
        container.querySelector('#tde-nav-new')?.addEventListener('click', () => triggerAddNewRow(session));

        const navCurrentInput = container.querySelector('#tde-nav-current');
        if (navCurrentInput) {
            navCurrentInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const rowNum = Number(e.target.value);
                    if (!isNaN(rowNum) && rowNum >= 1 && rowNum <= session.rows.length) {
                        jumpToRow(session, rowNum - 1);
                    }
                }
            });
        }

        container.tabIndex = 0;
        container.style.outline = 'none';

        // Keyboard shortcuts on container
        container.onkeydown = async (e) => {
            // Item 5: Alt+X or F5 executes SQL query
            if ((e.altKey && (e.key === 'x' || e.key === 'X')) || e.key === 'F5') {
                e.preventDefault();
                e.stopPropagation();
                triggerExecute(session);
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                e.stopPropagation();
                triggerSaveAll(session);
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
                // Item 4: Ctrl+N adds a new row
                e.preventDefault();
                e.stopPropagation();
                triggerAddNewRow(session);
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
                // Ctrl+D duplicates active / selected row(s)
                e.preventDefault();
                e.stopPropagation();
                triggerDuplicateRow(session);
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                // Item 4: Ctrl+C copies row(s) or cell, Ctrl+Shift+C always copies full row
                if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.classList.contains('tde-cell-input')) {
                    if (!document.activeElement?.classList.contains('tde-cell-input') || session.isRowHeaderSelected || e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        const forceRow = e.shiftKey || Boolean(session.isRowHeaderSelected);
                        triggerCopy(session, forceRow);
                    }
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                // Item 4 & 6: Ctrl+V pastes without web dialog
                const isNewRowInput = document.activeElement?.closest('tr')?.dataset?.rowIdx == session.rows.length;
                if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || isNewRowInput || session.isRowHeaderSelected) {
                    e.preventDefault();
                    e.stopPropagation();
                    let clipText = '';
                    if (window.ClipboardBridge && typeof window.ClipboardBridge.readFromClipboard === 'function') {
                        try { clipText = await window.ClipboardBridge.readFromClipboard(); } catch (_) {}
                    }
                    if (!clipText && window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clipboard_text === 'function') {
                        try {
                            const res = await window.pywebview.api.get_clipboard_text();
                            if (res && res.success) clipText = res.text;
                        } catch (_) {}
                    }
                    triggerPaste(session, clipText);
                }
            } else if (e.key === 'Delete' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                e.preventDefault();
                e.stopPropagation();
                triggerDeleteRow(session);
            } else if ((e.key === 'Enter' || e.key === 'F2') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                // Item 3: Enter or F2 to enter edit mode on focused cell
                const activeTd = container.querySelector('#tde-grid-table td.tde-cell-active');
                if (activeTd && !activeTd.classList.contains('tde-rowhead-cell')) {
                    e.preventDefault();
                    e.stopPropagation();
                    startCellEditing(session, activeTd);
                }
            } else if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                // Item 3: Typing printable character enters edit mode on focused cell
                const activeTd = container.querySelector('#tde-grid-table td.tde-cell-active');
                if (activeTd && !activeTd.classList.contains('tde-rowhead-cell')) {
                    e.preventDefault();
                    e.stopPropagation();
                    startCellEditing(session, activeTd, e.key);
                }
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                handleCellNavigation(session, container, e.key, e.shiftKey);
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // Window / Container paste event (native clipboard event, no permission prompt)
        container.addEventListener('paste', (e) => {
            if (e.target.closest('#tde-criteria-pane') || e.target.closest('#tde-sql-pane')) {
                return;
            }
            const clipboardData = e.clipboardData || window.clipboardData;
            const text = clipboardData ? clipboardData.getData('text') : '';
            const isNewRowInput = e.target.closest('tr')?.dataset?.rowIdx == session.rows.length;
            if (text && (!['INPUT', 'TEXTAREA'].includes(e.target.tagName) || isNewRowInput || session.isRowHeaderSelected || text.includes('\n') || text.includes('\t'))) {
                e.preventDefault();
                e.stopPropagation();
                triggerPaste(session, text);
            }
        });

        // Global fallback listener for Ctrl+C, Ctrl+V, Ctrl+D when container is active
        if (session._docKeyDownHandler) {
            document.removeEventListener('keydown', session._docKeyDownHandler);
            session._docKeyDownHandler = null;
        }

        session._docKeyDownHandler = (e) => {
            if (e.defaultPrevented) return;
            if (activeTabId !== session.tabId) return;
            if (document.querySelector('.tde-modal-overlay') || e.target.closest('.modal')) return;
            if (e.target.closest('#tde-criteria-pane') || e.target.closest('#tde-sql-pane')) return;
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !document.activeElement?.classList.contains('tde-cell-input')) return;

            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                if (!document.querySelector('.tde-cell-input') || session.isRowHeaderSelected || e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    const forceRow = e.shiftKey || Boolean(session.isRowHeaderSelected);
                    triggerCopy(session, forceRow);
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                if (!document.querySelector('.tde-cell-input') || session.isRowHeaderSelected) {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerPaste(session);
                }
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
                e.preventDefault();
                e.stopPropagation();
                triggerDuplicateRow(session);
            }
        };
        document.addEventListener('keydown', session._docKeyDownHandler);

        if (session._docPasteHandler) {
            document.removeEventListener('paste', session._docPasteHandler);
            session._docPasteHandler = null;
        }
        session._docPasteHandler = (e) => {
            if (e.defaultPrevented) return;
            if (activeTabId !== session.tabId) return;
            if (e.target.closest('#tde-criteria-pane') || e.target.closest('#tde-sql-pane') || document.querySelector('.tde-modal-overlay')) return;
            if (['INPUT', 'TEXTAREA'].includes(e.target.tagName) && !e.target.classList.contains('tde-cell-input')) return;

            const clipboardData = e.clipboardData || window.clipboardData;
            const text = clipboardData ? clipboardData.getData('text') : '';
            if (text) {
                if (document.querySelector('.tde-cell-input') && !session.isRowHeaderSelected && !text.includes('\n') && !text.includes('\t')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                triggerPaste(session, text);
            }
        };
        document.addEventListener('paste', session._docPasteHandler);
    }

    // Helper: Add new criteria filter row
    function addCriteriaRow(session, container) {
        const defaultCol = session.metadata?.columns?.[0]?.name || '';
        session.criteriaRows.push({
            column: defaultCol,
            operator: '=',
            value: '',
            orValue: '',
            sort_type: 'None',
            sort_order: ''
        });
        const wrap = container.querySelector('.tde-criteria-table-wrap');
        if (wrap) wrap.innerHTML = renderCriteriaTable(session);
        const countBadge = container.querySelector('#tde-crit-count-badge');
        if (countBadge) countBadge.innerText = `${session.criteriaRows.length} điều kiện`;
        const clearBtn = container.querySelector('#tde-crit-btn-clear');
        if (clearBtn) clearBtn.disabled = false;
        syncSqlFromCriteria(session);

        // Focus the value input of newly added row
        setTimeout(() => {
            const inputs = wrap.querySelectorAll('.tde-crit-val');
            if (inputs.length > 0) {
                inputs[inputs.length - 1].focus();
            }
        }, 50);
    }

    // ── 8. Data Grid Events & Inline Editing ──────────────────────────────────
    function setupDataGridEvents(session, container) {
        const gridWrap = container.querySelector('#tde-grid-table-wrap');
        const gridTable = container.querySelector('#tde-grid-table');
        if (!gridTable || !gridWrap) return;

        // Protect inline editing cell: Clicking empty space of the editing cell stays in edit mode without blurring or committing
        gridTable.addEventListener('mousedown', (e) => {
            const td = e.target.closest('td');
            if (td && (td.classList.contains('tde-cell-editing') || td.querySelector('.tde-cell-input'))) {
                if (!e.target.closest('.tde-cell-date-btn') && !e.target.closest('.tde-hidden-native-picker')) {
                    const inp = td.querySelector('.tde-cell-input');
                    if (inp && e.target !== inp) {
                        e.preventDefault();
                        inp.focus();
                        const len = inp.value.length;
                        inp.setSelectionRange(len, len);
                    }
                }
            }
        });

        // Click cell / row header with Multi-Row Selection support
        gridTable.addEventListener('click', (e) => {
            const td = e.target.closest('td');
            if (!td) return;

            // If user clicked inside cell currently being edited, don't steal focus to container or change selection
            if (td.classList.contains('tde-cell-editing') || td.querySelector('.tde-cell-input')) {
                const inp = td.querySelector('.tde-cell-input');
                if (inp && document.activeElement !== inp && !e.target.closest('.tde-cell-date-btn') && !e.target.closest('.tde-hidden-native-picker')) {
                    inp.focus();
                }
                return;
            }

            container.focus({ preventScroll: true });

            const rIdx = Number(td.dataset.rowIdx);
            const cIdx = td.dataset.colIdx !== undefined ? Number(td.dataset.colIdx) : 0;

            // Check if another row is currently in an error state (ignore DUPLICATE_COPY info)
            if (session.rowErrors && session.rowErrors.size > 0) {
                for (const [errRIdx, errMap] of session.rowErrors.entries()) {
                    if (rIdx !== errRIdx && errMap && errMap.size > 0) {
                        const blockingErrors = Array.from(errMap.values()).filter(err => err.type !== 'DUPLICATE_COPY');
                        if (blockingErrors.length > 0) {
                            const errInfo = blockingErrors[0];
                            e.preventDefault();
                            e.stopPropagation();
                            showRowConstraintWarningModal({
                                rowNumber: errRIdx + 1,
                                errorMessage: errInfo.error || errInfo.message,
                                onOk: () => {
                                    const invalidTd = container.querySelector(`#tde-grid-table tr[data-row-idx="${errRIdx}"] td[data-col-idx="${errInfo.cIdx}"]`);
                                    if (invalidTd) {
                                        invalidTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                                        startCellEditing(session, invalidTd);
                                    }
                                }
                            });
                            return;
                        }
                    }
                }
            }

            const isRowHead = td.classList.contains('tde-rowhead-cell');
            session.isRowHeaderSelected = isRowHead;

            session.activeRowIndex = rIdx;
            session.activeColIndex = cIdx;

            if (!session.selectedRowIndices) {
                session.selectedRowIndices = new Set();
            }

            if (e.shiftKey) {
                // Shift+Click on either row header OR normal data cell: Range selection of rows
                const anchor = (session.lastClickedRowIndex !== null && session.lastClickedRowIndex !== undefined)
                    ? session.lastClickedRowIndex
                    : (session.activeRowIndex !== null && session.activeRowIndex !== undefined ? session.activeRowIndex : rIdx);
                session.selectedRowIndices.clear();
                const start = Math.min(anchor, rIdx);
                const end = Math.max(anchor, rIdx);
                for (let i = start; i <= end; i++) {
                    if (i <= session.rows.length) {
                        session.selectedRowIndices.add(i);
                    }
                }
                session.isRowHeaderSelected = true;
            } else if (isRowHead) {
                session.isRowHeaderSelected = true;
                if (e.ctrlKey || e.metaKey) {
                    // Ctrl+Click on row header: Toggle selection of this row
                    if (session.selectedRowIndices.has(rIdx)) {
                        session.selectedRowIndices.delete(rIdx);
                        if (session.selectedRowIndices.size === 0) {
                            session.selectedRowIndices.add(rIdx);
                        }
                    } else {
                        session.selectedRowIndices.add(rIdx);
                    }
                    session.lastClickedRowIndex = rIdx;
                } else {
                    // Normal click on row header: single row selection
                    session.selectedRowIndices.clear();
                    session.selectedRowIndices.add(rIdx);
                    session.lastClickedRowIndex = rIdx;
                }
            } else {
                // Click on any normal data cell: ALWAYS select only this single row
                // (even if Ctrl is held down by user preparing to press Ctrl+C)
                session.selectedRowIndices.clear();
                session.selectedRowIndices.add(rIdx);
                session.lastClickedRowIndex = rIdx;
                session.isRowHeaderSelected = false;
            }

            // Highlight active row, selected rows & cell
            updateActiveHighlight(session, container);
        });

        // Column Resizing & Auto-fit via .tde-col-resizer
        gridTable.querySelectorAll('.tde-col-resizer').forEach(resizer => {
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const th = resizer.closest('th');
                if (!th) return;
                const colName = resizer.dataset.colName;
                const cIdx = Number(resizer.dataset.colIdx);
                const startX = e.clientX;
                const startWidth = th.offsetWidth;
                resizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                function onMouseMove(moveE) {
                    const diff = moveE.clientX - startX;
                    const minW = getColumnHeaderMinWidth(session, colName);
                    const newW = Math.max(minW, startWidth + diff);
                    th.style.width = newW + 'px';
                    th.style.minWidth = minW + 'px';
                    th.style.maxWidth = newW + 'px';
                    container.querySelectorAll(`#tde-grid-table col[data-col-idx="${cIdx}"]`).forEach(colEl => {
                        colEl.style.width = newW + 'px';
                        colEl.style.minWidth = minW + 'px';
                        colEl.style.maxWidth = newW + 'px';
                    });
                    container.querySelectorAll(`#tde-grid-table td[data-col-idx="${cIdx}"]`).forEach(td => {
                        td.style.width = newW + 'px';
                        td.style.minWidth = minW + 'px';
                        td.style.maxWidth = newW + 'px';
                    });
                }

                function onMouseUp(upE) {
                    resizer.classList.remove('resizing');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);

                    const minW = getColumnHeaderMinWidth(session, colName);
                    const finalW = Math.max(minW, startWidth + (upE.clientX - startX));
                    session.colWidths = session.colWidths || {};
                    session.colWidths[colName] = finalW;
                }

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            });

            // Item 2: Double click resizer auto-fits to longest content of column
            resizer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const colName = resizer.dataset.colName;
                const cIdx = Number(resizer.dataset.colIdx);
                const th = resizer.closest('th');
                autoFitColumn(session, colName, cIdx, th, container);
            });
        });

        // Column Filter button clicks in headers
        gridTable.querySelectorAll('.tde-th-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const colName = btn.dataset.colName;
                const cIdx = Number(btn.dataset.colIdx);
                showColumnFilterPopover(session, colName, cIdx, btn, container);
            });
        });

        // Active filters banner - Clear all filters button
        const clearAllFiltersBtn = container.querySelector('#tde-btn-clear-all-filters');
        if (clearAllFiltersBtn) {
            clearAllFiltersBtn.addEventListener('click', (e) => {
                e.preventDefault();
                session.columnFilters = {};
                applyColumnFilters(session, container);
            });
        }

        // Double click to edit cell
        gridTable.addEventListener('dblclick', (e) => {
            const td = e.target.closest('td');
            if (!td || td.classList.contains('tde-rowhead-cell')) return;
            startCellEditing(session, td);
        });

        // Right-click context menu
        gridTable.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const td = e.target.closest('td');
            if (td) {
                const isRowHead = td.classList.contains('tde-rowhead-cell');
                session.isRowHeaderSelected = isRowHead;

                const rIdx = Number(td.dataset.rowIdx);
                const cIdx = td.dataset.colIdx !== undefined ? Number(td.dataset.colIdx) : 0;
                session.activeRowIndex = rIdx;
                session.activeColIndex = cIdx;

                if (!session.selectedRowIndices) session.selectedRowIndices = new Set();
                if (!isRowHead || !session.selectedRowIndices.has(rIdx)) {
                    session.selectedRowIndices.clear();
                    session.selectedRowIndices.add(rIdx);
                    session.lastClickedRowIndex = rIdx;
                }
                updateActiveHighlight(session, container);
            }
            showContextMenu(session, e.clientX, e.clientY);
        });

        // Re-apply any existing active column filters on grid setup
        applyColumnFilters(session, container);
    }

    // ── Column Filtering Helpers ──────────────────────────────────────────────
    function checkFilterMatch(val, filterRule) {
        if (!filterRule) return true;

        const isValNull = (val === null || val === undefined);
        const strVal = isValNull ? '(Trống / NULL)' : String(val);

        // 1. Checklist check (filter by values)
        if (filterRule.selectedValues && (filterRule.selectedValues instanceof Set)) {
            if (!filterRule.selectedValues.has(strVal)) {
                return false;
            }
        }

        // 2. Operator check (condition filter)
        const op = filterRule.operator;
        if (op && op !== 'none') {
            const targetVal = (filterRule.value !== undefined && filterRule.value !== null) ? String(filterRule.value).trim().toLowerCase() : '';
            const cellEmpty = isValNull || String(val).trim() === '';

            if (op === 'is_null') {
                if (!cellEmpty) return false;
            } else if (op === 'is_not_null') {
                if (cellEmpty) return false;
            } else {
                if (cellEmpty && op !== 'not_equals' && op !== 'not_contains') {
                    return false;
                }
                const cellStr = isValNull ? '' : String(val).toLowerCase();
                if (op === 'contains') {
                    if (!cellStr.includes(targetVal)) return false;
                } else if (op === 'not_contains') {
                    if (cellStr.includes(targetVal)) return false;
                } else if (op === 'equals') {
                    if (cellStr !== targetVal) return false;
                } else if (op === 'not_equals') {
                    if (cellStr === targetVal) return false;
                } else if (op === 'starts_with') {
                    if (!cellStr.startsWith(targetVal)) return false;
                } else if (op === 'ends_with') {
                    if (!cellStr.endsWith(targetVal)) return false;
                } else if (op === 'gt') {
                    const numVal = parseFloat(val);
                    const numTarget = parseFloat(targetVal);
                    if (isNaN(numVal) || isNaN(numTarget) || !(numVal > numTarget)) return false;
                } else if (op === 'lt') {
                    const numVal = parseFloat(val);
                    const numTarget = parseFloat(targetVal);
                    if (isNaN(numVal) || isNaN(numTarget) || !(numVal < numTarget)) return false;
                }
            }
        }

        return true;
    }

    function applyColumnFilters(session, container) {
        if (!container) container = document.getElementById('table-data-editor-container');
        if (!container) return;

        session.columnFilters = session.columnFilters || {};
        const filterKeys = Object.keys(session.columnFilters).filter(k => {
            const f = session.columnFilters[k];
            if (!f) return false;
            const hasOp = f.operator && f.operator !== 'none' && (
                f.operator === 'is_null' || f.operator === 'is_not_null' || (f.value !== undefined && f.value !== '')
            );
            const hasValFilter = Boolean(f.selectedValues && f.isFilteredByValues);
            return hasOp || hasValFilter;
        });

        // Update header filter button icons
        container.querySelectorAll('.tde-th-filter-btn').forEach(btn => {
            const colName = btn.dataset.colName;
            if (filterKeys.includes(colName)) {
                btn.classList.add('tde-filter-active');
                btn.title = `Cột [${colName}] đang được lọc. Nhấp để xem/sửa lọc.`;
            } else {
                btn.classList.remove('tde-filter-active');
                btn.title = `Lọc cột [${colName}]`;
            }
        });

        const rows = session.rows || [];
        const columns = session.columns || [];
        let hiddenCount = 0;

        const trs = container.querySelectorAll('#tde-grid-table tbody tr[data-row-idx]');
        trs.forEach(tr => {
            const rIdx = Number(tr.dataset.rowIdx);
            // Do not hide template new row (*)
            if (rIdx >= rows.length) return;

            const rowData = rows[rIdx];
            if (!rowData) return;

            let match = true;
            for (const colName of filterKeys) {
                const cIdx = columns.indexOf(colName);
                if (cIdx === -1) continue;
                const filterRule = session.columnFilters[colName];
                const val = rowData[cIdx];
                if (!checkFilterMatch(val, filterRule)) {
                    match = false;
                    break;
                }
            }

            if (match) {
                tr.classList.remove('tde-row-filtered-out');
            } else {
                tr.classList.add('tde-row-filtered-out');
                hiddenCount++;
            }
        });

        updateFilterStatusBanner(session, container, filterKeys, hiddenCount);
    }

    function updateFilterStatusBanner(session, container, filterKeys, hiddenCount) {
        const banner = container.querySelector('#tde-filter-active-bar');
        if (!banner) return;

        if (!filterKeys || filterKeys.length === 0) {
            banner.classList.add('d-none');
            banner.style.display = 'none';
            return;
        }

        banner.classList.remove('d-none');
        banner.style.display = 'flex';
        const descSpan = banner.querySelector('#tde-filter-summary-text');
        if (descSpan) {
            const colsStr = filterKeys.map(c => `<b>[${esc(c)}]</b>`).join(', ');
            const total = (session.rows || []).length;
            const shown = total - hiddenCount;
            descSpan.innerHTML = `Đang lọc theo cột ${colsStr}: hiển thị <b>${shown}</b> / ${total} dòng (ẩn <b>${hiddenCount}</b> dòng)`;
        }
    }

    function showColumnFilterPopover(session, colName, cIdx, btn, container) {
        const existing = document.getElementById('tde-col-filter-popover');
        if (existing) {
            const sameCol = existing.dataset.colName === colName;
            existing.remove();
            if (sameCol) return;
        }

        session.columnFilters = session.columnFilters || {};
        const currentFilter = session.columnFilters[colName] || {
            operator: 'none',
            value: '',
            selectedValues: null,
            isFilteredByValues: false
        };

        // Extract distinct values and counts
        const rows = session.rows || [];
        const valueCounts = new Map();
        let nullCount = 0;
        rows.forEach(r => {
            const val = r[cIdx];
            if (val === null || val === undefined) {
                nullCount++;
            } else {
                const s = String(val);
                valueCounts.set(s, (valueCounts.get(s) || 0) + 1);
            }
        });

        // Sorted unique values list
        const distinctValues = Array.from(valueCounts.keys()).sort((a, b) => {
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });

        // Build list data model
        const allDistinctList = [];
        if (nullCount > 0) {
            allDistinctList.push({
                val: '(Trống / NULL)',
                label: '(Trống / NULL)',
                isNull: true,
                count: nullCount
            });
        }
        distinctValues.forEach(val => {
            allDistinctList.push({
                val: val,
                label: val,
                isNull: false,
                count: valueCounts.get(val) || 1
            });
        });

        const allDistinctCount = allDistinctList.length;

        // Selected values set in memory
        const checkedSet = new Set();
        if (currentFilter.selectedValues && (currentFilter.selectedValues instanceof Set)) {
            currentFilter.selectedValues.forEach(v => checkedSet.add(v));
        } else {
            allDistinctList.forEach(item => checkedSet.add(item.val));
        }

        const popover = document.createElement('div');
        popover.id = 'tde-col-filter-popover';
        popover.className = 'tde-col-filter-popover';
        popover.dataset.colName = colName;
        popover.dataset.colIdx = cIdx;

        popover.innerHTML = `
            <div class="tde-cfp-header">
                <div class="d-flex align-items-center gap-1 text-truncate">
                    <i class="fa-solid fa-filter text-primary" style="font-size: 11px;"></i>
                    <span class="text-truncate">Lọc: <b>${esc(colName)}</b></span>
                </div>
                <button type="button" class="tde-cfp-close-btn" title="Đóng">&times;</button>
            </div>
            <div class="tde-cfp-body">
                <div class="tde-cfp-section-title">Lọc theo điều kiện</div>
                <select class="tde-cfp-operator-select">
                    <option value="none" ${currentFilter.operator === 'none' ? 'selected' : ''}>-- Không lọc điều kiện --</option>
                    <option value="contains" ${currentFilter.operator === 'contains' ? 'selected' : ''}>Chứa...</option>
                    <option value="not_contains" ${currentFilter.operator === 'not_contains' ? 'selected' : ''}>Không chứa...</option>
                    <option value="equals" ${currentFilter.operator === 'equals' ? 'selected' : ''}>Bằng (=)...</option>
                    <option value="not_equals" ${currentFilter.operator === 'not_equals' ? 'selected' : ''}>Khác (&lt;&gt;)...</option>
                    <option value="starts_with" ${currentFilter.operator === 'starts_with' ? 'selected' : ''}>Bắt đầu bằng...</option>
                    <option value="ends_with" ${currentFilter.operator === 'ends_with' ? 'selected' : ''}>Kết thúc bằng...</option>
                    <option value="gt" ${currentFilter.operator === 'gt' ? 'selected' : ''}>Lớn hơn (&gt;)...</option>
                    <option value="lt" ${currentFilter.operator === 'lt' ? 'selected' : ''}>Nhỏ hơn (&lt;)...</option>
                    <option value="is_null" ${currentFilter.operator === 'is_null' ? 'selected' : ''}>Rỗng (IS NULL)</option>
                    <option value="is_not_null" ${currentFilter.operator === 'is_not_null' ? 'selected' : ''}>Không rỗng (NOT NULL)</option>
                </select>
                <input type="text" class="tde-cfp-input" placeholder="Giá trị lọc..." value="${esc(currentFilter.value || '')}"
                    style="${(currentFilter.operator === 'none' || currentFilter.operator === 'is_null' || currentFilter.operator === 'is_not_null') ? 'display: none;' : ''}">

                <div class="tde-cfp-section-title mt-2">Lọc theo danh sách giá trị</div>
                <input type="text" class="tde-cfp-search-input" placeholder="Tìm kiếm trong danh sách...">
                <div class="d-flex align-items-center justify-content-between px-1" style="font-size: 11px;">
                    <label class="d-flex align-items-center gap-1" style="cursor: pointer;">
                        <input type="checkbox" id="tde-cfp-select-all">
                        <span>(Chọn tất cả)</span>
                    </label>
                    <span class="text-muted fw-semibold" id="tde-cfp-count-label">0/0</span>
                </div>
                <div class="tde-cfp-values-list"></div>
            </div>
            <div class="tde-cfp-footer">
                <button type="button" class="btn btn-sm btn-outline-secondary" id="tde-cfp-clear-btn" style="font-size: 11px; padding: 2px 8px;">Xóa lọc</button>
                <div class="d-flex align-items-center gap-2">
                    <button type="button" class="btn btn-sm btn-secondary" id="tde-cfp-cancel-btn" style="font-size: 11px; padding: 2px 8px;">Hủy</button>
                    <button type="button" class="btn btn-sm btn-primary" id="tde-cfp-apply-btn" style="font-size: 11px; padding: 2px 10px;">Áp dụng</button>
                </div>
            </div>
        `;

        document.body.appendChild(popover);

        // Position popover relative to button
        const rect = btn.getBoundingClientRect();
        let top = rect.bottom + window.scrollY + 4;
        let left = rect.left + window.scrollX - 120;
        const popoverWidth = 310;

        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }
        if (left < 10) left = 10;

        popover.style.top = top + 'px';
        popover.style.left = left + 'px';
        popover.style.width = popoverWidth + 'px';

        // Interactive elements
        const opSelect = popover.querySelector('.tde-cfp-operator-select');
        const valInput = popover.querySelector('.tde-cfp-input');
        const searchInput = popover.querySelector('.tde-cfp-search-input');
        const selectAllCb = popover.querySelector('#tde-cfp-select-all');
        const countLabel = popover.querySelector('#tde-cfp-count-label');
        const valuesList = popover.querySelector('.tde-cfp-values-list');
        const applyBtn = popover.querySelector('#tde-cfp-apply-btn');
        const clearBtn = popover.querySelector('#tde-cfp-clear-btn');
        const cancelBtn = popover.querySelector('#tde-cfp-cancel-btn');
        const closeBtn = popover.querySelector('.tde-cfp-close-btn');

        // Lazy load parameters
        const PAGE_SIZE = 40;
        let activeFilteredList = allDistinctList;
        let renderedCount = 0;

        function renderNextBatch() {
            if (renderedCount >= activeFilteredList.length) {
                const oldSentinel = valuesList.querySelector('.tde-cfp-lazy-sentinel');
                if (oldSentinel) oldSentinel.remove();
                return;
            }

            const nextBatch = activeFilteredList.slice(renderedCount, renderedCount + PAGE_SIZE);
            const fragment = document.createDocumentFragment();

            nextBatch.forEach(item => {
                const label = document.createElement('label');
                label.className = 'tde-cfp-item';
                label.title = item.label;

                const isChecked = checkedSet.has(item.val);
                const nullClass = item.isNull ? 'fst-italic text-muted' : '';

                label.innerHTML = `
                    <input type="checkbox" class="tde-cfp-val-cb" data-val="${esc(item.val)}" ${isChecked ? 'checked' : ''}>
                    <span class="tde-cfp-text ${nullClass}">${esc(item.label)}</span>
                    <span class="tde-cfp-count-badge">${item.count}</span>
                `;
                fragment.appendChild(label);
            });

            const oldSentinel = valuesList.querySelector('.tde-cfp-lazy-sentinel');
            if (oldSentinel) {
                valuesList.insertBefore(fragment, oldSentinel);
            } else {
                valuesList.appendChild(fragment);
            }

            renderedCount += nextBatch.length;

            // Update or remove sentinel indicator at bottom
            let sentinel = valuesList.querySelector('.tde-cfp-lazy-sentinel');
            if (renderedCount < activeFilteredList.length) {
                if (!sentinel) {
                    sentinel = document.createElement('div');
                    sentinel.className = 'tde-cfp-lazy-sentinel';
                    sentinel.addEventListener('click', () => renderNextBatch());
                    valuesList.appendChild(sentinel);
                }
                sentinel.textContent = `Hiển thị ${renderedCount}/${activeFilteredList.length} — cuộn để tải thêm...`;
            } else if (sentinel) {
                sentinel.remove();
            }
        }

        function resetAndRenderList() {
            valuesList.innerHTML = '';
            renderedCount = 0;
            if (activeFilteredList.length === 0) {
                valuesList.innerHTML = '<div class="text-muted text-center py-3" style="font-size: 11px;">Không tìm thấy kết quả</div>';
            } else {
                renderNextBatch();
            }
            updateSelectAllUI();
        }

        function updateSelectAllUI() {
            const totalAll = allDistinctList.length;
            const checkedTotal = checkedSet.size;
            countLabel.textContent = `${checkedTotal}/${totalAll}`;

            const activeTotal = activeFilteredList.length;
            let activeCheckedCount = 0;
            activeFilteredList.forEach(item => {
                if (checkedSet.has(item.val)) activeCheckedCount++;
            });

            if (activeCheckedCount === activeTotal && activeTotal > 0) {
                selectAllCb.checked = true;
                selectAllCb.indeterminate = false;
            } else if (activeCheckedCount === 0) {
                selectAllCb.checked = false;
                selectAllCb.indeterminate = false;
            } else {
                selectAllCb.checked = false;
                selectAllCb.indeterminate = true;
            }
        }

        // Infinite scroll lazy load event
        valuesList.addEventListener('scroll', () => {
            if (valuesList.scrollTop + valuesList.clientHeight >= valuesList.scrollHeight - 35) {
                if (renderedCount < activeFilteredList.length) {
                    renderNextBatch();
                }
            }
        });

        // Initial render
        resetAndRenderList();

        // Operator dropdown change
        opSelect.addEventListener('change', () => {
            const op = opSelect.value;
            if (op === 'none' || op === 'is_null' || op === 'is_not_null') {
                valInput.style.display = 'none';
            } else {
                valInput.style.display = 'block';
                valInput.focus();
            }
        });

        // Search values list
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase().trim();
            if (!q) {
                activeFilteredList = allDistinctList;
            } else {
                activeFilteredList = allDistinctList.filter(item => item.label.toLowerCase().includes(q));
            }
            resetAndRenderList();
        });

        // Toggle Select All
        selectAllCb.addEventListener('change', () => {
            const shouldCheck = selectAllCb.checked;
            activeFilteredList.forEach(item => {
                if (shouldCheck) {
                    checkedSet.add(item.val);
                } else {
                    checkedSet.delete(item.val);
                }
            });
            valuesList.querySelectorAll('.tde-cfp-val-cb').forEach(cb => {
                cb.checked = shouldCheck;
            });
            updateSelectAllUI();
        });

        // Checkbox click in values list
        valuesList.addEventListener('change', (e) => {
            if (e.target.classList.contains('tde-cfp-val-cb')) {
                const val = e.target.dataset.val;
                if (e.target.checked) {
                    checkedSet.add(val);
                } else {
                    checkedSet.delete(val);
                }
                updateSelectAllUI();
            }
        });

        // Popover close handlers
        const closePopover = () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onDocKeyDown);
            popover.remove();
        };

        const onDocMouseDown = (e) => {
            if (!popover.contains(e.target) && !btn.contains(e.target)) {
                closePopover();
            }
        };

        const onDocKeyDown = (e) => {
            if (e.key === 'Escape') {
                closePopover();
            } else if (e.key === 'Enter' && (e.target === valInput || e.target === searchInput)) {
                e.preventDefault();
                applyBtn.click();
            }
        };

        setTimeout(() => {
            document.addEventListener('mousedown', onDocMouseDown);
            document.addEventListener('keydown', onDocKeyDown);
        }, 10);

        closeBtn.addEventListener('click', closePopover);
        cancelBtn.addEventListener('click', closePopover);

        clearBtn.addEventListener('click', () => {
            if (session.columnFilters && session.columnFilters[colName]) {
                delete session.columnFilters[colName];
                applyColumnFilters(session, container);
            }
            closePopover();
        });

        applyBtn.addEventListener('click', () => {
            const op = opSelect.value;
            const val = valInput.value.trim();

            const isFilteredByValues = checkedSet.size < allDistinctCount;

            const isConditionActive = (op !== 'none') && (
                op === 'is_null' || op === 'is_not_null' || val !== ''
            );

            if (!isConditionActive && !isFilteredByValues) {
                // No active filter
                if (session.columnFilters) {
                    delete session.columnFilters[colName];
                }
            } else {
                session.columnFilters = session.columnFilters || {};
                session.columnFilters[colName] = {
                    operator: op,
                    value: val,
                    selectedValues: checkedSet,
                    isFilteredByValues: isFilteredByValues
                };
            }

            applyColumnFilters(session, container);
            closePopover();
        });
    }

    // Helper: Clean raw SQL error message (remove ODBC / driver / provider tags)
    function cleanSqlErrorMessage(err) {
        if (!err) return 'Lỗi cơ sở dữ liệu không xác định.';
        let s = String(err);
        s = s.replace(/\[Microsoft\]\[ODBC Driver \d+ for SQL Server\](\[SQL Server\])?/gi, '');
        s = s.replace(/\[ODBC SQL Server Driver\](\[SQL Server\])?/gi, '');
        s = s.replace(/\[SQL Server\]/gi, '');
        s = s.replace(/Error Source:[^\n\r]+/gi, '');
        s = s.replace(/\(\d+\)\s*\([A-Za-z0-9_]+\).*$/g, '');
        s = s.replace(/^ERROR:\s*/i, '');
        return s.trim();
    }

    // Helper: Apply error styling to ALL cells in a constraint violation (supports composite keys)
    function applyErrorToRow(session, triggerTd, rIdx, cIdxList, errInfo) {
        const container = document.getElementById('table-data-editor-container');
        const tr = triggerTd?.closest('tr') || container?.querySelector(`#tde-grid-table tr[data-row-idx="${rIdx}"]`);
        if (!tr) return;

        tr.classList.add('tde-row-error');

        // Tô đỏ từng ô trong danh sách
        cIdxList.forEach(ci => {
            const cell = tr.querySelector(`td[data-col-idx="${ci}"]`);
            if (!cell) return;
            cell.classList.add('tde-cell-error');
            cell.classList.remove('tde-cell-null');
            // Preserve text content, add badge if not present
            if (!cell.querySelector('.tde-cell-error-badge')) {
                const badge = document.createElement('span');
                badge.className = 'tde-cell-error-badge';
                badge.title = errInfo.error;
                badge.textContent = '!';
                cell.appendChild(badge);
            }
            cell.title = errInfo.error;
        });

        // Update row header indicator
        const rowHead = tr.querySelector('.tde-rowhead-cell');
        if (rowHead) {
            rowHead.innerHTML = `<i class="fa-solid fa-circle-exclamation text-danger" title="${esc(errInfo.error)}" style="font-size: 10px;"></i>`;
        }
    }

    // Helper: Popover tóm tắt toàn bộ Constraints của Bảng
    function showTableConstraintsPopover(session, buttonEl) {
        const existing = document.getElementById('tde-table-constraints-popover');
        if (existing) {
            existing.remove();
            return;
        }

        const meta = session?.metadata || {};
        const tableName = `${session.schema || 'dbo'}.${session.table || 'Table'}`;
        const cols = meta.columns || [];

        // 1. Primary Key
        const pkCols = meta.pk_columns || cols.filter(c => c.is_pk).map(c => c.name);

        // 2. Uniques & Unique Indexes
        const uniques = meta.uniques || [];
        const uniqueIndexes = meta.unique_indexes || [];

        // 3. Foreign Keys
        const foreignKeys = meta.foreign_keys || [];

        // 4. Checks
        const checks = meta.checks || [];

        // 5. Sequence & Identity & Computed
        const seqCols = meta.sequence_columns || cols.filter(c => c.is_sequence).map(c => c.name);
        const identCols = meta.identity_columns || cols.filter(c => c.is_identity).map(c => c.name);
        const compCols = meta.computed_columns || cols.filter(c => c.is_computed).map(c => c.name);

        // 6. NOT NULL columns (without default / identity / sequence / computed)
        const notNullCols = cols.filter(c => {
            const isNullable = c.nullable ?? c.is_nullable ?? true;
            return !isNullable && !c.is_identity && !c.is_sequence && !c.is_computed && !c.default_value;
        }).map(c => c.name);

        let sectionsHtml = '';

        // Section: PK
        if (pkCols.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-key text-warning"></i><span>Khóa chính (Primary Key)</span>
                    </div>
                    <div class="tde-constraint-item">
                        <div class="tde-constraint-item-top">
                            <span class="tde-constraint-name">PK_${esc(session.table || 'Table')}</span>
                            <span class="tde-constraint-pill tde-constraint-pill--pk">PRIMARY KEY</span>
                        </div>
                        <div class="tde-constraint-cols">Cột: ${pkCols.map(c => `<code>${esc(c)}</code>`).join(', ')}</div>
                    </div>
                </div>
            `;
        }

        // Section: Unique Keys / Indexes
        const allUniques = [...uniques];
        uniqueIndexes.forEach(ui => {
            if (!allUniques.some(u => JSON.stringify(u.fields || []) === JSON.stringify(ui.fields || []))) {
                allUniques.push({ name: ui.name, fields: ui.fields, is_index: true });
            }
        });

        if (allUniques.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-fingerprint text-info"></i><span>Ràng buộc duy nhất (Unique)</span>
                    </div>
                    ${allUniques.map(u => {
                        const fields = u.fields || [];
                        const isComp = fields.length > 1;
                        return `
                            <div class="tde-constraint-item">
                                <div class="tde-constraint-item-top">
                                    <span class="tde-constraint-name">${esc(u.name || 'UQ_' + (session.table || 'Table'))}</span>
                                    <span class="tde-constraint-pill tde-constraint-pill--uq">${isComp ? 'COMPOSITE UNIQUE' : 'UNIQUE'}</span>
                                </div>
                                <div class="tde-constraint-cols">Cột: ${fields.map(c => `<code>${esc(c)}</code>`).join(', ')}${isComp ? ' <span class="text-warning small">(Yêu cầu nhập đủ cả bộ)</span>' : ''}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // Section: Foreign Keys
        if (foreignKeys.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-link text-primary"></i><span>Khóa ngoại (Foreign Keys)</span>
                    </div>
                    ${foreignKeys.map(fk => {
                        const fCols = (fk.fields || []).map(esc).join(', ');
                        const rTable = `${fk.ref_schema ? esc(fk.ref_schema) + '.' : ''}${esc(fk.ref_table || '')}`;
                        const rCols = (fk.ref_fields || []).map(esc).join(', ');
                        return `
                            <div class="tde-constraint-item">
                                <div class="tde-constraint-item-top">
                                    <span class="tde-constraint-name">${esc(fk.name || 'FK_' + (session.table || 'Table'))}</span>
                                    <span class="tde-constraint-pill tde-constraint-pill--fk">FOREIGN KEY</span>
                                </div>
                                <div class="tde-constraint-cols">
                                    <code>${fCols}</code> &rarr; <strong>${rTable}</strong>(<code>${rCols}</code>)
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        // Section: Check Constraints
        if (checks.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-circle-check text-success"></i><span>Ràng buộc kiểm tra (Check)</span>
                    </div>
                    ${checks.map(chk => `
                        <div class="tde-constraint-item">
                            <div class="tde-constraint-item-top">
                                <span class="tde-constraint-name">${esc(chk.name || 'CK_' + (session.table || 'Table'))}</span>
                                <span class="tde-constraint-pill tde-constraint-pill--chk">CHECK</span>
                            </div>
                            <div class="tde-constraint-cols font-monospace" style="font-size: 11px;">
                                ${esc(chk.definition || chk.clause || '')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // Section: Auto / Sequence / Computed
        if (identCols.length > 0 || seqCols.length > 0 || compCols.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-wand-magic-sparkles text-warning"></i><span>Cột tự động & Sequence</span>
                    </div>
                    ${identCols.map(c => `
                        <div class="tde-constraint-item">
                            <div class="tde-constraint-item-top">
                                <span class="tde-constraint-name">${esc(c)}</span>
                                <span class="tde-constraint-pill tde-constraint-pill--pk">IDENTITY</span>
                            </div>
                            <div class="tde-constraint-cols text-muted">Chỉ đọc (&lt;Auto&gt;), CSDL tự sinh giá trị tăng dần</div>
                        </div>
                    `).join('')}
                    ${seqCols.map(c => {
                        const colObj = cols.find(x => x.name === c);
                        return `
                            <div class="tde-constraint-item">
                                <div class="tde-constraint-item-top">
                                    <span class="tde-constraint-name">${esc(c)}</span>
                                    <span class="tde-constraint-pill tde-constraint-pill--seq">SEQUENCE</span>
                                </div>
                                <div class="tde-constraint-cols">
                                    Cho phép người dùng tự nhập số hoặc để trống để CSDL tự sinh
                                    ${colObj?.default_value ? `<br><code class="text-info">${esc(colObj.default_value)}</code>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                    ${compCols.map(c => `
                        <div class="tde-constraint-item">
                            <div class="tde-constraint-item-top">
                                <span class="tde-constraint-name">${esc(c)}</span>
                                <span class="tde-constraint-pill tde-constraint-pill--chk">COMPUTED</span>
                            </div>
                            <div class="tde-constraint-cols text-muted">Cột tính toán (&lt;Computed&gt;), CSDL tự tính theo công thức</div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // Section: Mandatory NOT NULL
        if (notNullCols.length > 0) {
            sectionsHtml += `
                <div class="tde-constraint-section">
                    <div class="tde-constraint-section-title">
                        <i class="fa-solid fa-asterisk text-danger"></i><span>Cột bắt buộc nhập (NOT NULL)</span>
                    </div>
                    <div class="tde-constraint-item">
                        <div class="tde-constraint-item-top">
                            <span class="tde-constraint-name">Bắt buộc có giá trị (không được để trống)</span>
                            <span class="tde-constraint-pill tde-constraint-pill--nn">NOT NULL</span>
                        </div>
                        <div class="tde-constraint-cols">
                            ${notNullCols.map(c => `<code>${esc(c)}</code>`).join(', ')}
                        </div>
                    </div>
                </div>
            `;
        }

        if (!sectionsHtml) {
            sectionsHtml = `
                <div class="p-3 text-center text-muted">
                    <i class="fa-solid fa-circle-info mb-1" style="font-size: 20px;"></i>
                    <div>Bảng không có ràng buộc (constraints) nào được thiết lập.</div>
                </div>
            `;
        }

        const popover = document.createElement('div');
        popover.id = 'tde-table-constraints-popover';
        popover.className = 'tde-constraints-popover';
        popover.innerHTML = `
            <div class="tde-popover-header">
                <div class="d-flex align-items-center gap-2">
                    <i class="fa-solid fa-shield-halved text-info"></i>
                    <span>Ràng buộc bảng: <strong>${esc(tableName)}</strong></span>
                </div>
                <button class="tde-btn tde-btn--icon text-muted" id="tde-popover-close" style="width: 22px; height: 22px; min-width: 22px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="tde-popover-body">
                ${sectionsHtml}
            </div>
        `;

        document.body.appendChild(popover);

        // Position popover
        if (buttonEl) {
            const rect = buttonEl.getBoundingClientRect();
            let top = rect.bottom + 6;
            let left = rect.left;
            // Prevent overflowing right viewport
            if (left + 460 > window.innerWidth) {
                left = Math.max(10, window.innerWidth - 470);
            }
            // Prevent overflowing bottom viewport
            if (top + 420 > window.innerHeight) {
                top = Math.max(10, rect.top - 430);
            }
            popover.style.top = `${top}px`;
            popover.style.left = `${left}px`;
        }

        const closePopover = () => {
            popover.remove();
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
        };

        const onDocClick = (e) => {
            if (!popover.contains(e.target) && e.target !== buttonEl && !buttonEl?.contains(e.target)) {
                closePopover();
            }
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                closePopover();
            }
        };

        popover.querySelector('#tde-popover-close')?.addEventListener('click', closePopover);

        popover.addEventListener('mouseleave', () => {
            setTimeout(() => {
                const pop = document.getElementById('tde-table-constraints-popover');
                if (pop && !pop.matches(':hover') && (!buttonEl || !buttonEl.matches(':hover'))) {
                    closePopover();
                }
            }, 250);
        });

        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onKeyDown);
        }, 50);
    }

    // Helper: SSMS-style Constraint Warning Modal (structured, chi tiết)
    function showRowConstraintWarningModal({ rowNumber, valResult, errorMessage, onOk }) {
        document.querySelectorAll('.tde-modal-backdrop.tde-alert-backdrop').forEach(b => b.remove());

        const backdrop = document.createElement('div');
        backdrop.className = 'tde-modal-backdrop tde-alert-backdrop';

        // Determine violation type label
        const typeLabels = {
            'UNIQUE': '\u29bf R\u00e0ng bu\u1ed9c Duy nh\u1ea5t (UNIQUE KEY)',
            'PRIMARY_KEY': '\u29bf Kh\u00f3a ch\u00ednh (PRIMARY KEY)',
            'NOT_NULL': '\u26a0 Gi\u00e1 tr\u1ecb B\u1eaft bu\u1ed9c (NOT NULL)',
            'FOREIGN_KEY': '\u26d3 Kh\u00f3a Ngo\u1ea1i (FOREIGN KEY)',
            'CHECK': '\u2714 R\u00e0ng bu\u1ed9c Ki\u1ec3m tra (CHECK)',
        };
        const constraintType = valResult?.constraint_type || '';
        const typeLabel = typeLabels[constraintType] || (constraintType ? constraintType : null);
        const constraintName = valResult?.constraint_name || '';
        const cols = Array.isArray(valResult?.columns) ? valResult.columns : [];
        const vals = valResult?.values || {};
        const cleanMsg = errorMessage || 'D\u1eef li\u1ec7u vi ph\u1ea1m r\u00e0ng bu\u1ed9c CSDL.';

        let detailHtml = '';
        if (typeLabel) {
            detailHtml += `<div class="tde-constraint-error-card mb-2">
                <div class="tde-cec-type">${esc(typeLabel)}</div>`;
            if (constraintName) {
                detailHtml += `<div class="tde-cec-row"><span class="tde-cec-label">T\u00ean Constraint:</span><code class="tde-cec-val">${esc(constraintName)}</code></div>`;
            }
            if (cols.length > 0) {
                detailHtml += `<div class="tde-cec-row"><span class="tde-cec-label">C\u1ed9t vi ph\u1ea1m:</span><span class="tde-cec-val text-warning">${cols.map(esc).join(', ')}</span></div>`;
            }
            if (cols.length > 0 && Object.keys(vals).length > 0) {
                const valStr = cols.map(c => `${esc(c)} = ${esc(vals[c] ?? 'NULL')}`).join(', ');
                detailHtml += `<div class="tde-cec-row"><span class="tde-cec-label">Gi\u00e1 tr\u1ecb:</span><code class="tde-cec-val">${valStr}</code></div>`;
            }
            detailHtml += `</div>`;
        }

        backdrop.innerHTML = `
            <div class="tde-modal-dialog tde-alert-dialog" style="max-width: 560px;">
                <div class="tde-modal-header border-bottom border-danger border-opacity-25">
                    <span class="text-danger fw-semibold">
                        <i class="fa-solid fa-triangle-exclamation me-2"></i>Vi ph\u1ea1m R\u00e0ng bu\u1ed9c D\u1eef li\u1ec7u
                    </span>
                    <button class="tde-btn tde-btn--icon text-muted" id="tde-alert-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="tde-alert-body p-3">
                    <div class="d-flex align-items-start gap-3">
                        <div class="text-danger" style="font-size: 28px; line-height: 1;">
                            <i class="fa-solid fa-circle-xmark"></i>
                        </div>
                        <div style="font-size: 12.5px; line-height: 1.5; color: var(--ide-text-base); flex: 1;">
                            <div class="fw-semibold mb-2">D\u1eef li\u1ec7u vi ph\u1ea1m r\u00e0ng bu\u1ed9c c\u1ee7a c\u01a1 s\u1edf d\u1eef li\u1ec7u.</div>
                            ${detailHtml}
                            <div class="p-2 rounded border border-danger border-opacity-50 font-monospace text-danger" style="font-size: 11px; word-break: break-word; white-space: pre-wrap; background: color-mix(in srgb, var(--ide-bg-base) 90%, red);">${esc(cleanMsg)}</div>
                            <div class="text-muted small mt-2">H\u00e3y s\u1eeda l\u1ea1i gi\u00e1 tr\u1ecb ho\u1eb7c nh\u1ea5n <strong>ESC</strong> \u0111\u1ec3 hu\u1ef7 b\u1ecf thay \u0111\u1ed5i.</div>
                        </div>
                    </div>
                </div>
                <div class="tde-modal-footer">
                    <button class="tde-btn tde-btn--primary px-4" id="tde-alert-ok">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const close = () => {
            backdrop.remove();
            if (typeof onOk === 'function') onOk();
        };
        backdrop.querySelector('#tde-alert-close')?.addEventListener('click', close);
        backdrop.querySelector('#tde-alert-ok')?.addEventListener('click', close);
    }

    function revertCellEdit(session, td, rIdx, cIdx, isNewRow, currentVal, isNull) {
        td.classList.remove('tde-cell-editing');
        // Clear only errors for this cell's column index
        rowErrorsClear(session, rIdx);
        td.classList.remove('tde-cell-error');
        td.querySelector('.tde-cell-error-badge')?.remove();
        // Also clear error from sibling cells in same row
        const tr = td.closest('tr');
        if (tr) {
            tr.classList.remove('tde-row-error');
            tr.querySelectorAll('.tde-cell-error').forEach(cell => cell.classList.remove('tde-cell-error'));
            tr.querySelectorAll('.tde-cell-error-badge').forEach(b => b.remove());
        }

        const rowHead = tr?.querySelector('.tde-rowhead-cell');
        if (rowHead) {
            const isCurrentActive = (rIdx === session.activeRowIndex);
            rowHead.innerHTML = isCurrentActive 
                ? '<i class="fa-solid fa-play text-primary" style="font-size: 8px;"></i>' 
                : (isNewRow ? '*' : '');
        }

        if (isNewRow) {
            const isIdent = isIdentityColumn(session, td.dataset.colName);
            const isComp = isComputedColumn(session, td.dataset.colName);
            if (isIdent) {
                td.innerHTML = '<span class="tde-auto-tag">&lt;Auto&gt;</span>';
                td.className = 'tde-cell-readonly tde-cell-auto';
            } else if (isComp) {
                td.innerHTML = '<span class="tde-computed-tag">&lt;Computed&gt;</span>';
                td.className = 'tde-cell-readonly tde-cell-computed';
            } else {
                td.innerHTML = 'NULL';
                td.classList.add('tde-cell-null');
            }
        } else {
            const origVal = session.originalRows[rIdx]?.[cIdx];
            session.rows[rIdx][cIdx] = origVal;
            if (session.dirtyRows.has(rIdx)) {
                const d = session.dirtyRows.get(rIdx);
                if (d?.changes && td.dataset.colName in d.changes) {
                    delete d.changes[td.dataset.colName];
                    if (Object.keys(d.changes).length === 0 && !d.isNew && !d.isDeleted) {
                        session.dirtyRows.delete(rIdx);
                        if (tr) tr.classList.remove('tde-row-dirty');
                    }
                }
            }
            td.classList.remove('tde-cell-dirty');
            td.textContent = (origVal === null || origVal === undefined) ? 'NULL' : String(origVal);
            if (origVal === null || origVal === undefined) td.classList.add('tde-cell-null');
            else td.classList.remove('tde-cell-null');
            updateDirtyBadge(session);
            if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
        }
    }

    function selectCell(session, targetRIdx, targetCIdx) {
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;
        session.activeRowIndex = targetRIdx;
        session.activeColIndex = targetCIdx;
        session.selectedRowIndices = new Set([targetRIdx]);
        session.isRowHeaderSelected = false;
        updateActiveHighlight(session, container);

        const targetTd = container.querySelector(`#tde-grid-table tr[data-row-idx="${targetRIdx}"] td[data-col-idx="${targetCIdx}"]`);
        if (targetTd) {
            targetTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    function moveToCellAndEdit(session, targetRIdx, targetCIdx) {
        selectCell(session, targetRIdx, targetCIdx);
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;
        const targetTd = container.querySelector(`#tde-grid-table tr[data-row-idx="${targetRIdx}"] td[data-col-idx="${targetCIdx}"]`);
        if (targetTd) {
            startCellEditing(session, targetTd);
        }
    }

    // ── 9. Inline Cell Editing ────────────────────────────────────────────────
    function startCellEditing(session, td, initialChar) {
        if (td.querySelector('.tde-cell-input')) return; // Already editing

        const rIdx = Number(td.dataset.rowIdx);
        const cIdx = Number(td.dataset.colIdx);
        const colName = td.dataset.colName;

        // Is this the bottom template row '*' (which does not exist in session.rows yet)?
        const isTemplateRow = (rIdx === session.rows.length);
        // Is this a new uncommitted row (either template row or in dirtyRows)?
        const isNewRow = Boolean(session.dirtyRows.get(rIdx)?.isNew || isTemplateRow);

        // Disallow editing Identity / Computed columns on ANY row
        if (isIdentityColumn(session, colName)) {
            if (typeof showToast === 'function') {
                showToast(`Cột "${colName}" là cột Identity (tự tăng), không thể chỉnh sửa.`, 'warning');
            }
            return;
        }
        if (isComputedColumn(session, colName)) {
            if (typeof showToast === 'function') {
                showToast(`Cột "${colName}" là cột Computed (tính toán), không thể chỉnh sửa.`, 'warning');
            }
            return;
        }

        const container = td.closest('#table-data-editor-container') || document.getElementById('table-data-editor-container');
        session.activeRowIndex = rIdx;
        session.activeColIndex = cIdx;
        session.lastClickedRowIndex = rIdx;
        session.isRowHeaderSelected = false;
        if (!session.selectedRowIndices) {
            session.selectedRowIndices = new Set();
        }
        session.selectedRowIndices.clear();
        session.selectedRowIndices.add(rIdx);
        if (container) {
            updateActiveHighlight(session, container);
        }

        const isNull = td.classList.contains('tde-cell-null');
        let currentVal = '';
        if (isTemplateRow) {
            currentVal = '';
        } else {
            const rawVal = session.rows[rIdx]?.[cIdx];
            currentVal = (rawVal === null || rawVal === undefined) ? '' : String(rawVal);
        }

        const colMeta = session.metadata?.columns?.find(c => c.name === colName);
        const colType = (colMeta?.type || '').toLowerCase();
        const isStringType = ['varchar', 'nvarchar', 'text', 'char', 'nchar', 'string'].some(t => colType.includes(t));
        const isDateOnly = (colType === 'date');
        const isDateTime = ['datetime', 'datetime2', 'smalldatetime', 'timestamp', 'timestamptz'].some(t => colType.includes(t));
        const isDateOrTime = isDateOnly || isDateTime;

        td.classList.add('tde-cell-editing');

        const editorWrap = document.createElement('div');
        editorWrap.className = 'tde-cell-editor-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tde-cell-input';

        if (initialChar !== undefined && initialChar !== null) {
            input.value = initialChar;
        } else {
            input.value = currentVal;
        }

        editorWrap.appendChild(input);

        // Requirement 5: Calendar picker button + native picker for date/datetime
        if (isDateOrTime) {
            input.classList.add('tde-has-date-btn');
            const dateBtn = document.createElement('button');
            dateBtn.type = 'button';
            dateBtn.className = 'tde-cell-date-btn';
            dateBtn.title = isDateTime ? 'Mở lịch chọn Ngày & Giờ (hoặc gõ tay trực tiếp)' : 'Mở lịch chọn Ngày (hoặc gõ tay trực tiếp)';
            dateBtn.tabIndex = -1;
            dateBtn.innerHTML = '<i class="fa-solid fa-calendar-days"></i>';

            const hiddenPicker = document.createElement('input');
            hiddenPicker.type = isDateTime ? 'datetime-local' : 'date';
            hiddenPicker.tabIndex = -1;
            hiddenPicker.className = 'tde-hidden-native-picker';

            const syncPickerValue = () => {
                const val = input.value.trim();
                if (val) {
                    try {
                        if (isDateTime) {
                            const iso = val.replace(' ', 'T').slice(0, 16);
                            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
                                hiddenPicker.value = iso;
                            }
                        } else {
                            const isoDate = val.slice(0, 10);
                            if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
                                hiddenPicker.value = isoDate;
                            }
                        }
                    } catch (_) {}
                }
            };
            syncPickerValue();

            dateBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            dateBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                syncPickerValue();
                try {
                    if (typeof hiddenPicker.showPicker === 'function') {
                        hiddenPicker.showPicker();
                    } else {
                        hiddenPicker.focus();
                        hiddenPicker.click();
                    }
                } catch (_) {
                    hiddenPicker.focus();
                    hiddenPicker.click();
                }
            });

            hiddenPicker.addEventListener('change', () => {
                let pickedVal = hiddenPicker.value;
                if (isDateTime && pickedVal) {
                    pickedVal = pickedVal.replace('T', ' ');
                    if (pickedVal.length === 16) pickedVal += ':00';
                }
                input.value = pickedVal;
                input.focus();
            });

            editorWrap.appendChild(dateBtn);
            editorWrap.appendChild(hiddenPicker);
        }

        td.innerHTML = '';
        td.appendChild(editorWrap);

        // Clicking anywhere inside the editing cell (including remaining empty space to the right)
        // keeps the input focused and prevents prematurely blurring/committing.
        const handleWrapMousedown = (e) => {
            if (e.target.closest('.tde-cell-date-btn') || e.target.closest('.tde-hidden-native-picker')) {
                return;
            }
            if (e.target !== input) {
                e.preventDefault();
                input.focus();
                const len = input.value.length;
                input.setSelectionRange(len, len);
            }
            if (session.activeRowIndex !== rIdx || !session.selectedRowIndices?.has(rIdx)) {
                session.activeRowIndex = rIdx;
                session.activeColIndex = cIdx;
                session.lastClickedRowIndex = rIdx;
                if (!session.selectedRowIndices) session.selectedRowIndices = new Set();
                session.selectedRowIndices.clear();
                session.selectedRowIndices.add(rIdx);
                if (container) updateActiveHighlight(session, container);
            }
        };
        editorWrap.addEventListener('mousedown', handleWrapMousedown);
        td.addEventListener('mousedown', handleWrapMousedown);

        const handleWrapClick = (e) => {
            if (e.target.closest('.tde-cell-date-btn') || e.target.closest('.tde-hidden-native-picker')) {
                return;
            }
            e.stopPropagation();
            if (document.activeElement !== input) {
                input.focus();
            }
            if (session.activeRowIndex !== rIdx || !session.selectedRowIndices?.has(rIdx)) {
                session.activeRowIndex = rIdx;
                session.activeColIndex = cIdx;
                session.lastClickedRowIndex = rIdx;
                if (!session.selectedRowIndices) session.selectedRowIndices = new Set();
                session.selectedRowIndices.clear();
                session.selectedRowIndices.add(rIdx);
                if (container) updateActiveHighlight(session, container);
            }
        };
        editorWrap.addEventListener('click', handleWrapClick);
        td.addEventListener('click', handleWrapClick);

        input.addEventListener('focus', () => {
            if (session.activeRowIndex !== rIdx || !session.selectedRowIndices?.has(rIdx)) {
                session.activeRowIndex = rIdx;
                session.activeColIndex = cIdx;
                session.lastClickedRowIndex = rIdx;
                if (!session.selectedRowIndices) session.selectedRowIndices = new Set();
                session.selectedRowIndices.clear();
                session.selectedRowIndices.add(rIdx);
                if (container) updateActiveHighlight(session, container);
            }
        });

        input.focus();
        if (initialChar === undefined || initialChar === null) {
            input.select();
        }

        let committed = false;
        async function commit(setNull = false) {
            if (committed) return;
            committed = true;
            td.classList.remove('tde-cell-editing');

            let finalVal;
            if (setNull) {
                finalVal = null;
            } else if (input.value === '') {
                finalVal = isStringType ? '' : null;
            } else {
                finalVal = input.value.trim();
            }

            const oldVal = isTemplateRow ? null : session.rows[rIdx]?.[cIdx];
            const hasChanged = isTemplateRow
                ? (finalVal !== null && finalVal !== '')
                : (finalVal !== oldVal);

            // ── Step 0: Check if cell has been reverted to original database value ──
            const origVal = isNewRow ? null : session.originalRows[rIdx]?.[cIdx];
            const isRevertedToOriginal = (!isNewRow && !isTemplateRow && (
                finalVal === origVal ||
                ((finalVal === null || finalVal === undefined) && (origVal === null || origVal === undefined)) ||
                (finalVal !== null && origVal !== null && finalVal !== undefined && origVal !== undefined && String(finalVal) === String(origVal))
            ));

            if (isRevertedToOriginal) {
                if (hasChanged) {
                    pushUndoSnapshot(session);
                }
                // 1. Remove constraint errors for this cell (both NOT_NULL and server-side errors)
                if (session.rowErrors?.has(rIdx)) {
                    const errMap = session.rowErrors.get(rIdx);
                    for (const [key, info] of [...errMap.entries()]) {
                        if (info.cIdx === cIdx || (info.cIdxList || []).includes(cIdx) || info.colName === colName) {
                            errMap.delete(key);
                        }
                    }
                    if (errMap.size === 0) {
                        session.rowErrors.delete(rIdx);
                    }
                }

                // 2. Clear error UI on cell and row
                td.classList.remove('tde-cell-error');
                td.querySelector('.tde-cell-error-badge')?.remove();

                const tr = td.closest('tr');
                if (!rowErrorsHas(session, rIdx) && tr) {
                    tr.classList.remove('tde-row-error');
                    const rowHead = tr.querySelector('.tde-rowhead-cell');
                    const isCurrentActive = (rIdx === session.activeRowIndex);
                    if (rowHead) {
                        rowHead.innerHTML = isCurrentActive
                            ? '<i class="fa-solid fa-play text-primary" style="font-size: 8px;"></i>'
                            : (isNewRow ? '<i class="fa-solid fa-plus text-success" style="font-size: 8px;"></i>' : '');
                    }
                }

                // 3. Revert dirty changes for this cell
                session.rows[rIdx][cIdx] = origVal;
                if (session.dirtyRows.has(rIdx)) {
                    const d = session.dirtyRows.get(rIdx);
                    if (d?.changes && colName in d.changes) {
                        delete d.changes[colName];
                        if (Object.keys(d.changes).length === 0 && !d.isNew && !d.isDeleted) {
                            session.dirtyRows.delete(rIdx);
                            if (tr) tr.classList.remove('tde-row-dirty');
                        }
                    }
                }
                td.classList.remove('tde-cell-dirty');

                // 4. Update cell display
                if (origVal === null || origVal === undefined) {
                    td.classList.add('tde-cell-null');
                    td.textContent = 'NULL';
                } else {
                    td.classList.remove('tde-cell-null');
                    td.textContent = String(origVal);
                }

                // 5. Update badges and tab status
                updateDirtyBadge(session);
                if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
                return;
            }

            // ── Step A: Client-side NOT NULL check ──
            const colMetaForNull = session.metadata?.columns?.find(c => c.name === colName);
            const isNullable = colMetaForNull?.nullable ?? colMetaForNull?.is_nullable ?? true;
            const hasDefault = hasDefaultValue(session, colName);
            const isIdent2 = isIdentityColumn(session, colName);
            const isSeq2 = isSequenceColumn(session, colName);
            if (!isNullable && !hasDefault && !isIdent2 && !isSeq2 && (finalVal === null || finalVal === '')) {
                if (hasChanged) {
                    pushUndoSnapshot(session);
                }
                const errInfo = {
                    colName, cIdx, cIdxList: [cIdx],
                    error: `Cột "${colName}" không được để trống (NOT NULL).`,
                    constraint_type: 'NOT_NULL',
                    columns: [colName],
                    isNewRow, originalVal: currentVal
                };
                rowErrorsSet(session, rIdx, `NOT_NULL::${colName}`, errInfo);
                applyErrorToRow(session, td, rIdx, [cIdx], errInfo);
                td.textContent = (finalVal === null) ? 'NULL' : String(finalVal);
                td.classList.add('tde-cell-null');
                showRowConstraintWarningModal({
                    rowNumber: rIdx + 1,
                    valResult: errInfo,
                    errorMessage: errInfo.error,
                    onOk: () => td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                });
                return;
            }

            // ── Step B: Clear previous NOT_NULL error if now valid ──
            rowErrorsDeleteConstraint(session, rIdx, `NOT_NULL::${colName}`);

            // ── Step C: Server-side constraint check (Unique/PK/FK/Check) ──
            const hasPriorErrorOnThisCell = session.rowErrors?.has(rIdx) && (() => {
                const errMap = session.rowErrors.get(rIdx);
                for (const info of errMap.values()) {
                    if (info.cIdx === cIdx || (info.cIdxList || []).includes(cIdx) || info.colName === colName) return true;
                }
                return false;
            })();

            if (hasChanged || hasPriorErrorOnThisCell) {
                if (hasChanged && !isTemplateRow) {
                    pushUndoSnapshot(session);
                }
                let valResult = { valid: true };
                try {
                    const rowValues = {};
                    if (isTemplateRow) {
                        rowValues[colName] = finalVal;
                    } else if (isNewRow) {
                        const dirtyNew = session.dirtyRows.get(rIdx);
                        if (dirtyNew?.changes) Object.assign(rowValues, dirtyNew.changes);
                        rowValues[colName] = finalVal;
                    } else {
                        session.columns.forEach((c, i) => {
                            rowValues[c] = (i === cIdx) ? finalVal : session.rows[rIdx][i];
                        });
                    }
                    const origRow = (!isNewRow && session.originalRows[rIdx]) ? session.originalRows[rIdx] : session.rows[rIdx];
                    const pkConds = isNewRow ? null : getRowPkConditions(session, origRow);
                    const valRes = await fetch('/api/table-data-editor/validate-row', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            conn_id: session.connId,
                            database: session.database,
                            schema: session.schema,
                            table: session.table,
                            values: rowValues,
                            keys: pkConds,
                            is_new: isNewRow,
                            target_column: colName
                        })
                    });
                    valResult = await valRes.json();
                } catch (vErr) {
                    console.warn('[TableDataEditor] Validate cell error:', vErr);
                }

                if (valResult && valResult.valid === false) {
                    const cleanMsg = cleanSqlErrorMessage(valResult.error || 'Dữ liệu vi phạm ràng buộc CSDL.');
                    const errorCols = Array.isArray(valResult.columns) ? valResult.columns : [colName];
                    const errorCIdxList = errorCols.map(c => session.columns.indexOf(c)).filter(i => i >= 0);
                    if (!errorCIdxList.includes(cIdx)) errorCIdxList.push(cIdx);

                    const constraintKey = `${valResult.constraint_type || 'DB'}::${valResult.constraint_name || colName}`;
                    const errInfo = {
                        colName, cIdx, cIdxList: errorCIdxList,
                        error: cleanMsg,
                        constraint_type: valResult.constraint_type,
                        constraint_name: valResult.constraint_name,
                        columns: errorCols,
                        values: valResult.values || {},
                        isNewRow, originalVal: currentVal
                    };
                    rowErrorsSet(session, rIdx, constraintKey, errInfo);
                    applyErrorToRow(session, td, rIdx, errorCIdxList, errInfo);

                    // Preserve typed value in cell display and model — do not erase!
                    td.textContent = (finalVal === null) ? 'NULL' : String(finalVal);
                    if (finalVal === null) td.classList.add('tde-cell-null');
                    else td.classList.remove('tde-cell-null');

                    if (!isTemplateRow) {
                        session.rows[rIdx][cIdx] = finalVal;
                        if (!session.dirtyRows.has(rIdx)) {
                            session.dirtyRows.set(rIdx, {
                                originalRow: session.originalRows[rIdx] ? [...session.originalRows[rIdx]] : null,
                                changes: {},
                                isNew: isNewRow,
                                isDeleted: false
                            });
                        }
                        session.dirtyRows.get(rIdx).changes[colName] = finalVal;
                        td.classList.add('tde-cell-dirty');
                        updateDirtyBadge(session);
                    }

                    showRowConstraintWarningModal({
                        rowNumber: rIdx + 1,
                        valResult: { ...valResult, columns: errorCols },
                        errorMessage: cleanMsg,
                        onOk: () => td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                    });
                    return;
                }

                // If now valid, remove server-side errors touching this cell
                if (session.rowErrors?.has(rIdx)) {
                    for (const [key, info] of session.rowErrors.get(rIdx)) {
                        if (!key.startsWith('NOT_NULL::') && (info.cIdx === cIdx || (info.cIdxList || []).includes(cIdx) || info.colName === colName)) {
                            rowErrorsDeleteConstraint(session, rIdx, key);
                        }
                    }
                }
            }

            // Valid! Clear error UI if no more errors on this row
            if (!rowErrorsHas(session, rIdx)) {
                const tr = td.closest('tr');
                if (tr) {
                    tr.classList.remove('tde-row-error');
                    const rowHead = tr.querySelector('.tde-rowhead-cell');
                    const isCurrentActive = (rIdx === session.activeRowIndex);
                    if (rowHead) {
                        rowHead.innerHTML = isCurrentActive
                            ? '<i class="fa-solid fa-play text-primary" style="font-size: 8px;"></i>'
                            : (isTemplateRow ? '*' : (isNewRow ? '<i class="fa-solid fa-plus text-success" style="font-size: 8px;"></i>' : ''));
                    }
                }
            }
            td.classList.remove('tde-cell-error');
            td.querySelector('.tde-cell-error-badge')?.remove();

            // Case 1: Template Row '*' (only creates new row when typing in the bottom '*' row)
            if (isTemplateRow) {
                if (finalVal !== null && finalVal !== '') {
                    pushUndoSnapshot(session);
                    const newRowData = new Array(session.columns.length).fill(null);
                    newRowData[cIdx] = finalVal;
                    session.rows.push(newRowData);

                    const newIdx = session.rows.length - 1;
                    session.dirtyRows.set(newIdx, {
                        originalRow: null,
                        changes: { [colName]: finalVal },
                        isNew: true,
                        isDeleted: false
                    });
                    session.totalRows = session.rows.length;
                    session.activeRowIndex = newIdx;

                    renderSessionUI(session);
                    if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
                    updateDirtyBadge(session);
                    selectCell(session, newIdx, cIdx);
                } else {
                    if (isIdentityColumn(session, colName)) {
                        td.innerHTML = '<span class="tde-auto-tag">&lt;Auto&gt;</span>';
                        td.className = 'tde-cell-readonly tde-cell-auto';
                    } else if (isComputedColumn(session, colName)) {
                        td.innerHTML = '<span class="tde-computed-tag">&lt;Computed&gt;</span>';
                        td.className = 'tde-cell-readonly tde-cell-computed';
                    } else {
                        td.innerHTML = 'NULL';
                        td.classList.add('tde-cell-null');
                    }
                }
                return;
            }

            // Case 2: Row already exists in session.rows (both newly added rows and existing DB rows)
            if (hasChanged) {
                session.rows[rIdx][cIdx] = finalVal;

                if (!session.dirtyRows.has(rIdx)) {
                    session.dirtyRows.set(rIdx, {
                        originalRow: session.originalRows[rIdx] ? [...session.originalRows[rIdx]] : null,
                        changes: {},
                        isNew: isNewRow,
                        isDeleted: false
                    });
                }
                session.dirtyRows.get(rIdx).changes[colName] = finalVal;

                td.classList.add('tde-cell-dirty');
                if (finalVal === null) {
                    td.classList.add('tde-cell-null');
                    td.textContent = 'NULL';
                } else {
                    td.classList.remove('tde-cell-null');
                    td.textContent = String(finalVal);
                }

                if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
                updateDirtyBadge(session);
            } else {
                if (finalVal === null) {
                    td.classList.add('tde-cell-null');
                    td.textContent = 'NULL';
                } else {
                    td.classList.remove('tde-cell-null');
                    td.textContent = String(finalVal);
                }
            }
        }

        input.addEventListener('blur', () => commit(false));
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                await commit(false);
                if (session.rowErrors?.has(rIdx)) return;
                const nextCIdx = e.shiftKey ? cIdx - 1 : cIdx + 1;
                if (nextCIdx >= 0 && nextCIdx < session.columns.length) {
                    moveToCellAndEdit(session, rIdx, nextCIdx);
                } else if (!e.shiftKey && rIdx + 1 < session.rows.length) {
                    moveToCellAndEdit(session, rIdx + 1, 0);
                } else if (e.shiftKey && rIdx > 0) {
                    moveToCellAndEdit(session, rIdx - 1, session.columns.length - 1);
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                await commit(false);
                if (session.rowErrors?.has(rIdx)) return;
                // Enter confirms cell value. Moves active selection down WITHOUT starting inline edit
                const nextRIdx = e.shiftKey ? rIdx - 1 : rIdx + 1;
                if (nextRIdx >= 0 && nextRIdx < session.rows.length) {
                    selectCell(session, nextRIdx, cIdx);
                } else {
                    selectCell(session, Math.min(rIdx, session.rows.length - 1), cIdx);
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                await commit(false);
                if (session.rowErrors?.has(rIdx)) return;
                const nextRIdx = rIdx + 1;
                if (nextRIdx < session.rows.length) {
                    selectCell(session, nextRIdx, cIdx);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                await commit(false);
                if (session.rowErrors?.has(rIdx)) return;
                if (rIdx > 0) {
                    selectCell(session, rIdx - 1, cIdx);
                }
            } else if (e.key === 'ArrowLeft') {
                if (input.selectionStart === 0 && input.selectionEnd === 0 && cIdx > 0) {
                    e.preventDefault();
                    await commit(false);
                    if (session.rowErrors?.has(rIdx)) return;
                    selectCell(session, rIdx, cIdx - 1);
                }
            } else if (e.key === 'ArrowRight') {
                if (input.selectionStart === input.value.length && input.selectionEnd === input.value.length && cIdx < session.columns.length - 1) {
                    e.preventDefault();
                    await commit(false);
                    if (session.rowErrors?.has(rIdx)) return;
                    selectCell(session, rIdx, cIdx + 1);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                committed = true;
                revertCellEdit(session, td, rIdx, cIdx, isNewRow, currentVal, isNull);
            } else if (((e.ctrlKey || e.metaKey) && e.key === '0') ||
                       ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'n' || e.key === 'N')) ||
                       (e.altKey && e.key === 'Delete')) {
                // Shortcuts for NULL: Ctrl+0, Ctrl+Alt+N, Alt+Delete
                e.preventDefault();
                await commit(true);
            }
        });
    }

    // ── 10. Context Menu Implementation ───────────────────────────────────────
    function showContextMenu(session, x, y) {
        // Remove existing context menu
        document.querySelectorAll('.tde-ctx-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'tde-ctx-menu';
        menu.id = 'tde-context-menu';

        const rIdx = session.activeRowIndex;
        const cIdx = session.activeColIndex;
        const colName = session.columns[cIdx];
        const dirtyInfo = session.dirtyRows.get(rIdx);
        const isRowDirty = Boolean(dirtyInfo);
        const isCellDirty = Boolean(dirtyInfo?.changes && (colName in dirtyInfo.changes));
        const isDeleted = Boolean(dirtyInfo?.isDeleted);

        const isCrit = session.panesVisible.criteria;
        const isSql = session.panesVisible.sql;
        const isGrid = session.panesVisible.grid;

        const selCount = (session.selectedRowIndices && session.selectedRowIndices.size > 1) ? session.selectedRowIndices.size : 1;
        const isHeaderSel = Boolean(session.isRowHeaderSelected);
        const dupLabel = selCount > 1 ? `Thêm bản sao (${selCount} dòng)` : 'Thêm bản sao dòng (Duplicate)';
        const delLabel = isDeleted ? 'Hủy đánh dấu xóa (Unmark Delete)' : (selCount > 1 ? `Đánh dấu xóa (${selCount} dòng)` : 'Đánh dấu xóa dòng (Delete Row)');

        menu.innerHTML = `
            <div class="tde-menu-item" data-action="execute">
                <span class="tde-menu-icon text-warning"><i class="fa-solid fa-play"></i></span>
                <span class="tde-menu-label">Execute SQL</span>
                <span class="tde-menu-shortcut">Alt+X</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item" data-action="cut">
                <span class="tde-menu-icon"><i class="fa-solid fa-scissors"></i></span>
                <span class="tde-menu-label">Cut</span>
                <span class="tde-menu-shortcut">Ctrl+X</span>
            </div>
            ${selCount > 1 ? `
            <div class="tde-menu-item" data-action="copy-row">
                <span class="tde-menu-icon"><i class="fa-solid fa-copy"></i></span>
                <span class="tde-menu-label">Sao chép ${selCount} dòng (Copy Rows)</span>
                <span class="tde-menu-shortcut">Ctrl+C</span>
            </div>
            ` : `
            <div class="tde-menu-item" data-action="copy-cell">
                <span class="tde-menu-icon"><i class="fa-regular fa-clone"></i></span>
                <span class="tde-menu-label">Sao chép ô (Copy Cell)</span>
                <span class="tde-menu-shortcut">Ctrl+C</span>
            </div>
            <div class="tde-menu-item" data-action="copy-row">
                <span class="tde-menu-icon"><i class="fa-solid fa-copy"></i></span>
                <span class="tde-menu-label">Sao chép cả dòng (Copy Row)</span>
                <span class="tde-menu-shortcut">Ctrl+Shift+C</span>
            </div>
            `}
            <div class="tde-menu-item" data-action="paste">
                <span class="tde-menu-icon"><i class="fa-solid fa-paste"></i></span>
                <span class="tde-menu-label">Dán (Paste)</span>
                <span class="tde-menu-shortcut">Ctrl+V</span>
            </div>
            <div class="tde-menu-item" data-action="duplicate">
                <span class="tde-menu-icon text-info"><i class="fa-solid fa-clone"></i></span>
                <span class="tde-menu-label">${dupLabel}</span>
                <span class="tde-menu-shortcut">Ctrl+D</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item ${!colName ? 'disabled' : ''}" data-action="set-null">
                <span class="tde-menu-icon text-warning"><i class="fa-solid fa-ban"></i></span>
                <span class="tde-menu-label">Gán giá trị NULL (Set NULL)</span>
                <span class="tde-menu-shortcut">Ctrl+0</span>
            </div>
            <div class="tde-menu-item ${!colName ? 'disabled' : ''}" data-action="set-empty-str">
                <span class="tde-menu-icon text-muted"><i class="fa-solid fa-quote-left"></i></span>
                <span class="tde-menu-label">Gán chuỗi rỗng ''</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item ${!isCellDirty ? 'disabled' : ''}" data-action="revert-cell">
                <span class="tde-menu-icon text-info"><i class="fa-solid fa-rotate-left"></i></span>
                <span class="tde-menu-label">Hoàn tác ô này (Revert Cell)</span>
            </div>
            <div class="tde-menu-item ${!isRowDirty ? 'disabled' : ''}" data-action="revert-row">
                <span class="tde-menu-icon text-warning"><i class="fa-solid fa-rotate-left"></i></span>
                <span class="tde-menu-label">Hoàn tác cả dòng (Revert Row)</span>
                <span class="tde-menu-shortcut">Ctrl+Z</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item ${!colName ? 'disabled' : ''}" data-action="value-inspector">
                <span class="tde-menu-icon text-info"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
                <span class="tde-menu-label">Value Inspector (JSON/XML/Text)...</span>
            </div>
            <div class="tde-menu-item ${!colName ? 'disabled' : ''}" data-action="bulk-edit">
                <span class="tde-menu-icon text-primary"><i class="fa-solid fa-layer-group"></i></span>
                <span class="tde-menu-label">Chỉnh sửa hàng loạt (Bulk Edit)...</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item" data-action="add-row">
                <span class="tde-menu-icon text-success"><i class="fa-solid fa-plus"></i></span>
                <span class="tde-menu-label">Thêm dòng mới (Insert Row)</span>
                <span class="tde-menu-shortcut">Ctrl+N</span>
            </div>
            <div class="tde-menu-item" data-action="delete">
                <span class="tde-menu-icon text-danger"><i class="fa-solid fa-trash"></i></span>
                <span class="tde-menu-label">${delLabel}</span>
                <span class="tde-menu-shortcut">Del</span>
            </div>
            <div class="tde-menu-sep"></div>

            <!-- Pane Submenu -->
            <div class="tde-menu-item tde-submenu-wrap">
                <span class="tde-menu-icon"><i class="fa-solid fa-table-columns"></i></span>
                <span class="tde-menu-label">Pane</span>
                <i class="fa-solid fa-caret-right text-muted small ms-auto"></i>

                <div class="tde-submenu shadow">
                    <div class="tde-menu-item" data-action="toggle-pane-crit">
                        <span class="tde-menu-icon">${isCrit ? '<i class="fa-solid fa-check text-success"></i>' : ''}</span>
                        <span class="tde-menu-label">Criteria</span>
                    </div>
                    <div class="tde-menu-item" data-action="toggle-pane-sql">
                        <span class="tde-menu-icon">${isSql ? '<i class="fa-solid fa-check text-success"></i>' : ''}</span>
                        <span class="tde-menu-label">SQL</span>
                    </div>
                    <div class="tde-menu-item" data-action="toggle-pane-grid">
                        <span class="tde-menu-icon">${isGrid ? '<i class="fa-solid fa-check text-success"></i>' : ''}</span>
                        <span class="tde-menu-label">Result</span>
                    </div>
                </div>
            </div>

            <div class="tde-menu-item" data-action="clear-results">
                <span class="tde-menu-icon text-danger"><i class="fa-solid fa-xmark"></i></span>
                <span class="tde-menu-label">Clear Results</span>
            </div>
            <div class="tde-menu-sep"></div>

            <div class="tde-menu-item" data-action="properties">
                <span class="tde-menu-icon text-info"><i class="fa-solid fa-wrench"></i></span>
                <span class="tde-menu-label">Properties</span>
                <span class="tde-menu-shortcut">Alt+Enter</span>
            </div>
        `;

        document.body.appendChild(menu);

        // Adjust position so it doesn't overflow window
        const rect = menu.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        menu.style.left = `${Math.min(x, winW - rect.width - 5)}px`;
        menu.style.top = `${Math.min(y, winH - rect.height - 5)}px`;

        // Click outside listener
        function onDocClick(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', onDocClick);
            }
        }
        setTimeout(() => document.addEventListener('click', onDocClick), 10);

        // Menu item click handlers
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.tde-menu-item');
            if (!item || !item.dataset.action || item.classList.contains('disabled')) return;
            const action = item.dataset.action;
            menu.remove();
            document.removeEventListener('click', onDocClick);
            handleMenuAction(session, action);
        });
    }

    function handleMenuAction(session, action) {
        switch (action) {
            case 'execute':
                triggerExecute(session);
                break;
            case 'cut':
                triggerCopy(session, Boolean(session.isRowHeaderSelected) || (session.selectedRowIndices && session.selectedRowIndices.size > 1));
                triggerDeleteRow(session);
                break;
            case 'copy':
                triggerCopy(session, Boolean(session.isRowHeaderSelected) || (session.selectedRowIndices && session.selectedRowIndices.size > 1));
                break;
            case 'copy-cell':
                triggerCopy(session, false);
                break;
            case 'copy-row':
                triggerCopy(session, true);
                break;
            case 'paste':
                triggerPaste(session);
                break;
            case 'set-null':
                applyCellValue(session, session.activeRowIndex, session.activeColIndex, null);
                break;
            case 'set-empty-str':
                applyCellValue(session, session.activeRowIndex, session.activeColIndex, '');
                break;
            case 'revert-cell':
                triggerRevert(session, 'cell');
                break;
            case 'revert-row':
                triggerRevert(session, 'row');
                break;
            case 'value-inspector':
                showValueInspector(session, session.activeRowIndex, session.activeColIndex);
                break;
            case 'bulk-edit':
                showBulkEditModal(session, session.columns[session.activeColIndex], session.activeColIndex);
                break;
            case 'add-row':
                triggerAddNewRow(session);
                break;
            case 'delete':
                triggerDeleteRow(session);
                break;
            case 'duplicate':
                triggerDuplicateRow(session);
                break;
            case 'toggle-pane-crit':
                togglePane(session, 'criteria');
                break;
            case 'toggle-pane-sql':
                togglePane(session, 'sql');
                break;
            case 'toggle-pane-grid':
                togglePane(session, 'grid');
                break;
            case 'clear-results':
                session.rows = [];
                session.totalRows = 0;
                session.dirtyRows.clear();
                renderSessionUI(session);
                break;
            case 'properties':
                showPropertiesModal(session);
                break;
        }
    }

    // Helper: Detect whether a column is an auto rule column (Identity, Computed, Rowversion/Timestamp)
    function isRuleColumn(session, colName) {
        if (!colName || !session?.metadata) return false;
        if (isIdentityColumn(session, colName) || isComputedColumn(session, colName)) return true;
        const nameLower = String(colName).trim().toLowerCase();
        const colMeta = (session.metadata.columns || []).find(c => String(c.name).trim().toLowerCase() === nameLower);
        const colType = String(colMeta?.type || '').toLowerCase();
        if (colType.includes('timestamp') || colType.includes('rowversion')) return true;
        return false;
    }

    // ── 11. Copy & Paste with Multi-Row and Constraint Validation ──────────────
    async function triggerCopy(session, forceRowMode = false) {
        let textToCopy = '';
        let isRows = false;
        let count = 0;
        let copiedRowIdx = -1;

        const isMultiRow = Boolean(session.isRowHeaderSelected) && session.selectedRowIndices && session.selectedRowIndices.size > 1;
        const isRowHeader = Boolean(session.isRowHeaderSelected);

        if (forceRowMode || isMultiRow || isRowHeader) {
            // Copy full row(s) as TSV (Standard SSMS clipboard format)
            isRows = true;
            let rowsToCopy = [];
            if (isMultiRow) {
                const sortedIndices = Array.from(session.selectedRowIndices)
                    .filter(i => i >= 0 && i < session.rows.length)
                    .sort((a, b) => a - b);
                rowsToCopy = sortedIndices.map(i => ({ row: session.rows[i], rIdx: i }));
            } else if (session.activeRowIndex >= 0 && session.activeRowIndex < session.rows.length) {
                rowsToCopy = [{ row: session.rows[session.activeRowIndex], rIdx: session.activeRowIndex }];
            }

            if (rowsToCopy.length === 0) return;
            count = rowsToCopy.length;
            copiedRowIdx = rowsToCopy[0].rIdx;

            if (count === 1) {
                session.selectedRowIndices = new Set([copiedRowIdx]);
            }

            const lines = rowsToCopy.map(({ row, rIdx }) => {
                return row.map((v, cIdx) => {
                    const colName = session.columns[cIdx];
                    const isIdent = isIdentityColumn(session, colName);
                    const isComp = isComputedColumn(session, colName);
                    const isSeq = isSequenceColumn(session, colName);

                    // Requirement 2: Do NOT copy values for identity, sequence, computed columns
                    if (isIdent || isComp || isSeq) {
                        return isIdent ? '<Auto>' : (isComp ? '<Computed>' : '<Seq>');
                    }
                    if (v === null || v === undefined) {
                        return 'NULL';
                    }
                    return String(v);
                }).join('\t');
            });
            textToCopy = lines.join('\r\n');
        } else {
            // Copy single cell value
            const rIdx = session.activeRowIndex;
            const cIdx = session.activeColIndex;
            if (rIdx >= 0 && rIdx < session.rows.length && cIdx >= 0 && cIdx < session.columns.length) {
                const val = session.rows[rIdx]?.[cIdx];
                const colName = session.columns[cIdx];
                const dirtyInfo = session.dirtyRows.get(rIdx);
                const isNewRow = Boolean(dirtyInfo?.isNew);
                if (isNewRow && isIdentityColumn(session, colName)) {
                    textToCopy = '<Auto>';
                } else if (isNewRow && isComputedColumn(session, colName)) {
                    textToCopy = '<Computed>';
                } else if (isNewRow && isSequenceColumn(session, colName)) {
                    textToCopy = '<Seq>';
                } else {
                    textToCopy = (val === null ? 'NULL' : (val === undefined ? '' : String(val)));
                }
                count = 1;
            } else {
                return;
            }
        }

        let copied = false;
        if (window.ClipboardBridge && typeof window.ClipboardBridge.copyToClipboard === 'function') {
            try {
                copied = await window.ClipboardBridge.copyToClipboard(textToCopy);
            } catch (_) {}
        }
        if (!copied && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(textToCopy);
                copied = true;
            } catch (err) {
                console.warn('[TableDataEditor] Clipboard copy error:', err);
            }
        }
        if (!copied) {
            try {
                const ta = document.createElement('textarea');
                ta.value = textToCopy;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (_) {}
        }

        // Requirement 4: Toast thông báo tường minh
        if (typeof showToast === 'function') {
            if (isRows) {
                if (count === 1) {
                    showToast('✓ Đã sao chép dòng vào bộ nhớ tạm (các cột tự tăng/sequence đã được bỏ qua). Bấm Ctrl+V để dán dòng mới.', 'info');
                } else {
                    showToast(`✓ Đã sao chép ${count} dòng vào bộ nhớ tạm (các cột tự tăng/sequence đã được bỏ qua). Bấm Ctrl+V để dán.`, 'info');
                }
            } else {
                const cIdx = session.activeColIndex;
                const colName = session.columns[cIdx] || 'ô';
                showToast(`✓ Đã sao chép giá trị ô [${colName}] vào bộ nhớ tạm.`, 'info');
            }
        }
    }

    // Endpoint /api/table-data-editor/validate-rows available for batch validation if needed
    async function triggerPaste(session, textFromEvent) {
        let text = textFromEvent || '';
        if (!text) {
            if (window.ClipboardBridge && typeof window.ClipboardBridge.readFromClipboard === 'function') {
                try { text = await window.ClipboardBridge.readFromClipboard(); } catch (_) {}
            }
            if (!text && window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_clipboard_text === 'function') {
                try {
                    const res = await window.pywebview.api.get_clipboard_text();
                    if (res && res.success && typeof res.text === 'string') text = res.text;
                } catch (_) {}
            }
            if (!text && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                try { text = await navigator.clipboard.readText(); } catch (_) {}
            }
        }

        if (!text || !text.trim()) return;

        // Check if pasting single cell value
        const isMultiLineOrTab = text.includes('\n') || text.includes('\t');
        const isRowHeader = Boolean(session.isRowHeaderSelected);
        const isNewRowStar = (session.activeRowIndex === session.rows.length);

        if (!isMultiLineOrTab && !isRowHeader && !isNewRowStar && session.activeRowIndex >= 0 && session.activeRowIndex < session.rows.length) {
            const rIdx = session.activeRowIndex;
            const cIdx = session.activeColIndex;
            const colName = session.columns[cIdx];
            if (isIdentityColumn(session, colName)) {
                if (typeof showToast === 'function') {
                    showToast(`Cột "${colName}" là cột Identity (tự tăng), không thể dán dữ liệu.`, 'warning');
                }
                return;
            }
            if (isComputedColumn(session, colName)) {
                if (typeof showToast === 'function') {
                    showToast(`Cột "${colName}" là cột Computed (tính toán), không thể dán dữ liệu.`, 'warning');
                }
                return;
            }
            const cleanVal = text.trim();
            const finalVal = (cleanVal.toUpperCase() === 'NULL' || cleanVal === '<Seq>' || cleanVal === '<Auto>' ? null : cleanVal);
            applyCellValue(session, rIdx, cIdx, finalVal);
            if (typeof showToast === 'function') {
                showToast(`✓ Đã dán giá trị vào ô [${colName}]`, 'info');
            }
            return;
        }

        // Multi-line / Tab / New Row Paste:
        const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.length > 0);
        if (lines.length === 0) return;

        pushUndoSnapshot(session);

        const uniqueCols = getUniqueColumnsForDuplicate(session);
        const validIndices = [];

        lines.forEach(line => {
            const tokens = line.split('\t');
            const rowValues = {};
            const gridRowArray = new Array(session.columns.length).fill(null);

            session.columns.forEach((colName, cIdx) => {
                const isIdent = isIdentityColumn(session, colName);
                const isComp = isComputedColumn(session, colName);
                const isSeq = isSequenceColumn(session, colName);

                // Requirement 2: Auto-managed columns (ID/Sequence/Computed) are NEVER copied or pasted from old row values
                if (isIdent || isComp || isSeq) {
                    gridRowArray[cIdx] = null;
                } else if (cIdx < tokens.length) {
                    const val = tokens[cIdx];
                    const colMeta = session.metadata?.columns?.find(c => String(c.name).trim().toLowerCase() === String(colName).trim().toLowerCase());
                    const colType = (colMeta?.type || '').toLowerCase();
                    const isStringType = ['varchar', 'nvarchar', 'text', 'char', 'nchar', 'string'].some(t => colType.includes(t));

                    let parsedVal;
                    if (val === '' || val.toUpperCase() === 'NULL' || val === '<Auto>' || val === '<Computed>' || val === '<Seq>') {
                        parsedVal = isStringType && val === '' ? '' : null;
                    } else {
                        parsedVal = val;
                    }

                    gridRowArray[cIdx] = parsedVal;
                    if (parsedVal !== null || !hasDefaultValue(session, colName)) {
                        rowValues[colName] = parsedVal;
                    }
                }
            });

            // Add new row to Grid
            session.rows.push(gridRowArray);
            const newIdx = session.rows.length - 1;
            session.dirtyRows.set(newIdx, {
                originalRow: null,
                changes: rowValues,
                isNew: true,
                isDeleted: false
            });

            // Requirement 3: Highlight unique cells in RED without blocking popup
            uniqueCols.forEach(uCol => {
                const uCIdx = session.columns.indexOf(uCol);
                if (uCIdx >= 0 && gridRowArray[uCIdx] !== null && gridRowArray[uCIdx] !== '') {
                    const constraintKey = `DUPLICATE_COPY::${uCol}`;
                    const errInfo = {
                        colName: uCol,
                        cIdx: uCIdx,
                        cIdxList: [uCIdx],
                        error: `Cột "${uCol}" có tính chất UNIQUE (trùng lặp). Vui lòng nhập giá trị mới.`,
                        constraint_type: 'UNIQUE KEY',
                        columns: [uCol],
                        isNewRow: true,
                        originalVal: gridRowArray[uCIdx]
                    };
                    rowErrorsSet(session, newIdx, constraintKey, errInfo);
                }
            });

            validIndices.push(newIdx);
        });

        session.totalRows = session.rows.length;
        session.activeRowIndex = session.rows.length - 1;
        session.selectedRowIndices = new Set(validIndices);
        session.isRowHeaderSelected = false;
        renderSessionUI(session);
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
        updateDirtyBadge(session);

        // Requirement 4: Toast notification tường minh
        if (typeof showToast === 'function') {
            const hasUnique = uniqueCols.length > 0;
            if (validIndices.length === 1) {
                if (hasUnique) {
                    showToast('✓ Đã dán thành công dòng mới. Lưu ý: Cột tự tăng (ID/Sequence) được giữ trống; các ô Unique (đánh dấu đỏ) cần đổi giá trị trước khi Lưu.', 'warning');
                } else {
                    showToast('✓ Đã dán thành công dòng mới. Cột tự tăng (ID/Sequence) được tự động giữ trống.', 'success');
                }
            } else {
                if (hasUnique) {
                    showToast(`✓ Đã dán ${validIndices.length} dòng mới. Lưu ý: Cột tự tăng (ID/Sequence) được giữ trống; các ô Unique (đánh dấu đỏ) cần đổi giá trị trước khi Lưu.`, 'warning');
                } else {
                    showToast(`✓ Đã dán thành công ${validIndices.length} dòng mới vào bảng.`, 'success');
                }
            }
        }
    }

    // ── 12. Add New Row / Duplicate Row Logic ──────────────────────────────────
    function triggerAddNewRow(session) {
        // Create an empty new row
        const newRowData = new Array(session.columns.length).fill(null);
        session.rows.push(newRowData);
        const newIdx = session.rows.length - 1;
        session.dirtyRows.set(newIdx, {
            originalRow: null,
            changes: {},
            isNew: true
        });
        session.totalRows = session.rows.length;
        session.activeRowIndex = newIdx;

        renderSessionUI(session);
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);

        // Scroll to the newly added row and start cell editing
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;
        const newTr = container.querySelector(`tr[data-row-idx="${newIdx}"]`);
        if (newTr) {
            newTr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            const editableTds = Array.from(newTr.querySelectorAll('td:not(.tde-rowhead-cell)'));
            const firstEditableTd = editableTds.find(td => {
                const colName = td.dataset.colName;
                return !isIdentityColumn(session, colName) && !isComputedColumn(session, colName);
            }) || editableTds[0];

            if (firstEditableTd) {
                session.activeColIndex = Number(firstEditableTd.dataset.colIdx || 0);
                updateActiveHighlight(session, container);
                startCellEditing(session, firstEditableTd);
            }
        }
    }

    function triggerDuplicateRow(session) {
        let indicesToDup = [];
        if (session.selectedRowIndices && session.selectedRowIndices.size > 1) {
            indicesToDup = Array.from(session.selectedRowIndices)
                .filter(i => i >= 0 && i < session.rows.length)
                .sort((a, b) => a - b);
        } else if (session.activeRowIndex >= 0 && session.activeRowIndex < session.rows.length) {
            indicesToDup = [session.activeRowIndex];
        }

        if (indicesToDup.length === 0) {
            if (typeof showToast === 'function') showToast('Vui lòng chọn ít nhất 1 dòng để thêm bản sao', 'warning');
            return;
        }

        pushUndoSnapshot(session);

        const uniqueCols = getUniqueColumnsForDuplicate(session);
        const newIndices = [];

        indicesToDup.forEach(rIdx => {
            const origRow = session.rows[rIdx];
            if (!origRow) return;

            const duplicatedRow = new Array(session.columns.length).fill(null);
            const changes = {};

            session.columns.forEach((col, cIdx) => {
                const isIdent = isIdentityColumn(session, col);
                const isComp = isComputedColumn(session, col);
                const isSeq = isSequenceColumn(session, col);

                // Requirement 2: Do NOT copy values for identity, sequence, computed columns
                if (!isIdent && !isComp && !isSeq) {
                    duplicatedRow[cIdx] = origRow[cIdx];
                    changes[col] = origRow[cIdx];
                } else {
                    duplicatedRow[cIdx] = null; // Auto-generated Identity / Computed / Sequence cleared
                }
            });

            session.rows.push(duplicatedRow);
            const newIdx = session.rows.length - 1;
            session.dirtyRows.set(newIdx, {
                originalRow: null,
                changes,
                isNew: true,
                isDeleted: false
            });

            // Requirement 3: Highlight unique cells in RED without blocking popup
            uniqueCols.forEach(uCol => {
                const uCIdx = session.columns.indexOf(uCol);
                if (uCIdx >= 0 && duplicatedRow[uCIdx] !== null && duplicatedRow[uCIdx] !== '') {
                    const constraintKey = `DUPLICATE_COPY::${uCol}`;
                    const errInfo = {
                        type: 'DUPLICATE_COPY',
                        colName: uCol,
                        cIdx: uCIdx,
                        cIdxList: [uCIdx],
                        error: `Cột "${uCol}" có tính chất UNIQUE (trùng lặp). Vui lòng nhập giá trị mới.`,
                        constraint_type: 'UNIQUE KEY',
                        columns: [uCol],
                        isNewRow: true,
                        originalVal: duplicatedRow[uCIdx]
                    };
                    rowErrorsSet(session, newIdx, constraintKey, errInfo);
                }
            });

            newIndices.push(newIdx);
        });

        session.totalRows = session.rows.length;
        session.activeRowIndex = session.rows.length - 1;
        session.selectedRowIndices = new Set(newIndices);
        session.isRowHeaderSelected = false;
        renderSessionUI(session);
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
        updateDirtyBadge(session);

        // Requirement 4: Thông báo tường minh
        if (typeof showToast === 'function') {
            const hasUnique = uniqueCols.length > 0;
            const count = indicesToDup.length;
            if (count === 1) {
                if (hasUnique) {
                    showToast(`✓ Đã tạo bản sao dòng mới. Cột tự tăng (ID/Sequence) đã tự động bỏ qua; các ô Unique (${uniqueCols.join(', ')}) được đánh dấu đỏ cần đổi giá trị mới trước khi Lưu.`, 'warning');
                } else {
                    showToast('✓ Đã tạo bản sao dòng mới thành công. Cột tự tăng (ID/Sequence) đã được tự động bỏ qua.', 'success');
                }
            } else {
                if (hasUnique) {
                    showToast(`✓ Đã tạo bản sao cho ${count} dòng mới. Cột tự tăng (ID/Sequence) đã tự động bỏ qua; các ô Unique (${uniqueCols.join(', ')}) được đánh dấu đỏ cần đổi giá trị mới trước khi Lưu.`, 'warning');
                } else {
                    showToast(`✓ Đã tạo bản sao cho ${count} dòng mới thành công. Cột tự tăng (ID/Sequence) đã được tự động bỏ qua.`, 'success');
                }
            }
        }
    }

    // ── 13. Save Changes & Confirmation Modal ─────────────────────────────────
    async function triggerSaveAll(session) {
        if (session.dirtyRows.size === 0) {
            if (typeof showToast === 'function') showToast('Không có thay đổi nào cần lưu.', 'info');
            return;
        }

        // Block save if there are pending constraint errors on any row
        if (session.rowErrors && session.rowErrors.size > 0) {
            showDialogModal({
                title: 'Không thể lưu — Còn lỗi dữ liệu',
                message: 'Có dòng đang vi phạm ràng buộc dữ liệu. Vui lòng sửa lại trước khi lưu.',
                icon: 'fa-triangle-exclamation',
                type: 'danger'
            });
            return;
        }

        // Show Confirmation Modal
        showSaveConfirmationModal(session);
    }

    function showSaveConfirmationModal(session) {
        const dirtyEntries = Array.from(session.dirtyRows.entries());
        const stagedInserts = dirtyEntries.filter(([_, d]) => d.isNew && !d.isDeleted);
        const stagedUpdates = dirtyEntries.filter(([_, d]) => !d.isNew && !d.isDeleted && Object.keys(d.changes || {}).length > 0);
        const stagedDeletes = dirtyEntries.filter(([_, d]) => !d.isNew && d.isDeleted);

        const totalChanges = stagedInserts.length + stagedUpdates.length + stagedDeletes.length;
        if (totalChanges === 0) {
            if (typeof showToast === 'function') showToast('Không có thay đổi nào cần lưu.', 'info');
            return;
        }

        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'tde-modal-backdrop';
        modalBackdrop.id = 'tde-confirm-modal';

        let diffTablesHtml = '';
        let previewSqlStatements = [];
        const fullTable = session.dbType === 'postgresql'
            ? `"${session.schema || 'public'}"."${session.table}"`
            : `[${session.schema || 'dbo'}].[${session.table}]`;

        // 1. INSERTS
        stagedInserts.forEach(([rIdx, dirtyInfo]) => {
            const changes = dirtyInfo.changes || {};
            const cols = Object.keys(changes);
            if (cols.length === 0) {
                previewSqlStatements.push(`INSERT INTO ${fullTable} DEFAULT VALUES;`);
            } else {
                const vals = cols.map(c => changes[c] === null ? 'NULL' : `'${changes[c]}'`);
                const qCols = cols.map(c => session.dbType === 'postgresql' ? `"${c}"` : `[${c}]`);
                previewSqlStatements.push(`INSERT INTO ${fullTable} (${qCols.join(', ')})\nVALUES (${vals.join(', ')});`);
            }

            diffTablesHtml += `
                <div class="mb-3">
                    <div class="fw-semibold small text-success mb-1">
                        <i class="fa-solid fa-plus me-1"></i>Thêm mới dòng (New Row ${rIdx + 1}):
                    </div>
                    <table class="tde-diff-table">
                        <thead><tr><th>Cột</th><th>Giá trị thêm mới</th></tr></thead>
                        <tbody>
                            ${cols.map(c => `<tr><td class="fw-semibold">${esc(c)}</td><td class="tde-diff-new">${esc(changes[c] ?? 'NULL')}</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        // 2. UPDATES
        stagedUpdates.forEach(([rIdx, dirtyInfo]) => {
            const changes = dirtyInfo.changes;
            const pkConditions = getRowPkConditions(session, dirtyInfo.originalRow);
            const setClauses = Object.entries(changes).map(([c, v]) => {
                const qc = session.dbType === 'postgresql' ? `"${c}"` : `[${c}]`;
                return `${qc} = ${v === null ? 'NULL' : `'${v}'`}`;
            });
            const whereClauses = Object.entries(pkConditions).map(([c, v]) => {
                const qc = session.dbType === 'postgresql' ? `"${c}"` : `[${c}]`;
                return `${qc} = ${v === null ? 'NULL' : `'${v}'`}`;
            });
            previewSqlStatements.push(`UPDATE ${fullTable}\nSET ${setClauses.join(', ')}\nWHERE ${whereClauses.join(' AND ')};`);

            diffTablesHtml += `
                <div class="mb-3">
                    <div class="fw-semibold small text-warning mb-1">
                        <i class="fa-solid fa-pen me-1"></i>Chỉnh sửa dòng ${rIdx + 1}:
                    </div>
                    <table class="tde-diff-table">
                        <thead><tr><th>Cột</th><th>Giá trị cũ</th><th>Giá trị mới</th></tr></thead>
                        <tbody>
                            ${Object.keys(changes).map(c => {
                                const colIdx = session.columns.indexOf(c);
                                const oldV = dirtyInfo.originalRow[colIdx];
                                const newV = changes[c];
                                return `
                                    <tr>
                                        <td class="fw-semibold">${esc(c)}</td>
                                        <td class="tde-diff-old">${esc(oldV ?? 'NULL')}</td>
                                        <td class="tde-diff-new">${esc(newV ?? 'NULL')}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        // 3. DELETES
        stagedDeletes.forEach(([rIdx, dirtyInfo]) => {
            const pkConditions = getRowPkConditions(session, dirtyInfo.originalRow);
            const whereClauses = Object.entries(pkConditions).map(([c, v]) => {
                const qc = session.dbType === 'postgresql' ? `"${c}"` : `[${c}]`;
                return `${qc} = ${v === null ? 'NULL' : `'${v}'`}`;
            });
            previewSqlStatements.push(`DELETE FROM ${fullTable}\nWHERE ${whereClauses.join(' AND ')};`);

            diffTablesHtml += `
                <div class="mb-3">
                    <div class="fw-semibold small text-danger mb-1">
                        <i class="fa-solid fa-trash me-1"></i>Xóa dòng #${rIdx + 1}:
                    </div>
                    <table class="tde-diff-table">
                        <thead><tr><th>Cột</th><th>Giá trị dữ liệu bị xóa</th></tr></thead>
                        <tbody>
                            ${session.columns.map((c, cIdx) => `
                                <tr>
                                    <td class="fw-semibold">${esc(c)}</td>
                                    <td class="tde-diff-old">${esc(dirtyInfo.originalRow[cIdx] ?? 'NULL')}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        });

        modalBackdrop.innerHTML = `
            <div class="tde-modal-dialog">
                <div class="tde-modal-header">
                    <span><i class="fa-solid fa-triangle-exclamation text-warning me-2"></i>Xác nhận lưu thay đổi dữ liệu (1 Giao dịch duy nhất)</span>
                    <button type="button" class="btn-close btn-close-white small" id="tde-modal-close-x"></button>
                </div>
                <div class="tde-modal-body">
                    <div class="d-flex align-items-center gap-3 p-2 bg-dark rounded border border-secondary border-opacity-25 small">
                        <div><i class="fa-solid fa-server text-info me-1"></i>Kết nối: <strong>${esc(session.connName)}</strong></div>
                        <div><i class="fa-solid fa-database text-primary me-1"></i>CSDL: <strong>${esc(session.database || '—')}</strong></div>
                        <div><i class="fa-solid fa-table text-success me-1"></i>Bảng tác động: <strong>${fullTable}</strong></div>
                        <div class="ms-auto d-flex align-items-center gap-2">
                            ${stagedInserts.length > 0 ? `<span class="badge bg-success">+${stagedInserts.length} thêm</span>` : ''}
                            ${stagedUpdates.length > 0 ? `<span class="badge bg-warning text-dark">~${stagedUpdates.length} sửa</span>` : ''}
                            ${stagedDeletes.length > 0 ? `<span class="badge bg-danger">-${stagedDeletes.length} xóa</span>` : ''}
                        </div>
                    </div>

                    <div class="mt-2">
                        <label class="form-label small fw-semibold text-muted mb-1">Chi tiết thay đổi dữ liệu (Diff):</label>
                        <div class="border rounded p-2" style="max-height: 220px; overflow-y: auto; background-color: var(--ide-bg-base);">
                            ${diffTablesHtml}
                        </div>
                    </div>

                    <div class="mt-2">
                        <label class="form-label small fw-semibold text-muted mb-1">Kịch bản câu lệnh SQL thực thi trong Transaction:</label>
                        <div class="tde-sql-preview-box">${esc(previewSqlStatements.join('\n\n'))}</div>
                    </div>
                </div>
                <div class="tde-modal-footer">
                    <button class="btn btn-sm btn-secondary" id="tde-modal-btn-cancel">Hủy bỏ</button>
                    <button class="btn btn-sm btn-success px-3" id="tde-modal-btn-confirm">
                        <i class="fa-solid fa-check me-1"></i>Xác nhận Commit Transaction
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalBackdrop);

        const closeModal = () => modalBackdrop.remove();
        modalBackdrop.querySelector('#tde-modal-close-x')?.addEventListener('click', closeModal);
        modalBackdrop.querySelector('#tde-modal-btn-cancel')?.addEventListener('click', closeModal);

        modalBackdrop.querySelector('#tde-modal-btn-confirm')?.addEventListener('click', async () => {
            closeModal();
            await executeSaveAll(session);
        });
    }

    async function executeSaveAll(session) {
        if (window.AppLoader) window.AppLoader.show('Đang thực thi lưu dữ liệu trong 1 Transaction...');
        try {
            const dirtyEntries = Array.from(session.dirtyRows.entries());
            const stagedInserts = dirtyEntries.filter(([_, d]) => d.isNew && !d.isDeleted);
            const stagedUpdates = dirtyEntries.filter(([_, d]) => !d.isNew && !d.isDeleted && Object.keys(d.changes || {}).length > 0);
            const stagedDeletes = dirtyEntries.filter(([_, d]) => !d.isNew && d.isDeleted);

            // Auto-value tags that must never be sent to backend
            const AUTO_VALUE_TAGS = [null, undefined, '<Auto>', '<Computed>', '<Seq>'];

            const changes = {
                inserts: stagedInserts.map(([rIdx, d]) => {
                    // Filter out auto-managed column values from insert data
                    const cleanData = {};
                    for (const [k, v] of Object.entries(d.changes || {})) {
                        if (!AUTO_VALUE_TAGS.includes(v)) {
                            cleanData[k] = v;
                        }
                    }
                    return {
                        temp_id: `row_${rIdx}`,
                        data: cleanData
                    };
                }),
                updates: stagedUpdates.map(([_, d]) => {
                    const pkConds = getRowPkConditions(session, d.originalRow);
                    const origData = {};
                    session.columns.forEach((col, idx) => { origData[col] = d.originalRow[idx]; });
                    return {
                        keys: pkConds,
                        original_data: origData,
                        modified_data: d.changes
                    };
                }),
                deletes: stagedDeletes.map(([_, d]) => {
                    const pkConds = getRowPkConditions(session, d.originalRow);
                    const origData = {};
                    session.columns.forEach((col, idx) => { origData[col] = d.originalRow[idx]; });
                    return {
                        keys: pkConds,
                        original_data: origData
                    };
                })
            };

            const res = await fetch('/api/table-data-editor/submit-changes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conn_id: session.connId,
                    database: session.database,
                    schema: session.schema,
                    table: session.table,
                    concurrency_mode: 'optimistic',
                    changes: changes
                })
            });

            const json = await res.json();
            if (!json.success) {
                throw new Error(json.error || 'Lỗi khi lưu dữ liệu');
            }

            if (typeof showToast === 'function') {
                showToast(json.message || `✓ Đã lưu thành công ${json.total} thay đổi vào database.`, 'success');
            }

            // Reload fresh data from database
            await refreshData(session);
            renderSessionUI(session);
            if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, false);
        } catch (err) {
            console.error('[TableDataEditor] Save error:', err);
            showDialogModal({
                title: 'Lỗi thực thi giao dịch',
                message: `Lỗi: ${err.message || String(err)}\n\n(Các thay đổi trên giao diện vẫn được giữ nguyên để bạn chỉnh sửa lại)`,
                icon: 'fa-circle-xmark',
                type: 'danger'
            });
        } finally {
            if (window.AppLoader) window.AppLoader.hide();
        }
    }

    function showConstraintErrorModal(session, errorResults, validCount) {
        const backdrop = document.createElement('div');
        backdrop.className = 'tde-modal-backdrop';
        backdrop.id = 'tde-constraint-modal';

        let errorCardsHtml = '';
        errorResults.forEach(errItem => {
            const rowNum = errItem.row_index + 1;
            const dataSnippet = errItem.data ? Object.entries(errItem.data).map(([k, v]) => `${k}: ${v === null ? 'NULL' : v}`).join(', ') : '';
            errorCardsHtml += `
                <div class="tde-constraint-card">
                    <div class="tde-constraint-card-header">
                        <span class="text-danger"><i class="fa-solid fa-circle-exclamation me-1"></i>Dòng số ${rowNum}</span>
                        <span class="badge bg-danger">Không hợp lệ - Đã bỏ qua</span>
                    </div>
                    <div class="tde-constraint-sql-box">
                        <i class="fa-solid fa-triangle-exclamation me-1"></i>${esc(errItem.error || 'Lỗi ràng buộc không xác định')}
                    </div>
                    ${dataSnippet ? `<div class="tde-constraint-data-preview" title="${esc(dataSnippet)}">Dữ liệu: ${esc(dataSnippet)}</div>` : ''}
                </div>
            `;
        });

        backdrop.innerHTML = `
            <div class="tde-modal-dialog tde-constraint-dialog shadow-lg">
                <div class="tde-modal-header border-bottom border-danger border-opacity-25">
                    <span class="tde-modal-title text-danger">
                        <i class="fa-solid fa-shield-halved me-2"></i>Lỗi Ràng Buộc CSDL Khi Dán Dữ Liệu
                    </span>
                    <button class="tde-btn-close text-white" id="tde-btn-constraint-close" style="background: none; border: none; font-size: 16px; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="tde-modal-body p-3">
                    <div class="alert alert-danger d-flex align-items-center mb-3" style="font-size: 12.5px; background: rgba(220, 53, 69, 0.1); border-color: rgba(220, 53, 69, 0.25);">
                        <i class="fa-solid fa-circle-xmark fa-lg text-danger me-2"></i>
                        <div>
                            Phát hiện <strong>${errorResults.length}</strong> dòng vi phạm ràng buộc dữ liệu từ hệ thống CSDL (Khóa ngoại, Khóa chính, Ràng buộc kiểm tra hoặc Kiểu dữ liệu).
                            <br>Các dòng này đã <strong>bị loại bỏ và không được thêm vào bảng</strong>.
                        </div>
                    </div>

                    <div class="tde-constraint-list mb-3">
                        ${errorCardsHtml}
                    </div>

                    ${validCount > 0 ? `
                        <div class="text-success small fw-semibold">
                            <i class="fa-solid fa-check-circle me-1"></i>Đã dán thành công ${validCount} dòng hợp lệ vào bảng.
                        </div>
                    ` : `
                        <div class="text-muted small">
                            Không có dòng nào hợp lệ được thêm vào bảng.
                        </div>
                    `}
                </div>
                <div class="tde-modal-footer">
                    <button class="btn btn-sm btn-primary px-3" id="tde-btn-constraint-ok">Đã hiểu</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);

        const close = () => backdrop.remove();
        backdrop.querySelector('#tde-btn-constraint-close')?.addEventListener('click', close);
        backdrop.querySelector('#tde-btn-constraint-ok')?.addEventListener('click', close);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
        });
    }

    // ── 14. Staged Delete & Revert Actions ─────────────────────────────────────
    function triggerDeleteRow(session) {
        let indicesToDelete = [];
        if (session.selectedRowIndices && session.selectedRowIndices.size > 1) {
            indicesToDelete = Array.from(session.selectedRowIndices)
                .filter(i => i >= 0 && i < session.rows.length)
                .sort((a, b) => b - a); // Reverse order for safe unsaved row removal
        } else if (session.activeRowIndex >= 0 && session.activeRowIndex < session.rows.length) {
            indicesToDelete = [session.activeRowIndex];
        }

        if (indicesToDelete.length === 0) {
            if (typeof showToast === 'function') showToast('Vui lòng chọn dòng để xóa', 'warning');
            return;
        }

        pushUndoSnapshot(session); // §23 snapshot before delete

        let unsavedCount = 0;
        let stagedDeleteCount = 0;
        let stagedUnmarkCount = 0;

        indicesToDelete.forEach(rIdx => {
            const dirtyInfo = session.dirtyRows.get(rIdx);

            // 1. If it's an unsaved new row, remove it directly
            if (dirtyInfo?.isNew) {
                removeUnsavedRow(session, rIdx);
                unsavedCount++;
                return;
            }

            // 2. Existing row: toggle staged delete
            if (dirtyInfo?.isDeleted) {
                dirtyInfo.isDeleted = false;
                if (Object.keys(dirtyInfo.changes || {}).length === 0) {
                    session.dirtyRows.delete(rIdx);
                }
                stagedUnmarkCount++;
            } else {
                if (!dirtyInfo) {
                    session.dirtyRows.set(rIdx, {
                        originalRow: [...session.originalRows[rIdx]],
                        changes: {},
                        isNew: false,
                        isDeleted: true
                    });
                } else {
                    dirtyInfo.isDeleted = true;
                }
                stagedDeleteCount++;
            }
        });

        session.totalRows = session.rows.length;
        if (session.activeRowIndex >= session.rows.length) {
            session.activeRowIndex = Math.max(0, session.rows.length - 1);
        }
        session.selectedRowIndices = new Set([session.activeRowIndex]);

        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
        renderSessionUI(session);

        if (typeof showToast === 'function') {
            if (unsavedCount > 0) showToast(`Đã xóa ${unsavedCount} dòng mới chưa lưu`, 'secondary');
            if (stagedDeleteCount > 0) showToast(`Đã đánh dấu xóa ${stagedDeleteCount} dòng (Bấm Save để xác nhận commit)`, 'warning');
            if (stagedUnmarkCount > 0) showToast(`Đã hủy đánh dấu xóa ${stagedUnmarkCount} dòng`, 'info');
        }
    }

    function removeUnsavedRow(session, rIdx) {
        session.rows.splice(rIdx, 1);
        const newDirty = new Map();
        for (const [k, v] of session.dirtyRows.entries()) {
            if (k < rIdx) {
                newDirty.set(k, v);
            } else if (k > rIdx) {
                newDirty.set(k - 1, v);
            }
        }
        session.dirtyRows = newDirty;
        session.totalRows = session.rows.length;
        session.activeRowIndex = Math.max(0, Math.min(session.activeRowIndex, session.rows.length - 1));
        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
    }

    function triggerRevert(session, scope = 'row') {
        const rIdx = session.activeRowIndex;
        const cIdx = session.activeColIndex;
        if (rIdx < 0 || rIdx >= session.rows.length) return;

        const dirtyInfo = session.dirtyRows.get(rIdx);
        const hasErrors = session.rowErrors?.has(rIdx);
        if (!dirtyInfo && !hasErrors) {
            if (typeof showToast === 'function') showToast('Dòng này chưa có thay đổi nào để hoàn tác', 'info');
            return;
        }

        if (scope === 'cell') {
            const colName = session.columns[cIdx];
            const hasChangeOnCell = dirtyInfo?.changes && (colName in dirtyInfo.changes);
            const hasErrorOnCell = hasErrors && (() => {
                const errMap = session.rowErrors.get(rIdx);
                for (const info of errMap.values()) {
                    if (info.cIdx === cIdx || (info.cIdxList || []).includes(cIdx) || info.colName === colName) return true;
                }
                return false;
            })();

            if (hasChangeOnCell || hasErrorOnCell) {
                pushUndoSnapshot(session);
                const origVal = dirtyInfo?.originalRow ? dirtyInfo.originalRow[cIdx] : session.originalRows[rIdx]?.[cIdx];
                session.rows[rIdx][cIdx] = origVal;
                if (dirtyInfo?.changes && (colName in dirtyInfo.changes)) {
                    delete dirtyInfo.changes[colName];
                    if (Object.keys(dirtyInfo.changes).length === 0 && !dirtyInfo.isDeleted && !dirtyInfo.isNew) {
                        session.dirtyRows.delete(rIdx);
                    }
                }
                // Clear any error touching this cell
                if (session.rowErrors?.has(rIdx)) {
                    const errMap = session.rowErrors.get(rIdx);
                    for (const [k, info] of [...errMap.entries()]) {
                        if (info.cIdx === cIdx || (info.cIdxList || []).includes(cIdx) || info.colName === colName) {
                            errMap.delete(k);
                        }
                    }
                    if (errMap.size === 0) session.rowErrors.delete(rIdx);
                }
                if (typeof showToast === 'function') showToast(`Đã hoàn tác ô [${colName}] về giá trị ban đầu`, 'info');
            } else {
                if (typeof showToast === 'function') showToast(`Ô [${colName}] chưa có thay đổi`, 'info');
                return;
            }
        } else {
            // Revert entire row
            pushUndoSnapshot(session);
            if (dirtyInfo?.isNew) {
                removeUnsavedRow(session, rIdx);
                if (typeof showToast === 'function') showToast('Đã hoàn tác và gỡ bỏ dòng mới', 'info');
            } else {
                const origRow = dirtyInfo?.originalRow || session.originalRows[rIdx];
                if (origRow) session.rows[rIdx] = [...origRow];
                session.dirtyRows.delete(rIdx);
                session.rowErrors?.delete(rIdx);
                if (typeof showToast === 'function') showToast('Đã hoàn tác toàn bộ thay đổi của dòng', 'info');
            }
        }

        if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, session.dirtyRows.size > 0);
        updateDirtyBadge(session);
        renderSessionUI(session);
    }

    function applyCellValue(session, rIdx, cIdx, finalVal, doRender = true) {
        if (rIdx < 0 || rIdx >= session.rows.length) return;
        const colName = session.columns[cIdx];
        const oldVal = session.rows[rIdx][cIdx];

        if (finalVal !== oldVal) {
            session.rows[rIdx][cIdx] = finalVal;
            const dirtyInfo = session.dirtyRows.get(rIdx);
            if (!dirtyInfo) {
                session.dirtyRows.set(rIdx, {
                    originalRow: [...session.originalRows[rIdx]],
                    changes: { [colName]: finalVal },
                    isNew: false,
                    isDeleted: false
                });
            } else {
                dirtyInfo.changes[colName] = finalVal;
            }
            if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, true);
            if (doRender) {
                renderSessionUI(session);
            }
        }
    }

    // ── 15. Value Inspector Drawer / Modal ─────────────────────────────────────
    function showValueInspector(session, rIdx, cIdx) {
        if (rIdx < 0 || rIdx >= session.rows.length) return;
        const colName = session.columns[cIdx];
        const val = session.rows[rIdx][cIdx];
        const rawValStr = (val === null || val === undefined) ? '' : String(val);

        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'tde-modal-backdrop';
        modalBackdrop.id = 'tde-inspector-modal';

        modalBackdrop.innerHTML = `
            <div class="tde-modal-dialog tde-inspector-dialog">
                <div class="tde-modal-header">
                    <span><i class="fa-solid fa-magnifying-glass-plus text-info me-2"></i>Value Inspector — Cột: <strong>${esc(colName)}</strong> (Dòng #${rIdx + 1})</span>
                    <button type="button" class="btn-close btn-close-white small" id="tde-insp-close-x"></button>
                </div>
                <div class="tde-modal-body">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-sm btn-outline-secondary" id="tde-insp-fmt-json" title="Format JSON có thụt lề">
                                <i class="fa-solid fa-code me-1"></i>Format JSON
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" id="tde-insp-fmt-xml" title="Format XML">
                                <i class="fa-solid fa-file-code me-1"></i>Format XML
                            </button>
                        </div>
                        <div id="tde-insp-status" class="small text-muted" style="font-size: 11px;">
                            Độ dài: ${rawValStr.length} ký tự
                        </div>
                    </div>
                    <div class="flex-grow-1" style="min-height: 280px; height: 100%;">
                        <textarea class="tde-inspector-textarea" id="tde-insp-text" spellcheck="false">${esc(rawValStr)}</textarea>
                    </div>
                </div>
                <div class="tde-modal-footer">
                    <button class="btn btn-sm btn-secondary" id="tde-insp-btn-cancel">Đóng</button>
                    <button class="btn btn-sm btn-success px-3" id="tde-insp-btn-apply">
                        <i class="fa-solid fa-check me-1"></i>Áp dụng vào ô
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalBackdrop);

        const textarea = modalBackdrop.querySelector('#tde-insp-text');
        const statusDiv = modalBackdrop.querySelector('#tde-insp-status');
        const closeModal = () => modalBackdrop.remove();

        modalBackdrop.querySelector('#tde-inspector-close-x')?.addEventListener('click', closeModal);
        modalBackdrop.querySelector('#tde-insp-btn-cancel')?.addEventListener('click', closeModal);

        // Format JSON
        modalBackdrop.querySelector('#tde-insp-fmt-json')?.addEventListener('click', () => {
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2);
                if (statusDiv) statusDiv.innerHTML = '<span class="text-success"><i class="fa-solid fa-check me-1"></i>JSON hợp lệ</span>';
            } catch (e) {
                if (statusDiv) statusDiv.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i>Lỗi JSON: ${esc(e.message)}</span>`;
            }
        });

        // Format XML
        modalBackdrop.querySelector('#tde-insp-fmt-xml')?.addEventListener('click', () => {
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(textarea.value, 'application/xml');
                const parserError = xmlDoc.querySelector('parsererror');
                if (parserError) {
                    if (statusDiv) statusDiv.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i>Lỗi XML: ${esc(parserError.textContent.slice(0, 80))}</span>`;
                    return;
                }
                let formatted = '';
                let pad = 0;
                const raw = textarea.value.replace(/>\s*</g, '><');
                raw.split(/(<[^>]+>)/g).filter(Boolean).forEach(node => {
                    if (node.startsWith('</')) pad--;
                    formatted += '  '.repeat(Math.max(0, pad)) + node + '\n';
                    if (node.startsWith('<') && !node.startsWith('</') && !node.endsWith('/>') && !node.startsWith('<?')) pad++;
                });
                textarea.value = formatted.trim();
                if (statusDiv) statusDiv.innerHTML = '<span class="text-success"><i class="fa-solid fa-check me-1"></i>XML hợp lệ</span>';
            } catch (e) {
                if (statusDiv) statusDiv.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i>Lỗi XML: ${esc(e.message)}</span>`;
            }
        });

        // Apply
        modalBackdrop.querySelector('#tde-insp-btn-apply')?.addEventListener('click', () => {
            const newVal = textarea.value;
            closeModal();
            applyCellValue(session, rIdx, cIdx, newVal);
        });
    }

    // ── 16. Bulk Edit Modal ───────────────────────────────────────────────────
    function showBulkEditModal(session, colName, cIdx) {
        const modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'tde-modal-backdrop';
        modalBackdrop.id = 'tde-bulk-modal';

        modalBackdrop.innerHTML = `
            <div class="tde-modal-dialog tde-bulk-dialog">
                <div class="tde-modal-header">
                    <span><i class="fa-solid fa-layer-group text-primary me-2"></i>Chỉnh sửa đồng loạt — Cột: <strong>${esc(colName)}</strong></span>
                    <button type="button" class="btn-close btn-close-white small" id="tde-bulk-close-x"></button>
                </div>
                <div class="tde-modal-body">
                    <div class="mb-3">
                        <label class="form-label small fw-semibold">Giá trị mới muốn áp dụng:</label>
                        <input type="text" class="form-control form-control-sm bg-dark text-light border-secondary" id="tde-bulk-input" placeholder="Nhập giá trị...">
                        <div class="form-check mt-2">
                            <input class="form-check-input" type="checkbox" id="tde-bulk-null-chk">
                            <label class="form-check-label small" for="tde-bulk-null-chk">Gán giá trị NULL</label>
                        </div>
                    </div>
                    <div class="alert alert-warning p-2 small mb-0">
                        <i class="fa-solid fa-circle-info me-1"></i>Thao tác này sẽ áp dụng giá trị cho tất cả <strong>${session.rows.length}</strong> dòng đang hiển thị của cột <strong>${esc(colName)}</strong>.
                    </div>
                </div>
                <div class="tde-modal-footer">
                    <button class="btn btn-sm btn-secondary" id="tde-bulk-btn-cancel">Hủy bỏ</button>
                    <button class="btn btn-sm btn-primary px-3" id="tde-bulk-btn-confirm">
                        <i class="fa-solid fa-check me-1"></i>Áp dụng hàng loạt
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modalBackdrop);

        const input = modalBackdrop.querySelector('#tde-bulk-input');
        const nullChk = modalBackdrop.querySelector('#tde-bulk-null-chk');
        const closeModal = () => modalBackdrop.remove();

        nullChk.addEventListener('change', () => {
            input.disabled = nullChk.checked;
            if (nullChk.checked) input.value = '';
        });

        modalBackdrop.querySelector('#tde-bulk-close-x')?.addEventListener('click', closeModal);
        modalBackdrop.querySelector('#tde-bulk-btn-cancel')?.addEventListener('click', closeModal);

        modalBackdrop.querySelector('#tde-bulk-btn-confirm')?.addEventListener('click', () => {
            const finalVal = nullChk.checked ? null : input.value;
            closeModal();
            session.rows.forEach((_, rIdx) => {
                applyCellValue(session, rIdx, cIdx, finalVal, false);
            });
            renderSessionUI(session);
            if (typeof showToast === 'function') {
                showToast(`✓ Đã áp dụng giá trị cho cột [${colName}] trên toàn bộ ${session.rows.length} dòng`, 'success');
            }
        });
    }

    // Helper: Extract Primary Key or Full-Row conditions to uniquely identify row
    function getRowPkConditions(session, row) {
        const pkCols = session.metadata?.pk_columns || [];
        const conds = {};

        if (pkCols.length > 0) {
            pkCols.forEach(col => {
                const cIdx = session.columns.indexOf(col);
                if (cIdx !== -1) {
                    conds[col] = row[cIdx];
                }
            });
        } else {
            // Fallback: Use all columns to uniquely identify row
            session.columns.forEach((col, cIdx) => {
                conds[col] = row[cIdx];
            });
        }
        return conds;
    }

    // ── 15. Helper UI Actions ─────────────────────────────────────────────────
    function togglePane(session, paneName) {
        session.panesVisible[paneName] = !session.panesVisible[paneName];
        renderSessionUI(session);
    }

    // Helper: Universal Modal Popup to replace web alert() / confirm()
    function showDialogModal({ title = 'Thông báo', message = '', icon = 'fa-circle-info', type = 'info', isConfirm = false, onConfirm = null }) {
        document.querySelectorAll('.tde-modal-backdrop.tde-alert-backdrop').forEach(b => b.remove());

        const backdrop = document.createElement('div');
        backdrop.className = 'tde-modal-backdrop tde-alert-backdrop';

        const okBtnClass = type === 'danger' ? 'tde-btn--danger' : 'tde-btn--primary';
        backdrop.innerHTML = `
            <div class="tde-modal-dialog tde-alert-dialog">
                <div class="tde-modal-header">
                    <span>${esc(title)}</span>
                    <button class="tde-btn tde-btn--icon text-muted" id="tde-alert-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="tde-alert-body">
                    <div class="tde-alert-icon ${type}"><i class="fa-solid ${icon}"></i></div>
                    <div class="tde-alert-message">${esc(message)}</div>
                </div>
                <div class="tde-modal-footer">
                    ${isConfirm ? `<button class="tde-btn" id="tde-alert-cancel">Hủy</button>` : ''}
                    <button class="tde-btn ${okBtnClass}" id="tde-alert-ok">${isConfirm ? 'Đồng ý' : 'Đóng'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(backdrop);

        const close = () => backdrop.remove();
        backdrop.querySelector('#tde-alert-close')?.addEventListener('click', close);
        backdrop.querySelector('#tde-alert-cancel')?.addEventListener('click', close);
        backdrop.querySelector('#tde-alert-ok')?.addEventListener('click', () => {
            close();
            if (typeof onConfirm === 'function') onConfirm();
        });
    }

    async function triggerDiscard(session) {
        if (session.dirtyRows.size > 0) {
            showDialogModal({
                title: 'Hủy thay đổi',
                message: 'Bạn có chắc chắn muốn hủy tất cả các thay đổi chưa lưu và tải lại dữ liệu không?',
                icon: 'fa-triangle-exclamation',
                type: 'warning',
                isConfirm: true,
                onConfirm: async () => {
                    await doDiscard(session);
                }
            });
            return;
        }
        await doDiscard(session);
    }

    async function doDiscard(session) {
        if (window.AppLoader) window.AppLoader.show('Đang tải lại dữ liệu...');
        try {
            await refreshData(session);
            renderSessionUI(session);
            if (window.AppTabs) window.AppTabs.setTabDirty(session.tabId, false);
            if (typeof showToast === 'function') showToast('Đã khôi phục dữ liệu gốc', 'info');
        } catch (err) {
            showDialogModal({
                title: 'Lỗi tải lại dữ liệu',
                message: err.message || String(err),
                icon: 'fa-triangle-exclamation',
                type: 'danger'
            });
        } finally {
            if (window.AppLoader) window.AppLoader.hide();
        }
    }

    async function triggerExecute(session) {
        if (window.AppLoader) window.AppLoader.show('Đang thực thi truy vấn...');
        try {
            await refreshData(session);
            renderSessionUI(session);
        } catch (err) {
            showDialogModal({
                title: 'Lỗi thực thi truy vấn',
                message: err.message || String(err),
                icon: 'fa-triangle-exclamation',
                type: 'danger'
            });
        } finally {
            if (window.AppLoader) window.AppLoader.hide();
        }
    }

    // Item 9 & 5: Format explicit column list with multiline indentation instead of single-line SELECT *
    function syncSqlFromCriteria(session) {
        const quotePrefix = session.dbType === 'postgresql' ? '"' : '[';
        const quoteSuffix = session.dbType === 'postgresql' ? '"' : ']';
        const qCol = (col) => `${quotePrefix}${col}${quoteSuffix}`;

        const fullTable = session.dbType === 'postgresql'
            ? `"${session.schema || 'public'}"."${session.table}"`
            : `[${session.schema || 'dbo'}].[${session.table}]`;

        let whereClauses = [];
        (session.criteriaRows || []).forEach(r => {
            if (!r.column) return;
            const conds = [];
            const mainCond = buildFilterExpr(r.operator, r.value, session.dbType);
            if (mainCond) conds.push(`${qCol(r.column)} ${mainCond}`);

            const orCond = buildFilterExpr(r.operator, r.orValue, session.dbType);
            if (orCond) conds.push(`${qCol(r.column)} ${orCond}`);

            if (conds.length === 1) {
                whereClauses.push(conds[0]);
            } else if (conds.length > 1) {
                whereClauses.push(`(${conds.join(' OR ')})`);
            }
        });

        const wherePart = whereClauses.length > 0 
            ? `\nWHERE ${whereClauses.join('\n  AND ')}` 
            : '';

        const sortRows = (session.criteriaRows || []).filter(c => c.column && c.sort_type && c.sort_type !== 'None');
        sortRows.sort((a, b) => Number(a.sort_order || 999) - Number(b.sort_order || 999));
        const orderPart = sortRows.length > 0 
            ? `\nORDER BY ${sortRows.map(r => `${qCol(r.column)} ${r.sort_type}`).join(', ')}`
            : '';

        // Detail all columns explicitly and format multiline indented
        const rawCols = (session.columns && session.columns.length > 0)
            ? session.columns
            : (session.metadata?.columns && session.metadata.columns.length > 0)
                ? session.metadata.columns.map(c => c.name)
                : [];

        const formattedCols = (rawCols.length > 0)
            ? rawCols.map(c => `    ${qCol(c)}`).join(',\n')
            : '    *';

        let sql = '';
        if (session.dbType === 'postgresql') {
            const limitPart = session.topN > 0 ? `\nLIMIT ${session.topN}` : '';
            sql = `SELECT\n${formattedCols}\nFROM ${fullTable}${wherePart}${orderPart}${limitPart};`;
        } else {
            const topPart = session.topN > 0 ? `TOP (${session.topN})\n` : '';
            sql = `SELECT ${topPart}${formattedCols}\nFROM ${fullTable}${wherePart}${orderPart};`;
        }

        session.currentSql = sql;
        const textarea = document.querySelector('#tde-sql-text');
        if (textarea) textarea.value = session.currentSql;
    }

    function jumpToRow(session, rIdx) {
        session.activeRowIndex = rIdx;
        session.selectedRowIndices = new Set([rIdx]);
        session.lastClickedRowIndex = rIdx;
        session.isRowHeaderSelected = false;
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;
        updateActiveHighlight(session, container);

        // Scroll row into view
        const tr = container.querySelector(`tr[data-row-idx="${rIdx}"]`);
        if (tr) tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

        const navInput = container.querySelector('#tde-nav-current');
        if (navInput) navInput.value = (rIdx < session.rows.length) ? (rIdx + 1) : session.rows.length;
    }

    // Item 3: Highlight active row, selected rows, and active cell
    function updateActiveHighlight(session, container) {
        if (!container) {
            container = document.getElementById('table-data-editor-container');
            if (!container) return;
        }

        if (!session.selectedRowIndices) {
            session.selectedRowIndices = new Set(session.activeRowIndex !== undefined && session.activeRowIndex !== null ? [session.activeRowIndex] : []);
        }

        const gridTable = container.querySelector('#tde-grid-table');
        if (!gridTable) return;

        // 1. Update row active & selected classes on all rows
        const allTrs = gridTable.querySelectorAll('tbody tr');
        allTrs.forEach(tr => {
            const r = Number(tr.dataset.rowIdx);
            const isAct = (r === session.activeRowIndex);
            const isSel = Boolean(session.selectedRowIndices && session.selectedRowIndices.has(r));
            tr.classList.toggle('active', isAct);
            tr.classList.toggle('tde-row-selected', isSel);

            // 2. Synchronize row indicator in row header
            const rowHead = tr.querySelector('.tde-rowhead-cell');
            if (rowHead) {
                const isTemplate = (r === session.rows.length);
                const dirtyInfo = session.dirtyRows?.get(r);
                const isDirty = session.dirtyRows?.has(r);
                const isDeleted = Boolean(dirtyInfo?.isDeleted);
                const isNew = Boolean(dirtyInfo?.isNew);
                const rowErr = session.rowErrors?.get(r);

                if (rowErr) {
                    const firstRowErrObj = rowErrorsGet(session, r);
                    rowHead.innerHTML = `<i class="fa-solid fa-circle-exclamation text-danger" title="${esc(firstRowErrObj?.error || firstRowErrObj?.message)}" style="font-size: 10px;"></i>`;
                } else if (isAct) {
                    rowHead.innerHTML = '<i class="fa-solid fa-play text-primary" style="font-size: 8px;"></i>';
                } else if (isTemplate) {
                    rowHead.innerHTML = '*';
                } else if (isDeleted) {
                    rowHead.innerHTML = '<i class="fa-solid fa-trash text-danger" style="font-size: 8px;"></i>';
                } else if (isNew) {
                    rowHead.innerHTML = '<i class="fa-solid fa-plus text-success" style="font-size: 8px;"></i>';
                } else if (isDirty) {
                    rowHead.innerHTML = '<i class="fa-solid fa-pen text-warning" style="font-size: 8px;"></i>';
                } else {
                    rowHead.innerHTML = '';
                }
            }
        });

        // 3. Update cell active highlight
        gridTable.querySelectorAll('td.tde-cell-active').forEach(td => td.classList.remove('tde-cell-active'));
        if (session.activeColIndex !== undefined && session.activeColIndex !== null) {
            const td = gridTable.querySelector(`tr[data-row-idx="${session.activeRowIndex}"] td[data-col-idx="${session.activeColIndex}"]`);
            if (td) td.classList.add('tde-cell-active');
        }

        // 4. Update nav indicator input
        const navInput = container.querySelector('#tde-nav-current');
        if (navInput) {
            navInput.value = session.activeRowIndex < session.rows.length ? (session.activeRowIndex + 1) : session.rows.length;
        }
    }

    function handleCellNavigation(session, container, key, isShift) {
        let r = session.activeRowIndex;
        let c = session.activeColIndex;
        const maxR = session.rows.length; // includes new row *
        const maxC = session.columns.length - 1;

        if (key === 'ArrowUp') r = Math.max(0, r - 1);
        else if (key === 'ArrowDown') r = Math.min(maxR, r + 1);
        else if (key === 'ArrowLeft') c = Math.max(0, c - 1);
        else if (key === 'ArrowRight') c = Math.min(maxC, c + 1);

        session.activeRowIndex = r;
        session.activeColIndex = c;

        if (isShift && (key === 'ArrowUp' || key === 'ArrowDown')) {
            const anchor = (session.lastClickedRowIndex !== null && session.lastClickedRowIndex !== undefined)
                ? session.lastClickedRowIndex
                : r;
            session.selectedRowIndices.clear();
            const start = Math.min(anchor, r);
            const end = Math.max(anchor, r);
            for (let i = start; i <= end; i++) {
                if (i <= session.rows.length) session.selectedRowIndices.add(i);
            }
            session.isRowHeaderSelected = true;
        } else {
            session.selectedRowIndices = new Set([r]);
            session.lastClickedRowIndex = r;
            session.isRowHeaderSelected = false;
        }

        updateActiveHighlight(session, container);

        const targetTd = container.querySelector(`#tde-grid-table tr[data-row-idx="${r}"] td[data-col-idx="${c}"]`);
        if (targetTd) targetTd.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Item 2: Auto-fit column to longest content
    function autoFitColumn(session, colName, cIdx, th, container) {
        const minW = getColumnHeaderMinWidth(session, colName);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '12px "Segoe UI", Tahoma, Geneva, Verdana, sans-serif';

        // Header text width
        let maxW = minW;

        // Row cells width
        const rows = session.rows || [];
        const maxCheck = Math.min(rows.length, 500);
        for (let i = 0; i < maxCheck; i++) {
            const val = rows[i]?.[cIdx];
            if (val !== null && val !== undefined) {
                const w = ctx.measureText(String(val)).width + 24;
                if (w > maxW) maxW = w;
            }
        }

        const finalW = Math.max(minW, Math.min(Math.ceil(maxW), 600));
        session.colWidths = session.colWidths || {};
        session.colWidths[colName] = finalW;

        if (th) {
            th.style.width = finalW + 'px';
            th.style.minWidth = minW + 'px';
            th.style.maxWidth = finalW + 'px';
        }
        if (container) {
            container.querySelectorAll(`#tde-grid-table col[data-col-idx="${cIdx}"]`).forEach(colEl => {
                colEl.style.width = finalW + 'px';
                colEl.style.minWidth = minW + 'px';
                colEl.style.maxWidth = finalW + 'px';
            });
            container.querySelectorAll(`#tde-grid-table td[data-col-idx="${cIdx}"]`).forEach(td => {
                td.style.width = finalW + 'px';
                td.style.minWidth = minW + 'px';
                td.style.maxWidth = finalW + 'px';
            });
        }
    }

    function updateDirtyBadge(session) {
        const container = document.getElementById('table-data-editor-container');
        if (!container) return;
        const footerSpan = container.querySelector('.tde-footer-nav .badge');
        if (session.dirtyRows.size > 0) {
            if (footerSpan) footerSpan.innerHTML = `<i class="fa-solid fa-pen me-1"></i>${session.dirtyRows.size} dòng chưa lưu`;
        }
    }

    // Item 7: Show properties popup modal
    function showPropertiesModal(session) {
        const meta = session.metadata || {};
        const pks = meta.pk_columns?.length > 0 ? meta.pk_columns.join(', ') : 'None';
        const idents = meta.identity_columns?.length > 0 ? meta.identity_columns.join(', ') : 'None';
        const computeds = meta.computed_columns?.length > 0 ? meta.computed_columns.join(', ') : 'None';

        const info = 
            `Bảng: [${session.schema}].[${session.table}]\n` +
            `Kết nối: ${session.connName}\n` +
            `CSDL: ${session.database || '—'}\n` +
            `Tổng số cột: ${meta.columns?.length || session.columns?.length || 0}\n` +
            `Khóa chính (PK): ${pks}\n` +
            `Cột tự tăng (Identity): ${idents}\n` +
            `Cột tính toán (Computed): ${computeds}\n` +
            `Số dòng đã tải: ${session.totalRows || session.rows?.length || 0}`;

        showDialogModal({
            title: `Thuộc tính bảng: ${session.table}`,
            message: info,
            icon: 'fa-circle-info',
            type: 'info'
        });
    }

    // ── 16. Splitters Logic ───────────────────────────────────────────────────
    function setupSplitter(splitter, topPane) {
        if (!splitter || !topPane) return;
        let startY = 0;
        let startH = 0;

        function onMouseMove(e) {
            const dy = e.clientY - startY;
            const newH = Math.max(60, Math.min(350, startH + dy));
            topPane.style.height = `${newH}px`;
        }

        function onMouseUp() {
            splitter.classList.remove('active');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        }

        splitter.addEventListener('mousedown', (e) => {
            startY = e.clientY;
            startH = topPane.offsetHeight;
            splitter.classList.add('active');
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // ── 17. Tab Switching & Management ────────────────────────────────────────
    function activateTab(tabId) {
        activeTabId = tabId;
        const session = sessions.get(tabId);
        if (session) {
            renderSessionUI(session);
        }
    }

    function closeTab(tabId) {
        const session = sessions.get(tabId);
        if (session) {
            if (session._docKeyDownHandler) {
                document.removeEventListener('keydown', session._docKeyDownHandler);
                session._docKeyDownHandler = null;
            }
            if (session._docPasteHandler) {
                document.removeEventListener('paste', session._docPasteHandler);
                session._docPasteHandler = null;
            }
        }
        sessions.delete(tabId);
        if (activeTabId === tabId) {
            activeTabId = null;
        }
    }

    // Export TableDataEditor global
    window.TableDataEditor = {
        openTable,
        activateTab,
        closeTab,
        refreshData,
        triggerAddNewRow: (tabId) => {
            const targetId = tabId || activeTabId;
            const session = targetId ? sessions.get(targetId) : null;
            if (session) triggerAddNewRow(session);
        },
        triggerSaveAll: (tabId) => {
            const targetId = tabId || activeTabId;
            const session = targetId ? sessions.get(targetId) : null;
            if (session) triggerSaveAll(session);
        },
        saveActiveTab: (tabId) => {
            const targetId = tabId || activeTabId;
            const session = targetId ? sessions.get(targetId) : null;
            if (session) triggerSaveAll(session);
        },
        getSession: (tabId) => sessions.get(tabId)
    };

})(window);
