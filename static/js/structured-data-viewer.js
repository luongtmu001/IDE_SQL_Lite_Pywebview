/**
 * structured-data-viewer.js
 * Structured Data Viewer for XML, JSON, and extensible structured formats.
 * Provides:
 *  1. StructuredDataDetector: Fast O(1) detection at render time, deep validation on demand.
 *  2. StructuredDataViewer: Quick Viewer side panel controller and Monaco Editor tab integration.
 */

(function (window) {
    'use strict';

    // ── XML Formatting Helper ────────────────────────────────────────────────
    function formatXml(xmlStr) {
        if (!xmlStr || typeof xmlStr !== 'string') return '';
        try {
            let formatted = '';
            let indent = '';
            const tab = '  ';
            // Strip inter-tag whitespace
            const cleanXml = xmlStr.replace(/>\s*</g, '><').trim();
            const regex = /(<[!\?]?\/?[^>]+>|[^<]+)/g;
            let match;

            while ((match = regex.exec(cleanXml)) !== null) {
                const node = match[0].trim();
                if (!node) continue;

                if (node.startsWith('</')) {
                    // Closing tag: reduce indent
                    indent = indent.slice(tab.length);
                    formatted += indent + node + '\r\n';
                } else if (node.startsWith('<?') || node.startsWith('<!')) {
                    // Declaration, doctype, or comment
                    formatted += indent + node + '\r\n';
                } else if (node.startsWith('<') && node.endsWith('/>')) {
                    // Self-closing tag
                    formatted += indent + node + '\r\n';
                } else if (node.startsWith('<')) {
                    // Opening tag
                    formatted += indent + node + '\r\n';
                    indent += tab;
                } else {
                    // Text content inside tag
                    formatted = formatted.trimEnd() + node + '\r\n';
                }
            }
            return formatted.trimEnd() || xmlStr;
        } catch (_) {
            return xmlStr;
        }
    }

    // ── 1. Structured Data Detector ──────────────────────────────────────────
    const StructuredDataDetector = {
        /**
         * Fast O(1) candidate format detection for grid rendering.
         * Avoids parsing entire document on large result sets (10k rows).
         * @param {*} val - Cell value
         * @param {string} [colName] - Column name / alias
         * @param {object} [colMeta] - Database metadata (type, data_type)
         * @returns {'json' | 'xml' | null}
         */
        detectCandidate: function (val, colName, colMeta) {
            if (val === null || val === undefined) return null;

            // Handle already parsed object / array
            if (typeof val === 'object') {
                return 'json';
            }

            if (typeof val !== 'string') return null;

            // Fast length check
            const len = val.length;
            if (len < 2) return null;

            // Trim leading/trailing whitespace efficiently
            let start = 0;
            while (start < len && val.charCodeAt(start) <= 32) start++;
            let end = len - 1;
            while (end > start && val.charCodeAt(end) <= 32) end--;

            if (end <= start) return null;

            const firstChar = val[start];
            const lastChar = val[end];

            // JSON Candidate check: {...} or [...]
            if ((firstChar === '{' && lastChar === '}') || (firstChar === '[' && lastChar === ']')) {
                return 'json';
            }

            // XML Candidate check: <...>
            if (firstChar === '<' && lastChar === '>') {
                const subStart = val.slice(start, Math.min(start + 15, end + 1));
                if (/^<\s*[a-zA-Z_?!/]/i.test(subStart)) {
                    return 'xml';
                }
            }

            // Metadata / Column name hints
            const cn = (colName || '').toLowerCase();
            const ct = (colMeta && (colMeta.type || colMeta.data_type || colMeta.dataType)
                ? String(colMeta.type || colMeta.data_type || colMeta.dataType)
                : '').toLowerCase();

            if (cn.includes('json') || ct === 'json' || ct === 'jsonb') {
                if (firstChar === '{' || firstChar === '[') return 'json';
            }

            if (cn.includes('xml') || ct === 'xml') {
                if (firstChar === '<') return 'xml';
            }

            return null;
        },

        /**
         * Deep syntax validation on demand.
         * @param {*} val
         * @param {'json' | 'xml'} format
         * @returns {{ valid: boolean, error?: string, parsed?: any }}
         */
        validate: function (val, format) {
            if (val === null || val === undefined) {
                return { valid: false, error: 'Giá trị rỗng (NULL)' };
            }

            if (format === 'json') {
                if (typeof val === 'object') {
                    return { valid: true, parsed: val };
                }
                if (typeof val !== 'string') {
                    return { valid: false, error: 'Dữ liệu không phải là chuỗi JSON' };
                }
                try {
                    const parsed = JSON.parse(val);
                    return { valid: true, parsed: parsed };
                } catch (e) {
                    return { valid: false, error: e.message || 'Cú pháp JSON không hợp lệ' };
                }
            }

            if (format === 'xml') {
                const sVal = String(val);
                if (typeof DOMParser !== 'undefined') {
                    try {
                        const parser = new DOMParser();
                        let doc = parser.parseFromString(sVal, 'application/xml');
                        let parserErrors = doc.getElementsByTagName('parsererror');
                        if (parserErrors && parserErrors.length > 0) {
                            const errText = parserErrors[0].textContent.trim();
                            // Support XML fragments without root tag by attempting wrapped parse
                            if (/extra content|multiple root/i.test(errText)) {
                                const wrappedDoc = parser.parseFromString(`<__root__>${sVal}</__root__>`, 'application/xml');
                                const wrappedErrors = wrappedDoc.getElementsByTagName('parsererror');
                                if (!wrappedErrors || wrappedErrors.length === 0) {
                                    return { valid: true, doc: wrappedDoc };
                                }
                            }
                            return { valid: false, error: errText || 'Cú pháp XML không hợp lệ' };
                        }
                        return { valid: true, doc: doc };
                    } catch (e) {
                        return { valid: false, error: e.message || 'Cú pháp XML không hợp lệ' };
                    }
                }
                return { valid: true };
            }

            return { valid: true };
        },

        /**
         * Pretty format structured data.
         * @param {*} val
         * @param {'json' | 'xml'} format
         * @returns {string}
         */
        format: function (val, format) {
            if (val === null || val === undefined) return '';

            if (format === 'json') {
                if (typeof val === 'object') {
                    return JSON.stringify(val, null, 2);
                }
                try {
                    const parsed = JSON.parse(String(val));
                    return JSON.stringify(parsed, null, 2);
                } catch (_) {
                    return String(val);
                }
            }

            if (format === 'xml') {
                return formatXml(String(val));
            }

            return String(val);
        },

        getMonacoLanguage: function (format) {
            if (format === 'json') return 'json';
            if (format === 'xml') return 'xml';
            return 'plaintext';
        }
    };

    // ── 2. Structured Data Viewer Controller ──────────────────────────────────
    const StructuredDataViewer = {
        panelEl: null,
        resizerEl: null,
        editorContainerEl: null,
        titleEl: null,
        infoEl: null,
        formatBtn: null,
        wrapBtn: null,
        copyBtn: null,
        openTabBtn: null,
        closeBtn: null,

        editor: null,
        currentData: null,
        isOpen: false,
        isDragging: false,
        isWordWrap: false,
        panelWidthPx: 0,

        init: function () {
            this.panelEl = document.getElementById('ide-structured-viewer-panel');
            this.resizerEl = document.getElementById('ide-structured-viewer-resizer');
            this.editorContainerEl = document.getElementById('ide-structured-viewer-editor-container');
            this.titleEl = document.getElementById('ide-structured-viewer-title');
            this.infoEl = document.getElementById('ide-structured-viewer-info');
            this.formatBtn = document.getElementById('ide-btn-structured-format');
            this.wrapBtn = document.getElementById('ide-btn-structured-wrap');
            this.copyBtn = document.getElementById('ide-btn-structured-copy');
            this.openTabBtn = document.getElementById('ide-btn-structured-open-tab');
            this.closeBtn = document.getElementById('ide-btn-structured-close');

            if (!this.panelEl) {
                const container = document.getElementById('ide-results-grid-view') || document.getElementById('ide-results-table-wrap')?.parentElement;
                if (container) {
                    const temp = document.createElement('div');
                    temp.innerHTML = `
                        <div id="ide-structured-viewer-resizer" class="ide-structured-resizer d-none" title="Kéo để thay đổi độ rộng Quick Viewer"></div>
                        <div id="ide-structured-viewer-panel" class="ide-structured-viewer-panel d-none flex-column h-100">
                            <div class="ide-structured-viewer-header d-flex align-items-center justify-content-between px-2 py-1">
                                <div class="ide-structured-viewer-meta d-flex flex-column overflow-hidden me-2">
                                    <span class="ide-structured-viewer-title fw-bold text-truncate" id="ide-structured-viewer-title">XML / JSON Viewer</span>
                                    <small class="ide-structured-viewer-sub text-muted text-truncate" id="ide-structured-viewer-info">Source: col | Row: 1</small>
                                </div>
                                <div class="ide-structured-viewer-actions d-flex align-items-center gap-1 flex-shrink-0">
                                    <button type="button" class="btn btn-xs btn-outline-secondary" id="ide-btn-structured-format" title="Format code (JSON/XML)"><i class="fa-solid fa-align-left me-1"></i>Format</button>
                                    <button type="button" class="btn btn-xs btn-outline-secondary" id="ide-btn-structured-wrap" title="Bật/Tắt tự động xuống dòng (Word Wrap)"><i class="fa-solid fa-text-width me-1"></i>Wrap</button>
                                    <button type="button" class="btn btn-xs btn-outline-secondary" id="ide-btn-structured-copy" title="Copy content to Clipboard"><i class="fa-solid fa-copy me-1"></i>Copy</button>
                                    <button type="button" class="btn btn-xs btn-outline-secondary" id="ide-btn-structured-open-tab" title="Mở trong tab Editor mới (Open in Tab)"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>Open in Tab</button>
                                    <button type="button" class="btn btn-xs btn-outline-secondary ide-btn-structured-close" id="ide-btn-structured-close" title="Đóng panel xem nhanh">&times;</button>
                                </div>
                            </div>
                            <div id="ide-structured-viewer-editor-container" class="flex-grow-1 position-relative overflow-hidden w-100"></div>
                        </div>
                    `;
                    while (temp.firstChild) {
                        container.appendChild(temp.firstChild);
                    }
                    this.panelEl = document.getElementById('ide-structured-viewer-panel');
                    this.resizerEl = document.getElementById('ide-structured-viewer-resizer');
                    this.editorContainerEl = document.getElementById('ide-structured-viewer-editor-container');
                    this.titleEl = document.getElementById('ide-structured-viewer-title');
                    this.infoEl = document.getElementById('ide-structured-viewer-info');
                    this.formatBtn = document.getElementById('ide-btn-structured-format');
                    this.wrapBtn = document.getElementById('ide-btn-structured-wrap');
                    this.copyBtn = document.getElementById('ide-btn-structured-copy');
                    this.openTabBtn = document.getElementById('ide-btn-structured-open-tab');
                    this.closeBtn = document.getElementById('ide-btn-structured-close');
                }
            }

            if (!this.panelEl) return;

            // Bind Actions
            if (this.closeBtn) {
                this.closeBtn.addEventListener('click', () => this.closeQuickView());
            }
            if (this.formatBtn) {
                this.formatBtn.addEventListener('click', () => this.formatCurrentContent());
            }
            if (this.wrapBtn) {
                this.wrapBtn.addEventListener('click', () => this.toggleWordWrap());
            }
            if (this.copyBtn) {
                this.copyBtn.addEventListener('click', () => this.copyCurrentContent());
            }
            if (this.openTabBtn) {
                this.openTabBtn.addEventListener('click', () => {
                    if (this.currentData) {
                        this.openInNewTab(this.currentData);
                    }
                });
            }

            // Bind Splitter Resizing
            this.bindResizer();

            // Listen for global theme changes to sync Quick Viewer Monaco theme
            window.addEventListener('ide-theme-changed', (e) => {
                if (this.editor && typeof monaco !== 'undefined' && monaco.editor) {
                    const curTheme = (e && e.detail && e.detail.monacoTheme) || 'ide-dark';
                    monaco.editor.setTheme(curTheme);
                }
            });

            // Listen for window resize
            window.addEventListener('resize', () => {
                if (this.isOpen && this.editor) {
                    this.editor.layout();
                }
            });
        },

        bindResizer: function () {
            if (!this.resizerEl) return;

            let startX = 0;
            let startWidth = 0;

            const onPointerMove = (e) => {
                if (!this.isDragging) return;
                const parent = this.panelEl.parentElement;
                if (!parent) return;

                const parentRect = parent.getBoundingClientRect();
                const totalWidth = parentRect.width;
                const deltaX = startX - e.clientX;
                let newWidth = startWidth + deltaX;

                // Constraints: min 240px, max 80% of parent container
                const minWidth = 240;
                const maxWidth = Math.max(minWidth, totalWidth * 0.8);
                newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

                this.panelWidthPx = newWidth;
                this.panelEl.style.width = `${newWidth}px`;

                if (this.editor) {
                    this.editor.layout();
                }
            };

            const onPointerUp = () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                this.resizerEl.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);

                this.refreshGridLayout();
            };

            this.resizerEl.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                this.isDragging = true;
                startX = e.clientX;
                startWidth = this.panelEl.getBoundingClientRect().width;
                this.resizerEl.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                window.addEventListener('pointermove', onPointerMove);
                window.addEventListener('pointerup', onPointerUp);
            });
        },

        ensureEditor: function (initialContent, language) {
            if (typeof monaco === 'undefined' || !monaco.editor || !this.editorContainerEl) {
                return null;
            }

            if (!this.editor) {
                const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
                const themeName = (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function')
                    ? window.MonacoInit.getMonacoTheme(curTheme)
                    : ((curTheme === 'light' || curTheme.includes('light')) ? 'ide-light' : 'ide-dark');

                this.editor = monaco.editor.create(this.editorContainerEl, {
                    value: initialContent || '',
                    language: language || 'plaintext',
                    theme: themeName,
                    readOnly: false,
                    automaticLayout: true,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: this.isWordWrap ? 'on' : 'off',
                    wrappingIndent: 'indent',
                    scrollbar: {
                        vertical: 'visible',
                        horizontal: 'auto',
                        verticalScrollbarSize: 10,
                        horizontalScrollbarSize: 10,
                        arrowSize: 11,
                        useShadows: true,
                        verticalHasPageProvider: true,
                        horizontalHasPageProvider: true,
                        alwaysConsumeMouseWheel: true
                    },
                    smoothScrolling: true,
                    mouseWheelScrollSensitivity: 1,
                    lineNumbers: 'on',
                    renderWhitespace: 'none',
                    folding: true
                });

                this.editor.onDidChangeModelContent(() => {
                    this.validateEditorContent();
                });
            } else {
                const model = this.editor.getModel();
                if (model) {
                    if (model.getValue() !== initialContent) {
                        model.setValue(initialContent || '');
                    }
                    if (monaco.editor.setModelLanguage) {
                        monaco.editor.setModelLanguage(model, language || 'plaintext');
                    }
                }
            }

            return this.editor;
        },

        refreshGridLayout: function () {
            // Trigger AG Grid / Virtual Grid layout recalculation
            setTimeout(() => {
                if (window.GridResultManager && typeof window.GridResultManager.getAllInstances === 'function') {
                    const instances = window.GridResultManager.getAllInstances();
                    instances.forEach(inst => {
                        if (inst && typeof inst.refreshLayout === 'function') {
                            inst.refreshLayout();
                        }
                    });
                }
            }, 30);
        },

        _lastOpenTabTime: 0,
        _lastOpenTabKey: '',

        /**
         * Generates unique tab file name: [LoaiFile](Stt).[ext], e.g. xmlresult(2).xml, jsonresult(1).json
         * @param {'json'|'xml'|string} format
         * @returns {string}
         */
        getNextFileName: function (format) {
            const ext = (format || 'json').toLowerCase();
            const prefix = ext === 'xml' ? 'xmlresult' : (ext === 'json' ? 'jsonresult' : `${ext}result`);
            let nextIdx = 1;
            const existingTitles = [];
            if (window.AppTabs && typeof window.AppTabs.getAllTabs === 'function') {
                const all = window.AppTabs.getAllTabs();
                if (Array.isArray(all)) {
                    all.forEach(t => { if (t && t.title) existingTitles.push(t.title); });
                }
            } else if (window.TabsManager && typeof window.TabsManager.getAllTabs === 'function') {
                const all = window.TabsManager.getAllTabs();
                if (Array.isArray(all)) {
                    all.forEach(t => { if (t && t.title) existingTitles.push(t.title); });
                }
            }
            while (existingTitles.includes(`${prefix}(${nextIdx}).${ext}`)) {
                nextIdx++;
            }
            return `${prefix}(${nextIdx}).${ext}`;
        },

        /**
         * Opens the Quick Viewer panel on the right side of the Result Grid.
         * @param {{ value: any, colName: string, rowIndex: number, format: 'json'|'xml' }} cellData
         */
        openQuickView: function (cellData) {
            if (!this.panelEl) this.init();
            if (!this.panelEl || !cellData) return;

            const format = cellData.format || StructuredDataDetector.detectCandidate(cellData.value, cellData.colName) || 'json';
            const rawValue = (cellData.value === null || cellData.value === undefined) ? '' : String(cellData.value);

            // TC12: Validate format on demand and alert if invalid
            const valResult = StructuredDataDetector.validate(rawValue, format);
            if (!valResult.valid) {
                const errMsg = `[Định dạng ${format.toUpperCase()} không hợp lệ]: ${valResult.error}`;
                if (typeof window.notify === 'function') {
                    window.notify(errMsg, 'warning');
                } else if (typeof window.showToast === 'function') {
                    window.showToast(errMsg, 'warning');
                }
            }

            this.currentData = {
                value: rawValue,
                originalValue: rawValue,
                formattedValue: null,
                colName: cellData.colName || 'Data',
                rowIndex: cellData.rowIndex !== undefined ? cellData.rowIndex : 0,
                format: format
            };

            // Set Header Information
            if (this.titleEl) {
                this.titleEl.textContent = `${format.toUpperCase()} Viewer`;
            }
            if (this.infoEl) {
                this.infoEl.textContent = `Source: ${this.currentData.colName} | Row: ${this.currentData.rowIndex + 1}`;
            }

            // Ensure Result Grid view is active if switched to Messages/Plan
            if (typeof window.switchResultView === 'function') {
                window.switchResultView('results-grid');
            }

            // Show Panel and Resizer
            this.panelEl.classList.remove('d-none');
            if (this.resizerEl) this.resizerEl.classList.remove('d-none');
            this.isOpen = true;

            // Mount or update Monaco Editor
            const lang = StructuredDataDetector.getMonacoLanguage(format);
            this.ensureEditor(rawValue, lang);

            // Auto format if syntax is valid
            if (valResult.valid) {
                setTimeout(() => {
                    if (this.editor && this.isOpen) {
                        const formatted = StructuredDataDetector.format(rawValue, format);
                        this.currentData.formattedValue = formatted;
                        this.editor.setValue(formatted);
                        this.validateEditorContent();
                    }
                }, 10);
            } else {
                setTimeout(() => {
                    if (this.editor && this.isOpen) {
                        this.validateEditorContent();
                    }
                }, 10);
            }

            // Adjust layout
            setTimeout(() => {
                if (this.editor) this.editor.layout();
                this.refreshGridLayout();
            }, 50);
        },

        /**
         * Closes the Quick Viewer panel and restores Result Grid width.
         */
        closeQuickView: function () {
            if (!this.panelEl) return;
            this.panelEl.classList.add('d-none');
            if (this.resizerEl) this.resizerEl.classList.add('d-none');
            this.isOpen = false;
            this.refreshGridLayout();
        },

        /**
         * Opens the structured data in a new Monaco Editor tab.
         * @param {{ value: any, colName: string, rowIndex: number, format: 'json'|'xml' }} cellData
         */
        openInNewTab: function (cellData) {
            if (!cellData) return;

            const now = Date.now();
            const callKey = `${cellData.colName || ''}_${cellData.rowIndex ?? ''}_${cellData.format || ''}`;
            if (now - this._lastOpenTabTime < 450 && this._lastOpenTabKey === callKey) {
                return;
            }
            this._lastOpenTabTime = now;
            this._lastOpenTabKey = callKey;

            const format = cellData.format || StructuredDataDetector.detectCandidate(cellData.value, cellData.colName) || 'json';
            const rawValue = (cellData.value === null || cellData.value === undefined) ? '' : (typeof cellData.value === 'object' ? JSON.stringify(cellData.value) : String(cellData.value));

            // TC12: Validate format on demand and alert if invalid
            const valResult = StructuredDataDetector.validate(rawValue, format);
            if (!valResult.valid) {
                const errMsg = `[Cảnh báo cú pháp ${format.toUpperCase()}]: ${valResult.error}`;
                if (typeof window.notify === 'function') {
                    window.notify(errMsg, 'warning');
                } else if (typeof window.showToast === 'function') {
                    window.showToast(errMsg, 'warning');
                }
            }

            // Auto format content so it is properly pretty-printed with indentation
            const formattedContent = StructuredDataDetector.format(rawValue, format);
            const tabTitle = this.getNextFileName(format);

            const tabsMgr = window.AppTabs || window.TabsManager || window.tabManager;
            const createFn = (window.AppTabs && window.AppTabs.createTab) || (tabsMgr && (tabsMgr.createTab || tabsMgr.addTab)) || window.createTab;

            if (typeof createFn === 'function') {
                createFn({
                    tabType: 'structured-data',
                    title: tabTitle,
                    content: formattedContent,
                    language: format,
                    structuredFormat: format,
                    originalValue: rawValue,
                    icon: format === 'xml' ? 'fa-file-code' : 'fa-code',
                    isTextEditor: true,
                    isResultPanelHidden: true
                });
            } else {
                console.error('[StructuredDataViewer] Tab manager (AppTabs/createTab) not available.');
            }
        },

        /**
         * Formats the content currently in the Quick Viewer editor.
         */
        formatCurrentContent: function () {
            if (!this.editor || !this.currentData) return;
            const currentVal = this.editor.getValue();
            const format = this.currentData.format || 'json';

            const valResult = StructuredDataDetector.validate(currentVal, format);
            if (!valResult.valid) {
                const errMsg = `Không thể Format: ${valResult.error}`;
                if (typeof window.notify === 'function') {
                    window.notify(errMsg, 'warning');
                } else if (typeof window.showToast === 'function') {
                    window.showToast(errMsg, 'warning');
                }
                return;
            }

            const formatted = StructuredDataDetector.format(currentVal, format);
            this.currentData.formattedValue = formatted;
            this.editor.setValue(formatted);

            if (typeof window.notify === 'function') {
                window.notify(`Đã định dạng dữ liệu ${format.toUpperCase()}`, 'success');
            }
        },

        /**
         * Toggles Word Wrap (soft wrapping) on/off for smooth scrolling and long line inspection.
         */
        toggleWordWrap: function () {
            this.isWordWrap = !this.isWordWrap;
            if (this.editor) {
                this.editor.updateOptions({
                    wordWrap: this.isWordWrap ? 'on' : 'off'
                });
            }
            if (this.wrapBtn) {
                if (this.isWordWrap) {
                    this.wrapBtn.classList.add('active');
                    this.wrapBtn.title = 'Tắt tự động xuống dòng (Word Wrap: ON)';
                } else {
                    this.wrapBtn.classList.remove('active');
                    this.wrapBtn.title = 'Bật tự động xuống dòng (Word Wrap: OFF)';
                }
            }
        },

        /**
         * Real-time syntax validation for content inside Quick Viewer Monaco editor.
         */
        validateEditorContent: function () {
            if (!this.editor || !this.currentData) return;
            const model = this.editor.getModel();
            if (!model) return;
            const format = this.currentData.format || 'json';

            const checker = window.StructuredSyntaxChecker;
            if (checker && typeof checker.validateModel === 'function') {
                checker.validateModel(model, format);
            } else if (window.SqlSyntaxCheckService) {
                if (format === 'xml' && typeof window.SqlSyntaxCheckService.checkXmlSyntax === 'function') {
                    window.SqlSyntaxCheckService.checkXmlSyntax(model, model.getValue());
                } else if (format === 'json' && typeof window.SqlSyntaxCheckService.checkJsonSyntax === 'function') {
                    window.SqlSyntaxCheckService.checkJsonSyntax(model, model.getValue());
                }
            }
        },

        /**
         * Copies the current content of the Quick Viewer editor to clipboard.
         */
        copyCurrentContent: function () {
            if (!this.editor) return;
            const text = this.editor.getValue();
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(text);
            } else if (typeof window.copyText === 'function') {
                window.copyText(text);
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
            }
            if (typeof window.notify === 'function') {
                window.notify('Đã sao chép nội dung vào Clipboard', 'success');
            }
        },

        /**
         * Resets state when a new query is executed or results cleared (TC10).
         */
        onQueryExecuted: function () {
            if (this.isOpen) {
                this.closeQuickView();
            }
            this.currentData = null;
        }
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => StructuredDataViewer.init());
    } else {
        StructuredDataViewer.init();
    }

    // Expose globals
    window.StructuredDataDetector = StructuredDataDetector;
    window.StructuredDataViewer = StructuredDataViewer;

})(typeof window !== 'undefined' ? window : this);
