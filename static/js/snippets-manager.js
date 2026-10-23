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
    let _bookmarkPopoverEl = null;
    let _activeTag = null;
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
            _snippets.forEach(s => {
                if (s.isPinned === undefined) s.isPinned = false;
                s.dbType = this.normalizeDbType(s.dbType || s.db_type || 'all');
                if (!Array.isArray(s.tags)) {
                    s.tags = typeof s.tags === 'string' ? s.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                }
            });
            _snippets.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (a.prefix || '').localeCompare(b.prefix || ''));
            return _snippets;
        },

        normalizeDbType(dbType) {
            if (!dbType) return 'all';
            const s = String(dbType).trim().toLowerCase();
            if (s === 'all' || s === '*' || s === 'any' || s === 'both' || s === 'cả 2') return 'all';
            if (s === 'sqlserver' || s === 'mssql' || s === 'ssms') return 'sqlserver';
            if (s === 'postgresql' || s === 'postgres' || s === 'pg') return 'postgresql';
            return s;
        },

        matchesDbType(snippetDbType, targetDbType) {
            const sNorm = this.normalizeDbType(snippetDbType);
            if (sNorm === 'all') return true;
            if (!targetDbType) return true;
            const tNorm = this.normalizeDbType(targetDbType);
            if (tNorm === 'all') return true;
            return sNorm === tNorm;
        },

        getSnippets(targetDbType) {
            if (targetDbType === 'all') {
                return _snippets || [];
            }
            const effectiveDb = (targetDbType !== undefined && targetDbType !== null)
                ? targetDbType
                : (window.ActiveDbType || (window.AppTabs?.getActiveTabState?.()?.dbType) || null);
            if (!effectiveDb) {
                return _snippets || [];
            }
            return (_snippets || []).filter(s => this.matchesDbType(s.dbType, effectiveDb));
        },

        getAllSnippets() {
            return _snippets || [];
        },

        findSnippet(prefix, targetDbType) {
            if (!prefix) return null;
            const p = String(prefix).trim().toLowerCase();
            const effectiveDb = (targetDbType !== undefined && targetDbType !== null)
                ? targetDbType
                : (window.ActiveDbType || (window.AppTabs?.getActiveTabState?.()?.dbType) || null);

            const candidates = (_snippets || []).filter(s =>
                (s.prefix || '').toLowerCase() === p &&
                this.matchesDbType(s.dbType, effectiveDb)
            );
            if (candidates.length === 0) return null;

            if (effectiveDb && effectiveDb !== 'all') {
                const normTarget = this.normalizeDbType(effectiveDb);
                const exactMatch = candidates.find(s => this.normalizeDbType(s.dbType) === normTarget);
                if (exactMatch) return exactMatch;
            }

            return candidates[0];
        },

        getAllTags() {
            const tagMap = new Map();
            (_snippets || []).forEach(s => {
                const tagList = Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',') : []);
                tagList.forEach(rawTag => {
                    const tag = String(rawTag || '').trim().toLowerCase();
                    if (tag) {
                        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
                    }
                });
            });
            return Array.from(tagMap.entries())
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        },

        getPinnedCount() {
            return (_snippets || []).filter(s => Boolean(s.isPinned)).length;
        },

        getDbTypeCounts() {
            let sqlServerCount = 0;
            let postgresCount = 0;
            let allCount = 0;
            (_snippets || []).forEach(s => {
                const dt = this.normalizeDbType(s.dbType);
                if (dt === 'sqlserver') sqlServerCount++;
                else if (dt === 'postgresql') postgresCount++;
                else allCount++;
            });
            return { sqlServerCount, postgresCount, allCount };
        },

        /**
         * Search snippets matching keyword, prefix, or tag
         */
        searchSnippets(query = '', tag = _activeTag) {
            let list = _snippets || [];
            if (tag === '__pinned__') {
                list = list.filter(s => Boolean(s.isPinned));
            } else if (tag === '__sqlserver__') {
                list = list.filter(s => this.normalizeDbType(s.dbType) === 'sqlserver');
            } else if (tag === '__postgresql__') {
                list = list.filter(s => this.normalizeDbType(s.dbType) === 'postgresql');
            } else if (tag === '__all_db__') {
                list = list.filter(s => this.normalizeDbType(s.dbType) === 'all');
            } else if (tag) {
                const lowerTag = String(tag).trim().toLowerCase();
                list = list.filter(s => {
                    const tagList = Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',') : []);
                    return tagList.some(t => String(t).trim().toLowerCase() === lowerTag);
                });
            }

            if (query && query.trim()) {
                const q = query.trim().toLowerCase();
                list = list.filter(s =>
                    (s.prefix || '').toLowerCase().includes(q) ||
                    (s.description || '').toLowerCase().includes(q) ||
                    (s.body || '').toLowerCase().includes(q) ||
                    (s.dbType || '').toLowerCase().includes(q) ||
                    (Array.isArray(s.tags) && s.tags.some(t => t.toLowerCase().includes(q)))
                );
            }

            return [...list].sort((a, b) => {
                const pinA = a.isPinned ? 1 : 0;
                const pinB = b.isPinned ? 1 : 0;
                if (pinA !== pinB) return pinB - pinA;
                return (a.prefix || '').localeCompare(b.prefix || '');
            });
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
         * Checks if the word immediately preceding the cursor exactly matches a snippet prefix
         */
        hasMatchingSnippet(cm) {
            let target = cm;
            if (!target) {
                target = (typeof window.getActiveAppEditor === 'function') ? window.getActiveAppEditor() : window.AppEditor;
            }
            if (!target) return null;

            // Normalize raw Monaco editor instance if passed
            if (typeof target.getCursor !== 'function' && typeof target.getPosition === 'function') {
                if (window.AppEditor && (window.AppEditor.rawEditor === target || window.AppEditor.monaco === target)) {
                    target = window.AppEditor;
                } else if (window.AppEditor2 && (window.AppEditor2.rawEditor === target || window.AppEditor2.monaco === target)) {
                    target = window.AppEditor2;
                } else if (window.EditorAdapter) {
                    target = new window.EditorAdapter(target);
                }
            }
            if (typeof target.getCursor !== 'function') return null;

            // If text is currently selected, do NOT expand snippets (preserve regular Tab indent)
            if (typeof target.somethingSelected === 'function' && target.somethingSelected()) {
                return null;
            }
            if (typeof target.hasSelection === 'function' && target.hasSelection()) {
                return null;
            }

            const cursor = target.getCursor();
            const line = target.getLine(cursor.line);
            const beforeCursor = line.substring(0, cursor.ch);

            // Match word immediately before cursor: [a-zA-Z0-9_#$@]+
            const match = beforeCursor.match(/([a-zA-Z0-9_#$@]+)$/);
            if (!match) return null;

            const prefix = match[1];

            // Resolve target DB type from active tab or editor context
            let targetDbType = null;
            if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
                const tabState = window.AppTabs.getActiveTabState();
                if (tabState && tabState.dbType) targetDbType = tabState.dbType;
            }
            if (!targetDbType && window.ActiveDbType) {
                targetDbType = window.ActiveDbType;
            }

            const snippet = this.findSnippet(prefix, targetDbType);
            if (!snippet) return null;

            return {
                snippet,
                prefix,
                cursor,
                line: cursor.line,
                wordStartCh: cursor.ch - prefix.length,
                target
            };
        },

        /**
         * Try to expand snippet at current editor cursor
         * Triggered on Tab key press or suggestion accept
         */
        tryExpandSnippet(cm) {
            const matchInfo = this.hasMatchingSnippet(cm);
            if (!matchInfo) return false;

            const { snippet, prefix, cursor, target, wordStartCh } = matchInfo;

            // Expand snippet
            const fromPos = { line: cursor.line, ch: wordStartCh };
            const toPos = { line: cursor.line, ch: cursor.ch };

            const expanded = this.expandSnippetBody(snippet);

            target.operation(() => {
                target.replaceRange(expanded.expandedText, fromPos, toPos);

                // Compute new cursor / selection position
                const startOffset = target.indexFromPos(fromPos);
                const absSelStart = startOffset + expanded.selectionStart;
                const absSelEnd = startOffset + expanded.selectionEnd;

                const posStart = target.posFromIndex(absSelStart);
                const posEnd = target.posFromIndex(absSelEnd);

                if (absSelStart !== absSelEnd) {
                    target.setSelection(posStart, posEnd);
                } else {
                    target.setCursor(posStart);
                }
                target.focus();
            });

            // Automatically dismiss any open IntelliSense popup so single Tab expands cleanly
            if (window.AppIntelliSense && typeof window.AppIntelliSense.hidePopup === 'function') {
                window.AppIntelliSense.hidePopup();
            }

            return true;
        },

        // ── Snippets Manager UI Modal ─────────────────────────────────────────

        showModal() {
            this._ensureModalDOM();
            if (_modalEl) {
                _modalEl.classList.remove('d-none');
                _modalEl.style.display = 'flex';
                this.renderTagCloud();
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

        renderTagCloud() {
            if (!_modalEl) return;
            const cloudEl = _modalEl.querySelector('#ide-snip-tag-cloud');
            if (!cloudEl) return;

            const tags = this.getAllTags();
            const pinnedCount = this.getPinnedCount();
            const { sqlServerCount, postgresCount, allCount } = this.getDbTypeCounts();

            let html = `
                <span class="ide-snip-tag-pill ${_activeTag === null ? 'active' : ''}" data-tag="">
                    Tất cả (${_snippets.length})
                </span>
            `;

            if (sqlServerCount > 0) {
                html += `
                    <span class="ide-snip-tag-pill ${_activeTag === '__sqlserver__' ? 'active' : ''} text-primary" data-tag="__sqlserver__">
                        <i class="fa-solid fa-database me-1"></i>MSSQL (${sqlServerCount})
                    </span>
                `;
            }

            if (postgresCount > 0) {
                html += `
                    <span class="ide-snip-tag-pill ${_activeTag === '__postgresql__' ? 'active' : ''} text-info" data-tag="__postgresql__">
                        <i class="fa-solid fa-database me-1"></i>Postgres (${postgresCount})
                    </span>
                `;
            }

            if (pinnedCount > 0) {
                html += `
                    <span class="ide-snip-tag-pill ${_activeTag === '__pinned__' ? 'active' : ''} text-warning" data-tag="__pinned__">
                        <i class="fa-solid fa-star me-1"></i>Đã ghim (${pinnedCount})
                    </span>
                `;
            }

            tags.forEach(t => {
                const isActive = _activeTag === t.name;
                html += `
                    <span class="ide-snip-tag-pill ${isActive ? 'active' : ''}" data-tag="${t.name}">
                        #${t.name} <span class="opacity-75">(${t.count})</span>
                    </span>
                `;
            });

            cloudEl.innerHTML = html;

            cloudEl.querySelectorAll('.ide-snip-tag-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const selected = pill.dataset.tag;
                    _activeTag = selected === '' ? null : selected;
                    this.renderTagCloud();
                    const searchInput = _modalEl.querySelector('#ide-snip-search');
                    this.renderList(searchInput ? searchInput.value : '');
                });
            });
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
                    width: 900px; max-width: 95vw; height: 620px; max-height: 90vh;
                    background: var(--ide-bg-sidebar, #252526);
                    border: 1px solid var(--ide-border, #454545);
                    border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: flex; flex-direction: column; overflow: hidden;
                    color: var(--ide-text-main, #cccccc);
                ">
                    <!-- Modal Header -->
                    <div class="ide-snippets-header" style="
                        height: 38px; padding: 0 12px; background: var(--ide-bg-toolbar, var(--ide-bg-panel-header, var(--ide-bg-modal, #202228)));
                        border-bottom: 1px solid var(--ide-border, #454545);
                        display: flex; align-items: center; justify-content: space-between;
                        user-select: none; flex-shrink: 0; color: var(--ide-text-main, inherit);
                    ">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-code text-info"></i>
                            <span class="fw-bold" style="font-size: 13px; color: var(--ide-text-main, inherit);">Quản lý SQL Snippets & Bookmarks</span>
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
                        <!-- Left Panel: Snippets List, Search & Tag Cloud -->
                        <div style="
                            width: 330px; border-right: 1px solid var(--ide-border, #454545);
                            display: flex; flex-direction: column; background: var(--ide-bg-main, #1e1e1e);
                            flex-shrink: 0;
                        ">
                            <!-- Search Bar & Tag Cloud -->
                            <div style="padding: 8px; border-bottom: 1px solid var(--ide-border, #454545);">
                                <div class="input-group input-group-sm mb-2">
                                    <span class="input-group-text bg-transparent border-secondary text-muted" style="font-size: 11px;"><i class="fa-solid fa-magnifying-glass"></i></span>
                                    <input type="text" id="ide-snip-search" class="form-control bg-dark text-light border-secondary" placeholder="Lọc prefix, mô tả, body, #tag..." style="font-size: 12px;">
                                </div>
                                <div id="ide-snip-tag-cloud" class="d-flex align-items-center gap-1 flex-wrap" style="max-height: 54px; overflow-y: auto; padding: 2px 0;">
                                    <!-- Dynamic tag pills rendered here -->
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

                                <div class="row g-2 mb-2">
                                    <div class="col-5">
                                        <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            Tags phân loại (phân cách bởi dấu phẩy)
                                        </label>
                                        <input type="text" id="ide-snip-tags" class="form-control form-control-sm bg-dark text-light" placeholder="vd: select, reporting, dba, common" style="font-size: 12px;">
                                    </div>
                                    <div class="col-4">
                                        <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                            <i class="fa-solid fa-database me-1 text-info"></i>Loại CSDL
                                        </label>
                                        <select id="ide-snip-db-type" class="form-select form-select-sm bg-dark text-light border-secondary" style="font-size: 11px; height: 30px;">
                                            <option value="all">Tất cả CSDL (Cả 2 loại)</option>
                                            <option value="sqlserver">SQL Server (MSSQL)</option>
                                            <option value="postgresql">PostgreSQL (PG)</option>
                                        </select>
                                    </div>
                                    <div class="col-3 d-flex align-items-end pb-1">
                                        <div class="form-check form-switch m-0">
                                            <input class="form-check-input" type="checkbox" id="ide-snip-pinned" role="switch">
                                            <label class="form-check-label text-warning small fw-bold" for="ide-snip-pinned" style="font-size: 11px; user-select: none;">
                                                <i class="fa-solid fa-star me-1"></i>Ghim
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div class="mb-2" style="flex: 1; display: flex; flex-direction: column; min-height: 150px;">
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
                                        max-height: 100px; overflow-y: auto; border: 1px solid var(--ide-border, #454545);
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
                const isPinned = Boolean(s.isPinned);
                const tagList = Array.isArray(s.tags) ? s.tags : [];
                const normDb = this.normalizeDbType(s.dbType);

                let dbBadgeHtml = '';
                if (normDb === 'sqlserver') {
                    dbBadgeHtml = `<span class="ide-snip-db-badge sqlserver" style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); font-weight: 600;">MSSQL</span>`;
                } else if (normDb === 'postgresql') {
                    dbBadgeHtml = `<span class="ide-snip-db-badge postgresql" style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(20, 184, 166, 0.15); color: #2dd4bf; border: 1px solid rgba(20, 184, 166, 0.35); font-weight: 600;">PG</span>`;
                } else {
                    dbBadgeHtml = `<span class="ide-snip-db-badge all" style="font-size: 9px; padding: 1px 5px; border-radius: 3px; background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">ALL</span>`;
                }

                return `
                    <div class="ide-snip-item ${isActive ? 'active' : ''}" data-id="${s.id}" style="
                        padding: 6px 10px; cursor: pointer; border-left: 3px solid ${isActive ? 'var(--ide-accent, #58a6ff)' : (isPinned ? 'var(--ide-warning, #eab308)' : 'transparent')};
                        background: ${isActive ? 'rgba(88, 166, 255, 0.15)' : (isPinned ? 'rgba(234, 179, 8, 0.05)' : 'transparent')};
                        display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
                        transition: background 0.1s;
                    ">
                        <div style="overflow: hidden; text-overflow: ellipsis; flex: 1;">
                            <div class="d-flex align-items-center flex-wrap gap-1">
                                <span class="badge bg-dark text-warning font-monospace fw-bold" style="font-size: 11px;">${s.prefix || ''}</span>
                                ${dbBadgeHtml}
                                <span style="font-size: 11px; color: ${isActive ? '#fff' : 'var(--ide-text-main, #ccc)'}; font-weight: ${isPinned ? '600' : 'normal'};">
                                    ${s.description || '(Chưa có mô tả)'}
                                </span>
                            </div>
                            ${tagList.length > 0 ? `
                                <div class="d-flex gap-1 flex-wrap mt-1">
                                    ${tagList.map(t => `<span class="ide-snip-tag-badge">#${t}</span>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                        <div class="d-flex align-items-center gap-1 flex-shrink-0 pt-1">
                            <button type="button" class="btn btn-xs btn-link p-0 ide-snip-pin-toggle ${isPinned ? 'text-warning' : 'text-muted'}" data-id="${s.id}" title="${isPinned ? 'Bỏ ghim' : 'Ghim ưu tiên lên đầu'}" style="line-height: 1; border: none; background: none;">
                                <i class="fa-${isPinned ? 'solid' : 'regular'} fa-star"></i>
                            </button>
                            <i class="fa-solid fa-chevron-right text-muted" style="font-size: 9px; opacity: 0.5;"></i>
                        </div>
                    </div>
                `;
            }).join('');

            listEl.querySelectorAll('.ide-snip-item').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('.ide-snip-pin-toggle')) return;
                    const id = el.dataset.id;
                    this.selectSnippet(id);
                });
            });

            listEl.querySelectorAll('.ide-snip-pin-toggle').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = btn.dataset.id;
                    this.togglePinSnippet(id, e);
                });
            });
        },

        async togglePinSnippet(id, e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const snip = _snippets.find(s => s.id === id);
            if (!snip) return;
            snip.isPinned = !snip.isPinned;
            snip.updatedAt = Date.now();

            _snippets.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (a.prefix || '').localeCompare(b.prefix || ''));

            if (window.AppStorage && typeof window.AppStorage.saveSnippets === 'function') {
                await window.AppStorage.saveSnippets(_snippets);
            }

            this.renderTagCloud();
            const searchInput = _modalEl ? _modalEl.querySelector('#ide-snip-search') : null;
            this.renderList(searchInput ? searchInput.value : '');
            if (_activeSnippetId === id) {
                this.selectSnippet(id);
            }
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
            const dbTypeSelect = _modalEl.querySelector('#ide-snip-db-type');
            const tagsInput = _modalEl.querySelector('#ide-snip-tags');
            const pinnedInput = _modalEl.querySelector('#ide-snip-pinned');
            const bodyInput = _modalEl.querySelector('#ide-snip-body');
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');
            const btnDelete = _modalEl.querySelector('#ide-snip-btn-delete');

            if (prefixInput) prefixInput.value = snip.prefix || '';
            if (descInput) descInput.value = snip.description || '';
            if (dbTypeSelect) dbTypeSelect.value = this.normalizeDbType(snip.dbType);
            if (tagsInput) {
                const tagList = Array.isArray(snip.tags) ? snip.tags : [];
                tagsInput.value = tagList.join(', ');
            }
            if (pinnedInput) {
                pinnedInput.checked = Boolean(snip.isPinned);
            }
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
            const dbTypeSelect = _modalEl.querySelector('#ide-snip-db-type');
            const tagsInput = _modalEl.querySelector('#ide-snip-tags');
            const pinnedInput = _modalEl.querySelector('#ide-snip-pinned');
            const bodyInput = _modalEl.querySelector('#ide-snip-body');
            const tbody = _modalEl.querySelector('#ide-snip-vars-tbody');
            const btnDelete = _modalEl.querySelector('#ide-snip-btn-delete');

            if (prefixInput) {
                prefixInput.value = '';
                prefixInput.focus();
            }
            if (descInput) descInput.value = '';
            if (dbTypeSelect) {
                const activeDb = this.normalizeDbType(window.ActiveDbType || (window.AppTabs?.getActiveTabState?.()?.dbType) || 'all');
                dbTypeSelect.value = (activeDb === 'sqlserver' || activeDb === 'postgresql') ? activeDb : 'all';
            }
            if (tagsInput) tagsInput.value = '';
            if (pinnedInput) pinnedInput.checked = false;
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
            const dbTypeSelect = _modalEl.querySelector('#ide-snip-db-type');
            const tagsInput = _modalEl.querySelector('#ide-snip-tags');
            const pinnedInput = _modalEl.querySelector('#ide-snip-pinned');
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

            const dbType = dbTypeSelect ? this.normalizeDbType(dbTypeSelect.value) : 'all';
            const rawTags = tagsInput ? tagsInput.value : '';
            const tags = rawTags.split(',').map(t => t.trim().toLowerCase().replace(/^#+/, '')).filter(Boolean);
            const isPinned = pinnedInput ? Boolean(pinnedInput.checked) : false;

            return {
                id: _activeSnippetId || ('snip_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6)),
                prefix: prefixInput ? prefixInput.value.trim() : '',
                description: descInput ? descInput.value.trim() : '',
                dbType,
                tags,
                isPinned,
                updatedAt: Date.now(),
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

            // Check if prefix conflicts with another snippet for the same dbType or 'all'
            const existingIdx = _snippets.findIndex(s => s.id === data.id);
            const normNewDb = this.normalizeDbType(data.dbType);
            const prefixConflict = _snippets.find(s => {
                if (s.id === data.id) return false;
                if ((s.prefix || '').toLowerCase() !== data.prefix.toLowerCase()) return false;
                const normExistingDb = this.normalizeDbType(s.dbType);
                return normNewDb === 'all' || normExistingDb === 'all' || normNewDb === normExistingDb;
            });
            if (prefixConflict) {
                const confDb = this.normalizeDbType(prefixConflict.dbType).toUpperCase();
                alert(`Prefix "${data.prefix}" đã được sử dụng bởi snippet "${prefixConflict.description}" [${confDb}]. Vui lòng chọn prefix khác!`);
                return;
            }

            if (existingIdx !== -1) {
                _snippets[existingIdx] = data;
            } else {
                _snippets.push(data);
            }

            _snippets.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (a.prefix || '').localeCompare(b.prefix || ''));
            _activeSnippetId = data.id;

            // Save to storage
            if (window.AppStorage && typeof window.AppStorage.saveSnippets === 'function') {
                await window.AppStorage.saveSnippets(_snippets);
            }

            this.renderTagCloud();
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

            this.renderTagCloud();
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
                if (!Array.isArray(_snippets)) _snippets = [];
                _snippets.forEach(s => {
                    if (s.isPinned === undefined) s.isPinned = false;
                    s.dbType = this.normalizeDbType(s.dbType || s.db_type || 'all');
                    if (!Array.isArray(s.tags)) {
                        s.tags = typeof s.tags === 'string' ? s.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
                    }
                });
            } else {
                await this.loadSnippets();
            }
            _snippets.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (a.prefix || '').localeCompare(b.prefix || ''));
            this.renderTagCloud();
            this.renderList();
            if (_snippets.length > 0) {
                this.selectSnippet(_snippets[0].id);
            }
            alert('✓ Đã khôi phục toàn bộ snippet mặc định!');
        },

        // ── Bookmark as Snippet Quick Popover ──────────────────────────────────

        /**
         * Quick Bookmark Popover (Ctrl+Shift+B / Context Menu)
         * Allows bookmarking current SQL selection directly into Snippets with tags, DB type and pin option.
         */
        showBookmarkPopover(targetEd) {
            let ed = targetEd;
            if (!ed) {
                ed = (typeof window.getActiveAppEditor === 'function') ? window.getActiveAppEditor() : window.AppEditor;
            }

            let selectedSQL = '';
            if (ed) {
                const monacoEd = ed.rawEditor || ed.monaco || (ed.getModel ? ed : null);
                if (monacoEd && typeof monacoEd.getSelection === 'function' && typeof monacoEd.getModel === 'function') {
                    const sel = monacoEd.getSelection();
                    if (sel && !sel.isEmpty()) {
                        selectedSQL = monacoEd.getModel().getValueInRange(sel);
                    }
                }
                if (!selectedSQL && typeof ed.getSelection === 'function') {
                    selectedSQL = ed.getSelection() || '';
                }
                if (!selectedSQL && typeof window.getMonacoSelectedOrLineText === 'function' && monacoEd) {
                    selectedSQL = window.getMonacoSelectedOrLineText(monacoEd) || '';
                }
                if (!selectedSQL && typeof ed.getValue === 'function') {
                    selectedSQL = ed.getValue() || '';
                }
            }

            selectedSQL = (selectedSQL || '').trim();
            if (!selectedSQL) {
                alert('Vui lòng chọn (bôi đen) một đoạn mã SQL trong trình soạn thảo trước khi lưu bookmark!');
                return;
            }

            this._ensureBookmarkPopoverDOM();
            if (!_bookmarkPopoverEl) return;

            // Guess initial prefix from first words, e.g. "sel_cust" or "snip_"
            let autoPrefix = '';
            const matchFirst = selectedSQL.match(/^[a-zA-Z]+/);
            if (matchFirst) {
                autoPrefix = matchFirst[0].substring(0, 3).toLowerCase() + '_';
            }

            const prefixInput = _bookmarkPopoverEl.querySelector('#ide-bm-prefix');
            const descInput = _bookmarkPopoverEl.querySelector('#ide-bm-desc');
            const dbTypeSelect = _bookmarkPopoverEl.querySelector('#ide-bm-db-type');
            const tagsInput = _bookmarkPopoverEl.querySelector('#ide-bm-tags');
            const pinInput = _bookmarkPopoverEl.querySelector('#ide-bm-pin');
            const bodyArea = _bookmarkPopoverEl.querySelector('#ide-bm-body');

            if (prefixInput) prefixInput.value = autoPrefix;
            if (descInput) descInput.value = '';
            if (dbTypeSelect) {
                const activeDb = this.normalizeDbType(window.ActiveDbType || (window.AppTabs?.getActiveTabState?.()?.dbType) || 'all');
                dbTypeSelect.value = (activeDb === 'sqlserver' || activeDb === 'postgresql') ? activeDb : 'all';
            }
            if (tagsInput) tagsInput.value = 'bookmark';
            if (pinInput) pinInput.checked = true; // Bookmarked queries are pinned by default
            if (bodyArea) bodyArea.value = selectedSQL;

            _bookmarkPopoverEl.classList.remove('d-none');
            _bookmarkPopoverEl.style.display = 'flex';
            if (prefixInput) {
                prefixInput.focus();
                prefixInput.select();
            }
        },

        hideBookmarkPopover() {
            if (_bookmarkPopoverEl) {
                _bookmarkPopoverEl.classList.add('d-none');
                _bookmarkPopoverEl.style.display = 'none';
            }
        },

        _ensureBookmarkPopoverDOM() {
            _bookmarkPopoverEl = document.getElementById('ide-bookmark-popover-overlay');
            if (_bookmarkPopoverEl) return;

            const overlay = document.createElement('div');
            overlay.id = 'ide-bookmark-popover-overlay';
            overlay.className = 'ide-modal-overlay d-none';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.65); z-index: 10050;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(2px);
            `;

            overlay.innerHTML = `
                <div class="ide-bookmark-popover-window" style="
                    width: 540px; max-width: 95vw;
                    background: var(--ide-bg-sidebar, #252526);
                    border: 1px solid var(--ide-border, #454545);
                    border-radius: 8px; box-shadow: 0 12px 35px rgba(0,0,0,0.6);
                    display: flex; flex-direction: column; overflow: hidden;
                    color: var(--ide-text-main, #cccccc);
                ">
                    <div style="
                        height: 40px; padding: 0 14px; background: var(--ide-bg-toolbar, #202228);
                        border-bottom: 1px solid var(--ide-border, #454545);
                        display: flex; align-items: center; justify-content: space-between;
                        user-select: none; flex-shrink: 0;
                    ">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-bookmark text-warning"></i>
                            <span class="fw-bold" style="font-size: 13px;">Lưu nhanh Bookmark (SQL Snippet)</span>
                        </div>
                        <button id="ide-bm-btn-close" class="btn btn-sm btn-outline-secondary py-0 px-2 border-0 text-muted" style="font-size: 14px;" title="Đóng">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <form id="ide-bm-form" onsubmit="return false;" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                        <div class="row g-2">
                            <div class="col-5">
                                <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                    Từ khóa viết tắt (Prefix) <span class="text-danger">*</span>
                                </label>
                                <input type="text" id="ide-bm-prefix" class="form-control form-control-sm bg-dark text-warning fw-bold font-monospace" placeholder="vd: my_query" required style="font-size: 13px;">
                            </div>
                            <div class="col-7">
                                <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                    Mô tả ngắn gọn <span class="text-danger">*</span>
                                </label>
                                <input type="text" id="ide-bm-desc" class="form-control form-control-sm bg-dark text-light" placeholder="vd: Lấy doanh số tháng này" required style="font-size: 12px;">
                            </div>
                        </div>

                        <div class="row g-2">
                            <div class="col-5">
                                <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                    Tags phân loại (phân cách dấu phẩy)
                                </label>
                                <input type="text" id="ide-bm-tags" class="form-control form-control-sm bg-dark text-light" placeholder="vd: report, sales, bookmark" style="font-size: 12px;">
                            </div>
                            <div class="col-4">
                                <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                    <i class="fa-solid fa-database me-1 text-info"></i>Loại CSDL
                                </label>
                                <select id="ide-bm-db-type" class="form-select form-select-sm bg-dark text-light border-secondary" style="font-size: 11px; height: 30px;">
                                    <option value="all">Tất cả CSDL</option>
                                    <option value="sqlserver">SQL Server</option>
                                    <option value="postgresql">PostgreSQL</option>
                                </select>
                            </div>
                            <div class="col-3 d-flex align-items-end pb-1">
                                <div class="form-check form-switch m-0">
                                    <input class="form-check-input" type="checkbox" id="ide-bm-pin" role="switch" checked>
                                    <label class="form-check-label text-warning small fw-bold" for="ide-bm-pin" style="font-size: 11px; user-select: none;">
                                        <i class="fa-solid fa-star me-1"></i>Ghim
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label class="form-label mb-1" style="font-size: 11px; font-weight: 600; color: var(--ide-text-dim, #999);">
                                Nội dung câu lệnh SQL đã chọn
                            </label>
                            <textarea id="ide-bm-body" class="form-control bg-dark text-light font-monospace" rows="5" style="
                                font-size: 12px; resize: vertical; line-height: 1.4; border-color: var(--ide-border, #454545);
                            " required></textarea>
                        </div>

                        <div class="d-flex align-items-center justify-content-between pt-2 border-top border-secondary mt-1">
                            <span class="text-muted" style="font-size: 11px;">
                                <i class="fa-solid fa-lightbulb text-info me-1"></i>Gõ prefix và bấm <kbd>Tab</kbd> để gọi ra sau này.
                            </span>
                            <div class="d-flex gap-2">
                                <button type="button" id="ide-bm-btn-cancel" class="btn btn-sm btn-secondary" style="font-size: 11px; padding: 4px 12px;">
                                    Hủy
                                </button>
                                <button type="submit" id="ide-bm-btn-save" class="btn btn-sm btn-primary" style="font-size: 11px; padding: 4px 16px;">
                                    <i class="fa-solid fa-bookmark me-1"></i>Lưu Bookmark
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(overlay);
            _bookmarkPopoverEl = overlay;

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.hideBookmarkPopover();
            });

            overlay.querySelector('#ide-bm-btn-close').addEventListener('click', () => this.hideBookmarkPopover());
            overlay.querySelector('#ide-bm-btn-cancel').addEventListener('click', () => this.hideBookmarkPopover());

            overlay.querySelector('#ide-bm-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                await this._saveBookmarkFromPopover();
            });
        },

        async _saveBookmarkFromPopover() {
            if (!_bookmarkPopoverEl) return;
            const prefix = _bookmarkPopoverEl.querySelector('#ide-bm-prefix')?.value?.trim();
            const desc = _bookmarkPopoverEl.querySelector('#ide-bm-desc')?.value?.trim();
            const dbTypeSelect = _bookmarkPopoverEl.querySelector('#ide-bm-db-type');
            const dbType = dbTypeSelect ? this.normalizeDbType(dbTypeSelect.value) : 'all';
            const rawTags = _bookmarkPopoverEl.querySelector('#ide-bm-tags')?.value || '';
            const isPinned = Boolean(_bookmarkPopoverEl.querySelector('#ide-bm-pin')?.checked);
            const body = _bookmarkPopoverEl.querySelector('#ide-bm-body')?.value || '';

            if (!prefix || !body) {
                alert('Vui lòng nhập Prefix và nội dung SQL!');
                return;
            }

            const prefixConflict = _snippets.find(s => {
                if ((s.prefix || '').toLowerCase() !== prefix.toLowerCase()) return false;
                const normExisting = this.normalizeDbType(s.dbType);
                return dbType === 'all' || normExisting === 'all' || dbType === normExisting;
            });
            if (prefixConflict) {
                if (!confirm(`Prefix "${prefix}" đã tồn tại cho snippet "${prefixConflict.description}". Bạn có muốn ghi đè lên snippet này không?`)) {
                    return;
                }
            }

            const tags = rawTags.split(',').map(t => t.trim().toLowerCase().replace(/^#+/, '')).filter(Boolean);

            const newSnippetObj = {
                id: prefixConflict ? prefixConflict.id : ('snip_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6)),
                prefix,
                description: desc || prefix,
                dbType,
                tags,
                isPinned,
                updatedAt: Date.now(),
                body,
                placeholders: prefixConflict && Array.isArray(prefixConflict.placeholders) ? prefixConflict.placeholders : []
            };

            if (prefixConflict) {
                const idx = _snippets.findIndex(s => s.id === prefixConflict.id);
                if (idx !== -1) _snippets[idx] = newSnippetObj;
            } else {
                _snippets.push(newSnippetObj);
            }

            _snippets.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0) || (a.prefix || '').localeCompare(b.prefix || ''));

            if (window.AppStorage && typeof window.AppStorage.saveSnippets === 'function') {
                await window.AppStorage.saveSnippets(_snippets);
            }

            this.hideBookmarkPopover();
            if (_modalEl && !_modalEl.classList.contains('d-none')) {
                this.renderTagCloud();
                this.renderList();
                this.selectSnippet(newSnippetObj.id);
            }

            if (window.showToast) {
                window.showToast(`✓ Đã lưu bookmark snippet "${prefix}"!`, 'success');
            } else {
                alert(`✓ Đã lưu bookmark snippet "${prefix}"!`);
            }
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
