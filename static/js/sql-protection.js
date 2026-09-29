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

    // Expose globally
    global.SqlProtection = {
        isProtectionEnabled,
        tokenizeSql,
        detectFatalSqlActions,
        showFatalActionsGuard,
        hideFatalActionsGuard
    };

})(typeof window !== 'undefined' ? window : global);
