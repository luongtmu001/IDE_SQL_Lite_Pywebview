/**
 * result-comparator.js
 * Quản lý So Sánh Hai Tập Kết Quả Truy Vấn (Query Results Diff Engine & Visual AG-Grid).
 * Hỗ trợ Pop-out Window độc lập, AG-Grid Quartz, Lazy load cột, Lọc khóa & Cột tùy chọn,
 * Thông tin kết nối chi tiết, và Loại bỏ header thừa khi đếm dòng.
 */

(function (global) {
    'use strict';

    // ── Helper escapeHtml chống XSS ──────────────────────────────────────────
    function escapeHtml(str) {
        if (typeof window.escapeHtml === 'function') {
            return window.escapeHtml(str);
        }
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ── Helper Toast ─────────────────────────────────────────────────────────
    function notify(message, type = 'info') {
        if (typeof global.showToast === 'function') {
            global.showToast(message, type);
        } else {
            console.log(`[ResultComparator ${type}] ${message}`);
        }
    }

    // ── Data Row Cleaner (Bảo đảm không đếm header là 1 dòng dữ liệu) ───────
    function cleanDataRows(rows, columns) {
        if (!Array.isArray(rows) || rows.length === 0) return [];
        const colNames = (columns || []).map(c => {
            const raw = (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c);
            return raw.trim().toLowerCase();
        });

        // Kiểm tra xem dòng đầu tiên có phải là danh sách tên cột bị đính kèm hay không
        const firstRow = rows[0];
        if (Array.isArray(firstRow) && colNames.length > 0 && firstRow.length === colNames.length) {
            const isHeaderRow = colNames.every((colName, idx) => {
                const val = String(firstRow[idx] ?? '').trim().toLowerCase();
                return colName === val;
            });
            if (isHeaderRow) {
                return rows.slice(1);
            }
        }
        return rows;
    }

    // ── Cell Value Normalizer ────────────────────────────────────────────────
    function normalizeValue(val) {
        if (val === null || val === undefined) {
            return null;
        }
        if (typeof val === 'number') {
            return val;
        }
        if (typeof val === 'boolean') {
            return val;
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            // Nếu là chuỗi số học chuẩn (e.g. "123", "45.6700") -> chuẩn hóa số để so sánh
            if (trimmed !== '' && !isNaN(Number(trimmed)) && !trimmed.startsWith('0x') && trimmed.length < 25) {
                const num = Number(trimmed);
                if (Number.isFinite(num)) {
                    return num;
                }
            }
            return trimmed;
        }
        if (typeof val === 'object') {
            try {
                return JSON.stringify(val);
            } catch (_) {
                return String(val);
            }
        }
        return String(val);
    }

    // ── Check if two values are equal ────────────────────────────────────────
    function areValuesEqual(valA, valB) {
        const normA = normalizeValue(valA);
        const normB = normalizeValue(valB);

        if (normA === null && normB === null) return true;
        if (normA === null || normB === null) return false;

        if (typeof normA === 'number' && typeof normB === 'number') {
            return Math.abs(normA - normB) < 1e-9;
        }

        return String(normA) === String(normB);
    }

    // ── Core Diff Engine ─────────────────────────────────────────────────────
    class ResultDiffEngine {
        /**
         * @param {Object} sourceA { title, columns, rows }
         * @param {Object} sourceB { title, columns, rows }
         * @param {Array<string>} keyColumns Danh sách tên cột dùng làm khóa so khớp dòng
         * @param {Array<string>} compareColumns Danh sách tên cột được chọn để so sánh giá trị
         */
        static compare(sourceA, sourceB, keyColumns = [], compareColumns = null) {
            const rawRowsA = sourceA?.rows || [];
            const rawRowsB = sourceB?.rows || [];
            const rawColsA = sourceA?.columns || [];
            const rawColsB = sourceB?.columns || [];

            // Chuẩn hóa danh sách cột và làm sạch dòng (loại bỏ header nếu bị đếm trùng)
            const colsA = rawColsA.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));
            const colsB = rawColsB.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));

            const rowsA = cleanDataRows(rawRowsA, colsA);
            const rowsB = cleanDataRows(rawRowsB, colsB);

            const colMapA = new Map(colsA.map((c, i) => [c.toLowerCase(), { name: c, index: i }]));
            const colMapB = new Map(colsB.map((c, i) => [c.toLowerCase(), { name: c, index: i }]));

            // Cột chung giữa 2 tập kết quả
            const commonCols = [];
            const allColNames = [];
            const addedInCols = [];
            const removedInCols = [];

            colsA.forEach(c => {
                allColNames.push(c);
                if (colMapB.has(c.toLowerCase())) {
                    commonCols.push(c);
                } else {
                    removedInCols.push(c);
                }
            });

            colsB.forEach(c => {
                if (!colMapA.has(c.toLowerCase())) {
                    allColNames.push(c);
                    addedInCols.push(c);
                }
            });

            // Xác định danh sách các cột được kích hoạt để so sánh giá trị
            let activeCompareCols = [];
            if (Array.isArray(compareColumns) && compareColumns.length > 0) {
                const selSet = new Set(compareColumns.map(c => c.toLowerCase()));
                activeCompareCols = commonCols.filter(c => selSet.has(c.toLowerCase()));
            } else {
                activeCompareCols = [...commonCols];
            }

            // Xác định key columns và index
            let effectiveKeyCols = Array.isArray(keyColumns) ? [...keyColumns] : [];
            if (effectiveKeyCols.length === 0) {
                // Tự động tìm PK tiềm năng: id, *_id, code, hoặc cột đầu tiên nếu cả 2 cùng có
                const candidate = commonCols.find(c => {
                    const lc = c.toLowerCase();
                    return lc === 'id' || lc.endsWith('_id') || lc.endsWith('id') || lc === 'code';
                }) || commonCols[0];
                if (candidate) {
                    effectiveKeyCols = [candidate];
                }
            }

            // Lấy index các cột key trong A và B
            const keyIndicesA = effectiveKeyCols.map(kc => colMapA.get(kc.toLowerCase())?.index).filter(idx => idx !== undefined);
            const keyIndicesB = effectiveKeyCols.map(kc => colMapB.get(kc.toLowerCase())?.index).filter(idx => idx !== undefined);

            const useFullRowHash = (keyIndicesA.length === 0 || keyIndicesB.length === 0);

            function buildRowKey(row, indices, isFullFallbackCols, colMap) {
                if (!row) return '';
                if (useFullRowHash || isFullFallbackCols) {
                    const parts = [];
                    for (const colName of activeCompareCols) {
                        const idx = colMap.get(colName.toLowerCase())?.index;
                        parts.push(idx !== undefined ? String(normalizeValue(row[idx])) : '');
                    }
                    return parts.join('\x1f');
                }
                const parts = [];
                for (const idx of indices) {
                    parts.push(String(normalizeValue(row[idx])));
                }
                return parts.join('\x1f');
            }

            // Xây dựng Map dòng của A: Map<key, Array<{ row, originalIdx, used }>>
            const mapA = new Map();
            for (let i = 0; i < rowsA.length; i++) {
                const r = rowsA[i];
                const key = buildRowKey(r, keyIndicesA, false, colMapA);
                let list = mapA.get(key);
                if (!list) {
                    list = [];
                    mapA.set(key, list);
                }
                list.push({ row: r, originalIdx: i, used: false });
            }

            const diffRows = [];
            let equalCount = 0;
            let modifiedCount = 0;
            let onlyACount = 0;
            let onlyBCount = 0;

            // Duyệt tập B
            for (let j = 0; j < rowsB.length; j++) {
                const rB = rowsB[j];
                const key = buildRowKey(rB, keyIndicesB, false, colMapB);
                const candidates = mapA.get(key);

                let matchedItem = null;
                if (candidates) {
                    matchedItem = candidates.find(item => !item.used);
                }

                if (matchedItem) {
                    matchedItem.used = true;
                    const rA = matchedItem.row;

                    // So sánh các cột được kích hoạt (activeCompareCols)
                    const diffMap = {};
                    let hasDifference = false;

                    for (const c of activeCompareCols) {
                        const idxA = colMapA.get(c.toLowerCase())?.index;
                        const idxB = colMapB.get(c.toLowerCase())?.index;
                        const valA = idxA !== undefined ? rA[idxA] : null;
                        const valB = idxB !== undefined ? rB[idxB] : null;

                        if (!areValuesEqual(valA, valB)) {
                            hasDifference = true;
                            diffMap[c] = { valA, valB };
                        }
                    }

                    if (hasDifference) {
                        modifiedCount++;
                        diffRows.push({
                            status: 'MODIFIED',
                            key,
                            rowA: rA,
                            rowB: rB,
                            diffMap,
                            idxA: matchedItem.originalIdx,
                            idxB: j
                        });
                    } else {
                        equalCount++;
                        diffRows.push({
                            status: 'EQUAL',
                            key,
                            rowA: rA,
                            rowB: rB,
                            diffMap: {},
                            idxA: matchedItem.originalIdx,
                            idxB: j
                        });
                    }
                } else {
                    onlyBCount++;
                    diffRows.push({
                        status: 'ONLY_B',
                        key,
                        rowA: null,
                        rowB: rB,
                        diffMap: {},
                        idxA: null,
                        idxB: j
                    });
                }
            }

            // Duyệt lại các phần tử chưa match trong A -> ONLY_A
            for (const [, list] of mapA.entries()) {
                for (const item of list) {
                    if (!item.used) {
                        onlyACount++;
                        diffRows.push({
                            status: 'ONLY_A',
                            key: buildRowKey(item.row, keyIndicesA, false, colMapA),
                            rowA: item.row,
                            rowB: null,
                            diffMap: {},
                            idxA: item.originalIdx,
                            idxB: null
                        });
                    }
                }
            }

            return {
                summary: {
                    totalA: rowsA.length,
                    totalB: rowsB.length,
                    equal: equalCount,
                    modified: modifiedCount,
                    onlyA: onlyACount,
                    onlyB: onlyBCount,
                    totalDiffs: modifiedCount + onlyACount + onlyBCount,
                    commonColumns: commonCols,
                    compareColumns: activeCompareCols,
                    removedColumnsInB: removedInCols,
                    addedColumnsInB: addedInCols,
                    keyColumns: effectiveKeyCols,
                    useFullRowHash
                },
                diffRows,
                columns: allColNames,
                commonColumns: commonCols,
                compareColumns: activeCompareCols,
                colMapA,
                colMapB
            };
        }
    }

    // ── Result Comparator UI Controller ─────────────────────────────────────
    class ResultComparatorUI {
        constructor() {
            this.modalEl = null;
            this.agGridDiv = null;
            this.gridApi = null;
            this.currentDiffResult = null;
            this.currentFilter = 'all'; // 'all' | 'diff' | 'modified' | 'only_a' | 'only_b' | 'equal'
            this.sourceList = [];
            this.selectedSourceA = null;
            this.selectedSourceB = null;
            this.allUnionColumns = []; // Array<{ name, inA: bool, inB: bool }>
            this.selectedCompareCols = new Set();
            this.selectedKeyCols = new Set();
            this.isStandaloneWindow = false;

            // Lazy loading state for column picker
            this.columnChunkSize = 50;
            this.renderedColumnsCount = 0;
            this.currentColumnFilterText = '';
        }

        /**
         * Initialize in Standalone Pop-out Window mode
         */
        initStandaloneWindow(initialData = null) {
            this.isStandaloneWindow = true;
            this.agGridDiv = document.getElementById('ide-result-diff-aggrid');
            this.bindEvents();

            if (initialData && Array.isArray(initialData.sources) && initialData.sources.length > 0) {
                this.sourceList = initialData.sources.map(s => ({
                    ...s,
                    rows: cleanDataRows(s.rows, s.columns)
                }));
                this.populateSourceSelects(initialData.preselectAIndex ?? 0, initialData.preselectBIndex ?? 1);
            } else {
                this.scanAvailableSources();
                this.populateSourceSelects(0, 1);
            }

            if (this.sourceList.length >= 2) {
                setTimeout(() => this.runComparison(), 150);
            }
        }

        initModal() {
            if (this.modalEl || this.isStandaloneWindow) return;

            const modalHtml = `
            <div class="modal fade" id="ide-result-diff-modal" tabindex="-1" aria-labelledby="ideResultDiffModalLabel" aria-hidden="true" data-bs-backdrop="static">
                <div class="modal-dialog modal-fullscreen-xl-down modal-xl modal-dialog-scrollable" style="max-width: 96vw; height: 94vh;">
                    <div class="modal-content border-secondary shadow-lg d-flex flex-column" style="background: var(--ide-bg-sidebar, #1e1e1e); color: var(--ide-text-main, #d4d4d4); height: 100%;">
                        
                        <!-- Header -->
                        <div class="modal-header py-2 px-3 border-bottom border-secondary d-flex justify-content-between align-items-center" style="background: var(--ide-bg-toolbar, #252526);">
                            <div class="d-flex align-items-center gap-2">
                                <i class="fa-solid fa-code-compare text-info fs-5"></i>
                                <h6 class="modal-title m-0 fw-bold" id="ideResultDiffModalLabel">So sánh kết quả truy vấn (Result Diff)</h6>
                                <span class="badge bg-primary-subtle text-primary border border-primary small ms-2">AG-Grid</span>
                            </div>
                            <div class="d-flex align-items-center gap-2">
                                <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" id="diff-btn-popout" title="Mở thành cửa sổ riêng biệt độc lập">
                                    <i class="fa-solid fa-up-right-from-square me-1"></i> Cửa sổ mới
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-info" id="diff-btn-monaco-view" title="Xem dạng Monaco Diff Text">
                                    <i class="fa-solid fa-file-lines me-1"></i> Monaco Diff
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" id="diff-btn-export-csv" title="Xuất kết quả Diff ra CSV">
                                    <i class="fa-solid fa-download me-1"></i> Xuất CSV
                                </button>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                        </div>

                        <!-- Config Toolbar -->
                        <div class="px-3 py-2 border-bottom border-secondary" style="background: var(--ide-bg-editor, #1a1a1a); font-size: 13px;">
                            <div class="row g-2 align-items-start">
                                <div class="col-md-4">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label mb-0 text-warning fw-semibold small">
                                            <i class="fa-solid fa-database text-warning me-1"></i>Tập kết quả A (Gốc):
                                        </label>
                                        <span id="diff-source-a-count-tag" class="badge bg-secondary-subtle text-secondary small font-monospace">0 dòng</span>
                                    </div>
                                    <select class="form-select form-select-sm bg-dark text-light border-secondary" id="diff-select-source-a"></select>
                                    <div id="diff-conn-info-a" class="diff-conn-badge-bar mt-1 d-flex flex-wrap gap-1 align-items-center"></div>
                                </div>
                                <div class="col-md-4">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label mb-0 text-success fw-semibold small">
                                            <i class="fa-solid fa-database text-success me-1"></i>Tập kết quả B (Mới / Đối chiếu):
                                        </label>
                                        <span id="diff-source-b-count-tag" class="badge bg-secondary-subtle text-secondary small font-monospace">0 dòng</span>
                                    </div>
                                    <select class="form-select form-select-sm bg-dark text-light border-secondary" id="diff-select-source-b"></select>
                                    <div id="diff-conn-info-b" class="diff-conn-badge-bar mt-1 d-flex flex-wrap gap-1 align-items-center"></div>
                                </div>
                                <div class="col-md-3">
                                    <div class="d-flex align-items-center justify-content-between mb-1">
                                        <label class="form-label mb-0 text-info fw-semibold small">
                                            <i class="fa-solid fa-columns text-info me-1"></i>Cột so sánh &amp; Khóa:
                                        </label>
                                        <span id="diff-col-selected-summary" class="badge bg-info-subtle text-info small">0 cột chọn</span>
                                    </div>
                                    <div class="dropdown w-100">
                                        <button class="btn btn-sm btn-outline-secondary dropdown-toggle w-100 text-truncate text-start d-flex justify-content-between align-items-center"
                                            type="button" id="diff-key-cols-btn" data-bs-toggle="dropdown" data-bs-auto-close="outside">
                                            <span class="text-truncate" id="diff-key-cols-btn-label">Chọn cột so sánh...</span>
                                        </button>
                                        <div class="dropdown-menu dropdown-menu-dark p-2 border-secondary shadow-lg diff-col-picker-menu" id="diff-key-cols-menu-container"
                                            style="width: 360px; max-width: 90vw; background: var(--ide-bg-sidebar, #1f2128);">
                                            <div class="input-group input-group-sm mb-2">
                                                <span class="input-group-text bg-dark border-secondary text-secondary"><i class="fa-solid fa-magnifying-glass"></i></span>
                                                <input type="text" class="form-control bg-dark text-light border-secondary" id="diff-col-search-input"
                                                    placeholder="Tìm nhanh tên cột..." autocomplete="off" spellcheck="false" style="font-size: 12px;">
                                                <button class="btn btn-outline-secondary" type="button" id="diff-col-search-clear"><i class="fa-solid fa-xmark"></i></button>
                                            </div>
                                            <div class="d-flex align-items-center justify-content-between gap-1 mb-2 pb-1 border-bottom border-secondary">
                                                <button type="button" class="btn btn-xs btn-outline-primary py-0 px-1" id="diff-col-btn-all" style="font-size: 11px;">Chọn tất cả</button>
                                                <button type="button" class="btn btn-xs btn-outline-info py-0 px-1" id="diff-col-btn-common" style="font-size: 11px;">Chỉ cột chung</button>
                                                <button type="button" class="btn btn-xs btn-outline-secondary py-0 px-1" id="diff-col-btn-none" style="font-size: 11px;">Bỏ chọn</button>
                                            </div>
                                            <ul class="list-unstyled mb-0 diff-col-scrollable-list" id="diff-key-cols-menu"
                                                style="max-height: 250px; overflow-y: auto; font-size: 12px;"></ul>
                                        </div>
                                    </div>
                                    <div class="small text-secondary mt-1 d-flex justify-content-between" style="font-size: 11px;">
                                        <span id="diff-keys-hint">🔑 Khóa: id / PK</span>
                                        <span id="diff-col-union-stats">0 cột gộp</span>
                                    </div>
                                </div>
                                <div class="col-md-1 d-flex align-items-end pt-1">
                                    <button class="btn btn-sm btn-primary w-100 fw-bold" id="diff-btn-run-compare" title="Thực hiện so sánh" style="height: 31px; margin-top: 20px;">
                                        <i class="fa-solid fa-play me-1"></i> So
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards & Filter Pills -->
                        <div class="px-3 py-2 border-bottom border-secondary d-flex flex-wrap justify-content-between align-items-center gap-2" style="background: var(--ide-bg-sidebar, #222);">
                            <div class="btn-group btn-group-sm" role="group" id="diff-filter-group">
                                <button type="button" class="btn btn-outline-secondary active" data-filter="all">
                                    Tất cả (<span id="diff-count-total" class="font-monospace">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-warning" data-filter="diff">
                                    <i class="fa-solid fa-circle-exclamation me-1"></i>Chỉ sai khác (<span id="diff-count-diffs" class="font-monospace">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-warning" data-filter="modified">
                                    <i class="fa-solid fa-pen-to-square me-1"></i>Khác giá trị (<span id="diff-count-modified" class="font-monospace">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-danger" data-filter="only_a">
                                    <i class="fa-solid fa-minus me-1"></i>Chỉ ở A (<span id="diff-count-only-a" class="font-monospace">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-success" data-filter="only_b">
                                    <i class="fa-solid fa-plus me-1"></i>Chỉ ở B (<span id="diff-count-only-b" class="font-monospace">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-secondary" data-filter="equal">
                                    <i class="fa-solid fa-check me-1"></i>Khớp hoàn toàn (<span id="diff-count-equal" class="font-monospace">0</span>)
                                </button>
                            </div>

                            <div class="small d-flex align-items-center gap-3 text-secondary" id="diff-extra-info" style="font-size: 11px;">
                                <span id="diff-cols-warning" class="text-warning d-none">
                                    <i class="fa-solid fa-triangle-exclamation me-1"></i><span id="diff-cols-warning-text"></span>
                                </span>
                                <span><span class="badge bg-danger-subtle text-danger border border-danger me-1">-</span>Xóa ở B</span>
                                <span><span class="badge bg-success-subtle text-success border border-success me-1">+</span>Thêm ở B</span>
                                <span><span class="badge bg-warning-subtle text-warning border border-warning me-1">~</span>Đổi giá trị</span>
                            </div>
                        </div>

                        <!-- Diff Grid Body -->
                        <div class="modal-body p-0 flex-grow-1 position-relative" style="background: var(--ide-bg-editor, #1e1e1e); min-height: 380px;">
                            <div id="ide-result-diff-aggrid" class="ag-theme-quartz-dark w-100 h-100"></div>
                            <div id="ide-result-diff-empty" class="position-absolute top-50 start-50 translate-middle text-center text-muted" style="display: none;">
                                <i class="fa-solid fa-code-compare fs-1 mb-2 opacity-50 text-info"></i>
                                <div class="fs-6 fw-semibold text-light">Chưa có kết quả so sánh</div>
                                <div class="small text-secondary">Vui lòng chọn 2 tập kết quả và bấm nút "So" để bắt đầu.</div>
                            </div>
                        </div>

                        <!-- Footer -->
                        <div class="modal-footer py-1 px-3 border-top border-secondary d-flex justify-content-between align-items-center" style="background: var(--ide-bg-toolbar, #252526); font-size: 12px;">
                            <div class="d-flex align-items-center gap-2">
                                <span class="badge bg-secondary-subtle text-light font-monospace" id="diff-status-indicator">READY</span>
                                <span id="diff-status-text" class="text-secondary">Sẵn sàng so sánh</span>
                            </div>
                            <div>
                                <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Đóng</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
            this.modalEl = document.getElementById('ide-result-diff-modal');
            this.agGridDiv = document.getElementById('ide-result-diff-aggrid');

            this.bindEvents();
        }

        bindEvents() {
            const runBtn = document.getElementById('diff-btn-run-compare');
            if (runBtn && !runBtn._diffBound) {
                runBtn._diffBound = true;
                runBtn.addEventListener('click', () => this.runComparison());
            }

            const selectA = document.getElementById('diff-select-source-a');
            const selectB = document.getElementById('diff-select-source-b');
            if (selectA && !selectA._diffBound) {
                selectA._diffBound = true;
                selectA.addEventListener('change', () => this.onSourceChanged());
            }
            if (selectB && !selectB._diffBound) {
                selectB._diffBound = true;
                selectB.addEventListener('change', () => this.onSourceChanged());
            }

            const filterBtns = document.querySelectorAll('#diff-filter-group button');
            filterBtns.forEach(btn => {
                if (!btn._diffBound) {
                    btn._diffBound = true;
                    btn.addEventListener('click', () => {
                        filterBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        this.currentFilter = btn.dataset.filter || 'all';
                        this.applyFilter();
                    });
                }
            });

            const monacoBtn = document.getElementById('diff-btn-monaco-view');
            if (monacoBtn && !monacoBtn._diffBound) {
                monacoBtn._diffBound = true;
                monacoBtn.addEventListener('click', () => this.openInMonacoDiff());
            }

            const exportCsvBtn = document.getElementById('diff-btn-export-csv');
            if (exportCsvBtn && !exportCsvBtn._diffBound) {
                exportCsvBtn._diffBound = true;
                exportCsvBtn.addEventListener('click', () => this.exportCsv());
            }

            const popoutBtn = document.getElementById('diff-btn-popout');
            if (popoutBtn && !popoutBtn._diffBound) {
                popoutBtn._diffBound = true;
                popoutBtn.addEventListener('click', () => this.popoutToStandaloneWindow());
            }

            const refreshBtn = document.getElementById('diff-btn-refresh-sources');
            if (refreshBtn && !refreshBtn._diffBound) {
                refreshBtn._diffBound = true;
                refreshBtn.addEventListener('click', () => {
                    this.scanAvailableSources();
                    this.populateSourceSelects();
                    notify('Đã làm mới danh sách tập kết quả.', 'info');
                });
            }

            // Bind Column search & action buttons
            const searchInput = document.getElementById('diff-col-search-input');
            const clearSearchBtn = document.getElementById('diff-col-search-clear');
            if (searchInput && !searchInput._diffBound) {
                searchInput._diffBound = true;
                searchInput.addEventListener('input', (e) => {
                    this.currentColumnFilterText = (e.target.value || '').trim().toLowerCase();
                    this.renderedColumnsCount = 0;
                    this.renderKeyColumnsMenu();
                });
            }
            if (clearSearchBtn && !clearSearchBtn._diffBound) {
                clearSearchBtn._diffBound = true;
                clearSearchBtn.addEventListener('click', () => {
                    if (searchInput) {
                        searchInput.value = '';
                        this.currentColumnFilterText = '';
                        this.renderedColumnsCount = 0;
                        this.renderKeyColumnsMenu();
                    }
                });
            }

            const btnAll = document.getElementById('diff-col-btn-all');
            const btnNone = document.getElementById('diff-col-btn-none');
            const btnCommon = document.getElementById('diff-col-btn-common');

            if (btnAll && !btnAll._diffBound) {
                btnAll._diffBound = true;
                btnAll.addEventListener('click', () => {
                    this.selectedCompareCols = new Set(this.allUnionColumns.map(c => c.name.toLowerCase()));
                    this.refreshButtonLabel();
                    this.renderKeyColumnsMenu();
                });
            }

            if (btnNone && !btnNone._diffBound) {
                btnNone._diffBound = true;
                btnNone.addEventListener('click', () => {
                    this.selectedCompareCols.clear();
                    this.refreshButtonLabel();
                    this.renderKeyColumnsMenu();
                });
            }

            if (btnCommon && !btnCommon._diffBound) {
                btnCommon._diffBound = true;
                btnCommon.addEventListener('click', () => {
                    const commonCols = this.allUnionColumns.filter(c => c.inA && c.inB).map(c => c.name.toLowerCase());
                    this.selectedCompareCols = new Set(commonCols);
                    this.refreshButtonLabel();
                    this.renderKeyColumnsMenu();
                });
            }

            // Lazy scroll listener on column menu
            const menuEl = document.getElementById('diff-key-cols-menu');
            if (menuEl && !menuEl._diffScrollBound) {
                menuEl._diffScrollBound = true;
                menuEl.addEventListener('scroll', () => {
                    if (menuEl.scrollTop + menuEl.clientHeight >= menuEl.scrollHeight - 25) {
                        this.appendMoreColumnsToMenu();
                    }
                });
            }
        }

        /**
         * Lấy tất cả các Grid Result đang hiển thị trong các tab của IDE kèm thông tin kết nối chi tiết.
         */
        scanAvailableSources() {
            const list = [];

            if (window.GridResultManager && typeof window.GridResultManager.getAllInstances === 'function') {
                const instances = window.GridResultManager.getAllInstances();
                instances.forEach((inst, idx) => {
                    if (!inst || !inst.rows || !inst.columns) return;
                    const tabPane = inst.table?.closest('.ide-tab-pane') || inst.pane?.closest('.ide-tab-pane');
                    const tabId = tabPane ? (tabPane.dataset.tabId || tabPane.id) : `tab-${idx}`;
                    
                    // Lấy tiêu đề tab từ tab bar
                    let tabTitle = `Tab ${tabId}`;
                    const tabBtn = document.querySelector(`.ide-tab[data-tab-id="${tabId}"]`);
                    if (tabBtn) {
                        const titleSpan = tabBtn.querySelector('.ide-tab-title');
                        if (titleSpan && titleSpan.textContent.trim()) {
                            tabTitle = titleSpan.textContent.trim();
                        }
                    }

                    // Trích xuất metadata kết nối của Tab
                    let connectionName = '';
                    let database = '';
                    let schema = '';
                    let dbType = '';
                    let environment = '';

                    if (window.AppTabs && typeof window.AppTabs.getTab === 'function') {
                        const tabState = window.AppTabs.getTab(tabId);
                        if (tabState) {
                            connectionName = tabState.connectionName || '';
                            database = tabState.database || '';
                            schema = tabState.schema || '';
                            dbType = tabState.dbType || '';
                            environment = tabState.environment || '';
                        }
                    }

                    // Fallback to active context if tab-specific context is empty
                    if (!connectionName && window.ActiveConnectionName) connectionName = window.ActiveConnectionName;
                    if (!database && window.ActiveDatabase) database = window.ActiveDatabase;
                    if (!schema && window.ActiveSchema) schema = window.ActiveSchema;
                    if (!dbType && window.ActiveDbType) dbType = window.ActiveDbType;
                    if (!environment && window.ActiveEnvironment) environment = window.ActiveEnvironment;

                    // Clean data rows (bảo đảm trừ header ra khỏi số lượng dòng)
                    const cleanRows = cleanDataRows(inst.rows, inst.columns);

                    // Xây dựng nhãn hiển thị cho option
                    const connTag = connectionName ? ` — 🔌 ${connectionName}${database ? ' · ' + database : ''}` : '';
                    const displayTitle = `[${tabTitle}] Kết quả #${(inst.gridIndex || 0) + 1} (${cleanRows.length} dòng, ${inst.columns.length} cột)${connTag}`;

                    list.push({
                        id: `grid-${idx}`,
                        title: displayTitle,
                        columns: inst.columns,
                        rows: cleanRows,
                        tabTitle: tabTitle,
                        gridIndex: inst.gridIndex || 0,
                        connectionName: connectionName || 'Local Session',
                        database: database || '',
                        schema: schema || '',
                        dbType: dbType || 'sql',
                        environment: environment || ''
                    });
                });
            }

            this.sourceList = list;
            return list;
        }

        populateSourceSelects(preselectAIndex = 0, preselectBIndex = 1) {
            const selectA = document.getElementById('diff-select-source-a');
            const selectB = document.getElementById('diff-select-source-b');
            if (!selectA || !selectB) return;

            selectA.innerHTML = '';
            selectB.innerHTML = '';

            if (this.sourceList.length === 0) {
                const optA = document.createElement('option');
                optA.value = '';
                optA.textContent = '(Không tìm thấy kết quả truy vấn nào đang mở)';
                selectA.appendChild(optA);

                const optB = document.createElement('option');
                optB.value = '';
                optB.textContent = '(Không tìm thấy kết quả truy vấn nào đang mở)';
                selectB.appendChild(optB);
                this.updateConnectionInfoBadge('a', null);
                this.updateConnectionInfoBadge('b', null);
                return;
            }

            this.sourceList.forEach((src, idx) => {
                const optA = document.createElement('option');
                optA.value = idx;
                optA.textContent = src.title;
                selectA.appendChild(optA);

                const optB = document.createElement('option');
                optB.value = idx;
                optB.textContent = src.title;
                selectB.appendChild(optB);
            });

            if (selectA.options.length > preselectAIndex) selectA.selectedIndex = preselectAIndex;
            if (selectB.options.length > preselectBIndex) {
                selectB.selectedIndex = preselectBIndex;
            } else if (selectB.options.length > 0) {
                selectB.selectedIndex = (selectA.selectedIndex + 1) % selectB.options.length;
            }

            this.onSourceChanged();
        }

        onSourceChanged() {
            const selectA = document.getElementById('diff-select-source-a');
            const selectB = document.getElementById('diff-select-source-b');
            const idxA = parseInt(selectA?.value, 10);
            const idxB = parseInt(selectB?.value, 10);

            this.selectedSourceA = (!isNaN(idxA) && this.sourceList[idxA]) ? this.sourceList[idxA] : null;
            this.selectedSourceB = (!isNaN(idxB) && this.sourceList[idxB]) ? this.sourceList[idxB] : null;

            // Update row count tags
            const tagA = document.getElementById('diff-source-a-count-tag');
            if (tagA) {
                const cntA = this.selectedSourceA?.rows?.length ?? 0;
                tagA.textContent = `${cntA.toLocaleString()} dòng`;
            }

            const tagB = document.getElementById('diff-source-b-count-tag');
            if (tagB) {
                const cntB = this.selectedSourceB?.rows?.length ?? 0;
                tagB.textContent = `${cntB.toLocaleString()} dòng`;
            }

            // Hiển thị thông tin kết nối chi tiết cho Source A & B
            this.updateConnectionInfoBadge('a', this.selectedSourceA);
            this.updateConnectionInfoBadge('b', this.selectedSourceB);

            this.rebuildUnionColumns();
        }

        /**
         * Render badge thông tin kết nối (Server, Database, Schema, DB Type, Env)
         */
        updateConnectionInfoBadge(targetKey, source) {
            const container = document.getElementById(`diff-conn-info-${targetKey}`);
            if (!container) return;

            if (!source) {
                container.innerHTML = '<span class="diff-conn-badge text-muted small fst-italic">Chưa có nguồn dữ liệu</span>';
                return;
            }

            const badges = [];

            // Server / Connection Name
            if (source.connectionName) {
                badges.push(`
                    <span class="diff-conn-badge diff-badge-server" title="Máy chủ / Tên kết nối">
                        <i class="fa-solid fa-server me-1"></i>${escapeHtml(source.connectionName)}
                    </span>
                `);
            }

            // Database
            if (source.database) {
                badges.push(`
                    <span class="diff-conn-badge diff-badge-db" title="Cơ sở dữ liệu">
                        <i class="fa-solid fa-database me-1"></i>${escapeHtml(source.database)}
                    </span>
                `);
            }

            // Schema
            if (source.schema) {
                badges.push(`
                    <span class="diff-conn-badge diff-badge-schema" title="Lược đồ Schema">
                        <i class="fa-solid fa-layer-group me-1"></i>${escapeHtml(source.schema)}
                    </span>
                `);
            }

            // DB Type
            if (source.dbType) {
                badges.push(`
                    <span class="diff-conn-badge diff-badge-type" title="Hệ quản trị CSDL">
                        ${escapeHtml(source.dbType.toUpperCase())}
                    </span>
                `);
            }

            // Environment (DEV, TEST, PROD)
            if (source.environment) {
                const envLower = source.environment.toLowerCase();
                const envClass = (envLower === 'prod' || envLower === 'production') ? 'diff-badge-env-prod'
                    : (envLower === 'test' || envLower === 'staging' || envLower === 'uat') ? 'diff-badge-env-test'
                    : 'diff-badge-env-dev';
                badges.push(`
                    <span class="diff-conn-badge ${envClass}" title="Môi trường kết nối">
                        <i class="fa-solid fa-shield-halved me-1"></i>${escapeHtml(source.environment.toUpperCase())}
                    </span>
                `);
            }

            if (badges.length === 0) {
                badges.push('<span class="diff-conn-badge text-muted small"><i class="fa-solid fa-link me-1"></i>Phiên kết nối mặc định</span>');
            }

            container.innerHTML = badges.join('');
        }

        /**
         * Xây dựng danh sách Gộp tất cả các cột của Source A và Source B (Trùng nhau thì giữ lại 1)
         */
        rebuildUnionColumns() {
            if (!this.selectedSourceA || !this.selectedSourceB) {
                this.allUnionColumns = [];
                this.selectedCompareCols.clear();
                this.refreshButtonLabel();
                this.renderKeyColumnsMenu();
                return;
            }

            const rawColsA = this.selectedSourceA.columns || [];
            const rawColsB = this.selectedSourceB.columns || [];

            const colsA = rawColsA.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));
            const colsB = rawColsB.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));

            const unionMap = new Map();

            colsA.forEach(c => {
                const key = c.toLowerCase();
                unionMap.set(key, { name: c, inA: true, inB: false });
            });

            colsB.forEach(c => {
                const key = c.toLowerCase();
                const existing = unionMap.get(key);
                if (existing) {
                    existing.inB = true;
                } else {
                    unionMap.set(key, { name: c, inA: false, inB: true });
                }
            });

            this.allUnionColumns = Array.from(unionMap.values());

            // Mặc định chọn tất cả các cột chung giữa A & B để so sánh
            const commonCols = this.allUnionColumns.filter(c => c.inA && c.inB).map(c => c.name.toLowerCase());
            this.selectedCompareCols = new Set(commonCols.length > 0 ? commonCols : this.allUnionColumns.map(c => c.name.toLowerCase()));

            // Tự động gợi ý cột khóa (id, *_id, code)
            const suggestedKeys = this.allUnionColumns
                .filter(c => c.inA && c.inB)
                .map(c => c.name)
                .filter(c => {
                    const lc = c.toLowerCase();
                    return lc === 'id' || lc.endsWith('_id') || lc.endsWith('id') || lc === 'code';
                });
            this.selectedKeyCols = new Set(suggestedKeys.map(k => k.toLowerCase()));

            // Cập nhật thống kê cột gộp
            const unionStatsEl = document.getElementById('diff-col-union-stats');
            if (unionStatsEl) {
                unionStatsEl.textContent = `${this.allUnionColumns.length} cột gộp`;
            }

            this.renderedColumnsCount = 0;
            this.refreshButtonLabel();
            this.renderKeyColumnsMenu();
        }

        /**
         * Render giao diện danh sách cột với cơ chế Lazy Load (render theo từng chunk 50 cột)
         */
        renderKeyColumnsMenu() {
            const menu = document.getElementById('diff-key-cols-menu');
            if (!menu) return;

            menu.innerHTML = '';
            this.renderedColumnsCount = 0;

            if (this.allUnionColumns.length === 0) {
                menu.innerHTML = '<li class="p-2 text-muted small fst-italic text-center">Chưa chọn 2 tập kết quả hợp lệ</li>';
                return;
            }

            // Lọc danh sách cột theo chuỗi tìm kiếm
            const filter = this.currentColumnFilterText;
            const filteredCols = filter
                ? this.allUnionColumns.filter(c => c.name.toLowerCase().includes(filter))
                : this.allUnionColumns;

            if (filteredCols.length === 0) {
                menu.innerHTML = `<li class="p-2 text-muted small fst-italic text-center">Không tìm thấy cột phù hợp "${escapeHtml(filter)}"</li>`;
                return;
            }

            this.appendMoreColumnsToMenu(filteredCols);
        }

        appendMoreColumnsToMenu(filteredColsOverride = null) {
            const menu = document.getElementById('diff-key-cols-menu');
            if (!menu) return;

            const filter = this.currentColumnFilterText;
            const filteredCols = filteredColsOverride || (filter
                ? this.allUnionColumns.filter(c => c.name.toLowerCase().includes(filter))
                : this.allUnionColumns);

            const startIdx = this.renderedColumnsCount;
            if (startIdx >= filteredCols.length) return;

            const endIdx = Math.min(startIdx + this.columnChunkSize, filteredCols.length);
            const fragment = document.createDocumentFragment();

            for (let i = startIdx; i < endIdx; i++) {
                const item = filteredCols[i];
                const colKey = item.name.toLowerCase();
                const isChecked = this.selectedCompareCols.has(colKey);
                const isKey = this.selectedKeyCols.has(colKey);

                // Badge tag: Chung, Chỉ ở A, Chỉ ở B
                let badgeTag = '';
                if (item.inA && item.inB) {
                    badgeTag = '<span class="diff-col-tag badge bg-secondary-subtle text-secondary border border-secondary">Chung</span>';
                } else if (item.inA && !item.inB) {
                    badgeTag = '<span class="diff-col-tag badge bg-danger-subtle text-danger border border-danger">Chỉ ở A</span>';
                } else {
                    badgeTag = '<span class="diff-col-tag badge bg-success-subtle text-success border border-success">Chỉ ở B</span>';
                }

                const li = document.createElement('li');
                li.className = 'diff-col-item d-flex align-items-center justify-content-between';
                li.innerHTML = `
                    <div class="form-check m-0 d-flex align-items-center text-truncate">
                        <input class="form-check-input diff-col-chk me-2" type="checkbox" value="${escapeHtml(item.name)}" id="diff-col-chk-${escapeHtml(colKey)}" ${isChecked ? 'checked' : ''}>
                        <label class="form-check-label text-light small text-truncate" for="diff-col-chk-${escapeHtml(colKey)}" title="${escapeHtml(item.name)}">
                            ${isKey ? '<i class="fa-solid fa-key text-warning me-1 small" title="Cột khóa"></i>' : ''}
                            <span class="font-monospace">${escapeHtml(item.name)}</span>
                        </label>
                    </div>
                    <div class="d-flex align-items-center">
                        ${badgeTag}
                    </div>
                `;

                // Handle checkbox change
                const chk = li.querySelector('.diff-col-chk');
                chk.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (chk.checked) {
                        this.selectedCompareCols.add(colKey);
                    } else {
                        this.selectedCompareCols.delete(colKey);
                    }
                    this.refreshButtonLabel();
                });

                fragment.appendChild(li);
            }

            menu.appendChild(fragment);
            this.renderedColumnsCount = endIdx;

            // Nếu còn phần tử chưa render, thêm thông báo lazy
            const remaining = filteredCols.length - this.renderedColumnsCount;
            const existingMore = menu.querySelector('.diff-col-lazy-more');
            if (existingMore) existingMore.remove();

            if (remaining > 0) {
                const moreLi = document.createElement('li');
                moreLi.className = 'diff-col-lazy-more text-center text-muted small py-1 fst-italic';
                moreLi.textContent = `Cuộn xuống để xem thêm ${remaining} cột...`;
                menu.appendChild(moreLi);
            }
        }

        refreshButtonLabel() {
            const btnLabel = document.getElementById('diff-key-cols-btn-label');
            const summaryBadge = document.getElementById('diff-col-selected-summary');
            const totalCols = this.allUnionColumns.length;
            const selectedCount = this.selectedCompareCols.size;

            if (summaryBadge) {
                summaryBadge.textContent = `${selectedCount} / ${totalCols} cột`;
            }

            if (!btnLabel) return;

            if (selectedCount === 0) {
                btnLabel.textContent = 'Chưa chọn cột nào (Chọn ít nhất 1 cột)';
            } else if (selectedCount === totalCols && totalCols > 0) {
                btnLabel.textContent = `Tất cả ${totalCols} cột`;
            } else {
                const names = this.allUnionColumns
                    .filter(c => this.selectedCompareCols.has(c.name.toLowerCase()))
                    .map(c => c.name);
                if (names.length <= 2) {
                    btnLabel.textContent = `Cột: ${names.join(', ')}`;
                } else {
                    btnLabel.textContent = `Đã chọn ${selectedCount} cột (${names.slice(0, 2).join(', ')}...)`;
                }
            }
        }

        runComparison() {
            if (!this.selectedSourceA || !this.selectedSourceB) {
                notify('Vui lòng chọn đủ 2 tập kết quả để so sánh.', 'warning');
                return;
            }

            const rowsA = this.selectedSourceA.rows || [];
            const rowsB = this.selectedSourceB.rows || [];

            // Giới hạn an toàn 100.000 dòng
            const MAX_ROWS = 100000;
            if (rowsA.length > MAX_ROWS || rowsB.length > MAX_ROWS) {
                const countA = rowsA.length.toLocaleString();
                const countB = rowsB.length.toLocaleString();
                const confirmMsg = `Cảnh báo dung lượng lớn:\n\nTập A có ${countA} dòng, Tập B có ${countB} dòng.\nViệc so sánh hơn 100.000 dòng phía client có thể tiêu tốn nhiều bộ nhớ trình duyệt.\n\nBạn có muốn tiếp tục không?`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }

            const statusText = document.getElementById('diff-status-text');
            const statusInd = document.getElementById('diff-status-indicator');
            if (statusText) statusText.textContent = 'Đang tiến hành so sánh dữ liệu...';
            if (statusInd) {
                statusInd.className = 'badge bg-warning text-dark font-monospace';
                statusInd.textContent = 'RUNNING';
            }

            setTimeout(() => {
                const t0 = performance.now();

                // Lấy danh sách tên cột đã được chọn bởi người dùng
                const compareColsList = this.allUnionColumns
                    .filter(c => this.selectedCompareCols.has(c.name.toLowerCase()))
                    .map(c => c.name);

                const keyColsList = Array.from(this.selectedKeyCols);

                // Chạy Diff Engine với đúng danh sách cột đã chọn
                const result = ResultDiffEngine.compare(
                    this.selectedSourceA,
                    this.selectedSourceB,
                    keyColsList,
                    compareColsList
                );

                const elapsedMs = (performance.now() - t0).toFixed(1);

                this.currentDiffResult = result;
                this.updateSummaryCards(result, elapsedMs);
                this.renderAgGrid(result);

                if (statusText) {
                    statusText.textContent = `So sánh hoàn tất sau ${elapsedMs}ms. Khớp: ${result.summary.equal}, Sai khác: ${result.summary.totalDiffs}`;
                }
                if (statusInd) {
                    statusInd.className = 'badge bg-success text-light font-monospace';
                    statusInd.textContent = 'DONE';
                }

                // Cập nhật footer metrics
                const timingEl = document.getElementById('diff-timing-stat');
                if (timingEl) timingEl.textContent = `${elapsedMs} ms`;
                const colsStat = document.getElementById('diff-cols-stat');
                if (colsStat) colsStat.textContent = `${compareColsList.length} cột so`;
                const rowsStat = document.getElementById('diff-rows-stat');
                if (rowsStat) rowsStat.textContent = `${result.diffRows.length} dòng tổng`;
            }, 30);
        }

        updateSummaryCards(result, elapsedMs) {
            const s = result.summary;
            const totalEl = document.getElementById('diff-count-total');
            if (totalEl) totalEl.textContent = result.diffRows.length.toLocaleString();

            const diffsEl = document.getElementById('diff-count-diffs');
            if (diffsEl) diffsEl.textContent = s.totalDiffs.toLocaleString();

            const modEl = document.getElementById('diff-count-modified');
            if (modEl) modEl.textContent = s.modified.toLocaleString();

            const onlyAEl = document.getElementById('diff-count-only-a');
            if (onlyAEl) onlyAEl.textContent = s.onlyA.toLocaleString();

            const onlyBEl = document.getElementById('diff-count-only-b');
            if (onlyBEl) onlyBEl.textContent = s.onlyB.toLocaleString();

            const eqEl = document.getElementById('diff-count-equal');
            if (eqEl) eqEl.textContent = s.equal.toLocaleString();

            const warningEl = document.getElementById('diff-cols-warning');
            const warningText = document.getElementById('diff-cols-warning-text');
            if (warningEl && warningText) {
                const diffColMessages = [];
                if (s.removedColumnsInB.length > 0) {
                    diffColMessages.push(`Cột chỉ có ở A: [${s.removedColumnsInB.join(', ')}]`);
                }
                if (s.addedColumnsInB.length > 0) {
                    diffColMessages.push(`Cột chỉ có ở B: [${s.addedColumnsInB.join(', ')}]`);
                }

                if (diffColMessages.length > 0) {
                    warningText.textContent = diffColMessages.join(' | ');
                    warningEl.classList.remove('d-none');
                } else {
                    warningEl.classList.add('d-none');
                }
            }
        }

        renderAgGrid(diffResult) {
            const agGridDiv = document.getElementById('ide-result-diff-aggrid');
            if (!agGridDiv) return;

            const emptyEl = document.getElementById('ide-result-diff-empty');
            if (emptyEl) emptyEl.style.display = 'none';

            if (this.gridApi) {
                try {
                    this.gridApi.destroy();
                } catch (_) {}
                this.gridApi = null;
            }

            const { columns, compareColumns, colMapA, colMapB } = diffResult;

            // 1. Column Definition for Diff Status
            const colDefs = [
                {
                    headerName: 'Trạng thái',
                    field: '_diff_status',
                    width: 140,
                    pinned: 'left',
                    sortable: true,
                    filter: true,
                    cellRenderer: (params) => {
                        const status = params.value;
                        if (status === 'ONLY_B') {
                            return `<span class="diff-badge-status badge bg-success-subtle text-success border border-success"><i class="fa-solid fa-plus me-1"></i>Thêm ở B</span>`;
                        }
                        if (status === 'ONLY_A') {
                            return `<span class="diff-badge-status badge bg-danger-subtle text-danger border border-danger"><i class="fa-solid fa-minus me-1"></i>Xóa ở B</span>`;
                        }
                        if (status === 'MODIFIED') {
                            return `<span class="diff-badge-status badge bg-warning-subtle text-warning border border-warning"><i class="fa-solid fa-pen-to-square me-1"></i>Đổi giá trị</span>`;
                        }
                        return `<span class="diff-badge-status badge bg-secondary-subtle text-secondary border border-secondary"><i class="fa-solid fa-check me-1"></i>Khớp hoàn toàn</span>`;
                    }
                }
            ];

            // 2. Data Columns (chỉ hiển thị các cột người dùng đã chọn để so sánh)
            const activeColsToRender = (Array.isArray(compareColumns) && compareColumns.length > 0)
                ? compareColumns
                : columns;

            activeColsToRender.forEach(colName => {
                const isKey = diffResult.summary.keyColumns.includes(colName);
                colDefs.push({
                    headerName: isKey ? `🔑 ${colName}` : colName,
                    field: colName,
                    minWidth: 130,
                    sortable: true,
                    filter: true,
                    resizable: true,
                    cellRenderer: (params) => {
                        const item = params.data?._rawItem;
                        if (!item) return '';

                        const status = item.status;
                        const diffInfo = item.diffMap ? item.diffMap[colName] : null;

                        if (status === 'MODIFIED' && diffInfo) {
                            const valA = diffInfo.valA === null ? '<NULL>' : String(diffInfo.valA);
                            const valB = diffInfo.valB === null ? '<NULL>' : String(diffInfo.valB);
                            return `
                                <div class="diff-cell-modified" title="Tập A: ${escapeHtml(valA)} ➜ Tập B: ${escapeHtml(valB)}">
                                    <span class="diff-old">${escapeHtml(valA)}</span>
                                    <i class="fa-solid fa-arrow-right text-warning small"></i>
                                    <span class="diff-new">${escapeHtml(valB)}</span>
                                </div>`;
                        }

                        if (status === 'ONLY_A') {
                            const val = params.value === null ? '<NULL>' : String(params.value);
                            return `<span class="text-danger opacity-75" title="Chỉ có ở Tập A">${escapeHtml(val)}</span>`;
                        }

                        if (status === 'ONLY_B') {
                            const val = params.value === null ? '<NULL>' : String(params.value);
                            return `<span class="text-success fw-semibold" title="Chỉ có ở Tập B">${escapeHtml(val)}</span>`;
                        }

                        const val = params.value === null ? '<NULL>' : String(params.value);
                        return `<span>${escapeHtml(val)}</span>`;
                    }
                });
            });

            // 3. Build Row Data
            this.fullGridRowData = diffResult.diffRows.map(diffItem => {
                const rowObj = {
                    _diff_status: diffItem.status,
                    _rawItem: diffItem
                };

                const activeRow = diffItem.rowB || diffItem.rowA;
                const activeColMap = diffItem.rowB ? colMapB : colMapA;

                activeColsToRender.forEach(colName => {
                    const idx = activeColMap.get(colName.toLowerCase())?.index;
                    rowObj[colName] = (idx !== undefined && activeRow) ? activeRow[idx] : null;
                });

                return rowObj;
            });

            // Sync AG-Grid light/dark theme class
            const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
            const isLight = (curTheme === 'light' || curTheme === 'win-nt' || curTheme === 'win-xp');
            agGridDiv.classList.toggle('ag-theme-quartz', isLight);
            agGridDiv.classList.toggle('ag-theme-quartz-dark', !isLight);

            const gridOptions = {
                columnDefs: colDefs,
                rowData: this.fullGridRowData,
                defaultColDef: {
                    resizable: true,
                    sortable: true,
                    filter: true
                },
                rowSelection: 'multiple',
                enableCellTextSelection: true,
                ensureDomOrder: true,
                animateRows: false,
                getRowClass: (params) => {
                    const status = params.data?._diff_status;
                    if (status === 'ONLY_B') return 'diff-row-added';
                    if (status === 'ONLY_A') return 'diff-row-removed';
                    if (status === 'MODIFIED') return 'diff-row-modified';
                    return '';
                }
            };

            if (global.agGrid && typeof global.agGrid.createGrid === 'function') {
                this.gridApi = global.agGrid.createGrid(agGridDiv, gridOptions);
            }

            this.applyFilter();
        }

        applyFilter() {
            if (!this.gridApi || !this.fullGridRowData) return;

            let filtered = [];
            const filter = this.currentFilter;

            if (filter === 'all') {
                filtered = this.fullGridRowData;
            } else if (filter === 'diff') {
                filtered = this.fullGridRowData.filter(r => r._diff_status !== 'EQUAL');
            } else if (filter === 'modified') {
                filtered = this.fullGridRowData.filter(r => r._diff_status === 'MODIFIED');
            } else if (filter === 'only_a') {
                filtered = this.fullGridRowData.filter(r => r._diff_status === 'ONLY_A');
            } else if (filter === 'only_b') {
                filtered = this.fullGridRowData.filter(r => r._diff_status === 'ONLY_B');
            } else if (filter === 'equal') {
                filtered = this.fullGridRowData.filter(r => r._diff_status === 'EQUAL');
            }

            this.gridApi.setGridOption('rowData', filtered);
        }

        openInMonacoDiff() {
            if (!this.selectedSourceA || !this.selectedSourceB) {
                notify('Cần ít nhất 2 tập dữ liệu để mở Monaco Diff.', 'warning');
                return;
            }

            const formatSourceAsText = (source) => {
                const cols = (source.columns || []).map(c => typeof c === 'object' ? c.name : String(c));
                const lines = [cols.join('\t')];
                (source.rows || []).forEach(r => {
                    lines.push(r.map(v => v === null ? 'NULL' : String(v)).join('\t'));
                });
                return lines.join('\n');
            };

            const textA = formatSourceAsText(this.selectedSourceA);
            const textB = formatSourceAsText(this.selectedSourceB);

            if (typeof window.showDiffView === 'function') {
                window.showDiffView(
                    textA,
                    textB,
                    `So sánh: ${this.selectedSourceA.tabTitle || 'Tập A'} vs ${this.selectedSourceB.tabTitle || 'Tập B'}`
                );
                if (this.modalEl) {
                    const modalInstance = bootstrap.Modal.getInstance(this.modalEl);
                    if (modalInstance) modalInstance.hide();
                }
            } else {
                notify('Hạ tầng Monaco Diff Editor chưa sẵn sàng trên cửa sổ này.', 'warning');
            }
        }

        exportCsv() {
            if (!this.currentDiffResult || !this.currentDiffResult.diffRows.length) {
                notify('Không có dữ liệu Diff để xuất.', 'warning');
                return;
            }

            const { columns, compareColumns, diffRows, colMapA, colMapB } = this.currentDiffResult;
            const activeCols = (Array.isArray(compareColumns) && compareColumns.length > 0) ? compareColumns : columns;
            const headers = ['Status', ...activeCols];

            function escapeCsv(val) {
                if (val === null || val === undefined) return '';
                const s = String(val);
                if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            }

            const lines = [headers.map(escapeCsv).join(',')];

            diffRows.forEach(item => {
                const activeRow = item.rowB || item.rowA;
                const activeMap = item.rowB ? colMapB : colMapA;
                const rowVals = [item.status];
                activeCols.forEach(colName => {
                    const idx = activeMap.get(colName.toLowerCase())?.index;
                    rowVals.push(idx !== undefined && activeRow ? activeRow[idx] : '');
                });
                lines.push(rowVals.map(escapeCsv).join(','));
            });

            const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `result_diff_${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            notify('Đã tải xuống file CSV kết quả so sánh.', 'success');
        }

        /**
         * Mở Result Comparator ra Cửa sổ độc lập (Standalone Pop-out Window).
         */
        async popoutToStandaloneWindow() {
            try {
                this.scanAvailableSources();
                const payload = {
                    sources: this.sourceList,
                    preselectAIndex: document.getElementById('diff-select-source-a')?.selectedIndex ?? 0,
                    preselectBIndex: document.getElementById('diff-select-source-b')?.selectedIndex ?? 1
                };

                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_result_comparator_window === 'function') {
                    const res = await window.pywebview.api.open_result_comparator_window(payload);
                    if (res && res.success) {
                        if (this.modalEl) {
                            const modalInstance = bootstrap.Modal.getInstance(this.modalEl);
                            if (modalInstance) modalInstance.hide();
                        }
                        return;
                    }
                }
            } catch (err) {
                console.warn('[ResultComparator] Failed to pop out subwindow:', err);
            }
            notify('Đang chạy ở chế độ Popup trong trang.', 'info');
        }

        /**
         * Mở modal hoặc cửa sổ so sánh kết quả.
         */
        async open(options = {}) {
            this.scanAvailableSources();

            let idxA = options.preselectAIndex ?? 0;
            let idxB = options.preselectBIndex ?? 1;

            if (options.preselectSourceA) {
                const foundIdx = this.sourceList.findIndex(s => s.rows === options.preselectSourceA.rows || s.id === options.preselectSourceA.id);
                if (foundIdx >= 0) {
                    idxA = foundIdx;
                    idxB = (foundIdx + 1) % Math.max(1, this.sourceList.length);
                }
            }

            // Nếu đang chạy trong Desktop app và có API subwindow: ƯU TIÊN MỞ DẠNG CỬA SỔ MỚI
            if (!options.forceModal && window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_result_comparator_window === 'function') {
                try {
                    const payload = {
                        sources: this.sourceList,
                        preselectAIndex: idxA,
                        preselectBIndex: idxB
                    };
                    const res = await window.pywebview.api.open_result_comparator_window(payload);
                    if (res && res.success) {
                        return;
                    }
                } catch (e) {
                    console.warn('[ResultComparator] Native window failed, fallback to modal:', e);
                }
            }

            // Fallback mở Modal trong trang
            this.initModal();
            this.populateSourceSelects(idxA, idxB);

            if (this.modalEl && window.bootstrap && window.bootstrap.Modal) {
                const modalInstance = window.bootstrap.Modal.getOrCreateInstance(this.modalEl);
                modalInstance.show();
            }

            if (this.sourceList.length >= 2) {
                setTimeout(() => {
                    this.runComparison();
                }, 200);
            }
        }
    }

    // ── Global Singleton Instance & Exports ──────────────────────────────────
    const comparator = new ResultComparatorUI();
    global.ResultComparator = {
        open: (options) => comparator.open(options),
        initStandaloneWindow: (initialData) => comparator.initStandaloneWindow(initialData),
        compare: (sourceA, sourceB, keyColumns, compareColumns) => ResultDiffEngine.compare(sourceA, sourceB, keyColumns, compareColumns),
        getEngine: () => ResultDiffEngine
    };

    // Auto-bind compare triggers
    if (typeof document !== 'undefined') {
        const initTriggers = () => {
            const btn = document.getElementById('ide-btn-compare-results');
            if (btn && !btn._boundComparator) {
                btn._boundComparator = true;
                btn.addEventListener('click', () => comparator.open());
            }
            const menuBtn = document.getElementById('ide-menu-compare-results');
            if (menuBtn && !menuBtn._boundComparator) {
                menuBtn._boundComparator = true;
                menuBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    comparator.open();
                });
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initTriggers);
        } else {
            initTriggers();
        }
    }

})(typeof window !== 'undefined' ? window : this);
