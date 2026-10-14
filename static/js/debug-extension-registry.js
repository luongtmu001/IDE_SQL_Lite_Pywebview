/**
 * Debug Extension Registry & Detector for Web IDE
 * Supports PostgreSQL IDE Debug Extensions (bs.trace, bs.print, bs.assert, bs.watch)
 * Reference: .SKILL/custom_function_debug.md
 */

(function (window) {
    'use strict';

    const DEBUG_EXTENSIONS = {
        'bs.trace': {
            namespace: 'bs',
            command: 'trace',
            dialects: ['postgresql'],
            debugOnly: true,
            capabilities: {
                completion: true,
                parameterHint: true,
                validation: true,
                instrumentation: true,
                resultGrid: true
            }
        },
        'bs.print': {
            namespace: 'bs',
            command: 'print',
            dialects: ['postgresql'],
            debugOnly: true,
            capabilities: {
                instrumentation: true,
                debugOutput: true
            }
        },
        'bs.assert': {
            namespace: 'bs',
            command: 'assert',
            dialects: ['postgresql'],
            debugOnly: true,
            capabilities: {
                instrumentation: true
            }
        },
        'bs.watch': {
            namespace: 'bs',
            command: 'watch',
            dialects: ['postgresql'],
            debugOnly: true,
            capabilities: {
                instrumentation: true
            }
        }
    };

    /**
     * Compute line and column (1-indexed) from character offset in text
     */
    function offsetToLineCol(text, offset) {
        let line = 1;
        let col = 1;
        const len = Math.min(offset, text.length);
        for (let i = 0; i < len; i++) {
            if (text[i] === '\n') {
                line++;
                col = 1;
            } else if (text[i] !== '\r') {
                col++;
            }
        }
        return { line, col };
    }

    /**
     * Detect all bs.* debug extensions in SQL text.
     * Skips comments (-- and /* *\/) and string literals ('...' and $$...$$).
     */
    function detectDebugExtensions(sql) {
        if (!sql || typeof sql !== 'string') return [];
        const matches = [];
        const len = sql.length;
        let i = 0;
        let traceCounter = 0;

        while (i < len) {
            const ch = sql[i];
            const next = i + 1 < len ? sql[i + 1] : '';

            // 1. Single-line comment: -- ...
            if (ch === '-' && next === '-') {
                i += 2;
                while (i < len && sql[i] !== '\n') i++;
                continue;
            }

            // 2. Multi-line comment: /* ... */
            if (ch === '/' && next === '*') {
                i += 2;
                while (i < len - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
                i += 2;
                continue;
            }

            // 3. String literal: '...'
            if (ch === "'") {
                // Check if this single quote is the start of a routine body (e.g. AS '... or DO '...)
                let prev_k = i - 1;
                while (prev_k >= 0 && /\s/.test(sql[prev_k])) {
                    prev_k--;
                }
                const word_end = prev_k + 1;
                while (prev_k >= 0 && /[a-zA-Z0-9_]/.test(sql[prev_k])) {
                    prev_k--;
                }
                const word = prev_k >= -1 ? sql.substring(prev_k + 1, word_end).toUpperCase() : "";

                if (word === "AS" || word === "DO") {
                    // Routine body string! Inspect inside it rather than skipping.
                    i++;
                    continue;
                }

                i++;
                while (i < len) {
                    if (sql[i] === "'") {
                        if (i + 1 < len && sql[i + 1] === "'") {
                            i += 2; // escaped quote ''
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        i++;
                    }
                }
                continue;
            }

            // 4. PostgreSQL Dollar-quoted string: $tag$...$tag$ or $$...$$
            if (ch === '$') {
                let tagEnd = i + 1;
                while (tagEnd < len && /[a-zA-Z0-9_]/.test(sql[tagEnd])) {
                    tagEnd++;
                }
                if (tagEnd < len && sql[tagEnd] === '$') {
                    const tag = sql.substring(i, tagEnd + 1);
                    // Search for closing tag
                    const closeIdx = sql.indexOf(tag, tagEnd + 1);
                    if (closeIdx !== -1) {
                        // Check if inside dollar quotes we have PL/pgSQL function body (do NOT skip if function body!)
                        // A function body usually contains BEGIN...END, so we should inspect inside it!
                        // To be safe: only skip dollar quotes if it's purely a string constant or outside routine body.
                        // We will inspect inside dollar quotes to find bs.trace() inside function definitions!
                        i++;
                        continue;
                    }
                }
            }

            // 5. Check for pattern: bs.<command>(
            if ((ch === 'b' || ch === 'B') && (next === 's' || next === 'S')) {
                // Check word boundary before 'b'
                const prev = i > 0 ? sql[i - 1] : ' ';
                if (!/[a-zA-Z0-9_]/.test(prev)) {
                    let k = i + 2;
                    while (k < len && /\s/.test(sql[k])) k++;
                    if (k < len && sql[k] === '.') {
                        k++;
                        while (k < len && /\s/.test(sql[k])) k++;
                        let cmdStart = k;
                        while (k < len && /[a-zA-Z0-9_]/.test(sql[k])) k++;
                        const cmd = sql.substring(cmdStart, k).toLowerCase();

                        if (cmd) {
                            while (k < len && /\s/.test(sql[k])) k++;
                            if (k < len && sql[k] === '(') {
                                const openParenIdx = k;
                                // Balance parentheses to find the end of bs.<cmd>( ... )
                                let depth = 1;
                                k++;
                                let inStr = false;
                                let inComment = false;

                                while (k < len && depth > 0) {
                                    const c = sql[k];
                                    const n = k + 1 < len ? sql[k + 1] : '';

                                    if (!inStr && !inComment) {
                                        if (c === '-' && n === '-') {
                                            inComment = 'line';
                                            k += 2;
                                            continue;
                                        } else if (c === '/' && n === '*') {
                                            inComment = 'block';
                                            k += 2;
                                            continue;
                                        } else if (c === "'") {
                                            inStr = true;
                                            k++;
                                            continue;
                                        } else if (c === '(') {
                                            depth++;
                                        } else if (c === ')') {
                                            depth--;
                                            if (depth === 0) break;
                                        }
                                    } else if (inComment === 'line') {
                                        if (c === '\n') inComment = false;
                                    } else if (inComment === 'block') {
                                        if (c === '*' && n === '/') {
                                            inComment = false;
                                            k += 2;
                                            continue;
                                        }
                                    } else if (inStr) {
                                        if (c === "'") {
                                            if (n === "'") k += 2;
                                            else inStr = false;
                                        }
                                    }
                                    k++;
                                }

                                const closeParenIdx = k;
                                const rawText = sql.substring(i, closeParenIdx + 1);
                                const innerContent = sql.substring(openParenIdx + 1, closeParenIdx).trim();

                                traceCounter++;
                                const startLoc = offsetToLineCol(sql, i);
                                const endLoc = offsetToLineCol(sql, closeParenIdx + 1);

                                matches.push({
                                    name: `bs.${cmd}`,
                                    namespace: 'bs',
                                    command: cmd,
                                    sourceTraceId: `trace_${traceCounter}`,
                                    sourceOrder: traceCounter,
                                    startOffset: i,
                                    endOffset: closeParenIdx + 1,
                                    startLine: startLoc.line,
                                    startCol: startLoc.col,
                                    endLine: endLoc.line,
                                    endCol: endLoc.col,
                                    rawText: rawText,
                                    innerContent: innerContent
                                });

                                i = closeParenIdx + 1;
                                continue;
                            }
                        }
                    }
                }
            }

            i++;
        }

        return matches;
    }

    /**
     * Comment out all detected bs.* calls in the SQL text.
     * Uses line-by-line prefix '-- ' so no multi-line comment collisions can occur.
     * Preserves exact line numbers of all other code!
     */
    function commentOutDebugExtensions(sql, matches = null) {
        if (!sql || typeof sql !== 'string') return { newSql: sql, count: 0 };
        const items = matches || detectDebugExtensions(sql);
        if (!items || items.length === 0) return { newSql: sql, count: 0 };

        // Sort reverse by startOffset so replacement indices do not shift
        const sorted = [...items].sort((a, b) => b.startOffset - a.startOffset);
        let result = sql;

        for (const item of sorted) {
            const originalBlock = sql.substring(item.startOffset, item.endOffset);
            // Comment each line of the block with '-- '
            const lines = originalBlock.split('\n');
            const commentedLines = lines.map((line, idx) => {
                const trimmed = line.trimStart();
                if (trimmed.startsWith('--')) return line; // already commented
                // Retain leading whitespace before adding '-- '
                const indent = line.substring(0, line.length - trimmed.length);
                return `${indent}-- ${trimmed}`;
            });
            const commentedBlock = commentedLines.join('\n');
            result = result.substring(0, item.startOffset) + commentedBlock + result.substring(item.endOffset);
        }

        return { newSql: result, count: items.length };
    }

    /**
     * Interactive Warning Modal when bs.* is detected in Normal Mode (Run / F5)
     */
    function showNormalModeWarningModal(matches, { onCommentAndRun, onSwitchToDebug, onNavigate, onCancel } = {}) {
        const modalEl = document.getElementById('ide-modal-debug-extension-warning');
        if (!modalEl) {
            // Fallback confirm if modal HTML is not mounted
            const ok = window.confirm(
                `Phát hiện ${matches.length} IDE Debug Extension (bs.*) trong mã nguồn.\n` +
                `Các hàm này chỉ hoạt động trong chế độ Run Debug.\n\n` +
                `Bấm [OK] để tự động Comment hết bs.* và Chạy tiếp.\n` +
                `Bấm [Cancel] để dừng lại.`
            );
            if (ok && typeof onCommentAndRun === 'function') {
                onCommentAndRun();
            } else if (!ok && typeof onCancel === 'function') {
                onCancel();
            }
            return;
        }

        // Ensure modal is styled above all backdrops and fatal actions guard (100000)
        modalEl.style.zIndex = '100050';

        const listEl = document.getElementById('ide-debug-ext-locations-list');
        if (listEl) {
            listEl.innerHTML = '';
            matches.forEach((m, idx) => {
                const a = document.createElement('a');
                a.href = '#';
                a.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3 bg-dark text-light border-secondary';
                a.style.cursor = 'pointer';

                const shortContent = (m.innerContent || '').replace(/\s+/g, ' ').substring(0, 50);
                a.innerHTML = `
                    <div>
                        <span class="badge bg-warning text-dark me-2 font-monospace">${m.name}</span>
                        <span class="small font-monospace text-info">${m.name}(${shortContent}${(m.innerContent || '').length > 50 ? '...' : ''})</span>
                    </div>
                    <span class="badge bg-secondary text-light font-monospace">Line ${m.startLine}:${m.startCol}</span>
                `;

                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof onNavigate === 'function') {
                        onNavigate(m.startLine, m.startCol, m.endLine, m.endCol);
                    }
                });

                listEl.appendChild(a);
            });
        }

        const bs = (typeof bootstrap !== 'undefined' ? bootstrap : (window.bootstrap || null));
        let bsModal = null;
        if (bs && bs.Modal) {
            try {
                bsModal = bs.Modal.getOrCreateInstance(modalEl, { backdrop: 'static', keyboard: true });
            } catch (_) {}
        }

        let actionTriggered = false;

        const hideModal = (reason = 'dismiss') => {
            if (bsModal) {
                try { bsModal.hide(); } catch (_) {}
            }
            modalEl.classList.remove('show');
            modalEl.style.display = 'none';
            modalEl.setAttribute('aria-hidden', 'true');
            // Clean up any remaining backdrop elements
            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');

            if (!actionTriggered && reason === 'dismiss' && typeof onCancel === 'function') {
                actionTriggered = true;
                onCancel();
            }
        };

        // Wire Comment & Run button
        const btnComment = document.getElementById('ide-btn-ext-comment-and-run');
        if (btnComment) {
            btnComment.onclick = () => {
                actionTriggered = true;
                hideModal('comment');
                if (typeof onCommentAndRun === 'function') {
                    onCommentAndRun();
                }
            };
        }

        // Wire Switch to Run Debug button
        const btnDebug = document.getElementById('ide-btn-ext-switch-debug');
        if (btnDebug) {
            btnDebug.onclick = () => {
                actionTriggered = true;
                hideModal('debug');
                if (typeof onSwitchToDebug === 'function') {
                    onSwitchToDebug();
                }
            };
        }

        // Wire dismiss buttons
        modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                hideModal('dismiss');
            };
        });

        // Listen for backdrop styling and modal dismissal
        const onShownHandler = () => {
            modalEl.removeEventListener('shown.bs.modal', onShownHandler);
            document.querySelectorAll('.modal-backdrop').forEach(b => {
                b.style.zIndex = '100040';
            });
        };
        modalEl.addEventListener('shown.bs.modal', onShownHandler);

        const onHiddenHandler = () => {
            modalEl.removeEventListener('hidden.bs.modal', onHiddenHandler);
            if (!actionTriggered && typeof onCancel === 'function') {
                actionTriggered = true;
                onCancel();
            }
        };
        modalEl.addEventListener('hidden.bs.modal', onHiddenHandler);

        // Show Bootstrap Modal or direct show fallback
        if (bsModal) {
            try {
                bsModal.show();
            } catch (_) {
                modalEl.classList.add('show');
                modalEl.style.display = 'block';
                modalEl.removeAttribute('aria-hidden');
            }
        } else {
            modalEl.classList.add('show');
            modalEl.style.display = 'block';
            modalEl.removeAttribute('aria-hidden');
        }
    }

    // Export API
    window.DebugExtensionRegistry = {
        DEBUG_EXTENSIONS,
        detectDebugExtensions,
        commentOutDebugExtensions,
        showNormalModeWarningModal,
        isSupported: (dbType) => {
            if (!dbType) return false;
            const norm = String(dbType).trim().toLowerCase();
            return norm === 'postgresql' || norm === 'postgres' || norm === 'pg' || norm.includes('postgr');
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
