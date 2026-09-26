/**
 * SQL Editor Controller — Monaco Editor Implementation
 * Fully integrated with AppIntelliSense, SqlContextAnalyzer, AppSnippets, and AppTabs.
 * Ensures pixel-perfect cursor positioning, font metrics remeasurement,
 * and dual-panel IntelliSense autocompletion with ALTER script generation.
 */

(function (window) {
    'use strict';

    let _primaryEditor = null;
    let _secondaryEditor = null;
    let _bufferedValue = '-- Write your SQL query here\nSELECT * FROM ';
    let _activeDbType = 'sqlserver';

    // ── Font Remeasurement Helper ────────────────────────────────────────────────
    function remeasureMonacoFonts() {
        if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.remeasureFonts === 'function') {
            try {
                monaco.editor.remeasureFonts();
            } catch (e) {
                console.warn('[Editor] remeasureFonts error:', e);
            }
        }
    }

    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
        document.fonts.ready.then(remeasureMonacoFonts);
    }
    [50, 150, 300, 600, 1200].forEach(delay => setTimeout(remeasureMonacoFonts, delay));

    // ── 1. BEGIN / END Matching (Nested Block Traversal) ──────────────────────────
    function getSqlBlockTokens(sql) {
        const tokens = [];
        const regex = /(--[^\r\n]*)|(\x2F\*[\s\S]*?\*\x2F)|('(?:''|[^'])*')|\b(BEGIN|END)\b/gi;
        let m;
        while ((m = regex.exec(sql)) !== null) {
            if (m[4]) {
                tokens.push({
                    type: m[4].toUpperCase(),
                    start: m.index,
                    end: m.index + m[4].length
                });
            }
        }
        return tokens;
    }

    function jumpToMatchingBeginEnd(editor, targetType) {
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;

        const pos = editor.getPosition();
        const cursorOffset = model.getOffsetAt(pos);
        const sql = model.getValue();
        const tokens = getSqlBlockTokens(sql);

        if (targetType === 'END') {
            let activeIdx = -1;
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].type === 'BEGIN' && tokens[i].start <= cursorOffset && tokens[i].end >= cursorOffset) {
                    activeIdx = i;
                    break;
                }
            }
            if (activeIdx === -1) {
                for (let i = tokens.length - 1; i >= 0; i--) {
                    if (tokens[i].type === 'BEGIN' && tokens[i].start <= cursorOffset) {
                        activeIdx = i;
                        break;
                    }
                }
            }
            if (activeIdx === -1) return;

            let depth = 1;
            for (let i = activeIdx + 1; i < tokens.length; i++) {
                if (tokens[i].type === 'BEGIN') depth++;
                else if (tokens[i].type === 'END') {
                    depth--;
                    if (depth === 0) {
                        const targetPos = model.getPositionAt(tokens[i].start);
                        editor.setPosition(targetPos);
                        editor.revealPositionInCenter(targetPos);
                        return;
                    }
                }
            }
        } else {
            let activeIdx = -1;
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].type === 'END' && tokens[i].start <= cursorOffset && tokens[i].end >= cursorOffset) {
                    activeIdx = i;
                    break;
                }
            }
            if (activeIdx === -1) {
                for (let i = tokens.length - 1; i >= 0; i--) {
                    if (tokens[i].type === 'END' && tokens[i].start >= cursorOffset) {
                        activeIdx = i;
                        break;
                    }
                }
            }
            if (activeIdx === -1) return;

            let depth = 1;
            for (let i = activeIdx - 1; i >= 0; i--) {
                if (tokens[i].type === 'END') depth++;
                else if (tokens[i].type === 'BEGIN') {
                    depth--;
                    if (depth === 0) {
                        const targetPos = model.getPositionAt(tokens[i].start);
                        editor.setPosition(targetPos);
                        editor.revealPositionInCenter(targetPos);
                        return;
                    }
                }
            }
        }
    }

    // ── 2. Create AppEditor Compatibility Wrapper ─────────────────────────────────
    function createAppEditorWrapper(getEditorInstance, containerId) {
        let _isSettingValue = false;
        const _listeners = [];

        function _bindListener(ed, evt, fn, wrapper) {
            if (!ed) return;
            if (evt === 'change') {
                ed.onDidChangeModelContent(e => {
                    fn(wrapper, {
                        origin: _isSettingValue ? 'setValue' : '+input',
                        changes: e.changes
                    });
                });
            } else if (evt === 'cursorActivity') {
                ed.onDidChangeCursorPosition(e => fn(wrapper, e));
            } else if (evt === 'keydown') {
                ed.onKeyDown(e => {
                    const syntheticEvent = {
                        key: e.browserEvent ? e.browserEvent.key : e.code,
                        code: e.browserEvent ? e.browserEvent.code : e.code,
                        keyCode: e.keyCode,
                        ctrlKey: e.ctrlKey,
                        metaKey: e.metaKey,
                        altKey: e.altKey,
                        shiftKey: e.shiftKey,
                        preventDefault: () => {
                            e.preventDefault();
                            if (e.browserEvent && e.browserEvent.preventDefault) {
                                e.browserEvent.preventDefault();
                            }
                        },
                        stopPropagation: () => {
                            e.stopPropagation();
                            if (e.browserEvent && e.browserEvent.stopPropagation) {
                                e.browserEvent.stopPropagation();
                            }
                        },
                        browserEvent: e.browserEvent
                    };
                    const handled = fn(wrapper, syntheticEvent);
                    if (handled === true) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.browserEvent) {
                            e.browserEvent.preventDefault();
                            e.browserEvent.stopPropagation();
                        }
                    }
                });
            }
        }

        const wrapper = {
            get rawEditor() {
                return getEditorInstance();
            },
            get monaco() {
                return getEditorInstance();
            },
            getValue() {
                const ed = getEditorInstance();
                return ed ? ed.getValue() : _bufferedValue;
            },
            setValue(val) {
                _bufferedValue = val || '';
                const ed = getEditorInstance();
                if (ed) {
                    _isSettingValue = true;
                    try {
                        ed.setValue(_bufferedValue);
                    } finally {
                        setTimeout(() => { _isSettingValue = false; }, 30);
                    }
                }
            },
            getSelection() {
                const ed = getEditorInstance();
                if (!ed) return '';
                const sel = ed.getSelection();
                if (!sel || sel.isEmpty()) return '';
                return ed.getModel() ? ed.getModel().getValueInRange(sel) : '';
            },
            getMonacoSelection() {
                const ed = getEditorInstance();
                return ed ? ed.getSelection() : null;
            },
            somethingSelected() {
                const ed = getEditorInstance();
                if (!ed) return false;
                const sel = ed.getSelection();
                return Boolean(sel && !sel.isEmpty());
            },
            copySelection() {
                const ed = getEditorInstance();
                if (!ed) return;
                const text = (window.getMonacoSelectedOrLineText ? window.getMonacoSelectedOrLineText(ed) : this.getSelection());
                if (text && window.copyToClipboard) {
                    window.copyToClipboard(text);
                }
            },
            replaceSelection(text, select = 'end') {
                const ed = getEditorInstance();
                if (!ed) return;
                const sel = ed.getSelection();
                if (!sel) return;
                ed.executeEdits('app', [{
                    range: sel,
                    text: text,
                    forceMoveMarkers: true
                }]);
                ed.pushUndoStop();
                ed.focus();
            },
            replaceRange(text, fromPos, toPos) {
                const ed = getEditorInstance();
                if (!ed || !fromPos) return;
                const to = toPos || fromPos;
                const range = new monaco.Range(
                    fromPos.line + 1,
                    fromPos.ch + 1,
                    to.line + 1,
                    (to.ch !== undefined ? to.ch : fromPos.ch) + 1
                );
                ed.executeEdits('app', [{
                    range: range,
                    text: text,
                    forceMoveMarkers: true
                }]);
                ed.pushUndoStop();
            },
            setSelection(posStart, posEnd) {
                const ed = getEditorInstance();
                if (!ed || !posStart) return;
                if (posStart && typeof posStart.startLineNumber === 'number') {
                    ed.setSelection(posStart);
                } else if (posStart && typeof posStart.line === 'number') {
                    const end = posEnd || posStart;
                    ed.setSelection(new monaco.Selection(
                        posStart.line + 1,
                        posStart.ch + 1,
                        end.line + 1,
                        (end.ch !== undefined ? end.ch : posStart.ch) + 1
                    ));
                } else {
                    ed.setSelection(posStart);
                }
            },
            getModel() {
                const ed = getEditorInstance();
                return ed ? ed.getModel() : null;
            },
            executeEdits(source, edits) {
                const ed = getEditorInstance();
                if (ed) return ed.executeEdits(source, edits);
            },
            getPosition() {
                const ed = getEditorInstance();
                return ed ? ed.getPosition() : { lineNumber: 1, column: 1 };
            },
            setPosition(pos) {
                const ed = getEditorInstance();
                if (!ed || !pos) return;
                ed.setPosition(pos);
            },
            revealRangeInCenter(range) {
                const ed = getEditorInstance();
                if (ed) ed.revealRangeInCenter(range);
            },
            revealLine(line) {
                const ed = getEditorInstance();
                if (ed) ed.revealLine(line);
            },
            scrollIntoView(pos, margin) {
                const ed = getEditorInstance();
                if (!ed || !pos) return;
                const line = (pos.line !== undefined ? pos.line + 1 : pos.lineNumber) || 1;
                const col = (pos.ch !== undefined ? pos.ch + 1 : pos.column) || 1;
                ed.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column: col });
            },
            indentSelection(mode) {
                const ed = getEditorInstance();
                if (!ed) return;
                if (mode === 'add') {
                    ed.getAction('editor.action.indentLines').run();
                } else {
                    ed.getAction('editor.action.outdentLines').run();
                }
            },
            focus() {
                const ed = getEditorInstance();
                if (ed) ed.focus();
            },
            refresh() {
                const ed = getEditorInstance();
                if (ed) {
                    ed.layout();
                    remeasureMonacoFonts();
                }
            },
            layout() {
                const ed = getEditorInstance();
                if (ed) {
                    ed.layout();
                    remeasureMonacoFonts();
                }
            },
            getWrapperElement() {
                return document.getElementById(containerId) || document.getElementById('editor-pane-1');
            },
            setOption(opt, val) {
                const ed = getEditorInstance();
                if (!ed) return;
                if (opt === 'theme') {
                    const reg = window.ThemeRegistry || (window.parent && window.parent.ThemeRegistry);
                    const themeObj = (reg && typeof reg.getThemeById === 'function') ? reg.getThemeById(val) : null;
                    const isDark = themeObj ? Boolean(themeObj.isDark) : (val === 'darcula' || val === 'dark' || val === 'ide-dark' || (!val.toLowerCase().includes('light') && val !== 'win-nt' && val !== 'win-xp'));
                    const mTheme = (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function')
                        ? window.MonacoInit.getMonacoTheme(val)
                        : (isDark ? 'ide-dark' : 'ide-light');
                    if (typeof monaco !== 'undefined' && monaco.editor) {
                        monaco.editor.setTheme(mTheme);
                    }
                } else if (opt === 'tabSize') {
                    const m = ed.getModel();
                    if (m) m.updateOptions({ tabSize: Number(val) || 4 });
                } else if (opt === 'indentWithTabs') {
                    const m = ed.getModel();
                    if (m) m.updateOptions({ insertSpaces: !val });
                } else if (opt === 'lineWrapping') {
                    ed.updateOptions({ wordWrap: val ? 'on' : 'off' });
                } else if (opt === 'fontSize') {
                    ed.updateOptions({ fontSize: Number(val) || 13 });
                    remeasureMonacoFonts();
                } else if (opt === 'fontFamily') {
                    ed.updateOptions({ fontFamily: val });
                    remeasureMonacoFonts();
                } else if (opt === 'minimap') {
                    ed.updateOptions({ minimap: { enabled: Boolean(val) } });
                }
            },
            getCursor() {
                const ed = getEditorInstance();
                if (!ed) return { line: 0, ch: 0 };
                const pos = ed.getPosition() || { lineNumber: 1, column: 1 };
                return { line: pos.lineNumber - 1, ch: pos.column - 1 };
            },
            setCursor(pos) {
                const ed = getEditorInstance();
                if (!ed || !pos) return;
                if (typeof pos === 'number') {
                    const m = ed.getModel();
                    if (m) ed.setPosition(m.getPositionAt(pos));
                } else if (typeof pos.line === 'number') {
                    ed.setPosition({ lineNumber: pos.line + 1, column: (pos.ch || 0) + 1 });
                }
            },
            posFromIndex(idx) {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel()) return { line: 0, ch: 0 };
                const p = ed.getModel().getPositionAt(idx);
                return { line: p.lineNumber - 1, ch: p.column - 1 };
            },
            indexFromPos(pos) {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel() || !pos) return 0;
                return ed.getModel().getOffsetAt({ lineNumber: pos.line + 1, column: (pos.ch || 0) + 1 });
            },
            getLine(lineNo) {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel()) return '';
                return ed.getModel().getLineContent(lineNo + 1);
            },
            lineCount() {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel()) return 0;
                return ed.getModel().getLineCount();
            },
            operation(fn) {
                return fn();
            },
            on(event, handler) {
                _listeners.push({ event, handler });
                const ed = getEditorInstance();
                if (ed) {
                    _bindListener(ed, event, handler, this);
                }
            },
            _bindPendingListeners(ed) {
                _listeners.forEach(({ event, handler }) => {
                    _bindListener(ed, event, handler, this);
                });
            },
            foldCode() {
                const ed = getEditorInstance();
                if (ed) ed.getAction('editor.toggleFold').run();
            },
            cursorCoords(pos, mode) {
                const ed = getEditorInstance();
                if (!ed) return { left: 100, right: 100, top: 100, bottom: 120 };
                const p = pos ? { lineNumber: pos.line + 1, column: (pos.ch || 0) + 1 } : (ed.getPosition() || { lineNumber: 1, column: 1 });
                const pixelPos = ed.getScrolledVisiblePosition(p);
                const domNode = ed.getDomNode();
                const rect = domNode ? domNode.getBoundingClientRect() : { top: 0, left: 0 };
                if (pixelPos) {
                    const top = rect.top + pixelPos.top;
                    const left = rect.left + pixelPos.left;
                    const bottom = top + (pixelPos.height || 19);
                    return { top, left, bottom, right: left };
                }
                return { top: rect.top + 50, left: rect.left + 50, bottom: rect.top + 70, right: rect.left + 50 };
            },
            findWordAt(pos) {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel()) return { anchor: pos, head: pos };
                const p = { lineNumber: pos.line + 1, column: (pos.ch || 0) + 1 };
                const w = ed.getModel().getWordAtPosition(p);
                if (w) {
                    return {
                        anchor: { line: pos.line, ch: w.startColumn - 1 },
                        head: { line: pos.line, ch: w.endColumn - 1 }
                    };
                }
                return { anchor: pos, head: pos };
            },
            getRange(from, to) {
                const ed = getEditorInstance();
                if (!ed || !ed.getModel() || !from || !to) return '';
                return ed.getModel().getValueInRange(new monaco.Range(from.line + 1, from.ch + 1, to.line + 1, to.ch + 1));
            }
        };

        return new Proxy(wrapper, {
            get(target, prop, receiver) {
                if (prop in target) {
                    return target[prop];
                }
                const ed = getEditorInstance();
                if (ed) {
                    if (typeof ed[prop] === 'function') {
                        return ed[prop].bind(ed);
                    }
                    return ed[prop];
                }
                return undefined;
            }
        });
    }

    // ── 3. Editor Creation Helper ─────────────────────────────────────────────────
    function createMonacoInstance(containerEl, initialValue) {
        if (typeof monaco === 'undefined' || !monaco.editor) {
            console.error('[Editor] Monaco not available to create instance.');
            return null;
        }

        const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        const themeName = (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function')
            ? window.MonacoInit.getMonacoTheme(curTheme)
            : ((curTheme === 'light' || curTheme === 'win-nt' || curTheme === 'win-xp' || curTheme.toLowerCase().includes('light')) ? 'ide-light' : 'ide-dark');

        const model = monaco.editor.createModel(initialValue || '', 'sql');

        const editor = monaco.editor.create(containerEl, {
            model: model,
            theme: themeName,
            fontSize: 13,
            lineHeight: 19,
            fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
            fontLigatures: false,
            letterSpacing: 0,
            lineNumbers: 'on',
            lineNumbersMinChars: 3,
            glyphMargin: true,
            folding: true,
            foldingStrategy: 'auto',
            showFoldingControls: 'always',
            matchBrackets: 'always',
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            autoIndent: 'full',
            tabSize: 4,
            insertSpaces: true,
            renderWhitespace: 'none',
            renderControlCharacters: false,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            contextmenu: true,
            fixedOverflowWidgets: true,
            minimap: { enabled: true },
            wordWrap: 'off',
            // Disable native suggest widget so #ide-intellisense-popup manages autocompletion:
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            wordBasedSuggestions: "off",
            snippetSuggestions: "none",
            tabCompletion: "off"
        });

        // ── Wire Keybindings & Actions ─────────────────────────────────────────

        // Native Windows Clipboard Hook (Ctrl+C / Ctrl+X)
        if (typeof window.attachMonacoClipboardHook === 'function') {
            window.attachMonacoClipboardHook(editor);
        } else {
            editor.onKeyDown(e => {
                const isCtrlOrCmd = e.ctrlKey || e.metaKey;
                if (!isCtrlOrCmd) return;
                const isC = (e.keyCode === 33) || (e.browserEvent && (e.browserEvent.key === 'c' || e.browserEvent.key === 'C'));
                const isX = (e.keyCode === 54) || (e.browserEvent && (e.browserEvent.key === 'x' || e.browserEvent.key === 'X'));
                if (isC || isX) {
                    const text = (window.getMonacoSelectedOrLineText ? window.getMonacoSelectedOrLineText(editor) : '');
                    if (text && window.copyToClipboard) {
                        window.copyToClipboard(text);
                    }
                }
            });
        }

        // F5: Execute Query
        editor.addAction({
            id: 'sql-execute-f5',
            label: 'Execute SQL Query',
            keybindings: [monaco.KeyCode.F5],
            run: () => {
                if (window.AppQuery) window.AppQuery.executeQuery();
            }
        });

        // Ctrl+Enter / Cmd+Enter: Execute Query
        editor.addAction({
            id: 'sql-execute-enter',
            label: 'Execute SQL Query (Enter)',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
            run: () => {
                if (window.AppQuery) window.AppQuery.executeQuery();
            }
        });

        // Ctrl+E: Execute Query
        editor.addAction({
            id: 'sql-execute-e',
            label: 'Execute SQL Query (E)',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
            run: () => {
                if (window.AppQuery) window.AppQuery.executeQuery();
            }
        });

        // Ctrl+F5: Check Syntax
        editor.addAction({
            id: 'sql-check-syntax',
            label: 'Check SQL Syntax',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F5],
            run: () => {
                if (window.checkSqlSyntax) window.checkSqlSyntax();
            }
        });

        // Ctrl+R: Toggle Result Panel
        editor.addAction({
            id: 'sql-toggle-results',
            label: 'Toggle Result Panel',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR],
            run: () => {
                if (window.toggleResultPanel) window.toggleResultPanel();
            }
        });

        // F12: Go to Definition
        editor.addAction({
            id: 'sql-goto-definition',
            label: 'Go to Definition',
            keybindings: [monaco.KeyCode.F12],
            run: () => {
                if (window.AppIntelliSense) window.AppIntelliSense.goToDefinition();
            }
        });

        // Ctrl+F / Cmd+F: Find & Replace
        editor.addAction({
            id: 'sql-find-replace',
            label: 'Find and Replace',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
            run: () => {
                if (window.AppFindReplace && typeof window.AppFindReplace.show === 'function') {
                    window.AppFindReplace.show();
                }
            }
        });

        // Ctrl+/: Toggle Comment
        editor.addAction({
            id: 'sql-toggle-comment',
            label: 'Toggle SQL Comment',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
            run: (ed) => {
                ed.getAction('editor.action.commentLine').run();
            }
        });

        // Alt+]: Go to Matching END
        editor.addAction({
            id: 'sql-goto-matching-end',
            label: 'Go to Matching END',
            keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketRight, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow],
            run: (ed) => {
                jumpToMatchingBeginEnd(ed, 'END');
            }
        });

        // Alt+[: Go to Matching BEGIN
        editor.addAction({
            id: 'sql-goto-matching-begin',
            label: 'Go to Matching BEGIN',
            keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.BracketLeft, monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow],
            run: (ed) => {
                jumpToMatchingBeginEnd(ed, 'BEGIN');
            }
        });

        // Tab: Expand snippet or accept IntelliSense item or indent
        editor.addCommand(monaco.KeyCode.Tab, () => {
            if (window.AppIntelliSense && typeof window.AppIntelliSense.isPopupVisible === 'function' && window.AppIntelliSense.isPopupVisible()) {
                window.AppIntelliSense.chooseCurrentItem(window.AppEditor);
                return;
            }
            if (window.AppSnippets && typeof window.AppSnippets.tryExpandSnippet === 'function') {
                const expanded = window.AppSnippets.tryExpandSnippet(window.AppEditor);
                if (expanded) return;
            }
            editor.trigger('keyboard', 'tab', null);
        });

        // Enter: Accept IntelliSense item or insert newline
        editor.addCommand(monaco.KeyCode.Enter, () => {
            if (window.AppIntelliSense && typeof window.AppIntelliSense.isPopupVisible === 'function' && window.AppIntelliSense.isPopupVisible()) {
                window.AppIntelliSense.chooseCurrentItem(window.AppEditor);
                return;
            }
            editor.trigger('keyboard', 'type', { text: '\n' });
        });

        // Escape: Close IntelliSense popup if visible
        editor.addCommand(monaco.KeyCode.Escape, () => {
            if (window.AppIntelliSense && typeof window.AppIntelliSense.isPopupVisible === 'function' && window.AppIntelliSense.isPopupVisible()) {
                window.AppIntelliSense.hidePopup();
                return;
            }
        });

        // Synchronize on content change to update tab state dirty status
        editor.onDidChangeModelContent(() => {
            const val = editor.getValue();
            if (window.AppTabs && window.AppTabs.getActiveTabState) {
                const state = window.AppTabs.getActiveTabState();
                if (state) {
                    state.content = val;
                }
            }
        });

        return editor;
    }

    // ── 4. Main Editor Initialization ─────────────────────────────────────────
    window.initEditor = function () {
        // Return AppEditor wrapper immediately so callers never get null
        window.AppEditor = createAppEditorWrapper(() => _primaryEditor, 'monaco-sql-editor');

        let _mountRetries = 0;
        function _mount() {
            if (_primaryEditor) return;
            const targetEl = document.getElementById('monaco-sql-editor');
            if (!targetEl) {
                if (_mountRetries++ < 30) {
                    setTimeout(_mount, 50);
                } else {
                    console.warn('[Editor] #monaco-sql-editor element not found in DOM after retries.');
                }
                return;
            }

            if (typeof monaco === 'undefined' || !monaco.editor) {
                if (_mountRetries++ < 30) {
                    setTimeout(_mount, 50);
                }
                return;
            }

            _primaryEditor = createMonacoInstance(targetEl, _bufferedValue);
            window.AppEditor._bindPendingListeners(_primaryEditor);

            // Connect IntelliSense controller
            if (window.AppIntelliSense && typeof window.AppIntelliSense.attachEditor === 'function') {
                window.AppIntelliSense.attachEditor(window.AppEditor);
            }

            // Set initial theme
            if (window.ThemeManager) {
                const cur = window.ThemeManager.getCurrentTheme ? window.ThemeManager.getCurrentTheme() : 'dark';
                window.AppEditor.setOption('theme', cur);
            }

            // Sync layout & font metrics after render with staggered delays
            [50, 150, 300, 600, 1200].forEach(delay => {
                setTimeout(() => {
                    if (_primaryEditor) _primaryEditor.layout();
                    remeasureMonacoFonts();
                }, delay);
            });

            // Focus on editor container click
            targetEl.addEventListener('click', () => {
                if (_primaryEditor) _primaryEditor.focus();
            });

            setTimeout(() => {
                if (_primaryEditor) _primaryEditor.focus();
            }, 100);
        }

        if (typeof monaco !== 'undefined' && monaco.editor) {
            _mount();
        } else if (typeof window._onMonacoReady === 'function') {
            window._onMonacoReady(() => _mount());
        }
        window.addEventListener('monaco-ready', () => _mount());

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                if (typeof window._onMonacoReady === 'function') {
                    window._onMonacoReady(() => _mount());
                }
            });
        }

        // Global window resize sync
        window.addEventListener('resize', () => {
            if (_primaryEditor) _primaryEditor.layout();
            if (_secondaryEditor) _secondaryEditor.layout();
            remeasureMonacoFonts();
        });

        return window.AppEditor;
    };

    // ── 5. Split Editor Support ───────────────────────────────────────────────
    window.splitEditor = function () {
        const resizer = document.getElementById('editor-resizer');
        const pane2 = document.getElementById('editor-pane-2');
        const container2 = document.getElementById('monaco-sql-editor-2');

        if (!pane2 || !container2) return;

        pane2.classList.remove('d-none');
        if (resizer) resizer.classList.remove('d-none');

        if (!_secondaryEditor && typeof monaco !== 'undefined') {
            const currentContent = window.AppEditor ? window.AppEditor.getValue() : '';
            _secondaryEditor = createMonacoInstance(container2, currentContent);
            window.AppEditor2 = createAppEditorWrapper(() => _secondaryEditor, 'monaco-sql-editor-2');
            window.AppEditor2._bindPendingListeners(_secondaryEditor);
            if (window.AppIntelliSense && typeof window.AppIntelliSense.attachEditor === 'function') {
                window.AppIntelliSense.attachEditor(window.AppEditor2);
            }
        }

        setTimeout(() => {
            if (_primaryEditor) _primaryEditor.layout();
            if (_secondaryEditor) _secondaryEditor.layout();
            remeasureMonacoFonts();
        }, 50);
    };

    window.unsplitEditor = function () {
        const resizer = document.getElementById('editor-resizer');
        const pane2 = document.getElementById('editor-pane-2');

        if (pane2) pane2.classList.add('d-none');
        if (resizer) resizer.classList.add('d-none');

        if (_secondaryEditor) {
            _secondaryEditor.dispose();
            _secondaryEditor = null;
            window.AppEditor2 = null;
        }

        setTimeout(() => {
            if (_primaryEditor) _primaryEditor.layout();
            remeasureMonacoFonts();
        }, 50);
    };

    // ── 6. Listen to Global Theme Changes ─────────────────────────────────────
    document.addEventListener('ide-theme-changed', (e) => {
        const themeName = e.detail?.theme;
        if (window.AppEditor) {
            window.AppEditor.setOption('theme', themeName);
        }
        remeasureMonacoFonts();
    });

    // ── 7. Global Syntax Check Helper ─────────────────────────────────────────
    window.checkSqlSyntax = function () {
        const sql = window.AppEditor ? window.AppEditor.getValue() : '';
        if (!sql.trim()) {
            if (typeof showToast === 'function') showToast('Không có câu lệnh SQL nào để kiểm tra.', 'info');
            return;
        }
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.check_syntax === 'function') {
            window.pywebview.api.check_syntax(sql).then(res => {
                if (res && res.valid) {
                    if (typeof showToast === 'function') showToast('✓ Cú pháp SQL hợp lệ!', 'success');
                } else {
                    const err = (res && res.error) ? res.error : 'Lỗi cú pháp không xác định';
                    if (typeof showToast === 'function') showToast(`Lỗi cú pháp: ${err}`, 'danger');
                }
            }).catch(e => {
                if (typeof showToast === 'function') showToast(`Không thể kiểm tra cú pháp: ${e}`, 'warning');
            });
        } else {
            if (typeof showToast === 'function') showToast('✓ Không phát hiện lỗi cú pháp cơ bản.', 'success');
        }
    };

})(window);
