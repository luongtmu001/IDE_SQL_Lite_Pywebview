/**
 * sql-style-editor.js - SQL Code Style Management & Formatter UI Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Section 3, 4, 5, 8, 9, 11, 13, 22-26 of .SKILL/format-code_general.md
 * and Section 4, 6 of .SKILL/format-code_viewstyle.md
 * 
 * 3-Layer Architecture:
 *   Style Code UI -> Style Configuration -> Formatter Engine -> Formatted SQL
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    class SqlStyleManager {
        constructor() {
            this.stylesData = {
                schemaVersion: 1,
                activeStyleId: 'default',
                styles: []
            };
            this.editingStyle = null;
            this.originalEditingStyleSnapshot = null;
            this.selectedCategoryId = 'whitespace';
            this.searchQuery = '';
            this.previewCurrentQuery = false;
            this.isDirty = false;
            this._previewDebounceTimer = null;
            this._bsModal = null;

            this.init();
        }

        async init() {
            await this.loadStyles();
            this.bindGlobalTriggers();
        }

        /**
         * Load styles from AppStorage (IPC / HTTP / localStorage)
         */
        async loadStyles() {
            try {
                if (window.AppStorage && typeof window.AppStorage.getCodeStyles === 'function') {
                    const data = await window.AppStorage.getCodeStyles();
                    if (data && Array.isArray(data.styles) && data.styles.length > 0) {
                        this.stylesData = data;
                    }
                }
            } catch (err) {
                console.warn('[SqlStyleManager] Load styles error:', err);
            }

            // Fallback if empty
            if (!this.stylesData.styles || this.stylesData.styles.length === 0) {
                const def = window.SqlFormatter ? window.SqlFormatter.getDefaultStyle() : null;
                if (def) {
                    this.stylesData = {
                        schemaVersion: 1,
                        activeStyleId: def.id,
                        styles: [def]
                    };
                }
            }

            // Sync active style to Formatter engine
            this.syncActiveStyleToEngine();
        }

        /**
         * Get the active style object
         */
        getActiveStyle() {
            const list = this.stylesData.styles || [];
            return list.find(s => s.id === this.stylesData.activeStyleId) || list[0] || null;
        }

        /**
         * Push active style to SqlFormatter engine
         */
        syncActiveStyleToEngine() {
            const active = this.getActiveStyle();
            if (active && window.SqlFormatter && typeof window.SqlFormatter.setActiveStyle === 'function') {
                window.SqlFormatter.setActiveStyle(active);
            }
        }

        /**
         * Bind keyboard shortcuts and menu triggers
         */
        bindGlobalTriggers() {
            // Menu item: Format -> SQL Code Styles...
            const menuBtn = document.getElementById('ide-menu-sql-style-manager');
            if (menuBtn) {
                menuBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.open();
                });
            }

            // Hotkey Ctrl+Shift+P (or alternative) to open Style Manager if desired
            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'f' || e.key === 'F')) {
                    e.preventDefault();
                    this.open();
                }
            });
        }

        /**
         * Open Style Editor Modal
         */
        async open() {
            await this.loadStyles();

            const active = this.getActiveStyle();
            this.editingStyle = active ? JSON.parse(JSON.stringify(active)) : null;
            this.originalEditingStyleSnapshot = active ? JSON.stringify(active) : '';
            this.isDirty = false;
            this.searchQuery = '';
            this.selectedCategoryId = 'whitespace';

            this.renderModal();
            this.renderCategoryList();
            this.renderOptionsPanel();
            this.updatePreviewImmediate();

            const modalEl = document.getElementById('ide-modal-code-style');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                this._bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
                this._bsModal.show();
            }
        }

        /**
         * Render modal container and attach top-level handlers
         */
        renderModal() {
            this.updateStyleSelectDropdown();
            this.updateHeaderBadges();
            this.bindModalEvents();
        }

        /**
         * Bind UI events in the modal dialog
         */
        bindModalEvents() {
            // Style Selector change
            const selEl = document.getElementById('sql-style-select');
            if (selEl) {
                selEl.onchange = () => {
                    const newId = selEl.value;
                    if (this.isDirty) {
                        this.showUnsavedPrompt(() => {
                            this.selectStyleById(newId);
                        }, () => {
                            selEl.value = this.editingStyle.id;
                        });
                    } else {
                        this.selectStyleById(newId);
                    }
                };
            }

            // Header Action Buttons
            const btnNew = document.getElementById('sql-style-btn-new');
            if (btnNew) btnNew.onclick = () => this.handleNewStyle();

            const btnDuplicate = document.getElementById('sql-style-btn-duplicate');
            if (btnDuplicate) btnDuplicate.onclick = () => this.handleDuplicateStyle();

            const btnSetDefault = document.getElementById('sql-style-btn-set-default');
            if (btnSetDefault) btnSetDefault.onclick = () => this.handleSetDefault();

            const btnExport = document.getElementById('sql-style-btn-export');
            if (btnExport) btnExport.onclick = () => this.handleExport();

            const btnImport = document.getElementById('sql-style-btn-import');
            if (btnImport) btnImport.onclick = () => this.handleImport();

            const btnDelete = document.getElementById('sql-style-btn-delete');
            if (btnDelete) btnDelete.onclick = () => this.handleDelete();

            // Search input
            const searchInput = document.getElementById('sql-style-search-input');
            const searchClear = document.getElementById('sql-style-search-clear');
            if (searchInput) {
                searchInput.value = this.searchQuery;
                searchInput.oninput = (e) => {
                    this.searchQuery = e.target.value.trim().toLowerCase();
                    if (searchClear) {
                        searchClear.style.display = this.searchQuery ? 'block' : 'none';
                    }
                    this.renderOptionsPanel();
                };
            }
            if (searchClear) {
                searchClear.onclick = () => {
                    if (searchInput) {
                        searchInput.value = '';
                        this.searchQuery = '';
                        searchClear.style.display = 'none';
                        this.renderOptionsPanel();
                    }
                };
            }

            // Preview mode toggle: Sample vs Current Query
            const togglePreviewQuery = document.getElementById('sql-style-preview-toggle');
            if (togglePreviewQuery) {
                togglePreviewQuery.checked = this.previewCurrentQuery;
                togglePreviewQuery.onchange = (e) => {
                    this.previewCurrentQuery = e.target.checked;
                    this.updatePreviewImmediate();
                };
            }

            // Copy SQL preview button
            const btnCopy = document.getElementById('sql-style-btn-copy-preview');
            if (btnCopy) {
                btnCopy.onclick = () => {
                    const codeEl = document.getElementById('sql-style-preview-code');
                    if (codeEl) {
                        const txt = codeEl.innerText || codeEl.textContent;
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(txt);
                        }
                        if (window.showToast) window.showToast('✓ Đã sao chép SQL', 'success');
                    }
                };
            }

            // Reset Category button
            const btnResetCat = document.getElementById('sql-style-btn-reset-category');
            if (btnResetCat) {
                btnResetCat.onclick = () => this.handleResetCategory();
            }

            // Reset Style button
            const btnResetStyle = document.getElementById('sql-style-btn-reset-style');
            if (btnResetStyle) {
                btnResetStyle.onclick = () => this.handleResetStyle();
            }

            // Footer Save button
            const btnSave = document.getElementById('sql-style-btn-save');
            if (btnSave) {
                btnSave.onclick = () => this.saveChanges();
            }

            // Footer / Close button
            const btnClose = document.getElementById('sql-style-btn-close');
            if (btnClose) {
                btnClose.onclick = () => this.handleClose();
            }

            // Resizer drag handler
            this.initSplitResizer();
        }

        /**
         * Initialize vertical split resizer between options and preview
         */
        initSplitResizer() {
            const resizer = document.getElementById('sql-style-split-resizer');
            const optionsPanel = document.querySelector('.sql-style-options-panel');
            const previewPanel = document.querySelector('.sql-style-preview-panel');
            if (!resizer || !optionsPanel || !previewPanel) return;

            let isDragging = false;
            let startY = 0;
            let startOptHeight = 0;

            const onMouseDown = (e) => {
                isDragging = true;
                startY = e.clientY;
                startOptHeight = optionsPanel.getBoundingClientRect().height;
                resizer.classList.add('dragging');
                document.body.style.userSelect = 'none';

                window.addEventListener('mousemove', onMouseMove);
                window.addEventListener('mouseup', onMouseUp);
            };

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const delta = e.clientY - startY;
                const newHeight = Math.max(120, Math.min(startOptHeight + delta, 600));
                optionsPanel.style.flex = `0 0 ${newHeight}px`;
            };

            const onMouseUp = () => {
                isDragging = false;
                resizer.classList.remove('dragging');
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            resizer.onmousedown = onMouseDown;
        }

        /**
         * Update Style dropdown options
         */
        updateStyleSelectDropdown() {
            const selEl = document.getElementById('sql-style-select');
            if (!selEl) return;

            selEl.innerHTML = '';
            (this.stylesData.styles || []).forEach(st => {
                const opt = document.createElement('option');
                opt.value = st.id;
                opt.textContent = `${st.name}${st.id === this.stylesData.activeStyleId ? ' ★ (Active)' : ''}`;
                if (this.editingStyle && st.id === this.editingStyle.id) {
                    opt.selected = true;
                }
                selEl.appendChild(opt);
            });
        }

        /**
         * Update tags, buttons and dirty indicators in header
         */
        updateHeaderBadges() {
            const tagEl = document.getElementById('sql-style-badge-tag');
            const dirtyEl = document.getElementById('sql-style-dirty-indicator');
            const btnDelete = document.getElementById('sql-style-btn-delete');
            const btnSetDef = document.getElementById('sql-style-btn-set-default');
            const statusEl = document.getElementById('sql-style-status-text');

            if (!this.editingStyle) return;

            const isSys = !!this.editingStyle.isSystem;
            const isAct = this.editingStyle.id === this.stylesData.activeStyleId;

            if (tagEl) {
                tagEl.textContent = isSys ? 'System' : 'User';
                tagEl.className = `sql-style-tag ${isSys ? 'sql-style-tag--system' : 'sql-style-tag--user'}`;
            }

            if (dirtyEl) {
                dirtyEl.className = `sql-style-dirty-indicator ${this.isDirty ? 'visible' : ''}`;
            }

            if (btnDelete) {
                btnDelete.disabled = isSys;
                btnDelete.title = isSys ? 'Không thể xóa Style mặc định của hệ thống' : 'Xóa Style này';
            }

            if (btnSetDef) {
                btnSetDef.disabled = isAct;
                btnSetDef.title = isAct ? 'Đây là Style đang được sử dụng' : 'Đặt làm Style mặc định';
            }

            if (statusEl) {
                statusEl.textContent = this.isDirty
                    ? '● Có thay đổi chưa lưu'
                    : (isAct ? '✓ Đang kích hoạt (Active)' : 'Đã lưu');
                statusEl.style.color = this.isDirty ? '#cca700' : 'var(--ide-text-muted, #858585)';
            }
        }

        /**
         * Switch editing style by ID
         */
        selectStyleById(styleId) {
            const found = (this.stylesData.styles || []).find(s => s.id === styleId);
            if (!found) return;

            this.editingStyle = JSON.parse(JSON.stringify(found));
            this.originalEditingStyleSnapshot = JSON.stringify(found);
            this.isDirty = false;

            this.updateStyleSelectDropdown();
            this.updateHeaderBadges();
            this.renderOptionsPanel();
            this.updatePreviewImmediate();
        }

        /**
         * Render left sidebar Category tree list
         */
        renderCategoryList() {
            const listEl = document.getElementById('sql-style-category-list');
            if (!listEl) return;

            listEl.innerHTML = '';
            const categories = window.SqlStyleMetadata?.CATEGORIES || [];

            // Group by 'group' property: GLOBAL, STATEMENTS, CLAUSES, EXPRESSIONS
            const groups = {};
            categories.forEach(cat => {
                if (!groups[cat.group]) {
                    groups[cat.group] = {
                        label: cat.groupLabel || cat.group,
                        items: []
                    };
                }
                groups[cat.group].items.push(cat);
            });

            Object.keys(groups).forEach(grpKey => {
                const grp = groups[grpKey];
                const headerLi = document.createElement('li');
                headerLi.className = 'sql-style-group-header';
                headerLi.textContent = grp.label;
                listEl.appendChild(headerLi);

                grp.items.forEach(cat => {
                    const itemLi = document.createElement('li');
                    itemLi.className = `sql-style-cat-item ${cat.id === this.selectedCategoryId ? 'active' : ''}`;
                    itemLi.innerHTML = `<i class="${cat.icon || 'fa-solid fa-gear'}"></i><span>${cat.name}</span>`;
                    itemLi.onclick = () => {
                        this.selectedCategoryId = cat.id;
                        document.querySelectorAll('.sql-style-cat-item').forEach(el => el.classList.remove('active'));
                        itemLi.classList.add('active');
                        this.renderOptionsPanel();
                        this.updatePreviewImmediate();
                    };
                    listEl.appendChild(itemLi);
                });
            });
        }

        /**
         * Get option value safely via dot notation (e.g. 'casing.keywords')
         */
        getOptionValue(path) {
            if (!this.editingStyle?.settings) return undefined;
            const parts = path.split('.');
            let curr = this.editingStyle.settings;
            for (const p of parts) {
                if (curr === undefined || curr === null) return undefined;
                curr = curr[p];
            }
            return curr;
        }

        /**
         * Set option value safely via dot notation
         */
        setOptionValue(path, value) {
            if (!this.editingStyle.settings) this.editingStyle.settings = {};
            const parts = path.split('.');
            let curr = this.editingStyle.settings;
            for (let i = 0; i < parts.length - 1; i++) {
                const p = parts[i];
                if (!curr[p] || typeof curr[p] !== 'object') {
                    curr[p] = {};
                }
                curr = curr[p];
            }
            curr[parts[parts.length - 1]] = value;
            this.markDirty();
        }

        /**
         * Mark style as dirty and update preview debounced
         */
        markDirty() {
            this.isDirty = true;
            this.updateHeaderBadges();
            this.evaluateAllDependencies();
            this.schedulePreviewUpdate();
        }

        /**
         * Render dynamic options panel based on active category or search query
         */
        renderOptionsPanel() {
            const container = document.getElementById('sql-style-options-container');
            const titleEl = document.getElementById('sql-style-cat-title');
            if (!container) return;

            container.innerHTML = '';
            const allOptions = window.SqlStyleMetadata?.OPTIONS || [];
            const categories = window.SqlStyleMetadata?.CATEGORIES || [];

            let filteredOptions = [];

            if (this.searchQuery) {
                // Search across option name, label, description, keywords, category (Section 5)
                const q = this.searchQuery;
                filteredOptions = allOptions.filter(opt => {
                    return (opt.id && opt.id.toLowerCase().includes(q)) ||
                        (opt.label && opt.label.toLowerCase().includes(q)) ||
                        (opt.description && opt.description.toLowerCase().includes(q)) ||
                        (opt.category && opt.category.toLowerCase().includes(q)) ||
                        (Array.isArray(opt.keywords) && opt.keywords.some(k => k.toLowerCase().includes(q)));
                });
                if (titleEl) {
                    titleEl.innerHTML = `<i class="fa-solid fa-magnifying-glass me-2"></i>Kết quả tìm kiếm cho "${this.searchQuery}" (${filteredOptions.length})`;
                }
            } else {
                // Category mode
                const catObj = categories.find(c => c.id === this.selectedCategoryId);
                if (titleEl) {
                    titleEl.innerHTML = `<i class="${catObj?.icon || 'fa-solid fa-sliders'} me-2"></i>${catObj?.name || 'Tùy chọn'}`;
                }
                filteredOptions = allOptions.filter(opt => opt.category === this.selectedCategoryId);
            }

            if (filteredOptions.length === 0) {
                container.innerHTML = `<div class="text-muted small p-3 text-center">Không tìm thấy tùy chọn nào phù hợp.</div>`;
                return;
            }

            filteredOptions.forEach(opt => {
                const row = this.renderSingleOptionRow(opt);
                container.appendChild(row);
            });

            this.evaluateAllDependencies();
        }

        /**
         * Render single option row with label, description, control and inline reset
         */
        renderSingleOptionRow(opt) {
            const row = document.createElement('div');
            row.className = 'sql-style-option-row';
            row.id = `sql-opt-row-${opt.id.replace(/\./g, '-')}`;

            // Left info
            const infoDiv = document.createElement('div');
            infoDiv.className = 'sql-style-option-info';

            const labelEl = document.createElement('div');
            labelEl.className = 'sql-style-option-label';
            labelEl.textContent = opt.label;
            infoDiv.appendChild(labelEl);

            if (opt.description) {
                const descEl = document.createElement('div');
                descEl.className = 'sql-style-option-desc';
                descEl.textContent = opt.description;
                infoDiv.appendChild(descEl);
            }
            row.appendChild(infoDiv);

            // Right control
            const ctrlDiv = document.createElement('div');
            ctrlDiv.className = 'sql-style-option-control';

            const val = this.getOptionValue(opt.id);
            const inputEl = this.createControlElement(opt, val !== undefined ? val : opt.default);
            ctrlDiv.appendChild(inputEl);

            // Inline reset button (Section 25)
            const resetBtn = document.createElement('button');
            resetBtn.className = 'sql-style-opt-reset-btn';
            resetBtn.title = 'Đặt lại tùy chọn này về mặc định';
            resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
            resetBtn.onclick = () => {
                this.setOptionValue(opt.id, opt.default);
                this.renderOptionsPanel();
                this.updatePreviewImmediate();
            };
            ctrlDiv.appendChild(resetBtn);

            row.appendChild(ctrlDiv);
            return row;
        }

        /**
         * Create input control according to metadata type (boolean, select, number, text, radio)
         */
        createControlElement(opt, currentVal) {
            const type = opt.type || 'select';

            if (type === 'boolean') {
                const labelWrap = document.createElement('label');
                labelWrap.className = 'sql-style-switch';

                const chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = !!currentVal;
                chk.id = `input-${opt.id.replace(/\./g, '-')}`;
                chk.onchange = (e) => {
                    this.setOptionValue(opt.id, e.target.checked);
                };

                const slider = document.createElement('span');
                slider.className = 'sql-style-switch-slider';

                labelWrap.appendChild(chk);
                labelWrap.appendChild(slider);
                return labelWrap;
            }

            if (type === 'select') {
                const sel = document.createElement('select');
                sel.className = 'sql-style-control-select';
                sel.id = `input-${opt.id.replace(/\./g, '-')}`;

                (opt.options || []).forEach(o => {
                    const oEl = document.createElement('option');
                    oEl.value = o.value;
                    oEl.textContent = o.label;
                    if (o.value === currentVal) oEl.selected = true;
                    sel.appendChild(oEl);
                });

                sel.onchange = (e) => {
                    this.setOptionValue(opt.id, e.target.value);
                };
                return sel;
            }

            if (type === 'number') {
                const num = document.createElement('input');
                num.type = 'number';
                num.className = 'sql-style-control-number';
                num.id = `input-${opt.id.replace(/\./g, '-')}`;
                if (opt.min !== undefined) num.min = opt.min;
                if (opt.max !== undefined) num.max = opt.max;
                num.value = currentVal;
                num.oninput = (e) => {
                    const parsed = parseInt(e.target.value, 10);
                    this.setOptionValue(opt.id, isNaN(parsed) ? opt.default : parsed);
                };
                return num;
            }

            if (type === 'radio') {
                const grp = document.createElement('div');
                grp.className = 'sql-style-control-radio-group';
                const name = `radio-${opt.id.replace(/\./g, '-')}`;

                (opt.options || []).forEach(o => {
                    const rLabel = document.createElement('label');
                    rLabel.className = 'sql-style-radio-label';

                    const rad = document.createElement('input');
                    rad.type = 'radio';
                    rad.name = name;
                    rad.value = o.value;
                    if (o.value === currentVal) rad.checked = true;
                    rad.onchange = () => {
                        this.setOptionValue(opt.id, o.value);
                    };

                    rLabel.appendChild(rad);
                    rLabel.appendChild(document.createTextNode(o.label));
                    grp.appendChild(rLabel);
                });
                return grp;
            }

            // Default fallback: text input
            const txt = document.createElement('input');
            txt.type = 'text';
            txt.className = 'sql-style-control-text';
            txt.id = `input-${opt.id.replace(/\./g, '-')}`;
            txt.value = currentVal || '';
            txt.oninput = (e) => {
                this.setOptionValue(opt.id, e.target.value);
            };
            return txt;
        }

        /**
         * Evaluate option dependencies in real time (Section 9)
         */
        evaluateAllDependencies() {
            const allOptions = window.SqlStyleMetadata?.OPTIONS || [];
            allOptions.forEach(opt => {
                if (!opt.dependencies) return;

                let isApplicable = true;
                const dep = opt.dependencies;

                if (dep.parentOptionId) {
                    const parentVal = this.getOptionValue(dep.parentOptionId);
                    if (dep.parentValue !== undefined && parentVal !== dep.parentValue) {
                        isApplicable = false;
                    }
                    if (dep.parentNotValue !== undefined && parentVal === dep.parentNotValue) {
                        isApplicable = false;
                    }
                }

                const rowEl = document.getElementById(`sql-opt-row-${opt.id.replace(/\./g, '-')}`);
                const inputEl = document.getElementById(`input-${opt.id.replace(/\./g, '-')}`);

                if (rowEl) {
                    if (isApplicable) {
                        rowEl.classList.remove('disabled');
                    } else {
                        rowEl.classList.add('disabled');
                    }
                }
                if (inputEl) {
                    inputEl.disabled = !isApplicable;
                }
            });
        }

        /**
         * 300ms Debounced SQL Preview update (Section 13, 28)
         */
        schedulePreviewUpdate() {
            if (this._previewDebounceTimer) {
                clearTimeout(this._previewDebounceTimer);
            }
            this._previewDebounceTimer = setTimeout(() => {
                this.updatePreviewImmediate();
            }, 300);
        }

        /**
         * Immediate SQL preview computation without database interaction (Section 12)
         */
        updatePreviewImmediate() {
            const codeEl = document.getElementById('sql-style-preview-code');
            const dbBadge = document.getElementById('sql-style-preview-db-badge');
            if (!codeEl) return;

            try {
                let sourceSql = '';

                if (this.previewCurrentQuery) {
                    // Read active text from Monaco editor safely without database interaction
                    let editorSql = '';
                    if (window.getActiveAppEditor && typeof window.getActiveAppEditor === 'function') {
                        const edWrap = window.getActiveAppEditor();
                        if (edWrap && edWrap.rawEditor && typeof edWrap.rawEditor.getValue === 'function') {
                            editorSql = edWrap.rawEditor.getValue();
                        }
                    } else if (window.monaco && typeof window.getEditorInstance === 'function') {
                        const ed = window.getEditorInstance();
                        if (ed && typeof ed.getValue === 'function') {
                            editorSql = ed.getValue();
                        }
                    }

                    if (editorSql && editorSql.trim()) {
                        sourceSql = editorSql;
                    } else {
                        codeEl.textContent = '-- [Xem trước]: Không có câu truy vấn SQL nào đang mở trong Editor.';
                        return;
                    }
                } else {
                    // Sample SQL matching category or general
                    const samples = window.SqlStyleMetadata?.SAMPLE_SQLS || {};
                    sourceSql = samples[this.selectedCategoryId] || samples.whitespace || 'SELECT 1;';
                }

                // Format with Formatter Engine using current editing style
                if (window.SqlFormatter && typeof window.SqlFormatter.format === 'function') {
                    const formatted = window.SqlFormatter.format(sourceSql, this.editingStyle);
                    codeEl.textContent = formatted;
                } else {
                    codeEl.textContent = sourceSql;
                }

                if (dbBadge && this.editingStyle) {
                    const db = this.editingStyle.database || 'all';
                    dbBadge.textContent = db === 'sqlserver' ? 'SQL Server' : (db === 'postgresql' ? 'PostgreSQL' : 'All Databases');
                }
            } catch (err) {
                console.warn('[SqlStyleManager] Preview format error:', err);
                codeEl.textContent = `-- Không thể định dạng mã xem trước: ${err.message}`;
            }
        }

        /**
         * Reset single category to system default values (Section 25)
         */
        handleResetCategory() {
            const allOptions = window.SqlStyleMetadata?.OPTIONS || [];
            const catOptions = allOptions.filter(o => o.category === this.selectedCategoryId);

            catOptions.forEach(opt => {
                this.setOptionValue(opt.id, opt.default);
            });

            this.renderOptionsPanel();
            this.updatePreviewImmediate();
            if (window.showToast) window.showToast('✓ Đã đặt lại các tùy chọn trong danh mục này', 'info');
        }

        /**
         * Reset entire style to default (Section 25)
         */
        handleResetStyle() {
            const confirmed = window.confirm(`Bạn có chắc muốn đặt lại toàn bộ cài đặt của Style "${this.editingStyle.name}" về mặc định ban đầu không?`);
            if (!confirmed) return;

            const def = window.SqlFormatter ? window.SqlFormatter.getDefaultStyle() : null;
            if (def && def.settings) {
                this.editingStyle.settings = JSON.parse(JSON.stringify(def.settings));
                this.markDirty();
                this.renderOptionsPanel();
                this.updatePreviewImmediate();
                if (window.showToast) window.showToast('✓ Đã đặt lại toàn bộ Style về mặc định', 'info');
            }
        }

        /**
         * Create a new custom user style (Section 22)
         */
        handleNewStyle() {
            const name = window.prompt('Nhập tên cho Style mới:', 'My Custom Style');
            if (!name || !name.trim()) return;

            const newId = `user-style-${Date.now()}`;
            const def = window.SqlFormatter ? window.SqlFormatter.getDefaultStyle() : null;
            const newStyle = {
                id: newId,
                name: name.trim(),
                isSystem: false,
                database: 'all',
                description: 'Style định dạng do người dùng tạo.',
                settings: def ? JSON.parse(JSON.stringify(def.settings)) : {}
            };

            this.stylesData.styles.push(newStyle);
            this.selectStyleById(newId);
            this.markDirty();
            if (window.showToast) window.showToast(`✓ Đã tạo Style mới: ${newStyle.name}`, 'success');
        }

        /**
         * Duplicate current style (Section 23)
         */
        handleDuplicateStyle() {
            if (!this.editingStyle) return;

            const copyName = `${this.editingStyle.name} Copy`;
            const newId = `user-style-${Date.now()}`;

            const duplicated = {
                ...JSON.parse(JSON.stringify(this.editingStyle)),
                id: newId,
                name: copyName,
                isSystem: false,
                description: `Bản sao từ ${this.editingStyle.name}`
            };

            this.stylesData.styles.push(duplicated);
            this.selectStyleById(newId);
            this.markDirty();
            if (window.showToast) window.showToast(`✓ Đã nhân bản thành: ${copyName}`, 'success');
        }

        /**
         * Delete current user style (Section 22)
         */
        handleDelete() {
            if (!this.editingStyle) return;
            if (this.editingStyle.isSystem) {
                if (window.showToast) window.showToast('Không thể xóa Style mặc định của hệ thống', 'warning');
                return;
            }

            const confirmed = window.confirm(`Bạn có chắc muốn xóa Style "${this.editingStyle.name}" không?`);
            if (!confirmed) return;

            const deletedId = this.editingStyle.id;
            this.stylesData.styles = this.stylesData.styles.filter(s => s.id !== deletedId);

            if (this.stylesData.activeStyleId === deletedId) {
                this.stylesData.activeStyleId = 'default';
            }

            this.selectStyleById(this.stylesData.activeStyleId);
            this.saveChanges();
            if (window.showToast) window.showToast('✓ Đã xóa Style thành công', 'success');
        }

        /**
         * Set current editing style as active/default style (Section 22)
         */
        handleSetDefault() {
            if (!this.editingStyle) return;

            this.stylesData.activeStyleId = this.editingStyle.id;
            this.syncActiveStyleToEngine();
            this.updateStyleSelectDropdown();
            this.updateHeaderBadges();
            this.saveChanges();
            if (window.showToast) window.showToast(`✓ Đã đặt "${this.editingStyle.name}" làm Style mặc định`, 'success');
        }

        /**
         * Export current style to JSON file (Section 24)
         */
        handleExport() {
            if (!this.editingStyle) return;

            const exportObj = {
                schemaVersion: 1,
                exportedAt: new Date().toISOString(),
                style: this.editingStyle
            };

            const jsonStr = JSON.stringify(exportObj, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.editingStyle.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}.sqlstyle.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (window.showToast) window.showToast('✓ Đã xuất cấu hình Style ra file', 'success');
        }

        /**
         * Import style from JSON file (Section 24)
         */
        handleImport() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.sqlstyle.json';

            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (re) => {
                    try {
                        const parsed = JSON.parse(re.target.result);
                        const styleObj = parsed.style || parsed;

                        if (!styleObj || !styleObj.name || !styleObj.settings) {
                            throw new Error('Định dạng file Style không hợp lệ');
                        }

                        // Generate unique ID and resolve duplicate names
                        let newName = styleObj.name;
                        let counter = 1;
                        while (this.stylesData.styles.some(s => s.name === newName)) {
                            newName = `${styleObj.name} (${counter++})`;
                        }

                        const importedStyle = {
                            id: `user-style-${Date.now()}`,
                            name: newName,
                            isSystem: false,
                            database: styleObj.database || 'all',
                            description: styleObj.description || 'Imported style',
                            settings: styleObj.settings
                        };

                        this.stylesData.styles.push(importedStyle);
                        this.selectStyleById(importedStyle.id);
                        this.saveChanges();
                        if (window.showToast) window.showToast(`✓ Đã nhập thành công Style: ${newName}`, 'success');
                    } catch (err) {
                        alert(`Lỗi khi nhập Style: ${err.message}`);
                    }
                };
                reader.readAsText(file);
            };

            input.click();
        }

        /**
         * Save all changes to user data storage (Section 20, 26)
         */
        async saveChanges() {
            if (this.editingStyle) {
                // Update in list
                const idx = this.stylesData.styles.findIndex(s => s.id === this.editingStyle.id);
                if (idx >= 0) {
                    this.stylesData.styles[idx] = JSON.parse(JSON.stringify(this.editingStyle));
                } else {
                    this.stylesData.styles.push(JSON.parse(JSON.stringify(this.editingStyle)));
                }
            }

            // Save via AppStorage
            try {
                if (window.AppStorage && typeof window.AppStorage.saveCodeStyles === 'function') {
                    await window.AppStorage.saveCodeStyles(this.stylesData);
                }
            } catch (err) {
                console.warn('[SqlStyleManager] Save error:', err);
            }

            this.originalEditingStyleSnapshot = JSON.stringify(this.editingStyle);
            this.isDirty = false;
            this.syncActiveStyleToEngine();
            this.updateHeaderBadges();

            if (window.showToast) window.showToast('✓ Đã lưu cài đặt SQL Code Style', 'success');
        }

        /**
         * Close handler with unsaved changes verification (Section 26)
         */
        handleClose() {
            if (this.isDirty) {
                this.showUnsavedPrompt(() => {
                    this._bsModal?.hide();
                });
            } else {
                this._bsModal?.hide();
            }
        }

        /**
         * Prompt modal for unsaved changes: [Save] [Discard] [Cancel] (Section 26)
         */
        showUnsavedPrompt(onDiscard, onCancel) {
            const confirmed = window.confirm('Bạn có thay đổi chưa lưu trong Style hiện tại.\n\nNhấn OK để bỏ qua thay đổi (Discard), hoặc Cancel để ở lại tiếp tục chỉnh sửa.');
            if (confirmed) {
                this.isDirty = false;
                if (typeof onDiscard === 'function') onDiscard();
            } else {
                if (typeof onCancel === 'function') onCancel();
            }
        }
    }

    // Attach to global window
    window.SqlStyleManager = new SqlStyleManager();

})(typeof window !== 'undefined' ? window : globalThis);
