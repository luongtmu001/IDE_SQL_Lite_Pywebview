/**
 * Schema Compare & DDL Migration JavaScript Component.
 * Supports both In-Tab embedding and standalone Pop-out window mode.
 * Strictly Zero Inline CSS Rule Compliant.
 * Features:
 *  1. Action bar matching IDE toolbar (Source, Target, Centered Engine Type).
 *  2. In-Tab mode: Source connection is locked to current active editor connection.
 *  3. Non-popup textual connection status hint below connection selectors.
 *  4. Selective object type compare (Tables, Views, Procedures, Functions, Triggers) to avoid over-fetching.
 *  5. Loading modal overlay with cancellation support.
 *  6. Unified DDL / Diff highlight pane side-by-side [Target ↔ Source] with Splitter Resize (Horizontal / Vertical).
 *  7. 100% Theme & Typography synchronization with Text Editor settings.
 */
(function (global) {
    'use strict';

    function normalizeEngineType(type) {
        if (!type) return 'sqlserver';
        const t = String(type).trim().toLowerCase();
        if (t === 'mssql' || t === 'sqlserver' || t === 'tsql') return 'sqlserver';
        if (t === 'postgres' || t === 'postgresql' || t === 'pgsql') return 'postgresql';
        if (t === 'sqlite' || t === 'sqlite3') return 'sqlite';
        if (t === 'mysql' || t === 'mariadb') return 'mysql';
        return t;
    }

    function formatEngineLabel(type) {
        const norm = normalizeEngineType(type);
        if (norm === 'sqlserver') return 'SQL Server';
        if (norm === 'postgresql') return 'PostgreSQL';
        if (norm === 'sqlite') return 'SQLite';
        if (norm === 'mysql') return 'MySQL';
        return norm.toUpperCase();
    }

    class SchemaCompareComponent {
        constructor() {
            this.container = null;
            this.isPopout = false;
            this.connections = [];
            this.sourceConnId = null;
            this.sourceDbType = null;
            this.sourceDb = null;
            this.sourceSchema = null;
            this.targetConnId = null;
            this.targetDbType = null;
            this.targetDb = null;
            this.targetSchema = null;
            this.diffData = null;
            this.selectedTables = new Set();
            this.filterStatus = 'all'; // 'all', 'different', 'missing', 'extra', 'identical'
            this.filterObjectType = 'all'; // 'all', 'table', 'view', 'procedure', 'function', 'trigger'
            this.searchQuery = '';
            this.includeDropTables = false;
            this.wrapTransaction = true;
            this.activeTable = null;
            this.activeViewMode = 'diff'; // 'diff' or 'script'
            this.splitLayout = 'horizontal'; // 'horizontal' or 'vertical'
            this.directModalTarget = 'source'; // 'source' or 'target'
            this.sourceDatabases = [];
            this.sourceSchemas = [];
            this.targetDatabases = [];
            this.targetSchemas = [];
            this.isManualDb = false;

            // Monaco Editor instances
            this.scriptEditor = null;
            this.diffEditor = null;
            this._diffOriginalModel = null;
            this._diffModifiedModel = null;

            // Splitter dragging state
            this.isDraggingSplitter = false;
            this.collapsedGroups = new Set();
        }

        async init(options) {
            options = options || {};
            const containerId = options.containerId || 'schema-compare-container';
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.error('[SchemaCompare] Container element not found:', containerId);
                return;
            }

            this.isPopout = !!options.isPopout;
            this.renderLayout();
            this.bindEvents();
            this.applyTypography();
            this.initMonacoEditors();
            this.observeThemeChanges();

            await this.loadConnections(options);
        }

        getUiTypographySettings() {
            let fontFamily = "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
            let fontSize = 13;

            try {
                if (window.TypographyManager && typeof window.TypographyManager.getTypography === 'function') {
                    const typo = window.TypographyManager.getTypography();
                    if (typo && typo.uiFontFamily) fontFamily = typo.uiFontFamily;
                    if (typo && typo.uiFontSize) fontSize = parseInt(typo.uiFontSize, 10) || 13;
                } else if (window.StorageManager && typeof window.StorageManager.getSettings === 'function') {
                    const s = window.StorageManager.getSettings();
                    if (s && s.appearance) {
                        if (s.appearance.uiFontFamily) fontFamily = s.appearance.uiFontFamily;
                        if (s.appearance.uiFontSize) fontSize = parseInt(s.appearance.uiFontSize, 10) || 13;
                    }
                } else {
                    const savedFam = localStorage.getItem('ide-ui-font-family');
                    const savedSz = localStorage.getItem('ide-ui-font-size');
                    if (savedFam) fontFamily = savedFam;
                    if (savedSz) fontSize = parseInt(savedSz, 10) || 13;

                    // Fallback to parsed ide-settings if not found in isolated keys
                    const ideSettingsStr = localStorage.getItem('ide-settings');
                    if (ideSettingsStr) {
                        try {
                            const parsed = JSON.parse(ideSettingsStr);
                            if (parsed && parsed.appearance) {
                                if (parsed.appearance.uiFontFamily && !savedFam) fontFamily = parsed.appearance.uiFontFamily;
                                if (parsed.appearance.uiFontSize && !savedSz) fontSize = parseInt(parsed.appearance.uiFontSize, 10) || fontSize;
                            }
                        } catch (_) { }
                    }
                }
            } catch (_) { }

            // If still default, check CSS custom properties on documentElement
            if (typeof window !== 'undefined' && window.getComputedStyle) {
                const rootStyle = getComputedStyle(document.documentElement);
                const cssUiFont = rootStyle.getPropertyValue('--ide-ui-font-family')?.trim();
                const cssUiSize = parseInt(rootStyle.getPropertyValue('--ide-ui-font-size'), 10);
                if (cssUiFont && (!fontFamily || fontFamily.includes('Segoe UI'))) {
                    fontFamily = cssUiFont;
                }
                if (!isNaN(cssUiSize) && cssUiSize >= 10 && cssUiSize <= 24) {
                    fontSize = cssUiSize;
                }
            }

            if (!fontFamily.includes(',') && !fontFamily.startsWith('"') && !fontFamily.startsWith("'")) {
                fontFamily = `"${fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            }

            return { fontFamily, fontSize };
        }

        getEditorTypographySettings() {
            let fontFamily = "Consolas, 'Courier New', monospace";
            let fontSize = 13;
            let lineHeight = 20;

            try {
                if (window.StorageManager && typeof window.StorageManager.getSettings === 'function') {
                    const s = window.StorageManager.getSettings();
                    if (s && s.editor) {
                        if (s.editor.fontFamily) fontFamily = s.editor.fontFamily;
                        if (s.editor.fontSize) fontSize = parseInt(s.editor.fontSize, 10) || 13;
                        if (s.editor.lineHeight) lineHeight = parseInt(s.editor.lineHeight, 10) || 20;
                    }
                } else {
                    const savedFam = localStorage.getItem('ide-font-family');
                    const savedSz = localStorage.getItem('ide-font-size');
                    if (savedFam) fontFamily = savedFam;
                    if (savedSz) fontSize = parseInt(savedSz, 10) || 13;
                }
            } catch (_) { }

            return { fontFamily, fontSize, lineHeight };
        }

        applyTypography() {
            const uiTypo = this.getUiTypographySettings();
            const editorTypo = this.getEditorTypographySettings();

            if (this.container) {
                this.container.style.setProperty('--sc-ui-font-family', uiTypo.fontFamily);
                this.container.style.setProperty('--sc-ui-font-size', uiTypo.fontSize + 'px');
                this.container.style.setProperty('--sc-editor-font-family', editorTypo.fontFamily);
                this.container.style.setProperty('--sc-editor-font-size', editorTypo.fontSize + 'px');
                this.container.style.setProperty('--sc-editor-line-height', editorTypo.lineHeight + 'px');
            }

            if (document.documentElement) {
                document.documentElement.style.setProperty('--sc-ui-font-family', uiTypo.fontFamily);
                document.documentElement.style.setProperty('--sc-ui-font-size', uiTypo.fontSize + 'px');
            }

            if (this.diffEditor && typeof this.diffEditor.updateOptions === 'function') {
                this.diffEditor.updateOptions({
                    fontFamily: editorTypo.fontFamily,
                    fontSize: editorTypo.fontSize,
                    lineHeight: editorTypo.lineHeight
                });
            }
            if (this.scriptEditor && typeof this.scriptEditor.updateOptions === 'function') {
                this.scriptEditor.updateOptions({
                    fontFamily: editorTypo.fontFamily,
                    fontSize: editorTypo.fontSize,
                    lineHeight: editorTypo.lineHeight
                });
            }
        }

        applyEditorTypography() {
            this.applyTypography();
        }

        renderLayout() {
            const popoutBtnHtml = this.isPopout
                ? ''
                : `<button type="button" class="sc-btn sc-btn-secondary" id="scBtnPopout" title="Mở trong cửa sổ độc lập (Pop-out)">
                     <i class="fa-solid fa-up-right-from-square"></i> Pop-out
                   </button>`;

            this.container.innerHTML = `
                <div class="schema-compare-container">
                    <!-- Top Action Bar: Matches IDE Toolbar Style -->
                    <header class="sc-header">
                        <div class="sc-conn-selection-row">
                            <!-- Left: Source Database Selector -->
                            <div class="sc-header-col-source ide-ctx-selectors">
                                <span class="sc-ctx-label sc-ctx-label-source" id="scSourceLabel">
                                    <i class="fa-solid fa-database"></i> NGUỒN
                                </span>

                                <!-- Hidden selects for backward compatibility -->
                                <select id="scSourceConnSelect" class="d-none"></select>
                                <select id="scSourceDbSelect" class="d-none"></select>
                                <select id="scSourceSchemaSelect" class="d-none"></select>

                                <!-- Source Connection Selector -->
                                <div class="dropdown d-inline-block position-relative">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scSourceConnBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn kết nối Nguồn"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-plug-circle-bolt me-1 text-success"></i>
                                        <span id="scSourceConnLabel" class="text-truncate">-- Nguồn --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu" id="scSourceConnMenu" aria-labelledby="scSourceConnBtn">
                                    </ul>
                                </div>

                                <!-- Source Direct Connection Button -->
                                <button type="button" class="sc-ctx-btn-direct" id="scBtnDirectSource" title="Thêm kết nối Nguồn trực tiếp">
                                    <i class="fa-solid fa-plus text-primary"></i>
                                </button>

                                <span class="ide-ctx-sep">›</span>

                                <!-- Source Database Selector -->
                                <div class="dropdown d-inline-block">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scSourceDbBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn Database Nguồn"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-database me-1 text-info"></i>
                                        <span id="scSourceDbLabel" class="text-truncate">-- Database --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu sc-db-dropdown-menu" id="scSourceDbMenu" aria-labelledby="scSourceDbBtn">
                                    </ul>
                                </div>

                                <span class="ide-ctx-sep">›</span>

                                <!-- Source Schema Selector -->
                                <div class="dropdown d-inline-block">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scSourceSchemaBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn Schema Nguồn"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-layer-group me-1 text-warning"></i>
                                        <span id="scSourceSchemaLabel" class="text-truncate">-- Schema --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu" id="scSourceSchemaMenu" aria-labelledby="scSourceSchemaBtn">
                                    </ul>
                                </div>
                            </div>

                            <!-- Center: Fixed Database Engine Badge -->
                            <div class="sc-header-col-engine">
                                <span id="scEngineBadge" class="sc-engine-badge">
                                    <i class="fa-solid fa-server"></i> <span id="scEngineBadgeText">SQL SERVER</span>
                                </span>
                            </div>

                            <!-- Right: Target Database Selector -->
                            <div class="sc-header-col-target ide-ctx-selectors">
                                <span class="sc-ctx-label sc-ctx-label-target" id="scTargetLabel">
                                    <i class="fa-solid fa-bullseye"></i> ĐÍCH
                                </span>

                                <!-- Hidden selects for backward compatibility -->
                                <select id="scTargetConnSelect" class="d-none"></select>
                                <select id="scTargetDbSelect" class="d-none"></select>
                                <select id="scTargetSchemaSelect" class="d-none"></select>

                                <!-- Target Connection Selector -->
                                <div class="dropdown d-inline-block position-relative">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scTargetConnBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn kết nối Đích"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-plug-circle-bolt me-1 text-success"></i>
                                        <span id="scTargetConnLabel" class="text-truncate">-- Đích --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu" id="scTargetConnMenu" aria-labelledby="scTargetConnBtn">
                                    </ul>
                                </div>

                                <!-- Target Direct Connection Button -->
                                <button type="button" class="sc-ctx-btn-direct" id="scBtnDirectTarget" title="Thêm kết nối Đích trực tiếp">
                                    <i class="fa-solid fa-plus text-primary"></i>
                                </button>

                                <span class="ide-ctx-sep">›</span>

                                <!-- Target Database Selector -->
                                <div class="dropdown d-inline-block">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scTargetDbBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn Database Đích"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-database me-1 text-info"></i>
                                        <span id="scTargetDbLabel" class="text-truncate">-- Database --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu sc-db-dropdown-menu" id="scTargetDbMenu" aria-labelledby="scTargetDbBtn">
                                    </ul>
                                </div>

                                <span class="ide-ctx-sep">›</span>

                                <!-- Target Schema Selector -->
                                <div class="dropdown d-inline-block">
                                    <button class="ide-ctx-badge dropdown-toggle" type="button" id="scTargetSchemaBtn"
                                        data-bs-toggle="dropdown" aria-expanded="false" title="Chọn Schema Đích"
                                        data-bs-popper-config='{"strategy":"fixed"}'>
                                        <i class="fa-solid fa-layer-group me-1 text-warning"></i>
                                        <span id="scTargetSchemaLabel" class="text-truncate">-- Schema --</span>
                                    </button>
                                    <ul class="dropdown-menu shadow sc-ctx-menu" id="scTargetSchemaMenu" aria-labelledby="scTargetSchemaBtn">
                                    </ul>
                                </div>
                            </div>
                        </div>

                        <!-- Actions: Pop-out, 1 Single Split Toggle -->
                        <div class="sc-header-actions">
                            ${popoutBtnHtml}
                            <button type="button" class="sc-layout-btn" id="scBtnToggleSplit" title="Chuyển kiểu xem: Trái / Phải ↔ Trên / Dưới">
                                <i class="fa-solid fa-table-columns" id="scSplitIcon"></i>
                            </button>
                        </div>
                    </header>

                    <!-- Selective Object Type Selection & Run / Options Bar -->
                    <div class="sc-control-bar">
                        <div class="sc-control-left">
                            <div class="sc-obj-select-group">
                                <span class="sc-checklist-label">
                                    <i class="fa-solid fa-list-check"></i> Chọn loại so sánh:
                                </span>
                                <select id="scSelectObjType" class="sc-ctx-select sc-obj-type-select" title="Chọn loại đối tượng cần so sánh">
                                    <option value="all">Tất cả các loại</option>
                                    <option value="tables">Bảng (Tables)</option>
                                    <option value="views">Views</option>
                                    <option value="procedures">Procedures</option>
                                    <option value="functions">Functions</option>
                                    <option value="triggers">Triggers</option>
                                </select>
                                <button type="button" class="sc-btn sc-btn-primary ms-1" id="scBtnRunCompare" title="Tiến hành so sánh 2 cơ sở dữ liệu">
                                    <i class="fa-solid fa-arrows-rotate"></i> So sánh
                                </button>
                                <span id="scCompareMsg" class="sc-compare-msg ms-2 text-muted">
                                    <i class="fa-solid fa-circle-info me-1"></i>Sẵn sàng so sánh. Vui lòng bấm "So sánh".
                                </span>
                            </div>
                        </div>

                        <div class="sc-control-right">
                            <label class="sc-check-item">
                                <input type="checkbox" id="scWrapTxCheck" checked> Gói Transaction
                            </label>
                            <label class="sc-check-item text-danger">
                                <input type="checkbox" id="scIncludeDropCheck"> Bao gồm DROP (Xóa)
                            </label>
                        </div>
                    </div>

                    <!-- Filter Bar: Status Pills -->
                    <section class="sc-filter-bar">
                        <div class="sc-filter-pills">
                            <button type="button" class="sc-pill active" data-filter="all">Tất cả <span class="sc-pill-count" id="scCountAll">(0)</span></button>
                            <button type="button" class="sc-pill" data-filter="different">Khác biệt <span class="sc-pill-count" id="scCountDifferent">(0)</span></button>
                            <button type="button" class="sc-pill" data-filter="missing">Tạo mới <span class="sc-pill-count" id="scCountMissing">(0)</span></button>
                            <button type="button" class="sc-pill" data-filter="extra">Chỉ có ở Đích <span class="sc-pill-count" id="scCountExtra">(0)</span></button>
                            <button type="button" class="sc-pill" data-filter="identical">Trùng khớp <span class="sc-pill-count" id="scCountIdentical">(0)</span></button>
                        </div>
                    </section>

                    <!-- Main Body Split (Horizontal or Vertical with Resize Splitter) -->
                    <div class="sc-body-split sc-split-horizontal" id="scBodySplit">
                        <!-- Pane 1: Object Comparison List -->
                        <div class="sc-left-pane" id="scLeftPane">
                            <div class="sc-pane-titlebar">
                                <div>
                                    <input type="checkbox" id="scSelectAllCheck" class="sc-table-checkbox" title="Chọn / Bỏ chọn tất cả">
                                    <span class="ms-1">Danh sách đối tượng</span>
                                </div>
                                <span id="scSelectedCountText">Đã chọn: 0</span>
                            </div>

                            <!-- Fixed Search & Object Type Filter Row below list title -->
                            <div class="sc-pane-search-bar" id="scPaneSearchBar">
                                <div class="sc-search-wrap flex-grow-1">
                                    <i class="fa-solid fa-magnifying-glass sc-search-icon"></i>
                                    <input type="text" id="scSearchInput" class="sc-search-input" placeholder="Tìm tên đối tượng..." autocomplete="off">
                                    <button type="button" class="sc-search-clear-btn d-none" id="scSearchClearBtn" title="Xóa tìm kiếm">
                                        <i class="fa-solid fa-xmark"></i>
                                    </button>
                                </div>
                                <div class="dropdown sc-obj-filter-dropdown">
                                    <button type="button" class="sc-filter-icon-btn" id="scObjFilterBtn" data-bs-toggle="dropdown" aria-expanded="false" title="Lọc theo loại đối tượng">
                                        <i class="fa-solid fa-filter"></i>
                                        <span class="sc-filter-active-dot d-none" id="scFilterActiveDot"></span>
                                    </button>
                                    <ul class="dropdown-menu dropdown-menu-end sc-obj-filter-menu" id="scObjFilterMenu">
                                        <li><h6 class="dropdown-header">Lọc loại đối tượng</h6></li>
                                        <li><a class="dropdown-item active" href="#" data-obj-filter="all"><i class="fa-solid fa-layer-group me-2 text-primary"></i><span class="sc-filter-item-label">Tất cả loại</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check"></i></a></li>
                                        <li><hr class="dropdown-divider my-1"></li>
                                        <li><a class="dropdown-item" href="#" data-obj-filter="table"><i class="fa-solid fa-table me-2 text-primary"></i><span class="sc-filter-item-label">Bảng (Tables)</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check d-none"></i></a></li>
                                        <li><a class="dropdown-item" href="#" data-obj-filter="view"><i class="fa-solid fa-eye me-2 text-warning"></i><span class="sc-filter-item-label">Views</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check d-none"></i></a></li>
                                        <li><a class="dropdown-item" href="#" data-obj-filter="procedure"><i class="fa-solid fa-terminal me-2 text-info"></i><span class="sc-filter-item-label">Stored Procedures</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check d-none"></i></a></li>
                                        <li><a class="dropdown-item" href="#" data-obj-filter="function"><i class="fa-solid fa-code me-2 text-success"></i><span class="sc-filter-item-label">Functions</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check d-none"></i></a></li>
                                        <li><a class="dropdown-item" href="#" data-obj-filter="trigger"><i class="fa-solid fa-bolt me-2 text-danger"></i><span class="sc-filter-item-label">Triggers</span><span class="sc-filter-item-count badge bg-secondary ms-auto me-2 d-none">0</span><i class="fa-solid fa-check text-primary sc-filter-check d-none"></i></a></li>
                                    </ul>
                                </div>
                            </div>
                            <div class="sc-table-list" id="scTableList">
                                <div class="sc-empty-state">
                                    <i class="fa-solid fa-code-compare"></i>
                                    <span>Chọn kết nối và nhấn "So sánh" để bắt đầu</span>
                                </div>
                            </div>
                        </div>

                        <!-- Resizer Splitter Gutter -->
                        <div class="sc-resizer" id="scResizer" title="Kéo để thay đổi kích thước"></div>

                        <!-- Pane 2: Unified DDL / Diff Highlight Area -->
                        <div class="sc-right-pane" id="scRightPane">
                            <div class="sc-diff-header">
                                <span class="sc-diff-target-title" id="scDiffTargetTitle">
                                    <i class="fa-solid fa-code-compare text-primary"></i> Chưa chọn đối tượng nào
                                </span>
                                <div class="sc-diff-controls">
                                    <button type="button" class="sc-btn sc-btn-primary" id="scBtnToggleDiffMode">
                                        <i class="fa-solid fa-code-compare"></i> So sánh Diff [Đích ↔ Nguồn]
                                    </button>
                                    <button type="button" class="sc-btn sc-btn-secondary" id="scBtnToggleScriptMode">
                                        <i class="fa-solid fa-file-code"></i> Script Migration DDL
                                    </button>
                                    <button type="button" class="sc-btn sc-btn-secondary" id="scBtnCopyActive" title="Sao chép nội dung">
                                        <i class="fa-regular fa-copy"></i> Sao chép
                                    </button>
                                    <button type="button" class="sc-btn sc-btn-secondary" id="scBtnOpenActive" title="Mở trong Query Editor của IDE">
                                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Mở trong Editor
                                    </button>
                                </div>
                            </div>

                            <div class="sc-script-viewer-wrap">
                                <!-- Monaco Diff Editor for Side-by-Side Target <-> Source comparison -->
                                <div id="scMonacoDiffContainer" class="sc-diff-editor-box"></div>

                                <!-- Monaco Single Editor for Consolidated Migration Script -->
                                <div id="scMonacoScriptContainer" class="sc-monaco-box d-none"></div>

                                <!-- Empty placeholder when nothing is selected -->
                                <div id="scDetailsEmptyPlaceholder" class="sc-empty-state d-none">
                                    <i class="fa-solid fa-magnifying-glass"></i>
                                    <span>Chọn một đối tượng ở danh sách để xem chi tiết highlight DDL khác biệt</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Status Bar -->
                    <footer class="sc-status-bar">
                        <div class="sc-status-left">
                            <span id="scStatusMessage">Sẵn sàng.</span>
                        </div>
                        <div class="sc-status-right">
                            <span id="scDestructiveWarning" class="sc-destructive-alert d-none">
                                <i class="fa-solid fa-triangle-exclamation"></i> Chứa câu lệnh DROP phá hủy dữ liệu!
                            </span>
                        </div>
                    </footer>

                    <!-- Modal Loading Overlay -->
                    <div id="scLoadingModal" class="sc-loading-backdrop d-none">
                        <div class="sc-loading-card">
                            <div class="spinner-border sc-loading-spinner" role="status"></div>
                            <h6 class="sc-loading-title">Đang so sánh cơ sở dữ liệu...</h6>
                            <p class="sc-loading-desc" id="scLoadingDescText">Đang trích xuất cấu trúc và phân tích khác biệt, vui lòng chờ trong giây lát...</p>
                            <button type="button" class="sc-btn-cancel-compare" id="scBtnCancelLoading">
                                <i class="fa-solid fa-xmark me-1"></i> Hủy
                            </button>
                        </div>
                    </div>

                    <!-- Direct Connection Modal Dialog -->
                    <div id="scDirectModalBackdrop" class="sc-modal-backdrop d-none">
                        <div class="sc-modal-dialog">
                            <div class="sc-modal-header">
                                <span id="scDirectModalTitle">
                                    <i class="fa-solid fa-plus text-primary me-2"></i> Thêm kết nối cơ sở dữ liệu
                                </span>
                                <button type="button" class="sc-modal-close-btn" id="scBtnCloseDirectModal">&times;</button>
                            </div>
                            <div class="sc-modal-body">
                                <div id="scDirectEngineNotice" class="sc-alert-box sc-alert-info d-none">
                                    <i class="fa-solid fa-circle-info"></i>
                                    <span id="scDirectEngineNoticeText">Chỉ hỗ trợ so sánh cùng loại CSDL.</span>
                                </div>

                                <div class="sc-form-group">
                                    <label class="sc-form-label" for="scDirectDbType">Loại Cơ sở Dữ liệu</label>
                                    <select id="scDirectDbType" class="sc-form-select">
                                        <option value="sqlserver">SQL Server (MSSQL)</option>
                                        <option value="postgresql">PostgreSQL</option>
                                        <option value="sqlite">SQLite</option>
                                        <option value="mysql">MySQL</option>
                                    </select>
                                </div>

                                <div id="scDirectServerFields">
                                    <div class="sc-form-row">
                                        <div class="sc-form-group flex-grow-1">
                                            <label class="sc-form-label" for="scDirectHost">Máy chủ (Server / Host)</label>
                                            <input type="text" id="scDirectHost" class="sc-form-input" placeholder="localhost hoặc 127.0.0.1">
                                        </div>
                                        <div class="sc-form-group sc-port-col">
                                            <label class="sc-form-label" for="scDirectPort">Cổng (Port)</label>
                                            <input type="text" id="scDirectPort" class="sc-form-input" placeholder="1433">
                                        </div>
                                    </div>

                                    <!-- Authentication mode for SQL Server -->
                                    <div class="sc-form-group mt-1" id="scDirectTrustedWrap">
                                        <label class="sc-check-item">
                                            <input type="checkbox" id="scDirectTrustedCheck" checked> Windows Authentication (Trusted Connection)
                                        </label>
                                    </div>

                                    <!-- Credentials: Username & Password -->
                                    <div id="scDirectCredsWrap" class="sc-form-row d-none">
                                        <div class="sc-form-group">
                                            <label class="sc-form-label" for="scDirectUser">Tài khoản (Username)</label>
                                            <input type="text" id="scDirectUser" class="sc-form-input" placeholder="sa / postgres">
                                        </div>
                                        <div class="sc-form-group">
                                            <label class="sc-form-label" for="scDirectPassword">Mật khẩu</label>
                                            <input type="password" id="scDirectPassword" class="sc-form-input" placeholder="••••••••">
                                        </div>
                                    </div>

                                    <!-- SSL & Security Options Group -->
                                    <div class="sc-form-row mt-1" id="scDirectSecurityGroup">
                                        <div class="sc-form-group" id="scDirectEncryptWrap">
                                            <label class="sc-check-item" title="Mã hóa kết nối SSL/TLS">
                                                <input type="checkbox" id="scDirectEncrypt"> Use SSL / Encrypt
                                            </label>
                                        </div>
                                        <div class="sc-form-group" id="scDirectTrustCertWrap">
                                            <label class="sc-check-item" title="Tin tưởng chứng chỉ máy chủ (không kiểm tra CA)">
                                                <input type="checkbox" id="scDirectTrustCert" checked> Trust Certificate
                                            </label>
                                        </div>
                                    </div>

                                    <!-- Database Selection Group with Fetch button (No manual input) -->
                                    <div class="sc-form-group mt-2">
                                        <div class="d-flex align-items-center justify-content-between mb-1">
                                            <label class="sc-form-label mb-0" for="scDirectDbSelect">Cơ sở Dữ liệu (Database)</label>
                                            <button type="button" class="sc-btn-load-dbs" id="scBtnFetchDirectDbs" title="Kết nối server và nạp danh sách Database">
                                                <i class="fa-solid fa-rotate me-1"></i> Tải Database
                                            </button>
                                        </div>
                                        <div id="scDirectDbSelectWrap">
                                            <select id="scDirectDbSelect" class="sc-form-select">
                                                <option value="">-- Chọn Database (Bấm "Tải Database" để nạp) --</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div id="scDirectSqliteFields" class="d-none">
                                    <div class="sc-form-group">
                                        <label class="sc-form-label" for="scDirectSqlitePath">Đường dẫn tệp SQLite</label>
                                        <div class="d-flex gap-2">
                                            <input type="text" id="scDirectSqlitePath" class="sc-form-input flex-grow-1" placeholder="C:\\path\\to\\database.db">
                                            <button type="button" class="sc-btn sc-btn-secondary" id="scBtnBrowseSqlite">
                                                <i class="fa-regular fa-folder-open"></i> Chọn tệp
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Save Connection to Object Explorer Option -->
                                <div class="sc-save-conn-box">
                                    <label class="sc-save-conn-toggle" for="scDirectSaveConnCheck">
                                        <input type="checkbox" id="scDirectSaveConnCheck">
                                        <span>Lưu kết nối vào Object Explorer</span>
                                    </label>
                                    <div id="scDirectSaveConnExtraWrap" class="sc-direct-extra-wrap d-none">
                                        <div class="sc-form-group">
                                            <label class="sc-form-label" for="scDirectConnName">Tên kết nối (Connection Name)</label>
                                            <input type="text" id="scDirectConnName" class="sc-form-input" placeholder="Tự động đặt tên nếu để trống">
                                        </div>
                                        <div class="sc-form-row">
                                            <div class="sc-form-group flex-grow-1">
                                                <label class="sc-form-label" for="scDirectGroup">Nhóm kết nối (Connection Group)</label>
                                                <input type="text" id="scDirectGroup" class="sc-form-input" list="scDirectGroupList" placeholder="VD: Khách hàng, Local...">
                                                <datalist id="scDirectGroupList"></datalist>
                                            </div>
                                            <div class="sc-form-group">
                                                <label class="sc-form-label" for="scDirectEnv">Môi trường</label>
                                                <select id="scDirectEnv" class="sc-form-select">
                                                    <option value="DEV">DEV (Phát triển)</option>
                                                    <option value="TEST">TEST (Kiểm thử)</option>
                                                    <option value="STAGING">STAGING (Tiền sản xuất)</option>
                                                    <option value="PROD">PROD (Sản xuất)</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div class="sc-form-group mt-1">
                                            <label class="sc-check-item">
                                                <input type="checkbox" id="scDirectReadOnly"> Chỉ đọc (Read-only mode)
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div id="scDirectModalError" class="sc-alert-box sc-alert-error d-none">
                                    <i class="fa-solid fa-triangle-exclamation"></i>
                                    <span id="scDirectModalErrorText"></span>
                                </div>
                            </div>
                            <div class="sc-modal-footer">
                                <button type="button" class="sc-btn sc-btn-secondary" id="scBtnCancelDirectModal">Hủy</button>
                                <button type="button" class="sc-btn sc-btn-primary" id="scBtnSubmitDirectModal">
                                    <i class="fa-solid fa-plug-circle-bolt me-1"></i> Kết nối ngay
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        bindEvents() {
            // Source & Target connection selector changes
            document.getElementById('scSourceConnSelect')?.addEventListener('change', (e) => {
                this.onConnectionChanged('source', e.target.value);
            });
            document.getElementById('scTargetConnSelect')?.addEventListener('change', (e) => {
                this.onConnectionChanged('target', e.target.value);
            });

            // Database / Schema selectors
            document.getElementById('scSourceDbSelect')?.addEventListener('change', (e) => {
                this.sourceDb = e.target.value;
                this.loadSchemas('source', this.sourceConnId, this.sourceDb, null);
                this.updateConnectionSubbarHint();
            });
            document.getElementById('scSourceSchemaSelect')?.addEventListener('change', (e) => {
                this.sourceSchema = e.target.value;
                this.updateConnectionSubbarHint();
            });
            document.getElementById('scTargetDbSelect')?.addEventListener('change', (e) => {
                this.targetDb = e.target.value;
                this.loadSchemas('target', this.targetConnId, this.targetDb, null);
                this.updateConnectionSubbarHint();
            });
            document.getElementById('scTargetSchemaSelect')?.addEventListener('change', (e) => {
                this.targetSchema = e.target.value;
                this.updateConnectionSubbarHint();
            });

            // Object Type Selection change
            document.getElementById('scSelectObjType')?.addEventListener('change', (e) => {
                this.onObjectTypeSelectionChanged(e.target.value);
            });

            // Action: Run Compare
            document.getElementById('scBtnRunCompare')?.addEventListener('click', () => {
                this.runCompare();
            });

            // Split Layout Toggle (Single button)
            document.getElementById('scBtnToggleSplit')?.addEventListener('click', () => {
                this.toggleSplitLayout();
            });

            // Splitter Resize dragging
            this.bindSplitterEvents();

            // Toggle Diff vs Script modes
            document.getElementById('scBtnToggleDiffMode')?.addEventListener('click', () => {
                this.setViewMode('diff');
            });
            document.getElementById('scBtnToggleScriptMode')?.addEventListener('click', () => {
                this.setViewMode('script');
            });

            // Copy & Open in Editor
            document.getElementById('scBtnCopyActive')?.addEventListener('click', () => {
                this.copyActiveContent();
            });
            document.getElementById('scBtnOpenActive')?.addEventListener('click', () => {
                this.openActiveInEditor();
            });

            // Pop-out Window
            document.getElementById('scBtnPopout')?.addEventListener('click', () => {
                this.openPopoutWindow();
            });

            // Loading Modal Cancel
            document.getElementById('scBtnCancelLoading')?.addEventListener('click', () => {
                this.cancelCompare();
            });

            // Filter pills (Status)
            document.querySelectorAll('.sc-pill').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.sc-pill').forEach(b => b.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    this.filterStatus = e.currentTarget.dataset.filter;
                    this.applyFilterAndRender();
                });
            });

            // Object Type Filter Dropdown items
            document.querySelectorAll('#scObjFilterMenu [data-obj-filter]').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const filterVal = e.currentTarget.dataset.objFilter;
                    this.setObjectTypeFilter(filterVal);
                });
            });

            // Search input and clear button
            const searchInput = document.getElementById('scSearchInput');
            const searchClearBtn = document.getElementById('scSearchClearBtn');

            searchInput?.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                if (searchClearBtn) {
                    searchClearBtn.classList.toggle('d-none', !e.target.value);
                }
                this.applyFilterAndRender();
            });

            searchClearBtn?.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                this.searchQuery = '';
                searchClearBtn.classList.add('d-none');
                this.applyFilterAndRender();
            });

            // Transaction & Drop options
            document.getElementById('scWrapTxCheck')?.addEventListener('change', (e) => {
                this.wrapTransaction = e.target.checked;
                this.refreshScript();
            });
            document.getElementById('scIncludeDropCheck')?.addEventListener('change', (e) => {
                this.includeDropTables = e.target.checked;
                this.refreshScript();
            });

            // Select All Checkbox
            document.getElementById('scSelectAllCheck')?.addEventListener('change', (e) => {
                this.selectAll(e.target.checked);
            });

            // Direct Connection Modals
            document.getElementById('scBtnDirectSource')?.addEventListener('click', () => {
                this.openDirectConnectionModal('source');
            });
            document.getElementById('scBtnDirectTarget')?.addEventListener('click', () => {
                this.openDirectConnectionModal('target');
            });
            document.getElementById('scBtnCloseDirectModal')?.addEventListener('click', () => {
                this.closeDirectConnectionModal();
            });
            document.getElementById('scBtnCancelDirectModal')?.addEventListener('click', () => {
                this.closeDirectConnectionModal();
            });
            document.getElementById('scBtnSubmitDirectModal')?.addEventListener('click', () => {
                this.submitDirectConnection();
            });

            // Direct modal field toggles
            document.getElementById('scDirectDbType')?.addEventListener('change', (e) => {
                this.onDirectDbTypeChanged(e.target.value);
            });
            document.getElementById('scDirectTrustedCheck')?.addEventListener('change', (e) => {
                const creds = document.getElementById('scDirectCredsWrap');
                if (creds) {
                    if (e.target.checked) creds.classList.add('d-none');
                    else creds.classList.remove('d-none');
                }
            });
            document.getElementById('scBtnBrowseSqlite')?.addEventListener('click', async () => {
                await this.browseSqliteFile();
            });
            document.getElementById('scBtnFetchDirectDbs')?.addEventListener('click', async () => {
                await this.fetchDirectDatabases();
            });
            document.getElementById('scDirectSaveConnCheck')?.addEventListener('change', (e) => {
                const extra = document.getElementById('scDirectSaveConnExtraWrap');
                if (extra) {
                    if (e.target.checked) extra.classList.remove('d-none');
                    else extra.classList.add('d-none');
                }
            });
        }

        setObjectTypeFilter(filterVal) {
            this.filterObjectType = filterVal || 'all';

            document.querySelectorAll('#scObjFilterMenu [data-obj-filter]').forEach(el => {
                const isCur = el.dataset.objFilter === this.filterObjectType;
                el.classList.toggle('active', isCur);
                const check = el.querySelector('.sc-filter-check');
                if (check) check.classList.toggle('d-none', !isCur);
            });

            const btn = document.getElementById('scObjFilterBtn');
            const dot = document.getElementById('scFilterActiveDot');
            const labelMap = {
                all: 'Tất cả loại',
                table: 'Bảng (Tables)',
                view: 'Views',
                procedure: 'Stored Procedures',
                function: 'Functions',
                trigger: 'Triggers'
            };

            if (btn) {
                const isActive = this.filterObjectType !== 'all';
                btn.classList.toggle('active', isActive);
                btn.title = `Lọc loại đối tượng: ${labelMap[this.filterObjectType] || this.filterObjectType}`;
            }
            if (dot) {
                dot.classList.toggle('d-none', this.filterObjectType === 'all');
            }

            this.applyFilterAndRender();
        }

        updateObjectTypeMenuCounts(typeCounts) {
            if (!typeCounts) return;
            document.querySelectorAll('#scObjFilterMenu [data-obj-filter]').forEach(item => {
                const filterVal = item.dataset.objFilter;
                const countBadge = item.querySelector('.sc-filter-item-count');
                if (countBadge) {
                    const cnt = typeCounts[filterVal];
                    if (cnt !== undefined) {
                        countBadge.textContent = cnt;
                        countBadge.classList.remove('d-none');
                    } else {
                        countBadge.classList.add('d-none');
                    }
                }
            });
        }

        bindSplitterEvents() {
            const resizer = document.getElementById('scResizer');
            const splitContainer = document.getElementById('scBodySplit');
            const leftPane = document.getElementById('scLeftPane');
            if (!resizer || !splitContainer || !leftPane) return;

            let startX = 0;
            let startY = 0;
            let startWidth = 0;
            let startHeight = 0;

            const onMouseMove = (e) => {
                if (!this.isDraggingSplitter) return;
                e.preventDefault();

                if (this.splitLayout === 'horizontal') {
                    const dx = e.clientX - startX;
                    const newWidth = Math.max(220, Math.min(splitContainer.clientWidth - 220, startWidth + dx));
                    leftPane.style.width = newWidth + 'px';
                } else {
                    const dy = e.clientY - startY;
                    const newHeight = Math.max(120, Math.min(splitContainer.clientHeight - 150, startHeight + dy));
                    leftPane.style.height = newHeight + 'px';
                }
            };

            const onMouseUp = () => {
                if (this.isDraggingSplitter) {
                    this.isDraggingSplitter = false;
                    resizer.classList.remove('is-dragging');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    this.layoutMonaco();
                }
            };

            resizer.addEventListener('mousedown', (e) => {
                this.isDraggingSplitter = true;
                resizer.classList.add('is-dragging');
                startX = e.clientX;
                startY = e.clientY;
                startWidth = leftPane.getBoundingClientRect().width;
                startHeight = leftPane.getBoundingClientRect().height;

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }

        toggleSplitLayout() {
            const next = this.splitLayout === 'horizontal' ? 'vertical' : 'horizontal';
            this.setSplitLayout(next);
        }

        setSplitLayout(layout) {
            this.splitLayout = layout;
            const container = document.getElementById('scBodySplit');
            const leftPane = document.getElementById('scLeftPane');
            const btnToggle = document.getElementById('scBtnToggleSplit');
            const icon = document.getElementById('scSplitIcon');

            if (leftPane) {
                leftPane.style.width = '';
                leftPane.style.height = '';
            }

            if (layout === 'vertical') {
                container?.classList.remove('sc-split-horizontal');
                container?.classList.add('sc-split-vertical');
                if (icon) icon.className = 'fa-solid fa-table-rows';
                if (btnToggle) btnToggle.title = 'Chia đôi màn hình: Hiện tại Trên / Dưới (Bấm để chuyển Trái / Phải)';
            } else {
                container?.classList.remove('sc-split-vertical');
                container?.classList.add('sc-split-horizontal');
                if (icon) icon.className = 'fa-solid fa-table-columns';
                if (btnToggle) btnToggle.title = 'Chia đôi màn hình: Hiện tại Trái / Phải (Bấm để chuyển Trên / Dưới)';
            }

            setTimeout(() => {
                this.layoutMonaco();
            }, 50);
        }

        setViewMode(mode) {
            this.activeViewMode = mode;
            const diffBox = document.getElementById('scMonacoDiffContainer');
            const scriptBox = document.getElementById('scMonacoScriptContainer');
            const btnDiff = document.getElementById('scBtnToggleDiffMode');
            const btnScript = document.getElementById('scBtnToggleScriptMode');

            if (mode === 'script') {
                diffBox?.classList.add('d-none');
                scriptBox?.classList.remove('d-none');
                btnDiff?.classList.remove('sc-btn-primary');
                btnDiff?.classList.add('sc-btn-secondary');
                btnScript?.classList.remove('sc-btn-secondary');
                btnScript?.classList.add('sc-btn-primary');
                if (this.activeTable && this.diffData) {
                    const normType = (this.activeObjType || 'table').toLowerCase().replace(/s$/, '');
                    const t = (this.diffData.tables || []).find(x => (x.table === this.activeTable || x.name === this.activeTable) && (!this.activeObjType || (x.object_type || 'table').toLowerCase().replace(/s$/, '') === normType));
                    if (t) {
                        let singleSql = '';
                        if (t.migration_sql && t.migration_sql.trim()) {
                            singleSql = t.migration_sql;
                        } else if (t.status === 'identical') {
                            const ddl = t.source_definition || t.target_definition || '';
                            singleSql = `-- ==============================================================================\n` +
                                        `-- ĐỐI TƯỢNG: [${(t.object_type || 'TABLE').toUpperCase()}] ${t.table || t.name} (TRÙNG KHỚP HOÀN TOÀN)\n` +
                                        `-- Không có thay đổi nào giữa CSDL Đích và CSDL Nguồn.\n` +
                                        `-- ==============================================================================\n\n` +
                                        (ddl || `-- Cấu trúc Bảng gồm ${t.column_count_source || 0} cột.`);
                        } else if (t.status === 'missing_in_target') {
                            singleSql = t.source_definition || t.migration_sql || `-- Tạo mới: ${t.table || t.name}`;
                        } else {
                            singleSql = t.source_definition || t.target_definition || t.migration_sql || '-- Không có migration script.';
                        }
                        this.scriptEditor?.setValue(singleSql);
                    }
                }
                if (this.scriptEditor) {
                    setTimeout(() => this.scriptEditor.layout(), 30);
                }
            } else {
                scriptBox?.classList.add('d-none');
                diffBox?.classList.remove('d-none');
                btnScript?.classList.remove('sc-btn-primary');
                btnScript?.classList.add('sc-btn-secondary');
                btnDiff?.classList.remove('sc-btn-secondary');
                btnDiff?.classList.add('sc-btn-primary');
                if (this.diffEditor) {
                    setTimeout(() => this.diffEditor.layout(), 30);
                }
            }
        }

        showLoadingModal(text) {
            const modal = document.getElementById('scLoadingModal');
            const desc = document.getElementById('scLoadingDescText');
            if (desc && text) desc.textContent = text;
            if (modal) modal.classList.remove('d-none');
        }

        hideLoadingModal() {
            const modal = document.getElementById('scLoadingModal');
            if (modal) modal.classList.add('d-none');
        }

        showFloatingToast(message, type = 'info', durationMs = 5000) {
            if (typeof showToast === 'function') {
                try { showToast(message, type); } catch (e) {}
            }
            let container = document.getElementById('scFloatingToastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'scFloatingToastContainer';
                container.className = 'sc-floating-toast-container';
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = `sc-floating-toast sc-floating-toast-${type}`;
            const icon = (type === 'danger' || type === 'error') ? 'fa-circle-xmark' :
                         type === 'warning' ? 'fa-triangle-exclamation' :
                         type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
            const title = (type === 'danger' || type === 'error') ? 'Lỗi kết nối' :
                          type === 'warning' ? 'Cảnh báo' :
                          type === 'success' ? 'Thành công' : 'Thông báo';
            toast.innerHTML = `
                <i class="fa-solid ${icon} sc-toast-icon"></i>
                <div class="sc-toast-content">
                    <div class="sc-toast-title">${title}</div>
                    <div class="sc-toast-msg">${window.escapeHtml ? window.escapeHtml(message) : message}</div>
                </div>
                <button type="button" class="sc-toast-close" title="Đóng">&times;</button>
            `;
            container.appendChild(toast);
            const removeToast = () => {
                toast.classList.add('sc-toast-fade-out');
                setTimeout(() => toast.remove(), 250);
            };
            toast.querySelector('.sc-toast-close')?.addEventListener('click', removeToast);
            if (durationMs > 0) {
                setTimeout(removeToast, durationMs);
            }
        }

        setConnectionLoading(which, isLoading) {
            const btn = document.getElementById(which === 'source' ? 'scSourceConnBtn' : 'scTargetConnBtn');
            const labelEl = document.getElementById(which === 'source' ? 'scSourceConnLabel' : 'scTargetConnLabel');
            if (!btn) return;
            if (isLoading) {
                btn.classList.add('sc-conn-loading', 'disabled');
                btn.setAttribute('aria-disabled', 'true');
                btn.disabled = true;
                const icon = btn.querySelector('i.fa-plug-circle-bolt, i.fa-spinner');
                if (icon) {
                    icon.className = 'fa-solid fa-spinner fa-spin me-1 text-primary';
                }
                if (labelEl) {
                    labelEl.dataset.origText = labelEl.textContent;
                    labelEl.textContent = 'Đang kết nối...';
                }
            } else {
                btn.classList.remove('sc-conn-loading');
                if (which !== 'source' || this.isPopout) {
                    btn.classList.remove('disabled');
                    btn.removeAttribute('aria-disabled');
                    btn.disabled = false;
                }
                const icon = btn.querySelector('i.fa-spinner, i.fa-plug-circle-bolt');
                if (icon) {
                    icon.className = 'fa-solid fa-plug-circle-bolt me-1 text-success';
                }
                if (labelEl && labelEl.dataset.origText && labelEl.textContent === 'Đang kết nối...') {
                    labelEl.textContent = labelEl.dataset.origText;
                }
            }
        }

        async cancelCompare() {
            this._compareCancelled = true;
            this.hideLoadingModal();
            const btn = document.getElementById('scBtnRunCompare');
            if (btn) btn.disabled = false;
            const statusEl = document.getElementById('scStatusMessage');
            if (statusEl) statusEl.textContent = 'Tiến trình so sánh đã bị hủy.';
            this.setCompareMsg('warning', 'Đang dừng tiến trình so sánh...');
            this.setKpiNoticeText('warning', 'Đã yêu cầu dừng tiến trình so sánh.');
            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.schema_compare_cancel === 'function') {
                    await api.schema_compare_cancel();
                }
            } catch (err) {
                console.warn('[SchemaCompare] cancel error:', err);
            }
            this.showFloatingToast('Đã dừng tiến trình so sánh CSDL.', 'info', 4000);
            this.setCompareMsg('muted', 'Tiến trình so sánh đã dừng.');
            this.setKpiNoticeText('muted', 'Đã hủy so sánh.');
        }

        setCompareMsg(type, message) {
            const el = document.getElementById('scCompareMsg');
            if (!el) return;
            let cls = 'text-muted';
            let icon = 'fa-circle-info';
            if (type === 'danger' || type === 'error') {
                cls = 'text-danger fw-semibold';
                icon = 'fa-circle-xmark';
            } else if (type === 'warning') {
                cls = 'text-warning fw-semibold';
                icon = 'fa-triangle-exclamation';
            } else if (type === 'success') {
                cls = 'text-success fw-semibold';
                icon = 'fa-circle-check';
            } else if (type === 'info') {
                cls = 'text-info';
                icon = 'fa-circle-info';
            }
            el.className = `sc-compare-msg ms-2 ${cls}`;
            el.innerHTML = `<i class="fa-solid ${icon} me-1"></i>${message}`;
        }

        setKpiNoticeText(type, message) {
            const el = document.getElementById('scKpiNoticeText');
            if (!el) return;
            let cls = 'text-muted';
            let icon = 'fa-circle-info';
            if (type === 'danger' || type === 'error') {
                cls = 'text-danger fw-semibold';
                icon = 'fa-circle-xmark';
            } else if (type === 'warning') {
                cls = 'text-warning fw-semibold';
                icon = 'fa-triangle-exclamation';
            } else if (type === 'success') {
                cls = 'text-success fw-semibold';
                icon = 'fa-circle-check';
            } else if (type === 'info') {
                cls = 'text-info';
                icon = 'fa-circle-info';
            }
            el.className = `sc-kpi-notice-text ${cls}`;
            el.innerHTML = `<i class="fa-solid ${icon} me-1"></i>${message}`;
        }

        updateConnectionSubbarHint() {
            const srcConn = this.connections.find(c => c.id === this.sourceConnId);
            const tgtConn = this.connections.find(c => c.id === this.targetConnId);

            if (!srcConn && !tgtConn) {
                this.setKpiNoticeText('muted', 'Vui lòng chọn kết nối Nguồn và Đích để tiến hành so sánh.');
                this.setCompareMsg('muted', 'Chưa chọn kết nối CSDL.');
                return;
            }

            if (this.sourceDbType && this.targetDbType && this.sourceDbType !== this.targetDbType) {
                const warn = `Hai kết nối khác loại CSDL (${formatEngineLabel(this.sourceDbType)} vs ${formatEngineLabel(this.targetDbType)}). Chỉ hỗ trợ so sánh cùng loại CSDL.`;
                this.setKpiNoticeText('danger', warn);
                this.setCompareMsg('danger', 'Khác loại CSDL!');
                return;
            }

            if (!srcConn) {
                this.setKpiNoticeText('warning', 'Vui lòng chọn kết nối Nguồn.');
                this.setCompareMsg('warning', 'Chưa chọn Nguồn.');
                return;
            }

            if (!tgtConn) {
                this.setKpiNoticeText('warning', 'Vui lòng chọn kết nối Đích.');
                this.setCompareMsg('warning', 'Chưa chọn Đích.');
                return;
            }

            const srcStr = `[${formatEngineLabel(srcConn.db_type)}] ${srcConn.name} › ${this.sourceDb || '—'} › ${this.sourceSchema || '—'}`;
            const tgtStr = `[${formatEngineLabel(tgtConn.db_type)}] ${tgtConn.name} › ${this.targetDb || '—'} › ${this.targetSchema || '—'}`;

            this.setKpiNoticeText('info', `Nguồn: <strong>${srcStr}</strong> &nbsp;➔&nbsp; Đích: <strong>${tgtStr}</strong>`);
            this.setCompareMsg('info', 'Sẵn sàng so sánh. Vui lòng bấm nút "So sánh".');
        }

        initMonacoEditors() {
            const setupEditors = () => {
                if (typeof monaco === 'undefined' || !monaco.editor) {
                    setTimeout(setupEditors, 100);
                    return;
                }

                const currentTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
                const monacoTheme = window.MonacoInit ? window.MonacoInit.getMonacoTheme(currentTheme) : (currentTheme === 'light' ? 'vs' : 'vs-dark');
                const typo = this.getEditorTypographySettings();

                // 1. Monaco Single Editor for Consolidated Script Migration DDL
                const scriptBox = document.getElementById('scMonacoScriptContainer');
                if (scriptBox && !this.scriptEditor) {
                    this.scriptEditor = monaco.editor.create(scriptBox, {
                        value: '-- Script migration sẽ xuất hiện ở đây sau khi so sánh.\n',
                        language: 'sql',
                        theme: monacoTheme,
                        fontFamily: typo.fontFamily,
                        fontSize: typo.fontSize,
                        lineHeight: typo.lineHeight,
                        automaticLayout: true,
                        readOnly: true,
                        minimap: { enabled: true },
                        scrollBeyondLastLine: false,
                        renderLineHighlight: 'all',
                        contextmenu: true
                    });
                }

                // 2. Monaco Diff Editor for Side-by-Side Object Comparison [Target <-> Source]
                const diffBox = document.getElementById('scMonacoDiffContainer');
                if (diffBox && !this.diffEditor) {
                    this.diffEditor = monaco.editor.createDiffEditor(diffBox, {
                        theme: monacoTheme,
                        fontFamily: typo.fontFamily,
                        fontSize: typo.fontSize,
                        lineHeight: typo.lineHeight,
                        automaticLayout: true,
                        readOnly: true,
                        renderSideBySide: true,
                        scrollBeyondLastLine: false,
                        originalEditable: false
                    });

                    this._diffOriginalModel = monaco.editor.createModel('-- [ĐÍCH / TARGET] Chưa chọn đối tượng', 'sql');
                    this._diffModifiedModel = monaco.editor.createModel('-- [NGUỒN / SOURCE] Chưa chọn đối tượng', 'sql');
                    this.diffEditor.setModel({
                        original: this._diffOriginalModel,
                        modified: this._diffModifiedModel
                    });
                }
            };

            if (window._onMonacoReady) {
                window._onMonacoReady(setupEditors);
            } else {
                setupEditors();
            }
        }

        layoutMonaco() {
            if (this.diffEditor) this.diffEditor.layout();
            if (this.scriptEditor) this.scriptEditor.layout();
        }

        observeThemeChanges() {
            const observer = new MutationObserver(() => {
                const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
                if (window.MonacoInit && typeof monaco !== 'undefined' && monaco.editor) {
                    monaco.editor.setTheme(window.MonacoInit.getMonacoTheme(curTheme));
                }
                this.applyTypography();
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme', 'style'] });

            // Listen for typography change events from TypographyManager and SettingsManager
            window.addEventListener('ide-typography-changed', () => {
                this.applyTypography();
            });
            window.addEventListener('ide-settings-updated', () => {
                this.applyTypography();
            });
            window.addEventListener('storage', (e) => {
                if (!e.key || e.key.includes('font') || e.key.includes('appearance') || e.key.includes('editor') || e.key.includes('theme') || e.key.includes('settings')) {
                    this.applyTypography();
                }
            });
        }

        async loadConnections(options) {
            options = options || {};
            try {
                let connections = [];
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.schema_compare_get_connections === 'function') {
                    const res = await api.schema_compare_get_connections();
                    if (res && res.success && Array.isArray(res.connections)) {
                        connections = res.connections;
                    }
                }

                if ((!connections || connections.length === 0) && window.ConnectionManager) {
                    connections = window.ConnectionManager.getSavedConnections() || [];
                }

                this.connections = connections.map(c => ({
                    ...c,
                    db_type: normalizeEngineType(c.db_type || c.type)
                }));

                // Requirement 6: For In-Tab mode, ALWAYS lock Source connection to current active editor connection!
                let lockedSourceId = null;
                let lockedDb = null;
                let lockedSchema = null;

                if (!this.isPopout) {
                    const tab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                    lockedSourceId = options.sourceConnId || (tab && tab.connectionId) || window.ActiveConnectionId || (this.connections[0] ? this.connections[0].id : null);
                    lockedDb = options.sourceDb || (tab && tab.database) || window.ActiveDatabase;
                    lockedSchema = options.sourceSchema || (tab && tab.schema) || window.ActiveSchema;
                } else {
                    lockedSourceId = options.sourceConnId || (this.connections[0] ? this.connections[0].id : null);
                    lockedDb = options.sourceDb;
                    lockedSchema = options.sourceSchema;
                }

                const preferredSrc = lockedSourceId || (this.connections[0] ? this.connections[0].id : null);
                if (preferredSrc) {
                    const cleanId = String(preferredSrc).replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
                    const foundConn = (this.connections || []).find(c => 
                        c.id === preferredSrc || 
                        c.name === preferredSrc || 
                        (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanId) ||
                        (c.id && String(c.id).toLowerCase() === cleanId)
                    );
                    this.sourceConnId = foundConn ? foundConn.id : preferredSrc;
                    this.sourceDbType = foundConn ? normalizeEngineType(foundConn.db_type) : null;
                }

                this.populateConnectionSelects(lockedSourceId);

                if (this.sourceConnId) {
                    const srcSelect = document.getElementById('scSourceConnSelect');
                    if (srcSelect) srcSelect.value = this.sourceConnId;
                    await this.onConnectionChanged('source', this.sourceConnId, lockedDb, lockedSchema);
                }

                if (options.targetConnId && options.targetConnId !== this.sourceConnId) {
                    const tgtSelect = document.getElementById('scTargetConnSelect');
                    if (tgtSelect) tgtSelect.value = options.targetConnId;
                    await this.onConnectionChanged('target', options.targetConnId, options.targetDb, options.targetSchema);
                }

                this.updateConnectionSubbarHint();
            } catch (err) {
                console.error('[SchemaCompare] Error loading connections:', err);
            }
        }

        setSourceContext(connId, db, schema, dbType) {
            if (connId) {
                this.onConnectionChanged('source', connId, db, schema);
            }
        }

        populateConnectionSelects(lockedSourceId) {
            this.renderConnectionDropdown('source', lockedSourceId);
            this.renderConnectionDropdown('target');
            this.updateEngineBadge();
        }

        renderConnectionDropdown(which, lockedSourceId) {
            const btn = document.getElementById(which === 'source' ? 'scSourceConnBtn' : 'scTargetConnBtn');
            const labelEl = document.getElementById(which === 'source' ? 'scSourceConnLabel' : 'scTargetConnLabel');
            const menu = document.getElementById(which === 'source' ? 'scSourceConnMenu' : 'scTargetConnMenu');
            const hiddenSelect = document.getElementById(which === 'source' ? 'scSourceConnSelect' : 'scTargetConnSelect');
            const srcLabel = document.getElementById('scSourceLabel');

            if (!btn || !menu) return;

            const currentId = which === 'source' ? this.sourceConnId : this.targetConnId;
            let list = this.connections || [];

            // Filtering based on environment and database engine
            if (!this.isPopout) {
                // IN-TAB MODE: Target can only select connections matching Source engine
                if (which === 'target' && this.sourceDbType) {
                    list = list.filter(c => normalizeEngineType(c.db_type) === this.sourceDbType);
                }
            } else {
                // POPOUT / POPUP MODE: Bidirectional filtering
                if (which === 'target' && this.sourceDbType) {
                    list = list.filter(c => normalizeEngineType(c.db_type) === this.sourceDbType);
                } else if (which === 'source' && this.targetDbType) {
                    list = list.filter(c => normalizeEngineType(c.db_type) === this.targetDbType);
                }
            }

            // Requirement 2: Exclude already selected connection on the opposite side
            const oppId = which === 'target' ? this.sourceConnId : this.targetConnId;
            if (oppId) {
                const cleanOpp = String(oppId).replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
                const oppConn = (this.connections || []).find(c => 
                    c.id === oppId || 
                    c.name === oppId || 
                    (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanOpp) ||
                    (c.id && String(c.id).toLowerCase() === cleanOpp)
                );
                const oppName = oppConn ? String(oppConn.name || '').toLowerCase() : '';
                const cleanOppName = oppName.replace(/\s*\([^)]*\)$/, '').trim();
                const oppRealId = oppConn ? String(oppConn.id || '').toLowerCase() : '';

                list = list.filter(c => {
                    const cId = String(c.id || '').toLowerCase();
                    const cName = String(c.name || '').toLowerCase();
                    const cleanCName = cName.replace(/\s*\([^)]*\)$/, '').trim();

                    if (c.id === oppId || c.name === oppId) return false;
                    if (cId === cleanOpp || cName === cleanOpp || cleanCName === cleanOpp) return false;
                    if (oppRealId && (cId === oppRealId || cleanCName === oppRealId)) return false;
                    if (oppName && (cName === oppName || cleanCName === oppName)) return false;
                    if (cleanOppName && (cleanCName === cleanOppName || cName === cleanOppName)) return false;

                    return true;
                });
            }

            // If currently selected connection was excluded or invalid, reset it
            let isCurValid = false;
            if (currentId) {
                const cleanCur = String(currentId).replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
                isCurValid = list.some(c => 
                    c.id === currentId || 
                    c.name === currentId || 
                    (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanCur) ||
                    (c.id && String(c.id).toLowerCase() === cleanCur)
                );
            }

            if (!isCurValid && currentId) {
                if (which === 'target') {
                    this.targetConnId = null;
                    this.targetDbType = null;
                    this.targetDb = null;
                    this.targetSchema = null;
                    this.targetDatabases = [];
                    this.targetSchemas = [];
                    this.renderDatabaseDropdown('target');
                    this.renderSchemaDropdown('target');
                } else if (which === 'source' && this.isPopout) {
                    this.sourceConnId = null;
                    this.sourceDbType = null;
                    this.sourceDb = null;
                    this.sourceSchema = null;
                    this.sourceDatabases = [];
                    this.sourceSchemas = [];
                    this.renderDatabaseDropdown('source');
                    this.renderSchemaDropdown('source');
                }
            }

            const cleanCur = String(currentId || '').replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
            const currentConn = (this.connections || []).find(c => 
                c.id === currentId || 
                c.name === currentId || 
                (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanCur) ||
                (c.id && String(c.id).toLowerCase() === cleanCur)
            );

            if (labelEl) {
                if (currentConn && isCurValid) {
                    labelEl.textContent = currentConn.name;
                    labelEl.title = `${currentConn.name} (${formatEngineLabel(currentConn.db_type)})`;
                } else {
                    labelEl.textContent = which === 'source' ? '-- Nguồn --' : '-- Đích --';
                    labelEl.title = labelEl.textContent;
                }
            }

            // Sync hidden select
            if (hiddenSelect) {
                hiddenSelect.innerHTML = `<option value="">-- Chọn kết nối --</option>` +
                    list.map(c => `<option value="${c.id}" ${(c.id === currentId || c === currentConn) ? 'selected' : ''}>${c.name}</option>`).join('');
                if (currentConn && isCurValid) hiddenSelect.value = currentConn.id;
                else hiddenSelect.value = '';
            }

            // Direct Connect Button Visibility
            const btnDirect = document.getElementById(which === 'source' ? 'scBtnDirectSource' : 'scBtnDirectTarget');
            if (btnDirect) {
                if (which === 'source' && !this.isPopout) {
                    btnDirect.classList.add('d-none');
                } else {
                    btnDirect.classList.remove('d-none');
                }
            }

            // Lock source if in Tab Editor Mode (Requirement 5)
            if (which === 'source') {
                if (!this.isPopout) {
                    btn.classList.add('disabled');
                    btn.setAttribute('aria-disabled', 'true');
                    btn.disabled = true;
                    if (srcLabel && !srcLabel.querySelector('.fa-lock')) {
                        srcLabel.innerHTML += ` <i class="fa-solid fa-lock ms-1" title="Cố định theo kết nối hiện tại của Editor"></i>`;
                    }
                } else {
                    btn.classList.remove('disabled');
                    btn.removeAttribute('aria-disabled');
                    btn.disabled = false;
                    const lock = srcLabel?.querySelector('.fa-lock');
                    if (lock) lock.remove();
                }
            }

            menu.innerHTML = '';
            if (list.length === 0) {
                const emptyLi = document.createElement('li');
                emptyLi.innerHTML = `<span class="dropdown-item text-muted small">${which === 'target' ? '(Không có kết nối khác cùng loại CSDL - Bấm bên dưới để thêm)' : '(Chưa có kết nối nào)'}</span>`;
                menu.appendChild(emptyLi);
            } else {
                list.forEach(c => {
                    const isCur = (c.id === currentId || c === currentConn);
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <a class="dropdown-item ${isCur ? 'active' : ''}" href="#">
                            <span>
                                <i class="fa-solid fa-plug-circle-bolt me-2 text-success"></i>
                                <span>${c.name}</span>
                                <span class="badge bg-secondary ms-1">${formatEngineLabel(c.db_type)}</span>
                            </span>
                            ${isCur ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                        </a>
                    `;
                    li.querySelector('a').addEventListener('click', (e) => {
                        e.preventDefault();
                        if (window.bootstrap) {
                            const dd = bootstrap.Dropdown.getInstance(btn);
                            if (dd) dd.hide();
                        }
                        this.onConnectionChanged(which, c.id);
                    });
                    menu.appendChild(li);
                });
            }

            // Divider and "+ Thêm kết nối mới..." item inside connection dropdown menu
            const divLi = document.createElement('li');
            divLi.innerHTML = '<hr class="dropdown-divider my-1">';
            menu.appendChild(divLi);

            const directLi = document.createElement('li');
            directLi.innerHTML = `
                <a class="dropdown-item text-primary d-flex align-items-center gap-2" href="#" title="Tạo hoặc kết nối nhanh trực tiếp">
                    <i class="fa-solid fa-plus text-primary"></i>
                    <span>Thêm kết nối mới...</span>
                </a>
            `;
            directLi.querySelector('a').addEventListener('click', (e) => {
                e.preventDefault();
                if (window.bootstrap) {
                    const dd = bootstrap.Dropdown.getInstance(btn);
                    if (dd) dd.hide();
                }
                this.openDirectConnectionModal(which);
            });
            menu.appendChild(directLi);
        }

        showDirectConnectModal(which) {
            this.openDirectConnectionModal(which);
        }

        updateEngineBadge() {
            const badgeTextEl = document.getElementById('scEngineBadgeText');
            const currentEngine = this.sourceDbType || this.targetDbType;
            if (badgeTextEl) {
                badgeTextEl.textContent = currentEngine ? formatEngineLabel(currentEngine).toUpperCase() : 'CHƯA CHỌN';
            }
        }

        updateTargetDropdownOptions(preferredTargetId) {
            this.updateEngineBadge();

            if (preferredTargetId) {
                const cleanSrc = String(this.sourceConnId || '').replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
                const srcConn = (this.connections || []).find(c => c.id === this.sourceConnId || (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanSrc));
                const srcName = srcConn ? srcConn.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() : '';

                const found = (this.connections || []).find(o => o.id === preferredTargetId);
                const tgtName = found ? found.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() : '';

                const isSameAsSrc = (preferredTargetId === this.sourceConnId) || (srcName && tgtName && srcName === tgtName);

                if (found && !isSameAsSrc && (!this.sourceDbType || normalizeEngineType(found.db_type) === this.sourceDbType)) {
                    this.targetConnId = preferredTargetId;
                } else {
                    this.targetConnId = null;
                    this.resetTargetDatabases();
                }
            } else {
                this.targetConnId = null;
                this.resetTargetDatabases();
            }

            this.renderConnectionDropdown('target');
        }

        renderDatabaseDropdown(which) {
            const btn = document.getElementById(which === 'source' ? 'scSourceDbBtn' : 'scTargetDbBtn');
            const labelEl = document.getElementById(which === 'source' ? 'scSourceDbLabel' : 'scTargetDbLabel');
            const menu = document.getElementById(which === 'source' ? 'scSourceDbMenu' : 'scTargetDbMenu');
            const hiddenSelect = document.getElementById(which === 'source' ? 'scSourceDbSelect' : 'scTargetDbSelect');

            if (!btn || !menu) return;

            const currentDb = which === 'source' ? this.sourceDb : this.targetDb;
            const dbs = (which === 'source' ? this.sourceDatabases : this.targetDatabases) || [];

            if (labelEl) {
                labelEl.textContent = currentDb || '-- Database --';
                labelEl.title = currentDb ? `Database: ${currentDb}` : 'Chọn Database';
            }

            // Sync hidden select
            if (hiddenSelect) {
                hiddenSelect.innerHTML = `<option value="">-- Database --</option>` +
                    dbs.map(d => `<option value="${d}" ${d === currentDb ? 'selected' : ''}>${d}</option>`).join('');
                if (currentDb) hiddenSelect.value = currentDb;
            }

            menu.innerHTML = '';

            // Header matching Image 3: SELECT DATABASE with filter icon
            const headerEl = document.createElement('div');
            headerEl.className = 'sc-db-dropdown-header';
            headerEl.innerHTML = `
                <span class="sc-db-dropdown-title">SELECT DATABASE</span>
                <button type="button" class="sc-db-filter-btn" title="Lọc danh sách Database">
                    <i class="fa-solid fa-filter"></i>
                </button>
            `;
            headerEl.addEventListener('click', (e) => e.stopPropagation());
            menu.appendChild(headerEl);

            // Collapsible search box
            const searchWrap = document.createElement('div');
            searchWrap.className = 'sc-db-search-wrap d-none';
            searchWrap.innerHTML = `
                <input type="text" class="form-control form-control-sm sc-db-search-input" placeholder="Lọc CSDL..." autocomplete="off">
            `;
            searchWrap.addEventListener('click', (e) => e.stopPropagation());
            searchWrap.addEventListener('keydown', (e) => e.stopPropagation());
            menu.appendChild(searchWrap);

            const filterBtn = headerEl.querySelector('.sc-db-filter-btn');
            const searchInput = searchWrap.querySelector('.sc-db-search-input');
            filterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = searchWrap.classList.contains('d-none');
                searchWrap.classList.toggle('d-none');
                if (isHidden && searchInput) {
                    setTimeout(() => searchInput.focus(), 50);
                }
            });

            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'sc-db-list-scroll';
            menu.appendChild(scrollContainer);

            if (dbs.length === 0) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'sc-db-item-empty';
                emptyItem.innerHTML = `<span class="text-muted small ps-2">(Chưa có danh sách Database)</span>`;
                scrollContainer.appendChild(emptyItem);
                return;
            }

            const noMatchItem = document.createElement('div');
            noMatchItem.className = 'sc-db-no-match d-none';
            noMatchItem.textContent = 'Không tìm thấy CSDL phù hợp';
            scrollContainer.appendChild(noMatchItem);

            const itemElements = [];
            dbs.forEach(d => {
                const isCur = d === currentDb;
                const item = document.createElement('a');
                item.className = `dropdown-item sc-db-item ${isCur ? 'active' : ''}`;
                item.href = '#';
                item.dataset.dbname = d.toLowerCase();
                item.innerHTML = `
                    <i class="fa-solid fa-database me-2 text-info"></i>
                    <span class="sc-db-name">${d}</span>
                    ${isCur ? '<i class="fa-solid fa-check ms-auto text-primary"></i>' : ''}
                `;
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (window.bootstrap) {
                        const dd = bootstrap.Dropdown.getInstance(btn);
                        if (dd) dd.hide();
                    }
                    this.onDatabaseChanged(which, d);
                });
                scrollContainer.appendChild(item);
                itemElements.push(item);
            });

            // Live search filter
            searchInput?.addEventListener('input', (e) => {
                const term = e.target.value.trim().toLowerCase();
                let matches = 0;
                itemElements.forEach(item => {
                    const name = item.dataset.dbname || '';
                    if (!term || name.includes(term)) {
                        item.classList.remove('d-none');
                        matches++;
                    } else {
                        item.classList.add('d-none');
                    }
                });
                noMatchItem.classList.toggle('d-none', matches > 0);
            });
        }

        renderSchemaDropdown(which) {
            const btn = document.getElementById(which === 'source' ? 'scSourceSchemaBtn' : 'scTargetSchemaBtn');
            const labelEl = document.getElementById(which === 'source' ? 'scSourceSchemaLabel' : 'scTargetSchemaLabel');
            const menu = document.getElementById(which === 'source' ? 'scSourceSchemaMenu' : 'scTargetSchemaMenu');
            const hiddenSelect = document.getElementById(which === 'source' ? 'scSourceSchemaSelect' : 'scTargetSchemaSelect');

            if (!btn || !menu) return;

            const currentSch = which === 'source' ? this.sourceSchema : this.targetSchema;
            const schemas = (which === 'source' ? this.sourceSchemas : this.targetSchemas) || [];

            if (labelEl) {
                labelEl.textContent = currentSch || '-- Schema --';
                labelEl.title = currentSch ? `Schema: ${currentSch}` : 'Chọn Schema';
            }

            // Sync hidden select
            if (hiddenSelect) {
                hiddenSelect.innerHTML = `<option value="">-- Schema --</option>` +
                    schemas.map(s => `<option value="${s}" ${s === currentSch ? 'selected' : ''}>${s}</option>`).join('');
                if (currentSch) hiddenSelect.value = currentSch;
            }

            menu.innerHTML = '';
            if (schemas.length === 0) {
                const emptyLi = document.createElement('li');
                emptyLi.innerHTML = `<span class="dropdown-item text-muted small">(Chưa có danh sách Schema)</span>`;
                menu.appendChild(emptyLi);
                return;
            }

            schemas.forEach(s => {
                const isCur = s === currentSch;
                const li = document.createElement('li');
                li.innerHTML = `
                    <a class="dropdown-item ${isCur ? 'active' : ''}" href="#">
                        <span><i class="fa-solid fa-layer-group me-2 text-warning"></i>${s}</span>
                        ${isCur ? '<i class="fa-solid fa-check ms-2 text-primary"></i>' : ''}
                    </a>
                `;
                li.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    if (window.bootstrap) {
                        const dd = bootstrap.Dropdown.getInstance(btn);
                        if (dd) dd.hide();
                    }
                    this.onSchemaChanged(which, s);
                });
                menu.appendChild(li);
            });
        }

        async onDatabaseChanged(which, newDb) {
            if (which === 'source') {
                this.sourceDb = newDb;
                this.sourceSchema = null;
                this.sourceSchemas = [];
                this.renderSchemaDropdown('source');
            } else {
                this.targetDb = newDb;
                this.targetSchema = null;
                this.targetSchemas = [];
                this.renderSchemaDropdown('target');
            }
            this.renderDatabaseDropdown(which);
            const connId = which === 'source' ? this.sourceConnId : this.targetConnId;
            if (connId) {
                const foundConn = this.connections.find(c => c.id === connId);
                const declaredSchema = foundConn ? (foundConn.schema || (foundConn.options && foundConn.options.schema)) : null;
                await this.loadSchemas(which, connId, newDb, declaredSchema);
            }
            this.updateConnectionSubbarHint();
        }

        onSchemaChanged(which, newSchema) {
            if (which === 'source') {
                this.sourceSchema = newSchema;
            } else {
                this.targetSchema = newSchema;
            }
            this.renderSchemaDropdown(which);
            this.updateConnectionSubbarHint();
        }

        resetTargetDatabases() {
            this.targetDb = null;
            this.targetSchema = null;
            this.targetDatabases = [];
            this.targetSchemas = [];
            this.renderDatabaseDropdown('target');
            this.renderSchemaDropdown('target');
        }

        async onConnectionChanged(which, connId, preferredDb, preferredSchema) {
            const cleanId = String(connId || '').replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
            const foundConn = (this.connections || []).find(c => 
                c.id === connId || 
                c.name === connId || 
                (c.name && c.name.toLowerCase().replace(/\s*\([^)]*\)$/, '').trim() === cleanId) ||
                (c.id && String(c.id).toLowerCase() === cleanId)
            );
            const actualId = foundConn ? foundConn.id : connId;

            // Immediately reflect label on UI button for instant feedback
            const labelEl = document.getElementById(which === 'source' ? 'scSourceConnLabel' : 'scTargetConnLabel');
            if (labelEl && foundConn) {
                labelEl.textContent = foundConn.name;
                labelEl.title = `${foundConn.name} (${formatEngineLabel(foundConn.db_type)})`;
            }

            if (which === 'source') {
                // If this connection was already chosen on target side, clear target
                if (actualId && (actualId === this.targetConnId || (foundConn && foundConn.name === this.targetConnId))) {
                    this.targetConnId = null;
                    this.targetDbType = null;
                    this.targetDb = null;
                    this.targetSchema = null;
                    this.targetDatabases = [];
                    this.targetSchemas = [];
                    this.renderDatabaseDropdown('target');
                    this.renderSchemaDropdown('target');
                }

                this.sourceConnId = actualId;
                this.sourceDbType = foundConn ? normalizeEngineType(foundConn.db_type) : null;
                // Immediately reset old databases & schemas for source
                this.sourceDb = null;
                this.sourceSchema = null;
                this.sourceDatabases = [];
                this.sourceSchemas = [];
                this.renderDatabaseDropdown('source');
                this.renderSchemaDropdown('source');

                this.renderConnectionDropdown('source');
                this.updateTargetDropdownOptions(this.targetConnId);
            } else {
                // If this connection was already chosen on source side (and in popout mode), clear source
                if (actualId && (actualId === this.sourceConnId || (foundConn && foundConn.name === this.sourceConnId))) {
                    if (this.isPopout) {
                        this.sourceConnId = null;
                        this.sourceDbType = null;
                        this.sourceDb = null;
                        this.sourceSchema = null;
                        this.sourceDatabases = [];
                        this.sourceSchemas = [];
                        this.renderDatabaseDropdown('source');
                        this.renderSchemaDropdown('source');
                        this.renderConnectionDropdown('source');
                    }
                }

                this.targetConnId = actualId;
                this.targetDbType = foundConn ? normalizeEngineType(foundConn.db_type) : null;
                // Immediately reset old databases & schemas for target
                this.targetDb = null;
                this.targetSchema = null;
                this.targetDatabases = [];
                this.targetSchemas = [];
                this.renderDatabaseDropdown('target');
                this.renderSchemaDropdown('target');

                this.renderConnectionDropdown('target');
                if (this.isPopout) {
                    this.renderConnectionDropdown('source');
                }
            }

            this.updateEngineBadge();
            this.updateConnectionSubbarHint();

            if (!actualId) return;

            // Load default database and default schema from connection profile if available
            const savedDefaultDb = preferredDb || (foundConn ? (foundConn.database || foundConn.default_database) : null);
            const savedDefaultSchema = preferredSchema || (foundConn ? (foundConn.schema || foundConn.default_schema || (foundConn.options && (foundConn.options.schema || foundConn.options.default_schema))) : null);

            this.setConnectionLoading(which, true);
            try {
                const ok = await this.loadSchemas(which, actualId, savedDefaultDb, savedDefaultSchema);
                if (!ok) {
                    // Revert/clear selection on connection failure
                    if (which === 'source') {
                        this.sourceConnId = null;
                        this.sourceDbType = null;
                        this.sourceDb = null;
                        this.sourceSchema = null;
                        if (labelEl) {
                            labelEl.textContent = '-- Nguồn --';
                            delete labelEl.dataset.origText;
                        }
                        this.renderConnectionDropdown('source');
                    } else {
                        this.targetConnId = null;
                        this.targetDbType = null;
                        this.targetDb = null;
                        this.targetSchema = null;
                        if (labelEl) {
                            labelEl.textContent = '-- Đích --';
                            delete labelEl.dataset.origText;
                        }
                        this.renderConnectionDropdown('target');
                    }
                    this.updateEngineBadge();
                }
            } catch (err) {
                console.error(`[SchemaCompare] onConnectionChanged error for ${which}:`, err);
                const connName = foundConn ? foundConn.name : actualId;
                this.showFloatingToast(`Lỗi kiểm tra kết nối [${connName}]: ${err.message}`, 'danger', 6000);
            } finally {
                this.setConnectionLoading(which, false);
                this.updateConnectionSubbarHint();
            }
        }

        async loadSchemas(which, connId, preferredDb, preferredSchema) {
            const foundConn = (this.connections || []).find(c => c.id === connId || c.name === connId);
            const connName = foundConn ? foundConn.name : connId;
            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.schema_compare_get_schemas === 'function') {
                    const res = await api.schema_compare_get_schemas(connId, preferredDb);
                    if (!res || !res.success) {
                        const errMsg = (res && res.error) ? res.error : 'Không thể kết nối tới cơ sở dữ liệu.';
                        console.error(`[SchemaCompare] Connection health check failed for ${which} (${connName}):`, errMsg);
                        this.showFloatingToast(`Không thể kết nối tới [${connName}]: ${errMsg}`, 'danger', 6000);
                        this.setCompareMsg('danger', `Lỗi kết nối [${connName}]: ${errMsg}`);
                        this.setKpiNoticeText('danger', `Không kết nối được: ${connName}`);
                        return false;
                    }

                    const dbs = res.databases || [];
                    const schemas = res.schemas || [];

                    if (which === 'source') {
                        this.sourceDatabases = dbs;
                        this.sourceSchemas = schemas;
                    } else {
                        this.targetDatabases = dbs;
                        this.targetSchemas = schemas;
                    }

                    // Default database: prioritize preferredDb if valid, then res.default_database, then foundConn.database, then res.current_database, then first db
                    let activeDb = null;
                    const defaultDbCandidate = preferredDb || res.default_database || (foundConn ? (foundConn.database || foundConn.default_database) : null) || res.current_database;
                    if (defaultDbCandidate && dbs.includes(defaultDbCandidate)) {
                        activeDb = defaultDbCandidate;
                    } else if (defaultDbCandidate) {
                        const matchedCase = dbs.find(d => d.toLowerCase() === String(defaultDbCandidate).toLowerCase());
                        activeDb = matchedCase || res.current_database || (dbs[0] || 'main');
                    } else {
                        activeDb = res.current_database || (dbs[0] || 'main');
                    }

                    if (which === 'source') this.sourceDb = activeDb;
                    else this.targetDb = activeDb;

                    // Default schema: prioritize preferredSchema, then foundConn declared schema, then res.default_schema, then dbo / public / first
                    const declaredSchema = preferredSchema || (foundConn ? (foundConn.schema || (foundConn.options && (foundConn.options.schema || foundConn.options.default_schema))) : null) || res.default_schema;

                    let activeSchema = null;
                    if (declaredSchema && schemas.includes(declaredSchema)) {
                        activeSchema = declaredSchema;
                    } else if (declaredSchema && schemas.some(s => s.toLowerCase() === declaredSchema.toLowerCase())) {
                        activeSchema = schemas.find(s => s.toLowerCase() === declaredSchema.toLowerCase());
                    } else if (schemas.includes('dbo')) {
                        activeSchema = 'dbo';
                    } else if (schemas.includes('public')) {
                        activeSchema = 'public';
                    } else {
                        activeSchema = schemas[0] || (res.db_type === 'postgresql' ? 'public' : 'dbo');
                    }

                    if (which === 'source') this.sourceSchema = activeSchema;
                    else this.targetSchema = activeSchema;

                    this.renderDatabaseDropdown(which);
                    this.renderSchemaDropdown(which);
                    return true;
                }
                return false;
            } catch (err) {
                console.error(`[SchemaCompare] Error loading schemas for ${which}:`, err);
                this.showFloatingToast(`Lỗi kiểm tra kết nối [${connName}]: ${err.message}`, 'danger', 6000);
                this.setCompareMsg('danger', `Lỗi kết nối [${connName}]: ${err.message}`);
                return false;
            }
        }

        onObjectTypeSelectionChanged(typeVal) {
            const typeNames = {
                'all': 'Tất cả các loại đối tượng',
                'tables': 'Bảng (Tables)',
                'views': 'Views',
                'procedures': 'Procedures (Thủ tục)',
                'functions': 'Functions (Hàm)',
                'triggers': 'Triggers'
            };
            const label = typeNames[typeVal] || typeVal;
            this.setCompareMsg('info', `Đã chọn: [${label}]. Vui lòng bấm nút "So sánh" để tiến hành.`);
        }

        getSelectedObjectTypes() {
            const sel = document.getElementById('scSelectObjType');
            const val = sel ? sel.value : 'all';
            if (!val || val === 'all') {
                return ['tables', 'views', 'procedures', 'functions', 'triggers'];
            }
            return [val];
        }

        async runCompare() {
            if (!this.sourceConnId) {
                this.setCompareMsg('danger', 'Vui lòng chọn kết nối Nguồn.');
                this.setKpiNoticeText('danger', 'Vui lòng chọn kết nối Nguồn.');
                return;
            }
            if (!this.targetConnId) {
                this.setCompareMsg('danger', 'Vui lòng chọn kết nối Đích.');
                this.setKpiNoticeText('danger', 'Vui lòng chọn kết nối Đích.');
                return;
            }

            if (this.sourceDbType && this.targetDbType && this.sourceDbType !== this.targetDbType) {
                const msg = `Hai kết nối khác loại CSDL (${formatEngineLabel(this.sourceDbType)} vs ${formatEngineLabel(this.targetDbType)}). Chỉ hỗ trợ so sánh cùng loại.`;
                this.setCompareMsg('danger', msg);
                this.setKpiNoticeText('danger', msg);
                return;
            }

            const objectTypes = this.getSelectedObjectTypes();
            if (objectTypes.length === 0) {
                this.setCompareMsg('warning', 'Vui lòng chọn ít nhất một loại đối tượng để so sánh!');
                this.setKpiNoticeText('warning', 'Vui lòng chọn ít nhất một loại đối tượng để so sánh!');
                return;
            }

            const btn = document.getElementById('scBtnRunCompare');
            const statusEl = document.getElementById('scStatusMessage');
            if (btn) btn.disabled = true;

            const typeNamesMap = {
                'tables': 'Bảng',
                'views': 'Views',
                'procedures': 'Procedures',
                'functions': 'Functions',
                'triggers': 'Triggers'
            };
            const selectedNames = objectTypes.map(t => typeNamesMap[t] || t).join(', ');

            this.showLoadingModal(`Đang trích xuất cấu trúc (${selectedNames}) và so sánh... Vui lòng chờ.`);
            this.setCompareMsg('info', 'Đang trích xuất cấu trúc và phân tích...');
            this.setKpiNoticeText('info', `Đang so sánh đối tượng: ${selectedNames}...`);
            if (statusEl) statusEl.textContent = 'Đang trích xuất snapshot và so sánh cấu trúc CSDL...';

            try {
                this._compareCancelled = false;
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (!api || typeof api.schema_compare_run !== 'function') {
                    throw new Error('API schema_compare_run không khả dụng.');
                }

                const res = await api.schema_compare_run(
                    this.sourceConnId,
                    this.sourceDb || 'main',
                    this.sourceSchema || 'dbo',
                    this.targetConnId,
                    this.targetDb || 'main',
                    this.targetSchema || 'dbo',
                    objectTypes
                );

                if (this._compareCancelled || (res && res.cancelled)) {
                    if (statusEl) statusEl.textContent = 'Tiến trình so sánh đã bị hủy.';
                    return;
                }

                if (!res.success) {
                    throw new Error(res.error || 'So sánh thất bại.');
                }

                this.diffData = res.diff;
                this.selectedTables.clear();

                (this.diffData.tables || []).forEach(t => {
                    if (t.status === 'different' || t.status === 'missing_in_target') {
                        this.selectedTables.add(t.table);
                    }
                });

                // Sync filter object type to what was actually compared
                const presentTypes = new Set((this.diffData.tables || []).map(t => (t.object_type || 'table').toLowerCase().replace(/s$/, '')));
                if (presentTypes.size === 1) {
                    this.filterObjectType = Array.from(presentTypes)[0];
                } else {
                    this.filterObjectType = 'all';
                }

                // Calculate object counts for dropdown menu badges
                const typeCounts = {
                    all: (this.diffData.tables || []).length,
                    table: 0,
                    view: 0,
                    procedure: 0,
                    function: 0,
                    trigger: 0
                };
                (this.diffData.tables || []).forEach(t => {
                    const normType = (t.object_type || 'table').toLowerCase().replace(/s$/, '');
                    if (typeCounts[normType] !== undefined) {
                        typeCounts[normType]++;
                    }
                });

                // Update counts on filter menu badges
                this.updateObjectTypeMenuCounts(typeCounts);

                // Update filter dropdown items visibility
                document.querySelectorAll('#scObjFilterMenu [data-obj-filter]').forEach(item => {
                    const filterVal = item.dataset.objFilter;
                    if (filterVal === 'all') {
                        item.closest('li')?.classList.remove('d-none');
                    } else {
                        const isPresent = presentTypes.has(filterVal);
                        item.closest('li')?.classList.toggle('d-none', !isPresent);
                    }
                });

                this.setObjectTypeFilter(this.filterObjectType);

                this.updateKPIs(res.summary);
                this.applyFilterAndRender();
                this.refreshScript();

                // Select first item if available to show diff immediately
                const firstDiff = (this.diffData.tables || []).find(t => t.status === 'different' || t.status === 'missing_in_target') || this.diffData.tables[0];
                if (firstDiff) {
                    this.onTableRowClick(firstDiff.table, firstDiff.object_type || 'table');
                }

                if (statusEl) {
                    statusEl.textContent = `So sánh hoàn tất. Tìm thấy ${res.summary.different_count || 0} đối tượng khác biệt, ${res.summary.missing_in_target_count || 0} đối tượng cần tạo mới.`;
                }
                const diffMsg = `So sánh hoàn tất! Tìm thấy ${res.summary.different_count || 0} khác biệt, ${res.summary.missing_in_target_count || 0} tạo mới.`;
                this.setCompareMsg('success', diffMsg);
                this.setKpiNoticeText('success', `Hoàn tất so sánh: ${res.summary.total_source_tables || 0} đối tượng (${selectedNames}).`);
            } catch (err) {
                if (this._compareCancelled) {
                    console.log('[SchemaCompare] Comparison was cancelled by user.');
                    return;
                }
                console.error('[SchemaCompare] Compare error:', err);
                if (statusEl) statusEl.textContent = `Lỗi: ${err.message}`;
                this.setCompareMsg('danger', `Lỗi so sánh: ${err.message}`);
                this.setKpiNoticeText('danger', `Lỗi: ${err.message}`);
            } finally {
                this.hideLoadingModal();
                if (btn) btn.disabled = false;
            }
        }

        setSubbarText(type, message) {
            this.setKpiNoticeText(type, message);
            this.setCompareMsg(type, message);
        }

        updateKPIs(summary) {
            summary = summary || {};
            const total = summary.total_source_tables || 0;
            const diff = summary.different_count || 0;
            const missing = summary.missing_in_target_count || 0;
            const extra = summary.extra_in_target_count || 0;
            const identical = summary.identical_count || 0;

            const elAll = document.getElementById('scCountAll');
            const elDiff = document.getElementById('scCountDifferent');
            const elMissing = document.getElementById('scCountMissing');
            const elExtra = document.getElementById('scCountExtra');
            const elIdentical = document.getElementById('scCountIdentical');

            if (elAll) elAll.textContent = `(${total})`;
            if (elDiff) elDiff.textContent = `(${diff})`;
            if (elMissing) elMissing.textContent = `(${missing})`;
            if (elExtra) elExtra.textContent = `(${extra})`;
            if (elIdentical) elIdentical.textContent = `(${identical})`;

            const elTotalOld = document.getElementById('scKpiTotal');
            if (elTotalOld) elTotalOld.textContent = total;
            const elDiffOld = document.getElementById('scKpiDiff');
            if (elDiffOld) elDiffOld.textContent = diff;
            const elMissingOld = document.getElementById('scKpiMissing');
            if (elMissingOld) elMissingOld.textContent = missing;
            const elExtraOld = document.getElementById('scKpiExtra');
            if (elExtraOld) elExtraOld.textContent = extra;
            const elIdenticalOld = document.getElementById('scKpiIdentical');
            if (elIdenticalOld) elIdenticalOld.textContent = identical;
        }

        applyFilterAndRender() {
            const listContainer = document.getElementById('scTableList');
            if (!listContainer) return;

            if (!this.diffData || !this.diffData.tables || this.diffData.tables.length === 0) {
                listContainer.innerHTML = `
                    <div class="sc-empty-state">
                        <i class="fa-solid fa-code-compare"></i>
                        <span>Không có dữ liệu so sánh</span>
                    </div>
                `;
                return;
            }

            const query = this.searchQuery;
            const filter = this.filterStatus;
            const objFilter = this.filterObjectType;

            const filtered = this.diffData.tables.filter(t => {
                const tName = (t.name || t.table || '').toLowerCase();
                if (query && !tName.includes(query)) return false;

                if (filter === 'different' && t.status !== 'different') return false;
                if (filter === 'missing' && t.status !== 'missing_in_target') return false;
                if (filter === 'extra' && t.status !== 'extra_in_target') return false;
                if (filter === 'identical' && t.status !== 'identical') return false;

                const itemObjType = String(t.object_type || 'table').toLowerCase().replace(/s$/, '');
                const targetFilter = String(objFilter || 'all').toLowerCase().replace(/s$/, '');
                if (targetFilter !== 'all' && itemObjType !== targetFilter) return false;

                return true;
            });

            if (filtered.length === 0) {
                listContainer.innerHTML = `
                    <div class="sc-empty-state">
                        <i class="fa-solid fa-filter"></i>
                        <span>Không có đối tượng nào khớp với bộ lọc hiện tại</span>
                    </div>
                `;
                return;
            }

            // Group definitions in logical display order
            const groupDefs = [
                { type: 'table', title: 'Bảng (Tables)', icon: 'fa-table text-primary', tag: 'TABLE', tagClass: 'sc-obj-tag-table' },
                { type: 'view', title: 'Views', icon: 'fa-eye text-warning', tag: 'VIEW', tagClass: 'sc-obj-tag-view' },
                { type: 'procedure', title: 'Stored Procedures', icon: 'fa-terminal text-info', tag: 'PROC', tagClass: 'sc-obj-tag-procedure' },
                { type: 'function', title: 'Functions', icon: 'fa-code text-success', tag: 'FUNC', tagClass: 'sc-obj-tag-function' },
                { type: 'trigger', title: 'Triggers', icon: 'fa-bolt text-danger', tag: 'TRIG', tagClass: 'sc-obj-tag-trigger' }
            ];

            // Bucket items into their groups
            const groupsMap = new Map();
            groupDefs.forEach(g => groupsMap.set(g.type, []));

            filtered.forEach(t => {
                let normType = String(t.object_type || 'table').toLowerCase().replace(/s$/, '');
                if (!groupsMap.has(normType)) {
                    normType = 'table';
                }
                groupsMap.get(normType).push(t);
            });

            let html = '';
            groupDefs.forEach(g => {
                const items = groupsMap.get(g.type) || [];
                if (items.length === 0) return; // Do not render empty groups

                const isCollapsed = this.collapsedGroups && this.collapsedGroups.has(g.type);
                const allSelected = items.length > 0 && items.every(it => this.selectedTables.has(it.table || it.name));
                const someSelected = items.some(it => this.selectedTables.has(it.table || it.name));

                html += `
                    <div class="sc-group-box ${isCollapsed ? 'collapsed' : ''}" data-group="${g.type}">
                        <div class="sc-group-header" data-group-header="${g.type}">
                            <i class="fa-solid fa-chevron-down sc-group-chevron"></i>
                            <input type="checkbox" class="sc-group-checkbox" data-group-check="${g.type}" 
                                ${allSelected ? 'checked' : ''} 
                                ${(!allSelected && someSelected) ? 'data-indeterminate="true"' : ''}
                                title="Chọn / Bỏ chọn nhóm ${g.title}">
                            <span class="sc-group-name"><i class="fa-solid ${g.icon} me-1"></i> ${g.title}</span>
                            <span class="sc-group-count">(${items.length})</span>
                        </div>
                        <div class="sc-group-items" data-group-items="${g.type}">
                `;

                items.forEach(t => {
                    const tname = t.table || t.name;
                    const isChecked = this.selectedTables.has(tname);
                    const objType = g.type;

                    let badgeClass = 'sc-badge-identical';
                    let badgeText = 'Trùng khớp';
                    if (t.status === 'missing_in_target') {
                        badgeClass = 'sc-badge-missing';
                        badgeText = '+ Tạo mới';
                    } else if (t.status === 'different') {
                        badgeClass = 'sc-badge-different';
                        badgeText = '~ Khác biệt';
                    } else if (t.status === 'extra_in_target') {
                        badgeClass = 'sc-badge-extra';
                        badgeText = '- Xóa';
                    }

                    const isActive = (this.activeTable === tname && (!this.activeObjType || this.activeObjType === objType));

                    html += `
                        <div class="sc-table-row ${isActive ? 'active' : ''}" data-table="${tname}" data-obj-type="${objType}" data-parent-group="${g.type}">
                            <div class="sc-table-main" data-table-click="${tname}" data-obj-type="${objType}">
                                <input type="checkbox" class="sc-table-checkbox" data-table="${tname}" data-group-type="${g.type}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation()">
                                <span class="sc-obj-tag ${g.tagClass}">${g.tag}</span>
                                <span class="sc-table-name" data-table-click="${tname}" data-obj-type="${objType}">${tname}</span>
                                <span class="sc-badge ${badgeClass}">${badgeText}</span>
                            </div>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            });

            listContainer.innerHTML = html;

            // Apply indeterminate state to group checkboxes
            listContainer.querySelectorAll('.sc-group-checkbox[data-indeterminate="true"]').forEach(cb => {
                cb.indeterminate = true;
            });

            this.updateSelectedCount();
            this.updateSelectAllCheckboxState();

            // Bind group header expand / collapse click
            listContainer.querySelectorAll('.sc-group-header').forEach(header => {
                header.addEventListener('click', (e) => {
                    if (e.target.closest('.sc-group-checkbox')) return;
                    const grpType = header.dataset.groupHeader;
                    const groupBox = header.closest('.sc-group-box');
                    if (!groupBox) return;
                    const isNowCollapsed = groupBox.classList.toggle('collapsed');
                    if (isNowCollapsed) {
                        this.collapsedGroups.add(grpType);
                    } else {
                        this.collapsedGroups.delete(grpType);
                    }
                });
            });

            // Bind group checkbox click
            listContainer.querySelectorAll('.sc-group-checkbox').forEach(gCb => {
                gCb.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                gCb.addEventListener('change', (e) => {
                    const grpType = e.target.dataset.groupCheck;
                    const checked = e.target.checked;
                    this.toggleGroupSelection(grpType, checked);
                });
            });

            // Bind item checkbox events
            listContainer.querySelectorAll('.sc-table-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const tbl = e.target.dataset.table;
                    const grpType = e.target.dataset.groupType;
                    this.toggleTableSelection(tbl, e.target.checked, grpType);
                });
            });

            // Bind click to view diff
            listContainer.querySelectorAll('[data-table-click]').forEach(el => {
                el.addEventListener('click', (e) => {
                    const tbl = e.currentTarget.dataset.tableClick;
                    const oType = e.currentTarget.dataset.objType || 'table';
                    this.onTableRowClick(tbl, oType);
                });
            });
        }

        onTableRowClick(tableName, objType) {
            this.activeTable = tableName;
            this.activeObjType = objType || null;
            document.querySelectorAll('.sc-table-row').forEach(row => {
                const matchName = row.dataset.table === tableName;
                const matchType = !objType || row.dataset.objType === objType;
                if (matchName && matchType) row.classList.add('active');
                else row.classList.remove('active');
            });

            this.showObjectDiff(tableName, objType);
        }

        showObjectDiff(tableName, objType) {
            const titleEl = document.getElementById('scDiffTargetTitle');
            if (!this.diffData) return;

            const normType = String(objType || 'table').toLowerCase().replace(/s$/, '');
            const t = (this.diffData.tables || []).find(x => 
                (x.table === tableName || x.name === tableName) && 
                (!objType || String(x.object_type || 'table').toLowerCase().replace(/s$/, '') === normType)
            );
            if (!t) return;

            const currentObjType = String(t.object_type || objType || 'table').toLowerCase().replace(/s$/, '');
            const statusVi = (t.status === 'missing_in_target') ? 'Chỉ có ở Nguồn (Cần tạo mới)' : ((t.status === 'extra_in_target') ? 'Chỉ có ở Đích (Cần xóa)' : ((t.status === 'different') ? 'Khác biệt' : 'Trùng khớp'));

            if (titleEl) {
                titleEl.innerHTML = `<i class="fa-solid fa-code-compare text-primary me-1"></i> [Đích / Target] ↔ [Nguồn / Source]: <strong>${tableName}</strong> (${currentObjType.toUpperCase()} — ${statusVi})`;
            }

            // Setup Diff Model side-by-side
            if (this.diffEditor && typeof monaco !== 'undefined') {
                let originalText = '';
                let modifiedText = '';

                if (currentObjType === 'table') {
                    // Table Object: Generate complete DDL comparison
                    if (t.target_definition || t.source_definition) {
                        originalText = t.target_definition || '-- [ĐÍCH / TARGET] Bảng chưa tồn tại trên CSDL Đích\n';
                        modifiedText = t.source_definition || '-- [NGUỒN / SOURCE] Bảng không tồn tại trên CSDL Nguồn\n';
                    } else {
                        originalText = t.status === 'missing_in_target'
                            ? '-- [ĐÍCH / TARGET] Bảng chưa tồn tại trên CSDL Đích\n'
                            : `-- [ĐÍCH / TARGET] Cấu trúc Bảng: ${tableName}\n-- Số cột: ${t.column_count_target || 0}\n`;

                        modifiedText = t.status === 'extra_in_target'
                            ? '-- [NGUỒN / SOURCE] Bảng không tồn tại trên CSDL Nguồn\n'
                            : `-- [NGUỒN / SOURCE] Cấu trúc Bảng: ${tableName}\n-- Số cột: ${t.column_count_source || 0}\n\n${t.migration_sql || ''}`;

                        if (t.columns_diff && t.columns_diff.length > 0) {
                            originalText += `\n-- ── TÓM TẮT THAY ĐỔI ──\n`;
                            t.columns_diff.forEach(c => {
                                if (c.action === 'modify') originalText += `~ SỬA: ${c.name} [Target Type: ${c.target_type || ''}]\n`;
                                else if (c.action === 'drop') originalText += `- XÓA: ${c.name} [Target Type: ${c.target_type || ''}]\n`;
                            });

                            modifiedText += `\n-- ── TÓM TẮT THAY ĐỔI ──\n`;
                            t.columns_diff.forEach(c => {
                                if (c.action === 'add') modifiedText += `+ THÊM: ${c.name} [Source Type: ${c.source_type || ''}]\n`;
                                else if (c.action === 'modify') modifiedText += `~ SỬA:  ${c.name} [Source Type: ${c.source_type || ''}]\n`;
                            });
                        }
                    }
                } else {
                    // Programmable Object (View, Procedure, Function, Trigger)
                    originalText = t.target_definition || '-- [ĐÍCH / TARGET] Đối tượng chưa tồn tại trên CSDL Đích\n';
                    modifiedText = t.source_definition || '-- [NGUỒN / SOURCE] Đối tượng không tồn tại trên CSDL Nguồn\n';
                }

                if (this._diffOriginalModel) this._diffOriginalModel.dispose();
                if (this._diffModifiedModel) this._diffModifiedModel.dispose();

                this._diffOriginalModel = monaco.editor.createModel(originalText, 'sql');
                this._diffModifiedModel = monaco.editor.createModel(modifiedText, 'sql');

                this.diffEditor.setModel({
                    original: this._diffOriginalModel,
                    modified: this._diffModifiedModel
                });

                setTimeout(() => {
                    this.diffEditor.layout();
                }, 40);
            }

            // If in script view mode, update single editor with migration SQL for this object
            if (this.scriptEditor && this.activeViewMode === 'script') {
                let singleSql = '';
                if (t.migration_sql && t.migration_sql.trim()) {
                    singleSql = t.migration_sql;
                } else if (t.status === 'identical') {
                    const ddl = t.source_definition || t.target_definition || '';
                    singleSql = `-- ==============================================================================\n` +
                                `-- ĐỐI TƯỢNG: [${currentObjType.toUpperCase()}] ${tableName} (TRÙNG KHỚP HOÀN TOÀN)\n` +
                                `-- Không có thay đổi nào giữa CSDL Đích và CSDL Nguồn.\n` +
                                `-- ==============================================================================\n\n` +
                                (ddl || `-- Cấu trúc Bảng gồm ${t.column_count_source || 0} cột.`);
                } else if (t.status === 'missing_in_target') {
                    singleSql = t.source_definition || t.migration_sql || `-- Tạo mới ${currentObjType}: ${tableName}`;
                } else if (t.status === 'extra_in_target') {
                    singleSql = t.migration_sql || `-- Xóa đối tượng chỉ có ở Đích: ${tableName}`;
                } else {
                    singleSql = t.source_definition || t.target_definition || t.migration_sql || '-- Không có migration script cho đối tượng này.';
                }
                this.scriptEditor.setValue(singleSql);
            }
        }

        toggleGroupSelection(groupType, isChecked) {
            if (!this.diffData || !this.diffData.tables) return;
            const items = this.diffData.tables.filter(t => {
                const normType = String(t.object_type || 'table').toLowerCase().replace(/s$/, '');
                return normType === groupType;
            });

            items.forEach(t => {
                const tname = t.table || t.name;
                if (t.status === 'identical') return;
                if (t.status === 'extra_in_target' && !this.includeDropTables && isChecked) return;
                if (isChecked) this.selectedTables.add(tname);
                else this.selectedTables.delete(tname);
            });

            this.applyFilterAndRender();
            this.refreshScript();
        }

        toggleTableSelection(tableName, isChecked, groupType) {
            if (isChecked) this.selectedTables.add(tableName);
            else this.selectedTables.delete(tableName);
            this.updateSelectedCount();
            this.updateGroupCheckboxState(groupType);
            this.updateSelectAllCheckboxState();
            this.refreshScript();
        }

        updateGroupCheckboxState(groupType) {
            if (!groupType) return;
            const gCb = document.querySelector(`.sc-group-checkbox[data-group-check="${groupType}"]`);
            if (!gCb) return;

            const itemCheckboxes = Array.from(document.querySelectorAll(`.sc-table-checkbox[data-group-type="${groupType}"]`));
            if (itemCheckboxes.length === 0) return;

            const checkedCount = itemCheckboxes.filter(c => c.checked).length;
            if (checkedCount === itemCheckboxes.length) {
                gCb.checked = true;
                gCb.indeterminate = false;
            } else if (checkedCount === 0) {
                gCb.checked = false;
                gCb.indeterminate = false;
            } else {
                gCb.checked = false;
                gCb.indeterminate = true;
            }
        }

        updateSelectAllCheckboxState() {
            const masterCb = document.getElementById('scSelectAllCheck');
            if (!masterCb) return;
            const allItemCheckboxes = Array.from(document.querySelectorAll('.sc-table-checkbox[data-table]'));
            if (allItemCheckboxes.length === 0) {
                masterCb.checked = false;
                masterCb.indeterminate = false;
                return;
            }
            const checkedCount = allItemCheckboxes.filter(c => c.checked).length;
            if (checkedCount === allItemCheckboxes.length) {
                masterCb.checked = true;
                masterCb.indeterminate = false;
            } else if (checkedCount === 0) {
                masterCb.checked = false;
                masterCb.indeterminate = false;
            } else {
                masterCb.checked = false;
                masterCb.indeterminate = true;
            }
        }

        selectAll(checked) {
            if (!this.diffData || !this.diffData.tables) return;
            this.diffData.tables.forEach(t => {
                const tname = t.table || t.name;
                if (t.status === 'identical') return;
                if (t.status === 'extra_in_target' && !this.includeDropTables && checked) return;
                if (checked) this.selectedTables.add(tname);
                else this.selectedTables.delete(tname);
            });
            this.applyFilterAndRender();
            this.refreshScript();
        }

        updateSelectedCount() {
            const el = document.getElementById('scSelectedCountText');
            if (el) el.textContent = `Đã chọn: ${this.selectedTables.size}`;
        }

        async refreshScript() {
            const alertEl = document.getElementById('scDestructiveWarning');
            if (!this.diffData) return;

            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.schema_compare_generate_script === 'function') {
                    const res = await api.schema_compare_generate_script(
                        this.diffData,
                        Array.from(this.selectedTables),
                        {
                            include_drop_tables: this.includeDropTables,
                            wrap_transaction: this.wrapTransaction
                        }
                    );

                    if (res && res.success) {
                        const sql = res.sql || '-- Không có câu lệnh nào';
                        if (this.scriptEditor) {
                            this.scriptEditor.setValue(sql);
                            setTimeout(() => this.scriptEditor.layout(), 40);
                        }
                        if (alertEl) {
                            if (res.has_destructive) alertEl.classList.remove('d-none');
                            else alertEl.classList.add('d-none');
                        }
                    }
                }
            } catch (err) {
                console.error('[SchemaCompare] Error refreshing script:', err);
            }
        }

        async copyActiveContent() {
            let sql = '';
            if (this.activeViewMode === 'script' && this.scriptEditor) {
                sql = this.scriptEditor.getValue();
            } else if (this.activeTable && this.diffData) {
                const t = (this.diffData.tables || []).find(x => x.table === this.activeTable);
                sql = (t && t.migration_sql) || (t && t.source_definition) || '';
            } else if (this.scriptEditor) {
                sql = this.scriptEditor.getValue();
            }

            if (!sql) return;

            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.set_clipboard_text === 'function') {
                    await api.set_clipboard_text(sql);
                } else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(sql);
                }
                this.setSubbarText('info', 'Đã sao chép nội dung vào bộ nhớ tạm (Clipboard).');
            } catch (err) {
                console.error('Copy error:', err);
            }
        }

        async openActiveInEditor() {
            let sql = '';
            if (this.activeViewMode === 'script' && this.scriptEditor) {
                sql = this.scriptEditor.getValue();
            } else if (this.activeTable && this.diffData) {
                const t = (this.diffData.tables || []).find(x => x.table === this.activeTable);
                sql = (t && t.migration_sql) || (t && t.source_definition) || '';
            } else if (this.scriptEditor) {
                sql = this.scriptEditor.getValue();
            }

            if (!sql) return;

            try {
                if (window.AppTabs && typeof window.AppTabs.createTab === 'function') {
                    window.AppTabs.createTab({
                        title: 'Migration Script',
                        content: sql,
                        connectionId: this.targetConnId,
                        database: this.targetDb,
                        schema: this.targetSchema
                    });
                    this.setSubbarText('info', 'Đã mở script trong Tab Query Editor mới.');
                }
            } catch (err) {
                console.error('Open in editor error:', err);
            }
        }

        /* ── Direct Connection Modal Logic ──────────────────────────────────── */
        openDirectConnectionModal(targetWhich) {
            this.directModalTarget = targetWhich;
            const backdrop = document.getElementById('scDirectModalBackdrop');
            const titleEl = document.getElementById('scDirectModalTitle');
            const noticeEl = document.getElementById('scDirectEngineNotice');
            const noticeTextEl = document.getElementById('scDirectEngineNoticeText');
            const dbTypeSelect = document.getElementById('scDirectDbType');
            const errorEl = document.getElementById('scDirectModalError');
            const dbSelect = document.getElementById('scDirectDbSelect');
            const saveCheck = document.getElementById('scDirectSaveConnCheck');
            const extraWrap = document.getElementById('scDirectSaveConnExtraWrap');
            const nameInput = document.getElementById('scDirectConnName');
            const groupInput = document.getElementById('scDirectGroup');
            const groupListEl = document.getElementById('scDirectGroupList');
            const envSelect = document.getElementById('scDirectEnv');
            const readOnlyCheck = document.getElementById('scDirectReadOnly');

            if (!backdrop || !dbTypeSelect) return;
            if (errorEl) errorEl.classList.add('d-none');

            // Reset direct DB select dropdown
            if (dbSelect) {
                dbSelect.innerHTML = '<option value="">-- Chọn Database (Bấm "Tải Database" để nạp) --</option>';
            }

            // Reset Save Connection check & extra fields
            if (saveCheck) saveCheck.checked = false;
            if (extraWrap) extraWrap.classList.add('d-none');
            if (nameInput) nameInput.value = '';
            if (groupInput) groupInput.value = 'Khách hàng';
            if (envSelect) envSelect.value = 'DEV';
            if (readOnlyCheck) readOnlyCheck.checked = false;

            // Populate group list datalist from existing connections
            if (groupListEl) {
                const groups = [...new Set((this.connections || []).map(c => c.group).filter(Boolean))];
                if (groups.length === 0) groups.push('Khách hàng', 'Local', 'Production');
                groupListEl.innerHTML = groups.map(g => `<option value="${g}">`).join('');
            }

            const label = targetWhich === 'source' ? 'Nguồn (Source)' : 'Đích (Target)';
            if (titleEl) {
                titleEl.innerHTML = `<i class="fa-solid fa-plus text-primary me-2"></i> Kết nối cơ sở dữ liệu — ${label}`;
            }

            if (targetWhich === 'target' && this.sourceDbType) {
                dbTypeSelect.value = this.sourceDbType;
                dbTypeSelect.disabled = true;
                if (noticeEl && noticeTextEl) {
                    noticeEl.classList.remove('d-none');
                    noticeTextEl.textContent = `Chỉ hỗ trợ so sánh cùng loại CSDL. Đã khóa loại CSDL theo Nguồn: ${formatEngineLabel(this.sourceDbType)}.`;
                }
            } else if (targetWhich === 'source' && this.targetDbType) {
                dbTypeSelect.value = this.targetDbType;
                dbTypeSelect.disabled = true;
                if (noticeEl && noticeTextEl) {
                    noticeEl.classList.remove('d-none');
                    noticeTextEl.textContent = `Chỉ hỗ trợ so sánh cùng loại CSDL. Đã khóa loại CSDL theo Đích: ${formatEngineLabel(this.targetDbType)}.`;
                }
            } else {
                dbTypeSelect.disabled = false;
                if (noticeEl) noticeEl.classList.add('d-none');
            }

            this.onDirectDbTypeChanged(dbTypeSelect.value);
            backdrop.classList.remove('d-none');
        }

        closeDirectConnectionModal() {
            const backdrop = document.getElementById('scDirectModalBackdrop');
            if (backdrop) backdrop.classList.add('d-none');
        }

        setDirectDbMode(isManual) {
            // Deprecated: manual DB input is removed in favor of direct DB list
        }

        onDirectDbTypeChanged(dbType) {
            const norm = normalizeEngineType(dbType);
            const serverFields = document.getElementById('scDirectServerFields');
            const sqliteFields = document.getElementById('scDirectSqliteFields');
            const trustedWrap = document.getElementById('scDirectTrustedWrap');
            const credsWrap = document.getElementById('scDirectCredsWrap');
            const portInput = document.getElementById('scDirectPort');
            const secGroup = document.getElementById('scDirectSecurityGroup');
            const encryptWrap = document.getElementById('scDirectEncryptWrap');
            const trustCertWrap = document.getElementById('scDirectTrustCertWrap');

            if (norm === 'sqlite') {
                if (serverFields) serverFields.classList.add('d-none');
                if (sqliteFields) sqliteFields.classList.remove('d-none');
                if (secGroup) secGroup.classList.add('d-none');
            } else {
                if (serverFields) serverFields.classList.remove('d-none');
                if (sqliteFields) sqliteFields.classList.add('d-none');
                if (secGroup) secGroup.classList.remove('d-none');

                if (norm === 'sqlserver') {
                    if (trustedWrap) trustedWrap.classList.remove('d-none');
                    if (portInput) portInput.placeholder = '1433';
                    if (encryptWrap) encryptWrap.classList.remove('d-none');
                    if (trustCertWrap) trustCertWrap.classList.remove('d-none');
                    const isTrusted = document.getElementById('scDirectTrustedCheck')?.checked;
                    if (credsWrap) {
                        if (isTrusted) credsWrap.classList.add('d-none');
                        else credsWrap.classList.remove('d-none');
                    }
                } else {
                    if (trustedWrap) trustedWrap.classList.add('d-none');
                    if (credsWrap) credsWrap.classList.remove('d-none');
                    if (portInput) portInput.placeholder = (norm === 'postgresql') ? '5432' : '3306';
                    if (encryptWrap) encryptWrap.classList.remove('d-none');
                    if (trustCertWrap) trustCertWrap.classList.add('d-none');
                }
            }
        }

        async fetchDirectDatabases() {
            const errorEl = document.getElementById('scDirectModalError');
            const errorTextEl = document.getElementById('scDirectModalErrorText');
            const btnFetch = document.getElementById('scBtnFetchDirectDbs');
            const dbSelect = document.getElementById('scDirectDbSelect');
            if (errorEl) errorEl.classList.add('d-none');

            const dbType = normalizeEngineType(document.getElementById('scDirectDbType')?.value);
            if (dbType === 'sqlite') return;

            const host = document.getElementById('scDirectHost')?.value.trim();
            if (!host) {
                if (errorEl && errorTextEl) {
                    errorEl.classList.remove('d-none');
                    errorTextEl.textContent = 'Vui lòng nhập Máy chủ (Host / Server) trước khi tải danh sách CSDL.';
                }
                return;
            }

            const isTrusted = (dbType === 'sqlserver') && Boolean(document.getElementById('scDirectTrustedCheck')?.checked);
            const user = document.getElementById('scDirectUser')?.value.trim();
            const pass = document.getElementById('scDirectPassword')?.value;

            if (!isTrusted && !user) {
                if (errorEl && errorTextEl) {
                    errorEl.classList.remove('d-none');
                    errorTextEl.textContent = 'Vui lòng nhập Tài khoản (Username) để kết nối tải danh sách CSDL.';
                }
                return;
            }

            const port = document.getElementById('scDirectPort')?.value.trim();
            const payload = {
                type: dbType,
                server: host,
                host: host,
                trusted_connection: isTrusted,
                username: isTrusted ? '' : user,
                password: isTrusted ? '' : pass,
                encrypt: Boolean(document.getElementById('scDirectEncrypt')?.checked),
                trust_server_certificate: Boolean(document.getElementById('scDirectTrustCert')?.checked)
            };
            if (port) payload.port = parseInt(port, 10);

            const origHtml = btnFetch ? btnFetch.innerHTML : '';
            if (btnFetch) {
                btnFetch.disabled = true;
                btnFetch.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang tải...';
            }

            try {
                let res = null;
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.fetch_connection_metadata === 'function') {
                    res = await api.fetch_connection_metadata(payload);
                } else {
                    const r = await fetch('/api/connections/fetch-metadata', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    res = await r.json();
                }

                if (!res || !res.success) {
                    throw new Error((res && res.error) || 'Không thể kết nối đến máy chủ hoặc không có quyền xem cơ sở dữ liệu.');
                }

                const dbs = Array.isArray(res.databases) ? res.databases : [];
                if (dbSelect) {
                    if (dbs.length === 0) {
                        dbSelect.innerHTML = '<option value="">(Không tìm thấy Database nào)</option>';
                    } else {
                        dbSelect.innerHTML = `<option value="">-- Chọn Database (${dbs.length} CSDL tìm thấy) --</option>` +
                            dbs.map(d => `<option value="${d}">${d}</option>`).join('');

                        const defaultDb = dbs.find(d => d.toLowerCase() === 'master' || d.toLowerCase() === 'postgres') || dbs[0];
                        if (defaultDb) dbSelect.value = defaultDb;
                    }
                }

                this.setDirectDbMode(false);
            } catch (err) {
                console.error('[SchemaCompare] fetchDirectDatabases error:', err);
                if (errorEl && errorTextEl) {
                    errorEl.classList.remove('d-none');
                    errorTextEl.textContent = 'Không thể tải danh sách Database: ' + (err.message || 'Lỗi không xác định');
                }
            } finally {
                if (btnFetch) {
                    btnFetch.disabled = false;
                    btnFetch.innerHTML = origHtml;
                }
            }
        }

        async browseSqliteFile() {
            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.show_open_file_dialog === 'function') {
                    const filePath = await api.show_open_file_dialog('Chọn tệp SQLite', [
                        { name: 'SQLite Databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
                        { name: 'All Files', extensions: ['*'] }
                    ]);
                    if (filePath) {
                        const pathInput = document.getElementById('scDirectSqlitePath');
                        if (pathInput) pathInput.value = filePath;
                    }
                }
            } catch (err) {
                console.error('Browse SQLite error:', err);
            }
        }

        async submitDirectConnection() {
            const errorEl = document.getElementById('scDirectModalError');
            const errorTextEl = document.getElementById('scDirectModalErrorText');
            const btnSubmit = document.getElementById('scBtnSubmitDirectModal');
            if (errorEl) errorEl.classList.add('d-none');

            const dbType = normalizeEngineType(document.getElementById('scDirectDbType')?.value);
            const cfg = { type: dbType };
            const isSaveToExplorer = Boolean(document.getElementById('scDirectSaveConnCheck')?.checked);
            let connName = '';
            let database = '';

            if (dbType === 'sqlite') {
                const path = document.getElementById('scDirectSqlitePath')?.value.trim();
                if (!path) {
                    if (errorEl && errorTextEl) {
                        errorEl.classList.remove('d-none');
                        errorTextEl.textContent = 'Vui lòng nhập hoặc chọn đường dẫn tệp SQLite.';
                    }
                    return;
                }
                cfg.database = path;
                const fileName = path.split(/[\\/]/).pop();
                database = fileName;
                const customName = document.getElementById('scDirectConnName')?.value.trim();
                connName = customName || `SQLite: ${fileName}`;
                cfg.name = connName;
            } else {
                const host = document.getElementById('scDirectHost')?.value.trim() || 'localhost';
                const port = document.getElementById('scDirectPort')?.value.trim();
                const selDb = document.getElementById('scDirectDbSelect')?.value;

                if (!selDb) {
                    if (errorEl && errorTextEl) {
                        errorEl.classList.remove('d-none');
                        errorTextEl.textContent = 'Vui lòng bấm "Tải Database" và chọn Cơ sở Dữ liệu từ danh sách.';
                    }
                    return;
                }

                database = selDb.trim();
                cfg.server = host;
                cfg.host = host;
                if (port) cfg.port = parseInt(port, 10);
                cfg.database = database;

                cfg.encrypt = Boolean(document.getElementById('scDirectEncrypt')?.checked);
                cfg.trust_server_certificate = Boolean(document.getElementById('scDirectTrustCert')?.checked);

                if (dbType === 'sqlserver') {
                    const trusted = document.getElementById('scDirectTrustedCheck')?.checked;
                    cfg.trusted_connection = !!trusted;
                    if (!trusted) {
                        cfg.username = document.getElementById('scDirectUser')?.value.trim() || 'sa';
                        cfg.password = document.getElementById('scDirectPassword')?.value || '';
                    }
                } else {
                    cfg.username = document.getElementById('scDirectUser')?.value.trim() || '';
                    cfg.password = document.getElementById('scDirectPassword')?.value || '';
                }

                const customName = document.getElementById('scDirectConnName')?.value.trim();
                connName = customName || `${host} - ${database}`;
                cfg.name = connName;
            }

            if (btnSubmit) btnSubmit.disabled = true;

            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);

                // If user checked "Lưu kết nối", persist profile to Object Explorer (connections.json)
                if (isSaveToExplorer) {
                    const groupName = document.getElementById('scDirectGroup')?.value.trim() || 'Khách hàng';
                    const envName = document.getElementById('scDirectEnv')?.value || 'DEV';
                    const isReadOnly = Boolean(document.getElementById('scDirectReadOnly')?.checked);

                    const profileToSave = {
                        ...cfg,
                        name: connName,
                        group: groupName,
                        environment: envName,
                        read_only: isReadOnly,
                        readOnly: isReadOnly
                    };

                    try {
                        if (window.AppExplorer && typeof window.AppExplorer.saveConnectionProfile === 'function') {
                            await window.AppExplorer.saveConnectionProfile(profileToSave);
                            const refreshBtn = document.getElementById('ide-btn-refresh-tree');
                            if (refreshBtn) refreshBtn.click();
                        } else if (window.AppStorage && typeof window.AppStorage.saveConnectionProfile === 'function') {
                            await window.AppStorage.saveConnectionProfile(profileToSave);
                        } else if (api && typeof api.save_connection_profile === 'function') {
                            await api.save_connection_profile(profileToSave);
                        }
                    } catch (saveErr) {
                        console.warn('[SchemaCompare] Failed to save connection profile to Object Explorer:', saveErr);
                    }
                }

                if (!api || typeof api.schema_compare_connect_direct !== 'function') {
                    throw new Error('API kết nối trực tiếp schema_compare_connect_direct không khả dụng.');
                }

                const res = await api.schema_compare_connect_direct(cfg);
                if (!res || !res.success) {
                    throw new Error(res.error || 'Kết nối thất bại.');
                }

                const newConn = {
                    ...res.connection,
                    name: connName || res.connection.name,
                    db_type: normalizeEngineType(res.connection.db_type || res.connection.type)
                };

                // Add or update connection list
                const existingIdx = this.connections.findIndex(c => c.id === newConn.id);
                if (existingIdx !== -1) {
                    this.connections[existingIdx] = newConn;
                } else {
                    this.connections.push(newConn);
                }

                this.populateConnectionSelects();

                // Select into target or source
                const which = this.directModalTarget;
                await this.onConnectionChanged(which, newConn.id, database || res.current_database, null);

                this.closeDirectConnectionModal();
                const notifyMsg = isSaveToExplorer
                    ? `Đã lưu kết nối vào Object Explorer và kết nối thành công: ${newConn.name}`
                    : `Đã kết nối thành công đến: ${newConn.name}`;
                this.setSubbarText('info', notifyMsg);
                if (typeof showToast === 'function') {
                    showToast(notifyMsg, 'success');
                }
            } catch (err) {
                console.error('[SchemaCompare] Connection error:', err);
                if (errorEl && errorTextEl) {
                    errorEl.classList.remove('d-none');
                    errorTextEl.textContent = err.message || 'Lỗi kết nối.';
                }
            } finally {
                if (btnSubmit) btnSubmit.disabled = false;
            }
        }

        async openPopoutWindow() {
            try {
                const api = await (window.waitForPywebview ? window.waitForPywebview() : null);
                if (api && typeof api.open_schema_compare_window === 'function') {
                    await api.open_schema_compare_window(
                        this.sourceConnId,
                        this.sourceDb,
                        this.sourceSchema,
                        this.targetConnId,
                        this.targetDb,
                        this.targetSchema
                    );
                }
            } catch (err) {
                console.error('[SchemaCompare] Pop-out error:', err);
            }
        }

        activateTab() {
            this.applyTypography();
            setTimeout(() => {
                this.layoutMonaco();
            }, 50);
        }
    }

    global.SchemaCompare = new SchemaCompareComponent();

})(typeof window !== 'undefined' ? window : this);
