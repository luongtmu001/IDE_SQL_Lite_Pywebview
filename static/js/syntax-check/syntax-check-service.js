/**
 * Syntax Check Service for Monaco Editor
 * Manages debounce (500ms), request versioning, AbortController, tab isolation,
 * and marker application with fixed owner 'syntax-check'.
 * Reference: .SKILL/sytax_check.md
 */

(function (window) {
    'use strict';

    const MARKER_OWNER = 'syntax-check';
    const DEBOUNCE_MS = 500;

    let _latestRequestId = 0;
    const _activeControllers = new Map(); // tabId -> AbortController
    const _debounceTimers = new Map();    // tabId -> timerId
    const _attachedModels = new Set();    // Set of model URIs already listening

    let _isEnabled = true;
    try {
        const raw = localStorage.getItem('ide-settings');
        if (raw) {
            const s = JSON.parse(raw);
            if (s && s.editor && s.editor.syntaxCheck !== undefined) {
                _isEnabled = Boolean(s.editor.syntaxCheck);
            }
        }
    } catch (_) {}

    function isEnabled() {
        return _isEnabled;
    }

    function setEnabled(enabled) {
        _isEnabled = Boolean(enabled);
        try {
            const raw = localStorage.getItem('ide-settings');
            const s = raw ? JSON.parse(raw) : {};
            if (!s.editor) s.editor = {};
            s.editor.syntaxCheck = _isEnabled;
            localStorage.setItem('ide-settings', JSON.stringify(s));
            if (window.IDE_SETTINGS) {
                if (!window.IDE_SETTINGS.editor) window.IDE_SETTINGS.editor = {};
                window.IDE_SETTINGS.editor.syntaxCheck = _isEnabled;
            }
        } catch (_) {}

        if (!_isEnabled) {
            _debounceTimers.forEach(t => clearTimeout(t));
            _debounceTimers.clear();
            _activeControllers.forEach(c => {
                try { c.abort(); } catch (_) {}
            });
            _activeControllers.clear();
            if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getModels === 'function') {
                monaco.editor.getModels().forEach(m => clearModelMarkers(m));
            }
        } else {
            triggerManualCheck();
        }
        return _isEnabled;
    }

    function toggleEnabled() {
        return setEnabled(!_isEnabled);
    }

    /**
     * Clear all syntax-check markers for a specific Monaco model
     */
    function clearModelMarkers(model) {
        if (!model || typeof monaco === 'undefined' || !monaco.editor) return;
        try {
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
            if (model._invalidColumnDecorations && typeof model.deltaDecorations === 'function') {
                model._invalidColumnDecorations = model.deltaDecorations(model._invalidColumnDecorations, []);
            }
            if (window.EditorStatusBar && typeof window.EditorStatusBar.updateIssues === 'function') {
                window.EditorStatusBar.updateIssues();
            }
        } catch (_) {}
    }

    /**
     * Execute syntax check via backend API with cancellation and versioning
     */
    async function executeCheck(opts = {}) {
        if (!_isEnabled) {
            if (opts.model) clearModelMarkers(opts.model);
            return;
        }

        let {
            sql,
            dialect,
            connectionId,
            database,
            schema,
            model,
            tabId
        } = opts;

        if (!model || model.isDisposed()) return;

        const tabState = (typeof window.getActiveExecutingTabState === 'function')
            ? window.getActiveExecutingTabState()
            : (window.AppTabs ? window.AppTabs.getActiveTabState() : null);

        // Check model language and tab state language
        const modelLang = (model.getLanguageId ? model.getLanguageId() : '').toLowerCase();
        const tabLanguage = (tabState && (tabState.language || (tabState.tabType === 'structured-data' ? tabState.structuredFormat : null)) || '').toLowerCase();
        const targetLanguage = (opts.language || modelLang || tabLanguage || 'sql').toLowerCase();

        // If XML or JSON model, route to dedicated XML/JSON syntax check extension
        if (targetLanguage === 'xml' || targetLanguage === 'json') {
            if (tabId && _activeControllers.has(tabId)) {
                try {
                    _activeControllers.get(tabId).abort();
                } catch (_) {}
                _activeControllers.delete(tabId);
            }
            if (model._invalidColumnDecorations && typeof model.deltaDecorations === 'function') {
                model._invalidColumnDecorations = model.deltaDecorations(model._invalidColumnDecorations, []);
            }

            const checker = window.StructuredSyntaxChecker;
            if (checker && typeof checker.validateModel === 'function') {
                checker.validateModel(model, targetLanguage);
            } else {
                if (targetLanguage === 'xml') {
                    checkXmlSyntax(model, sql);
                } else {
                    checkJsonSyntax(model, sql);
                }
            }
            return;
        }

        // If no SQL, clear markers
        if (!sql || !sql.trim()) {
            clearModelMarkers(model);
            return;
        }

        const requestId = ++_latestRequestId;

        // Abort previous in-flight request for this tab if any
        if (tabId && _activeControllers.has(tabId)) {
            try {
                _activeControllers.get(tabId).abort();
            } catch (_) {}
            _activeControllers.delete(tabId);
        }

        const controller = new AbortController();
        if (tabId) _activeControllers.set(tabId, controller);

        if (!connectionId) {
            connectionId = (tabState && tabState.connectionId) || window.ActiveConnectionId || null;
        }
        const targetDialect = dialect || (tabState && tabState.dbType) || window.ActiveDbType || 'sqlserver';
        const targetConnId = connectionId;
        const targetDatabase = database || (tabState && tabState.database) || window.ActiveDatabase || null;
        const targetSchema = schema || (tabState && tabState.schema) || window.ActiveSchema || null;
        const normDialect = String(targetDialect).toLowerCase().trim();
        const isPostgres = normDialect.includes('postgres') || normDialect.includes('pgsql') || normDialect === 'pg';

        // Requirement 1 & 2: SQL Server ALWAYS checks syntax (isDebug=false).
        // PostgreSQL only skips bs.* syntax check when in debug mode.
        const isDebug = isPostgres && Boolean(
            (opts && opts.is_debug !== undefined) ? opts.is_debug : (
                Boolean(tabState && tabState.isDebugActive) ||
                Boolean(document.getElementById('ide-btn-run-debug')?.classList.contains('active')) ||
                Boolean(document.getElementById('ide-btn-run')?.classList.contains('is-debug-mode'))
            )
        );

        // Collect any client-cached tables referenced in the query to accelerate validation
        let clientCachedTables = null;
        const metaCache = window.AppMetadataCache || window.MetadataCache;
        if (metaCache) {
            try {
                const tblRegex = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([#@\w\."\[\]]+)/gi;
                let tm;
                while ((tm = tblRegex.exec(sql)) !== null) {
                    const originalTblStr = tm[1];
                    let tblRaw = originalTblStr.replace(/[\[\]"']/g, '').trim();
                    let schemaPart = targetSchema;
                    let dbPart = targetDatabase;
                    if (tblRaw.includes('.')) {
                        const parts = tblRaw.split('.');
                        if (parts.length === 2) {
                            schemaPart = parts[0];
                            tblRaw = parts[1];
                        } else if (parts.length >= 3) {
                            dbPart = parts[parts.length - 3] || targetDatabase;
                            schemaPart = parts[parts.length - 2];
                            tblRaw = parts[parts.length - 1];
                        }
                    }
                    if (tblRaw && !tblRaw.startsWith('@') && !tblRaw.startsWith('#')) {
                        let cols = null;
                        if (typeof metaCache.getColumns === 'function') {
                            cols = metaCache.getColumns(targetConnId, dbPart, schemaPart, tblRaw)
                                || metaCache.getColumns(targetConnId, dbPart, null, tblRaw)
                                || metaCache.getColumns(targetConnId, null, null, tblRaw);
                        }

                        // Also search storage tier cache if not hit by exact key
                        const cacheMap = metaCache.columnsTier ? (metaCache.columnsTier.lru ? metaCache.columnsTier.lru.cache : (metaCache.columnsTier.cache || null)) : null;
                        if (!cols && cacheMap && typeof cacheMap.entries === 'function') {
                            const lowTbl = tblRaw.toLowerCase();
                            for (const [k, v] of cacheMap.entries()) {
                                if (k && k.toLowerCase().endsWith(`::${lowTbl}`) && v && v.data) {
                                    cols = v.data;
                                    break;
                                }
                            }
                        }

                        if (cols && Array.isArray(cols) && cols.length > 0) {
                            if (!clientCachedTables) clientCachedTables = {};
                            const colNames = cols.map(c => (typeof c === 'string' ? c : (c.name || '')));
                            clientCachedTables[tblRaw] = colNames;
                            if (schemaPart) {
                                clientCachedTables[`${schemaPart}.${tblRaw}`] = colNames;
                            }
                            clientCachedTables[originalTblStr] = colNames;
                        }
                    }
                }
            } catch (_) {}
        }

        try {
            const res = await fetch('/api/query/syntax-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    connection_id: connectionId || null,
                    tab_id: tabId || null,
                    sql: sql,
                    dialect: targetDialect,
                    database: targetDatabase,
                    schema: targetSchema,
                    is_debug: isDebug,
                    cached_tables: clientCachedTables
                })
            });

            const data = await res.json();

            // Stale request check: ignore if a newer request was dispatched or model was disposed
            if (requestId !== _latestRequestId || model.isDisposed()) {
                return;
            }

            if (tabId) _activeControllers.delete(tabId);

            if (!data || !data.success) {
                // Connection or server error: do not mark document as SQL syntax error (Rule 21)
                clearModelMarkers(model);
                return;
            }

            const rawDiagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
            const markers = [];

            rawDiagnostics.forEach(d => {
                const line = d.line || 1;
                const col = d.column || d.col || 1;
                const token = d.token || '';
                const range = (window.SqlPositionMapper && typeof window.SqlPositionMapper.expandTokenRange === 'function')
                    ? window.SqlPositionMapper.expandTokenRange(sql, line, col, token)
                    : { startLine: line, startColumn: col, endLine: line, endColumn: col + Math.max(1, token.length) };

                const diagnostic = window.SqlDiagnosticModel.createDiagnostic({
                    severity: d.severity || 'error',
                    message: d.message || 'Syntax error',
                    code: d.code || 'SQL_SYNTAX_ERROR',
                    source: d.source || dialect || 'sql',
                    startLine: range.startLine,
                    startColumn: range.startColumn,
                    endLine: range.endLine,
                    endColumn: range.endColumn,
                    token: token
                });

                const marker = diagnostic.toMonacoMarker(window.monaco);
                if (marker) markers.push(marker);
            });

            // Set markers on Monaco model
            monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);

            // Apply inline decorations for invalid columns
            const invalidDecorations = [];
            rawDiagnostics.forEach(d => {
                if (d.code === 'SQL_INVALID_COLUMN') {
                    const line = d.line || 1;
                    const col = d.column || d.col || 1;
                    const endCol = d.end_column || (col + Math.max(1, (d.token || '').length));
                    invalidDecorations.push({
                        range: new monaco.Range(line, col, line, endCol),
                        options: {
                            inlineClassName: 'ide-sql-invalid-column',
                            hoverMessage: { value: `**Cảnh báo cột không tồn tại:** ${d.message}` }
                        }
                    });
                }
            });

            if (typeof model.deltaDecorations === 'function') {
                model._invalidColumnDecorations = model.deltaDecorations(
                    model._invalidColumnDecorations || [],
                    invalidDecorations
                );
            }

            // Update status bar issue counter
            if (window.EditorStatusBar && typeof window.EditorStatusBar.updateIssues === 'function') {
                window.EditorStatusBar.updateIssues();
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                // Request cancelled by newer typing, do nothing
                return;
            }
            // Non-critical network error
            console.warn('[SyntaxCheck] check error:', err);
        }
    }

    /**
     * Schedule a check with debounce
     */
    function scheduleCheck(opts = {}, delay = DEBOUNCE_MS) {
        if (!_isEnabled) {
            if (opts && opts.model) clearModelMarkers(opts.model);
            return;
        }

        const tabId = opts.tabId || 'active';

        // Clear existing debounce timer for this tab
        if (_debounceTimers.has(tabId)) {
            clearTimeout(_debounceTimers.get(tabId));
            _debounceTimers.delete(tabId);
        }

        if (delay <= 0) {
            executeCheck(opts);
        } else {
            const timer = setTimeout(() => {
                _debounceTimers.delete(tabId);
                executeCheck(opts);
            }, delay);
            _debounceTimers.set(tabId, timer);
        }
    }

    /**
     * Attach syntax checking to a Monaco Editor instance and its model
     */
    function attachEditor(editorWrapper) {
        if (!editorWrapper) return;
        const ed = editorWrapper.rawEditor || (typeof editorWrapper.getMonacoInstance === 'function' ? editorWrapper.getMonacoInstance() : editorWrapper);
        if (!ed || typeof ed.getModel !== 'function') return;

        function bindModel(model) {
            if (!model) return;
            const uriStr = model.uri ? model.uri.toString() : '';
            if (_attachedModels.has(uriStr)) return;
            _attachedModels.add(uriStr);

            model.onDidChangeContent(() => {
                const tabState = (typeof window.getActiveExecutingTabState === 'function')
                    ? window.getActiveExecutingTabState()
                    : (window.AppTabs ? window.AppTabs.getActiveTabState() : null);
                const tabId = (window.AppTabs && typeof window.AppTabs.getActiveTabId === 'function')
                    ? window.AppTabs.getActiveTabId()
                    : 'active';

                const connId = (tabState && tabState.connectionId) || window.ActiveConnectionId;
                const dbType = (tabState && tabState.dbType) || window.ActiveDbType || 'sqlserver';
                const database = (tabState && tabState.database) || window.ActiveDatabase;
                const schema = (tabState && tabState.schema) || window.ActiveSchema;

                const isPostgres = String(dbType).toLowerCase().includes('postgres') || String(dbType).toLowerCase().includes('pgsql') || String(dbType).toLowerCase() === 'pg';
                const isDebugActive = isPostgres && Boolean(
                    (tabState && tabState.isDebugActive) ||
                    (document.getElementById('ide-btn-run-debug')?.classList.contains('active')) ||
                    (document.getElementById('ide-btn-run')?.classList.contains('is-debug-mode'))
                );

                const modelLang = (model.getLanguageId ? model.getLanguageId() : '').toLowerCase();
                const tabLang = (tabState && (tabState.language || (tabState.tabType === 'structured-data' ? tabState.structuredFormat : null)) || '').toLowerCase();
                const targetLanguage = modelLang || tabLang || 'sql';

                scheduleCheck({
                    sql: model.getValue(),
                    dialect: dbType,
                    connectionId: connId,
                    database: database,
                    schema: schema,
                    model: model,
                    tabId: tabId,
                    language: targetLanguage,
                    is_debug: isDebugActive
                }, DEBOUNCE_MS);
            });
        }

        const initialModel = ed.getModel();
        if (initialModel) {
            bindModel(initialModel);
            if (_isEnabled && initialModel.getValue && initialModel.getValue().trim()) {
                setTimeout(triggerManualCheck, 200);
            }
        }

        if (typeof ed.onDidChangeModel === 'function') {
            ed.onDidChangeModel((e) => {
                if (e.newModelUrl) {
                    const newModel = ed.getModel();
                    bindModel(newModel);
                }
            });
        }
    }

    /**
     * Run immediate manual check (e.g. on Ctrl+F5 or Parse button click)
     */
    function triggerManualCheck() {
        const targetEd = (typeof window.getActiveAppEditor === 'function')
            ? window.getActiveAppEditor()
            : window.AppEditor;
        if (!targetEd) return;

        const ed = targetEd.rawEditor || (typeof targetEd.getMonacoInstance === 'function' ? targetEd.getMonacoInstance() : targetEd);
        if (!ed || typeof ed.getModel !== 'function') return;

        const model = ed.getModel();
        if (!model) return;

        const tabState = (typeof window.getActiveExecutingTabState === 'function')
            ? window.getActiveExecutingTabState()
            : (window.AppTabs ? window.AppTabs.getActiveTabState() : null);
        const tabId = (window.AppTabs && typeof window.AppTabs.getActiveTabId === 'function')
            ? window.AppTabs.getActiveTabId()
            : 'active';

        const connId = (tabState && tabState.connectionId) || window.ActiveConnectionId;
        const dbType = (tabState && tabState.dbType) || window.ActiveDbType || 'sqlserver';
        const database = (tabState && tabState.database) || window.ActiveDatabase;
        const schema = (tabState && tabState.schema) || window.ActiveSchema;

        const isPostgres = String(dbType).toLowerCase().includes('postgres') || String(dbType).toLowerCase().includes('pgsql') || String(dbType).toLowerCase() === 'pg';
        const isDebugActive = isPostgres && Boolean(
            (tabState && tabState.isDebugActive) ||
            (document.getElementById('ide-btn-run-debug')?.classList.contains('active')) ||
            (document.getElementById('ide-btn-run')?.classList.contains('is-debug-mode'))
        );

        const modelLang = (model.getLanguageId ? model.getLanguageId() : '').toLowerCase();
        const tabLang = (tabState && (tabState.language || (tabState.tabType === 'structured-data' ? tabState.structuredFormat : null)) || '').toLowerCase();
        const targetLanguage = modelLang || tabLang || 'sql';

        scheduleCheck({
            sql: model.getValue(),
            dialect: dbType,
            connectionId: connId,
            database: database,
            schema: schema,
            model: model,
            tabId: tabId,
            language: targetLanguage,
            is_debug: isDebugActive
        }, 0); // 0ms = immediate execution
    }

    /**
     * Client-side XML syntax check fallback
     */
    function checkXmlSyntax(model, text) {
        if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) return;
        const checker = window.StructuredSyntaxChecker;
        if (checker && typeof checker.validateModel === 'function') {
            return checker.validateModel(model, 'xml');
        }
        if (!text || !text.trim()) {
            clearModelMarkers(model);
            return;
        }
        if (typeof DOMParser === 'undefined') {
            clearModelMarkers(model);
            return;
        }
        try {
            const parser = new DOMParser();
            let doc = parser.parseFromString(text, 'application/xml');
            let parserErrors = doc.getElementsByTagName('parsererror');
            if (parserErrors && parserErrors.length > 0) {
                const rawErr = parserErrors[0].textContent || 'XML syntax error';
                if (/extra content at the end|multiple root|junk after document element/i.test(rawErr)) {
                    const wrappedDoc = parser.parseFromString(`<__root__>${text}</__root__>`, 'application/xml');
                    const wrappedErrors = wrappedDoc.getElementsByTagName('parsererror');
                    if (!wrappedErrors || wrappedErrors.length === 0) {
                        clearModelMarkers(model);
                        return;
                    }
                    parserErrors = wrappedErrors;
                }
                const errMsg = parserErrors[0].textContent || 'XML syntax error';
                let line = 1;
                let col = 1;
                const m = errMsg.match(/line\s*(\d+)(?:\s*(?:at\s*)?column\s*(\d+))?/i) || errMsg.match(/Line Number\s*(\d+)(?:,\s*Column\s*(\d+))?/i);
                if (m) {
                    line = parseInt(m[1], 10) || 1;
                    col = parseInt(m[2], 10) || 1;
                }
                const cleanMsg = errMsg.split('\n')[0].replace(/^(?:error\s+on\s+line\s+\d+\s+at\s+column\s+\d+:\s*|XML Parsing Error:\s*)/i, '').trim() || 'Lỗi cú pháp XML';
                if (typeof monaco !== 'undefined' && monaco.editor) {
                    monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
                        severity: monaco.MarkerSeverity.Error,
                        message: cleanMsg,
                        startLineNumber: line,
                        startColumn: col,
                        endLineNumber: line,
                        endColumn: col + 1,
                        source: 'xml',
                        code: 'XML_SYNTAX_ERROR'
                    }]);
                }
                if (window.EditorStatusBar && typeof window.EditorStatusBar.updateIssues === 'function') {
                    window.EditorStatusBar.updateIssues();
                }
                return;
            }
            clearModelMarkers(model);
        } catch (_) {
            clearModelMarkers(model);
        }
    }

    /**
     * Client-side JSON syntax check fallback
     */
    function checkJsonSyntax(model, text) {
        if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) return;
        const checker = window.StructuredSyntaxChecker;
        if (checker && typeof checker.validateModel === 'function') {
            return checker.validateModel(model, 'json');
        }
        if (!text || !text.trim()) {
            clearModelMarkers(model);
            return;
        }
        try {
            JSON.parse(text);
            clearModelMarkers(model);
        } catch (e) {
            const errMsg = e.message || 'Lỗi cú pháp JSON';
            let line = 1;
            let col = 1;
            const posMatch = errMsg.match(/at position (\d+)/i);
            if (posMatch) {
                const pos = parseInt(posMatch[1], 10) || 0;
                const prefix = text.slice(0, Math.min(pos, text.length));
                const lines = prefix.split('\n');
                line = lines.length;
                col = lines[lines.length - 1].length + 1;
            } else {
                const lcMatch = errMsg.match(/line\s*(\d+)\s*column\s*(\d+)/i);
                if (lcMatch) {
                    line = parseInt(lcMatch[1], 10) || 1;
                    col = parseInt(lcMatch[2], 10) || 1;
                }
            }
            if (typeof monaco !== 'undefined' && monaco.editor) {
                monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
                    severity: monaco.MarkerSeverity.Error,
                    message: errMsg,
                    startLineNumber: line,
                    startColumn: col,
                    endLineNumber: line,
                    endColumn: col + 1,
                    source: 'json',
                    code: 'JSON_SYNTAX_ERROR'
                }]);
            }
            if (window.EditorStatusBar && typeof window.EditorStatusBar.updateIssues === 'function') {
                window.EditorStatusBar.updateIssues();
            }
        }
    }

    /**
     * Handle Tab Closed: cancel timers, abort request, clear markers
     */
    function handleTabClosed(tabId) {
        if (_debounceTimers.has(tabId)) {
            clearTimeout(_debounceTimers.get(tabId));
            _debounceTimers.delete(tabId);
        }
        if (_activeControllers.has(tabId)) {
            try {
                _activeControllers.get(tabId).abort();
            } catch (_) {}
            _activeControllers.delete(tabId);
        }
    }

    // Export API
    window.SqlSyntaxCheckService = {
        MARKER_OWNER,
        check: scheduleCheck,
        triggerManualCheck,
        attachEditor,
        clearModelMarkers,
        handleTabClosed,
        isEnabled,
        setEnabled,
        toggleEnabled,
        checkXmlSyntax,
        checkJsonSyntax
    };

    window.checkSqlSyntax = triggerManualCheck;

    if (typeof document !== 'undefined') {
        document.addEventListener('ide-tab-closed', (e) => {
            if (e.detail && e.detail.tabId) {
                handleTabClosed(e.detail.tabId);
            }
        });

        document.addEventListener('ide-context-changed', () => {
            if (_isEnabled) {
                setTimeout(triggerManualCheck, 150);
            }
        });

        document.addEventListener('ide-tab-switched', () => {
            if (_isEnabled) {
                setTimeout(triggerManualCheck, 150);
            }
        });
    }

})(typeof window !== 'undefined' ? window : globalThis);

