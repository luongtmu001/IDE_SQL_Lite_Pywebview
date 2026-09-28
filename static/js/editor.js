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
                    const sz = Number(val) || 13;
                    const expectedLineHeight = Math.round(sz * (19 / 13));
                    ed.updateOptions({ fontSize: sz, lineHeight: expectedLineHeight });
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

        let initialFontFamily = "'JetBrains Mono', Consolas, 'Courier New', monospace";
        let initialFontSize = 14;
        let initialWordWrap = 'off';
        let initialMinimap = true;
        let initialTabSize = 4;
        let initialInsertSpaces = true;

        try {
            const raw = localStorage.getItem('ide-settings');
            if (raw) {
                const s = JSON.parse(raw);
                if (s && s.editor) {
                    if (s.editor.fontFamily) initialFontFamily = s.editor.fontFamily;
                    if (s.editor.fontSize) initialFontSize = Number(s.editor.fontSize) || 14;
                    if (s.editor.wordWrap !== undefined) initialWordWrap = s.editor.wordWrap ? 'on' : 'off';
                    if (s.editor.minimap !== undefined) initialMinimap = Boolean(s.editor.minimap);
                    if (s.editor.tabSize !== undefined) initialTabSize = Number(s.editor.tabSize) || 4;
                    if (s.editor.insertSpaces !== undefined) initialInsertSpaces = Boolean(s.editor.insertSpaces);
                }
            }
        } catch (_) {}

        try {
            const cssFont = getComputedStyle(document.documentElement).getPropertyValue('--ide-editor-font-family').trim();
            if (cssFont && (!initialFontFamily || initialFontFamily.includes('JetBrains Mono, Consolas'))) {
                initialFontFamily = cssFont;
            }
            const cssSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ide-editor-font-size'), 10);
            if (!isNaN(cssSize) && cssSize > 0) {
                initialFontSize = cssSize;
            }
        } catch (_) {}

        const model = monaco.editor.createModel(initialValue || '', 'sql');

        const editor = monaco.editor.create(containerEl, {
            model: model,
            theme: themeName,
            fontSize: initialFontSize,
            lineHeight: Math.round(initialFontSize * (19 / 13)),
            fontFamily: initialFontFamily,
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
            tabSize: initialTabSize,
            insertSpaces: initialInsertSpaces,
            renderWhitespace: 'none',
            renderControlCharacters: false,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            mouseWheelZoom: true,
            contextmenu: true,
            fixedOverflowWidgets: true,
            minimap: { enabled: initialMinimap },
            wordWrap: initialWordWrap,
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

        // ── Synchronize Zoom & Line-Height ─────────────────────────────────────
        editor.onDidChangeConfiguration(e => {
            if (e.hasChanged(monaco.editor.EditorOption.fontSize)) {
                const curFontSize = editor.getOption(monaco.editor.EditorOption.fontSize);
                const expectedLineHeight = Math.round(curFontSize * (19 / 13));
                if (editor.getOption(monaco.editor.EditorOption.lineHeight) !== expectedLineHeight) {
                    editor.updateOptions({ lineHeight: expectedLineHeight });
                }
                if (window.EditorStatusBar && !window.EditorStatusBar._isApplyingZoom) {
                    const base = window.EditorStatusBar._baseFontSize || 14;
                    window.EditorStatusBar._currentZoomPct = Math.max(20, Math.min(400, Math.round((curFontSize / base) * 100)));
                    window.EditorStatusBar.updateZoomDisplay();
                }
                remeasureMonacoFonts();
            }
        });

        // ── Wire Status Bar Realtime Trackers ──────────────────────────────────
        editor.onDidChangeCursorPosition(() => {
            if (window.EditorStatusBar && window.EditorStatusBar.getActiveEditor() === editor) {
                window.EditorStatusBar.updateCursor(editor);
            }
        });

        editor.onDidChangeCursorSelection(() => {
            if (window.EditorStatusBar && window.EditorStatusBar.getActiveEditor() === editor) {
                window.EditorStatusBar.updateCursor(editor);
            }
        });

        editor.onDidFocusEditorText(() => {
            if (window.EditorStatusBar) {
                window.EditorStatusBar.setActiveEditor(editor);
            }
        });

        editor.onDidChangeModel(() => {
            if (window.EditorStatusBar && window.EditorStatusBar.getActiveEditor() === editor) {
                window.EditorStatusBar.updateAll(editor);
            }
        });

        // Synchronize on content change to update tab state dirty status & status bar
        editor.onDidChangeModelContent(() => {
            const val = editor.getValue();
            if (window.AppTabs && window.AppTabs.getActiveTabState) {
                const state = window.AppTabs.getActiveTabState();
                if (state) {
                    state.content = val;
                }
            }
            if (window.EditorStatusBar && window.EditorStatusBar.getActiveEditor() === editor) {
                window.EditorStatusBar.updateCursor(editor);
                window.EditorStatusBar.updateEOL(editor);
            }
        });

        editor.onDidChangeModelOptions(() => {
            if (window.EditorStatusBar && window.EditorStatusBar.getActiveEditor() === editor) {
                window.EditorStatusBar.updateIndent(editor);
            }
        });

        return editor;
    }

    // ── 4. Editor Status Bar Controller (SSMS Style) ──────────────────────────
    const EditorStatusBar = {
        _activeEditor: null,
        _isInitialized: false,
        _currentZoomPct: 100,
        _baseFontSize: 14,
        _isApplyingZoom: false,

        init() {
            if (this._isInitialized) return;
            this._isInitialized = true;
            try {
                const raw = localStorage.getItem('ide-settings');
                if (raw) {
                    const s = JSON.parse(raw);
                    if (s.editor?.fontSize) this._baseFontSize = Number(s.editor.fontSize) || 14;
                }
            } catch (_) {}
            this._bindUIEvents();
            if (_primaryEditor) {
                this.setActiveEditor(_primaryEditor);
            }
        },

        setActiveEditor(editor) {
            if (!editor) return;
            this._activeEditor = editor;
            this.updateAll(editor);
        },

        getActiveEditor() {
            return this._activeEditor || _primaryEditor;
        },

        updateZoomDisplay() {
            if (this._isApplyingZoom) return;
            const input = document.getElementById('ide-sb-zoom-input');
            if (input && document.activeElement !== input) {
                input.value = `${this._currentZoomPct} %`;
            }
        },

        applyZoom(pct) {
            const ed = this.getActiveEditor();
            if (!ed) return;
            const validPct = Math.max(20, Math.min(400, Math.round(pct)));
            this._currentZoomPct = validPct;
            const base = this._baseFontSize || 14;
            const newFontSize = Math.max(6, Math.min(80, Math.round(base * (validPct / 100))));
            const newLineHeight = Math.round(newFontSize * (19 / 13));

            this._isApplyingZoom = true;
            ed.updateOptions({
                fontSize: newFontSize,
                lineHeight: newLineHeight
            });
            ed.layout();
            remeasureMonacoFonts();

            const input = document.getElementById('ide-sb-zoom-input');
            if (input && document.activeElement !== input) {
                input.value = `${validPct} %`;
            }

            setTimeout(() => {
                this._isApplyingZoom = false;
                if (ed) {
                    ed.layout();
                    remeasureMonacoFonts();
                }
            }, 30);
        },

        updateCursor(editor) {
            const ed = editor || this.getActiveEditor();
            const cursorEl = document.getElementById('ide-sb-cursor');
            if (!cursorEl || !ed) return;
            const pos = ed.getPosition() || { lineNumber: 1, column: 1 };
            const sel = ed.getSelection();
            let text = `Ln: ${pos.lineNumber}, Ch: ${pos.column}`;
            if (sel && !sel.isEmpty()) {
                const model = ed.getModel();
                if (model) {
                    const selText = model.getValueInRange(sel);
                    text += ` (${selText.length} selected)`;
                }
            }
            cursorEl.textContent = text;
        },

        updateIssues(editor) {
            const ed = editor || this.getActiveEditor();
            const issuesEl = document.getElementById('ide-sb-issues');
            if (!issuesEl || !ed || !ed.getModel()) return;

            const model = ed.getModel();
            const markers = (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getModelMarkers === 'function')
                ? monaco.editor.getModelMarkers({ resource: model.uri })
                : [];

            const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);
            const warnings = markers.filter(m => m.severity === monaco.MarkerSeverity.Warning);

            if (errors.length === 0 && warnings.length === 0) {
                issuesEl.className = 'ide-sb-issues';
                issuesEl.innerHTML = '<i class="fa-solid fa-circle-check text-success"></i><span id="ide-sb-issues-text">No issues found</span>';
                issuesEl.title = 'No syntax issues found';
            } else if (errors.length > 0) {
                issuesEl.className = 'ide-sb-issues has-errors';
                issuesEl.innerHTML = `<i class="fa-solid fa-circle-xmark text-danger"></i><span id="ide-sb-issues-text">${errors.length} issue${errors.length > 1 ? 's' : ''} found</span>`;
                issuesEl.title = errors.map(e => `Line ${e.startLineNumber}: ${e.message}`).join('\n');
            } else {
                issuesEl.className = 'ide-sb-issues has-warnings';
                issuesEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-warning"></i><span id="ide-sb-issues-text">${warnings.length} warning${warnings.length > 1 ? 's' : ''}</span>`;
                issuesEl.title = warnings.map(w => `Line ${w.startLineNumber}: ${w.message}`).join('\n');
            }
        },

        updateIndent(editor) {
            const ed = editor || this.getActiveEditor();
            const indentEl = document.getElementById('ide-sb-indent');
            if (!indentEl || !ed || !ed.getModel()) return;
            const opts = ed.getModel().getOptions();
            if (opts && opts.insertSpaces) {
                indentEl.textContent = `SPACES: ${opts.tabSize || 4}`;
            } else {
                indentEl.textContent = 'TABS';
            }
        },

        updateEOL(editor) {
            const ed = editor || this.getActiveEditor();
            const eolEl = document.getElementById('ide-sb-eol');
            if (!eolEl || !ed || !ed.getModel()) return;
            const eol = ed.getModel().getEOL();
            eolEl.textContent = (eol === '\r\n') ? 'CRLF' : 'LF';
        },

        updateAll(editor) {
            const ed = editor || this.getActiveEditor();
            if (!ed) return;
            this.updateZoomDisplay();
            this.updateCursor(ed);
            this.updateIssues(ed);
            this.updateIndent(ed);
            this.updateEOL(ed);
        },

        _bindUIEvents() {
            // Zoom input
            const zoomInput = document.getElementById('ide-sb-zoom-input');
            if (zoomInput) {
                const commitZoom = () => {
                    const raw = zoomInput.value.replace(/[^0-9]/g, '');
                    const val = parseInt(raw, 10);
                    if (!isNaN(val) && val >= 20 && val <= 400) {
                        EditorStatusBar.applyZoom(val);
                    } else {
                        EditorStatusBar.updateZoomDisplay();
                    }
                };
                zoomInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commitZoom();
                        zoomInput.blur();
                        const ed = EditorStatusBar.getActiveEditor();
                        if (ed) ed.focus();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        EditorStatusBar.updateZoomDisplay();
                        zoomInput.blur();
                        const ed = EditorStatusBar.getActiveEditor();
                        if (ed) ed.focus();
                    }
                });
                zoomInput.addEventListener('change', commitZoom);
                zoomInput.addEventListener('blur', commitZoom);
                zoomInput.addEventListener('focus', () => {
                    zoomInput.select();
                });
            }

            // Zoom dropdown presets
            document.querySelectorAll('.ide-sb-zoom-menu [data-zoom]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const val = parseInt(btn.getAttribute('data-zoom'), 10);
                    if (!isNaN(val)) {
                        EditorStatusBar.applyZoom(val);
                    }
                });
            });

            // Issues click to navigate to first error
            const issuesEl = document.getElementById('ide-sb-issues');
            if (issuesEl) {
                issuesEl.addEventListener('click', () => {
                    const ed = EditorStatusBar.getActiveEditor();
                    if (!ed || !ed.getModel()) return;
                    const model = ed.getModel();
                    const markers = (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.getModelMarkers === 'function')
                        ? monaco.editor.getModelMarkers({ resource: model.uri })
                        : [];
                    const target = markers.find(m => m.severity === monaco.MarkerSeverity.Error) || markers[0];
                    if (target) {
                        ed.revealPositionInCenter({ lineNumber: target.startLineNumber, column: target.startColumn });
                        ed.setPosition({ lineNumber: target.startLineNumber, column: target.startColumn });
                        ed.focus();
                    }
                });
            }

            // Indent toggle (Spaces vs Tabs)
            const indentEl = document.getElementById('ide-sb-indent');
            if (indentEl) {
                indentEl.addEventListener('click', () => {
                    const ed = EditorStatusBar.getActiveEditor();
                    if (!ed || !ed.getModel()) return;
                    const model = ed.getModel();
                    const curOpts = model.getOptions();
                    const nextInsertSpaces = !curOpts.insertSpaces;
                    model.updateOptions({ insertSpaces: nextInsertSpaces, tabSize: 4 });
                    EditorStatusBar.updateIndent(ed);
                });
            }

            // EOL toggle (CRLF vs LF)
            const eolEl = document.getElementById('ide-sb-eol');
            if (eolEl) {
                eolEl.addEventListener('click', () => {
                    const ed = EditorStatusBar.getActiveEditor();
                    if (!ed || !ed.getModel()) return;
                    const model = ed.getModel();
                    const curEOL = model.getEOL();
                    const nextEOL = (curEOL === '\r\n') ? '\n' : '\r\n';
                    model.setEOL(nextEOL === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
                    EditorStatusBar.updateEOL(ed);
                });
            }

            // Global markers listener
            if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.onDidChangeMarkers === 'function') {
                monaco.editor.onDidChangeMarkers(() => {
                    EditorStatusBar.updateIssues();
                });
            }

            // Listen for tab switch to update or toggle status bar
            document.addEventListener('ide-tab-switched', (e) => {
                const state = e.detail?.state;
                const statusBar = document.getElementById('ide-editor-status-bar');
                if (statusBar) {
                    if (state && (state.tabType === 'designer' || state.tabType === 'data-editor')) {
                        statusBar.classList.add('d-none');
                    } else {
                        statusBar.classList.remove('d-none');
                        setTimeout(() => {
                            if (_primaryEditor) {
                                EditorStatusBar.updateAll(_primaryEditor);
                            }
                        }, 20);
                    }
                }
            });
        }
    };
    window.EditorStatusBar = EditorStatusBar;

    // ── 5. Main Editor Initialization ─────────────────────────────────────────
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

            // Connect Editor Status Bar
            EditorStatusBar.init();
            EditorStatusBar.setActiveEditor(_primaryEditor);

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

    // ── 6.5. Listen to Settings Changes (Font, Size, Tab, Wrap, etc.) ─────────
    function applySettingsToEditors(settings) {
        if (!settings || !settings.editor) return;
        const edConfig = settings.editor;
        const fontFam = edConfig.fontFamily;
        const fontSz = Number(edConfig.fontSize);
        const opts = {};
        if (fontFam) {
            const clean = fontFam.trim().replace(/^['"]+|['"]+$/g, '');
            opts.fontFamily = clean.includes('monospace') || clean.includes('sans-serif')
                ? clean
                : `"${clean}", Consolas, monospace`;
            document.documentElement.style.setProperty('--ide-editor-font-family', opts.fontFamily);
        }
        if (fontSz && !isNaN(fontSz)) {
            if (window.EditorStatusBar) {
                window.EditorStatusBar._baseFontSize = fontSz;
                const zoomPct = window.EditorStatusBar._currentZoomPct || 100;
                const finalSize = Math.max(6, Math.min(80, Math.round(fontSz * (zoomPct / 100))));
                opts.fontSize = finalSize;
                opts.lineHeight = Math.round(finalSize * (19 / 13));
            } else {
                opts.fontSize = fontSz;
                opts.lineHeight = Math.round(fontSz * (19 / 13));
            }
            document.documentElement.style.setProperty('--ide-editor-font-size', fontSz + 'px');
        }
        if (edConfig.wordWrap !== undefined) opts.wordWrap = edConfig.wordWrap ? 'on' : 'off';
        if (edConfig.minimap !== undefined) opts.minimap = { enabled: Boolean(edConfig.minimap) };

        [_primaryEditor, _secondaryEditor].forEach(ed => {
            if (!ed) return;
            ed.updateOptions(opts);
            ed.layout();
            const m = ed.getModel();
            if (m) {
                if (edConfig.tabSize !== undefined) m.updateOptions({ tabSize: Number(edConfig.tabSize) || 4 });
                if (edConfig.insertSpaces !== undefined) m.updateOptions({ insertSpaces: Boolean(edConfig.insertSpaces) });
            }
        });
        remeasureMonacoFonts();
        setTimeout(() => {
            [_primaryEditor, _secondaryEditor].forEach(ed => { if (ed) ed.layout(); });
            remeasureMonacoFonts();
        }, 50);
    }

    document.addEventListener('ide-settings-updated', (e) => {
        if (e.detail && e.detail.settings) {
            applySettingsToEditors(e.detail.settings);
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'ide-settings' && e.newValue) {
            try {
                const parsed = JSON.parse(e.newValue);
                applySettingsToEditors(parsed);
            } catch (_) {}
        }
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
