/**
 * SheetGrid - Interactive Worksheet Grid Component powered by AG-Grid Community
 * Tailored specifically for Report Layout Generation (Excel/Sheets -> Bravo Layout XML).
 *
 * Core Features:
 * - Backed by AG-Grid Community (Virtual scrolling, 100% strict row & column order)
 * - Zero DOM re-creation on sheet switch or file reload
 * - Dynamic cell highlight for Title, Header, and Summary regions
 * - Interactive mouse-drag & shift-click range selection via DOM delegation
 * - Editable Name Box (e.g. type A8:K9 and press Enter)
 * - Safe & clear Sheet Tabs at bottom (handles string & object sheet lists)
 * - Isolated Excel styling scoped strictly to Report Gen
 */

(function (global) {
    'use strict';

    function colIdxToLetter(colIdx) {
        let result = '';
        while (colIdx > 0) {
            const rem = (colIdx - 1) % 26;
            result = String.fromCharCode(65 + rem) + result;
            colIdx = Math.floor((colIdx - 1) / 26);
        }
        return result;
    }

    function colLetterToIdx(str) {
        let idx = 0;
        const upper = (str || '').toUpperCase();
        for (let i = 0; i < upper.length; i++) {
            const code = upper.charCodeAt(i);
            if (code >= 65 && code <= 90) {
                idx = idx * 26 + (code - 64);
            }
        }
        return idx;
    }

    function parseRangeStr(str) {
        if (!str || typeof str !== 'string') return null;
        const parts = str.trim().split(':');
        const parseCoord = (s) => {
            const m = s.match(/^([A-Za-z]+)(\d+)$/);
            if (!m) return null;
            return { r: parseInt(m[2], 10), c: colLetterToIdx(m[1]) };
        };
        const p1 = parseCoord(parts[0]);
        if (!p1) return null;
        if (parts.length === 1) {
            return { min_r: p1.r, min_c: p1.c, max_r: p1.r, max_c: p1.c };
        }
        const p2 = parseCoord(parts[1]);
        if (!p2) return null;
        return {
            min_r: Math.min(p1.r, p2.r),
            min_c: Math.min(p1.c, p2.c),
            max_r: Math.max(p1.r, p2.r),
            max_c: Math.max(p1.c, p2.c)
        };
    }

    function formatRangeStr(min_r, min_c, max_r, max_c) {
        const c1 = `${colIdxToLetter(min_c)}${min_r}`;
        if (min_r === max_r && min_c === max_c) return c1;
        const c2 = `${colIdxToLetter(max_c)}${max_r}`;
        return `${c1}:${c2}`;
    }

    class SheetGrid {
        constructor(containerEl, options = {}) {
            this.container = typeof containerEl === 'string' ? document.getElementById(containerEl) : containerEl;
            this.options = Object.assign({
                readOnly: false,
                isMini: false,
                onSelectRange: null,
                onAssignRegion: null,
                onSheetChange: null,
                onToggleColumn: null
            }, options);

            this.data = null;
            this.sheets = [];
            this.activeSheetName = '';
            this.selectedRange = null; // { min_r, min_c, max_r, max_c }
            this.dragStart = null;     // { r, c }
            this.anchorCell = { r: 1, c: 1 };
            this.leadCell = { r: 1, c: 1 };
            this.cellMetaMap = {};
            this.stylesTable = [];
            this.isDragging = false;
            this.highlightedCol = null;

            this.regions = {
                title: null,
                header: null,
                summary: null
            };

            this.gridApi = null;
            this.gridDiv = null;
            this._eventsBound = false;
            this._keydownHandler = null;

            this._initDOM();
            this._bindGlobalEvents();
        }

        _initDOM() {
            this.container.innerHTML = `
                <div class="sg-root rg-ag-excel-container ${this.options.isMini ? 'sg-mini' : ''}" style="display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; position: relative;">
                    <!-- Formula & Name Bar -->
                    ${!this.options.isMini ? `
                    <div class="sg-formula-bar" style="height: 30px; flex-shrink: 0;">
                        <div class="sg-name-box-wrap">
                            <input type="text" class="sg-name-box" id="sg-name-box" placeholder="A1" spellcheck="false" title="Nhập dải ô (VD: A1:K10) và Enter để chọn">
                        </div>
                        <div class="sg-fx-icon">fx</div>
                        <div class="sg-fx-input-wrap">
                            <input type="text" class="sg-fx-input" id="sg-fx-input" readonly placeholder="Nội dung ô đang chọn">
                        </div>
                        <div class="small text-muted me-2" id="sg-selection-size-badge" style="font-size: 11px;"></div>
                    </div>` : ''}

                    <!-- AG-Grid Wrapper (Takes all remaining vertical space) -->
                    <div class="rg-ag-grid-wrapper flex-1" tabindex="0" style="flex: 1 1 0%; min-height: 0; min-width: 0; width: 100%; height: 100%; position: relative; overflow: hidden; outline: none;">
                        <div class="rg-ag-instance" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;"></div>
                    </div>

                    <!-- Bottom Bar (Sheet Tabs & Info) -->
                    ${!this.options.isMini ? `
                    <div class="sg-bottom-bar" style="height: 28px; flex-shrink: 0;">
                        <div class="sg-sheet-tabs-wrap">
                            <button type="button" class="sg-tab-scroll-btn" id="sg-tab-prev" title="Cuộn tab sang trái"><i class="fa-solid fa-chevron-left"></i></button>
                            <div class="sg-sheet-tabs" id="sg-sheet-tabs"></div>
                            <button type="button" class="sg-tab-scroll-btn" id="sg-tab-next" title="Cuộn tab sang phải"><i class="fa-solid fa-chevron-right"></i></button>
                        </div>
                        <div class="sg-info-stats" id="sg-info-stats"></div>
                    </div>` : ''}
                </div>
            `;

            this.nameBox = this.container.querySelector('.sg-name-box');
            this.fxInput = this.container.querySelector('.sg-fx-input');
            this.sizeBadge = this.container.querySelector('#sg-selection-size-badge');
            this.gridWrapper = this.container.querySelector('.rg-ag-grid-wrapper');
            this.gridDiv = this.container.querySelector('.rg-ag-instance');
            this.sheetTabsEl = this.container.querySelector('.sg-sheet-tabs');
            this.infoStatsEl = this.container.querySelector('.sg-info-stats');

            if (window.ResizeObserver && this.gridWrapper) {
                this._ro = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        if (entry.contentRect && entry.contentRect.height > 0) {
                            if (this.gridApi) {
                                try {
                                    this.gridApi.redrawRows();
                                } catch (_) {}
                            }
                        }
                    }
                });
                this._ro.observe(this.gridWrapper);
            }

            // Apply proper AG-Grid quartz theme classes
            this._updateThemeClass();

            // Name Box Enter listener
            if (this.nameBox) {
                this.nameBox.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const rng = parseRangeStr(this.nameBox.value);
                        if (rng && this.data) {
                            const validRng = {
                                min_r: Math.max(1, Math.min(this.data.preview_rows, rng.min_r)),
                                min_c: Math.max(1, Math.min(this.data.preview_cols, rng.min_c)),
                                max_r: Math.max(1, Math.min(this.data.preview_rows, rng.max_r)),
                                max_c: Math.max(1, Math.min(this.data.preview_cols, rng.max_c))
                            };
                            this.selectRange(validRng);
                            this.scrollToRange(validRng);
                        }
                    }
                });
            }

            // Sheet tab scroll buttons
            const tabPrev = this.container.querySelector('#sg-tab-prev');
            const tabNext = this.container.querySelector('#sg-tab-next');
            if (tabPrev && this.sheetTabsEl) {
                tabPrev.addEventListener('click', () => {
                    this.sheetTabsEl.scrollBy({ left: -150, behavior: 'smooth' });
                });
            }
            if (tabNext && this.sheetTabsEl) {
                tabNext.addEventListener('click', () => {
                    this.sheetTabsEl.scrollBy({ left: 150, behavior: 'smooth' });
                });
            }

            // Bind mouse events on gridDiv
            this._bindGridDomEvents();
        }

        _updateThemeClass() {
            if (!this.gridDiv) return;
            const curTheme = document.documentElement.getAttribute('data-bs-theme') || '';
            const themeMode = document.documentElement.getAttribute('data-theme-mode') || '';
            const isLight = themeMode === 'light' || curTheme === 'light' || curTheme.startsWith('light-') || curTheme === 'win-nt' || curTheme === 'win-xp';
            this.gridDiv.className = `rg-ag-instance ${isLight ? 'ag-theme-quartz' : 'ag-theme-quartz-dark'}`;
        }

        _bindGlobalEvents() {
            window.addEventListener('mouseup', () => {
                if (this.isDragging) {
                    this.isDragging = false;
                }
            });

            this._keydownHandler = (e) => this._handleKeyDown(e);
            window.addEventListener('keydown', this._keydownHandler);

            // Re-apply theme class if IDE theme toggles
            const observer = new MutationObserver(() => {
                this._updateThemeClass();
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
        }

        _bindGridDomEvents() {
            if (this._eventsBound || !this.gridDiv) return;
            this._eventsBound = true;

            const extractCellCoord = (e) => {
                const cellEl = e.target.closest('.ag-cell');
                if (!cellEl) return null;
                const rowEl = cellEl.closest('.ag-row');
                if (!rowEl) return null;
                const rIdxAttr = rowEl.getAttribute('row-index');
                if (rIdxAttr == null) return null;
                const r = parseInt(rIdxAttr, 10) + 1; // 1-indexed row number
                const colId = cellEl.getAttribute('col-id') || '';
                if (!colId.startsWith('col_')) return null;
                const c = parseInt(colId.replace('col_', ''), 10);
                if (isNaN(r) || isNaN(c)) return null;
                return { r, c };
            };

            this.gridDiv.addEventListener('mousedown', (e) => {
                if (this.options.readOnly || e.button !== 0) return;
                const coord = extractCellCoord(e);
                if (!coord) return;

                this.isDragging = true;
                const meta = this.cellMetaMap ? this.cellMetaMap[`${coord.r}_${coord.c}`] : null;

                if (e.shiftKey && this.anchorCell) {
                    // Shift + Click: expand rectangular selection from current anchor to clicked cell
                    this.leadCell = { r: coord.r, c: coord.c };
                    this._updateSelectionRange(this.anchorCell.r, this.anchorCell.c, coord.r, coord.c);
                } else {
                    // Normal click or Ctrl + Click:
                    if (meta && meta.merge) {
                        // Clicked cell is part of a merged range -> select the entire merged range
                        this.anchorCell = { r: meta.merge.min_row, c: meta.merge.min_col };
                        this.leadCell = { r: meta.merge.max_row, c: meta.merge.max_col };
                        this.dragStart = { r: meta.merge.min_row, c: meta.merge.min_col };
                        this._updateSelectionRange(meta.merge.min_row, meta.merge.min_col, meta.merge.max_row, meta.merge.max_col);
                    } else {
                        this.anchorCell = { r: coord.r, c: coord.c };
                        this.leadCell = { r: coord.r, c: coord.c };
                        this.dragStart = { r: coord.r, c: coord.c };
                        this._updateSelectionRange(coord.r, coord.c, coord.r, coord.c);
                    }
                }
            });

            this.gridDiv.addEventListener('mouseover', (e) => {
                if (!this.isDragging || !this.dragStart) return;
                const coord = extractCellCoord(e);
                if (!coord) return;
                this.leadCell = { r: coord.r, c: coord.c };
                this._updateSelectionRange(this.dragStart.r, this.dragStart.c, coord.r, coord.c);
            });

            this.gridDiv.addEventListener('click', (e) => {
                const coord = extractCellCoord(e);
                if (coord) {
                    this._updateFxBar(coord.r, coord.c);
                }
            });

            this.gridDiv.addEventListener('contextmenu', (e) => {
                if (this.options.readOnly) return;
                const coord = extractCellCoord(e);
                if (!coord) return;
                e.preventDefault();

                if (!this._isCellSelected(coord.r, coord.c)) {
                    const meta = this.cellMetaMap ? this.cellMetaMap[`${coord.r}_${coord.c}`] : null;
                    if (meta && meta.merge) {
                        this.selectRange({ min_r: meta.merge.min_row, min_c: meta.merge.min_col, max_r: meta.merge.max_row, max_c: meta.merge.max_col });
                    } else {
                        this.selectRange({ min_r: coord.r, min_c: coord.c, max_r: coord.r, max_c: coord.c });
                    }
                }

                this._showContextMenu(e.clientX, e.clientY);
            });
        }

        loadData(sheetData, allSheets = [], activeSheet = '') {
            this.data = sheetData;
            this.sheets = allSheets && allSheets.length > 0 ? allSheets : [{ name: sheetData.name }];
            this.activeSheetName = activeSheet || sheetData.name;

            // Build fast O(1) cell metadata and style map
            this.cellMetaMap = {};
            this.stylesTable = this.data.styles || [];
            const gridCells = this.data.grid || [];
            for (let r = 0; r < gridCells.length; r++) {
                const rowList = gridCells[r];
                if (!rowList) continue;
                for (let c = 0; c < rowList.length; c++) {
                    const cell = rowList[c];
                    if (cell) {
                        this.cellMetaMap[`${cell.row}_${cell.col}`] = cell;
                    }
                }
            }

            this._ensureGridInitialized();
            this._renderSheetTabs();
            this._updateInfoStats();

            // Default selection: select A1
            if (sheetData.preview_rows >= 1 && sheetData.preview_cols >= 1) {
                this.anchorCell = { r: 1, c: 1 };
                this.leadCell = { r: 1, c: 1 };
                this.selectRange({ min_r: 1, min_c: 1, max_r: 1, max_c: 1 });
            }
        }

        _ensureGridInitialized() {
            if (!this.data) return;

            const cols = this.data.preview_cols || 1;
            const rows = this.data.preview_rows || 1;
            const widths = this.data.col_widths_px || {};
            const defW = this.data.default_col_width_px || 75;

            // 1. Build Column Definitions
            const colDefs = [
                {
                    headerName: ' ',
                    field: '_row_num',
                    pinned: 'left',
                    width: 48,
                    minWidth: 40,
                    maxWidth: 60,
                    sortable: false,
                    filter: false,
                    resizable: false,
                    cellClass: 'rg-ag-row-num-cell',
                    valueGetter: (params) => params.data ? params.data._row_num : ''
                }
            ];

            for (let c = 1; c <= cols; c++) {
                const colLetter = colIdxToLetter(c);
                const rawW = widths[c.toString()] || widths[c];
                const w = rawW ? Math.max(28, Math.round(rawW)) : defW;

                colDefs.push({
                    headerName: colLetter,
                    field: `col_${c}`,
                    colId: `col_${c}`,
                    width: w,
                    minWidth: 24,
                    sortable: false,
                    filter: false,
                    resizable: true,
                    colSpan: (params) => {
                        if (!params.data) return 1;
                        const r = params.data._row_num;
                        const meta = this.cellMetaMap ? this.cellMetaMap[`${r}_${c}`] : null;
                        if (meta && meta.merge && meta.is_anchor) {
                            return Math.max(1, meta.merge.max_col - meta.merge.min_col + 1);
                        }
                        return 1;
                    },
                    rowSpan: (params) => {
                        if (!params.data) return 1;
                        const r = params.data._row_num;
                        const meta = this.cellMetaMap ? this.cellMetaMap[`${r}_${c}`] : null;
                        if (meta && meta.merge && meta.is_anchor) {
                            return Math.max(1, meta.merge.max_row - meta.merge.min_row + 1);
                        }
                        return 1;
                    },
                    cellClassRules: {
                        'rg-cell-selected': (p) => this._isCellSelected(p.data ? p.data._row_num : 0, c),
                        'rg-cell-title': (p) => this._isCellInRegion(p.data ? p.data._row_num : 0, c, 'title'),
                        'rg-cell-header': (p) => this._isCellInRegion(p.data ? p.data._row_num : 0, c, 'header'),
                        'rg-cell-summary': (p) => this._isCellInRegion(p.data ? p.data._row_num : 0, c, 'summary'),
                        'rg-cell-highlight-col': (p) => this.highlightedCol === c,
                        'rg-cell-anchor': (p) => {
                            const r = p.data ? p.data._row_num : 0;
                            const meta = this.cellMetaMap ? this.cellMetaMap[`${r}_${c}`] : null;
                            return Boolean(meta && meta.merge && meta.is_anchor);
                        },
                        'rg-cell-covered': (p) => {
                            const r = p.data ? p.data._row_num : 0;
                            const meta = this.cellMetaMap ? this.cellMetaMap[`${r}_${c}`] : null;
                            return Boolean(meta && meta.merge && !meta.is_anchor);
                        }
                    },
                    cellStyle: (params) => {
                        if (!params.data) return null;
                        const r = params.data._row_num;
                        const meta = this.cellMetaMap ? this.cellMetaMap[`${r}_${c}`] : null;
                        if (!meta) return null;

                        const style = {};
                        if (meta.is_anchor && meta.merge) {
                            style.zIndex = '3';
                        }

                        if (meta.s !== undefined && this.stylesTable && this.stylesTable[meta.s]) {
                            const st = this.stylesTable[meta.s];
                            if (st.bg) {
                                style.backgroundColor = st.bg;
                            } else if (meta.is_anchor && meta.merge) {
                                style.backgroundColor = 'var(--ag-background-color, #ffffff)';
                            }

                            if (st.fc) style.color = st.fc;
                            if (st.b) style.fontWeight = 'bold';
                            if (st.i) style.fontStyle = 'italic';
                            if (st.u) style.textDecoration = 'underline';
                            if (st.fs) style.fontSize = `${Math.max(10, Math.min(22, Math.round(st.fs * 1.15)))}px`;

                            if (st.ha) {
                                if (st.ha === 'center') {
                                    style.justifyContent = 'center';
                                    style.textAlign = 'center';
                                } else if (st.ha === 'right') {
                                    style.justifyContent = 'flex-end';
                                    style.textAlign = 'right';
                                } else if (st.ha === 'left') {
                                    style.justifyContent = 'flex-start';
                                    style.textAlign = 'left';
                                }
                            }

                            if (st.va) {
                                if (st.va === 'top') style.alignItems = 'flex-start';
                                else if (st.va === 'center' || st.va === 'middle') style.alignItems = 'center';
                                else if (st.va === 'bottom') style.alignItems = 'flex-end';
                            }

                            if (st.wrap) {
                                style.whiteSpace = 'normal';
                                style.wordBreak = 'break-word';
                                style.lineHeight = '1.25';
                            }

                            if (st.bd) {
                                const borderMap = {
                                    thin: '1px solid',
                                    medium: '2px solid',
                                    thick: '3px solid',
                                    double: '3px double',
                                    dashed: '1px dashed',
                                    dotted: '1px dotted'
                                };
                                if (st.bd.top) style.borderTop = `${borderMap[st.bd.top.s] || '1px solid'} ${st.bd.top.c || 'var(--ag-row-border-color, #d1d5db)'}`;
                                if (st.bd.bottom) style.borderBottom = `${borderMap[st.bd.bottom.s] || '1px solid'} ${st.bd.bottom.c || 'var(--ag-row-border-color, #d1d5db)'}`;
                                if (st.bd.left) style.borderLeft = `${borderMap[st.bd.left.s] || '1px solid'} ${st.bd.left.c || 'var(--ag-row-border-color, #d1d5db)'}`;
                                if (st.bd.right) style.borderRight = `${borderMap[st.bd.right.s] || '1px solid'} ${st.bd.right.c || 'var(--ag-row-border-color, #d1d5db)'}`;
                            }
                        } else if (meta.is_anchor && meta.merge) {
                            style.backgroundColor = 'var(--ag-background-color, #ffffff)';
                        }

                        return style;
                    },
                    valueFormatter: (p) => {
                        const val = p.value;
                        return (val !== null && val !== undefined) ? String(val) : '';
                    }
                });
            }

            // 2. Build Row Data
            const rowData = [];
            const gridCells = this.data.grid || [];
            for (let r = 1; r <= rows; r++) {
                const rowObj = { _row_num: r };
                const rowCells = gridCells[r - 1] || [];
                for (let c = 1; c <= cols; c++) {
                    const cell = rowCells[c - 1];
                    let val = '';
                    if (cell) {
                        if (cell.value !== undefined && cell.value !== null) val = cell.value;
                        else if (cell.formatted !== undefined && cell.formatted !== null) val = cell.formatted;
                    }
                    rowObj[`col_${c}`] = val;
                }
                rowData.push(rowObj);
            }

            // 3. Create or Update AG-Grid
            if (!this.gridApi) {
                const ag = global.agGrid || (typeof window !== 'undefined' ? window.agGrid : null);
                if (!ag || typeof ag.createGrid !== 'function') {
                    console.error('AG-Grid Community library is not loaded!');
                    if (this.gridDiv) {
                        this.gridDiv.innerHTML = '<div class="p-3 text-danger"><i class="fa-solid fa-triangle-exclamation me-1"></i> Không tải được thư viện AG-Grid. Vui lòng thử lại.</div>';
                    }
                    return;
                }

                const gridOptions = {
                    columnDefs: colDefs,
                    rowData: rowData,
                    headerHeight: 24,
                    suppressRowTransform: true, // Mandatory for AG-Grid Community rowSpan
                    getRowHeight: (params) => {
                        if (!params.data) return 24;
                        const r = params.data._row_num;
                        const rHeights = (this.data && this.data.row_heights_px) || {};
                        const defH = (this.data && this.data.default_row_height_px) || 20;
                        const rawH = rHeights[r.toString()] || rHeights[r];
                        return rawH ? Math.max(18, Math.round(rawH)) : Math.max(18, Math.round(defH));
                    },
                    suppressMovableColumns: true,
                    suppressCellFocus: true, // Controlled by our Excel-like custom selection
                    enableCellTextSelection: false,
                    ensureDomOrder: true,
                    defaultColDef: {
                        sortable: false,
                        filter: false,
                        resizable: true,
                        minWidth: 24
                    },
                    onGridReady: (params) => {
                        this.gridApi = params.api;
                        if (this.selectedRange) {
                            this.selectRange(this.selectedRange);
                        }
                    }
                };

                this.gridApi = ag.createGrid(this.gridDiv, gridOptions);
            } else {
                // DO NOT rebuild DOM, update smoothly through Grid API
                if (typeof this.gridApi.setGridOption === 'function') {
                    this.gridApi.setGridOption('columnDefs', colDefs);
                    this.gridApi.setGridOption('rowData', rowData);
                } else {
                    if (typeof this.gridApi.setColumnDefs === 'function') this.gridApi.setColumnDefs(colDefs);
                    if (typeof this.gridApi.setRowData === 'function') this.gridApi.setRowData(rowData);
                }
                if (typeof this.gridApi.resetRowHeights === 'function') {
                    this.gridApi.resetRowHeights();
                }
                if (typeof this.gridApi.redrawRows === 'function') {
                    this.gridApi.redrawRows();
                }
            }
        }

        _updateSelectionRange(r1, c1, r2, c2) {
            const min_r = Math.min(r1, r2);
            const max_r = Math.max(r1, r2);
            const min_c = Math.min(c1, c2);
            const max_c = Math.max(c1, c2);

            this.selectedRange = { min_r, min_c, max_r, max_c };
            const rangeStr = formatRangeStr(min_r, min_c, max_r, max_c);

            if (this.nameBox) this.nameBox.value = rangeStr;
            this._updateSelectionSizeBadge(min_r, min_c, max_r, max_c);
            this._updateFxBar(min_r, min_c);

            // Re-render cell highlight classes
            if (this.gridApi) {
                this.gridApi.refreshCells({ force: true });
            }

            if (typeof this.options.onSelectRange === 'function') {
                this.options.onSelectRange(rangeStr, this.selectedRange);
            }
        }

        _updateSelectionSizeBadge(min_r, min_c, max_r, max_c) {
            if (!this.sizeBadge) return;
            const rCount = max_r - min_r + 1;
            const cCount = max_c - min_c + 1;
            if (rCount > 1 || cCount > 1) {
                this.sizeBadge.textContent = `${rCount}R × ${cCount}C`;
            } else {
                this.sizeBadge.textContent = '';
            }
        }

        _updateFxBar(r, c) {
            if (!this.fxInput || !this.data || !this.data.grid) return;
            const rowCells = this.data.grid[r - 1] || [];
            const cell = rowCells[c - 1];
            let val = '';
            if (cell) {
                val = cell.raw !== undefined ? cell.raw : (cell.formatted || cell.value || '');
            }
            this.fxInput.value = val;
        }

        _isCellSelected(r, c) {
            if (!this.selectedRange) return false;
            return r >= this.selectedRange.min_r && r <= this.selectedRange.max_r &&
                   c >= this.selectedRange.min_c && c <= this.selectedRange.max_c;
        }

        _isCellInRegion(r, c, kind) {
            const rangeStr = this.regions ? this.regions[kind] : null;
            if (!rangeStr) return false;
            const rng = parseRangeStr(rangeStr);
            if (!rng) return false;
            return r >= rng.min_r && r <= rng.max_r && c >= rng.min_c && c <= rng.max_c;
        }

        selectRange(rangeObj) {
            if (!rangeObj) return;
            let rng = typeof rangeObj === 'string' ? parseRangeStr(rangeObj) : rangeObj;
            if (!rng) return;
            this.anchorCell = { r: rng.min_r, c: rng.min_c };
            this.leadCell = { r: rng.max_r, c: rng.max_c };
            this.dragStart = { r: rng.min_r, c: rng.min_c };
            this._updateSelectionRange(rng.min_r, rng.min_c, rng.max_r, rng.max_c);
        }

        getSelectedRangeStr() {
            if (!this.selectedRange) return '';
            return formatRangeStr(
                this.selectedRange.min_r,
                this.selectedRange.min_c,
                this.selectedRange.max_r,
                this.selectedRange.max_c
            );
        }

        setRegions(regionsMap) {
            this.regions = Object.assign({}, regionsMap);
            if (this.gridApi) {
                this.gridApi.refreshCells({ force: true });
            }
        }

        refreshLayout() {
            if (!this.gridApi) return;
            try {
                if (typeof this.gridApi.redrawRows === 'function') {
                    this.gridApi.redrawRows();
                }
                if (typeof this.gridApi.refreshCells === 'function') {
                    this.gridApi.refreshCells({ force: true });
                }
            } catch (_) {}
            window.dispatchEvent(new Event('resize'));
        }

        scrollToCell(r, c) {
            if (!this.gridApi) return;
            try {
                const targetRowIndex = Math.max(0, r - 1);
                this.gridApi.ensureIndexVisible(targetRowIndex, 'auto');
                const targetColId = `col_${c}`;
                this.gridApi.ensureColumnVisible(targetColId);
            } catch (_) {}
        }

        scrollToRange(rangeStrOrObj) {
            if (!this.gridApi) return;
            let rng = typeof rangeStrOrObj === 'string' ? parseRangeStr(rangeStrOrObj) : rangeStrOrObj;
            if (!rng) return;

            this.selectRange(rng);
            this.scrollToCell(rng.min_r, rng.min_c);
        }

        _showContextMenu(x, y) {
            this._hideContextMenu();

            const curRangeStr = this.getSelectedRangeStr();
            if (!curRangeStr) return;

            const menu = document.createElement('div');
            menu.className = 'sg-context-menu dropdown-menu show shadow-sm';
            menu.style.position = 'fixed';
            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
            menu.style.zIndex = '9999';
            menu.style.minWidth = '220px';
            menu.style.fontSize = '12px';
            menu.style.borderRadius = '6px';

            menu.innerHTML = `
                <div class="dropdown-header small fw-bold text-muted py-1">Vùng chọn: <span class="badge bg-primary-subtle text-primary">${curRangeStr}</span></div>
                <div class="dropdown-divider my-1"></div>
                <button type="button" class="dropdown-item py-1" data-action="set" data-kind="title">
                    <i class="fa-solid fa-heading text-info me-2"></i> Gán vùng <strong>Title</strong>
                </button>
                <button type="button" class="dropdown-item py-1" data-action="set" data-kind="header">
                    <i class="fa-solid fa-table text-warning me-2"></i> Gán vùng <strong>Content</strong>
                </button>
                <button type="button" class="dropdown-item py-1" data-action="set" data-kind="summary">
                    <i class="fa-solid fa-calculator text-primary me-2"></i> Gán vùng <strong>Summary</strong>
                </button>
                <div class="dropdown-divider my-1"></div>
                <button type="button" class="dropdown-item py-1 text-danger" data-action="clear" data-kind="all">
                    <i class="fa-solid fa-trash-can me-2"></i> Xóa tất cả khoanh vùng sheet
                </button>
            `;

            menu.addEventListener('click', (ev) => {
                const item = ev.target.closest('.dropdown-item');
                if (!item) return;
                const action = item.getAttribute('data-action');
                const kind = item.getAttribute('data-kind');
                this._hideContextMenu();

                if (typeof this.options.onAssignRegion === 'function') {
                    if (action === 'set') {
                        this.options.onAssignRegion(kind, curRangeStr);
                    } else if (action === 'clear') {
                        ['title', 'header', 'summary'].forEach(k => {
                            this.options.onAssignRegion(k, null);
                        });
                    }
                }
            });

            document.body.appendChild(menu);
            this._activeContextMenu = menu;

            const closeHandler = (ev) => {
                if (!menu.contains(ev.target)) {
                    this._hideContextMenu();
                    window.removeEventListener('mousedown', closeHandler);
                }
            };
            setTimeout(() => {
                window.addEventListener('mousedown', closeHandler);
            }, 10);
        }

        _hideContextMenu() {
            if (this._activeContextMenu && this._activeContextMenu.parentNode) {
                this._activeContextMenu.parentNode.removeChild(this._activeContextMenu);
            }
            this._activeContextMenu = null;
        }

        _handleKeyDown(e) {
            if (this.options.readOnly || !this.data || !this.gridApi) return;

            // Do not intercept if user is typing inside an input/textarea/select outside grid
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
                return;
            }

            // Only handle if grid container is visible and attached to document
            if (!this.container || !document.body.contains(this.container) || this.container.offsetParent === null) {
                return;
            }

            const maxR = this.data.preview_rows || 1;
            const maxC = this.data.preview_cols || 1;

            // Ctrl + A: Select All preview cells
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                this.anchorCell = { r: 1, c: 1 };
                this.leadCell = { r: maxR, c: maxC };
                this.dragStart = { r: 1, c: 1 };
                this._updateSelectionRange(1, 1, maxR, maxC);
                this.scrollToCell(1, 1);
                return;
            }

            // Ctrl + Home: Jump to A1
            if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
                e.preventDefault();
                this.anchorCell = { r: 1, c: 1 };
                this.leadCell = { r: 1, c: 1 };
                this.dragStart = { r: 1, c: 1 };
                this._updateSelectionRange(1, 1, 1, 1);
                this.scrollToCell(1, 1);
                return;
            }

            // Home: Jump to column 1 of current row
            if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const curR = this.anchorCell ? this.anchorCell.r : 1;
                if (e.shiftKey) {
                    this.leadCell = { r: this.leadCell ? this.leadCell.r : curR, c: 1 };
                    const anchor = this.anchorCell || { r: curR, c: 1 };
                    this._updateSelectionRange(anchor.r, anchor.c, this.leadCell.r, 1);
                } else {
                    this.anchorCell = { r: curR, c: 1 };
                    this.leadCell = { r: curR, c: 1 };
                    this.dragStart = { r: curR, c: 1 };
                    this._updateSelectionRange(curR, 1, curR, 1);
                }
                this.scrollToCell(curR, 1);
                return;
            }

            const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
            const isTab = e.key === 'Tab';
            const isEnter = e.key === 'Enter';

            if (!isArrow && !isTab && !isEnter) return;

            e.preventDefault();

            if (!this.anchorCell) this.anchorCell = { r: 1, c: 1 };
            if (!this.leadCell) this.leadCell = { r: this.anchorCell.r, c: this.anchorCell.c };

            if (e.shiftKey && isArrow) {
                // Shift + Arrow: Expand / shrink rectangular selection from anchor to lead
                let newLeadR = this.leadCell.r;
                let newLeadC = this.leadCell.c;

                if (e.key === 'ArrowUp') newLeadR = Math.max(1, newLeadR - 1);
                else if (e.key === 'ArrowDown') newLeadR = Math.min(maxR, newLeadR + 1);
                else if (e.key === 'ArrowLeft') newLeadC = Math.max(1, newLeadC - 1);
                else if (e.key === 'ArrowRight') newLeadC = Math.min(maxC, newLeadC + 1);

                this.leadCell = { r: newLeadR, c: newLeadC };
                this._updateSelectionRange(this.anchorCell.r, this.anchorCell.c, newLeadR, newLeadC);
                this.scrollToCell(newLeadR, newLeadC);
            } else {
                // Normal navigation: Move single selection
                let nextR = this.anchorCell.r;
                let nextC = this.anchorCell.c;

                if (e.key === 'ArrowUp' || (isEnter && e.shiftKey)) {
                    const minR = this.selectedRange ? this.selectedRange.min_r : this.anchorCell.r;
                    nextR = Math.max(1, minR - 1);
                    nextC = this.anchorCell.c;
                } else if (e.key === 'ArrowDown' || (isEnter && !e.shiftKey)) {
                    const maxRBound = this.selectedRange ? this.selectedRange.max_r : this.anchorCell.r;
                    nextR = Math.min(maxR, maxRBound + 1);
                    nextC = this.anchorCell.c;
                } else if (e.key === 'ArrowLeft' || (isTab && e.shiftKey)) {
                    const minC = this.selectedRange ? this.selectedRange.min_c : this.anchorCell.c;
                    nextC = Math.max(1, minC - 1);
                    nextR = this.anchorCell.r;
                } else if (e.key === 'ArrowRight' || (isTab && !e.shiftKey)) {
                    const maxCBound = this.selectedRange ? this.selectedRange.max_c : this.anchorCell.c;
                    nextC = Math.min(maxC, maxCBound + 1);
                    nextR = this.anchorCell.r;
                }

                const meta = this.cellMetaMap ? this.cellMetaMap[`${nextR}_${nextC}`] : null;
                if (meta && meta.merge) {
                    this.anchorCell = { r: meta.merge.min_row, c: meta.merge.min_col };
                    this.leadCell = { r: meta.merge.max_row, c: meta.merge.max_col };
                    this.dragStart = { r: meta.merge.min_row, c: meta.merge.min_col };
                    this._updateSelectionRange(meta.merge.min_row, meta.merge.min_col, meta.merge.max_row, meta.merge.max_col);
                    this.scrollToCell(meta.merge.min_row, meta.merge.min_col);
                } else {
                    this.anchorCell = { r: nextR, c: nextC };
                    this.leadCell = { r: nextR, c: nextC };
                    this.dragStart = { r: nextR, c: nextC };
                    this._updateSelectionRange(nextR, nextC, nextR, nextC);
                    this.scrollToCell(nextR, nextC);
                }
            }
        }

        highlightColumn(colLetterOrIdx) {
            if (!colLetterOrIdx) {
                this.highlightedCol = null;
            } else {
                let c = typeof colLetterOrIdx === 'string' ? colLetterToIdx(colLetterOrIdx) : colLetterOrIdx;
                this.highlightedCol = c;
            }
            if (this.gridApi) {
                this.gridApi.refreshCells({ force: true });
            }
        }

        _renderSheetTabs() {
            if (!this.sheetTabsEl || !this.sheets || this.sheets.length <= 0) return;
            let html = '';
            this.sheets.forEach(sh => {
                // Safely extract string sheet name regardless of format
                const sName = typeof sh === 'object' && sh !== null ? (sh.name || '') : String(sh);
                if (!sName) return;

                const isActive = (sName === this.activeSheetName);
                html += `
                    <div class="sg-tab-item ${isActive ? 'active' : ''}" data-sheet="${this._escapeHtml(sName)}" title="Xem sheet: ${this._escapeHtml(sName)}">
                        <i class="fa-solid fa-file-excel text-success"></i>
                        <span class="sg-tab-title">${this._escapeHtml(sName)}</span>
                    </div>
                `;
            });
            this.sheetTabsEl.innerHTML = html;

            this.sheetTabsEl.querySelectorAll('.sg-tab-item').forEach(el => {
                el.addEventListener('click', () => {
                    const sName = el.dataset.sheet;
                    if (sName !== this.activeSheetName && typeof this.options.onSheetChange === 'function') {
                        this.options.onSheetChange(sName);
                    }
                });
            });
        }

        _updateInfoStats() {
            if (!this.infoStatsEl || !this.data) return;
            const tr = this.data.truncated;
            let msg = `Hiển thị ${this.data.preview_rows} dòng × ${this.data.preview_cols} cột`;
            if (tr && (tr.rows || tr.cols)) {
                msg = `<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>Đang xem ${this.data.preview_rows}/${tr.total_rows} dòng</span>`;
            }
            this.infoStatsEl.innerHTML = msg;
        }

        _escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        destroy() {
            this._hideContextMenu();
            if (this._keydownHandler) {
                window.removeEventListener('keydown', this._keydownHandler);
                this._keydownHandler = null;
            }
            if (this.gridApi) {
                this.gridApi.destroy();
                this.gridApi = null;
            }
        }
    }

    SheetGrid.parseRangeStr = parseRangeStr;
    SheetGrid.formatRangeStr = formatRangeStr;
    SheetGrid.colIdxToLetter = colIdxToLetter;
    SheetGrid.colLetterToIdx = colLetterToIdx;

    global.SheetGrid = SheetGrid;

})(window);
