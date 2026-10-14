/**
 * query-params.js - Script Parameters Parser and Modal (Mục 5.2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects {{param}} placeholders and -- @param name: type = default declarations.
 * Prompts user with a theme-synchronized modal before execution.
 * Caches previous values per tab.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (window) {
    'use strict';

    class QueryParamsManager {
        constructor() {
            this.modalEl = null;
            this.keyHandler = null;
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
                if (!['string', 'number', 'identifier', 'date'].includes(pType)) {
                    pType = 'string';
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
                            placeholders.push({
                                name: pName,
                                type: d.type || 'string',
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
                let inputType = 'text';
                let placeholderText = 'Nhập chuỗi ký tự...';

                if (param.type === 'number') {
                    typeBadgeClass = 'bg-info text-dark';
                    iconClass = 'fa-hashtag';
                    inputType = 'number';
                    placeholderText = 'Ví dụ: 123 hoặc 45.67';
                } else if (param.type === 'identifier') {
                    typeBadgeClass = 'bg-warning text-dark';
                    iconClass = 'fa-database';
                    placeholderText = 'Tên bảng / cột / object...';
                } else if (param.type === 'date') {
                    typeBadgeClass = 'bg-success text-light';
                    iconClass = 'fa-calendar-days';
                    placeholderText = 'YYYY-MM-DD';
                }

                fieldsHtml += `
                    <div class="mb-3 ide-param-row" data-param-name="${param.name}">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <label class="form-label mb-0 fw-bold font-monospace text-truncate" style="font-size: 13px; color: var(--ide-text-active, #ffffff);" for="ide-param-input-${param.name}">
                                <i class="fa-solid ${iconClass} me-1 text-primary"></i>${param.name}
                            </label>
                            <span class="badge ${typeBadgeClass} font-monospace" style="font-size: 10px; text-transform: uppercase;">
                                ${param.type}
                            </span>
                        </div>
                        <input type="${inputType}"
                               id="ide-param-input-${param.name}"
                               class="form-control form-control-sm ide-param-input ide-query-params-input"
                               data-param-name="${param.name}"
                               data-param-type="${param.type}"
                               value="${String(currentVal).replace(/"/g, '&quot;')}"
                               placeholder="${placeholderText}"
                               ${idx === 0 ? 'autofocus' : ''} />
                    </div>
                `;
            });

            this.modalEl.innerHTML = `
                <div class="ide-query-params-card shadow-lg">
                    <div class="ide-query-params-header d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-sliders text-primary fs-5"></i>
                            <span class="fw-bold" style="font-size: 14px; letter-spacing: 0.3px;">NHẬP THAM SỐ TRUY VẤN</span>
                        </div>
                        <button type="button" class="btn-close btn-sm" id="ideParamCloseBtn" aria-label="Close"></button>
                    </div>
                    <div class="ide-query-params-body">
                        <p class="small mb-3" style="color: var(--ide-text-muted, #848c94); line-height: 1.45;">
                            Script chứa <strong>${parameters.length}</strong> tham số cần truyền giá trị. Các giá trị sẽ được escape an toàn trước khi thực thi.
                        </p>
                        <form id="ideParamForm" onsubmit="return false;">
                            ${fieldsHtml}
                        </form>
                    </div>
                    <div class="ide-query-params-footer d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-sm btn-secondary px-3" id="ideParamCancelBtn">
                            <i class="fa-solid fa-xmark me-1"></i>Hủy bỏ (Esc)
                        </button>
                        <button type="button" class="btn btn-sm btn-primary px-3 fw-bold" id="ideParamConfirmBtn">
                            <i class="fa-solid fa-play me-1"></i>Chạy truy vấn (Enter)
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(this.modalEl);

            const firstInput = this.modalEl.querySelector('.ide-param-input');
            if (firstInput) {
                setTimeout(() => {
                    firstInput.focus();
                    firstInput.select();
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
