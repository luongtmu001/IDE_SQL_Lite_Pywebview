/**
 * syntax-catalog.js
 * Main Window Controller for Cross-Database Syntax Reference & Compare.
 * Dispatches requests to open the standalone desktop subwindow via pywebview IPC.
 * Strictly Zero Inline CSS Compliant.
 */

(function (window) {
    'use strict';

    let _isOpeningSubwindow = false;

    /**
     * Resolves the current database dialect from active tab or global state.
     * Normalizes to either 'postgresql' or 'sqlserver'.
     */
    function getActiveDialect() {
        let db = null;
        if (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function') {
            const state = window.AppTabs.getActiveTabState();
            if (state && (state.dbType || state.database_type)) {
                db = state.dbType || state.database_type;
            }
        }
        if (!db && window.ActiveDbType) {
            db = window.ActiveDbType;
        }
        const s = String(db || '').toLowerCase();
        if (s.includes('postgr') || s === 'pg') {
            return 'postgresql';
        }
        if (s.includes('sqlserver') || s === 'mssql' || s.includes('sql_server')) {
            return 'sqlserver';
        }
        return 'postgresql'; // Default
    }

    /**
     * Returns the counterpart target dialect for bidirectional comparison.
     */
    function getOppositeDialect(dialect) {
        return dialect === 'postgresql' ? 'sqlserver' : 'postgresql';
    }

    /**
     * Open or focus the Syntax Reference & Compare subwindow with initial context.
     * @param {string|Object} optionsOrQuery - Filter options object or search query string
     * @param {string|null} initialDb - Optional database filter override
     */
    async function openSyntaxReferenceWindow(optionsOrQuery = '', initialDb = null) {
        // Prevent concurrent double-clicks or rapid trigger bounce
        if (_isOpeningSubwindow) {
            return;
        }
        _isOpeningSubwindow = true;
        setTimeout(() => {
            _isOpeningSubwindow = false;
        }, 600);

        try {
            let payload = {};
            if (typeof optionsOrQuery === 'object' && optionsOrQuery !== null) {
                payload = { ...optionsOrQuery };
            } else if (typeof optionsOrQuery === 'string') {
                payload = {
                    view: 'reference',
                    query: optionsOrQuery || '',
                    database: initialDb || getActiveDialect() || 'all'
                };
            }

            // Ensure source_db and target_db are set if opening compare view
            if (payload.view === 'compare' || payload.sql_text) {
                if (!payload.source_db) {
                    payload.source_db = initialDb || getActiveDialect();
                }
                if (!payload.target_db) {
                    payload.target_db = getOppositeDialect(payload.source_db);
                }
            }

            let api = window.pywebview?.api;
            if (!api && typeof window.waitForPywebview === 'function') {
                api = await window.waitForPywebview();
            }

            if (api && typeof api.open_syntax_reference_window === 'function') {
                await api.open_syntax_reference_window(payload);
            } else {
                console.warn('[SyntaxCatalog] open_syntax_reference_window API not available');
            }
        } catch (err) {
            console.error('[SyntaxCatalog] Failed to open syntax reference window:', err);
        }
    }

    /**
     * Extract active text selection from Monaco Editor and dispatch to Compare Screen.
     * Strictly preserves original editor contents (read-only inspect).
     * Handles empty or whitespace selection gracefully without throwing errors.
     * @param {Object} [ed] - Optional Monaco editor instance
     */
    function compareSelectionFromEditor(ed) {
        let editor = ed;
        if (!editor) {
            if (window.AppEditor && typeof window.AppEditor.getActiveMonacoInstance === 'function') {
                editor = window.AppEditor.getActiveMonacoInstance();
            } else if (window.editor) {
                editor = window.editor;
            }
        }

        let selectedText = '';
        if (editor && typeof editor.getSelection === 'function' && typeof editor.getModel === 'function') {
            const sel = editor.getSelection();
            if (sel && !sel.isEmpty()) {
                selectedText = editor.getModel().getValueInRange(sel) || '';
            }
        }

        const sourceDb = getActiveDialect();
        const targetDb = getOppositeDialect(sourceDb);

        if (selectedText && selectedText.trim().length > 0) {
            // Non-empty selection -> Open Compare Screen with highlighted SQL
            openSyntaxReferenceWindow({
                view: 'compare',
                sql_text: selectedText.trim(),
                source_db: sourceDb,
                target_db: targetDb
            });
        } else {
            // Empty selection -> Check if word exists at cursor position for smart lookup
            let wordAtCursor = '';
            if (editor && typeof editor.getPosition === 'function' && typeof editor.getModel === 'function') {
                const pos = editor.getPosition();
                const wordObj = pos ? editor.getModel().getWordAtPosition(pos) : null;
                if (wordObj && wordObj.word) {
                    wordAtCursor = wordObj.word.trim();
                }
            }

            if (wordAtCursor) {
                // Word found at cursor -> Open Reference view filtered by that keyword
                openSyntaxReferenceWindow({
                    view: 'reference',
                    query: wordAtCursor,
                    database: sourceDb
                });
            } else {
                // Completely empty selection and cursor -> Open Compare view ready for user input
                openSyntaxReferenceWindow({
                    view: 'compare',
                    sql_text: '',
                    source_db: sourceDb,
                    target_db: targetDb
                });
            }
        }
    }

    /**
     * Open Syntax Reference view directly from editor context (e.g. word at cursor).
     * @param {Object} [ed] - Optional Monaco editor instance
     */
    function openReferenceFromEditor(ed) {
        let editor = ed;
        if (!editor) {
            if (window.AppEditor && typeof window.AppEditor.getActiveMonacoInstance === 'function') {
                editor = window.AppEditor.getActiveMonacoInstance();
            } else if (window.editor) {
                editor = window.editor;
            }
        }

        let wordAtCursor = '';
        if (editor && typeof editor.getPosition === 'function' && typeof editor.getModel === 'function') {
            const pos = editor.getPosition();
            const wordObj = pos ? editor.getModel().getWordAtPosition(pos) : null;
            if (wordObj && wordObj.word) {
                wordAtCursor = wordObj.word.trim();
            }
        }

        const activeDb = getActiveDialect();
        openSyntaxReferenceWindow({
            view: 'reference',
            query: wordAtCursor,
            database: activeDb
        });
    }

    function initTriggerButtons() {
        // 1. Pinned Tab strip Reference button (? at head of editor tabs)
        const btnTabRef = document.getElementById('ide-btn-tab-syntax-reference');
        if (btnTabRef) {
            btnTabRef.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openSyntaxReferenceWindow();
            });
        }

        // 2. Action Bar button
        const btnToolbar = document.getElementById('ide-btn-syntax-reference');
        if (btnToolbar) {
            btnToolbar.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openSyntaxReferenceWindow();
            });
        }

        // 3. Overflow menu button
        const btnOverflow = document.getElementById('ide-overflow-btn-syntax-reference');
        if (btnOverflow) {
            btnOverflow.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openSyntaxReferenceWindow();
            });
        }

        // 4. Global delegation for any dynamic trigger
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action="open-syntax-reference"]');
            if (target) {
                e.preventDefault();
                e.stopPropagation();
                openSyntaxReferenceWindow();
            }
            const cmpTarget = e.target.closest('[data-action="compare-syntax-selection"]');
            if (cmpTarget) {
                e.preventDefault();
                e.stopPropagation();
                compareSelectionFromEditor();
            }
        });
    }

    // Export API to global window
    window.openSyntaxReferenceWindow = openSyntaxReferenceWindow;
    window.compareSyntaxSelectionFromEditor = compareSelectionFromEditor;
    window.openSyntaxReferenceFromEditor = openReferenceFromEditor;
    window.SyntaxCatalog = {
        openReference: (query, db) => openSyntaxReferenceWindow({ view: 'reference', query, database: db }),
        openCompare: (sqlText, sourceDb, targetDb) => openSyntaxReferenceWindow({ view: 'compare', sql_text: sqlText, source_db: sourceDb, target_db: targetDb }),
        compareSelectionFromEditor: compareSelectionFromEditor,
        openReferenceFromEditor: openReferenceFromEditor,
        getActiveDialect: getActiveDialect,
        openWindow: openSyntaxReferenceWindow
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTriggerButtons);
    } else {
        initTriggerButtons();
    }

})(window);
