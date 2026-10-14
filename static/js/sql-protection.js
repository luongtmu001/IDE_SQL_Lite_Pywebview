/**
 * SSMSBoost Fatal Actions Guard & SQL Protection Module
 * Detects dangerous table modification statements (DELETE / UPDATE without WHERE, TRUNCATE)
 * and prompts confirmation using the authentic SSMSBoost Fatal Actions Guard dialog.
 */
(function (global) {
    'use strict';

    /**
     * Check if SQL Protection is enabled in configuration
     * Default: 1 (Enabled)
     */
    function isProtectionEnabled() {
        if (global._sqlConfig && global._sqlConfig.sqlprotection !== undefined) {
            const v = global._sqlConfig.sqlprotection;
            return v !== 0 && v !== '0' && v !== false;
        }
        if (global.IDE_SETTINGS && global.IDE_SETTINGS.sql && global.IDE_SETTINGS.sql.sqlprotection !== undefined) {
            const v = global.IDE_SETTINGS.sql.sqlprotection;
            return v !== 0 && v !== '0' && v !== false;
        }
        try {
            const raw = localStorage.getItem('ide-settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.sql && parsed.sql.sqlprotection !== undefined) {
                    const v = parsed.sql.sqlprotection;
                    return v !== 0 && v !== '0' && v !== false;
                }
            }
        } catch (_) {}
        // Default is 1 (Enabled)
        return true;
    }

    /**
     * Robust SQL Lexer / Tokenizer
     * Accurately tracks 1-based line numbers and columns, properly isolates comments,
     * strings, identifiers, and statement boundaries.
     */
    function tokenizeSql(sqlText) {
        if (!sqlText || typeof sqlText !== 'string') return [];
        const tokens = [];
        const len = sqlText.length;
        let i = 0;
        let line = 1;
        let col = 1;

        function peek(offset = 0) {
            return (i + offset < len) ? sqlText[i + offset] : '';
        }

        function advance() {
            const ch = sqlText[i];
            i++;
            if (ch === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
            return ch;
        }

        while (i < len) {
            const startLine = line;
            const startCol = col;
            const ch = sqlText[i];

            // 1. Whitespace
            if (/\s/.test(ch)) {
                advance();
                continue;
            }

            // 2. Single-line comment: --
            if (ch === '-' && peek(1) === '-') {
                advance(); // -
                advance(); // -
                let commentText = '--';
                while (i < len && sqlText[i] !== '\n' && sqlText[i] !== '\r') {
                    commentText += advance();
                }
                tokens.push({ type: 'COMMENT', value: commentText, line: startLine, col: startCol });
                continue;
            }

            // 3. Multi-line comment: /* ... */
            if (ch === '/' && peek(1) === '*') {
                advance(); // /
                advance(); // *
                let commentText = '/*';
                while (i < len) {
                    if (sqlText[i] === '*' && peek(1) === '/') {
                        advance(); // *
                        advance(); // /
                        commentText += '*/';
                        break;
                    }
                    commentText += advance();
                }
                tokens.push({ type: 'COMMENT', value: commentText, line: startLine, col: startCol });
                continue;
            }

            // 4. String literals: '...' or N'...'
            if (ch === '\'' || ((ch === 'N' || ch === 'n') && peek(1) === '\'')) {
                if (ch === 'N' || ch === 'n') advance();
                advance(); // open '
                let strVal = '';
                while (i < len) {
                    if (sqlText[i] === '\'') {
                        if (peek(1) === '\'') {
                            // escaped quote ''
                            advance();
                            strVal += advance();
                        } else {
                            advance(); // closing '
                            break;
                        }
                    } else {
                        strVal += advance();
                    }
                }
                tokens.push({ type: 'STRING', value: strVal, line: startLine, col: startCol });
                continue;
            }

            // 5. Bracket identifiers: [ ... ]
            if (ch === '[') {
                advance(); // [
                let ident = '';
                while (i < len && sqlText[i] !== ']') {
                    ident += advance();
                }
                if (i < len && sqlText[i] === ']') advance();
                tokens.push({ type: 'IDENTIFIER', value: ident, raw: '[' + ident + ']', line: startLine, col: startCol });
                continue;
            }

            // 6. Backtick identifiers: ` ... `
            if (ch === '`') {
                advance(); // `
                let ident = '';
                while (i < len && sqlText[i] !== '`') {
                    ident += advance();
                }
                if (i < len && sqlText[i] === '`') advance();
                tokens.push({ type: 'IDENTIFIER', value: ident, raw: '`' + ident + '`', line: startLine, col: startCol });
                continue;
            }

            // 7. Double-quote identifiers: " ... "
            if (ch === '"') {
                advance(); // "
                let ident = '';
                while (i < len && sqlText[i] !== '"') {
                    ident += advance();
                }
                if (i < len && sqlText[i] === '"') advance();
                tokens.push({ type: 'IDENTIFIER', value: ident, raw: '"' + ident + '"', line: startLine, col: startCol });
                continue;
            }

            // 8. Punctuation / Delimiters
            if (/[;(),.=+\-*/<>]/.test(ch)) {
                const p = advance();
                tokens.push({ type: 'PUNCTUATION', value: p, line: startLine, col: startCol });
                continue;
            }

            // 9. Word / Keyword / Variable / Temp table (#temp, ##temp, @var, names)
            if (/[a-zA-Z0-9_#$@]/.test(ch)) {
                let word = '';
                while (i < len && /[a-zA-Z0-9_#$@]/.test(sqlText[i])) {
                    word += advance();
                }
                tokens.push({
                    type: 'WORD',
                    value: word.toUpperCase(),
                    raw: word,
                    line: startLine,
                    col: startCol
                });
                continue;
            }

            // Any other single character
            tokens.push({ type: 'CHAR', value: advance(), line: startLine, col: startCol });
        }

        return tokens;
    }

    /**
     * Statement starters that indicate the beginning of a new statement
     * when encountered at root nesting level (parenDepth === 0 && caseDepth === 0)
     */
    const STATEMENT_STARTERS = new Set([
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'CREATE', 'ALTER', 'DROP', 'MERGE',
        'EXEC', 'EXECUTE', 'DECLARE',
        'COMMIT', 'ROLLBACK',
        'RETURN', 'IF', 'WHILE', 'PRINT'
    ]);

    /**
     * Non-statement contexts where UPDATE or DELETE keyword is part of a clause or constraint
     */
    const PRECEDING_IGNORE_WORDS = new Set([
        'ON', 'OF', 'FOR', 'BEFORE', 'AFTER', 'THEN'
    ]);

    /**
     * Detects fatal actions in SQL text:
     * - DELETE statement without WHERE clause
     * - UPDATE statement without WHERE clause
     * - TRUNCATE statement
     *
     * Correctly handles multiple statements written in sequence, separated by
     * semicolons (;) or statement delimiters, temp tables (#temp, ##temp),
     * table variables, and CASE...END blocks.
     *
     * @param {string} sqlText - SQL script to analyze
     * @param {number} baseStartLine - 1-based start line of selection in editor (default 1)
     * @returns {Array<{type: string, message: string, line: number, col: number}>}
     */
    function detectFatalSqlActions(sqlText, baseStartLine = 1) {
        if (!sqlText || !sqlText.trim()) return [];

        const allTokens = tokenizeSql(sqlText);
        // Exclude comments from analysis
        const tokens = allTokens.filter(t => t.type !== 'COMMENT');
        const issues = [];

        for (let idx = 0; idx < tokens.length; idx++) {
            const tok = tokens[idx];
            if (tok.type !== 'WORD') continue;

            const prevTok = idx > 0 ? tokens[idx - 1] : null;
            const nextTok = idx + 1 < tokens.length ? tokens[idx + 1] : null;

            // ── 1. TRUNCATE statement ───────────────────────────────────────────
            if (tok.value === 'TRUNCATE') {
                issues.push({
                    type: 'TRUNCATE',
                    message: 'TRUNCATE statement',
                    line: tok.line + (baseStartLine - 1),
                    col: tok.col
                });
                continue;
            }

            // ── 2. DELETE statement ─────────────────────────────────────────────
            if (tok.value === 'DELETE') {
                // Ignore if preceded by ON (ON DELETE CASCADE), INSTEAD OF, BEFORE, AFTER
                if (prevTok && prevTok.type === 'WORD' && PRECEDING_IGNORE_WORDS.has(prevTok.value)) {
                    continue;
                }
                // Ignore function-like DELETE(...)
                if (nextTok && nextTok.value === '(') {
                    continue;
                }

                // Scan forward to check if a root-level WHERE clause exists in this statement
                let parenDepth = 0;
                let caseDepth = 0;
                let hasWhere = false;
                let j = idx + 1;

                while (j < tokens.length) {
                    const t = tokens[j];

                    if (t.value === '(') {
                        parenDepth++;
                    } else if (t.value === ')') {
                        if (parenDepth > 0) parenDepth--;
                    } else if (parenDepth === 0) {
                        if (t.value === 'CASE') {
                            caseDepth++;
                        } else if (t.value === 'END') {
                            if (caseDepth > 0) {
                                caseDepth--;
                            } else {
                                // Root END finishes block/statement
                                break;
                            }
                        } else if (t.value === 'WHERE' && caseDepth === 0) {
                            hasWhere = true;
                        } else if (t.value === ';' || t.value === 'GO') {
                            break;
                        } else if (caseDepth === 0 && t.type === 'WORD' && STATEMENT_STARTERS.has(t.value)) {
                            // A new statement started without a semicolon
                            break;
                        }
                    }
                    j++;
                }

                if (!hasWhere) {
                    issues.push({
                        type: 'DELETE',
                        message: 'DELETE statement without WHERE clause',
                        line: tok.line + (baseStartLine - 1),
                        col: tok.col
                    });
                }
                continue;
            }

            // ── 3. UPDATE statement ─────────────────────────────────────────────
            if (tok.value === 'UPDATE') {
                // Ignore if preceded by ON (ON UPDATE CASCADE), OF (INSTEAD OF UPDATE), FOR (FOR UPDATE), THEN (MERGE)
                if (prevTok && prevTok.type === 'WORD' && PRECEDING_IGNORE_WORDS.has(prevTok.value)) {
                    continue;
                }
                // Ignore UPDATE STATISTICS
                if (nextTok && nextTok.type === 'WORD' && nextTok.value === 'STATISTICS') {
                    continue;
                }
                // Ignore function-like UPDATE(col) in triggers, but allow UPDATE TOP (n)
                if (nextTok && nextTok.value === '(') {
                    continue;
                }

                // Scan forward to check if a root-level WHERE clause exists in this statement
                let parenDepth = 0;
                let caseDepth = 0;
                let hasWhere = false;
                let j = idx + 1;

                while (j < tokens.length) {
                    const t = tokens[j];

                    if (t.value === '(') {
                        parenDepth++;
                    } else if (t.value === ')') {
                        if (parenDepth > 0) parenDepth--;
                    } else if (parenDepth === 0) {
                        if (t.value === 'CASE') {
                            caseDepth++;
                        } else if (t.value === 'END') {
                            if (caseDepth > 0) {
                                caseDepth--;
                            } else {
                                // Root END finishes block/statement
                                break;
                            }
                        } else if (t.value === 'WHERE' && caseDepth === 0) {
                            hasWhere = true;
                        } else if (t.value === ';' || t.value === 'GO') {
                            break;
                        } else if (caseDepth === 0 && t.type === 'WORD' && STATEMENT_STARTERS.has(t.value)) {
                            // A new statement started without a semicolon
                            break;
                        }
                    }
                    j++;
                }

                if (!hasWhere) {
                    issues.push({
                        type: 'UPDATE',
                        message: 'UPDATE statement without WHERE clause',
                        line: tok.line + (baseStartLine - 1),
                        col: tok.col
                    });
                }
                continue;
            }
        }

        // Sort by line number ascending, then column ascending
        issues.sort((a, b) => (a.line - b.line) || (a.col - b.col));
        return issues;
    }

    /**
     * Active state for Fatal Actions Guard modal
     */
    let _activeModalCallbacks = null;
    let _selectedIndex = 0;
    let _currentIssues = [];
    let _activeKeyHandler = null;

    /**
     * Closes the Fatal Actions Guard modal
     */
    function hideFatalActionsGuard() {
        if (_activeKeyHandler) {
            window.removeEventListener('keydown', _activeKeyHandler);
            _activeKeyHandler = null;
        }
        const backdrop = document.getElementById('fatalActionsGuardBackdrop');
        if (backdrop) {
            backdrop.classList.add('d-none');
        }
        _activeModalCallbacks = null;
        _currentIssues = [];
        _selectedIndex = 0;
    }

    /**
     * Shows the authentic SSMSBoost Fatal Actions Guard dialog
     *
     * @param {Array<{type: string, message: string, line: number}>} issues
     * @param {{onContinue: Function, onCancel: Function, onNavigate: Function}} callbacks
     */
    function showFatalActionsGuard(issues, callbacks) {
        if (!issues || issues.length === 0) {
            if (callbacks && typeof callbacks.onContinue === 'function') {
                callbacks.onContinue();
            }
            return;
        }

        _currentIssues = issues;
        _activeModalCallbacks = callbacks || {};
        _selectedIndex = 0;

        const backdrop = document.getElementById('fatalActionsGuardBackdrop');
        if (!backdrop) {
            // Fallback confirmation if backdrop element is missing
            const msgList = issues.map(it => `• [Dòng ${it.line}]: ${it.message}`).join('\n');
            const confirmed = confirm(`CẢNH BÁO PHÁT HIỆN LỆNH NGUY HIỂM TRONG TRUY VẤN:\n\n${msgList}\n\nBạn có chắc chắn muốn TIẾP TỤC thực thi (Yes) hay HỦY BỎ (No)?`);
            if (confirmed) {
                if (callbacks && typeof callbacks.onContinue === 'function') callbacks.onContinue();
            } else {
                if (callbacks && typeof callbacks.onCancel === 'function') callbacks.onCancel();
            }
            return;
        }

        const rowsContainer = document.getElementById('fatalGuardRows');
        if (rowsContainer) {
            rowsContainer.innerHTML = '';
            issues.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'fatal-guard-row' + (idx === 0 ? ' selected' : '');
                row.dataset.index = String(idx);
                row.dataset.line = String(item.line);

                const msgCol = document.createElement('div');
                msgCol.className = 'fatal-guard-col-message';
                msgCol.textContent = item.message;
                msgCol.title = item.message;

                const lineCol = document.createElement('div');
                lineCol.className = 'fatal-guard-col-line';
                lineCol.textContent = String(item.line);

                row.appendChild(msgCol);
                row.appendChild(lineCol);

                // Single click: select row
                row.onclick = () => {
                    _selectedIndex = idx;
                    updateRowSelection();
                };

                // Double click: cancel execution and navigate to code line
                row.ondblclick = () => {
                    const lineNum = item.line;
                    hideFatalActionsGuard();
                    if (_activeModalCallbacks && typeof _activeModalCallbacks.onCancel === 'function') {
                        _activeModalCallbacks.onCancel();
                    }
                    if (_activeModalCallbacks && typeof _activeModalCallbacks.onNavigate === 'function') {
                        _activeModalCallbacks.onNavigate(lineNum);
                    }
                };

                rowsContainer.appendChild(row);
            });
        }

        function updateRowSelection() {
            if (!rowsContainer) return;
            const rows = rowsContainer.querySelectorAll('.fatal-guard-row');
            rows.forEach((r, idx) => {
                if (idx === _selectedIndex) {
                    r.classList.add('selected');
                    r.scrollIntoView({ block: 'nearest' });
                } else {
                    r.classList.remove('selected');
                }
            });
        }

        // Wire up buttons
        const btnYes = document.getElementById('fatalGuardYesBtn');
        const btnNo = document.getElementById('fatalGuardNoBtn');
        const btnClose = document.getElementById('fatalGuardCloseBtn');

        if (btnYes) {
            btnYes.onclick = () => {
                const cb = _activeModalCallbacks;
                hideFatalActionsGuard();
                if (cb && typeof cb.onContinue === 'function') {
                    cb.onContinue();
                }
            };
        }

        if (btnNo) {
            btnNo.onclick = () => {
                const cb = _activeModalCallbacks;
                hideFatalActionsGuard();
                if (cb && typeof cb.onCancel === 'function') {
                    cb.onCancel();
                }
            };
        }

        if (btnClose) {
            btnClose.onclick = () => {
                const cb = _activeModalCallbacks;
                hideFatalActionsGuard();
                if (cb && typeof cb.onCancel === 'function') {
                    cb.onCancel();
                }
            };
        }

        // Keyboard handling: Up/Down arrow, Enter, Escape
        const keyHandler = (e) => {
            if (backdrop.classList.contains('d-none')) {
                window.removeEventListener('keydown', keyHandler);
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                window.removeEventListener('keydown', keyHandler);
                if (btnNo) btnNo.click();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_selectedIndex < _currentIssues.length - 1) {
                    _selectedIndex++;
                    updateRowSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_selectedIndex > 0) {
                    _selectedIndex--;
                    updateRowSelection();
                }
            } else if (e.key === 'Enter') {
                // If focus is specifically on Yes or No, let native click happen.
                // Otherwise if Enter on row: navigate to line & cancel execution.
                if (document.activeElement === btnYes) {
                    return;
                }
                if (document.activeElement === btnNo) {
                    return;
                }
                e.preventDefault();
                const cur = _currentIssues[_selectedIndex];
                if (cur) {
                    const lineNum = cur.line;
                    window.removeEventListener('keydown', keyHandler);
                    hideFatalActionsGuard();
                    if (_activeModalCallbacks && typeof _activeModalCallbacks.onCancel === 'function') {
                        _activeModalCallbacks.onCancel();
                    }
                    if (_activeModalCallbacks && typeof _activeModalCallbacks.onNavigate === 'function') {
                        _activeModalCallbacks.onNavigate(lineNum);
                    }
                }
            }
        };

        if (_activeKeyHandler) {
            window.removeEventListener('keydown', _activeKeyHandler);
            _activeKeyHandler = null;
        }
        _activeKeyHandler = keyHandler;
        window.addEventListener('keydown', keyHandler);

        // Show dialog
        backdrop.classList.remove('d-none');

        // Focus "No" button by default for safety on destructive confirmations
        if (btnNo) {
            btnNo.focus();
        }
    }

    /**
     * Production Environment Safety Confirmation Dialog (Mục 5.1)
     */
    let _prodModalEl = null;
    let _prodModalKeyHandler = null;

    function hideProdSafetyDialog() {
        if (_prodModalKeyHandler) {
            window.removeEventListener('keydown', _prodModalKeyHandler);
            _prodModalKeyHandler = null;
        }
        if (_prodModalEl) {
            _prodModalEl.classList.add('d-none');
        }
    }

    function showProdSafetyDialog(options = {}) {
        const {
            connectionName = '',
            database = '',
            queryType = 'DML / DDL',
            message = '',
            onConfirm = null,
            onCancel = null
        } = options;

        if (!_prodModalEl) {
            _prodModalEl = document.createElement('div');
            _prodModalEl.id = 'ide-prod-safety-dialog';
            _prodModalEl.className = 'position-fixed inset-0 d-none';
            _prodModalEl.style.cssText = 'top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.72);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
            _prodModalEl.innerHTML = `
                <div class="card border-danger shadow-lg" style="width: 520px; max-width: 95vw; background: var(--ide-bg-modal, var(--ide-bg-panel, #252526)); color: var(--ide-text-main, #c7cfcf); border-width: 2px; border-radius: 8px;">
                    <div class="card-header bg-danger text-white d-flex align-items-center justify-content-between py-2 px-3">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-triangle-exclamation fs-5"></i>
                            <strong style="font-size: 14px; letter-spacing: 0.5px;">CẢNH BÁO MÔI TRƯỜNG PRODUCTION</strong>
                        </div>
                        <button type="button" class="btn-close btn-sm" id="prodSafetyCloseBtn" aria-label="Close"></button>
                    </div>
                    <div class="card-body p-3">
                        <div class="d-flex align-items-start gap-3">
                            <div class="rounded-circle bg-danger-subtle text-danger d-flex align-items-center justify-content-center p-3 flex-shrink-0" style="width: 48px; height: 48px;">
                                <i class="fa-solid fa-fire-flame-curved fs-4"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="mb-2">
                                    <span class="badge bg-danger px-2 py-1 me-1 font-monospace" style="font-size: 11px;">PRODUCTION</span>
                                    <span class="badge bg-secondary px-2 py-1 font-monospace" id="prodSafetyQueryType" style="font-size: 11px;">DML / DDL</span>
                                </div>
                                <p class="mb-2 small" style="line-height: 1.5; color: var(--ide-text-main, #c7cfcf);" id="prodSafetyMessage">
                                    Bạn đang thực thi thao tác sửa đổi hoặc cấu trúc trên môi trường PRODUCTION. Thao tác này có thể ảnh hưởng trực tiếp tới dữ liệu thực tế đang vận hành!
                                </p>
                                <div class="p-2 rounded border border-danger-subtle small font-monospace mb-2" style="background: rgba(220,53,69,0.08); font-size: 11px; color: var(--ide-text-main, #c7cfcf);">
                                    <div><strong>Kết nối:</strong> <span id="prodSafetyConn" class="text-warning"></span></div>
                                    <div><strong>Database:</strong> <span id="prodSafetyDb" class="text-info"></span></div>
                                </div>
                                <div class="text-danger small fw-semibold">
                                    <i class="fa-solid fa-shield-halved me-1"></i>Bạn có chắc chắn muốn tiếp tục thực thi không?
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="card-footer d-flex justify-content-end gap-2 py-2 px-3 border-top" style="background: var(--ide-bg-toolbar, #202228); border-color: var(--ide-border, #3c3f41);">
                        <button type="button" class="btn btn-sm btn-secondary px-3" id="prodSafetyCancelBtn">
                            <i class="fa-solid fa-xmark me-1"></i>Hủy bỏ (Esc)
                        </button>
                        <button type="button" class="btn btn-sm btn-danger px-3 fw-semibold" id="prodSafetyConfirmBtn">
                            <i class="fa-solid fa-radiation me-1"></i>Tôi hiểu rủi ro, Thực thi
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(_prodModalEl);
        }

        // Fill contents
        const elConn = _prodModalEl.querySelector('#prodSafetyConn');
        const elDb = _prodModalEl.querySelector('#prodSafetyDb');
        const elType = _prodModalEl.querySelector('#prodSafetyQueryType');
        const elMsg = _prodModalEl.querySelector('#prodSafetyMessage');
        const btnCancel = _prodModalEl.querySelector('#prodSafetyCancelBtn');
        const btnConfirm = _prodModalEl.querySelector('#prodSafetyConfirmBtn');
        const btnClose = _prodModalEl.querySelector('#prodSafetyCloseBtn');

        if (elConn) elConn.textContent = connectionName || 'Chưa xác định';
        if (elDb) elDb.textContent = database || 'Mặc định';
        if (elType) elType.textContent = queryType || 'DML / DDL';
        if (elMsg && message) elMsg.textContent = message;

        // Cleanup previous handlers
        const newCancel = () => {
            hideProdSafetyDialog();
            if (typeof onCancel === 'function') onCancel();
        };
        const newConfirm = () => {
            hideProdSafetyDialog();
            if (typeof onConfirm === 'function') onConfirm();
        };

        if (btnCancel) btnCancel.onclick = newCancel;
        if (btnClose) btnClose.onclick = newCancel;
        if (btnConfirm) btnConfirm.onclick = newConfirm;

        // Key handler
        if (_prodModalKeyHandler) {
            window.removeEventListener('keydown', _prodModalKeyHandler);
        }
        _prodModalKeyHandler = (e) => {
            if (_prodModalEl.classList.contains('d-none')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                newCancel();
            }
        };
        window.addEventListener('keydown', _prodModalKeyHandler);

        // Show dialog and focus Cancel button by default
        _prodModalEl.classList.remove('d-none');
        if (btnCancel) btnCancel.focus();
    }

    /**
     * Switch Session to Read-Write Mode Confirmation Dialog (Mục 5.1)
     */
    let _switchWriteModalEl = null;
    let _switchWriteKeyHandler = null;

    function hideSwitchToWriteModeDialog() {
        if (_switchWriteKeyHandler) {
            window.removeEventListener('keydown', _switchWriteKeyHandler);
            _switchWriteKeyHandler = null;
        }
        if (_switchWriteModalEl) {
            _switchWriteModalEl.classList.add('d-none');
        }
    }

    function showSwitchToWriteModeDialog(options = {}) {
        const {
            connectionId = '',
            connectionName = '',
            database = '',
            environment = '',
            onSuccess = null,
            onCancel = null
        } = options;

        if (!_switchWriteModalEl) {
            _switchWriteModalEl = document.createElement('div');
            _switchWriteModalEl.id = 'ide-switch-write-mode-dialog';
            _switchWriteModalEl.className = 'ide-switch-write-dialog d-none';
            _switchWriteModalEl.innerHTML = `
                <div class="ide-switch-write-card shadow-lg">
                    <div class="card-header bg-warning text-dark d-flex align-items-center justify-content-between py-2 px-3 fw-bold">
                        <div class="d-flex align-items-center gap-2">
                            <i class="fa-solid fa-lock-open fs-5 text-dark"></i>
                            <span style="font-size: 14px; letter-spacing: 0.3px;">XÁC NHẬN CHUYỂN SANG CHẾ ĐỘ GHI (READ-WRITE)</span>
                        </div>
                        <button type="button" class="btn-close btn-sm" id="switchWriteCloseBtn" aria-label="Close"></button>
                    </div>
                    <div class="ide-switch-write-body">
                        <div class="d-flex align-items-start gap-3">
                            <div class="rounded-circle bg-warning-subtle text-warning d-flex align-items-center justify-content-center p-3 flex-shrink-0" style="width: 48px; height: 48px;">
                                <i class="fa-solid fa-pen-to-square fs-4"></i>
                            </div>
                            <div class="flex-grow-1">
                                <div class="mb-2">
                                    <span class="badge bg-warning text-dark px-2 py-1 me-1 font-monospace" style="font-size: 11px;"><i class="fa-solid fa-lock me-1"></i>CHỈ ĐỌC → GHI</span>
                                    <span class="badge bg-secondary px-2 py-1 font-monospace" id="switchWriteEnvBadge" style="font-size: 11px;">DEV</span>
                                </div>
                                <p class="mb-2 small" style="line-height: 1.5; color: var(--ide-text-main, #c7cfcf);">
                                    Phiên làm việc hiện tại đang được đặt ở chế độ <strong>CHỈ ĐỌC (Read-Only)</strong>. Bạn có muốn chuyển phiên này sang <strong>CHẾ ĐỘ GHI (Read-Write)</strong> không?
                                </p>
                                <div class="ide-switch-write-callout mb-2">
                                    <div><strong>Kết nối:</strong> <span id="switchWriteConn" class="text-warning"></span></div>
                                    <div><strong>Database:</strong> <span id="switchWriteDb" class="text-info"></span></div>
                                </div>
                                <div class="text-warning small" style="line-height: 1.4;">
                                    <i class="fa-solid fa-triangle-exclamation me-1"></i>Sau khi xác nhận, các thao tác <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>DDL</code> sẽ được phép thực thi trong phiên làm việc này.
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="ide-switch-write-footer d-flex justify-content-end gap-2">
                        <button type="button" class="btn btn-sm btn-secondary px-3" id="switchWriteCancelBtn">
                            <i class="fa-solid fa-xmark me-1"></i>Hủy bỏ (Esc)
                        </button>
                        <button type="button" class="btn btn-sm btn-warning px-3 fw-bold text-dark" id="switchWriteConfirmBtn">
                            <i class="fa-solid fa-lock-open me-1"></i>Xác nhận chuyển sang Ghi
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(_switchWriteModalEl);
        }

        // Fill contents
        const elConn = _switchWriteModalEl.querySelector('#switchWriteConn');
        const elDb = _switchWriteModalEl.querySelector('#switchWriteDb');
        const elEnv = _switchWriteModalEl.querySelector('#switchWriteEnvBadge');
        const btnCancel = _switchWriteModalEl.querySelector('#switchWriteCancelBtn');
        const btnConfirm = _switchWriteModalEl.querySelector('#switchWriteConfirmBtn');
        const btnClose = _switchWriteModalEl.querySelector('#switchWriteCloseBtn');

        if (elConn) elConn.textContent = connectionName || 'Kết nối hiện tại';
        if (elDb) elDb.textContent = database || 'Mặc định';
        if (elEnv) {
            const envStr = (environment || 'DEV').toUpperCase();
            elEnv.textContent = envStr;
            elEnv.className = envStr === 'PROD' ? 'badge bg-danger text-light px-2 py-1 font-monospace' : (envStr === 'TEST' ? 'badge bg-warning text-dark px-2 py-1 font-monospace' : 'badge bg-primary text-light px-2 py-1 font-monospace');
        }

        const newCancel = () => {
            hideSwitchToWriteModeDialog();
            if (typeof onCancel === 'function') onCancel();
        };

        const newConfirm = async () => {
            btnConfirm.disabled = true;
            btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i>Đang xử lý...';
            try {
                const targetConnId = connectionId || (window.AppTabs ? window.AppTabs.getActiveTabState()?.connectionId : null) || window.ActiveConnectionId;
                const res = await fetch('/api/connection/set_read_only', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ connection_id: targetConnId, read_only: false })
                });
                const data = await res.json();
                if (data.success) {
                    // Update frontend state
                    if (window.AppTabs && typeof window.AppTabs.updateActiveTabContext === 'function') {
                        window.AppTabs.updateActiveTabContext({ read_only: false, readOnly: false });
                    }
                    const curTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
                    if (curTab) {
                        curTab.read_only = false;
                        curTab.readOnly = false;
                    }
                    if (window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                        const activeConns = window.AppExplorer.getActiveConnections() || [];
                        const found = activeConns.find(c => c && String(c.connection_id) === String(targetConnId));
                        if (found) found.read_only = false;
                    }
                    if (typeof window.updateActionBar === 'function') {
                        window.updateActionBar();
                    }
                    if (typeof showToast === 'function') {
                        showToast(`Đã chuyển phiên kết nối sang chế độ GHI (Read-Write).`, 'success');
                    }
                    hideSwitchToWriteModeDialog();
                    if (typeof onSuccess === 'function') {
                        onSuccess();
                    }
                } else {
                    alert(data.error || 'Không thể chuyển sang chế độ Ghi!');
                }
            } catch (err) {
                alert('Lỗi: ' + err.message);
            } finally {
                btnConfirm.disabled = false;
                btnConfirm.innerHTML = '<i class="fa-solid fa-lock-open me-1"></i>Xác nhận chuyển sang Ghi';
            }
        };

        if (btnCancel) btnCancel.onclick = newCancel;
        if (btnClose) btnClose.onclick = newCancel;
        if (btnConfirm) btnConfirm.onclick = newConfirm;

        // Key handler
        if (_switchWriteKeyHandler) {
            window.removeEventListener('keydown', _switchWriteKeyHandler);
        }
        _switchWriteKeyHandler = (e) => {
            if (_switchWriteModalEl.classList.contains('d-none')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                newCancel();
            }
        };
        window.addEventListener('keydown', _switchWriteKeyHandler);

        // Show dialog and focus Confirm button
        _switchWriteModalEl.classList.remove('d-none');
        if (btnConfirm) btnConfirm.focus();
    }

    // Expose globally
    global.SqlProtection = {
        isProtectionEnabled,
        tokenizeSql,
        detectFatalSqlActions,
        showFatalActionsGuard,
        hideFatalActionsGuard,
        showProdSafetyDialog,
        hideProdSafetyDialog,
        showSwitchToWriteModeDialog,
        hideSwitchToWriteModeDialog
    };

})(typeof window !== 'undefined' ? window : global);
