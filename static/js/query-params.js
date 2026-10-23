/**
 * query-params.js - Script Parameters Parser and Modal (Sprint 2 - Bước 2.2 F7)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects {{param}} placeholders and -- @param name: type = default declarations.
 * Smart Type Inference: auto-detects date, number, boolean, identifier.
 * Parameter Sets (Presets): save, switch, and delete named parameter configurations.
 * Prompts user with a theme-synchronized modal before execution.
 * Caches previous values per tab and in LocalStorage presets.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    const PRESET_STORAGE_KEY = 'ide_query_param_presets';

    class QueryParamsManager {
        constructor() {
            this.modalEl = null;
            this.keyHandler = null;
        }

        /**
         * Auto-infer parameter type based on common parameter naming patterns.
         * @param {string} name 
         * @returns {string} 'string' | 'number' | 'date' | 'boolean' | 'identifier'
         */
        inferParamType(name) {
            if (!name) return 'string';
            const n = String(name).trim().toLowerCase();

            if (n.includes('date') || n.includes('time') || n.endsWith('_at') || n.startsWith('dt_') || n.includes('day')) {
                return 'date';
            }
            if (n.includes('id') || n.includes('count') || n.includes('num') || n.includes('price') ||
                n.includes('amount') || n.includes('qty') || n.includes('quantity') || n.includes('year') ||
                n.includes('month') || n.includes('limit') || n.includes('offset') || n.includes('total') || n.includes('age')) {
                return 'number';
            }
            if (n.startsWith('is_') || n.startsWith('has_') || n.includes('flag') || n.includes('active') || n.includes('enable')) {
                return 'boolean';
            }
            if (n.startsWith('tbl_') || n.includes('table') || n.includes('col_') || n.includes('_col') || n.includes('schema') || n.includes('database')) {
                return 'identifier';
            }
            return 'string';
        }

        /**
         * Extract parameter declarations and placeholders from SQL client-side.
         * @param {string} sql 
         * @param {string} dialect 
         * @returns {Array<Object>} list of { name, type, default, line }
         */
        extractParameters(sql, dialect = 'sqlserver') {
            if (!sql || typeof sql !== 'string' || !sql.includes('{{')) {
                return [];
            }

            const isPg = String(dialect || '').toLowerCase().includes('postgr');
            const decls = {};

            // 1. Parse header comments: -- @param name: type = default
            const declRegex = /^\s*--\s*@param\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z]+)(?:\s*=\s*(.*?))?\s*$/gm;
            let m;
            while ((m = declRegex.exec(sql)) !== null) {
                const name = m[1].trim();
                let pType = m[2].trim().toLowerCase();
                let defVal = m[3] ? m[3].trim() : '';
                if ((defVal.startsWith("'") && defVal.endsWith("'")) || (defVal.startsWith('"') && defVal.endsWith('"'))) {
                    defVal = defVal.slice(1, -1);
                }
                if (!['string', 'number', 'identifier', 'date', 'boolean'].includes(pType)) {
                    pType = this.inferParamType(name);
                }
                decls[name] = { name, type: pType, default: defVal };
            }

            // 2. Tokenize to find {{name}} placeholders outside comments & strings
            const placeholders = [];
            const seen = new Set();
            const len = sql.length;
            let i = 0;
            let line = 1;

            while (i < len) {
                const ch = sql[i];
                const nextCh = i + 1 < len ? sql[i + 1] : '';

                if (ch === '\n') {
                    line++;
                    i++;
                    continue;
                }

                // Single line comment
                if (ch === '-' && nextCh === '-') {
                    i += 2;
                    while (i < len && sql[i] !== '\n') i++;
                    continue;
                }

                // Multi line comment
                if (ch === '/' && nextCh === '*') {
                    i += 2;
                    while (i < len - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) {
                        if (sql[i] === '\n') line++;
                        i++;
                    }
                    if (i < len - 1) i += 2; else i = len;
                    continue;
                }

                // String literal
                if (ch === "'" || ((ch === 'N' || ch === 'n') && nextCh === "'")) {
                    if (ch === 'N' || ch === 'n') i++;
                    i++;
                    while (i < len) {
                        if (sql[i] === '\n') line++;
                        if (sql[i] === "'") {
                            if (i + 1 < len && sql[i + 1] === "'") {
                                i += 2;
                                continue;
                            } else {
                                i++;
                                break;
                            }
                        }
                        i++;
                    }
                    continue;
                }

                // Dollar-quoted string in PostgreSQL: $$ or $tag$
                if (isPg && ch === '$') {
                    const tagMatch = sql.substring(i).match(/^\$([a-zA-Z0-9_]*)\$/);
                    if (tagMatch) {
                        const tag = tagMatch[0];
                        const closeIdx = sql.indexOf(tag, i + tag.length);
                        if (closeIdx !== -1) {
                            const inner = sql.substring(i, closeIdx + tag.length);
                            line += (inner.match(/\n/g) || []).length;
                            i = closeIdx + tag.length;
                            continue;
                        }
                    }
                }

                // Quoted identifiers
                if (ch === '"' || (!isPg && ch === '[')) {
                    const closeChar = ch === '[' ? ']' : '"';
                    i++;
                    while (i < len && sql[i] !== closeChar) {
                        if (sql[i] === '\n') line++;
                        i++;
                    }
                    if (i < len) i++;
                    continue;
                }

                // Check placeholder {{name}}
                if (ch === '{' && nextCh === '{') {
                    const phMatch = sql.substring(i).match(/^\{\{([a-zA-Z0-9_]+)\}\}/);
                    if (phMatch) {
                        const pName = phMatch[1];
                        if (!seen.has(pName)) {
                            seen.add(pName);
                            const d = decls[pName] || {};
                            const finalType = d.type || this.inferParamType(pName);
                            placeholders.push({
                                name: pName,
                                type: finalType,
                                default: d.default || '',
                                line: line
                            });
                        }
                        i += phMatch[0].length;
                        continue;
                    }
                }

                i++;
            }

            return placeholders;
        }

        /**
         * Load parameter preset configurations from localStorage.
         */
        getPresets() {
            try {
                const raw = localStorage.getItem(PRESET_STORAGE_KEY);
                return raw ? JSON.parse(raw) : {};
            } catch (_) {
                return {};
            }
        }

        /**
         * Save a parameter preset by name.
         */
        savePreset(name, values) {
            if (!name) return false;
            try {
                const presets = this.getPresets();
                presets[name] = values;
                localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
                return true;
            } catch (_) {
                return false;
            }
        }

        /**
         * Delete a parameter preset by name.
         */
        deletePreset(name) {
            if (!name) return false;
            try {
                const presets = this.getPresets();
                if (presets[name]) {
                    delete presets[name];
                    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
                    return true;
                }
            } catch (_) {}
            return false;
        }

        /**
         * Show modal dialog asking user to input parameter values.
         * @param {Array<Object>} parameters 
         * @param {Object} options { tabId, cachedValues, onConfirm, onCancel }
         */
        showParameterModal(parameters, options = {}) {
            const {
                tabId = '',
                cachedValues = {},
                onConfirm = null,
                onCancel = null
            } = options;

            if (!parameters || parameters.length === 0) {
                if (typeof onConfirm === 'function') onConfirm({});
                return;
            }

            this.hideParameterModal();

            this.modalEl = document.createElement('div');
            this.modalEl.id = 'ide-query-params-dialog';
            this.modalEl.className = 'ide-query-params-dialog';

            let fieldsHtml = '';
            parameters.forEach((param, idx) => {
                const currentVal = (cachedValues[param.name] !== undefined)
                    ? cachedValues[param.name]
                    : (param.default || '');

                let typeBadgeClass = 'bg-secondary';
                let iconClass = 'fa-font';
                let inputHtml = '';

                if (param.type === 'number') {
                    typeBadgeClass = 'bg-info text-dark';
                    iconClass = 'fa-hashtag';
                    inputHtml = `
                        <input type="number" step="any"
                               id="ide-param-input-${param.name}"
                               class="form-control form-control-sm ide-param-input ide-query-params-input"
                               data-param-name="${param.name}"
                               data-param-type="${param.type}"
                               value="${String(currentVal).replace(/"/g, '&quot;')}"
                               placeholder="Ví dụ: 123 hoặc 45.67"
                               ${idx === 0 ? 'autofocus' : ''} />
                    `;
                } else if (param.type === 'identifier') {
                    typeBadgeClass = 'bg-warning text-dark';
                    iconClass = 'fa-database';
                    inputHtml = `
                        <input type="text"
                               id="ide-param-input-${param.name}"
                               class="form-control form-control-sm ide-param-input ide-query-params-input font-monospace text-warning"
                               data-param-name="${param.name}"
                               data-param-type="${param.type}"
                               value="${String(currentVal).replace(/"/g, '&quot;')}"
                               placeholder="Tên bảng / cột / object..."
                               ${idx === 0 ? 'autofocus' : ''} />
                    `;
                } else if (param.type === 'date') {
                    typeBadgeClass = 'bg-success text-light';
                    iconClass = 'fa-calendar-days';
                    inputHtml = `
                        <input type="text"
                               id="ide-param-input-${param.name}"
                               class="form-control form-control-sm ide-param-input ide-query-params-input"
                               data-param-name="${param.name}"
                               data-param-type="${param.type}"
                               value="${String(currentVal).replace(/"/g, '&quot;')}"
                               placeholder="YYYY-MM-DD hoặc YYYY-MM-DD HH:MM:SS"
                               ${idx === 0 ? 'autofocus' : ''} />
                    `;
                } else if (param.type === 'boolean') {
                    typeBadgeClass = 'bg-primary text-light';
                    iconClass = 'fa-toggle-on';
                    const isChecked = ['1', 'true', 't', 'yes', 'y'].includes(String(currentVal).toLowerCase());
                    inputHtml = `
                        <select id="ide-param-input-${param.name}"
                                class="form-select form-select-sm ide-param-input ide-query-params-input"
                                data-param-name="${param.name}"
                                data-param-type="${param.type}">
                            <option value="1" ${isChecked ? 'selected' : ''}>true / 1 (Bật / Đúng)</option>
                            <option value="0" ${!isChecked ? 'selected' : ''}>false / 0 (Tắt / Sai)</option>
                        </select>
                    `;
                } else {
                    inputHtml = `
                        <input type="text"
                               id="ide-param-input-${param.name}"
                               class="form-control form-control-sm ide-param-input ide-query-params-input"
                               data-param-name="${param.name}"
                               data-param-type="${param.type}"
                               value="${String(currentVal).replace(/"/g, '&quot;')}"
                               placeholder="Nhập chuỗi ký tự..."
                               ${idx === 0 ? 'autofocus' : ''} />
                    `;
                }

                fieldsHtml += `
                    <div class="mb-3 ide-param-row" data-param-name="${param.name}">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <label class="form-label mb-0 fw-bold font-monospace text-truncate" style="font-size: 13px; color: var(--ide-text-active, #ffffff);" for="ide-param-input-${param.name}">
                                <i class="fa-solid ${iconClass} me-1 text-primary"></i>{{${param.name}}}
                            </label>
                            <span class="badge ${typeBadgeClass} font-monospace" style="font-size: 10px; text-transform: uppercase;">
                                ${param.type}
                            </span>
                        </div>
                        ${inputHtml}
                    </div>
                `;
            });

            // Presets dropdown options
            const presets = this.getPresets();
            let presetOptions = `<option value="">-- Chọn Preset cấu hình tham số --</option>`;
            Object.keys(presets).forEach(pName => {
                presetOptions += `<option value="${pName.replace(/"/g, '&quot;')}">${pName}</option>`;
            });

            this.modalEl.innerHTML = `
                <div class="ide-query-params-card shadow-lg" style="width: 540px; max-width: 95vw;">
                    <div class="ide-query-params-header d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-sliders text-warning fs-5"></i>
                            <span class="fw-bold" style="font-size: 14px; letter-spacing: 0.3px;">THAM SỐ TRUY VẤN (QUERY PARAMETERS)</span>
                        </div>
                        <button type="button" class="btn-close btn-sm" id="ideParamCloseBtn" aria-label="Close"></button>
                    </div>

                    <div class="ide-query-params-body">
                        <!-- Parameter Presets Bar -->
                        <div class="d-flex align-items-center justify-content-between mb-3 p-2 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid var(--ide-border, #454545);">
                            <div class="d-flex align-items-center gap-2 flex-grow-1 me-2">
                                <label class="form-label mb-0 small text-muted text-nowrap" style="font-size: 11px;">
                                    <i class="fa-solid fa-bookmark me-1 text-warning"></i>Preset:
                                </label>
                                <select id="ideParamPresetSelect" class="form-select form-select-sm bg-dark text-light border-secondary" style="font-size: 11px; height: 26px; padding: 2px 24px 2px 8px;">
                                    ${presetOptions}
                                </select>
                            </div>
                            <div class="d-flex align-items-center gap-1">
                                <button type="button" id="ideParamSavePresetBtn" class="btn btn-xs btn-outline-info py-0 px-2" style="font-size: 11px; height: 24px;" title="Lưu cấu hình tham số thành Preset mới">
                                    <i class="fa-solid fa-floppy-disk me-1"></i>Lưu
                                </button>
                                <button type="button" id="ideParamDeletePresetBtn" class="btn btn-xs btn-outline-danger py-0 px-2" style="font-size: 11px; height: 24px;" title="Xóa Preset đang chọn">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>

                        <p class="small mb-3" style="color: var(--ide-text-muted, #848c94); line-height: 1.45;">
                            Truy vấn chứa <strong>${parameters.length}</strong> tham số biến mẫu. Các giá trị được escape an toàn để chống SQL Injection.
                        </p>
                        <form id="ideParamForm" onsubmit="return false;">
                            ${fieldsHtml}
                        </form>
                    </div>

                    <div class="ide-query-params-footer d-flex justify-content-between align-items-center">
                        <span class="text-muted small" style="font-size: 11px;">
                            <i class="fa-solid fa-keyboard text-info me-1"></i><kbd>Enter</kbd> Chạy • <kbd>Esc</kbd> Đóng
                        </span>
                        <div class="d-flex gap-2">
                            <button type="button" class="btn btn-sm btn-secondary px-3" id="ideParamCancelBtn">
                                Hủy bỏ (Esc)
                            </button>
                            <button type="button" class="btn btn-sm btn-primary px-3 fw-bold" id="ideParamConfirmBtn">
                                <i class="fa-solid fa-play me-1"></i>Thực thi truy vấn
                            </button>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(this.modalEl);

            const firstInput = this.modalEl.querySelector('.ide-param-input');
            if (firstInput) {
                setTimeout(() => {
                    firstInput.focus();
                    if (typeof firstInput.select === 'function') firstInput.select();
                }, 50);
            }

            const getValues = () => {
                const values = {};
                const inputs = this.modalEl.querySelectorAll('.ide-param-input');
                inputs.forEach(inp => {
                    const name = inp.dataset.paramName;
                    values[name] = inp.value;
                });
                return values;
            };

            const applyValues = (values) => {
                if (!values) return;
                const inputs = this.modalEl.querySelectorAll('.ide-param-input');
                inputs.forEach(inp => {
                    const name = inp.dataset.paramName;
                    if (values[name] !== undefined) {
                        inp.value = values[name];
                        inp.style.transition = 'background-color 0.3s ease';
                        inp.style.backgroundColor = 'rgba(13, 110, 253, 0.2)';
                        setTimeout(() => {
                            inp.style.backgroundColor = '';
                        }, 500);
                    }
                });
            };

            // Preset event handlers
            const presetSelect = this.modalEl.querySelector('#ideParamPresetSelect');
            const savePresetBtn = this.modalEl.querySelector('#ideParamSavePresetBtn');
            const deletePresetBtn = this.modalEl.querySelector('#ideParamDeletePresetBtn');

            if (presetSelect) {
                presetSelect.addEventListener('change', () => {
                    const chosen = presetSelect.value;
                    if (chosen && presets[chosen]) {
                        applyValues(presets[chosen]);
                    }
                });
            }

            if (savePresetBtn) {
                savePresetBtn.addEventListener('click', () => {
                    const currentChosen = presetSelect ? presetSelect.value : '';
                    const presetName = prompt('Nhập tên cho Preset cấu hình tham số:', currentChosen || 'Preset ' + new Date().toLocaleDateString('vi-VN'));
                    if (!presetName || !presetName.trim()) return;

                    const vals = getValues();
                    this.savePreset(presetName.trim(), vals);
                    presets[presetName.trim()] = vals;

                    if (presetSelect) {
                        let opt = Array.from(presetSelect.options).find(o => o.value === presetName.trim());
                        if (!opt) {
                            opt = document.createElement('option');
                            opt.value = presetName.trim();
                            opt.textContent = presetName.trim();
                            presetSelect.appendChild(opt);
                        }
                        presetSelect.value = presetName.trim();
                    }
                    if (window.showToast) window.showToast(`✓ Đã lưu Preset "${presetName.trim()}"!`, 'success');
                });
            }

            if (deletePresetBtn) {
                deletePresetBtn.addEventListener('click', () => {
                    const chosen = presetSelect ? presetSelect.value : '';
                    if (!chosen) {
                        alert('Vui lòng chọn Preset cần xóa.');
                        return;
                    }
                    if (confirm(`Bạn có chắc chắn muốn xóa Preset "${chosen}"?`)) {
                        this.deletePreset(chosen);
                        delete presets[chosen];
                        if (presetSelect) {
                            const opt = Array.from(presetSelect.options).find(o => o.value === chosen);
                            if (opt) opt.remove();
                            presetSelect.value = '';
                        }
                        if (window.showToast) window.showToast(`✓ Đã xóa Preset "${chosen}"!`, 'info');
                    }
                });
            }

            const confirmAction = () => {
                const vals = getValues();
                this.hideParameterModal();
                if (typeof onConfirm === 'function') {
                    onConfirm(vals);
                }
            };

            const cancelAction = () => {
                this.hideParameterModal();
                if (typeof onCancel === 'function') {
                    onCancel();
                }
            };

            const btnConfirm = this.modalEl.querySelector('#ideParamConfirmBtn');
            const btnCancel = this.modalEl.querySelector('#ideParamCancelBtn');
            const btnClose = this.modalEl.querySelector('#ideParamCloseBtn');

            if (btnConfirm) btnConfirm.addEventListener('click', confirmAction);
            if (btnCancel) btnCancel.addEventListener('click', cancelAction);
            if (btnClose) btnClose.addEventListener('click', cancelAction);

            this.keyHandler = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelAction();
                } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    confirmAction();
                }
            };
            window.addEventListener('keydown', this.keyHandler);
        }

        /**
         * Open parameter configuration modal manually for active editor SQL.
         */
        openParametersModal(targetEd) {
            let ed = targetEd;
            if (!ed) {
                ed = (typeof window.getActiveAppEditor === 'function') ? window.getActiveAppEditor() : window.AppEditor;
            }
            if (!ed) return;

            const sql = (typeof ed.somethingSelected === 'function' && ed.somethingSelected())
                ? ed.getSelection()
                : (typeof ed.getValue === 'function' ? ed.getValue() : '');

            const tabState = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
            const dbType = (tabState && tabState.dbType) || 'sqlserver';
            const detectedParams = this.extractParameters(sql, dbType);

            if (!detectedParams || detectedParams.length === 0) {
                if (window.showToast) {
                    window.showToast('Không phát hiện biến tham số {{param_name}} nào trong đoạn SQL hiện tại.', 'info');
                } else {
                    alert('Không phát hiện biến tham số {{param_name}} nào trong đoạn SQL hiện tại.');
                }
                return;
            }

            const cached = (tabState && tabState.cachedParams) ? tabState.cachedParams : {};
            this.showParameterModal(detectedParams, {
                tabId: (tabState && tabState.id) || 'default',
                cachedValues: cached,
                onConfirm: (vals) => {
                    if (tabState) tabState.cachedParams = { ...cached, ...vals };
                    if (window.showToast) window.showToast('✓ Đã cập nhật giá trị tham số!', 'success');
                }
            });
        }

        hideParameterModal() {
            if (this.keyHandler) {
                window.removeEventListener('keydown', this.keyHandler);
                this.keyHandler = null;
            }
            if (this.modalEl) {
                this.modalEl.remove();
                this.modalEl = null;
            }
        }
    }

    window.QueryParamsManager = new QueryParamsManager();

})(window);
