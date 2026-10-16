/**
 * result-comparator.js
 * Quản lý So Sánh Hai Tập Kết Quả Truy Vấn (Query Results Diff Engine & Visual Grid).
 * Tuân thủ đặc tả Mục 5.6 trong .SKILL/improve_general_program.md:
 * - So sánh giữa 2 tabs, 2 lần chạy hoặc dữ liệu dán trực tiếp.
 * - Cho phép chọn cột khóa (PK / Composite Key hoặc Toàn bộ dòng).
 * - Xử lý phía client bằng AG Grid, tạo map theo khóa, phân loại:
 *   + Chỉ ở A (ONLY_A - Deleted)
 *   + Chỉ ở B (ONLY_B - Added)
 *   + Khác giá trị ô (MODIFIED - Changed)
 *   + Khớp hoàn toàn (EQUAL - Identical)
 * - Chuẩn hóa kiểu trước khi so (số, ngày, khoảng trắng đầu/cuối, NULL).
 * - Cảnh báo an toàn nếu vượt quá 100.000 dòng.
 * - Thoát HTML bằng escapeHtml triệt để chống XSS.
 * - Hỗ trợ xem Monaco Diff View cho chi tiết văn bản.
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
         * @param {Array<string>} keyColumns Danh sách tên cột dùng làm khóa
         */
        static compare(sourceA, sourceB, keyColumns = []) {
            const rowsA = sourceA?.rows || [];
            const rowsB = sourceB?.rows || [];
            const rawColsA = sourceA?.columns || [];
            const rawColsB = sourceB?.columns || [];

            // Chuẩn hóa tên cột
            const colsA = rawColsA.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));
            const colsB = rawColsB.map(c => (typeof c === 'object' && c !== null) ? (c.name || c.headerName || '') : String(c));

            const colMapA = new Map(colsA.map((c, i) => [c.toLowerCase(), { name: c, index: i }]));
            const colMapB = new Map(colsB.map((c, i) => [c.toLowerCase(), { name: c, index: i }]));

            // Tìm danh sách cột chung và cột riêng
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
                    // Hash toàn bộ các cột chung
                    const parts = [];
                    for (const colName of commonCols) {
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

            // Xây dựng Map dòng của A
            // Map<key, Array<{ row, originalIdx, used }>>
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
                    // Tìm ứng viên chưa được match trong A
                    matchedItem = candidates.find(item => !item.used);
                }

                if (matchedItem) {
                    matchedItem.used = true;
                    const rA = matchedItem.row;

                    // So sánh từng cột chung
                    const diffMap = {};
                    let hasDifference = false;

                    for (const c of commonCols) {
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
                    // Không có trong A -> ONLY_B (Added)
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

            // Duyệt lại các phần tử chưa match trong A -> ONLY_A (Deleted)
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
                    removedColumnsInB: removedInCols,
                    addedColumnsInB: addedInCols,
                    keyColumns: effectiveKeyCols,
                    useFullRowHash
                },
                diffRows,
                columns: allColNames,
                commonColumns: commonCols,
                colMapA,
                colMapB
            };
        }
    }

    // ── Result Comparator UI Controller & Modal ──────────────────────────────
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
            this.selectedKeys = [];
        }

        initModal() {
            if (this.modalEl) return;

            const modalHtml = `
            <div class="modal fade" id="ide-result-diff-modal" tabindex="-1" aria-labelledby="ideResultDiffModalLabel" aria-hidden="true" data-bs-backdrop="static">
                <div class="modal-dialog modal-fullscreen-xl-down modal-xl modal-dialog-scrollable" style="max-width: 95vw; height: 92vh;">
                    <div class="modal-content border-secondary shadow-lg d-flex flex-column" style="background: var(--ide-bg-sidebar, #1e1e1e); color: var(--ide-text-main, #d4d4d4); height: 100%;">
                        
                        <!-- Header -->
                        <div class="modal-header py-2 px-3 border-bottom border-secondary d-flex justify-content-between align-items-center" style="background: var(--ide-bg-toolbar, #252526);">
                            <div class="d-flex align-items-center gap-2">
                                <i class="fa-solid fa-code-compare text-info fs-5"></i>
                                <h6 class="modal-title m-0 fw-bold" id="ideResultDiffModalLabel">So sánh hai kết quả truy vấn (Result Diff)</h6>
                                <span class="badge bg-secondary-subtle text-secondary border border-secondary small ms-2">Mục 5.6</span>
                            </div>
                            <div class="d-flex align-items-center gap-2">
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
                            <div class="row g-2 align-items-center">
                                <div class="col-md-4">
                                    <label class="form-label mb-1 text-muted fw-semibold small">
                                        <i class="fa-solid fa-database text-warning me-1"></i>Tập kết quả A (Gốc):
                                    </label>
                                    <select class="form-select form-select-sm bg-dark text-light border-secondary" id="diff-select-source-a"></select>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label mb-1 text-muted fw-semibold small">
                                        <i class="fa-solid fa-database text-success me-1"></i>Tập kết quả B (Mới / Đối chiếu):
                                    </label>
                                    <select class="form-select form-select-sm bg-dark text-light border-secondary" id="diff-select-source-b"></select>
                                </div>
                                <div class="col-md-3">
                                    <label class="form-label mb-1 text-muted fw-semibold small">
                                        <i class="fa-solid fa-key text-warning me-1"></i>Cột khóa so khớp (Primary Key):
                                    </label>
                                    <div class="dropdown w-100">
                                        <button class="btn btn-sm btn-outline-secondary dropdown-toggle w-100 text-truncate text-start" type="button" id="diff-key-cols-btn" data-bs-toggle="dropdown" data-bs-auto-close="outside">
                                            Chọn khóa so sánh...
                                        </button>
                                        <ul class="dropdown-menu dropdown-menu-dark p-2 border-secondary shadow" id="diff-key-cols-menu" style="max-height: 250px; overflow-y: auto; font-size: 12px; width: 100%;"></ul>
                                    </div>
                                </div>
                                <div class="col-md-1 d-flex align-items-end">
                                    <button class="btn btn-sm btn-primary w-100 fw-bold" id="diff-btn-run-compare" title="Thực hiện so sánh">
                                        <i class="fa-solid fa-play me-1"></i> So
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards & Filter Pills -->
                        <div class="px-3 py-2 border-bottom border-secondary d-flex flex-wrap justify-content-between align-items-center gap-2" style="background: var(--ide-bg-sidebar, #222);">
                            <!-- Filter tabs -->
                            <div class="btn-group btn-group-sm" role="group" id="diff-filter-group">
                                <button type="button" class="btn btn-outline-secondary active" data-filter="all">
                                    Tất cả (<span id="diff-count-total">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-warning" data-filter="diff">
                                    <i class="fa-solid fa-circle-exclamation me-1"></i>Chỉ sai khác (<span id="diff-count-diffs">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-warning" data-filter="modified">
                                    <i class="fa-solid fa-pen-to-square me-1"></i>Khác giá trị (<span id="diff-count-modified">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-danger" data-filter="only_a">
                                    <i class="fa-solid fa-minus me-1"></i>Chỉ ở A (<span id="diff-count-only-a">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-success" data-filter="only_b">
                                    <i class="fa-solid fa-plus me-1"></i>Chỉ ở B (<span id="diff-count-only-b">0</span>)
                                </button>
                                <button type="button" class="btn btn-outline-secondary" data-filter="equal">
                                    <i class="fa-solid fa-check me-1"></i>Khớp hoàn toàn (<span id="diff-count-equal">0</span>)
                                </button>
                            </div>

                            <!-- Legend / Column Warning -->
                            <div class="small d-flex align-items-center gap-3 text-secondary" id="diff-extra-info">
                                <span id="diff-cols-warning" class="text-warning d-none">
                                    <i class="fa-solid fa-triangle-exclamation me-1"></i><span id="diff-cols-warning-text"></span>
                                </span>
                                <span><span class="badge bg-danger-subtle text-danger border border-danger me-1">-</span>Xóa ở B</span>
                                <span><span class="badge bg-success-subtle text-success border border-success me-1">+</span>Thêm ở B</span>
                                <span><span class="badge bg-warning-subtle text-warning border border-warning me-1">~</span>Thay đổi</span>
                            </div>
                        </div>

                        <!-- Diff Grid Body -->
                        <div class="modal-body p-0 flex-grow-1 position-relative" style="background: var(--ide-bg-editor, #1e1e1e); min-height: 380px;">
                            <div id="ide-result-diff-aggrid" class="ag-theme-quartz-dark w-100 h-100"></div>
                            <div id="ide-result-diff-empty" class="position-absolute top-50 start-50 translate-middle text-center text-muted" style="display: none;">
                                <i class="fa-solid fa-code-compare fs-1 mb-2 opacity-50"></i>
                                <div class="fs-6 fw-semibold">Chưa có kết quả so sánh</div>
                                <div class="small text-secondary">Vui lòng chọn 2 tập kết quả và bấm nút "So" để bắt đầu.</div>
                            </div>
                        </div>

                        <!-- Footer -->
                        <div class="modal-footer py-1 px-3 border-top border-secondary d-flex justify-content-between align-items-center" style="background: var(--ide-bg-toolbar, #252526); font-size: 12px;">
                            <div id="diff-status-text" class="text-secondary">Sẵn sàng so sánh</div>
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
            if (runBtn) {
                runBtn.addEventListener('click', () => this.runComparison());
            }

            const selectA = document.getElementById('diff-select-source-a');
            const selectB = document.getElementById('diff-select-source-b');
            if (selectA) {
                selectA.addEventListener('change', () => this.onSourceChanged());
            }
            if (selectB) {
                selectB.addEventListener('change', () => this.onSourceChanged());
            }

            const filterBtns = document.querySelectorAll('#diff-filter-group button');
            filterBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.currentFilter = btn.dataset.filter || 'all';
                    this.applyFilter();
                });
            });

            const monacoBtn = document.getElementById('diff-btn-monaco-view');
            if (monacoBtn) {
                monacoBtn.addEventListener('click', () => this.openInMonacoDiff());
            }

            const exportCsvBtn = document.getElementById('diff-btn-export-csv');
            if (exportCsvBtn) {
                exportCsvBtn.addEventListener('click', () => this.exportCsv());
            }
        }

        /**
         * Lấy tất cả các Grid Result đang hiển thị trong các tab của IDE.
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
                    const tabBtn = document.querySelector(`.ide-tab-btn[data-tab-id="${tabId}"]`);
                    if (tabBtn) {
                        const titleSpan = tabBtn.querySelector('.ide-tab-title');
                        if (titleSpan && titleSpan.textContent.trim()) {
                            tabTitle = titleSpan.textContent.trim();
                        }
                    }

                    list.push({
                        id: `grid-${idx}`,
                        title: `[${tabTitle}] Kết quả #${(inst.gridIndex || 0) + 1} (${inst.rows.length} dòng, ${inst.columns.length} cột)`,
                        columns: inst.columns,
                        rows: inst.rows,
                        tabTitle: tabTitle
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
                selectB.selectedIndex = 0;
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

            this.updateKeyColumnsDropdown();
        }

        updateKeyColumnsDropdown() {
            const menu = document.getElementById('diff-key-cols-menu');
            const btn = document.getElementById('diff-key-cols-btn');
            if (!menu || !btn) return;

            menu.innerHTML = '';

            if (!this.selectedSourceA || !this.selectedSourceB) {
                btn.textContent = 'Chọn khóa so sánh...';
                return;
            }

            const colsA = this.selectedSourceA.columns.map(c => typeof c === 'object' ? (c.name || '') : String(c));
            const colsB = this.selectedSourceB.columns.map(c => typeof c === 'object' ? (c.name || '') : String(c));
            const setB = new Set(colsB.map(c => c.toLowerCase()));

            const commonCols = colsA.filter(c => setB.has(c.toLowerCase()));

            if (commonCols.length === 0) {
                menu.innerHTML = '<li class="dropdown-item text-muted small fst-italic">Hai tập kết quả không có cột nào trùng tên</li>';
                btn.textContent = '(Không có cột chung)';
                return;
            }

            // Gợi ý cột khóa: id, code, ...
            let suggestedKeys = commonCols.filter(c => {
                const lc = c.toLowerCase();
                return lc === 'id' || lc.endsWith('_id') || lc.endsWith('id') || lc === 'code';
            });
            if (suggestedKeys.length === 0 && commonCols.length > 0) {
                suggestedKeys = [commonCols[0]];
            }

            this.selectedKeys = [...suggestedKeys];

            // Thêm option "Toàn bộ dòng"
            const fullRowLi = document.createElement('li');
            fullRowLi.className = 'px-2 py-1 border-bottom border-secondary mb-1';
            fullRowLi.innerHTML = `
                <div class="form-check form-check-inline m-0">
                    <input class="form-check-input" type="checkbox" id="diff-key-fullrow">
                    <label class="form-check-label text-warning small fw-bold" for="diff-key-fullrow">
                        So khớp theo toàn bộ các cột (Không dùng khóa)
                    </label>
                </div>`;
            menu.appendChild(fullRowLi);

            commonCols.forEach((colName, i) => {
                const li = document.createElement('li');
                li.className = 'px-2 py-1';
                const isChecked = suggestedKeys.includes(colName);
                li.innerHTML = `
                    <div class="form-check m-0">
                        <input class="form-check-input diff-col-chk" type="checkbox" value="${escapeHtml(colName)}" id="diff-col-chk-${i}" ${isChecked ? 'checked' : ''}>
                        <label class="form-check-label text-light small text-truncate" for="diff-col-chk-${i}" title="${escapeHtml(colName)}">
                            ${escapeHtml(colName)}
                        </label>
                    </div>`;
                menu.appendChild(li);
            });

            // Bind checkbox events
            const fullRowChk = document.getElementById('diff-key-fullrow');
            const colCheckboxes = menu.querySelectorAll('.diff-col-chk');

            const refreshButtonLabel = () => {
                if (fullRowChk && fullRowChk.checked) {
                    btn.textContent = 'So toàn bộ dòng (Full Row)';
                    this.selectedKeys = [];
                } else {
                    const checkedCols = Array.from(colCheckboxes).filter(chk => chk.checked).map(chk => chk.value);
                    this.selectedKeys = checkedCols;
                    if (checkedCols.length === 0) {
                        btn.textContent = 'Chưa chọn khóa (Chọn ít nhất 1 cột)';
                    } else if (checkedCols.length === 1) {
                        btn.textContent = `Khóa: ${checkedCols[0]}`;
                    } else {
                        btn.textContent = `Khóa: ${checkedCols.length} cột (${checkedCols.join(', ')})`;
                    }
                }
            };

            if (fullRowChk) {
                fullRowChk.addEventListener('change', () => {
                    colCheckboxes.forEach(chk => {
                        chk.disabled = fullRowChk.checked;
                    });
                    refreshButtonLabel();
                });
            }

            colCheckboxes.forEach(chk => {
                chk.addEventListener('change', () => {
                    refreshButtonLabel();
                });
            });

            refreshButtonLabel();
        }

        runComparison() {
            if (!this.selectedSourceA || !this.selectedSourceB) {
                notify('Vui lòng chọn đủ 2 tập kết quả để so sánh.', 'warning');
                return;
            }

            const rowsA = this.selectedSourceA.rows || [];
            const rowsB = this.selectedSourceB.rows || [];

            // Giới hạn 100.000 dòng theo đặc tả Mục 5.6
            const MAX_ROWS = 100000;
            if (rowsA.length > MAX_ROWS || rowsB.length > MAX_ROWS) {
                const countA = rowsA.length.toLocaleString();
                const countB = rowsB.length.toLocaleString();
                const confirmMsg = `Cảnh báo dung lượng lớn:\n\nTập A có ${countA} dòng, Tập B có ${countB} dòng.\nViệc so sánh hơn 100.000 dòng phía client có thể tiêu tốn nhiều bộ nhớ trình duyệt.\n\nBạn có muốn tiếp tục không? (Khuyến nghị: Thu hẹp kết quả bằng mệnh đề WHERE / LIMIT)`;
                if (!confirm(confirmMsg)) {
                    return;
                }
            }

            const statusText = document.getElementById('diff-status-text');
            if (statusText) statusText.textContent = 'Đang tiến hành so sánh dữ liệu...';

            setTimeout(() => {
                const t0 = performance.now();
                const result = ResultDiffEngine.compare(
                    this.selectedSourceA,
                    this.selectedSourceB,
                    this.selectedKeys
                );
                const elapsedMs = (performance.now() - t0).toFixed(1);

                this.currentDiffResult = result;
                this.updateSummaryCards(result, elapsedMs);
                this.renderAgGrid(result);

                if (statusText) {
                    statusText.textContent = `So sánh hoàn tất sau ${elapsedMs}ms. Khớp: ${result.summary.equal}, Khác: ${result.summary.totalDiffs}`;
                }
            }, 30);
        }

        updateSummaryCards(result, elapsedMs) {
            const s = result.summary;
            document.getElementById('diff-count-total').textContent = result.diffRows.length.toLocaleString();
            document.getElementById('diff-count-diffs').textContent = s.totalDiffs.toLocaleString();
            document.getElementById('diff-count-modified').textContent = s.modified.toLocaleString();
            document.getElementById('diff-count-only-a').textContent = s.onlyA.toLocaleString();
            document.getElementById('diff-count-only-b').textContent = s.onlyB.toLocaleString();
            document.getElementById('diff-count-equal').textContent = s.equal.toLocaleString();

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
            if (!this.agGridDiv) return;

            const emptyEl = document.getElementById('ide-result-diff-empty');
            if (emptyEl) emptyEl.style.display = 'none';

            if (this.gridApi) {
                this.gridApi.destroy();
                this.gridApi = null;
            }

            const { columns, commonColumns, colMapA, colMapB } = diffResult;

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
                            return `<span class="badge bg-success-subtle text-success border border-success px-2 py-1"><i class="fa-solid fa-plus me-1"></i>Thêm ở B</span>`;
                        }
                        if (status === 'ONLY_A') {
                            return `<span class="badge bg-danger-subtle text-danger border border-danger px-2 py-1"><i class="fa-solid fa-minus me-1"></i>Bị xóa ở B</span>`;
                        }
                        if (status === 'MODIFIED') {
                            return `<span class="badge bg-warning-subtle text-warning border border-warning px-2 py-1"><i class="fa-solid fa-pen-to-square me-1"></i>Khác giá trị</span>`;
                        }
                        return `<span class="badge bg-secondary-subtle text-secondary border border-secondary px-2 py-1"><i class="fa-solid fa-check me-1"></i>Khớp hoàn toàn</span>`;
                    }
                }
            ];

            // 2. Data Columns
            columns.forEach(colName => {
                const isKey = diffResult.summary.keyColumns.includes(colName);
                colDefs.push({
                    headerName: isKey ? `🔑 ${colName}` : colName,
                    field: colName,
                    minWidth: 120,
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
                                <div class="d-inline-flex align-items-center gap-1 text-nowrap px-1 rounded" style="background: rgba(234, 179, 8, 0.15); border: 1px dashed rgba(234, 179, 8, 0.5);">
                                    <span class="text-danger text-decoration-line-through small" title="Giá trị ở Tập A: ${escapeHtml(valA)}">${escapeHtml(valA)}</span>
                                    <i class="fa-solid fa-arrow-right text-warning" style="font-size: 10px;"></i>
                                    <span class="text-success fw-bold" title="Giá trị ở Tập B: ${escapeHtml(valB)}">${escapeHtml(valB)}</span>
                                </div>`;
                        }

                        if (status === 'ONLY_A') {
                            const val = params.value === null ? '<NULL>' : String(params.value);
                            return `<span class="text-danger opacity-75" title="Dòng chỉ có ở Tập A">${escapeHtml(val)}</span>`;
                        }

                        if (status === 'ONLY_B') {
                            const val = params.value === null ? '<NULL>' : String(params.value);
                            return `<span class="text-success fw-semibold" title="Dòng chỉ có ở Tập B">${escapeHtml(val)}</span>`;
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

                columns.forEach(colName => {
                    const idx = activeColMap.get(colName.toLowerCase())?.index;
                    rowObj[colName] = (idx !== undefined && activeRow) ? activeRow[idx] : null;
                });

                return rowObj;
            });

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
                this.gridApi = global.agGrid.createGrid(this.agGridDiv, gridOptions);
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

            // Chuyển kết quả A và B thành JSON hoặc TSV
            const formatSourceAsText = (source) => {
                const cols = source.columns.map(c => typeof c === 'object' ? c.name : String(c));
                const lines = [cols.join('\t')];
                (source.rows || []).forEach(r => {
                    lines.push(r.map(v => v === null ? 'NULL' : String(v)).join('\t'));
                });
                return lines.join('\n');
            };

            const textA = formatSourceAsText(this.selectedSourceA);
            const textB = formatSourceAsText(this.selectedSourceB);

            // Tận dụng tab Monaco Diff View có sẵn trong IDE
            if (typeof window.showDiffView === 'function') {
                window.showDiffView(
                    textA,
                    textB,
                    `So sánh: ${this.selectedSourceA.tabTitle || 'Tập A'} vs ${this.selectedSourceB.tabTitle || 'Tập B'}`
                );
                // Ẩn modal so sánh để người dùng tập trung vào Monaco Diff
                const modalInstance = bootstrap.Modal.getInstance(this.modalEl);
                if (modalInstance) modalInstance.hide();
            } else {
                notify('Hạ tầng Monaco Diff Editor chưa sẵn sàng.', 'warning');
            }
        }

        exportCsv() {
            if (!this.currentDiffResult || !this.currentDiffResult.diffRows.length) {
                notify('Không có dữ liệu Diff để xuất.', 'warning');
                return;
            }

            const { columns, diffRows, colMapA, colMapB } = this.currentDiffResult;
            const headers = ['Status', ...columns];

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
                columns.forEach(colName => {
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
         * Mở modal so sánh kết quả.
         * @param {Object} options { preselectAIndex, preselectBIndex, preselectSourceA }
         */
        open(options = {}) {
            this.initModal();
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

            this.populateSourceSelects(idxA, idxB);

            const modalInstance = new bootstrap.Modal(this.modalEl);
            modalInstance.show();

            // Nếu có sẵn 2 source khác nhau, tự động chạy so sánh
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
        compare: (sourceA, sourceB, keyColumns) => ResultDiffEngine.compare(sourceA, sourceB, keyColumns),
        getEngine: () => ResultDiffEngine
    };

    // Auto-bind compare triggers
    if (typeof document !== 'undefined') {
        const initTriggers = () => {
            const btn = document.getElementById('ide-btn-compare-results');
            if (btn) {
                btn.addEventListener('click', () => comparator.open());
            }
            const menuBtn = document.getElementById('ide-menu-compare-results');
            if (menuBtn) {
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

