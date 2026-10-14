/**
 * prototype.js
 * Controller chính điều khiển AG Grid Community Prototype.
 * Quản lý 5 Result Sets, chế độ Eager/Lazy, Append Batch 1,000 Rows,
 * Splitter Resize Dragging, và tích hợp Performance Benchmark.
 */

(function () {
    'use strict';

    const global = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

    // ── State Management ────────────────────────────────────────────────────────
    const NUM_RESULT_SETS = 5;
    let activeResultIdx = 0;
    let isLazyInitMode = true;
    let currentTheme = 'ag-theme-quartz-dark';

    // Metadata & Instances cho 5 Result Sets
    const resultSets = Array.from({ length: NUM_RESULT_SETS }, (_, i) => ({
        index: i,
        name: `Result Set ${i + 1}`,
        colDefs: [],
        rowData: [],
        gridApi: null,
        isInitialized: false,
        totalRows: 0,
        totalCols: 0,
        initTimeMs: 0
    }));

    // Splitter stats
    let resizeEventCount = 0;
    let isSplitterDragging = false;
    let isThrottledResize = true;

    // ── DOM References ──────────────────────────────────────────────────────────
    const dom = {
        rowCountSelect: document.getElementById('row-count-select'),
        colCountSelect: document.getElementById('col-count-select'),
        initModeSelect: document.getElementById('init-mode-select'),
        themeSelect: document.getElementById('theme-select'),
        btnGenerate: document.getElementById('btn-generate'),
        btnAppend: document.getElementById('btn-append'),
        btnClear: document.getElementById('btn-clear'),
        btnBenchmark: document.getElementById('btn-benchmark'),
        tabsContainer: document.getElementById('tabs-container'),
        gridStage: document.getElementById('grid-stage'),
        splitter: document.getElementById('splitter-handle'),
        metricsPanel: document.getElementById('metrics-panel'),
        metricsTableBody: document.getElementById('metrics-table-body'),
        // Footer stats
        statActiveTab: document.getElementById('stat-active-tab'),
        statRows: document.getElementById('stat-rows'),
        statCols: document.getElementById('stat-cols'),
        statInitTime: document.getElementById('stat-init-time'),
        statActionTime: document.getElementById('stat-action-time'),
        statDomNodes: document.getElementById('stat-dom-nodes'),
        statResizeEvents: document.getElementById('stat-resize-events')
    };

    // ── Initialization ──────────────────────────────────────────────────────────
    function init() {
        createResultPanes();
        createTabs();
        setupEventListeners();
        setupSplitter();
        updateFooter();

        // Tự động tạo dữ liệu mẫu ban đầu (2,000 dòng × 20 cột)
        generateDataForActiveTab();
    }

    // ── Panes & Tabs Creation ───────────────────────────────────────────────────
    function createResultPanes() {
        dom.gridStage.innerHTML = '';
        resultSets.forEach((rs, idx) => {
            const pane = document.createElement('div');
            pane.id = `ag-pane-${idx}`;
            pane.className = `ag-proto-pane ${idx === activeResultIdx ? 'active' : ''}`;

            const gridDiv = document.createElement('div');
            gridDiv.id = `ag-grid-${idx}`;
            gridDiv.className = `ag-proto-grid-instance ${currentTheme}`;

            pane.appendChild(gridDiv);
            dom.gridStage.appendChild(pane);
            rs.containerEl = gridDiv;
            rs.paneEl = pane;
        });
    }

    function createTabs() {
        dom.tabsContainer.innerHTML = '';
        resultSets.forEach((rs, idx) => {
            const tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.className = `ag-proto-tab ${idx === activeResultIdx ? 'active' : ''}`;
            tabBtn.innerHTML = `
                <i class="fa-solid fa-table"></i>
                <span>${rs.name}</span>
                <span class="ag-proto-tab-badge" id="tab-badge-${idx}">0</span>
            `;
            tabBtn.addEventListener('click', () => switchResultSet(idx));
            dom.tabsContainer.appendChild(tabBtn);
        });
    }

    function updateTabBadges() {
        resultSets.forEach((rs, idx) => {
            const badge = document.getElementById(`tab-badge-${idx}`);
            if (badge) {
                badge.textContent = rs.totalRows.toLocaleString();
            }
        });
    }

    // ── Switching Result Sets ───────────────────────────────────────────────────
    function switchResultSet(newIdx) {
        if (newIdx === activeResultIdx) return;
        activeResultIdx = newIdx;

        // Cập nhật tab active class
        const tabs = dom.tabsContainer.querySelectorAll('.ag-proto-tab');
        tabs.forEach((t, i) => t.classList.toggle('active', i === activeResultIdx));

        // Cập nhật pane active class
        resultSets.forEach((rs, i) => {
            if (rs.paneEl) {
                rs.paneEl.classList.toggle('active', i === activeResultIdx);
            }
        });

        const activeRs = resultSets[activeResultIdx];

        // Nếu ở chế độ Lazy và Result Set chưa được khởi tạo grid nhưng đã có data
        if (isLazyInitMode && !activeRs.isInitialized && activeRs.rowData.length > 0) {
            initGridInstance(activeRs);
        }

        updateFooter();
        logMetric(`Switched to ${activeRs.name}`, 0, `Rows: ${activeRs.totalRows.toLocaleString()}`);
    }

    // ── AG Grid Instance Lifecycle ──────────────────────────────────────────────
    function initGridInstance(rs) {
        if (!rs.containerEl || !global.agGrid) return;

        if (rs.gridApi) {
            rs.gridApi.destroy();
            rs.gridApi = null;
        }

        const t0 = performance.now();

        const gridOptions = {
            columnDefs: rs.colDefs,
            rowData: rs.rowData,
            defaultColDef: {
                sortable: true,
                filter: true,
                resizable: true,
                minWidth: 80
            },
            rowSelection: 'multiple',
            enableCellTextSelection: true,
            ensureDomOrder: true,
            suppressRowClickSelection: false,
            animateRows: false, // Tắt animation để tối ưu hiệu năng tối đa
            rowBuffer: 15,      // Virtual scroll buffer 15 dòng
            onGridReady: (params) => {
                rs.gridApi = params.api;
            }
        };

        // AG Grid Community v31 API: createGrid
        if (typeof global.agGrid.createGrid === 'function') {
            rs.gridApi = global.agGrid.createGrid(rs.containerEl, gridOptions);
        } else if (typeof global.agGrid.Grid === 'function') {
            new global.agGrid.Grid(rs.containerEl, gridOptions);
            rs.gridApi = gridOptions.api;
        }

        rs.isInitialized = true;
        rs.initTimeMs = performance.now() - t0;
        updateFooter();
        return rs.initTimeMs;
    }

    // ── Data Generation ─────────────────────────────────────────────────────────
    function generateDataForActiveTab() {
        const rowCount = parseInt(dom.rowCountSelect.value, 10) || 2000;
        const colCount = parseInt(dom.colCountSelect.value, 10) || 20;

        const t0 = performance.now();
        const dataset = global.MockDataGenerator.generateDataset(rowCount, colCount, (activeResultIdx + 1) * 100);
        const dataGenMs = performance.now() - t0;

        const rs = resultSets[activeResultIdx];
        rs.colDefs = dataset.colDefs;
        rs.rowData = dataset.rowData;
        rs.totalRows = rowCount;
        rs.totalCols = colCount;

        const initMs = initGridInstance(rs);
        updateTabBadges();
        updateFooter();

        logMetric(`Generated ${rs.name}`, dataGenMs, `Rows: ${rowCount}, Cols: ${colCount}, Grid Init: ${initMs.toFixed(1)}ms`);
    }

    function generateAllTabsEagerly() {
        const rowCount = parseInt(dom.rowCountSelect.value, 10) || 2000;
        const colCount = parseInt(dom.colCountSelect.value, 10) || 20;

        const t0 = performance.now();
        resultSets.forEach((rs, idx) => {
            const dataset = global.MockDataGenerator.generateDataset(rowCount, colCount, (idx + 1) * 100);
            rs.colDefs = dataset.colDefs;
            rs.rowData = dataset.rowData;
            rs.totalRows = rowCount;
            rs.totalCols = colCount;
            initGridInstance(rs);
        });

        const totalMs = performance.now() - t0;
        updateTabBadges();
        updateFooter();
        logMetric(`Eagerly Initialized 5 Result Sets`, totalMs, `Total rows: ${(rowCount * 5).toLocaleString()}`);
    }

    // ── Batch Update: Append 1,000 Rows ─────────────────────────────────────────
    function appendRowsToActiveTab() {
        const rs = resultSets[activeResultIdx];
        if (!rs.isInitialized || !rs.gridApi) {
            alert('Vui lòng tạo dữ liệu (Generate Data) trước khi Append!');
            return;
        }

        const countToAppend = 1000;
        const colCount = rs.totalCols || 20;
        const startId = rs.totalRows + 1;

        const tGen0 = performance.now();
        const newRows = global.MockDataGenerator.generateAppendRows(startId, countToAppend, colCount);
        const genTimeMs = performance.now() - tGen0;

        const tApi0 = performance.now();
        // Sử dụng AG Grid Transaction API: applyTransaction({ add: newRows })
        rs.gridApi.applyTransaction({ add: newRows });
        const apiTimeMs = performance.now() - tApi0;

        // Cập nhật bộ nhớ cục bộ
        rs.rowData.push(...newRows);
        rs.totalRows = rs.rowData.length;

        // Đo visual completion qua rAF
        requestAnimationFrame(() => {
            const visualTimeMs = performance.now() - tApi0;
            updateTabBadges();
            updateFooter();
            logMetric(`Append 1,000 rows (${rs.name})`, apiTimeMs, `Gen: ${genTimeMs.toFixed(1)}ms, Visual: ${visualTimeMs.toFixed(1)}ms, Total: ${rs.totalRows.toLocaleString()} rows`);
        });
    }

    // ── Clear Data ──────────────────────────────────────────────────────────────
    function clearActiveTab() {
        const rs = resultSets[activeResultIdx];
        if (rs.gridApi) {
            rs.gridApi.destroy();
            rs.gridApi = null;
        }
        rs.isInitialized = false;
        rs.rowData = [];
        rs.colDefs = [];
        rs.totalRows = 0;
        rs.totalCols = 0;
        rs.initTimeMs = 0;

        updateTabBadges();
        updateFooter();
        logMetric(`Cleared ${rs.name}`, 0, 'Grid destroyed');
    }

    // ── Splitter Resizing (Live Drag Benchmark) ──────────────────────────────────
    function setupSplitter() {
        const splitter = dom.splitter;
        const stage = dom.gridStage;
        let startY = 0;
        let startH = 0;
        let rAF = null;

        splitter.addEventListener('pointerdown', (e) => {
            isSplitterDragging = true;
            splitter.setPointerCapture(e.pointerId);
            splitter.classList.add('dragging');
            startY = e.clientY;
            startH = stage.offsetHeight;
            resizeEventCount = 0;
        });

        splitter.addEventListener('pointermove', (e) => {
            if (!isSplitterDragging) return;
            resizeEventCount++;
            const deltaY = e.clientY - startY;
            const newH = Math.max(100, Math.min(window.innerHeight - 250, startH + deltaY));

            if (isThrottledResize) {
                if (rAF) cancelAnimationFrame(rAF);
                rAF = requestAnimationFrame(() => {
                    stage.style.flex = 'none';
                    stage.style.height = `${newH}px`;
                    dom.statResizeEvents.textContent = `${resizeEventCount} events`;
                });
            } else {
                stage.style.flex = 'none';
                stage.style.height = `${newH}px`;
                dom.statResizeEvents.textContent = `${resizeEventCount} events`;
            }
        });

        const stopDrag = () => {
            if (!isSplitterDragging) return;
            isSplitterDragging = false;
            splitter.classList.remove('dragging');
            if (rAF) cancelAnimationFrame(rAF);
            logMetric('Resize Stage Complete', 0, `Total move events: ${resizeEventCount}, Throttled: ${isThrottledResize}`);
        };

        splitter.addEventListener('pointerup', stopDrag);
        splitter.addEventListener('pointercancel', stopDrag);
    }

    // ── Comprehensive Benchmark Suite ───────────────────────────────────────────
    async function runBenchmarkSuite() {
        dom.btnBenchmark.disabled = true;
        dom.btnBenchmark.textContent = 'Running...';

        const rowCount = parseInt(dom.rowCountSelect.value, 10) || 2000;
        const colCount = parseInt(dom.colCountSelect.value, 10) || 20;
        const rs = resultSets[activeResultIdx];

        try {
            const report = await global.Benchmark.runSuite({
                gridWrapper: rs.containerEl,
                rowCount,
                colCount,
                applyDataset: async (dataset) => {
                    rs.colDefs = dataset.colDefs;
                    rs.rowData = dataset.rowData;
                    rs.totalRows = rowCount;
                    rs.totalCols = colCount;
                    initGridInstance(rs);
                },
                appendRows: async (newRows) => {
                    if (rs.gridApi) {
                        rs.gridApi.applyTransaction({ add: newRows });
                        rs.rowData.push(...newRows);
                        rs.totalRows = rs.rowData.length;
                    }
                },
                onStatus: (msg) => {
                    dom.statActionTime.textContent = msg;
                }
            });

            updateTabBadges();
            updateFooter();

            logMetric('BENCHMARK SUITE COMPLETED', report.metrics.renderMs, 
                `Rows: ${rowCount}, Cols: ${colCount}, Visual: ${report.metrics.visualMs}ms, Append: ${report.metrics.appendMs}ms, DOM Nodes: ${report.domNodes}`);
        } catch (err) {
            console.error('Benchmark failed:', err);
        } finally {
            dom.btnBenchmark.disabled = false;
            dom.btnBenchmark.innerHTML = '<i class="fa-solid fa-bolt"></i> Run Benchmark';
        }
    }

    // ── UI Metrics Logger ───────────────────────────────────────────────────────
    function logMetric(taskName, durationMs, details = '') {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date().toLocaleTimeString()}</td>
            <td style="font-weight: 600;">${taskName}</td>
            <td style="color: var(--ag-proto-accent);">${durationMs > 0 ? durationMs.toFixed(2) + ' ms' : '-'}</td>
            <td style="color: var(--ag-proto-text-muted);">${details}</td>
        `;
        dom.metricsTableBody.insertBefore(row, dom.metricsTableBody.firstChild);

        // Giữ tối đa 20 dòng log
        while (dom.metricsTableBody.children.length > 20) {
            dom.metricsTableBody.removeChild(dom.metricsTableBody.lastChild);
        }

        if (durationMs > 0) {
            dom.statActionTime.textContent = `${durationMs.toFixed(1)} ms`;
        }
    }

    function updateFooter() {
        const rs = resultSets[activeResultIdx];
        dom.statActiveTab.textContent = rs.name;
        dom.statRows.textContent = rs.totalRows.toLocaleString();
        dom.statCols.textContent = rs.totalCols;
        dom.statInitTime.textContent = rs.initTimeMs > 0 ? `${rs.initTimeMs.toFixed(1)} ms` : '-';
        if (rs.containerEl) {
            dom.statDomNodes.textContent = rs.containerEl.getElementsByTagName('*').length.toLocaleString();
        }
    }

    // ── Event Handlers ──────────────────────────────────────────────────────────
    function setupEventListeners() {
        dom.btnGenerate.addEventListener('click', () => {
            if (dom.initModeSelect.value === 'eager') {
                generateAllTabsEagerly();
            } else {
                generateDataForActiveTab();
            }
        });

        dom.btnAppend.addEventListener('click', appendRowsToActiveTab);
        dom.btnClear.addEventListener('click', clearActiveTab);
        dom.btnBenchmark.addEventListener('click', runBenchmarkSuite);

        dom.initModeSelect.addEventListener('change', (e) => {
            isLazyInitMode = (e.target.value === 'lazy');
            logMetric('Switched Init Mode', 0, isLazyInitMode ? 'Lazy Initialization' : 'Eager Initialization');
        });

        dom.themeSelect.addEventListener('change', (e) => {
            const oldTheme = currentTheme;
            currentTheme = e.target.value;
            resultSets.forEach(rs => {
                if (rs.containerEl) {
                    rs.containerEl.classList.remove(oldTheme);
                    rs.containerEl.classList.add(currentTheme);
                }
            });
            document.documentElement.setAttribute('data-theme', currentTheme.includes('dark') ? 'dark' : 'light');
        });
    }

    // Khởi chạy khi DOM sẵn sàng
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
