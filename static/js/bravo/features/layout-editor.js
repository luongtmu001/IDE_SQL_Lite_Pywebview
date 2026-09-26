/**
 * BRAVO Feature: Soạn thảo Layout XML (Layout Editor)
 * Feature ID: layout-editor
 * Specification: edit_layout.md
 */
(function () {
    'use strict';

    if (typeof window.BravoFeatureRegistry === 'undefined') {
        console.warn('[BRAVO] BravoFeatureRegistry not loaded. layout-editor will not register.');
        return;
    }

    BravoFeatureRegistry.register({
        id: 'layout-editor',
        displayName: 'Soạn thảo layout',
        icon: 'fa-table-columns',
        order: 10,
        description: 'Trích xuất, phân tích, tìm kiếm, biên tập và cập nhật mã nguồn XML layout (Win & Mobile)',

        // Component State
        _container: null,
        _context: null,
        _platform: 'Win',         // 'Win' | 'Mobile'
        _version: 'Bravo 10',     // 'Bravo 7' | 'Bravo 8' | 'Bravo 10'
        _activeTab: 'CommandKey',
        _viewMode: 'active',      // 'active' (LayoutData) | 'draft' (LastLayoutData)
        _displayMode: 'editor',   // 'editor' | 'treemap' | 'split'
        _masterData: [],
        _checkedChecklistValues: null, // Set of currently checked filter values for activeTab
        _columnFilters: {},           // colName -> search string
        _selectedFormIds: new Set(),
        _dirtyFormIds: new Set(),
        _foldedLines: new Set(),   // Line indexes folded in Code Editor
        _activeForm: null,
        _customWhere: '',
        _xmlBuffer: {},           // formId -> current edited XML text in RAM
        _draftXmlBuffer: {},      // formId -> draft XML text in RAM
        _xmlMonaco: null,         // BravoXmlMonaco editor instance
        _connectionBar: null,     // BravoConnectionBar instance
        // ── Search state ────────────────────────────────────────────────────
        _searchQuery: '',         // Current search keyword
        _searchResults: [],       // [{formId, formName, layoutName, occurrences:[{line,content}], source}]
        _searchMatchIds: new Set(), // Set of formIds that matched search
        _searchResultCollapsed: false, // Whether result panel is collapsed
        _searchMatchNavIdx: 0,    // Current occurrence index when navigating in editor
        _searchMatchOccurrences: [], // Occurrences of current form in editor [{line}]
        _searchBackendRunning: false, // Whether backend search is in progress


        mount(containerEl, context) {
            this._container = containerEl;
            this._context = context;

            // Render Layout Structure
            containerEl.innerHTML = this._buildHTML();

            // Mount Reusable Database Connection Bar Component
            const connSlot = containerEl.querySelector('#bravo-le-connbar-slot');
            if (connSlot && typeof window.BravoConnectionBar !== 'undefined') {
                this._connectionBar = new window.BravoConnectionBar({
                    container: connSlot,
                    idPrefix: 'bravo-le-cb',
                    initialContext: {
                        connectionId: this._context?.connectionId,
                        connectionName: this._context?.connectionName,
                        database: this._context?.database,
                        schema: this._context?.schema,
                        dbType: this._context?.dbType || 'sqlserver'
                    },
                    onChange: (newCtx) => {
                        this._handleConnectionChange(newCtx);
                    },
                    onStatus: (msg, state) => {
                        if (this._context && typeof this._context.setStatus === 'function') {
                            this._context.setStatus(msg, state);
                        }
                    }
                });
            }

            // Bind Event Listeners & Behaviors
            this._wireEvents();
            this._updateVersionOptions();
            this._updateSqlPreview();
            this._renderChecklistTabs();
            this._initMonacoEditor();

            // Try loading from real backend if connection exists, else use sample demo data
            if (this._context && this._context.connectionId) {
                this._loadGridFromBackend();
            } else {
                this._initSampleData();
                this._renderGrid();
                this._updateStats();
                if (this._masterData.length > 0) {
                    this._activeForm = this._masterData[0];
                    this._loadFormXmlIntoEditor(this._activeForm);
                }
            }
        },

        // ── Clean Up / Destroy ────────────────────────────────────────────────
        destroy() {
            if (this._connectionBar) {
                this._connectionBar.destroy();
                this._connectionBar = null;
            }
            if (this._xmlMonaco) {
                try { this._xmlMonaco.dispose(); } catch (_) {}
                this._xmlMonaco = null;
            }
        },

        // ── React to Theme Changes ────────────────────────────────────────────
        onThemeChange(themeName) {
            if (this._xmlMonaco && typeof this._xmlMonaco.setTheme === 'function') {
                this._xmlMonaco.setTheme(themeName);
            }
        },

        // ── React to Connection Bar Changes ───────────────────────────────────
        _handleConnectionChange(newCtx) {
            if (!newCtx) return;
            this._context = Object.assign(this._context || {}, newCtx);

            // Notify parent window (syncs target in bottom status bar & window title)
            if (typeof this._context.onContextChanged === 'function') {
                this._context.onContextChanged(newCtx);
            }

            if (this._context.connectionId) {
                this._checkedChecklistValues = null;
                if (this._dirtyFormIds && typeof this._dirtyFormIds.clear === 'function') {
                    this._dirtyFormIds.clear();
                }
                this._xmlBuffer = {};
                this._draftXmlBuffer = {};
                this._updateSqlPreview();
                this._loadGridFromBackend();
            } else {
                this._masterData = [];
                this._renderGrid();
                this._updateStats();
                this._context?.setStatus('Chưa có kết nối CSDL hoạt động', 'idle');
            }
        },

        // ── React to External Context Changes ─────────────────────────────────
        onContextChange(context) {
            this._context = context || {};
            if (this._connectionBar) {
                this._connectionBar.setContext(this._context);
            }
            this._handleConnectionChange(this._context);
        },

        // ── Sample Demonstration Data (Fallback if no active backend connection) ─
        _initSampleData() {
            this._masterData = [
                {
                    id: 1,
                    formName: 'B30AccDoc',
                    layoutName: 'Layout1',
                    layoutType: 'Layout',
                    isTemplate: 0,
                    commandKey: 'B30AccDoc',
                    dllName: 'Bravo.Finance.dll',
                    className: 'B30AccDocView',
                    modifiedAt: '2026-09-11 02:26',
                    modifiedBy: 'Admin',
                    hasDraft: 1,
                    isDirty: false,
                    xml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B30AccDoc" Width="1024" Height="768">\n  <Header Title="Chứng từ kế toán tổng hợp" AllowMinimize="True" />\n  <Controls>\n    <Grid Name="grdDoc" Dock="Fill">\n      <Column Name="DocNo" Title="Số chứng từ" Width="120" Align="Center" />\n      <Column Name="DocDate" Title="Ngày chứng từ" Width="100" Align="Center" />\n      <Column Name="CustomerCode" Title="Mã đối tượng" Width="140" />\n      <Column Name="Amount" Title="Tổng tiền phát sinh" Width="140" Align="Right" Format="#,##0" />\n    </Grid>\n  </Controls>\n  <Footer ShowTotalSummary="True" />\n</FormLayout>`,
                    draftXml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B30AccDoc" Width="1024" Height="768" Status="Draft">\n  <Header Title="Chứng từ kế toán tổng hợp (Bản nháp)" AllowMinimize="True" />\n  <Controls>\n    <Grid Name="grdDoc" Dock="Fill">\n      <Column Name="DocNo" Title="Số chứng từ" Width="120" Align="Center" />\n      <Column Name="DocDate" Title="Ngày chứng từ" Width="100" Align="Center" />\n      <Column Name="CustomerCode" Title="Mã đối tượng" Width="140" />\n      <Column Name="Amount" Title="Tổng tiền phát sinh" Width="160" Align="Right" Format="#,##0" />\n      <Column Name="Status" Title="Trạng thái nháp" Width="100" />\n    </Grid>\n  </Controls>\n</FormLayout>`
                },
                {
                    id: 2,
                    formName: 'B20Customer',
                    layoutName: 'TemplateDefault',
                    layoutType: 'FormTemplate',
                    isTemplate: 1,
                    commandKey: 'B20Customer',
                    dllName: 'Bravo.CRM.dll',
                    className: 'B20CustomerView',
                    modifiedAt: '2026-09-10 14:10',
                    modifiedBy: 'User01',
                    hasDraft: 0,
                    isDirty: false,
                    xml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B20Customer" Width="800" Height="600">\n  <Header Title="Danh mục khách hàng" />\n  <Controls>\n    <TextBox Name="txtCode" Title="Mã khách hàng" Top="10" Left="10" Width="200" Required="True" />\n    <TextBox Name="txtName" Title="Tên khách hàng" Top="40" Left="10" Width="400" Required="True" />\n    <TextBox Name="txtTaxCode" Title="Mã số thuế" Top="70" Left="10" Width="200" />\n  </Controls>\n</FormLayout>`,
                    draftXml: ''
                },
                {
                    id: 3,
                    formName: 'B50Inventory',
                    layoutName: 'LayoutStock',
                    layoutType: 'Layout',
                    isTemplate: 0,
                    commandKey: 'B50Inventory',
                    dllName: 'Bravo.Stock.dll',
                    className: 'B50StockView',
                    modifiedAt: '2026-09-09 11:30',
                    modifiedBy: 'Admin',
                    hasDraft: 1,
                    isDirty: false,
                    xml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B50Inventory" Width="1024" Height="700">\n  <Header Title="Báo cáo tồn kho vật tư" />\n  <Controls>\n    <Grid Name="grdStock" Dock="Fill">\n      <Column Name="ItemCode" Title="Mã vật tư" Width="150" />\n      <Column Name="ItemName" Title="Tên vật tư" Width="250" />\n      <Column Name="Qty" Title="Số lượng tồn kho" Width="120" Align="Right" />\n    </Grid>\n  </Controls>\n</FormLayout>`,
                    draftXml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B50Inventory" Width="1024" Height="700">\n  <Header Title="Báo cáo tồn kho vật tư (Draft Edit)" />\n  <Controls>\n    <Grid Name="grdStock" Dock="Fill">\n      <Column Name="ItemCode" Title="Mã vật tư" Width="150" />\n      <Column Name="ItemName" Title="Tên vật tư" Width="250" />\n      <Column Name="Warehouse" Title="Kho hàng" Width="120" />\n      <Column Name="Qty" Title="Số lượng tồn kho" Width="120" Align="Right" />\n    </Grid>\n  </Controls>\n</FormLayout>`
                },
                {
                    id: 4,
                    formName: 'B10Employee',
                    layoutName: 'LayoutGlobalHR',
                    layoutType: 'GlobalLayout',
                    isTemplate: 2,
                    commandKey: 'B10Employee',
                    dllName: 'Bravo.HRM.dll',
                    className: 'B10EmployeeView',
                    modifiedAt: '2026-09-08 09:15',
                    modifiedBy: 'HRAdmin',
                    hasDraft: 0,
                    isDirty: false,
                    xml: `<?xml version="1.0" encoding="utf-8"?>\n<FormLayout Name="B10Employee" Width="900" Height="650">\n  <Header Title="Hồ sơ nhân viên" />\n  <Controls>\n    <TextBox Name="txtEmpCode" Title="Mã nhân viên" Top="15" Left="15" Width="180" />\n    <TextBox Name="txtEmpName" Title="Họ và tên" Top="45" Left="15" Width="300" />\n  </Controls>\n</FormLayout>`,
                    draftXml: ''
                }
            ];

            // Cache sample XML buffers
            this._masterData.forEach(item => {
                this._xmlBuffer[item.id] = this._beautifyXML(item.xml);
                this._draftXmlBuffer[item.id] = item.draftXml ? this._beautifyXML(item.draftXml) : '';
            });
        },

        // ── Render Full Layout HTML ───────────────────────────────────────────
        _buildHTML() {
            return `
                <div class="bravo-le-container">

                    <!-- Top Connection Breadcrumbs Bar (Reusable Component Slot) -->
                    <div class="bravo-le-connbar-slot" id="bravo-le-connbar-slot"></div>

                    <!-- Top Bar Header Controls -->
                    <div class="bravo-le-topbar">
                        <div class="bravo-le-field-group">
                            <span class="bravo-le-label"><i class="fa-solid fa-desktop me-1"></i>Loại layout:</span>
                            <select id="bravo-le-platform" class="bravo-le-select">
                                <option value="Win" selected>Win App</option>
                                <option value="Mobile">Mobile App</option>
                            </select>
                        </div>

                        <div class="bravo-le-field-group">
                            <span class="bravo-le-label"><i class="fa-solid fa-code-branch me-1"></i>Phiên bản:</span>
                            <select id="bravo-le-version" class="bravo-le-select">
                                <!-- Dynamically populated by platform constraint -->
                            </select>
                        </div>

                        <div style="flex:1;"></div>

                        <!-- Search & Replace Controls -->
                        <div class="bravo-le-field-group">
                            <input type="text" id="bravo-le-search-input" class="bravo-le-input" placeholder="Nội dung tìm kiếm XML..." style="width:160px;">
                            <button id="bravo-le-btn-search" class="bravo-le-btn" title="Tìm kiếm trên RAM (Batch Search)">
                                <i class="fa-solid fa-magnifying-glass"></i> Tìm kiếm
                            </button>
                        </div>

                        <div class="bravo-le-field-group">
                            <input type="text" id="bravo-le-replace-input" class="bravo-le-input" placeholder="Nội dung thay thế..." style="width:160px;">
                            <button id="bravo-le-btn-replace" class="bravo-le-btn bravo-le-btn-primary" title="Replace Selected Form XML">
                                <i class="fa-solid fa-arrow-rotate-right"></i> Replace Selected
                            </button>
                        </div>
                    </div>

                    <!-- SQL Query Bar & Custom WHERE -->
                    <div class="bravo-le-sql-bar">
                        <span class="bravo-le-label"><i class="fa-solid fa-code me-1"></i>SQL Gốc:</span>
                        <div class="bravo-le-sql-preview" id="bravo-le-sql-preview">SELECT ...</div>
                        
                        <span class="bravo-le-label" style="font-weight:700; color:var(--ide-accent); margin-left:4px;">WHERE 1=1</span>
                        <input type="text" id="bravo-le-where-input" class="bravo-le-input" placeholder="nhập bổ sung... e.g. AND l.FormName LIKE 'B30%'" style="width:260px;">
                        <button id="bravo-le-btn-load" class="bravo-le-btn" title="Tải lại danh sách Form theo điều kiện SQL">
                            <i class="fa-solid fa-rotate me-1"></i>Tải dữ liệu
                        </button>
                    </div>

                    <!-- Main Workspace (Split Container: 30% Left / 70% Right) -->
                    <div class="bravo-le-workspace" id="bravo-le-workspace">
                        
                        <!-- Left Panel (Checklist Filter & Master Grid) -->
                        <div class="bravo-le-left" id="bravo-le-left-panel">
                            
                            <!-- Checklist Filter Block (Requirement 1: Action toolbar & Search suggestion) -->
                            <div class="bravo-le-checklist-block">
                                <div class="bravo-le-checklist-tabs" id="bravo-le-checklist-tabs">
                                    <!-- Populated dynamically -->
                                </div>
                                <div class="bravo-le-checklist-content">
                                    <div class="bravo-le-field-group mb-1">
                                        <input type="text" id="bravo-le-checklist-search" class="bravo-le-input bravo-le-checklist-search" placeholder="Lọc giá trị..." style="flex:1;">
                                        <button id="bravo-le-chk-select-all" class="bravo-le-btn" style="height:22px; font-size:10px;" title="Chọn tất cả giá trị">
                                            <i class="fa-solid fa-check-double"></i> Tất cả
                                        </button>
                                        <button id="bravo-le-chk-deselect-all" class="bravo-le-btn" style="height:22px; font-size:10px;" title="Bỏ chọn tất cả giá trị">
                                            <i class="fa-solid fa-square-minus"></i> Bỏ chọn
                                        </button>
                                    </div>
                                    <div class="bravo-le-checklist-list" id="bravo-le-checklist-list">
                                        <!-- Checklist items populated dynamically -->
                                    </div>
                                </div>
                            </div>

                            <!-- Master Data Grid Header -->
                            <div class="bravo-le-grid-header">
                                <span><i class="fa-solid fa-list-check me-1"></i>Danh sách Form Layout</span>
                                <span id="bravo-le-grid-count" style="font-weight:normal; font-size:10px;">0 forms</span>
                            </div>

                            <!-- Master Data Grid Table Container -->
                            <div class="bravo-le-grid-container">
                                <table class="bravo-le-table">
                                    <thead>
                                        <tr class="bravo-le-grid-header-row">
                                            <th style="width:28px; text-align:center;">
                                                <input type="checkbox" id="bravo-le-select-all" title="Chọn tất cả">
                                            </th>
                                            <th data-col="formName">
                                                <div class="bravo-le-th-content">
                                                    <span>FormName</span>
                                                    <i class="fa-solid fa-filter bravo-le-col-filter-icon" data-col="formName" title="Lọc cột FormName"></i>
                                                </div>
                                                <div class="bravo-le-col-filter-box" id="bravo-le-col-filter-formName" style="display:none;">
                                                    <input type="text" class="bravo-le-col-filter-input" data-col="formName" placeholder="Lọc FormName... Enter">
                                                </div>
                                            </th>
                                            <th data-col="layoutName">
                                                <div class="bravo-le-th-content">
                                                    <span>LayoutName</span>
                                                    <i class="fa-solid fa-filter bravo-le-col-filter-icon" data-col="layoutName" title="Lọc cột LayoutName"></i>
                                                </div>
                                                <div class="bravo-le-col-filter-box" id="bravo-le-col-filter-layoutName" style="display:none;">
                                                    <input type="text" class="bravo-le-col-filter-input" data-col="layoutName" placeholder="Lọc LayoutName... Enter">
                                                </div>
                                            </th>
                                            <th data-col="modifiedAt">
                                                <div class="bravo-le-th-content">
                                                    <span>ModifiedAt</span>
                                                    <i class="fa-solid fa-filter bravo-le-col-filter-icon" data-col="modifiedAt" title="Lọc cột ModifiedAt"></i>
                                                </div>
                                                <div class="bravo-le-col-filter-box" id="bravo-le-col-filter-modifiedAt" style="display:none;">
                                                    <input type="text" class="bravo-le-col-filter-input" data-col="modifiedAt" placeholder="Lọc ModifiedAt... Enter">
                                                </div>
                                            </th>
                                            <th data-col="hasDraft">
                                                <div class="bravo-le-th-content">
                                                    <span>Draft</span>
                                                    <i class="fa-solid fa-filter bravo-le-col-filter-icon" data-col="hasDraft" title="Lọc cột Draft"></i>
                                                </div>
                                                <div class="bravo-le-col-filter-box" id="bravo-le-col-filter-hasDraft" style="display:none;">
                                                    <input type="text" class="bravo-le-col-filter-input" data-col="hasDraft" placeholder="Lọc Draft... Enter">
                                                </div>
                                            </th>
                                            <th data-col="status">
                                                <div class="bravo-le-th-content">
                                                    <span>Trạng thái</span>
                                                    <i class="fa-solid fa-filter bravo-le-col-filter-icon" data-col="status" title="Lọc cột Trạng thái"></i>
                                                </div>
                                                <div class="bravo-le-col-filter-box" id="bravo-le-col-filter-status" style="display:none;">
                                                    <input type="text" class="bravo-le-col-filter-input" data-col="status" placeholder="Lọc Status... Enter">
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>

                                    <tbody id="bravo-le-grid-body">
                                        <!-- Grid rows populated dynamically -->
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Resizer Handle -->
                        <div class="bravo-le-split-resizer" id="bravo-le-split-resizer"></div>

                        <!-- Right Panel (Dedicated XML Code Editor, Tree Map & Actions) -->
                        <div class="bravo-le-right" id="bravo-le-right-panel">
                            
                            <!-- Editor Action Bar -->
                            <div class="bravo-le-editor-bar">
                                <!-- View Mode Tabs (Layout Gốc vs Layout Nháp) -->
                                <div class="bravo-le-view-tabs" id="bravo-le-view-tabs">
                                    <button class="bravo-le-vtab active" data-view="active" id="bravo-le-vtab-active">
                                        <i class="fa-solid fa-file-code"></i> Bản chính thức (LayoutData)
                                    </button>
                                    <button class="bravo-le-vtab" data-view="draft" id="bravo-le-vtab-draft" disabled>
                                        <i class="fa-solid fa-file-signature"></i> Bản nháp (LastLayoutData)
                                        <span class="bravo-le-tab-badge" id="bravo-le-draft-badge" style="display:none;">Draft</span>
                                    </button>
                                </div>

                                <div style="width:1px; height:18px; background:var(--ide-border); margin:0 4px;"></div>

                                <!-- Display Mode Group (Editor vs Tree Map vs Split) -->
                                <div class="bravo-le-mode-group">
                                    <button class="bravo-le-mode-btn active" data-mode="editor" id="bravo-le-mode-editor" title="Hiển thị Code Editor có số dòng">
                                        <i class="fa-solid fa-code"></i> Mã XML
                                    </button>
                                    <button class="bravo-le-mode-btn" data-mode="treemap" id="bravo-le-mode-treemap" title="Hiển thị Tree Map XML">
                                        <i class="fa-solid fa-sitemap"></i> Tree Map
                                    </button>
                                    <button class="bravo-le-mode-btn" data-mode="split" id="bravo-le-mode-split" title="Xem song song Code & Tree Map">
                                        <i class="fa-solid fa-columns"></i> Split
                                    </button>
                                </div>

                                <div style="flex:1;"></div>

                                <!-- Button to toggle Search Results Panel in Editor Bar -->
                                <button id="bravo-le-btn-toggle-search" class="bravo-le-btn" title="Ẩn/Hiện bảng kết quả tìm kiếm" style="display:none;">
                                    <i class="fa-solid fa-list-check me-1"></i><span>Kết quả</span>
                                    <span class="bravo-le-tab-badge" id="bravo-le-search-badge" style="display:none;">0</span>
                                </button>

                                <button id="bravo-le-btn-beautify" class="bravo-le-btn" title="Tự động format thụt lề XML">
                                    <i class="fa-solid fa-wand-magic-sparkles me-1"></i>Beautify
                                </button>
                                <button id="bravo-le-btn-expand" class="bravo-le-btn" title="Mở rộng tất cả thẻ">
                                    <i class="fa-solid fa-up-right-and-down-left-from-center me-1"></i>Expand
                                </button>
                                <button id="bravo-le-btn-collapse" class="bravo-le-btn" title="Thu gọn thẻ XML">
                                    <i class="fa-solid fa-down-left-and-up-right-to-center me-1"></i>Collapse
                                </button>
                            </div>

                            <!-- Match Navigator Bar (shown when keyword matches exist in current editor, spans 100% width) -->
                            <div class="bravo-le-match-nav" id="bravo-le-match-nav" style="display:none;">
                                <span id="bravo-le-match-nav-label">0 / 0</span>
                                <button class="bravo-le-btn bravo-le-btn-xs" id="bravo-le-match-nav-prev" title="Occurrence trước"><i class="fa-solid fa-chevron-up"></i></button>
                                <button class="bravo-le-btn bravo-le-btn-xs" id="bravo-le-match-nav-next" title="Occurrence sau"><i class="fa-solid fa-chevron-down"></i></button>
                                <span id="bravo-le-match-nav-keyword" style="font-size:10px; color:var(--ide-text-dim);"></span>
                                <button class="bravo-le-btn bravo-le-btn-xs" id="bravo-le-match-nav-clear" title="Xóa highlight"><i class="fa-solid fa-xmark"></i></button>
                            </div>

                            <!-- Dedicated Editor Workspace Area (Priority: XML Code Editor & Tree Map take full flex space) -->
                            <div class="bravo-le-editor-area" id="bravo-le-editor-area">
                                <!-- Dedicated Monaco XML Code Editor Container -->
                                <div class="bravo-le-code-wrapper" id="bravo-le-code-wrapper" style="flex:1; width:100%; height:100%; min-height:0; display:flex; position:relative; overflow:hidden;">
                                    <div id="bravo-le-monaco-container" style="flex:1; width:100%; height:100%; min-height:0; position:relative; overflow:hidden;"></div>
                                </div>

                                <!-- Tree Map XML Wrapper -->
                                <div class="bravo-le-treemap-wrapper" id="bravo-le-treemap-wrapper" style="display:none;">
                                    <div class="bravo-le-tree-container" id="bravo-le-tree-container">
                                        <!-- Interactive Tree View rendered dynamically -->
                                    </div>
                                </div>
                            </div>

                            <!-- Horizontal Resizer Handle between XML Editor and Bottom Search Results Panel -->
                            <div class="bravo-le-bottom-resizer" id="bravo-le-bottom-resizer" style="display:none;" title="Kéo lên/xuống để thay đổi độ cao bảng kết quả">
                                <div class="bravo-le-bottom-resizer-line"></div>
                                <button class="bravo-le-resizer-toggle-btn" id="bravo-le-resizer-toggle-btn" title="Ẩn/Hiện bảng kết quả tìm kiếm">
                                    <i class="fa-solid fa-chevron-down" id="bravo-le-resizer-toggle-icon"></i>
                                </button>
                                <div class="bravo-le-bottom-resizer-line"></div>
                            </div>

                            <!-- Bottom Search Result Panel (Underneath XML Editor, 100% width) -->
                            <div class="bravo-le-search-result-panel" id="bravo-le-search-result-panel" style="display:none;">
                                <div class="bravo-le-srp-header" id="bravo-le-srp-header" title="Click để Thu gọn/Mở rộng">
                                    <span class="bravo-le-srp-title" id="bravo-le-srp-title">
                                        <i class="fa-solid fa-magnifying-glass me-1"></i>
                                        <span id="bravo-le-srp-summary">Kết quả tìm kiếm</span>
                                    </span>
                                    <span class="bravo-le-srp-actions">
                                        <button id="bravo-le-srp-btn-backend" class="bravo-le-btn bravo-le-btn-xs" style="display:none;" title="Tìm toàn bộ trên Backend">
                                            <i class="fa-solid fa-server me-1"></i>Tìm toàn bộ
                                        </button>
                                        <span id="bravo-le-srp-progress" style="font-size:10px; color:var(--ide-text-dim); display:none;"></span>
                                        <button id="bravo-le-srp-btn-toggle" class="bravo-le-btn bravo-le-btn-xs" title="Thu gọn/Mở rộng">
                                            <i class="fa-solid fa-chevron-down" id="bravo-le-srp-chevron"></i>
                                        </button>
                                        <button id="bravo-le-srp-btn-close" class="bravo-le-btn bravo-le-btn-xs" title="Đóng bảng kết quả">
                                            <i class="fa-solid fa-xmark"></i>
                                        </button>
                                    </span>
                                </div>
                                <div class="bravo-le-srp-body" id="bravo-le-srp-body">
                                    <!-- Result list populated dynamically -->
                                </div>
                            </div>
                        </div>

                    </div>

                    <!-- Bottom Commit Footer Bar -->
                    <div class="bravo-le-footer">
                        <div class="bravo-le-stats" id="bravo-le-footer-stats">
                            Tổng số: <strong>0</strong> forms | Đã chọn: <strong>0</strong> forms | Đang sửa đổi (Dirty): <strong style="color:var(--ide-warning, #e3b341);">0</strong> form
                        </div>
                        <button id="bravo-le-btn-commit" class="bravo-le-btn bravo-le-btn-danger" style="padding: 4px 16px; font-weight:700;">
                            <i class="fa-solid fa-database me-1"></i>LƯU TẤT CẢ (COMMIT DATABASE)
                        </button>
                    </div>

                </div>
            `;
        },

        // ── Wire Component Events & Controls ──────────────────────────────────
        _wireEvents() {
            const el = this._container;

            // Platform Change Constraint
            const platformSel = el.querySelector('#bravo-le-platform');
            if (platformSel) {
                platformSel.addEventListener('change', (e) => {
                    this._platform = e.target.value;
                    this._updateVersionOptions();
                    this._updateSqlPreview();
                    this._renderChecklistTabs();
                    this._onReloadGrid();
                });
            }

            // Version Change Constraint
            const versionSel = el.querySelector('#bravo-le-version');
            if (versionSel) {
                versionSel.addEventListener('change', (e) => {
                    this._version = e.target.value;
                    this._updateSqlPreview();
                    this._renderChecklistTabs();
                    this._onReloadGrid();
                });
            }

            // Custom WHERE Clause Button & Input
            const btnLoad = el.querySelector('#bravo-le-btn-load');
            const whereInput = el.querySelector('#bravo-le-where-input');
            if (btnLoad) {
                btnLoad.addEventListener('click', () => {
                    this._customWhere = whereInput ? whereInput.value : '';
                    this._onReloadGrid();
                });
            }
            if (whereInput) {
                whereInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this._customWhere = whereInput.value;
                        this._onReloadGrid();
                    }
                });
            }

            // Requirement 1: Checklist Search Filter & Action Buttons
            const chkSearch = el.querySelector('#bravo-le-checklist-search');
            const btnSelectAllChk = el.querySelector('#bravo-le-chk-select-all');
            const btnDeselectAllChk = el.querySelector('#bravo-le-chk-deselect-all');

            if (chkSearch) {
                // When focus on search box: default to uncheck all items so user can easily filter
                chkSearch.addEventListener('focus', () => {
                    this._checkedChecklistValues = new Set();
                    this._renderChecklistItems(chkSearch.value.trim());
                    this._renderGrid();
                });
                // Live suggestion filter as user types text
                chkSearch.addEventListener('input', (e) => {
                    this._renderChecklistItems(e.target.value.trim());
                });
            }

            if (btnSelectAllChk) {
                btnSelectAllChk.addEventListener('click', () => {
                    this._selectAllChecklist();
                });
            }
            if (btnDeselectAllChk) {
                btnDeselectAllChk.addEventListener('click', () => {
                    this._deselectAllChecklist();
                });
            }


            // Hybrid XML Search Button (Specification 4.2)
            const btnSearch = el.querySelector('#bravo-le-btn-search');
            const searchInput = el.querySelector('#bravo-le-search-input');
            if (btnSearch) {
                btnSearch.addEventListener('click', () => {
                    const query = (searchInput ? searchInput.value.trim() : '');
                    if (!query) {
                        this._clearSearch();
                        return;
                    }
                    this._onSearchRAM(query);
                });
            }
            if (searchInput) {
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const query = searchInput.value.trim();
                        if (query) this._onSearchRAM(query);
                        else this._clearSearch();
                    }
                    if (e.key === 'Escape') this._clearSearch();
                });
            }

            // Search Result Panel: Backend Button
            const btnBackend = el.querySelector('#bravo-le-srp-btn-backend');
            if (btnBackend) {
                btnBackend.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this._searchQuery) this._onSearchBackend(this._searchQuery);
                });
            }

            // Search Result Panel: Close Button (Hides panel, keeps results accessible via toolbar)
            const btnSrpClose = el.querySelector('#bravo-le-srp-btn-close');
            if (btnSrpClose) {
                btnSrpClose.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const panel = el.querySelector('#bravo-le-search-result-panel');
                    const resizer = el.querySelector('#bravo-le-bottom-resizer');
                    const btnToolbar = el.querySelector('#bravo-le-btn-toggle-search');
                    if (panel) panel.style.display = 'none';
                    if (resizer) resizer.style.display = 'none';
                    if (btnToolbar) btnToolbar.classList.remove('active');
                });
            }

            // Search Result Panel: Collapse/Expand Toggle Button on Header
            const btnSrpToggle = el.querySelector('#bravo-le-srp-btn-toggle');
            if (btnSrpToggle) {
                btnSrpToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._setSearchPanelCollapsed(!this._searchResultCollapsed);
                });
            }

            // Embedded Toggle Button directly in the Resizer Bar
            const btnResizerToggle = el.querySelector('#bravo-le-resizer-toggle-btn');
            if (btnResizerToggle) {
                btnResizerToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._setSearchPanelCollapsed(!this._searchResultCollapsed);
                });
            }

            // Header Bar Click to Toggle Collapse/Expand
            const srpHeader = el.querySelector('#bravo-le-srp-header');
            if (srpHeader) {
                srpHeader.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    this._setSearchPanelCollapsed(!this._searchResultCollapsed);
                });
            }

            // Editor Bar: Toggle Search Panel Button
            const btnToggleSearch = el.querySelector('#bravo-le-btn-toggle-search');
            if (btnToggleSearch) {
                btnToggleSearch.addEventListener('click', () => {
                    this._toggleSearchPanel();
                });
            }

            // Match Navigator Buttons
            const btnNavPrev = el.querySelector('#bravo-le-match-nav-prev');
            const btnNavNext = el.querySelector('#bravo-le-match-nav-next');
            const btnNavClear = el.querySelector('#bravo-le-match-nav-clear');
            if (btnNavPrev) btnNavPrev.addEventListener('click', () => this._navigateMatch(-1));
            if (btnNavNext) btnNavNext.addEventListener('click', () => this._navigateMatch(1));
            if (btnNavClear) btnNavClear.addEventListener('click', () => this._clearSearchHighlight());

            // Replace Selected Button
            const btnReplace = el.querySelector('#bravo-le-btn-replace');
            const replaceInput = el.querySelector('#bravo-le-replace-input');
            if (btnReplace) {
                btnReplace.addEventListener('click', () => {
                    const searchVal = searchInput ? searchInput.value : '';
                    const replaceVal = replaceInput ? replaceInput.value : '';
                    if (!searchVal) {
                        alert('Vui lòng nhập nội dung tìm kiếm cần thay thế!');
                        return;
                    }
                    if (this._selectedFormIds.size === 0) {
                        alert('Vui lòng chọn (tick) ít nhất một FormName ở danh sách bên trái để Replace!');
                        return;
                    }

                    let count = 0;
                    this._selectedFormIds.forEach(id => {
                        const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                        const original = buffer[id] || '';
                        if (original.includes(searchVal)) {
                            buffer[id] = original.split(searchVal).join(replaceVal);
                            this._dirtyFormIds.add(id);
                            count++;
                        }
                    });

                    if (this._activeForm && this._selectedFormIds.has(this._activeForm.id)) {
                        this._loadFormXmlIntoEditor(this._activeForm);
                    }

                    this._renderGrid();
                    this._updateStats();
                    alert(`Đã Replace thành công trên ${count} form! Các form đã được đánh dấu Dirty.`);
                });
            }

            // View Mode Tabs (Bản chính thức vs Bản nháp)
            const viewTabs = el.querySelectorAll('.bravo-le-vtab');
            viewTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const mode = tab.dataset.view;
                    if (tab.disabled || this._viewMode === mode) return;

                    viewTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    this._viewMode = mode;

                    if (this._activeForm) {
                        this._loadFormXmlIntoEditor(this._activeForm);
                    }
                });
            });

            // Display Mode Toggles (Editor vs Tree Map vs Split)
            const modeBtns = el.querySelectorAll('.bravo-le-mode-btn');
            modeBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.mode;
                    modeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this._displayMode = mode;
                    this._updateDisplayMode();
                });
            });

            // Expand All & Collapse All Toolbar Buttons
            const btnExpand = el.querySelector('#bravo-le-btn-expand');
            if (btnExpand) {
                btnExpand.addEventListener('click', () => {
                    if (this._xmlMonaco) {
                        this._xmlMonaco.unfoldAll();
                    } else {
                        this._foldedLines.clear();
                        this._refreshCodeViewerAndTreeMap();
                    }
                });
            }

            const btnCollapse = el.querySelector('#bravo-le-btn-collapse');
            if (btnCollapse) {
                btnCollapse.addEventListener('click', () => {
                    if (this._xmlMonaco) {
                        this._xmlMonaco.foldAll();
                    } else {
                        const rawXml = this._getEditorXml();
                        const lines = rawXml.split('\n');
                        lines.forEach((line, i) => {
                            const trimmed = line.trim();
                            if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.startsWith('<!--') && !trimmed.endsWith('/>')) {
                                this._foldedLines.add(i);
                            }
                        });
                        this._refreshCodeViewerAndTreeMap();
                    }
                });
            }

            // XML Beautify Button (Integrates with Monaco Formatting Provider)
            const btnBeautify = el.querySelector('#bravo-le-btn-beautify');
            if (btnBeautify) {
                btnBeautify.addEventListener('click', () => {
                    if (this._xmlMonaco) {
                        this._xmlMonaco.formatDocument();
                        const beautified = this._xmlMonaco.getValue();
                        if (this._activeForm) {
                            const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                            buffer[this._activeForm.id] = beautified;
                            this._dirtyFormIds.add(this._activeForm.id);
                            this._renderGrid();
                            this._updateStats();
                            if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                                this._refreshTreeMap(beautified);
                            }
                        }
                    } else {
                        const currentXml = this._getEditorXml();
                        if (!currentXml) return;
                        const beautified = this._beautifyXML(currentXml);
                        this._setEditorXml(beautified);
                        if (this._activeForm) {
                            const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                            buffer[this._activeForm.id] = beautified;
                            this._dirtyFormIds.add(this._activeForm.id);
                            this._renderGrid();
                            this._updateStats();
                            this._refreshCodeViewerAndTreeMap();
                        }
                    }
                });
            }

            // Requirement 1: Column Filter Icon Toggle & Input Event Handling
            const colFilterIcons = el.querySelectorAll('.bravo-le-col-filter-icon');
            colFilterIcons.forEach(icon => {
                icon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const col = icon.dataset.col;
                    const filterBox = el.querySelector(`#bravo-le-col-filter-${col}`);
                    if (!filterBox) return;

                    const isVisible = filterBox.style.display !== 'none';
                    filterBox.style.display = isVisible ? 'none' : 'block';

                    if (!isVisible) {
                        const input = filterBox.querySelector('.bravo-le-col-filter-input');
                        if (input) input.focus();
                    }
                });
            });

            const colFilterInputs = el.querySelectorAll('.bravo-le-col-filter-input');
            colFilterInputs.forEach(input => {
                const applyFilter = () => {
                    const col = input.dataset.col;
                    const val = input.value.trim();
                    if (val) {
                        this._columnFilters[col] = val;
                    } else {
                        delete this._columnFilters[col];
                    }

                    const icon = el.querySelector(`.bravo-le-col-filter-icon[data-col="${col}"]`);
                    if (icon) {
                        if (val) icon.classList.add('active');
                        else icon.classList.remove('active');
                    }

                    this._renderGrid();
                };

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        applyFilter();
                    }
                });

                input.addEventListener('blur', () => {
                    applyFilter();
                });
            });




            // Select All Checkbox (acts on currently filtered rows)
            const selectAll = el.querySelector('#bravo-le-select-all');
            if (selectAll) {
                selectAll.addEventListener('change', (e) => {
                    const targetList = (this._lastFilteredData && this._lastFilteredData.length > 0) ? this._lastFilteredData : this._masterData;
                    if (e.target.checked) {
                        targetList.forEach(d => this._selectedFormIds.add(d.id));
                    } else {
                        targetList.forEach(d => this._selectedFormIds.delete(d.id));
                    }
                    this._renderGrid();
                    this._updateStats();
                });
            }

            // Commit Database Button
            const btnCommit = el.querySelector('#bravo-le-btn-commit');
            if (btnCommit) {
                btnCommit.addEventListener('click', () => {
                    this._onCommitDatabase();
                });
            }

            // Wire Resizer Dragging
            this._initSplitResizer();
            this._initBottomResizer();
        },

        // ── Helper: Select All / Deselect All Checklist Items ────────────────
        _selectAllChecklist() {
            let allValues = [];
            if (this._activeTab === 'CommandKey') {
                allValues = [...new Set(this._masterData.map(d => d.commandKey))].filter(Boolean);
            } else if (this._activeTab === 'DllName') {
                allValues = [...new Set(this._masterData.map(d => d.dllName))].filter(Boolean);
            } else if (this._activeTab === 'ClassName') {
                allValues = [...new Set(this._masterData.map(d => d.className))].filter(Boolean);
            } else if (this._activeTab === 'Loại layout') {
                allValues = ['Layout', 'FormTemplate', 'GlobalLayout', 'Datasource', 'SubLayout'];
            }
            this._checkedChecklistValues = new Set(allValues);
            const searchEl = this._container ? this._container.querySelector('#bravo-le-checklist-search') : null;
            this._renderChecklistItems(searchEl ? searchEl.value.trim() : '');
            this._renderGrid();
        },

        _deselectAllChecklist() {
            this._checkedChecklistValues = new Set();
            const searchEl = this._container ? this._container.querySelector('#bravo-le-checklist-search') : null;
            this._renderChecklistItems(searchEl ? searchEl.value.trim() : '');
            this._renderGrid();
        },

        // ── Reload Grid (Backend API vs Demo Data) ───────────────────────────
        _onReloadGrid() {
            this._checkedChecklistValues = null;
            if (this._context && this._context.connectionId) {
                this._loadGridFromBackend();
            } else {
                this._renderGrid();
            }
        },


        // ── Backend API Integration ──────────────────────────────────────────
        async _loadGridFromBackend() {
            this._context?.setStatus('Đang tải danh sách Layout từ Server...', 'running');
            try {
                const res = await fetch('/api/bravo/layout-editor/list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        connection_id: this._context.connectionId,
                        database: this._context.database,
                        platform: this._platform,
                        version: this._version,
                        custom_where: this._customWhere
                    })
                });
                const data = await res.json();
                if (data.success && Array.isArray(data.items)) {
                    this._masterData = data.items;
                    this._renderGrid();
                    this._updateStats();
                    this._context?.setStatus(`Đã tải ${this._masterData.length} layout từ CSDL.`, 'idle');

                    if (this._masterData.length > 0) {
                        this._activeForm = this._masterData[0];
                        this._loadFormXmlIntoEditor(this._activeForm);
                    }
                } else {
                    this._context?.setStatus(`Lỗi tải dữ liệu: ${data.error || 'Unknown error'}`, 'error');
                }
            } catch (err) {
                this._context?.setStatus('Lỗi kết nối Backend server.', 'error');
            }
        },

        async _loadPayloadFromBackend(formItem) {
            this._context?.setStatus(`Đang tải XML: ${formItem.formName}...`, 'running');
            try {
                const res = await fetch('/api/bravo/layout-editor/payload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        connection_id: this._context.connectionId,
                        database: this._context.database,
                        platform: this._platform,
                        version: this._version,
                        id: formItem.id
                    })
                });
                const data = await res.json();
                if (data.success) {
                    // Requirement 2: Automatically beautify/format XML payload into indented tree structure
                    const rawXml = data.xml || '';
                    const rawDraft = data.draft_xml || '';
                    const beautifiedXml = this._beautifyXML(rawXml);
                    const beautifiedDraft = rawDraft ? this._beautifyXML(rawDraft) : '';

                    this._xmlBuffer[formItem.id] = beautifiedXml;
                    this._draftXmlBuffer[formItem.id] = beautifiedDraft;
                    formItem.hasDraft = Boolean(data.draft_xml);

                    const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                    const loadedXml = buffer[formItem.id] || '';
                    this._setEditorXml(loadedXml);

                    if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                        this._refreshTreeMap(loadedXml);
                    }
                    this._context?.setStatus(`Đã nạp XML: ${formItem.formName}`, 'idle');
                }
            } catch (err) {
                this._context?.setStatus('Lỗi tải mã XML từ CSDL.', 'error');
            }
        },

        _escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },

        _onCommitDatabase() {
            if (this._dirtyFormIds.size === 0) {
                alert('Không có form/layout nào có thay đổi để lưu vào cơ sở dữ liệu!');
                return;
            }
            this._showCommitConfirmationModal();
        },

        _generateCommitSqlScript(dirtyItems) {
            if (!dirtyItems || dirtyItems.length === 0) {
                return `-- (Chưa có layout nào được tick chọn để cập nhật)`;
            }

            const connName = this._context?.connectionName || 'Active Connection';
            const dbName = this._context?.database || 'Active Database';
            const platform = this._platform || 'Win';
            const version = this._version || 'Bravo 10';
            const nowStr = new Date().toLocaleString();

            let sql = `-- ==========================================================================\n`;
            sql += `-- BRAVO ATOMIC TRANSACTION COMMIT SCRIPT\n`;
            sql += `-- Target Connection : ${connName}\n`;
            sql += `-- Target Database   : ${dbName}\n`;
            sql += `-- Platform / Version : ${platform} (${version})\n`;
            sql += `-- Selected Items    : ${dirtyItems.length} layout(s)\n`;
            sql += `-- Generated At       : ${nowStr}\n`;
            sql += `-- ==========================================================================\n\n`;
            sql += `BEGIN TRANSACTION;\n\n`;

            const isPostgres = (this._context?.dbType || '').toLowerCase().includes('postgre');
            const timeFn = isPostgres ? 'CURRENT_TIMESTAMP' : 'GETDATE()';

            dirtyItems.forEach((d, idx) => {
                const xml = this._xmlBuffer[d.id] || '';
                const hasDraft = d.hasDraft && (this._draftXmlBuffer[d.id] !== undefined);
                const draftXml = hasDraft ? (this._draftXmlBuffer[d.id] || '') : '';
                const len = xml.length;

                sql += `-- [${idx + 1}/${dirtyItems.length}] Form: ${d.formName} | Layout: ${d.layoutName || 'Layout'} | ID: ${d.id}\n`;
                if (platform === 'Win') {
                    const tblData = isPostgres ? 'b00layoutdata' : 'B00LayoutData';
                    const tblMain = isPostgres ? 'b00layout' : 'B00Layout';
                    let setClause = isPostgres
                        ? `LayoutData = decode('<ZIP Hex: ${len} chars XML>', 'hex')`
                        : `LayoutData = 0x504B0304... <ZIP Binary: ${len} chars XML>`;
                    if (hasDraft) {
                        setClause += isPostgres
                            ? `,\n      LastLayoutData = decode('<Draft ZIP Hex: ${draftXml.length} chars XML>', 'hex')`
                            : `,\n      LastLayoutData = 0x504B0304... <Draft ZIP Binary: ${draftXml.length} chars XML>`;
                    }
                    sql += `UPDATE ${tblData}\n  SET ${setClause}\n  WHERE Id = ${d.id};\n`;
                    sql += `UPDATE ${tblMain}\n  SET ModifiedAt = ${timeFn}\n  WHERE Id = ${d.id};\n\n`;
                } else {
                    if (version === 'Bravo 8') {
                        const tblSb = isPostgres ? 'b00storyboard' : 'B00StoryBoard';
                        sql += `UPDATE ${tblSb}\n  SET LayoutXml = <Compressed XML: ${len} chars>,\n      ModifiedAt = ${timeFn}\n  WHERE Id = ${d.id};\n\n`;
                    } else {
                        const tblData = isPostgres ? 'b09layoutdata' : 'B09LayoutData';
                        const tblMain = isPostgres ? 'b09layout' : 'B09Layout';
                        let setClause = isPostgres
                            ? `LayoutData = decode('<ZIP Hex: ${len} chars XML>', 'hex')`
                            : `LayoutData = 0x504B0304... <ZIP Binary: ${len} chars XML>`;
                        if (hasDraft) {
                            setClause += isPostgres
                                ? `,\n      LastLayoutData = decode('<Draft ZIP Hex: ${draftXml.length} chars XML>', 'hex')`
                                : `,\n      LastLayoutData = 0x504B0304... <Draft ZIP Binary: ${draftXml.length} chars XML>`;
                        }
                        sql += `UPDATE ${tblData}\n  SET ${setClause}\n  WHERE Id = ${d.id};\n`;
                        sql += `UPDATE ${tblMain}\n  SET ModifiedAt = ${timeFn}\n  WHERE Id = ${d.id};\n\n`;
                    }
                }
            });

            sql += `COMMIT TRANSACTION;\n`;
            return sql;
        },

        _showCommitConfirmationModal() {
            // Remove any existing modal if present
            const oldModal = document.getElementById('bravo-le-commit-overlay');
            if (oldModal) oldModal.remove();

            const dirtyItems = this._masterData.filter(d => this._dirtyFormIds.has(d.id));
            if (dirtyItems.length === 0) {
                alert('Không có form/layout nào có thay đổi để lưu vào cơ sở dữ liệu!');
                return;
            }

            // Set of selected layout IDs for commit (all checked by default)
            const selectedCommitIds = new Set(dirtyItems.map(d => d.id));

            const connName = this._context?.connectionName || 'Active Connection';
            const connId = this._context?.connectionId || 'N/A';
            const dbName = this._context?.database || 'Active Database';
            const platform = this._platform || 'Win';
            const version = this._version || 'Bravo 10';
            let currentSqlScript = this._generateCommitSqlScript(dirtyItems);

            const overlay = document.createElement('div');
            overlay.className = 'bravo-le-modal-overlay';
            overlay.id = 'bravo-le-commit-overlay';

            const tableRowsHtml = dirtyItems.map((d, index) => {
                const xml = this._xmlBuffer[d.id] || '';
                const sizeKb = (xml.length / 1024).toFixed(1);
                const hasDraft = d.hasDraft && (this._draftXmlBuffer[d.id] !== undefined);
                const statusBadge = hasDraft
                    ? `<span style="display:inline-block; padding:2px 8px; border-radius:3px; font-size:10px; background:rgba(227,179,65,0.18); color:#e3b341; border:1px solid rgba(227,179,65,0.4);"><i class="fa-solid fa-file-pen me-1"></i>Bản nháp & Chính thức</span>`
                    : `<span style="display:inline-block; padding:2px 8px; border-radius:3px; font-size:10px; background:rgba(88,166,255,0.18); color:#58a6ff; border:1px solid rgba(88,166,255,0.4);"><i class="fa-solid fa-check me-1"></i>Bản chính thức</span>`;

                return `
                    <tr class="bravo-le-modal-row" data-id="${d.id}" style="cursor:pointer;">
                        <td style="text-align:center; width:36px;" onclick="event.stopPropagation();">
                            <input type="checkbox" class="bravo-le-modal-chk-item" value="${d.id}" checked style="cursor:pointer;">
                        </td>
                        <td style="text-align:center; color:var(--ide-text-dim); width:36px;">${index + 1}</td>
                        <td style="font-family:monospace; color:var(--ide-accent); font-weight:600; width:55px;">${d.id}</td>
                        <td style="font-weight:600; color:var(--ide-text-main);">${this._escapeHtml(d.formName || '')}</td>
                        <td>${this._escapeHtml(d.layoutName || 'Layout')}</td>
                        <td style="color:var(--ide-text-muted); font-size:11px;">${xml.length.toLocaleString()} ký tự (~${sizeKb} KB)</td>
                        <td>${statusBadge}</td>
                    </tr>
                `;
            }).join('');

            overlay.innerHTML = `
                <div class="bravo-le-commit-modal" role="dialog" aria-modal="true" aria-labelledby="bravo-le-commit-title">
                    <div class="bravo-le-modal-header">
                        <div class="bravo-le-modal-title" id="bravo-le-commit-title">
                            <i class="fa-solid fa-cloud-arrow-up me-2" style="color:var(--ide-accent); font-size:15px;"></i>
                            <span>XÁC NHẬN CẬP NHẬT DATABASE (COMMIT LAYOUT)</span>
                        </div>
                        <button class="bravo-le-modal-close-btn" id="bravo-le-commit-btn-close" title="Đóng (ESC)">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="bravo-le-modal-body">
                        <!-- Target Connection & Database Grid -->
                        <div class="bravo-le-modal-target-grid">
                            <div class="bravo-le-target-card">
                                <div class="bravo-le-target-label"><i class="fa-solid fa-server me-1"></i>Connection</div>
                                <div class="bravo-le-target-value" title="${this._escapeHtml(connName)} (${this._escapeHtml(connId)})">
                                    ${this._escapeHtml(connName)}
                                </div>
                            </div>
                            <div class="bravo-le-target-card">
                                <div class="bravo-le-target-label"><i class="fa-solid fa-database me-1"></i>Database Đích</div>
                                <div class="bravo-le-target-value" style="color:var(--ide-accent);" title="${this._escapeHtml(dbName)}">
                                    ${this._escapeHtml(dbName)}
                                </div>
                            </div>
                            <div class="bravo-le-target-card">
                                <div class="bravo-le-target-label"><i class="fa-solid fa-cubes me-1"></i>Nền tảng & Phiên bản</div>
                                <div class="bravo-le-target-value">
                                    ${this._escapeHtml(platform)} • ${this._escapeHtml(version)}
                                </div>
                            </div>
                            <div class="bravo-le-target-card">
                                <div class="bravo-le-target-label"><i class="fa-solid fa-file-code me-1"></i>Layout đã chọn</div>
                                <div class="bravo-le-target-value" id="bravo-le-modal-card-count" style="color:var(--ide-warning, #e3b341);">
                                    ${dirtyItems.length} / ${dirtyItems.length} layout
                                </div>
                            </div>
                        </div>

                        <!-- Layout Items List -->
                        <div class="bravo-le-modal-section">
                            <div class="d-flex align-items-center justify-content-between">
                                <span class="bravo-le-modal-section-title" id="bravo-le-modal-sec-title">
                                    <i class="fa-solid fa-list-check me-1" style="color:var(--ide-accent);"></i>
                                    DANH SÁCH LAYOUT SẼ CẬP NHẬT (${dirtyItems.length} / ${dirtyItems.length})
                                </span>
                                <span style="font-size:10px; color:var(--ide-text-dim);">
                                    Tick chọn các layout bạn muốn ghi đè vào CSDL
                                </span>
                            </div>
                            <div class="bravo-le-modal-table-wrap">
                                <table class="bravo-le-modal-table">
                                    <thead>
                                        <tr>
                                            <th style="width:36px; text-align:center;">
                                                <input type="checkbox" id="bravo-le-modal-chk-all" checked title="Chọn tất cả / Bỏ chọn tất cả" style="cursor:pointer;">
                                            </th>
                                            <th style="width:36px; text-align:center;">#</th>
                                            <th style="width:55px;">ID</th>
                                            <th>FormName</th>
                                            <th>Tên Layout</th>
                                            <th style="width:140px;">Dung lượng XML</th>
                                            <th style="width:160px;">Phiên bản lưu</th>
                                        </tr>
                                    </thead>
                                    <tbody id="bravo-le-modal-tbody">
                                        ${tableRowsHtml}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Generated SQL Script Preview -->
                        <div class="bravo-le-modal-section">
                            <div class="d-flex align-items-center justify-content-between">
                                <span class="bravo-le-modal-section-title">
                                    <i class="fa-solid fa-code me-1" style="color:var(--ide-accent);"></i>
                                    CÂU LỆNH UPDATE SQL SẼ THỰC THI (ATOMIC TRANSACTION)
                                </span>
                                <button class="bravo-le-btn" id="bravo-le-commit-btn-copy-sql" style="height:22px; font-size:10.5px;" title="Sao chép toàn bộ câu lệnh SQL">
                                    <i class="fa-solid fa-copy me-1"></i><span>Sao chép SQL</span>
                                </button>
                            </div>
                            <div class="bravo-le-modal-sql-container">
                                <pre class="bravo-le-modal-sql-code" id="bravo-le-commit-sql-code">${this._escapeHtml(currentSqlScript)}</pre>
                            </div>
                        </div>

                        <!-- Caution Alert -->
                        <div class="bravo-le-modal-alert">
                            <i class="fa-solid fa-triangle-exclamation" style="color:var(--ide-warning, #e3b341); font-size:16px; flex-shrink:0;"></i>
                            <div>
                                <strong>Lưu ý an toàn:</strong> Thao tác này sẽ ghi đè trực tiếp dữ liệu layout vào CSDL <strong>${this._escapeHtml(dbName)}</strong>. 
                                Các câu lệnh được bọc trong <code>TRANSACTION</code> nguyên tử — nếu có bất kỳ lỗi nào, toàn bộ giao dịch sẽ tự động Rollback để đảm bảo an toàn.
                            </div>
                        </div>

                        <!-- Result Notification Box -->
                        <div id="bravo-le-commit-result-alert" style="display:none; padding:8px 12px; border-radius:4px; font-size:11.5px; margin-top:2px;"></div>
                    </div>

                    <div class="bravo-le-modal-footer">
                        <div class="bravo-le-modal-status" id="bravo-le-commit-status">
                            <i class="fa-solid fa-circle-info me-1"></i>Sẵn sàng commit ${dirtyItems.length} layout vào Database...
                        </div>
                        <div class="bravo-le-modal-actions">
                            <button class="bravo-le-btn" id="bravo-le-commit-modal-btn-cancel">
                                <i class="fa-solid fa-xmark me-1"></i>Hủy bỏ
                            </button>
                            <button class="bravo-le-btn bravo-le-btn-primary" id="bravo-le-commit-modal-btn-confirm" style="background:var(--ide-accent); color:#ffffff; font-weight:600;">
                                <i class="fa-solid fa-check me-1"></i>Xác nhận cập nhật (${dirtyItems.length} layout)
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Elements references
            const chkAll = overlay.querySelector('#bravo-le-modal-chk-all');
            const itemCheckboxes = overlay.querySelectorAll('.bravo-le-modal-chk-item');
            const cardCountEl = overlay.querySelector('#bravo-le-modal-card-count');
            const secTitleEl = overlay.querySelector('#bravo-le-modal-sec-title');
            const sqlCodeEl = overlay.querySelector('#bravo-le-commit-sql-code');
            const btnConfirm = overlay.querySelector('#bravo-le-commit-modal-btn-confirm');
            const statusEl = overlay.querySelector('#bravo-le-commit-status');

            // Sync function when checkboxes change
            const syncModalSelection = () => {
                const total = dirtyItems.length;
                const count = selectedCommitIds.size;

                // Sync Target Card Count
                if (cardCountEl) {
                    cardCountEl.textContent = `${count} / ${total} layout`;
                }

                // Sync Section Title
                if (secTitleEl) {
                    secTitleEl.innerHTML = `<i class="fa-solid fa-list-check me-1" style="color:var(--ide-accent);"></i>DANH SÁCH LAYOUT SẼ CẬP NHẬT (${count} / ${total})`;
                }

                // Sync SQL Preview
                const activeItems = dirtyItems.filter(d => selectedCommitIds.has(d.id));
                currentSqlScript = this._generateCommitSqlScript(activeItems);
                if (sqlCodeEl) {
                    sqlCodeEl.textContent = currentSqlScript;
                }

                // Sync Select All checkbox
                if (chkAll) {
                    chkAll.checked = count === total && total > 0;
                    chkAll.indeterminate = count > 0 && count < total;
                }

                // Sync Confirm Button
                if (btnConfirm) {
                    if (count === 0) {
                        btnConfirm.disabled = true;
                        btnConfirm.style.opacity = '0.5';
                        btnConfirm.style.cursor = 'not-allowed';
                        btnConfirm.innerHTML = `<i class="fa-solid fa-ban me-1"></i>Chưa chọn layout nào`;
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color:var(--ide-warning, #e3b341);"><i class="fa-solid fa-triangle-exclamation me-1"></i>Vui lòng tick chọn ít nhất 1 layout để cập nhật.</span>`;
                        }
                    } else {
                        btnConfirm.disabled = false;
                        btnConfirm.style.opacity = '1';
                        btnConfirm.style.cursor = 'pointer';
                        btnConfirm.innerHTML = `<i class="fa-solid fa-check me-1"></i>Xác nhận cập nhật (${count} layout)`;
                        if (statusEl) {
                            statusEl.innerHTML = `<i class="fa-solid fa-circle-info me-1"></i>Sẵn sàng commit ${count} layout vào Database...`;
                        }
                    }
                }
            };

            // Wire Select All Checkbox
            if (chkAll) {
                chkAll.addEventListener('change', (e) => {
                    const isChecked = e.target.checked;
                    if (isChecked) {
                        dirtyItems.forEach(d => selectedCommitIds.add(d.id));
                    } else {
                        selectedCommitIds.clear();
                    }
                    itemCheckboxes.forEach(chk => {
                        chk.checked = isChecked;
                    });
                    syncModalSelection();
                });
            }

            // Wire Individual Item Checkboxes
            itemCheckboxes.forEach(chk => {
                chk.addEventListener('change', () => {
                    const fId = parseInt(chk.value, 10);
                    if (chk.checked) {
                        selectedCommitIds.add(fId);
                    } else {
                        selectedCommitIds.delete(fId);
                    }
                    syncModalSelection();
                });
            });

            // Wire Row Click to Toggle Checkbox
            overlay.querySelectorAll('.bravo-le-modal-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input[type="checkbox"]')) return;
                    const chk = row.querySelector('.bravo-le-modal-chk-item');
                    if (chk) {
                        chk.checked = !chk.checked;
                        const fId = parseInt(chk.value, 10);
                        if (chk.checked) selectedCommitIds.add(fId);
                        else selectedCommitIds.delete(fId);
                        syncModalSelection();
                    }
                });
            });

            // Wire Close & Cancel Events
            const closeModal = () => {
                document.removeEventListener('keydown', onKeyDown);
                overlay.remove();
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') closeModal();
            };
            document.addEventListener('keydown', onKeyDown);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeModal();
            });

            const btnClose = overlay.querySelector('#bravo-le-commit-btn-close');
            if (btnClose) btnClose.addEventListener('click', closeModal);

            const btnCancel = overlay.querySelector('#bravo-le-commit-modal-btn-cancel');
            if (btnCancel) btnCancel.addEventListener('click', closeModal);

            // Wire Copy SQL
            const btnCopy = overlay.querySelector('#bravo-le-commit-btn-copy-sql');
            if (btnCopy) {
                btnCopy.addEventListener('click', async () => {
                    try {
                        if (window.copyToClipboard) {
                            await window.copyToClipboard(currentSqlScript);
                        } else {
                            await navigator.clipboard.writeText(currentSqlScript);
                        }
                        const labelSpan = btnCopy.querySelector('span');
                        const oldText = labelSpan ? labelSpan.textContent : 'Sao chép SQL';
                        if (labelSpan) labelSpan.textContent = '✓ Đã sao chép!';
                        btnCopy.style.borderColor = 'var(--ide-accent)';
                        setTimeout(() => {
                            if (labelSpan) labelSpan.textContent = oldText;
                            btnCopy.style.borderColor = '';
                        }, 1800);
                    } catch (err) {
                        alert('Không thể sao chép tự động. Bạn có thể bôi đen mã SQL trong khung để copy.');
                    }
                });
            }

            // Wire Confirm Commit
            if (btnConfirm) {
                btnConfirm.addEventListener('click', () => {
                    const itemsToCommit = dirtyItems.filter(d => selectedCommitIds.has(d.id));
                    if (itemsToCommit.length === 0) {
                        alert('Vui lòng tick chọn ít nhất 1 layout để cập nhật!');
                        return;
                    }
                    this._executeCommitDatabase(itemsToCommit, overlay);
                });
            }
        },

        async _executeCommitDatabase(dirtyItems, overlay) {
            const btnConfirm = overlay.querySelector('#bravo-le-commit-modal-btn-confirm');
            const btnCancel = overlay.querySelector('#bravo-le-commit-modal-btn-cancel');
            const btnClose = overlay.querySelector('#bravo-le-commit-btn-close');
            const statusEl = overlay.querySelector('#bravo-le-commit-status');
            const resultAlert = overlay.querySelector('#bravo-le-commit-result-alert');

            // Disable row checkboxes during commit
            overlay.querySelectorAll('.bravo-le-modal-chk-item, #bravo-le-modal-chk-all').forEach(c => c.disabled = true);

            // Set loading state
            if (btnConfirm) {
                btnConfirm.disabled = true;
                btnConfirm.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1"></i>Đang commit ${dirtyItems.length} layout...`;
            }
            if (btnCancel) btnCancel.disabled = true;
            if (btnClose) btnClose.disabled = true;

            if (statusEl) {
                statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-1" style="color:var(--ide-accent);"></i>Đang gửi lệnh Atomic Transaction COMMIT lên CSDL...`;
            }
            this._context?.setStatus('Đang thực thi Atomic Transaction COMMIT...', 'running');

            // Prepare Payload List
            const formsPayload = dirtyItems.map(d => ({
                id: d.id,
                formName: d.formName,
                xml: this._xmlBuffer[d.id] || '',
                draft_xml: d.hasDraft ? (this._draftXmlBuffer[d.id] || '') : null
            }));

            if (this._context && this._context.connectionId) {
                try {
                    const res = await fetch('/api/bravo/layout-editor/commit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connection_id: this._context.connectionId,
                            database: this._context.database,
                            platform: this._platform,
                            version: this._version,
                            forms: formsPayload
                        })
                    });
                    const data = await res.json();
                    if (data.success) {
                        // Remove ONLY committed layouts from dirty set
                        dirtyItems.forEach(d => this._dirtyFormIds.delete(d.id));
                        this._renderGrid();
                        this._updateStats();
                        this._context.setStatus('✓ Đã COMMIT thành công toàn bộ dữ liệu vào Database!', 'idle');

                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color:#28a745; font-weight:600;"><i class="fa-solid fa-circle-check me-1"></i>Commit thành công ${dirtyItems.length} layout!</span>`;
                        }

                        if (resultAlert) {
                            resultAlert.style.display = 'block';
                            resultAlert.style.background = 'rgba(40, 167, 69, 0.15)';
                            resultAlert.style.border = '1px solid rgba(40, 167, 69, 0.4)';
                            resultAlert.style.color = '#75b798';
                            resultAlert.innerHTML = `<i class="fa-solid fa-circle-check me-2"></i><strong>Thành công!</strong> Đã cập nhật ${dirtyItems.length} layout vào CSDL <strong>${this._escapeHtml(this._context.database || '')}</strong>. Cửa sổ sẽ đóng lại...`;
                        }

                        if (btnConfirm) {
                            btnConfirm.innerHTML = `<i class="fa-solid fa-circle-check me-1"></i>Thành công!`;
                            btnConfirm.style.background = '#28a745';
                        }

                        setTimeout(() => {
                            overlay.remove();
                        }, 1300);
                    } else {
                        const errMsg = data.error || 'Transaction Rollback';
                        this._context.setStatus('Lỗi Commit Database.', 'error');

                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color:#dc3545;"><i class="fa-solid fa-circle-xmark me-1"></i>Lỗi Commit CSDL</span>`;
                        }

                        if (resultAlert) {
                            resultAlert.style.display = 'block';
                            resultAlert.style.background = 'rgba(220, 53, 69, 0.15)';
                            resultAlert.style.border = '1px solid rgba(220, 53, 69, 0.4)';
                            resultAlert.style.color = '#ea868f';
                            resultAlert.innerHTML = `<i class="fa-solid fa-circle-exclamation me-2"></i><strong>Lỗi thực thi COMMIT:</strong><div style="margin-top:4px; font-family:monospace; font-size:11px;">${this._escapeHtml(errMsg)}</div>`;
                        }

                        // Re-enable controls for retry
                        overlay.querySelectorAll('.bravo-le-modal-chk-item, #bravo-le-modal-chk-all').forEach(c => c.disabled = false);
                        if (btnConfirm) {
                            btnConfirm.disabled = false;
                            btnConfirm.innerHTML = `<i class="fa-solid fa-rotate-right me-1"></i>Thử lại COMMIT`;
                        }
                        if (btnCancel) btnCancel.disabled = false;
                        if (btnClose) btnClose.disabled = false;
                    }
                } catch (err) {
                    this._context.setStatus('Lỗi Commit Database.', 'error');
                    if (statusEl) {
                        statusEl.innerHTML = `<span style="color:#dc3545;"><i class="fa-solid fa-circle-xmark me-1"></i>Lỗi kết nối Backend</span>`;
                    }
                    if (resultAlert) {
                        resultAlert.style.display = 'block';
                        resultAlert.style.background = 'rgba(220, 53, 69, 0.15)';
                        resultAlert.style.border = '1px solid rgba(220, 53, 69, 0.4)';
                        resultAlert.style.color = '#ea868f';
                        resultAlert.innerHTML = `<i class="fa-solid fa-circle-exclamation me-2"></i><strong>Lỗi kết nối máy chủ:</strong> ${this._escapeHtml(err.message || 'Không thể gửi yêu cầu')}`;
                    }
                    overlay.querySelectorAll('.bravo-le-modal-chk-item, #bravo-le-modal-chk-all').forEach(c => c.disabled = false);
                    if (btnConfirm) {
                        btnConfirm.disabled = false;
                        btnConfirm.innerHTML = `<i class="fa-solid fa-rotate-right me-1"></i>Thử lại COMMIT`;
                    }
                    if (btnCancel) btnCancel.disabled = false;
                    if (btnClose) btnClose.disabled = false;
                }
            } else {
                // Demo fallback simulation
                setTimeout(() => {
                    dirtyItems.forEach(d => this._dirtyFormIds.delete(d.id));
                    this._renderGrid();
                    this._updateStats();

                    if (statusEl) {
                        statusEl.innerHTML = `<span style="color:#28a745; font-weight:600;"><i class="fa-solid fa-circle-check me-1"></i>[Demo Mode] Đã giả lập commit thành công!</span>`;
                    }
                    if (resultAlert) {
                        resultAlert.style.display = 'block';
                        resultAlert.style.background = 'rgba(40, 167, 69, 0.15)';
                        resultAlert.style.border = '1px solid rgba(40, 167, 69, 0.4)';
                        resultAlert.style.color = '#75b798';
                        resultAlert.innerHTML = `<i class="fa-solid fa-circle-check me-2"></i><strong>[Demo Mode]</strong> Đã giả lập cập nhật ${dirtyItems.length} layout vào Database.`;
                    }
                    if (btnConfirm) {
                        btnConfirm.innerHTML = `<i class="fa-solid fa-circle-check me-1"></i>Thành công!`;
                        btnConfirm.style.background = '#28a745';
                    }
                    setTimeout(() => {
                        overlay.remove();
                    }, 1200);
                }, 600);
            }
        },

        // ── Split Panel Drag Resizer ──────────────────────────────────────────
        _initSplitResizer() {
            const resizer = this._container.querySelector('#bravo-le-split-resizer');
            const left = this._container.querySelector('#bravo-le-left-panel');
            if (!resizer || !left) return;

            let active = false, startX = 0, startW = 0;
            resizer.addEventListener('pointerdown', (e) => {
                active = true;
                resizer.classList.add('dragging');
                startX = e.clientX;
                startW = left.offsetWidth;
                resizer.setPointerCapture(e.pointerId);
                e.preventDefault();
            });
            resizer.addEventListener('pointermove', (e) => {
                if (!active) return;
                const w = Math.max(220, Math.min(startW + (e.clientX - startX), 600));
                left.style.width = w + 'px';
            });
            const stop = () => {
                if (!active) return;
                active = false;
                resizer.classList.remove('dragging');
            };
            resizer.addEventListener('pointerup', stop);
            resizer.addEventListener('pointercancel', stop);
        },

        // ── Horizontal Bottom Panel Drag Resizer ──────────────────────────────
        _initBottomResizer() {
            const resizer = this._container.querySelector('#bravo-le-bottom-resizer');
            const panel = this._container.querySelector('#bravo-le-search-result-panel');
            const rightPanel = this._container.querySelector('#bravo-le-right-panel');
            if (!resizer || !panel || !rightPanel) return;

            let active = false, startY = 0, startH = 0;

            resizer.addEventListener('pointerdown', (e) => {
                // If clicked directly on the toggle button, skip starting drag
                if (e.target.closest('#bravo-le-resizer-toggle-btn')) return;

                active = true;
                resizer.classList.add('dragging');
                panel.classList.add('dragging');
                startY = e.clientY;
                startH = panel.offsetHeight;
                resizer.setPointerCapture(e.pointerId);
                e.preventDefault();
            });

            resizer.addEventListener('pointermove', (e) => {
                if (!active) return;
                // Moving pointer UP increases height of bottom search panel
                const deltaY = startY - e.clientY;
                const maxH = Math.max(80, rightPanel.offsetHeight - 120);
                const newH = Math.max(30, Math.min(startH + deltaY, maxH));
                panel.style.height = newH + 'px';
                this._bottomPanelHeight = newH;

                if (this._searchResultCollapsed && newH > 50) {
                    this._setSearchPanelCollapsed(false);
                }
            });

            const stop = () => {
                if (!active) return;
                active = false;
                resizer.classList.remove('dragging');
                panel.classList.remove('dragging');
            };

            resizer.addEventListener('pointerup', stop);
            resizer.addEventListener('pointercancel', stop);
        },

        // ── Toggle / Collapse Bottom Search Result Panel ───────────────────────
        _setSearchPanelCollapsed(collapsed) {
            this._searchResultCollapsed = collapsed;
            const el = this._container;
            if (!el) return;

            const panel = el.querySelector('#bravo-le-search-result-panel');
            const body = el.querySelector('#bravo-le-srp-body');
            const headerChevron = el.querySelector('#bravo-le-srp-chevron');
            const resizerToggleIcon = el.querySelector('#bravo-le-resizer-toggle-icon');
            const btnToolbar = el.querySelector('#bravo-le-btn-toggle-search');

            if (panel) {
                if (collapsed) {
                    panel.classList.add('collapsed');
                    panel.style.height = '28px';
                    if (body) body.style.display = 'none';
                    if (headerChevron) headerChevron.className = 'fa-solid fa-chevron-up';
                    if (resizerToggleIcon) resizerToggleIcon.className = 'fa-solid fa-chevron-up';
                    if (btnToolbar) btnToolbar.classList.remove('active');
                } else {
                    panel.classList.remove('collapsed');
                    const targetHeight = (this._bottomPanelHeight && this._bottomPanelHeight > 50) ? this._bottomPanelHeight : 180;
                    panel.style.height = targetHeight + 'px';
                    if (body) body.style.display = 'block';
                    if (headerChevron) headerChevron.className = 'fa-solid fa-chevron-down';
                    if (resizerToggleIcon) resizerToggleIcon.className = 'fa-solid fa-chevron-down';
                    if (btnToolbar) btnToolbar.classList.add('active');
                }
            }
        },

        _toggleSearchPanel() {
            const el = this._container;
            if (!el) return;
            const panel = el.querySelector('#bravo-le-search-result-panel');
            const resizer = el.querySelector('#bravo-le-bottom-resizer');
            if (!panel) return;

            // If completely hidden, show it and expand
            if (panel.style.display === 'none') {
                panel.style.display = 'flex';
                if (resizer) resizer.style.display = 'flex';
                this._setSearchPanelCollapsed(false);
            } else if (this._searchResultCollapsed) {
                // If collapsed, expand
                this._setSearchPanelCollapsed(false);
            } else {
                // If expanded, collapse
                this._setSearchPanelCollapsed(true);
            }
        },

        // ── Update Platform -> Version Constraints ────────────────────────────
        _updateVersionOptions() {
            const versionSel = this._container.querySelector('#bravo-le-version');
            if (!versionSel) return;

            if (this._platform === 'Mobile') {
                versionSel.innerHTML = `
                    <option value="Bravo 8" ${this._version === 'Bravo 8' ? 'selected' : ''}>Bravo 8</option>
                    <option value="Bravo 10" ${this._version === 'Bravo 10' ? 'selected' : ''}>Bravo 10</option>
                `;
                if (this._version === 'Bravo 7') this._version = 'Bravo 8';
            } else {
                versionSel.innerHTML = `
                    <option value="Bravo 7" ${this._version === 'Bravo 7' ? 'selected' : ''}>Bravo 7</option>
                    <option value="Bravo 8" ${this._version === 'Bravo 8' ? 'selected' : ''}>Bravo 8</option>
                    <option value="Bravo 10" ${this._version === 'Bravo 10' ? 'selected' : ''}>Bravo 10</option>
                `;
            }
        },

        // ── Update SQL Query Preview matching Specification 3.1 ──────────────
        _updateSqlPreview() {
            const preview = this._container.querySelector('#bravo-le-sql-preview');
            if (!preview) return;

            const isPostgres = (this._context?.dbType || '').toLowerCase().includes('postgre');
            let sql = '';
            if (isPostgres) {
                if (this._platform === 'Win') {
                    if (this._version === 'Bravo 7') {
                        sql = `SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate", l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy", 0 AS "HasDraft" FROM b00layout AS l INNER JOIN b00layoutdata AS ld ON ld.id = l.id LEFT OUTER JOIN b00command AS c ON c.ctorarg2 = l.formname LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby`;
                    } else {
                        sql = `SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", l.istemplate AS "IsTemplate", l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy", CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft" FROM b00layout AS l INNER JOIN b00layoutdata AS ld ON ld.id = l.id LEFT OUTER JOIN b00command AS c ON c.commandkey = l.formname LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby`;
                    }
                } else {
                    if (this._version === 'Bravo 8') {
                        sql = `SELECT id AS "Id", name AS "FormName", '' AS "LayoutName", 0 AS "IsTemplate", modifiedat AS "ModifiedAt", 0 AS "HasDraft" FROM b00storyboard`;
                    } else {
                        sql = `SELECT l.id AS "Id", l.formname AS "FormName", l.layoutname AS "LayoutName", 0 AS "IsTemplate", l.createdby AS "CreatedBy", l.modifiedat AS "ModifiedAt", u.username AS "ModifiedBy", CASE WHEN ld.lastlayoutdata IS NOT NULL AND OCTET_LENGTH(ld.lastlayoutdata) > 0 THEN 1 ELSE 0 END AS "HasDraft" FROM b09layout AS l INNER JOIN b09layoutdata AS ld ON ld.id = l.id LEFT OUTER JOIN b09command AS c ON c.commandkey = l.formname LEFT OUTER JOIN b00userlist AS u ON u.id = l.modifiedby`;
                    }
                }
            } else {
                if (this._platform === 'Win') {
                    if (this._version === 'Bravo 7') {
                        sql = `SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, 0 AS HasDraft FROM B00Layout AS l INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id LEFT OUTER JOIN B00Command AS c ON c.CtorArg2 = l.FormName LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy`;
                    } else {
                        sql = `SELECT l.Id, l.FormName, l.LayoutName, l.IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft FROM B00Layout AS l INNER JOIN B00LayoutData AS ld ON ld.Id = l.Id LEFT OUTER JOIN B00Command AS c ON c.CommandKey = l.FormName LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy`;
                    }
                } else {
                    if (this._version === 'Bravo 8') {
                        sql = `SELECT Id, Name AS FormName, '' AS LayoutName, 0 AS IsTemplate, ModifiedAt, 0 AS HasDraft FROM B00StoryBoard`;
                    } else {
                        sql = `SELECT l.Id, l.FormName, l.LayoutName, 0 AS IsTemplate, l.CreatedBy, l.ModifiedAt, u.UserName AS ModifiedBy, CASE WHEN ld.LastLayoutData IS NOT NULL AND DATALENGTH(ld.LastLayoutData) > 0 THEN 1 ELSE 0 END AS HasDraft FROM B09Layout AS l INNER JOIN B09LayoutData AS ld ON ld.Id = l.Id LEFT OUTER JOIN B09Command AS c ON c.CommandKey = l.FormName LEFT OUTER JOIN B00UserList AS u ON u.Id = l.ModifiedBy`;
                    }
                }
            }

            preview.textContent = sql;
            preview.title = sql;
        },

        // ── Render Checklist Filter Tabs ─────────────────────────────────────
        _renderChecklistTabs() {
            const tabsContainer = this._container.querySelector('#bravo-le-checklist-tabs');
            if (!tabsContainer) return;

            let tabs = ['CommandKey'];
            if (this._platform === 'Win' || this._version === 'Bravo 10') {
                tabs.push('DllName', 'ClassName');
            }
            if (this._platform === 'Win') {
                tabs.push('Loại layout');
            }

            if (!tabs.includes(this._activeTab)) this._activeTab = tabs[0];

            tabsContainer.innerHTML = tabs.map(t => `
                <div class="bravo-le-checklist-tab ${this._activeTab === t ? 'active' : ''}" data-tab="${t}">
                    ${t}
                </div>
            `).join('');

            tabsContainer.querySelectorAll('.bravo-le-checklist-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    const newTab = e.target.dataset.tab;
                    if (this._activeTab !== newTab) {
                        this._activeTab = newTab;
                        this._checkedChecklistValues = null;
                        const searchEl = this._container.querySelector('#bravo-le-checklist-search');
                        if (searchEl) searchEl.value = '';
                        this._renderChecklistTabs();
                        this._renderGrid();
                    }
                });
            });

            this._renderChecklistItems();
        },

        // ── Render Checklist Items (Requirement 1: Action toolbar & Search suggestion) ─
        _renderChecklistItems(filterText = '') {
            const listEl = this._container.querySelector('#bravo-le-checklist-list');
            if (!listEl) return;

            let allValues = [];
            if (this._activeTab === 'CommandKey') {
                allValues = [...new Set(this._masterData.map(d => d.commandKey))].filter(Boolean);
            } else if (this._activeTab === 'DllName') {
                allValues = [...new Set(this._masterData.map(d => d.dllName))].filter(Boolean);
            } else if (this._activeTab === 'ClassName') {
                allValues = [...new Set(this._masterData.map(d => d.className))].filter(Boolean);
            } else if (this._activeTab === 'Loại layout') {
                allValues = ['Layout', 'FormTemplate', 'GlobalLayout', 'Datasource', 'SubLayout'];
            }

            // Initialize default checklist values to all items if null
            if (this._checkedChecklistValues === null) {
                this._checkedChecklistValues = new Set(allValues);
            }

            let displayValues = allValues;
            if (filterText) {
                const q = filterText.toLowerCase();
                displayValues = allValues.filter(v => String(v).toLowerCase().includes(q));
            }

            if (!displayValues.length) {
                listEl.innerHTML = `<div class="text-muted p-2" style="font-size:10px;">Không có giá trị khớp.</div>`;
                return;
            }

            const allDisplayChecked = displayValues.length > 0 && displayValues.every(v => this._checkedChecklistValues.has(v));

            let html = `
                <label class="bravo-le-checklist-item bravo-le-chk-top">
                    <input type="checkbox" id="bravo-le-chk-toggle-all" ${allDisplayChecked ? 'checked' : ''}>
                    <span style="font-weight:700; color:var(--ide-accent);">(Chọn tất cả)</span>
                </label>
            `;

            html += displayValues.map(val => {
                const isChecked = this._checkedChecklistValues.has(val);
                return `
                    <label class="bravo-le-checklist-item">
                        <input type="checkbox" class="bravo-le-chk-item" value="${val}" ${isChecked ? 'checked' : ''}>
                        <span>${val}</span>
                    </label>
                `;
            }).join('');

            listEl.innerHTML = html;

            // Wire Top Toggle All Checkbox
            const toggleAllChk = listEl.querySelector('#bravo-le-chk-toggle-all');
            if (toggleAllChk) {
                toggleAllChk.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        displayValues.forEach(v => this._checkedChecklistValues.add(v));
                    } else {
                        displayValues.forEach(v => this._checkedChecklistValues.delete(v));
                    }
                    this._renderChecklistItems(filterText);
                    this._renderGrid();
                });
            }

            // Wire Individual Item Checkboxes
            listEl.querySelectorAll('.bravo-le-chk-item').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const val = chk.value;
                    if (e.target.checked) {
                        this._checkedChecklistValues.add(val);
                    } else {
                        this._checkedChecklistValues.delete(val);
                    }
                    const newAllChecked = displayValues.every(v => this._checkedChecklistValues.has(v));
                    if (toggleAllChk) toggleAllChk.checked = newAllChecked;
                    this._renderGrid();
                });
            });
        },

        // ── Render Master Data Grid ──────────────────────────────────────────
        _renderGrid() {
            const tbody = this._container.querySelector('#bravo-le-grid-body');
            const countEl = this._container.querySelector('#bravo-le-grid-count');
            if (!tbody) return;

            // 1. Apply Checklist Filter
            let displayData = this._masterData;
            if (this._checkedChecklistValues !== null) {
                displayData = displayData.filter(d => {
                    let val = '';
                    if (this._activeTab === 'CommandKey') val = d.commandKey;
                    else if (this._activeTab === 'DllName') val = d.dllName;
                    else if (this._activeTab === 'ClassName') val = d.className;
                    else if (this._activeTab === 'Loại layout') val = d.layoutType;
                    return this._checkedChecklistValues.has(val);
                });
            }

            // 2. Apply Column Filters (Requirement 1: Column Filter condition)
            if (this._columnFilters && Object.keys(this._columnFilters).length > 0) {
                displayData = displayData.filter(d => {
                    for (const [col, filterVal] of Object.entries(this._columnFilters)) {
                        if (!filterVal) continue;
                        const q = filterVal.toLowerCase();

                        if (col === 'formName') {
                            if (!String(d.formName || '').toLowerCase().includes(q)) return false;
                        } else if (col === 'layoutName') {
                            if (!String(d.layoutName || '').toLowerCase().includes(q)) return false;
                        } else if (col === 'modifiedAt') {
                            if (!String(d.modifiedAt || '').toLowerCase().includes(q)) return false;
                        } else if (col === 'hasDraft') {
                            const draftStr = d.hasDraft ? 'draft' : 'clean';
                            if (!draftStr.includes(q) && !(q === '1' && d.hasDraft) && !(q === '0' && !d.hasDraft)) return false;
                        } else if (col === 'status') {
                            const isDirty = this._dirtyFormIds.has(d.id);
                            const statusStr = isDirty ? 'modified' : 'clean';
                            if (!statusStr.includes(q)) return false;
                        }
                    }
                    return true;
                });
            }

            // 3. Apply XML Search Match Filter: Filter to only forms matching search keyword
            if (this._searchQuery) {
                displayData = displayData.filter(d => this._searchMatchIds.has(d.id));
            }

            this._lastFilteredData = displayData;

            if (countEl) {
                if (this._searchQuery) {
                    countEl.innerHTML = `<span style="color:var(--ide-warning, #e3b341); font-weight:600;"><i class="fa-solid fa-filter me-1"></i>Lọc tìm kiếm: ${displayData.length} / ${this._masterData.length} forms</span>`;
                } else {
                    countEl.textContent = `${displayData.length} / ${this._masterData.length} forms`;
                }
            }

            if (displayData.length === 0) {
                const emptyMsg = this._searchQuery
                    ? `Không tìm thấy form nào chứa nội dung XML "${this._escapeHtml(this._searchQuery)}".`
                    : `Không có form nào khớp với bộ lọc đã chọn.`;
                tbody.innerHTML = `<tr><td colspan="6" class="text-muted text-center p-3" style="font-size:11px;">${emptyMsg}</td></tr>`;
                this._updateStats();
                return;
            }

            tbody.innerHTML = displayData.map(d => {
                const isSelected = this._selectedFormIds.has(d.id);
                const isDirty = this._dirtyFormIds.has(d.id);
                const isActive = this._activeForm && this._activeForm.id === d.id;
                const isMatch = this._searchMatchIds.size > 0 && this._searchMatchIds.has(d.id);

                return `
                    <tr class="${isActive ? 'selected' : ''} ${isDirty ? 'dirty' : ''} ${isMatch ? 'bravo-le-row--match' : ''}" data-id="${d.id}">
                        <td style="text-align:center;">
                            <input type="checkbox" class="bravo-le-row-check" data-id="${d.id}" ${isSelected ? 'checked' : ''}>
                        </td>
                        <td style="font-weight:600; color:var(--ide-accent);">
                            ${isMatch ? '<i class="fa-solid fa-circle-dot" style="color:var(--ide-warning,#e3b341); font-size:8px; margin-right:4px;"></i>' : ''}
                            ${this._escapeHtml(d.formName || '')}
                        </td>
                        <td>${this._escapeHtml(d.layoutName || '')}</td>
                        <td style="font-size:10px; color:var(--ide-text-dim);">${d.modifiedAt}</td>
                        <td style="text-align:center;">
                            ${d.hasDraft ? '<span class="badge bg-warning text-dark" style="font-size:9px;">Draft</span>' : '—'}
                        </td>
                        <td>
                            ${isDirty ? '<span class="text-warning fw-bold">Modified</span>' : '<span class="text-success">Clean</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

            // Wire Row Click & Checkbox Selection
            tbody.querySelectorAll('tr').forEach(tr => {
                tr.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT') return;
                    const id = parseInt(tr.dataset.id);
                    const item = this._masterData.find(d => d.id === id);
                    if (item) {
                        this._activeForm = item;
                        this._loadFormXmlIntoEditor(item);
                        this._renderGrid();
                    }
                });
            });

            tbody.querySelectorAll('.bravo-le-row-check').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const id = parseInt(chk.dataset.id);
                    if (e.target.checked) this._selectedFormIds.add(id);
                    else this._selectedFormIds.delete(id);
                    this._updateStats();
                });
            });

            this._updateStats();
        },

        async _initMonacoEditor() {
            const container = this._container?.querySelector('#bravo-le-monaco-container');
            if (!container) return;

            try {
                if (window.createBravoXmlEditor) {
                    this._xmlMonaco = await window.createBravoXmlEditor(container, {
                        readOnly: false,
                        fontSize: 13,
                        tabSize: 2,
                        onChange: (newXml) => {
                            if (!this._activeForm) return;
                            const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                            buffer[this._activeForm.id] = newXml;
                            this._dirtyFormIds.add(this._activeForm.id);
                            this._updateRowDirtyStatus(this._activeForm.id);
                            this._updateStats();
                            if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                                this._refreshTreeMap(newXml);
                            }
                        }
                    });

                    // If active form is already selected, populate Monaco
                    if (this._activeForm) {
                        const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
                        const xml = buffer[this._activeForm.id] || (this._viewMode === 'draft' ? this._activeForm.draftXml : this._activeForm.xml) || '';
                        this._xmlMonaco.setValue(xml);
                    }
                }
            } catch (err) {
                console.error('[Bravo LayoutEditor] Monaco initialization error:', err);
            }
        },

        _updateRowDirtyStatus(formId) {
            if (!this._container) return;
            const tr = this._container.querySelector(`tr[data-id="${formId}"]`);
            if (tr) {
                const isDirty = this._dirtyFormIds.has(formId);
                tr.classList.toggle('dirty', isDirty);
                const cells = tr.querySelectorAll('td');
                if (cells.length >= 6) {
                    cells[5].innerHTML = isDirty
                        ? '<span class="text-warning fw-bold">Modified</span>'
                        : '<span class="text-success">Clean</span>';
                }
            }
        },

        _getEditorXml() {
            if (this._xmlMonaco) {
                return this._xmlMonaco.getValue();
            }
            const textarea = this._container?.querySelector('#bravo-le-editor-textarea');
            return textarea ? textarea.value : '';
        },

        _setEditorXml(xml) {
            const cleanXml = xml || '';
            if (this._xmlMonaco) {
                this._xmlMonaco.setValue(cleanXml);
            }
            const textarea = this._container?.querySelector('#bravo-le-editor-textarea');
            if (textarea) textarea.value = cleanXml;
        },

        // ── Load Form XML payload into Editor & Tree View ─────────────────────
        _loadFormXmlIntoEditor(formItem) {
            const draftTab = this._container?.querySelector('#bravo-le-vtab-draft');
            const draftBadge = this._container?.querySelector('#bravo-le-draft-badge');

            if (draftTab) {
                draftTab.disabled = !formItem.hasDraft;
                if (!formItem.hasDraft && this._viewMode === 'draft') {
                    this._viewMode = 'active';
                    const activeTab = this._container?.querySelector('#bravo-le-vtab-active');
                    if (activeTab) activeTab.classList.add('active');
                    draftTab.classList.remove('active');
                }
            }
            if (draftBadge) {
                draftBadge.style.display = formItem.hasDraft ? 'inline-block' : 'none';
            }

            // Check if XML is already cached in RAM
            const buffer = this._viewMode === 'draft' ? this._draftXmlBuffer : this._xmlBuffer;
            if (buffer[formItem.id] !== undefined) {
                let currentXml = buffer[formItem.id];
                currentXml = this._beautifyXML(currentXml);
                buffer[formItem.id] = currentXml;

                this._setEditorXml(currentXml);
                if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                    this._refreshTreeMap(currentXml);
                }
            } else if (this._context && this._context.connectionId) {
                // Fetch payload from Backend API
                this._loadPayloadFromBackend(formItem);
            } else {
                let currentXml = (this._viewMode === 'draft' ? formItem.draftXml : formItem.xml) || '';
                currentXml = this._beautifyXML(currentXml);
                this._setEditorXml(currentXml);
                if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                    this._refreshTreeMap(currentXml);
                }
            }
        },

        // ── Update Display Mode & Refresh Code Viewer / TreeMap ──────────────
        _updateDisplayMode() {
            const codeWrapper = this._container?.querySelector('#bravo-le-code-wrapper');
            const treeWrapper = this._container?.querySelector('#bravo-le-treemap-wrapper');
            if (!codeWrapper || !treeWrapper) return;

            if (this._displayMode === 'editor') {
                codeWrapper.style.display = 'flex';
                codeWrapper.style.width = '100%';
                treeWrapper.style.display = 'none';
            } else if (this._displayMode === 'treemap') {
                codeWrapper.style.display = 'none';
                treeWrapper.style.display = 'block';
                treeWrapper.style.width = '100%';
            } else if (this._displayMode === 'split') {
                codeWrapper.style.display = 'flex';
                codeWrapper.style.width = '55%';
                treeWrapper.style.display = 'block';
                treeWrapper.style.width = '45%';
            }

            if (this._xmlMonaco) {
                this._xmlMonaco.layout();
            }

            if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                this._refreshTreeMap();
            }
        },

        _refreshTreeMap(xml) {
            const treeContainer = this._container?.querySelector('#bravo-le-tree-container');
            if (!treeContainer) return;
            const currentXml = xml !== undefined ? xml : this._getEditorXml();
            treeContainer.innerHTML = this._buildXMLTreeMap(currentXml);
            this._wireTreeMapEvents(treeContainer);
        },

        _refreshCodeViewerAndTreeMap() {
            if (this._displayMode === 'split' || this._displayMode === 'treemap') {
                this._refreshTreeMap();
            }
        },

        // ── XML Syntax Highlighter Engine ─────────────────────────────────────
        _highlightXML(xml) {
            if (!xml) return '';
            let escaped = xml
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Colorize comments
            escaped = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="xml-comment">$1</span>');

            // Colorize tags and attributes
            escaped = escaped.replace(/(&lt;\/?[a-zA-Z0-9_:-]+)(\s+[\s\S]*?)?(\/?&gt;)/g, (match, p1, p2, p3) => {
                let tagStr = `<span class="xml-tag">${p1}</span>`;
                if (p2) {
                    const attrs = p2.replace(/([a-zA-Z0-9_:-]+)=("[^"]*"|'[^']*')/g, (m, aKey, aVal) => {
                        return `<span class="xml-attr-name">${aKey}</span>=<span class="xml-attr-val">${aVal}</span>`;
                    });
                    tagStr += attrs;
                }
                tagStr += `<span class="xml-tag">${p3}</span>`;
                return tagStr;
            });

            // Highlight search keyword matches if active
            if (this._searchQuery) {
                const q = this._escapeHtml(this._searchQuery);
                const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                escaped = escaped.replace(regex, m => `<mark class="bravo-le-search-mark">${m}</mark>`);
            }

            return escaped;
        },

        // ── Interactive XML Tree Map Component ────────────────────────────────
        _buildXMLTreeMap(xmlText) {
            if (!xmlText || !xmlText.trim()) {
                return `<div class="text-muted p-2" style="font-size:11px;">Mã XML trống.</div>`;
            }

            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                const parseError = xmlDoc.querySelector('parsererror');
                if (parseError) {
                    return `<div class="text-danger p-2" style="font-size:11px;"><i class="fa-solid fa-triangle-exclamation me-1"></i>Cú pháp XML bị lỗi, không thể dựng Tree Map!</div>`;
                }

                return this._renderDOMNode(xmlDoc.documentElement);
            } catch (err) {
                return `<div class="text-danger p-2" style="font-size:11px;">Lỗi parse Tree Map XML.</div>`;
            }
        },

        _renderDOMNode(node) {
            if (!node || node.nodeType !== 1) return '';

            const tagName = node.tagName;
            const children = Array.from(node.children);
            const hasChildren = children.length > 0;
            const textContent = !hasChildren ? (node.textContent || '').trim() : '';

            // Extract Attributes
            let attrsHtml = '';
            if (node.attributes && node.attributes.length > 0) {
                Array.from(node.attributes).forEach(attr => {
                    attrsHtml += `<span class="bravo-le-tree-attr">${attr.name}=<span class="bravo-le-tree-attr-val">"${attr.value}"</span></span> `;
                });
            }

            let iconClass = 'fa-cube';
            if (tagName.includes('Layout') || tagName.includes('Form')) iconClass = 'fa-window-maximize';
            else if (tagName.includes('Control') || tagName.includes('Header')) iconClass = 'fa-cubes';
            else if (tagName.includes('Grid')) iconClass = 'fa-table';
            else if (tagName.includes('Column')) iconClass = 'fa-columns';
            else if (tagName.includes('Text') || tagName.includes('Button')) iconClass = 'fa-font';

            return `
                <div class="bravo-le-tree-node">
                    <div class="bravo-le-tree-header">
                        <span class="bravo-le-tree-toggle">${hasChildren ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-minus" style="font-size:7px;"></i>'}</span>
                        <i class="fa-solid ${iconClass} bravo-le-tree-icon"></i>
                        <span class="bravo-le-tree-tag">&lt;${tagName}&gt;</span>
                        ${attrsHtml}
                        ${textContent ? `<span class="text-muted" style="font-size:10px;">: "${textContent}"</span>` : ''}
                    </div>
                    ${hasChildren ? `
                        <div class="bravo-le-tree-children">
                            ${children.map(child => this._renderDOMNode(child)).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        },

        _wireTreeMapEvents(container) {
            container.querySelectorAll('.bravo-le-tree-header').forEach(hdr => {
                hdr.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const toggleIcon = hdr.querySelector('.bravo-le-tree-toggle i');
                    const childrenBlock = hdr.nextElementSibling;

                    if (childrenBlock && childrenBlock.classList.contains('bravo-le-tree-children')) {
                        if (childrenBlock.style.display === 'none') {
                            childrenBlock.style.display = 'flex';
                            if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-down';
                        } else {
                            childrenBlock.style.display = 'none';
                            if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-right';
                        }
                    }
                });
            });
        },

        // ── Hybrid XML Search Engine (Specification 4.2) ─────────────────────

        /** Phase 1: Instant RAM search on already-loaded _xmlBuffer */
        _onSearchRAM(query) {
            this._searchQuery = query;
            this._searchResults = [];
            this._searchMatchIds = new Set();

            const q = query.toLowerCase();
            const bufferFormIds = new Set(Object.keys(this._xmlBuffer).map(Number));

            // Search RAM buffer
            this._masterData.forEach(d => {
                const xmlText = this._xmlBuffer[d.id];
                if (xmlText === undefined) return;
                const lines = xmlText.split('\n');
                const occurrences = [];
                lines.forEach((lineContent, lineIdx) => {
                    if (lineContent.toLowerCase().includes(q)) {
                        occurrences.push({ line: lineIdx + 1, content: lineContent.trim() });
                    }
                });
                if (occurrences.length > 0) {
                    this._searchResults.push({
                        formId: d.id, formName: d.formName, layoutName: d.layoutName,
                        occurrences, source: 'RAM'
                    });
                    this._searchMatchIds.add(d.id);
                    this._selectedFormIds.add(d.id);
                }
            });

            const unloadedCount = this._masterData.length - bufferFormIds.size;
            this._renderSearchResults(unloadedCount > 0);

            // Auto-load first matching form if current activeForm is not in matches
            if (this._searchResults.length > 0 && (!this._activeForm || !this._searchMatchIds.has(this._activeForm.id))) {
                const firstMatch = this._masterData.find(d => d.id === this._searchResults[0].formId);
                if (firstMatch) {
                    this._activeForm = firstMatch;
                    this._loadFormXmlIntoEditor(firstMatch);
                    setTimeout(() => this._highlightEditorMatches(this._searchQuery, 0), 250);
                }
            }

            this._renderGrid();
            this._updateStats();

            if (unloadedCount === 0) {
                // All forms loaded — backend not needed
                this._context?.setStatus(`Tìm thấy ${this._searchMatchIds.size} form khớp từ khóa "${query}".`, 'idle');
            } else {
                this._context?.setStatus(`Tìm RAM: ${this._searchMatchIds.size} form khớp. Còn ${unloadedCount} form chưa tải.`, 'idle');
            }
        },

        /** Phase 2: Async Backend Batch Search for forms not yet in _xmlBuffer */
        async _onSearchBackend(query) {
            if (!this._context?.connectionId) {
                alert('Cần kết nối Backend để tìm toàn bộ!');
                return;
            }
            if (this._searchBackendRunning) return;

            const bufferFormIds = new Set(Object.keys(this._xmlBuffer).map(Number));
            const unloadedIds = this._masterData
                .filter(d => !bufferFormIds.has(d.id))
                .map(d => d.id);

            if (unloadedIds.length === 0) {
                this._context?.setStatus('Tất cả form đã được tìm kiếm trên RAM.', 'idle');
                return;
            }

            this._searchBackendRunning = true;
            const el = this._container;
            const btnBackend = el?.querySelector('#bravo-le-srp-btn-backend');
            const progressEl = el?.querySelector('#bravo-le-srp-progress');

            if (btnBackend) btnBackend.style.display = 'none';
            if (progressEl) { progressEl.style.display = 'inline'; progressEl.textContent = `Đang quét: 0 / ${unloadedIds.length} form...`; }

            try {
                const BATCH_SIZE = 50;
                let scanned = 0;
                for (let i = 0; i < unloadedIds.length; i += BATCH_SIZE) {
                    const batch = unloadedIds.slice(i, i + BATCH_SIZE);
                    const res = await fetch('/api/bravo/layout-editor/search-xml', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            connection_id: this._context.connectionId,
                            database: this._context.database,
                            platform: this._platform,
                            version: this._version,
                            keyword: query,
                            is_regex: false,
                            form_ids: batch
                        })
                    });
                    const data = await res.json();
                    if (data.success && Array.isArray(data.results)) {
                        data.results.forEach(r => {
                            if (r.occurrences && r.occurrences.length > 0) {
                                // Avoid duplicate (already in RAM results)
                                if (!this._searchMatchIds.has(r.form_id)) {
                                    const meta = this._masterData.find(d => d.id === r.form_id);
                                    this._searchResults.push({
                                        formId: r.form_id,
                                        formName: r.form_name || (meta?.formName ?? r.form_id),
                                        layoutName: r.layout_name || (meta?.layoutName ?? ''),
                                        occurrences: r.occurrences,
                                        source: 'Backend'
                                    });
                                    this._searchMatchIds.add(r.form_id);
                                    this._selectedFormIds.add(r.form_id);
                                }
                            }
                        });
                    }
                    scanned += batch.length;
                    if (progressEl) progressEl.textContent = `Đang quét: ${scanned} / ${unloadedIds.length} form...`;
                    if (this._searchResults.length > 0 && (!this._activeForm || !this._searchMatchIds.has(this._activeForm.id))) {
                        const firstMatch = this._masterData.find(d => d.id === this._searchResults[0].formId);
                        if (firstMatch) {
                            this._activeForm = firstMatch;
                            this._loadFormXmlIntoEditor(firstMatch);
                            setTimeout(() => this._highlightEditorMatches(this._searchQuery, 0), 250);
                        }
                    }
                    this._renderSearchResults(false);
                    this._renderGrid();
                }
            } catch (err) {
                this._context?.setStatus('Lỗi tìm kiếm Backend.', 'error');
            } finally {
                this._searchBackendRunning = false;
                if (progressEl) progressEl.style.display = 'none';
                this._renderGrid();
                this._updateStats();
                this._context?.setStatus(`Hoàn thành: ${this._searchMatchIds.size} form khớp "${query}".`, 'idle');
            }
        },

        /** Render the Search Result Panel */
        _renderSearchResults(showBackendBtn = false) {
            const el = this._container;
            if (!el) return;

            const panel = el.querySelector('#bravo-le-search-result-panel');
            const resizer = el.querySelector('#bravo-le-bottom-resizer');
            const summaryEl = el.querySelector('#bravo-le-srp-summary');
            const bodyEl = el.querySelector('#bravo-le-srp-body');
            const btnBackend = el.querySelector('#bravo-le-srp-btn-backend');
            const btnToolbar = el.querySelector('#bravo-le-btn-toggle-search');
            const badgeToolbar = el.querySelector('#bravo-le-search-badge');

            if (!panel) return;

            const totalOccurrences = this._searchResults.reduce((sum, r) => sum + r.occurrences.length, 0);

            // Display panel and resizer, uncollapse to active state
            panel.style.display = 'flex';
            if (resizer) resizer.style.display = 'flex';
            this._setSearchPanelCollapsed(false);

            // Toolbar toggle button with badge
            if (btnToolbar) {
                btnToolbar.style.display = 'inline-flex';
                btnToolbar.classList.add('active');
            }
            if (badgeToolbar) {
                badgeToolbar.style.display = 'inline-block';
                badgeToolbar.textContent = this._searchResults.length;
            }

            if (summaryEl) {
                summaryEl.textContent = `"${this._searchQuery}"  —  ${this._searchResults.length} form khớp · ${totalOccurrences} occurrences`;
            }

            if (btnBackend) {
                btnBackend.style.display = showBackendBtn ? 'inline-flex' : 'none';
            }

            if (!bodyEl) return;

            if (this._searchResults.length === 0) {
                bodyEl.innerHTML = `<div class="bravo-le-srp-empty"><i class="fa-solid fa-circle-info me-1"></i>Không tìm thấy kết quả khớp trong các form đã tải.</div>`;
                return;
            }

            bodyEl.innerHTML = this._searchResults.map((r, ri) => {
                const srcBadge = r.source === 'RAM'
                    ? `<span class="bravo-le-srp-badge bravo-le-srp-badge--ram">RAM</span>`
                    : `<span class="bravo-le-srp-badge bravo-le-srp-badge--backend">Backend</span>`;

                const occurrenceRows = r.occurrences.slice(0, 10).map((occ, oi) => `
                    <div class="bravo-le-srp-occ" data-form-id="${r.formId}" data-line="${occ.line}" data-result-idx="${ri}" data-occ-idx="${oi}">
                        <span class="bravo-le-srp-occ-line">Dòng ${occ.line}</span>
                        <span class="bravo-le-srp-occ-content">${this._escapeHtml(occ.content)}</span>
                    </div>
                `).join('');
                const moreCount = r.occurrences.length - 10;
                const moreHtml = moreCount > 0 ? `<div class="bravo-le-srp-occ-more">... và ${moreCount} occurrence khác</div>` : '';

                return `
                    <div class="bravo-le-srp-group" id="bravo-le-srp-group-${ri}">
                        <div class="bravo-le-srp-group-header" data-form-id="${r.formId}" data-result-idx="${ri}">
                            <span class="bravo-le-srp-group-toggle"><i class="fa-solid fa-chevron-down"></i></span>
                            <span class="bravo-le-srp-form-name">${r.formName}</span>
                            <span class="bravo-le-srp-layout-name">${r.layoutName}</span>
                            ${srcBadge}
                            <span class="bravo-le-srp-count">${r.occurrences.length} occurrence${r.occurrences.length > 1 ? 's' : ''}</span>
                        </div>
                        <div class="bravo-le-srp-group-body">
                            ${occurrenceRows}
                            ${moreHtml}
                        </div>
                    </div>
                `;
            }).join('');

            // Wire group header click (load form)
            bodyEl.querySelectorAll('.bravo-le-srp-group-header').forEach(hdr => {
                hdr.addEventListener('click', (e) => {
                    const formId = parseInt(hdr.dataset.formId);
                    const ri = parseInt(hdr.dataset.resultIdx);
                    const item = this._masterData.find(d => d.id === formId);
                    if (item) {
                        this._activeForm = item;
                        this._loadFormXmlIntoEditor(item);
                        this._renderGrid();
                        // After load, highlight keyword in editor
                        setTimeout(() => this._highlightEditorMatches(this._searchQuery, ri), 300);
                    }
                    // Toggle group body
                    const group = el.querySelector(`#bravo-le-srp-group-${ri}`);
                    const groupBody = group?.querySelector('.bravo-le-srp-group-body');
                    const chevron = group?.querySelector('.bravo-le-srp-group-toggle i');
                    if (groupBody) {
                        const isHidden = groupBody.style.display === 'none';
                        groupBody.style.display = isHidden ? 'block' : 'none';
                        if (chevron) chevron.className = isHidden ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right';
                    }
                });
            });

            // Wire occurrence row click (load form + scroll to line)
            bodyEl.querySelectorAll('.bravo-le-srp-occ').forEach(occ => {
                occ.addEventListener('click', (e) => {
                    const formId = parseInt(occ.dataset.formId);
                    const targetLine = parseInt(occ.dataset.line);
                    const ri = parseInt(occ.dataset.resultIdx);
                    const item = this._masterData.find(d => d.id === formId);
                    if (item) {
                        this._activeForm = item;
                        this._loadFormXmlIntoEditor(item);
                        this._renderGrid();
                        setTimeout(() => {
                            this._highlightEditorMatches(this._searchQuery, ri);
                            this._scrollEditorToLine(targetLine);
                        }, 300);
                    }
                });
            });
        },

        /** Highlight all keyword occurrences in the current XML editor and show navigator */
        _highlightEditorMatches(query, resultIdx) {
            const el = this._container;
            if (!el || !query) return;

            if (this._xmlMonaco) {
                this._searchMatchOccurrences = this._xmlMonaco.highlightMatches(query);
            } else {
                const xml = this._getEditorXml();
                const lines = xml.split('\n');
                const q = query.toLowerCase();

                this._searchMatchOccurrences = [];
                lines.forEach((line, idx) => {
                    if (line.toLowerCase().includes(q)) {
                        this._searchMatchOccurrences.push({ line: idx });
                    }
                });
            }

            this._searchMatchNavIdx = 0;

            // Update navigator bar
            const navBar = el.querySelector('#bravo-le-match-nav');
            const navLabel = el.querySelector('#bravo-le-match-nav-label');
            const navKeyword = el.querySelector('#bravo-le-match-nav-keyword');

            if (this._searchMatchOccurrences.length > 0) {
                if (navBar) navBar.style.display = 'flex';
                if (navLabel) navLabel.textContent = `1 / ${this._searchMatchOccurrences.length}`;
                if (navKeyword) navKeyword.textContent = `"${query}"`;
                // Scroll to first match
                this._scrollEditorToLine(this._searchMatchOccurrences[0].line + 1);
            } else {
                if (navBar) navBar.style.display = 'none';
            }
        },

        /** Navigate between occurrences in the editor (delta: +1 or -1) */
        _navigateMatch(delta) {
            if (this._searchMatchOccurrences.length === 0) return;
            this._searchMatchNavIdx = (this._searchMatchNavIdx + delta + this._searchMatchOccurrences.length) % this._searchMatchOccurrences.length;

            const el = this._container;
            const navLabel = el?.querySelector('#bravo-le-match-nav-label');
            if (navLabel) navLabel.textContent = `${this._searchMatchNavIdx + 1} / ${this._searchMatchOccurrences.length}`;

            const targetLine = this._searchMatchOccurrences[this._searchMatchNavIdx].line + 1;
            this._scrollEditorToLine(targetLine);
        },

        /** Scroll the XML editor textarea or Monaco to a given 1-based line number */
        _scrollEditorToLine(lineNumber) {
            if (this._xmlMonaco) {
                this._xmlMonaco.revealLine(lineNumber);
                return;
            }

            const el = this._container;
            const textarea = el?.querySelector('#bravo-le-editor-textarea');
            if (!textarea) return;

            const lines = textarea.value.split('\n');
            let charOffset = 0;
            for (let i = 0; i < Math.min(lineNumber - 1, lines.length); i++) {
                charOffset += lines[i].length + 1;
            }

            const lineHeight = 18;
            const scrollTop = Math.max(0, (lineNumber - 4) * lineHeight);
            textarea.scrollTop = scrollTop;
        },

        /** Clear all search state and result panel */
        _clearSearch() {
            this._searchQuery = '';
            this._searchResults = [];
            this._searchMatchIds = new Set();
            this._searchMatchOccurrences = [];
            this._searchMatchNavIdx = 0;
            this._searchBackendRunning = false;

            if (this._xmlMonaco) {
                this._xmlMonaco.clearHighlight();
            }

            const el = this._container;
            const panel = el?.querySelector('#bravo-le-search-result-panel');
            const resizer = el?.querySelector('#bravo-le-bottom-resizer');
            const navBar = el?.querySelector('#bravo-le-match-nav');
            const btnToolbar = el?.querySelector('#bravo-le-btn-toggle-search');

            if (panel) panel.style.display = 'none';
            if (resizer) resizer.style.display = 'none';
            if (navBar) navBar.style.display = 'none';
            if (btnToolbar) {
                btnToolbar.style.display = 'none';
                btnToolbar.classList.remove('active');
            }

            this._renderGrid();
            this._updateStats();
        },

        /** Clear keyword highlight in editor only (keep result panel) */
        _clearSearchHighlight() {
            this._searchMatchOccurrences = [];
            this._searchMatchNavIdx = 0;
            if (this._xmlMonaco) {
                this._xmlMonaco.clearHighlight();
            }
            const el = this._container;
            const navBar = el?.querySelector('#bravo-le-match-nav');
            if (navBar) navBar.style.display = 'none';
            this._refreshCodeViewerAndTreeMap();
        },

        /** Escape HTML special chars */
        _escapeHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        },

        // ── Update Footer Statistics Bar ─────────────────────────────────────
        _updateStats() {
            const statsEl = this._container.querySelector('#bravo-le-footer-stats');
            if (!statsEl) return;

            statsEl.innerHTML = `
                Tổng số: <strong>${this._masterData.length}</strong> forms | 
                Đã chọn: <strong>${this._selectedFormIds.size}</strong> forms | 
                Đang sửa đổi (Dirty): <strong style="color:var(--ide-warning, #e3b341);">${this._dirtyFormIds.size}</strong> form
            `;
        },

        // ── Requirement 2: Enhanced XML Beautify Utility Function ────────────
        _beautifyXML(xml) {
            if (!xml || !xml.trim()) return '';
            try {
                let cleanXml = xml.trim();

                // 1. Separate XML tags onto separate lines
                cleanXml = cleanXml.replace(/>\s*(<[^\/])/g, '>\n$1');
                cleanXml = cleanXml.replace(/(<\/[^>]+>)\s*(<)/g, '$1\n$2');
                cleanXml = cleanXml.replace(/(>)\s*(<\/[^>]+>)/g, '$1\n$2');

                let formatted = [];
                let pad = 0;
                const lines = cleanXml.split('\n');

                lines.forEach(line => {
                    let trimmed = line.trim();
                    if (!trimmed) return;

                    let indent = 0;
                    if (trimmed.startsWith('</')) {
                        if (pad > 0) pad -= 1;
                    } else if (trimmed.startsWith('<') && !trimmed.startsWith('<?') && !trimmed.startsWith('<!--') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
                        indent = 1;
                    }

                    let padding = '  '.repeat(pad);
                    formatted.push(padding + trimmed);

                    pad += indent;
                });

                return formatted.join('\n');
            } catch (e) {
                return xml;
            }
        },


        destroy() {
            if (this._container) this._container.innerHTML = '';
            this._container = null;
            this._context = null;
            this._masterData = [];
            this._selectedFormIds.clear();
            this._dirtyFormIds.clear();
            this._foldedLines.clear();
            this._xmlBuffer = {};
            this._draftXmlBuffer = {};
            this._searchQuery = '';
            this._searchResults = [];
            this._searchMatchIds = new Set();
            this._searchMatchOccurrences = [];
            this._searchBackendRunning = false;
            if (this._xmlMonaco) {
                this._xmlMonaco.dispose();
                this._xmlMonaco = null;
            }
        }
    });

})();
