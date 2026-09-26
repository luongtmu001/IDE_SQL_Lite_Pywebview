/**
 * SQL Snippets Manager & Autocomplete Controller
 * File: static/js/snippets-manager.js
 * 
 * Manages SQL template snippets (Red Gate SQL Prompt 10 compatible):
 * 1. Loads / Saves / Resets snippets via AppStorage / native IPC.
 * 2. Provides Snippets Manager UI Modal (list, search, create, edit, delete).
 * 3. Expands snippet in Monaco Editor & provides candidates for IntelliSense.
 */

(function (window) {
    'use strict';

    let _snippets = [];
    let _activeSnippetId = null;
    let _modalEl = null;
    let _isInitialized = false;

    const AppSnippets = {
        async init() {
            if (_isInitialized) return;
            _isInitialized = true;

            await this.loadSnippets();

            // Wire Toolbar Button
            const btn = document.getElementById('ide-snippets-btn');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showModal();
                });
            }

            // Global Shortcut: Ctrl+Alt+S / Cmd+Alt+S
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    this.toggleModal();
                }
            });
        },

        async loadSnippets() {
            try {
                if (window.AppStorage && typeof window.AppStorage.getSnippets === 'function') {
                    _snippets = await window.AppStorage.getSnippets();
                } else {
                    const res = await fetch('../static/data/snippets.json');
                    if (res.ok) _snippets = await res.json();
                }
            } catch (e) {
                console.warn('[AppSnippets] Load snippets error:', e);
                _snippets = [];
            }
            if (!Array.isArray(_snippets)) _snippets = [];
            return _snippets;
        },

        getSnippets() {
            return _snippets || [];
        },

        findSnippet(prefix) {
            if (!prefix) return null;
            const p = String(prefix).trim().toLowerCase();
            return _snippets.find(s => (s.prefix || '').toLowerCase() === p) || null;
        },

        /**
         * Search snippets matching keyword or prefix
         */
        searchSnippets(query) {
            if (!query) return _snippets;
            const q = query.trim().toLowerCase();
            return _snippets.filter(s =>
                (s.prefix || '').toLowerCase().includes(q) ||
                (s.description || '').toLowerCase().includes(q) ||
                (s.body || '').toLowerCase().includes(q)
            );
        },

        /**
         * Expands snippet body:
         * 1. Substitutes placeholders: $param_name$ -> defaultValue
         * 2. Detects $SELECTIONSTART$ and $SELECTIONEND$ to highlight default selection
         * Returns { expandedText, selectionStart, selectionEnd }
         */
        expandSnippetBody(snippet) {
            if (!snippet || !snippet.body) {
                return { expandedText: '', selectionStart: 0, selectionEnd: 0 };
            }

            let text = snippet.body;
            const placeholders = snippet.placeholders || [];

            // Replace defined placeholders
            placeholders.forEach(ph => {
                const token = `$${ph.name}$`;
                const val = ph.defaultValue !== undefined ? ph.defaultValue : '';
                text = text.split(token).join(val);
            });

            // Handle $SELECTIONSTART$ and $SELECTIONEND$
            let selStart = -1;
            let selEnd = -1;

            const startTag = '$SELECTIONSTART$';
            const endTag = '$SELECTIONEND$';

            const startIdx = text.indexOf(startTag);
            const endIdx = text.indexOf(endTag);

            if (startIdx !== -1 && endIdx !== -1) {
                if (startIdx < endIdx) {
                    // Normal order: $SELECTIONSTART$...$SELECTIONEND$
                    selStart = startIdx;
                    text = text.substring(0, startIdx) + text.substring(startIdx + startTag.length);
                    const adjustedEndIdx = text.indexOf(endTag);
                    selEnd = adjustedEndIdx;
                    text = text.substring(0, adjustedEndIdx) + text.substring(adjustedEndIdx + endTag.length);
                } else {
                    // Reverse order in Red Gate: $SELECTIONEND$...$SELECTIONSTART$
                    selStart = endIdx;
                    text = text.substring(0, endIdx) + text.substring(endIdx + endTag.length);
                    const adjustedStartIdx = text.indexOf(startTag);
                    selEnd = adjustedStartIdx;
                    text = text.substring(0, adjustedStartIdx) + text.substring(adjustedStartIdx + startTag.length);
                }
            } else if (startIdx !== -1) {
                selStart = startIdx;
                selEnd = startIdx;
                text = text.substring(0, startIdx) + text.substring(startIdx + startTag.length);
            } else if (endIdx !== -1) {
                selStart = endIdx;
                selEnd = endIdx;
                text = text.substring(0, endIdx) + text.substring(endIdx + endTag.length);
            }

            // Remove any remaining unresolved $...$ tokens if any
            text = text.replace(/\$([a-zA-Z0-9_]+)\$/g, (m, p1) => {
                return p1 === 'PASTE' || p1 === 'DATE' || p1 === 'TIME' || p1 === 'USER' ? '' : m;
            });

            if (selStart === -1) {
                selStart = text.length;
                selEnd = text.length;
            }

            return {
                expandedText: text,
                selectionStart: selStart,
                selectionEnd: selEnd
            };
        },

        /**
         * Try to expand snippet at current editor cursor
         * Triggered on Tab key press or suggestion accept
         */
        tryExpandSnippet(cm) {
            if (!cm) return false;

            const cursor = cm.getCursor();
            const line = cm.getLine(cursor.line);
            const beforeCursor = line.substring(0, cursor.ch);

            // Match word immediately before cursor: [a-zA-Z0-9_]+
            const match = beforeCursor.match(/([a-zA-Z0-9_]+)$/);
            if (!match) return false;

            const prefix = match[1];
            const snippet = this.findSnippet(prefix);
            if (!snippet) return false;

            // Expand snippet
            const wordStartCh = cursor.ch - prefix.length;
            const fromPos = { line: cursor.line, ch: wordStartCh };
            const toPos = { line: cursor.line, ch: cursor.ch };

            const expanded = this.expandSnippetBody(snippet);

            cm.operation(() => {
                cm.replaceRange(expanded.expandedText, fromPos, toPos);

                // Compute new cursor / selection position
                const startOffset = cm.indexFromPos(fromPos);
                const absSelStart = startOffset + expanded.selectionStart;
                const absSelEnd = startOffset + expanded.selectionEnd;

                const posStart = cm.posFromIndex(absSelStart);
                const posEnd = cm.posFromIndex(absSelEnd);

                if (absSelStart !== absSelEnd) {
                    cm.setSelection(posStart, posEnd);
                } else {
                    cm.setCursor(posStart);
                }
                cm.focus();
            });

            return true;
        },

        // ── Snippets Manager UI Modal ─────────────────────────────────────────

        showModal() {
            this._ensureModalDOM();
            if (_modalEl) {
                _modalEl.classList.remove('d-none');
                _modalEl.style.display = 'flex';
                this.renderList();
                if (_snippets.length > 0) {
                    this.selectSnippet(_snippets[0].id);
                } else {
                    this.newSnippet();
                }
            }
        },

        hideModal() {
            if (_modalEl) {
                _modalEl.classList.add('d-none');
                _modalEl.style.display = 'none';
            }
        },

        toggleModal() {
            if (_modalEl && !_modalEl.classList.contains('d-none')) {
                this.hideModal();
            } else {
                this.showModal();
            }
        },

        _ensureModalDOM() {
            _modalEl = document.getElementById('ide-snippets-modal');
            if (_modalEl) return;

            const overlay = document.createElement('div');
            overlay.id = 'ide-snippets-modal';
            overlay.className = 'ide-modal-overlay d-none';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.65); z-index: 10040;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(2px);
            `;

            overlay.innerHTML = `
                <div class="ide-snippets-window" style="
                    width: 900px; max-width: 95vw; height: 600px; max-height: 90vh;
                    background: var(--ide-bg-sidebar, #252526);
                    border: 1px solid var(--ide-border, #454545);
                    border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: flex; flex-direction: column; overflow: hidden;
                    color: var(--ide-text-main, #cccccc);
                ">
                    <!-- Modal Header -->
                    <div style="
                        height: 38px; padding: 0 12px; background: var(--ide-bg-panel-header, #2d2d2d);
                        border-bottom: 1px solid var(--ide-border, #454545);
                        display: flex; align-items: center; justify-content: space-between;
                        user-select: none; flex-shrink: 0;
                    ">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-code text-info"></i>
                            <span class="fw-bold" style="font-size: 13px;">Quản lý SQL Snippets (Mẫu viết tắt)</span>
                            <span id="ide-snip-badge-count" class="badge bg-secondary" style="font-size: 10px;">0 snippets</span>
                        </div>
                        <div class="d-flex align-items-center gap-2">
                            <button id="ide-snip-btn-new" class="btn btn-sm btn-primary py-0 px-2" style="font-size: 11px; height: 24px;">
                                <i class="fa-solid fa-plus me-1"></i>Thêm mới
                            </button>
                            <button id="ide-snip-btn-reset" class="btn btn-sm btn-outline-secondary py-0 px-2 text-warning" style="font-size: 11px; height: 24px;" title="Khôi phục lại toàn bộ snippet gốc từ SQL Prompt 10">
                                <i class="fa-solid fa-rotate-left me-1"></i>Reset gốc
                            </button>
                            <button id="ide-snip-btn-close" class="btn btn-sm btn-outline-secondary py-0 px-2 border-0 text-muted" style="font-size: 14px;" title="Đóng">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Modal Body (Two-Panel Master Detail) -->
                    <div style="flex: 1; display: flex; overflow: hidden; min-height: 0;">
                        <!-- Left Panel: Snippets List & Search -->
                        <div style="
                            width: 320px; border-right: 1px solid var(--ide-border, #454545);
                            display: flex; flex-direction: column; background: var(--ide-bg-main, #1e1e1e);
                            flex-shrink: 0;
                        ">
                            <!-- Search Bar -->
                            <div style="padding: 8px; border-bottom: 1px solid var(--ide-border, #454545);">
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text bg-transparent border-secondary text-muted" style="font-size: 11px;"><i class="fa-solid fa-magnifying-glass"></i></span>
                                    <input type="text" id="ide-snip-search" class="form-control bg-dark text-light border-secondary" placeholder="Lọc prefix, mô tả..." style="font-size: 12px;">
                                </div>
                            </div>

                            <!-- List -->
                            <div id="ide-snip-list" style="flex: 1; overflow-y: auto; padding: 4px 0;">
                                <!-- Snippets rendered here -->
                            </div>
                        </div>

                        <!-- Right Panel: Snippet Editor Form -->
                        <div id="ide-snip-editor-panel" style="
                            flex: 1; display: flex; flex-direction: column;
                            background: var(--ide-bg-sidebar, #252526); overflow-y: auto; padding: 14px 16px;
                        ">
                            <form id="ide-snip-form" onsubmit="return false;" style="display: flex; flex-direction: column; height: 100%;">
                                <div class="row g-2 mb-2">
                                    <div class="col-4">
                                        <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            Prefix (Từ khóa gõ tắt) <span class="text-danger">*</span>
                                        </label>
                                        <input type="text" id="ide-snip-prefix" class="form-control form-control-sm bg-dark text-warning fw-bold font-monospace" placeholder="vd: ssf, ata" required style="font-size: 13px;">
                                    </div>
                                    <div class="col-8">
                                        <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            Mô tả chức năng <span class="text-danger">*</span>
                                        </label>
                                        <input type="text" id="ide-snip-desc" class="form-control form-control-sm bg-dark text-light" placeholder="vd: SELECT * FROM table" required style="font-size: 12px;">
                                    </div>
                                </div>

                                <div class="mb-2" style="flex: 1; display: flex; flex-direction: column; min-height: 160px;">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <label class="form-label mb-0" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            Mẫu câu lệnh SQL (Body) <span class="text-danger">*</span>
                                        </label>
                                        <span class="text-muted" style="font-size: 10px;">Dùng biến: <code>$table_name$</code>, <code>$SELECTIONSTART$</code>..<code>$SELECTIONEND$</code></span>
                                    </div>
                                    <textarea id="ide-snip-body" class="form-control bg-dark text-light font-monospace" style="
                                        flex: 1; font-size: 12px; resize: none; border-color: var(--ide-border, #454545);
                                        line-height: 1.4; white-space: pre;
                                    " placeholder="SELECT * FROM $table_name$ WHERE $SELECTIONSTART$1 = 1$SELECTIONEND$" required></textarea>
                                </div>

                                <!-- Placeholders Variables Table -->
                                <div class="mb-3">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <label class="form-label mb-0" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            Biến tham số & Giá trị mặc định (Placeholders)
                                        </label>
                                        <button type="button" id="ide-snip-btn-add-var" class="btn btn-xs btn-outline-info py-0 px-2" style="font-size: 10px;">
                                            <i class="fa-solid fa-plus me-1"></i>Thêm biến
                                        </button>
                                    </div>
                                    <div id="ide-snip-vars-table-wrapper" style="
                                        max-height: 110px; overflow-y: auto; border: 1px solid var(--ide-border, #454545);
                                        border-radius: 4px; background: rgba(0,0,0,0.2);
                                    ">
                                        <table class="table table-sm table-dark table-borderless mb-0" style="font-size: 11px;">
                                            <thead>
                                                <tr style="border-bottom: 1px solid #333; color: #888;">
                                                    <th style="width: 40%;">Tên biến ($name$)</th>
                                                    <th style="width: 50%;">Giá trị mặc định (Default)</th>
                                                    <th style="width: 10%; text-align: center;"></th>
                                                </tr>
                                            </thead>
                                            <tbody id="ide-snip-vars-tbody">
                                                <!-- Populated dynamically -->
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <!-- Actions Bar -->
                                <div class="d-flex align-items-center justify-content-between pt-2 border-top border-secondary">
                                    <button type="button" id="ide-snip-btn-delete" class="btn btn-sm btn-outline-danger" style="font-size: 11px;">
                                        <i class="fa-solid fa-trash me-1"></i>Xóa Snippet này
                                    </button>
                                    <div class="d-flex gap-2">
                                        <button type="button" id="ide-snip-btn-test" class="btn btn-sm btn-outline-info" style="font-size: 11px;" title="Xem trước câu lệnh sau khi thay thế biến">
                                            <i class="fa-solid fa-play me-1"></i>Thử mở rộng
                                        </button>
                                        <button type="submit" id="ide-snip-btn-save" class="btn btn-sm btn-success" style="font-size: 11px; padding: 4px 16px;">
                                            <i class="fa-solid fa-check me-1"></i>Lưu Snippet
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            _modalEl = overlay;

            // Wire Events inside Modal
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.hideModal();
            });

            overlay.querySelector('#ide-snip-btn-close').addEventListener('click', () => this.hideModal());

            overlay.querySelector('#ide-snip-search').addEventListener('input', (e) => {
                this.renderList(e.target.value);
            });

            overlay.querySelector('#ide-snip-btn-new').addEventListener('click', () => {
                this.newSnippet();
            });

            overlay.querySelector('#ide-snip-btn-reset').addEventListener('click', async () => {
                if (confirm('Bạn có chắc chắn muốn khôi phục toàn bộ snippet gốc từ SQL Prompt 10? Mọi thay đổi tùy biến sẽ được reset.')) {
                    await this.resetSnippets();
                }
            });

            overlay.querySelector('#ide-snip-btn-add-var').addEventListener('click', () => {
                this._addVariableRow('', '');
            });

            overlay.querySelector('#ide-snip-form').addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveCurrentSnippet();
            });

            overlay.querySelector('#ide-snip-btn-delete').addEventListener('click', () => {
                if (_activeSnippetId) {
                    this.deleteSnippet(_activeSnippetId);
                }
            });

            overlay.querySelector('#ide-snip-btn-test').addEventListener('click', () => {
                const dummy = this._collectFormValues();
                const expanded = this.expandSnippetBody(dummy);
                alert(`--- Xem trước câu lệnh SQL sau khi mở rộng ---\n\n${expanded.expandedText}`);
            });
        },

        renderList(query = '') {
            if (!_modalEl) return;
            const listEl = _modalEl.querySelector('#ide-snip-list');
            const countEl = _modalEl.querySelector('#ide-snip-badge-count');
            if (!listEl) return;

            const items = this.searchSnippets(query);
            if (countEl) countEl.textContent = `${items.length} snippets`;

            if (items.length === 0) {
                listEl.innerHTML = `<div class="p-3 text-center text-muted small">Không tìm thấy snippet nào khớp với từ khóa.</div>`;
                return;
            }

            listEl.innerHTML = items.map(s => {
                const isActive = s.id === _activeSnippetId;
                return `
                    <div class="ide-snip-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                        padding: 6px 10px; cursor: pointer; border-left: 3px solid ${isActive ? 'var(--ide-accent, #58a6ff)' : 'transparent'};
                        background: ${isActive ? 'rgba(88, 166, 255, 0.15)' : 'transparent'};
                        display: flex; align-items: center; justify-content: space-between;
                        transition: background 0.1s;
                    ">
                        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                            <span class="badge bg-dark text-warning font-monospace fw-bold" style="font-size: 11px; margin-right: 6px;">${s.prefix || ''}</span>
                            <span style="font-size: 11px; color: ${isActive ? '#fff' : 'var(--ide-text-main, #ccc)'};">${s.description || '(Chưa có mô tả)'}</span>
                        </div>
                        <i class="fa-solid fa-chevron-right text-muted" style="font-size: 9px; opacity: 0.5;"></i>
                    </div>
                `;
            }).join('');

            listEl.querySelectorAll('.ide-snip-item').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.dataset.id;
                    this.selectSnippet(id);
                });
            });
        },

        selectSnippet(id) {
            _activeSnippetId = id;
            if (!_modalEl) return;

            // Highlight in list
            _modalEl.querySelectorAll('.ide-snip-item').forEach(el => {
                const isAct = el.dataset.id === id;
                el.classList.toggle('active', isAct);
                el.style.borderLeft = isAct ? '3px solid var(--ide-accent, #58a6ff)' : 'transparent';
                el.style.background = isAct ? 'rgba(88, 166, 255, 0.15)' : 'transparent';
            });

            const snip = _snippets.find(s => s.id === id);
            if (!snip) return;

            const prefixInput = _modalEl.querySelector('#ide-snip-prefix');
            const descInput = _modalEl.querySelector('#ide-snip-desc');
            const bodyInput = _modalEl.querySelector('#ide-snip-body');
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');
            const btnDelete = _modalEl.querySelector('#ide-snip-btn-delete');

            if (prefixInput) prefixInput.value = snip.prefix || '';
            if (descInput) descInput.value = snip.description || '';
            if (bodyInput) bodyInput.value = snip.body || '';
            if (btnDelete) btnDelete.style.display = 'inline-block';

            if (tbody) {
                tbody.innerHTML = '';
                const placeholders = snip.placeholders || [];
                placeholders.forEach(p => {
                    this._addVariableRow(p.name, p.defaultValue);
                });
            }
        },

        newSnippet() {
            _activeSnippetId = null;
            if (!_modalEl) return;

            _modalEl.querySelectorAll('.ide-snip-item').forEach(el => {
                el.classList.remove('active');
                el.style.borderLeft = 'transparent';
                el.style.background = 'transparent';
            });

            const prefixInput = _modalEl.querySelector('#ide-snip-prefix');
            const descInput = _modalEl.querySelector('#ide-snip-desc');
            const bodyInput = _modalEl.querySelector('#ide-snip-body');
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');
            const btnDelete = _modalEl.querySelector('#ide-snip-btn-delete');

            if (prefixInput) {
                prefixInput.value = '';
                prefixInput.focus();
            }
            if (descInput) descInput.value = '';
            if (bodyInput) bodyInput.value = '';
            if (tbody) tbody.innerHTML = '';
            if (btnDelete) btnDelete.style.display = 'none';
        },

        _addVariableRow(name = '', defaultValue = '') {
            if (!_modalEl) return;
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');
            if (!tbody) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <input type="text" class="form-control form-control-sm bg-dark text-info p-1 font-monospace ide-snip-var-name" value="${name || ''}" placeholder="tên biến (vd: table_name)" style="font-size: 11px;">
                </td>
                <td>
                    <input type="text" class="form-control form-control-sm bg-dark text-light p-1 font-monospace ide-snip-var-val" value="${defaultValue || ''}" placeholder="giá trị ngầm định" style="font-size: 11px;">
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    <button type="button" class="btn btn-xs btn-outline-danger p-0 border-0 text-muted ide-snip-var-remove" title="Xóa biến" style="font-size: 11px;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;

            tr.querySelector('.ide-snip-var-remove').addEventListener('click', () => {
                tr.remove();
            });

            tbody.appendChild(tr);
        },

        _collectFormValues() {
            if (!_modalEl) return null;
            const prefixInput = _modalEl.querySelector('#ide-snip-prefix');
            const descInput = _modalEl.querySelector('#ide-snip-desc');
            const bodyInput = _modalEl.querySelector('#ide-snip-body');
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');

            const placeholders = [];
            if (tbody) {
                tbody.querySelectorAll('tr').forEach(tr => {
                    const name = tr.querySelector('.ide-snip-var-name')?.value?.trim();
                    const defaultValue = tr.querySelector('.ide-snip-var-val')?.value || '';
                    if (name) {
                        placeholders.push({ name, defaultValue });
                    }
                });
            }

            return {
                id: _activeSnippetId || ('snip_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6)),
                prefix: prefixInput ? prefixInput.value.trim() : '',
                description: descInput ? descInput.value.trim() : '',
                body: bodyInput ? bodyInput.value : '',
                placeholders
            };
        },

        async saveCurrentSnippet() {
            const data = this._collectFormValues();
            if (!data || !data.prefix || !data.body) {
                alert('Vui lòng nhập đầy đủ Prefix và Mẫu câu lệnh Body!');
                return;
            }

            // Check if prefix conflicts with another snippet
            const existingIdx = _snippets.findIndex(s => s.id === data.id);
            const prefixConflict = _snippets.find(s => s.id !== data.id && (s.prefix || '').toLowerCase() === data.prefix.toLowerCase());
            if (prefixConflict) {
                alert(`Prefix "${data.prefix}" đã được sử dụng bởi snippet "${prefixConflict.description}". Vui lòng chọn prefix khác!`);
                return;
            }

            if (existingIdx !== -1) {
                _snippets[existingIdx] = data;
            } else {
                _snippets.push(data);
            }

            _snippets.sort((a, b) => (a.prefix || '').localeCompare(b.prefix || ''));
            _activeSnippetId = data.id;

            // Save to storage
            if (window.AppStorage && typeof window.AppStorage.saveSnippets === 'function') {
                await window.AppStorage.saveSnippets(_snippets);
            }

            this.renderList();
            this.selectSnippet(data.id);
            alert('✓ Đã lưu snippet thành công!');
        },

        async deleteSnippet(id) {
            const snip = _snippets.find(s => s.id === id);
            if (!snip) return;

            if (!confirm(`Bạn có chắc chắn muốn xóa snippet "${snip.prefix}" (${snip.description})?`)) {
                return;
            }

            _snippets = _snippets.filter(s => s.id !== id);
            if (window.AppStorage && typeof window.AppStorage.saveSnippets === 'function') {
                await window.AppStorage.saveSnippets(_snippets);
            }

            if (_snippets.length > 0) {
                this.renderList();
                this.selectSnippet(_snippets[0].id);
            } else {
                this.renderList();
                this.newSnippet();
            }
        },

        async resetSnippets() {
            if (window.AppStorage && typeof window.AppStorage.resetSnippets === 'function') {
                _snippets = await window.AppStorage.resetSnippets();
            } else {
                await this.loadSnippets();
            }
            this.renderList();
            if (_snippets.length > 0) {
                this.selectSnippet(_snippets[0].id);
            }
            alert('✓ Đã khôi phục toàn bộ snippet mặc định!');
        }
    };

    window.AppSnippets = AppSnippets;

    // Auto-init on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => AppSnippets.init());
    } else {
        AppSnippets.init();
    }

})(window);
