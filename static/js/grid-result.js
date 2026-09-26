/**
 * grid-result.js
 * Quản lý Selection Model, Context Menu và các tác vụ nghiệp vụ trên SQL Query Results Data Grid.
 * Tuân thủ thiết kế trong concept Result_ContextMenu.png và tài liệu kỹ thuật .SKILL/result_sql.md.
 */

(function (global) {
    'use strict';

    // ── Helper Toast ─────────────────────────────────────────────────────────
    function notify(message, type = 'info') {
        if (typeof global.showToast === 'function') {
            global.showToast(message, type);
        } else {
            console.log(`[GridResult ${type}] ${message}`);
        }
    }

    // ── Clipboard Helper ─────────────────────────────────────────────────────
    function copyText(text) {
        if (window.copyToClipboard) {
            return window.copyToClipboard(text);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        }
        fallbackCopy(text);
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
        } catch (e) {
            console.error('Fallback copy failed', e);
        }
        document.body.removeChild(ta);
    }

    // ── Format helpers for SQL & CSV ─────────────────────────────────────────
    function escapeCsvCell(val, delimiter = ',') {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function escapeTsvCell(val) {
        if (val === null || val === undefined) return '';
        const s = String(val);
        if (s.includes('\t') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
    }

    function formatSqlLiteral(val) {
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'boolean') return val ? '1' : '0';
        const s = String(val);
        // Single quote escaped to ''
        const escaped = s.replace(/'/g, "''");
        // Non-ASCII string -> N'...'
        const isUnicode = /[^\u0000-\u007F]/.test(s);
        return `${isUnicode ? 'N' : ''}'${escaped}'`;
    }

    function inferSqlType(colName, sampleValues) {
        let hasNonNull = false;
        let isAllInt = true;
        let isAllNum = true;
        let isAllBool = true;
        let isAllDate = true;
        let hasUnicode = false;
        let maxLen = 0;

        for (const val of sampleValues) {
            if (val === null || val === undefined) continue;
            hasNonNull = true;
            const s = String(val);
            maxLen = Math.max(maxLen, s.length);
            if (/[^\u0000-\u007F]/.test(s)) hasUnicode = true;

            if (typeof val === 'boolean' || val === 0 || val === 1 || s === 'true' || s === 'false') {
                // bool candidate
            } else {
                isAllBool = false;
            }

            if (!/^-?\d+$/.test(s)) isAllInt = false;
            if (!/^-?\d+(\.\d+)?$/.test(s)) isAllNum = false;
            if (isNaN(Date.parse(s)) || s.length < 8) isAllDate = false;
        }

        if (!hasNonNull) return 'NVARCHAR(255)';
        if (isAllBool) return 'BIT';
        if (isAllInt) return maxLen > 9 ? 'BIGINT' : 'INT';
        if (isAllNum) return 'DECIMAL(18, 4)';
        if (isAllDate) return 'DATETIME';
        if (hasUnicode) return maxLen > 255 ? 'NVARCHAR(MAX)' : `NVARCHAR(${Math.max(50, Math.ceil(maxLen * 1.5))})`;
        return maxLen > 255 ? 'VARCHAR(MAX)' : `VARCHAR(${Math.max(50, Math.ceil(maxLen * 1.5))})`;
    }

    // ── GridResultInstance ───────────────────────────────────────────────────
    class GridResultInstance {
        constructor(table, resSet, gridIndex) {
            this.table = table;
            this.resSet = resSet;
            this.gridIndex = gridIndex;
            this.pane = table.closest('.ide-grid-pane') || table.parentElement;

            this.columns = resSet.columns || [];
            this.rows = resSet.rows || [];
            this.totalRows = this.rows.length;
            this.totalCols = this.columns.length;

            // Selection state
            this.anchorCell = null; // { row, col }
            this.leadCell = null;   // { row, col }
            this.isMouseDown = false;
            this.isSelectingRows = false;

            // Filter state
            this.columnFilters = {};
            this.filterBar = this.pane ? this.pane.querySelector('.ide-result-filter-bar') : null;

            // Find state
            this.searchOverlay = null;
            this.matchedCells = [];
            this.currentMatchIdx = -1;

            // Aggregates overlay
            this.aggregatesPanel = null;

            this.init();
        }

        init() {
            this.table.tabIndex = 0; // Allow keyboard focus
            this.table.style.outline = 'none';

            // Tag table cells
            const tbody = this.table.querySelector('tbody');
            if (tbody) {
                const trList = tbody.querySelectorAll('tr');
                trList.forEach((tr, rIdx) => {
                    const tdList = tr.querySelectorAll('td');
                    tdList.forEach((td, cIdx) => {
                        if (cIdx === 0) {
                            // Row number cell
                            td.dataset.row = rIdx;
                            td.addEventListener('mousedown', (e) => this.onRowHeaderMouseDown(e, rIdx));
                            td.addEventListener('mouseenter', (e) => this.onRowHeaderMouseEnter(e, rIdx));
                        } else {
                            // Data cell
                            const dataColIdx = cIdx - 1;
                            td.dataset.row = rIdx;
                            td.dataset.col = dataColIdx;

                            // Mark NULL cells for specialized styling
                            const val = this.rows[rIdx] ? this.rows[rIdx][dataColIdx] : null;
                            if (val === null || val === undefined) {
                                td.classList.add('ide-null-cell');
                            }

                            td.addEventListener('mousedown', (e) => this.onCellMouseDown(e, rIdx, dataColIdx));
                            td.addEventListener('mouseenter', (e) => this.onCellMouseEnter(e, rIdx, dataColIdx));
                        }
                    });
                });
            }

            // Top-left header click (Select All)
            const tlHeader = this.table.querySelector('th.ide-row-number');
            if (tlHeader) {
                tlHeader.title = 'Click to select all (Ctrl+A)';
                tlHeader.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectAll();
                });
            }

            // Document mouse up to terminate dragging
            this._docMouseUp = () => {
                this.isMouseDown = false;
                this.isSelectingRows = false;
            };
            document.addEventListener('mouseup', this._docMouseUp);

            // Context menu listener
            this.table.addEventListener('contextmenu', (e) => this.onContextMenu(e));

            // Keyboard navigation & shortcuts
            this.table.addEventListener('keydown', (e) => this.onKeyDown(e));

            // Setup column filtering
            this.setupFilterEvents();

            // Default selection: select cell (0, 0) if data exists
            if (this.totalRows > 0 && this.totalCols > 0) {
                this.setSelection(0, 0, 0, 0);
            }
        }

        destroy() {
            document.removeEventListener('mouseup', this._docMouseUp);
            if (this.searchOverlay) this.searchOverlay.remove();
            if (this.aggregatesPanel) this.aggregatesPanel.remove();
            const existingPopover = document.getElementById('ide-col-filter-popover');
            if (existingPopover) existingPopover.remove();
        }

        // ── Column Filter Management ─────────────────────────────────────────
        setupFilterEvents() {
            // Setup click on column header filter buttons
            const filterBtns = this.table.querySelectorAll('thead th .ide-th-filter-btn');
            filterBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const cIdx = parseInt(btn.dataset.colIdx, 10);
                    const colName = btn.dataset.colName;
                    this.showColumnFilterPopover(colName, cIdx, btn);
                });
            });

            // Setup click on "Xóa tất cả lọc" button in this pane's filter bar
            if (this.filterBar) {
                const clearAllBtn = this.filterBar.querySelector('.ide-btn-clear-all-filters');
                if (clearAllBtn) {
                    clearAllBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.columnFilters = {};
                        this.applyColumnFilters();
                    });
                }
            }
        }

        formatCellValue(val) {
            if (val === null || val === undefined) return '(Trống / NULL)';
            if (typeof val === 'boolean') return String(val); // 'true' or 'false'
            if (typeof val === 'object') {
                try {
                    return JSON.stringify(val);
                } catch (e) {
                    return String(val);
                }
            }
            return String(val);
        }

        checkFilterMatch(val, filterRule) {
            if (!filterRule) return true;

            const isValNull = (val === null || val === undefined);
            const strVal = this.formatCellValue(val);

            // 1. Checklist check (filter by selected distinct values)
            if (filterRule.selectedValues && (filterRule.selectedValues instanceof Set)) {
                if (!filterRule.selectedValues.has(strVal)) {
                    return false;
                }
            }

            // 2. Operator check (condition filter)
            const op = filterRule.operator;
            if (op && op !== 'none') {
                const targetVal = (filterRule.value !== undefined && filterRule.value !== null)
                    ? String(filterRule.value).trim().toLowerCase()
                    : '';
                const cellEmpty = isValNull || String(val).trim() === '';

                if (op === 'is_null') {
                    if (!cellEmpty) return false;
                } else if (op === 'is_not_null') {
                    if (cellEmpty) return false;
                } else {
                    if (cellEmpty && op !== 'not_equals' && op !== 'not_contains') {
                        return false;
                    }

                    // Special handling for booleans (PostgreSQL boolean true/false or SQL Server 1/0)
                    if (typeof val === 'boolean') {
                        const boolTrueMatches = ['true', '1', 't', 'yes'];
                        const boolFalseMatches = ['false', '0', 'f', 'no'];
                        if (op === 'equals') {
                            if (val === true && !boolTrueMatches.includes(targetVal)) return false;
                            if (val === false && !boolFalseMatches.includes(targetVal)) return false;
                        } else if (op === 'not_equals') {
                            if (val === true && boolTrueMatches.includes(targetVal)) return false;
                            if (val === false && boolFalseMatches.includes(targetVal)) return false;
                        } else {
                            const bStr = String(val).toLowerCase();
                            if (op === 'contains' && !bStr.includes(targetVal)) return false;
                            if (op === 'not_contains' && bStr.includes(targetVal)) return false;
                            if (op === 'starts_with' && !bStr.startsWith(targetVal)) return false;
                            if (op === 'ends_with' && !bStr.endsWith(targetVal)) return false;
                        }
                    } else if (op === 'gt' || op === 'lt') {
                        const numVal = parseFloat(val);
                        const numTarget = parseFloat(targetVal);
                        if (isNaN(numVal) || isNaN(numTarget)) return false;
                        if (op === 'gt' && !(numVal > numTarget)) return false;
                        if (op === 'lt' && !(numVal < numTarget)) return false;
                    } else {
                        const cellStr = strVal.toLowerCase();
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
                        }
                    }
                }
            }

            return true;
        }

        applyColumnFilters() {
            this.columnFilters = this.columnFilters || {};
            const filterKeys = Object.keys(this.columnFilters).filter(k => {
                const f = this.columnFilters[k];
                if (!f) return false;
                const hasOp = f.operator && f.operator !== 'none' && (
                    f.operator === 'is_null' || f.operator === 'is_not_null' || (f.value !== undefined && f.value !== '')
                );
                const hasValFilter = Boolean(f.selectedValues && f.isFilteredByValues);
                return hasOp || hasValFilter;
            });

            // Update column header filter button states
            const thList = this.table.querySelectorAll('thead th');
            thList.forEach(th => {
                const btn = th.querySelector('.ide-th-filter-btn');
                if (!btn) return;
                const colName = btn.dataset.colName;
                if (filterKeys.includes(colName)) {
                    btn.classList.add('ide-filter-active');
                    btn.title = `Cột [${colName}] đang được lọc. Nhấp để xem/sửa lọc.`;
                } else {
                    btn.classList.remove('ide-filter-active');
                    btn.title = `Lọc cột [${colName}]`;
                }
            });

            const colNames = this.columns.map(c => typeof c === 'string' ? c : (c.name || String(c)));
            let hiddenCount = 0;

            const trList = this.table.querySelectorAll('tbody tr');
            trList.forEach((tr, rIdx) => {
                const rowData = this.rows[rIdx];
                if (!rowData) return;

                let match = true;
                for (const colName of filterKeys) {
                    const cIdx = colNames.indexOf(colName);
                    if (cIdx === -1) continue;
                    const filterRule = this.columnFilters[colName];
                    const val = rowData[cIdx];
                    if (!this.checkFilterMatch(val, filterRule)) {
                        match = false;
                        break;
                    }
                }

                if (match) {
                    tr.classList.remove('ide-row-filtered-out');
                } else {
                    tr.classList.add('ide-row-filtered-out');
                    hiddenCount++;
                }
            });

            // Update filter bar banner
            if (this.filterBar) {
                if (filterKeys.length === 0) {
                    this.filterBar.classList.add('d-none');
                    this.filterBar.style.display = 'none';
                } else {
                    this.filterBar.classList.remove('d-none');
                    this.filterBar.style.display = 'flex';
                    const summaryEl = this.filterBar.querySelector('.ide-result-filter-summary');
                    if (summaryEl) {
                        const colsStr = filterKeys.map(c => `<b>[${escapeHtml(c)}]</b>`).join(', ');
                        const shownCount = this.totalRows - hiddenCount;
                        summaryEl.innerHTML = `Đang lọc theo cột ${colsStr}: hiển thị <b>${shownCount}</b> / ${this.totalRows} dòng (ẩn <b>${hiddenCount}</b> dòng)`;
                    }
                }
            }

            // Sync footer count
            if (typeof window.updateResultFooter === 'function') {
                window.updateResultFooter();
            }
        }

        showColumnFilterPopover(colName, cIdx, btn) {
            const existing = document.getElementById('ide-col-filter-popover');
            if (existing) {
                const sameCol = existing.dataset.colName === colName && existing.dataset.gridIndex === String(this.gridIndex);
                existing.remove();
                if (sameCol) return;
            }

            this.columnFilters = this.columnFilters || {};
            const currentFilter = this.columnFilters[colName] || {
                operator: 'none',
                value: '',
                selectedValues: null,
                isFilteredByValues: false
            };

            // Extract distinct values and counts
            const rows = this.rows || [];
            const valueCounts = new Map();
            let nullCount = 0;
            rows.forEach(r => {
                const val = r[cIdx];
                if (val === null || val === undefined) {
                    nullCount++;
                } else {
                    const s = this.formatCellValue(val);
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
            popover.id = 'ide-col-filter-popover';
            popover.className = 'tde-col-filter-popover';
            popover.dataset.colName = colName;
            popover.dataset.colIdx = cIdx;
            popover.dataset.gridIndex = this.gridIndex;

            popover.innerHTML = `
                <div class="tde-cfp-header">
                    <div class="d-flex align-items-center gap-1 text-truncate">
                        <i class="fa-solid fa-filter text-primary" style="font-size: 11px;"></i>
                        <span class="text-truncate">Lọc: <b>${escapeHtml(colName)}</b></span>
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
                    <input type="text" class="tde-cfp-input" placeholder="Giá trị lọc..." value="${escapeHtml(currentFilter.value || '')}"
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

            // Prevent overflowing bottom viewport
            if (top + 380 > window.innerHeight && rect.top > 390) {
                top = Math.max(10, rect.top + window.scrollY - 385);
            }

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
                        <input type="checkbox" class="tde-cfp-val-cb" data-val="${escapeHtml(item.val)}" ${isChecked ? 'checked' : ''}>
                        <span class="tde-cfp-text ${nullClass}">${escapeHtml(item.label)}</span>
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
                if (this.columnFilters && this.columnFilters[colName]) {
                    delete this.columnFilters[colName];
                    this.applyColumnFilters();
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
                    if (this.columnFilters) {
                        delete this.columnFilters[colName];
                    }
                } else {
                    this.columnFilters = this.columnFilters || {};
                    this.columnFilters[colName] = {
                        operator: op,
                        value: val,
                        selectedValues: checkedSet,
                        isFilteredByValues: isFilteredByValues
                    };
                }

                this.applyColumnFilters();
                closePopover();
            });
        }

        // ── Selection management ─────────────────────────────────────────────
        setSelection(anchorRow, anchorCol, leadRow, leadCol) {
            this.anchorCell = {
                row: Math.max(0, Math.min(this.totalRows - 1, anchorRow)),
                col: Math.max(0, Math.min(this.totalCols - 1, anchorCol))
            };
            this.leadCell = {
                row: Math.max(0, Math.min(this.totalRows - 1, leadRow)),
                col: Math.max(0, Math.min(this.totalCols - 1, leadCol))
            };
            this.renderSelectionUI();
        }

        getBoundingBox() {
            if (!this.anchorCell || !this.leadCell) {
                return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 };
            }
            return {
                minRow: Math.min(this.anchorCell.row, this.leadCell.row),
                maxRow: Math.max(this.anchorCell.row, this.leadCell.row),
                minCol: Math.min(this.anchorCell.col, this.leadCell.col),
                maxCol: Math.max(this.anchorCell.col, this.leadCell.col)
            };
        }

        isCellInSelection(r, c) {
            const bb = this.getBoundingBox();
            return r >= bb.minRow && r <= bb.maxRow && c >= bb.minCol && c <= bb.maxCol;
        }

        selectAll() {
            if (this.totalRows === 0 || this.totalCols === 0) return;
            this.setSelection(0, 0, this.totalRows - 1, this.totalCols - 1);
        }

        renderSelectionUI() {
            const bb = this.getBoundingBox();
            const lead = this.leadCell;

            // Update column headers highlight
            const thList = this.table.querySelectorAll('thead th');
            thList.forEach((th, idx) => {
                if (idx === 0) return; // Row number th
                const cIdx = idx - 1;
                if (cIdx >= bb.minCol && cIdx <= bb.maxCol) {
                    th.classList.add('col-selected');
                } else {
                    th.classList.remove('col-selected');
                }
            });

            // Update body cells
            const trList = this.table.querySelectorAll('tbody tr');
            trList.forEach((tr, rIdx) => {
                const rnTd = tr.querySelector('td.ide-row-number');
                if (rnTd) {
                    if (rIdx >= bb.minRow && rIdx <= bb.maxRow) {
                        rnTd.classList.add('row-selected');
                    } else {
                        rnTd.classList.remove('row-selected');
                    }
                }

                const tdList = tr.querySelectorAll('td');
                tdList.forEach((td, cIdx) => {
                    if (cIdx === 0) return;
                    const dataColIdx = cIdx - 1;
                    const inRange = (rIdx >= bb.minRow && rIdx <= bb.maxRow && dataColIdx >= bb.minCol && dataColIdx <= bb.maxCol);
                    const isActive = (lead && rIdx === lead.row && dataColIdx === lead.col);

                    if (inRange) {
                        td.classList.add('selected');
                    } else {
                        td.classList.remove('selected');
                    }

                    if (isActive) {
                        td.classList.add('active-cell');
                    } else {
                        td.classList.remove('active-cell');
                    }
                });
            });
        }

        // ── Mouse interactions ───────────────────────────────────────────────
        onCellMouseDown(e, r, c) {
            this.table.focus();
            if (e.button === 2) {
                // Right-click: if clicked cell is not inside current selection, select it
                if (!this.isCellInSelection(r, c)) {
                    this.setSelection(r, c, r, c);
                }
                return;
            }

            if (e.button === 0) {
                // Chặn hoàn toàn hành vi bôi đen text mặc định của trình duyệt
                e.preventDefault();
                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }
                if (e.shiftKey && this.anchorCell) {
                    this.leadCell = { row: r, col: c };
                    this.renderSelectionUI();
                } else {
                    this.isMouseDown = true;
                    this.isSelectingRows = false;
                    this.setSelection(r, c, r, c);
                }
            }
        }

        onCellMouseEnter(e, r, c) {
            if (this.isMouseDown && !this.isSelectingRows) {
                this.leadCell = { row: r, col: c };
                this.renderSelectionUI();
            }
        }

        onRowHeaderMouseDown(e, r) {
            this.table.focus();
            if (e.button === 0) {
                // Chặn hành vi bôi đen text
                e.preventDefault();
                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }
                this.isMouseDown = true;
                this.isSelectingRows = true;
                if (e.shiftKey && this.anchorCell) {
                    this.leadCell = { row: r, col: this.totalCols - 1 };
                } else {
                    this.anchorCell = { row: r, col: 0 };
                    this.leadCell = { row: r, col: this.totalCols - 1 };
                }
                this.renderSelectionUI();
            }
        }

        onRowHeaderMouseEnter(e, r) {
            if (this.isMouseDown && this.isSelectingRows) {
                this.leadCell = { row: r, col: this.totalCols - 1 };
                this.renderSelectionUI();
            }
        }

        // ── Keyboard handling ────────────────────────────────────────────────
        onKeyDown(e) {
            // Ctrl+A
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                this.selectAll();
                return;
            }

            // Ctrl+Shift+C (Copy with Headers)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                this.copyWithHeaders();
                return;
            }

            // Ctrl+C (Copy)
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                this.copy(false);
                return;
            }

            // Ctrl+Shift+S (Save Results As)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                this.saveResultsAs();
                return;
            }

            // Ctrl+P (Print)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                this.printGrid();
                return;
            }

            // Arrow keys navigation
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                if (!this.leadCell) {
                    this.setSelection(0, 0, 0, 0);
                    return;
                }

                let newRow = this.leadCell.row;
                let newCol = this.leadCell.col;

                if (e.key === 'ArrowUp') {
                    while (newRow > 0) {
                        newRow--;
                        const tr = this.table.querySelector(`tbody tr:nth-child(${newRow + 1})`);
                        if (!tr || !tr.classList.contains('ide-row-filtered-out')) break;
                    }
                }
                if (e.key === 'ArrowDown') {
                    while (newRow < this.totalRows - 1) {
                        newRow++;
                        const tr = this.table.querySelector(`tbody tr:nth-child(${newRow + 1})`);
                        if (!tr || !tr.classList.contains('ide-row-filtered-out')) break;
                    }
                }
                if (e.key === 'ArrowLeft') newCol = Math.max(0, newCol - 1);
                if (e.key === 'ArrowRight') newCol = Math.min(this.totalCols - 1, newCol + 1);

                if (e.shiftKey) {
                    this.leadCell = { row: newRow, col: newCol };
                    this.renderSelectionUI();
                } else {
                    this.setSelection(newRow, newCol, newRow, newCol);
                }

                this.scrollCellIntoView(newRow, newCol);
            }
        }

        scrollCellIntoView(r, c) {
            const td = this.table.querySelector(`tbody tr:nth-child(${r + 1}) td:nth-child(${c + 2})`);
            if (td && td.scrollIntoViewIfNeeded) {
                td.scrollIntoViewIfNeeded(false);
            } else if (td) {
                td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        }

        // ── Data Extraction ──────────────────────────────────────────────────
        getSelectedRangeData(includeHeaders = false) {
            const bb = this.getBoundingBox();
            const colNames = this.columns.map(c => typeof c === 'string' ? c : (c.name || String(c)));
            const selectedColNames = colNames.slice(bb.minCol, bb.maxCol + 1);

            const selectedRowsData = [];
            for (let r = bb.minRow; r <= bb.maxRow; r++) {
                const tr = this.table.querySelector(`tbody tr:nth-child(${r + 1})`);
                if (tr && tr.classList.contains('ide-row-filtered-out')) {
                    continue; // Skip rows hidden by filters
                }
                const row = this.rows[r] || [];
                const rowCells = [];
                for (let c = bb.minCol; c <= bb.maxCol; c++) {
                    rowCells.push(row[c]);
                }
                selectedRowsData.push(rowCells);
            }

            return {
                colNames,
                selectedColNames,
                selectedRowsData,
                boundingBox: bb
            };
        }

        getActiveCellValue() {
            if (!this.leadCell) return '';
            const row = this.rows[this.leadCell.row];
            if (!row) return '';
            return row[this.leadCell.col];
        }

        // ── Actions ──────────────────────────────────────────────────────────

        copyAllHeaders() {
            const colNames = this.columns.map(c => typeof c === 'string' ? c : (c.name || String(c)));
            copyText(colNames.join('\t'));
            notify(`Đã sao chép tất cả ${colNames.length} headers`, 'success');
        }

        copySelectedHeaders() {
            const { selectedColNames } = this.getSelectedRangeData();
            copyText(selectedColNames.join('\t'));
            notify(`Đã sao chép ${selectedColNames.length} headers được chọn`, 'success');
        }

        copyCurrentCell() {
            const val = this.getActiveCellValue();
            const s = (val === null || val === undefined) ? '' : String(val);
            copyText(s);
            notify('Đã sao chép 1:1 giá trị ô hiện tại', 'success');
        }

        copySqlValuesList() {
            const { selectedRowsData, selectedColNames } = this.getSelectedRangeData();
            if (selectedRowsData.length === 0) return;

            let result = '';
            if (selectedColNames.length === 1) {
                // Single column: ('val1', 'val2', ...)
                const items = selectedRowsData.map(r => formatSqlLiteral(r[0]));
                result = `(${items.join(', ')})`;
            } else {
                // Multiple columns: ('val1', 'val2'), ('val3', 'val4')
                const rows = selectedRowsData.map(r => `    (${r.map(formatSqlLiteral).join(', ')})`);
                result = rows.join(',\r\n');
            }

            copyText(result);
            notify('Đã sao chép danh sách SQL values', 'success');
        }

        copy(includeHeaders = false) {
            const { selectedColNames, selectedRowsData } = this.getSelectedRangeData();
            const lines = [];

            if (includeHeaders) {
                lines.push(selectedColNames.map(escapeTsvCell).join('\t'));
            }

            for (const row of selectedRowsData) {
                lines.push(row.map(escapeTsvCell).join('\t'));
            }

            const tsv = lines.join('\r\n');
            copyText(tsv);
            notify(`Đã sao chép ${selectedRowsData.length} dòng${includeHeaders ? ' (kèm headers)' : ''}`, 'success');
        }

        copyWithHeaders() {
            this.copy(true);
        }

        scriptAsInsert(targetAll = false) {
            const colNames = this.columns.map(c => typeof c === 'string' ? c : (c.name || String(c)));
            let cols = [];
            let rowsToScript = [];

            if (targetAll) {
                cols = colNames;
                rowsToScript = this.rows;
            } else {
                const range = this.getSelectedRangeData();
                cols = range.selectedColNames;
                rowsToScript = range.selectedRowsData;
            }

            if (rowsToScript.length === 0 || cols.length === 0) {
                notify('Không có dữ liệu để tạo câu lệnh INSERT', 'warning');
                return;
            }

            // DDL: CREATE TABLE #tabletmp
            const colDefs = cols.map((cName, idx) => {
                const sampleVals = rowsToScript.map(r => r[idx]);
                const inferredType = inferSqlType(cName, sampleVals);
                return `    [${cName}] ${inferredType} NULL`;
            });

            const createTableSql = `-- 1. Tạo bảng tạm #tabletmp\r\nIF OBJECT_ID('tempdb..#tabletmp') IS NOT NULL DROP TABLE #tabletmp;\r\nCREATE TABLE #tabletmp (\r\n${colDefs.join(',\r\n')}\r\n);\r\n`;

            // DML: INSERT INTO #tabletmp
            const colList = cols.map(c => `[${c}]`).join(', ');
            const insertBatches = [];
            const BATCH_SIZE = 1000;

            for (let i = 0; i < rowsToScript.length; i += BATCH_SIZE) {
                const batch = rowsToScript.slice(i, i + BATCH_SIZE);
                const valuesList = batch.map(row => {
                    const cellLiterals = row.map(formatSqlLiteral);
                    return `    (${cellLiterals.join(', ')})`;
                });
                insertBatches.push(`INSERT INTO #tabletmp (${colList}) VALUES\r\n${valuesList.join(',\r\n')};`);
            }

            const fullSql = `${createTableSql}\r\n-- 2. Chèn dữ liệu\r\n${insertBatches.join('\r\n\r\n')}`;
            copyText(fullSql);
            notify(`Đã tạo câu lệnh INSERT (${rowsToScript.length} dòng) vào Clipboard`, 'success');
        }

        copySelectionAsXmlSpreadsheet() {
            const { selectedColNames, selectedRowsData } = this.getSelectedRangeData();
            if (selectedRowsData.length === 0) return;

            const xmlRows = [];

            // Header row
            const headerCells = selectedColNames.map(c => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`);
            xmlRows.push(`   <Row>\r\n    ${headerCells.join('\r\n    ')}\r\n   </Row>`);

            // Data rows
            for (const row of selectedRowsData) {
                const cells = row.map(val => {
                    if (val === null || val === undefined) {
                        return `<Cell><Data ss:Type="String"></Data></Cell>`;
                    }
                    if (typeof val === 'number') {
                        return `<Cell><Data ss:Type="Number">${val}</Data></Cell>`;
                    }
                    return `<Cell><Data ss:Type="String">${escapeXml(String(val))}</Data></Cell>`;
                });
                xmlRows.push(`   <Row>\r\n    ${cells.join('\r\n    ')}\r\n   </Row>`);
            }

            const xml = `<?xml version="1.0"?>\r\n<?mso-application progid="Excel.Sheet"?>\r\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\r\n xmlns:o="urn:schemas-microsoft-com:office:office"\r\n xmlns:x="urn:schemas-microsoft-com:office:excel"\r\n xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\r\n xmlns:html="http://www.w3.org/TR/REC-html40">\r\n <Styles>\r\n  <Style ss:ID="Default" ss:Name="Normal">\r\n   <Alignment ss:Vertical="Bottom"/>\r\n  </Style>\r\n  <Style ss:ID="Header">\r\n   <Font ss:Bold="1"/>\r\n   <Interior ss:Color="#E6E6E6" ss:Pattern="Solid"/>\r\n  </Style>\r\n </Styles>\r\n <Worksheet ss:Name="Query Results">\r\n  <Table>\r\n${xmlRows.join('\r\n')}\r\n  </Table>\r\n </Worksheet>\r\n</Workbook>`;

            copyText(xml);
            notify('Đã sao chép dưới dạng XML Spreadsheet (Excel)', 'success');
        }

        async openInExcel() {
            const range = this.getSelectedRangeData();
            const isFullExport = (range.selectedRowsData.length <= 1 && range.selectedColNames.length <= 1);
            const exportCols = isFullExport ? this.columns : range.selectedColNames;
            const exportRows = isFullExport ? this.rows : range.selectedRowsData;

            notify('Đang chuẩn bị dữ liệu mở Excel...', 'info');

            try {
                let data = null;
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.grid_open_in_excel === 'function') {
                    data = await window.pywebview.api.grid_open_in_excel(exportCols, exportRows);
                } else {
                    const res = await fetch('/api/grid/open-excel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ columns: exportCols, rows: exportRows })
                    });
                    data = await res.json();
                }

                if (data && data.success) {
                    notify('Đang mở dữ liệu trong Excel ở chế độ Tạm (Read-Only). Vui lòng chọn "Save As" nếu muốn lưu lại.', 'success');
                } else {
                    notify(`Lỗi mở Excel: ${data?.error || 'Unknown error'}`, 'danger');
                }
            } catch (err) {
                notify(`Lỗi kết nối mở Excel: ${err.message}`, 'danger');
            }
        }

        async saveResultsAs() {
            const range = this.getSelectedRangeData();
            const isFullExport = (range.selectedRowsData.length <= 1 && range.selectedColNames.length <= 1);
            const exportCols = isFullExport ? this.columns : range.selectedColNames;
            const exportRows = isFullExport ? this.rows : range.selectedRowsData;

            const now = new Date();
            const ts = now.toISOString().replace(/[-:T]/g, '_').slice(0, 15);
            const defaultFilename = `Query_Results_${ts}.xlsx`;

            notify('Đang mở hộp thoại lưu file...', 'info');

            try {
                let data = null;
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.grid_save_results_as === 'function') {
                    data = await window.pywebview.api.grid_save_results_as(exportCols, exportRows, defaultFilename);
                } else {
                    const res = await fetch('/api/grid/save-results', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            columns: exportCols,
                            rows: exportRows,
                            defaultFilename: defaultFilename
                        })
                    });
                    data = await res.json();
                }

                if (data && data.success) {
                    const fname = data.saved_path ? data.saved_path.split(/[\\/]/).pop() : defaultFilename;
                    notify(`Đã lưu kết quả thành công: ${fname}`, 'success');
                } else if (data && data.cancelled) {
                    notify('Đã hủy thao tác lưu file', 'info');
                } else {
                    notify(`Lỗi lưu file: ${data?.error || 'Không thể lưu file'}`, 'danger');
                }
            } catch (err) {
                notify(`Lỗi kết nối lưu file: ${err.message}`, 'danger');
            }
        }

        printGrid() {
            const range = this.getSelectedRangeData();
            const isFullExport = (range.selectedRowsData.length <= 1 && range.selectedColNames.length <= 1);
            const printCols = isFullExport ? this.columns.map(c => typeof c === 'string' ? c : c.name) : range.selectedColNames;
            const printRows = isFullExport ? this.rows : range.selectedRowsData;

            const printWin = window.open('', '_blank', 'width=900,height=650');
            if (!printWin) {
                notify('Trình duyệt đã chặn cửa sổ pop-up in', 'warning');
                return;
            }

            const rowsHtml = printRows.map((r, idx) => {
                const cells = r.map(c => `<td>${c === null || c === undefined ? '<i style="color:#999">NULL</i>' : escapeXml(String(c))}</td>`).join('');
                return `<tr><td style="text-align:center;color:#888;background:#f5f5f5;">${idx + 1}</td>${cells}</tr>`;
            }).join('');

            const headersHtml = printCols.map(c => `<th>${escapeXml(c)}</th>`).join('');

            printWin.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SQL Query Results Print</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; margin: 20px; }
                        h2 { margin-bottom: 8px; font-size: 16px; }
                        .meta { color: #666; margin-bottom: 12px; font-size: 11px; }
                        table { border-collapse: collapse; width: 100%; }
                        th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
                        th { background: #eee; font-weight: 600; }
                        tr:nth-child(even) { background: #fafafa; }
                        @media print {
                            body { margin: 0; }
                            th { background: #ddd !important; -webkit-print-color-adjust: exact; }
                        }
                    </style>
                </head>
                <body>
                    <h2>SQL Query Results</h2>
                    <div class="meta">Tổng số dòng: ${printRows.length} · Thời gian in: ${new Date().toLocaleString()}</div>
                    <table>
                        <thead>
                            <tr><th style="width:36px;text-align:center;">#</th>${headersHtml}</tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                    <script>
                        window.onload = function() { window.print(); }
                    </script>
                </body>
                </html>
            `);
            printWin.document.close();
        }

        // ── Quick Find in Results Grid ───────────────────────────────────────
        findDataInGrid() {
            if (this.searchOverlay) {
                this.searchOverlay.remove();
                this.searchOverlay = null;
                this.clearSearchHighlight();
                return;
            }

            const bar = document.createElement('div');
            bar.className = 'ide-grid-search-bar';
            bar.innerHTML = `
                <i class="fa-solid fa-magnifying-glass text-muted"></i>
                <input type="text" placeholder="Tìm dữ liệu trong grid..." id="gridSearchInput">
                <span class="ide-grid-search-count" id="gridSearchCount">0/0</span>
                <button class="ide-grid-search-btn" id="gridSearchPrev" title="Trước (Shift+Enter)"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="ide-grid-search-btn" id="gridSearchNext" title="Sau (Enter)"><i class="fa-solid fa-chevron-down"></i></button>
                <button class="ide-grid-search-btn" id="gridSearchClose" title="Đóng (Esc)">&times;</button>
            `;

            document.body.appendChild(bar);
            this.searchOverlay = bar;

            const input = bar.querySelector('#gridSearchInput');
            const countEl = bar.querySelector('#gridSearchCount');
            const prevBtn = bar.querySelector('#gridSearchPrev');
            const nextBtn = bar.querySelector('#gridSearchNext');
            const closeBtn = bar.querySelector('#gridSearchClose');

            input.focus();

            const doSearch = () => {
                const query = input.value.trim().toLowerCase();
                this.clearSearchHighlight();
                this.matchedCells = [];
                this.currentMatchIdx = -1;

                if (!query) {
                    countEl.textContent = '0/0';
                    return;
                }

                const tbody = this.table.querySelector('tbody');
                if (!tbody) return;

                const trList = tbody.querySelectorAll('tr');
                trList.forEach((tr, rIdx) => {
                    const tdList = tr.querySelectorAll('td');
                    tdList.forEach((td, cIdx) => {
                        if (cIdx === 0) return;
                        const text = (td.textContent || '').toLowerCase();
                        if (text.includes(query)) {
                            td.classList.add('search-matched');
                            this.matchedCells.push({ r: rIdx, c: cIdx - 1, td });
                        }
                    });
                });

                countEl.textContent = `${this.matchedCells.length > 0 ? 1 : 0}/${this.matchedCells.length}`;
                if (this.matchedCells.length > 0) {
                    this.jumpToMatch(0);
                }
            };

            input.addEventListener('input', doSearch);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.jumpToMatch(this.currentMatchIdx - 1);
                    } else {
                        this.jumpToMatch(this.currentMatchIdx + 1);
                    }
                } else if (e.key === 'Escape') {
                    bar.remove();
                    this.searchOverlay = null;
                    this.clearSearchHighlight();
                    this.table.focus();
                }
            });

            prevBtn.addEventListener('click', () => this.jumpToMatch(this.currentMatchIdx - 1));
            nextBtn.addEventListener('click', () => this.jumpToMatch(this.currentMatchIdx + 1));
            closeBtn.addEventListener('click', () => {
                bar.remove();
                this.searchOverlay = null;
                this.clearSearchHighlight();
                this.table.focus();
            });
        }

        clearSearchHighlight() {
            this.table.querySelectorAll('td.search-matched, td.search-matched-current').forEach(td => {
                td.classList.remove('search-matched', 'search-matched-current');
            });
        }

        jumpToMatch(idx) {
            if (this.matchedCells.length === 0) return;
            if (idx < 0) idx = this.matchedCells.length - 1;
            if (idx >= this.matchedCells.length) idx = 0;

            this.table.querySelectorAll('td.search-matched-current').forEach(td => td.classList.remove('search-matched-current'));

            this.currentMatchIdx = idx;
            const match = this.matchedCells[idx];
            match.td.classList.add('search-matched-current');

            this.setSelection(match.r, match.c, match.r, match.c);
            this.scrollCellIntoView(match.r, match.c);

            const countEl = this.searchOverlay?.querySelector('#gridSearchCount');
            if (countEl) countEl.textContent = `${idx + 1}/${this.matchedCells.length}`;
        }

        findColumnInGrid() {
            const colNames = this.columns.map(c => typeof c === 'string' ? c : c.name);
            const promptVal = prompt(`Nhập tên cột cần tìm trong ${colNames.length} cột:\n(${colNames.slice(0, 10).join(', ')}...)`);
            if (!promptVal) return;

            const q = promptVal.trim().toLowerCase();
            const foundIdx = colNames.findIndex(c => c.toLowerCase().includes(q));
            if (foundIdx >= 0) {
                this.setSelection(0, foundIdx, this.totalRows - 1, foundIdx);
                this.scrollCellIntoView(0, foundIdx);
                notify(`Đã chuyển tới cột: [${colNames[foundIdx]}]`, 'success');
            } else {
                notify(`Không tìm thấy cột nào chứa "${promptVal}"`, 'warning');
            }
        }

        // ── Aggregates Panel ─────────────────────────────────────────────────
        showGridAggregates() {
            if (this.aggregatesPanel) {
                this.aggregatesPanel.remove();
                this.aggregatesPanel = null;
                return;
            }

            const { selectedRowsData } = this.getSelectedRangeData();
            let count = 0;
            let numCount = 0;
            let sum = 0;
            let min = Infinity;
            let max = -Infinity;

            for (const row of selectedRowsData) {
                for (const val of row) {
                    count++;
                    if (val === null || val === undefined || val === '') continue;
                    let num = null;
                    if (typeof val === 'number') {
                        num = val;
                    } else {
                        const s = String(val).replace(/,/g, '').trim();
                        if (s !== '' && !isNaN(Number(s))) {
                            num = Number(s);
                        }
                    }

                    if (num !== null) {
                        numCount++;
                        sum += num;
                        if (num < min) min = num;
                        if (num > max) max = num;
                    }
                }
            }

            const avg = numCount > 0 ? (sum / numCount).toFixed(4) : '-';
            const displayMin = min === Infinity ? '-' : min.toLocaleString();
            const displayMax = max === -Infinity ? '-' : max.toLocaleString();
            const displaySum = numCount > 0 ? (Number.isInteger(sum) ? sum.toLocaleString() : sum.toFixed(4)) : '-';

            const panel = document.createElement('div');
            panel.className = 'ide-grid-aggregates-panel';
            panel.innerHTML = `
                <div class="ide-grid-aggregates-header">
                    <span><i class="fa-solid fa-calculator me-2 text-warning"></i>Thống kê vùng chọn</span>
                    <button type="button" class="btn-close btn-close-white" style="font-size:10px;" id="gridAggregatesClose"></button>
                </div>
                <div class="ide-grid-aggregates-grid">
                    <span class="ide-grid-aggregates-label">Số ô (Count):</span>
                    <span class="ide-grid-aggregates-val">${count}</span>
                    <span class="ide-grid-aggregates-label">Ô số (Num Count):</span>
                    <span class="ide-grid-aggregates-val">${numCount}</span>
                    <span class="ide-grid-aggregates-label">Tổng (Sum):</span>
                    <span class="ide-grid-aggregates-val">${displaySum}</span>
                    <span class="ide-grid-aggregates-label">Trung bình (Average):</span>
                    <span class="ide-grid-aggregates-val">${avg}</span>
                    <span class="ide-grid-aggregates-label">Nhỏ nhất (Min):</span>
                    <span class="ide-grid-aggregates-val">${displayMin}</span>
                    <span class="ide-grid-aggregates-label">Lớn nhất (Max):</span>
                    <span class="ide-grid-aggregates-val">${displayMax}</span>
                </div>
            `;

            document.body.appendChild(panel);
            this.aggregatesPanel = panel;

            panel.querySelector('#gridAggregatesClose').addEventListener('click', () => {
                panel.remove();
                this.aggregatesPanel = null;
            });
            notify('Đã hiển thị bảng thống kê vùng chọn', 'info');
        }

        // ── Visualize Modal ──────────────────────────────────────────────────
        visualizeAs(mode) {
            const rawVal = this.getActiveCellValue();
            const sVal = (rawVal === null || rawVal === undefined) ? '' : String(rawVal);

            let title = `Visualize as ${mode.toUpperCase()}`;
            let contentHtml = '';

            if (mode === 'text') {
                contentHtml = escapeXml(sVal);
            } else if (mode === 'hex') {
                contentHtml = formatHexDump(sVal);
            } else if (mode === 'json') {
                try {
                    const parsed = JSON.parse(sVal);
                    contentHtml = escapeXml(JSON.stringify(parsed, null, 2));
                } catch (e) {
                    contentHtml = `[Lỗi cú pháp JSON]:\n${e.message}\n\n[Dữ liệu gốc]:\n${escapeXml(sVal)}`;
                }
            } else if (mode === 'xml') {
                contentHtml = formatXmlBeautify(sVal);
            } else if (mode === 'image') {
                if (sVal.startsWith('data:image/') || sVal.startsWith('http') || /^[A-Za-z0-9+/=]+$/.test(sVal.slice(0, 100))) {
                    const src = sVal.startsWith('data:image/') ? sVal : `data:image/png;base64,${sVal}`;
                    contentHtml = `<div style="display:flex;justify-content:center;align-items:center;height:100%;"><img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain;border:1px solid var(--ide-border);" alt="Preview"></div>`;
                } else {
                    contentHtml = `[Không thể giải mã hình ảnh từ dữ liệu này]\n\n${escapeXml(sVal)}`;
                }
            }

            const backdrop = document.createElement('div');
            backdrop.className = 'ide-grid-visualize-backdrop';

            const modal = document.createElement('div');
            modal.className = 'ide-grid-visualize-modal';
            modal.innerHTML = `
                <div class="ide-grid-visualize-header">
                    <span><i class="fa-solid fa-eye me-2 text-info"></i>${title}</span>
                    <button type="button" class="btn-close btn-close-white" style="font-size:10px;"></button>
                </div>
                <div class="ide-grid-visualize-body">${mode === 'image' ? contentHtml : `<pre style="margin:0;font-family:inherit;">${contentHtml}</pre>`}</div>
                <div class="ide-grid-visualize-footer">
                    <button class="btn btn-sm btn-secondary copy-btn"><i class="fa-solid fa-copy me-1"></i>Sao chép</button>
                    <button class="btn btn-sm btn-primary close-btn">Đóng</button>
                </div>
            `;

            document.body.appendChild(backdrop);
            document.body.appendChild(modal);

            const close = () => {
                backdrop.remove();
                modal.remove();
            };

            backdrop.addEventListener('click', close);
            modal.querySelector('.btn-close').addEventListener('click', close);
            modal.querySelector('.close-btn').addEventListener('click', close);
            modal.querySelector('.copy-btn').addEventListener('click', () => {
                copyText(sVal);
                notify('Đã sao chép nội dung ô', 'success');
            });
        }

        // ── Context Menu Builder ─────────────────────────────────────────────
        onContextMenu(e) {
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY);
        }

        showContextMenu(x, y) {
            closeActiveGridMenu();

            const menu = document.createElement('div');
            menu.className = 'ide-context-menu ide-grid-context-menu';
            menu.style.minWidth = '220px';

            const items = [
                // Group 1: Headers & Cell Copy
                { id: 'copy-all-headers', label: 'Copy all Headers', icon: 'fa-table-cells' },
                { id: 'copy-sel-headers', label: 'Copy selected Headers', icon: 'fa-table-columns' },
                { id: 'copy-cell-11', label: 'Copy current cell 1:1', customIcon: '1:1' },
                { id: 'copy-sql-list', label: 'Copy as SQL values List', customIcon: '(…)' },
                { separator: true },

                // Group 2: Find, Aggregates, Scripting, Excel XML, Visualize
                { id: 'find-data', label: 'Find data in Results Grid', icon: 'fa-magnifying-glass' },
                { id: 'find-column', label: 'Find column in Results Grid', icon: 'fa-filter' },
                { id: 'show-aggregates', label: 'Show grid aggregates', icon: 'fa-calculator' },
                { id: 'script-data', label: 'Script grid data', icon: 'fa-scroll' },
                { id: 'copy-xml-excel', label: 'Copy selection as Xml Spreadsheet (Excel)', icon: 'fa-file-excel' },
                {
                    id: 'visualize',
                    label: 'Visualize as',
                    icon: 'fa-eye',
                    submenu: [
                        { id: 'vis-text', label: 'Text', icon: 'fa-font' },
                        { id: 'vis-hex', label: 'Hex', icon: 'fa-barcode' },
                        { id: 'vis-json', label: 'JSON', icon: 'fa-code' },
                        { id: 'vis-xml', label: 'XML', icon: 'fa-file-code' },
                        { id: 'vis-image', label: 'Image', icon: 'fa-image' },
                    ]
                },
                { separator: true },

                // Group 3: Core Copy & Export
                { id: 'copy', label: 'Copy', icon: 'fa-copy', shortcut: 'Ctrl+C' },
                { id: 'copy-headers', label: 'Copy with Headers', icon: 'fa-copy', shortcut: 'Ctrl+Shift+C' },
                { id: 'select-all', label: 'Select All', icon: 'fa-arrow-pointer', shortcut: 'Ctrl+A' },
                { id: 'script-insert', label: 'Script as INSERT', icon: 'fa-database' },
                { id: 'open-excel', label: 'Open in Excel', icon: 'fa-file-excel' },
                { id: 'save-results', label: 'Save Results As...', icon: 'fa-floppy-disk', shortcut: 'Ctrl+Shift+S' },
                { separator: true },

                // Group 4: Page Setup & Print
                { id: 'page-setup', label: 'Page Setup...', icon: 'fa-sliders' },
                { id: 'print', label: 'Print...', icon: 'fa-print', shortcut: 'Ctrl+P' },
            ];

            items.forEach(item => {
                if (item.separator) {
                    const sep = document.createElement('div');
                    sep.className = 'ide-ctx-separator';
                    menu.appendChild(sep);
                    return;
                }

                const btn = document.createElement('div');
                btn.className = 'ide-ctx-item' + (item.submenu ? ' has-submenu' : '');
                btn.setAttribute('role', 'menuitem');

                let iconHtml = '';
                if (item.customIcon) {
                    iconHtml = `<span class="ide-ctx-icon fw-bold" style="font-size:10px;letter-spacing:-0.5px;">${item.customIcon}</span>`;
                } else {
                    iconHtml = `<i class="fa-solid ${item.icon || 'fa-circle'} ide-ctx-icon"></i>`;
                }

                btn.innerHTML = `
                    ${iconHtml}
                    <span class="ide-ctx-label">${item.label}</span>
                    ${item.shortcut ? `<span class="ide-ctx-shortcut">${item.shortcut}</span>` : ''}
                    ${item.submenu ? `<i class="fa-solid fa-caret-right ide-ctx-arrow"></i>` : ''}
                `;

                if (item.submenu) {
                    const subMenuEl = document.createElement('div');
                    subMenuEl.className = 'ide-ctx-submenu';
                    item.submenu.forEach(subItem => {
                        const subBtn = document.createElement('div');
                        subBtn.className = 'ide-ctx-item';
                        subBtn.innerHTML = `
                            <i class="fa-solid ${subItem.icon} ide-ctx-icon"></i>
                            <span class="ide-ctx-label">${subItem.label}</span>
                        `;
                        subBtn.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            closeActiveGridMenu();
                            this.handleAction(subItem.id);
                        });
                        subMenuEl.appendChild(subBtn);
                    });
                    btn.appendChild(subMenuEl);
                } else {
                    btn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        closeActiveGridMenu();
                        this.handleAction(item.id);
                    });
                }

                menu.appendChild(btn);
            });

            document.body.appendChild(menu);
            activeGridMenu = menu;

            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            const posX = Math.min(x, vw - mw - 10);
            const posY = Math.min(y, vh - mh - 10);

            menu.style.left = `${posX}px`;
            menu.style.top = `${posY}px`;

            if (posX + mw + 170 > vw) {
                menu.querySelectorAll('.ide-ctx-submenu').forEach(s => s.classList.add('open-left'));
            }
        }

        handleAction(actionId) {
            switch (actionId) {
                case 'copy-all-headers':
                    this.copyAllHeaders();
                    break;
                case 'copy-sel-headers':
                    this.copySelectedHeaders();
                    break;
                case 'copy-cell-11':
                    this.copyCurrentCell();
                    break;
                case 'copy-sql-list':
                    this.copySqlValuesList();
                    break;
                case 'find-data':
                    this.findDataInGrid();
                    break;
                case 'find-column':
                    this.findColumnInGrid();
                    break;
                case 'show-aggregates':
                    this.showGridAggregates();
                    break;
                case 'script-data':
                    this.scriptAsInsert(true);
                    break;
                case 'copy-xml-excel':
                    this.copySelectionAsXmlSpreadsheet();
                    break;
                case 'vis-text':
                    this.visualizeAs('text');
                    break;
                case 'vis-hex':
                    this.visualizeAs('hex');
                    break;
                case 'vis-json':
                    this.visualizeAs('json');
                    break;
                case 'vis-xml':
                    this.visualizeAs('xml');
                    break;
                case 'vis-image':
                    this.visualizeAs('image');
                    break;
                case 'copy':
                    this.copy(false);
                    break;
                case 'copy-headers':
                    this.copyWithHeaders();
                    break;
                case 'select-all':
                    this.selectAll();
                    break;
                case 'script-insert':
                    this.scriptAsInsert(false);
                    break;
                case 'open-excel':
                    this.openInExcel();
                    break;
                case 'save-results':
                    this.saveResultsAs();
                    break;
                case 'page-setup':
                    notify('Thiết lập in: Định dạng A4, hướng trang Ngang (Landscape), canh lề tự động', 'info');
                    break;
                case 'print':
                    this.printGrid();
                    break;
                default:
                    console.log('Action not implemented', actionId);
            }
        }
    }

    // ── Active Context Menu Singleton ────────────────────────────────────────
    let activeGridMenu = null;

    function closeActiveGridMenu() {
        if (activeGridMenu) {
            activeGridMenu.remove();
            activeGridMenu = null;
        }
    }

    document.addEventListener('click', (e) => {
        if (activeGridMenu && !activeGridMenu.contains(e.target)) {
            closeActiveGridMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeActiveGridMenu();
    });

    // ── String & Format Utilities ────────────────────────────────────────────
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeXml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function formatHexDump(str) {
        const bytes = new TextEncoder().encode(str);
        const lines = [];
        for (let i = 0; i < bytes.length; i += 16) {
            const chunk = bytes.slice(i, i + 16);
            const offset = i.toString(16).padStart(8, '0');
            const hexParts = [];
            let ascii = '';
            for (let j = 0; j < 16; j++) {
                if (j < chunk.length) {
                    hexParts.push(chunk[j].toString(16).padStart(2, '0'));
                    ascii += (chunk[j] >= 32 && chunk[j] <= 126) ? String.fromCharCode(chunk[j]) : '.';
                } else {
                    hexParts.push('  ');
                }
            }
            lines.push(`${offset}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`);
        }
        return lines.join('\n');
    }

    function formatXmlBeautify(xml) {
        let formatted = '';
        let indent = '';
        const tab = '  ';
        xml.split(/>\s*</).forEach(node => {
            if (node.match(/^\/\w/)) indent = indent.substring(tab.length);
            formatted += indent + '<' + node + '>\r\n';
            if (node.match(/^<?\w[^>]*[^\/]$/)) indent += tab;
        });
        return escapeXml(formatted.substring(1, formatted.length - 3));
    }

    // ── Public API ───────────────────────────────────────────────────────────
    const attachedGrids = new WeakMap();

    global.GridResultManager = {
        attach(table, resSet, gridIndex) {
            if (!table) return null;
            if (attachedGrids.has(table)) {
                attachedGrids.get(table).destroy();
            }
            const instance = new GridResultInstance(table, resSet, gridIndex);
            attachedGrids.set(table, instance);
            return instance;
        },
        getInstance(table) {
            return attachedGrids.get(table) || null;
        }
    };

})(window);
