/**
 * ddl-viewer.js
 * Monaco Editor integration for DDL Viewer with match highlighting, line navigation,
 * seamless theme synchronization and editor typography settings synchronization.
 */
(function (global) {
    'use strict';

    function getActiveMonacoTheme() {
        const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            return window.MonacoInit.getMonacoTheme(curTheme);
        }
        const isLight = (
            curTheme === 'light' ||
            curTheme === 'win-nt' ||
            curTheme === 'win-xp' ||
            curTheme.toLowerCase().includes('light') ||
            curTheme.toLowerCase().endsWith('-light')
        );
        return isLight ? 'ide-light' : 'ide-dark';
    }

    function getEditorTypographyOptions() {
        let editorSettings = null;
        if (window.SettingsManager && typeof window.SettingsManager.getSettings === 'function') {
            const s = window.SettingsManager.getSettings();
            if (s && s.editor) editorSettings = s.editor;
        }
        if (!editorSettings && window.IDE_SETTINGS && window.IDE_SETTINGS.editor) {
            editorSettings = window.IDE_SETTINGS.editor;
        }
        if (!editorSettings) {
            try {
                const raw = localStorage.getItem('ide-settings');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && parsed.editor) editorSettings = parsed.editor;
                }
            } catch (_) {}
        }

        const rootStyle = getComputedStyle(document.documentElement);
        const cssFontFamily = rootStyle.getPropertyValue('--ide-editor-font-family').trim();
        const cssFontSizeStr = rootStyle.getPropertyValue('--ide-editor-font-size').trim();
        const cssLineHeightStr = rootStyle.getPropertyValue('--ide-editor-line-height').trim();
        const cssLetterSpacingStr = rootStyle.getPropertyValue('--ide-editor-letter-spacing').trim();

        const rawFont = (editorSettings && editorSettings.fontFamily)
            ? editorSettings.fontFamily
            : (cssFontFamily || 'Consolas');
        const cleanFont = rawFont.replace(/^['"]+|['"]+$/g, '').trim();
        const fontFamily = (cleanFont.includes('monospace') || cleanFont.includes('sans-serif'))
            ? cleanFont
            : `"${cleanFont}", Consolas, monospace`;

        const fontSize = (editorSettings && Number(editorSettings.fontSize))
            || parseInt(cssFontSizeStr, 10)
            || 14;

        let parsedCssLH = parseFloat(cssLineHeightStr);
        if (isNaN(parsedCssLH)) parsedCssLH = 0;
        const editorLineHeight = (editorSettings && editorSettings.lineHeight !== undefined && editorSettings.lineHeight !== null && !isNaN(Number(editorSettings.lineHeight)))
            ? Number(editorSettings.lineHeight)
            : parsedCssLH;

        let parsedCssLS = parseFloat(cssLetterSpacingStr);
        if (isNaN(parsedCssLS)) parsedCssLS = 0;
        const letterSpacing = (editorSettings && editorSettings.letterSpacing !== undefined && editorSettings.letterSpacing !== null && !isNaN(Number(editorSettings.letterSpacing)))
            ? Number(editorSettings.letterSpacing)
            : parsedCssLS;

        let lineHeight = 0;
        if (typeof window.computeEditorLineHeight === 'function') {
            lineHeight = window.computeEditorLineHeight(editorLineHeight, fontSize);
        } else if (editorLineHeight > 0) {
            lineHeight = editorLineHeight <= 4
                ? Math.max(fontSize, Math.round(fontSize * editorLineHeight))
                : Math.max(fontSize, Math.round(editorLineHeight));
        } else {
            lineHeight = Math.round(fontSize * (19 / 13));
        }

        const tabSize = (editorSettings && Number(editorSettings.tabSize)) || 4;
        const wordWrap = (editorSettings && editorSettings.wordWrap) ? 'on' : 'off';

        return {
            fontFamily,
            fontSize,
            lineHeight,
            letterSpacing,
            tabSize,
            wordWrap
        };
    }

    class DdlViewer {
        constructor(containerEl) {
            this.container = containerEl;
            this.editor = null;
            this.decorations = [];
            this.activeDecoration = [];
            this.currentMatches = [];
            this.currentActiveIndex = -1;
            this._pendingValue = null;
            this._pendingMatches = null;
            this._pendingActiveIndex = 0;
            this._initEditor();
        }

        _initEditor() {
            if (!this.container) return;

            const createEditorInstance = () => {
                if (!this.container || this.editor || typeof monaco === 'undefined' || !monaco.editor) return;

                const theme = getActiveMonacoTheme();
                const typo = getEditorTypographyOptions();

                const initialValue = this._pendingValue !== null 
                    ? this._pendingValue 
                    : '-- Chọn một object ở danh sách bên trái để xem DDL';

                this.editor = monaco.editor.create(this.container, {
                    value: initialValue,
                    language: 'sql',
                    theme: theme,
                    readOnly: true,
                    automaticLayout: true,
                    fontSize: typo.fontSize,
                    fontFamily: typo.fontFamily,
                    lineHeight: typo.lineHeight,
                    letterSpacing: typo.letterSpacing,
                    lineNumbers: 'on',
                    folding: true,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    renderLineHighlight: 'all',
                    wordWrap: 'off'
                });

                // Ensure theme is set immediately on initial creation
                try {
                    monaco.editor.setTheme(theme);
                } catch (_) {}

                if (this._pendingMatches && this._pendingMatches.length > 0) {
                    this.setDefinition(this._pendingValue, this._pendingMatches, this._pendingActiveIndex);
                }
            };

            if (typeof monaco !== 'undefined' && monaco.editor) {
                createEditorInstance();
            } else if (typeof window._onMonacoReady === 'function') {
                window._onMonacoReady(() => {
                    createEditorInstance();
                });
            } else {
                window.addEventListener('monaco-ready', () => {
                    createEditorInstance();
                }, { once: true });
            }

            // Listen for global theme changes
            document.addEventListener('ide-theme-changed', (e) => {
                this.syncTheme();
            });

            // Listen for editor settings updates (font, line height, etc.)
            document.addEventListener('ide-settings-updated', () => {
                this.applyTypographySettings();
            });
            document.addEventListener('ide-font-changed', () => {
                this.applyTypographySettings();
            });
        }

        syncTheme() {
            if (this.editor && typeof monaco !== 'undefined' && monaco.editor) {
                const monacoTheme = getActiveMonacoTheme();
                monaco.editor.setTheme(monacoTheme);
            }
        }

        applyTypographySettings() {
            if (!this.editor) return;
            const typo = getEditorTypographyOptions();
            this.editor.updateOptions({
                fontFamily: typo.fontFamily,
                fontSize: typo.fontSize,
                lineHeight: typo.lineHeight,
                letterSpacing: typo.letterSpacing,
                tabSize: typo.tabSize,
                wordWrap: typo.wordWrap
            });
            if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.remeasureFonts === 'function') {
                try { monaco.editor.remeasureFonts(); } catch (_) {}
            }
        }

        setModel(model, matches = [], activeIndex = 0) {
            if (!this.editor) return;
            if (model && !model.isDisposed()) {
                if (this.editor.getModel() !== model) {
                    this.editor.setModel(model);
                }
                this.currentMatches = matches || [];
                this.currentActiveIndex = -1;
                this.applyMatchDecorations(this.currentMatches);
                if (this.currentMatches.length > 0 && activeIndex >= 0) {
                    this.setActiveMatch(activeIndex);
                }
            }
        }

        setDefinition(ddlText, matches = [], activeIndex = 0) {
            this._pendingValue = ddlText;
            this._pendingMatches = matches;
            this._pendingActiveIndex = activeIndex;

            if (!this.editor) {
                this._initEditor();
                return;
            }

            const text = ddlText || '-- Định nghĩa DDL trống hoặc không có sẵn';
            // Tránh re-parse và re-tokenize toàn bộ editor nếu chuỗi text giống hệt
            if (this.editor.getValue() !== text) {
                this.editor.setValue(text);
            }
            this.currentMatches = matches || [];
            this.currentActiveIndex = -1;

            this.applyMatchDecorations(this.currentMatches);

            if (this.currentMatches.length > 0 && activeIndex >= 0) {
                this.setActiveMatch(activeIndex);
            }
        }

        clear() {
            if (!this.editor) return;
            if (!this._defaultModel || this._defaultModel.isDisposed()) {
                if (typeof monaco !== 'undefined' && monaco.editor && monaco.editor.createModel) {
                    this._defaultModel = monaco.editor.createModel('-- Chọn một object ở danh sách bên trái để xem DDL', 'sql');
                }
            }
            if (this._defaultModel && !this._defaultModel.isDisposed()) {
                if (this.editor.getModel() !== this._defaultModel) {
                    this.editor.setModel(this._defaultModel);
                }
            } else {
                const defaultText = '-- Chọn một object ở danh sách bên trái để xem DDL';
                if (this.editor.getValue() !== defaultText) {
                    this.editor.setValue(defaultText);
                }
            }
            this.decorations = this.editor.deltaDecorations(this.decorations, []);
            this.activeDecoration = this.editor.deltaDecorations(this.activeDecoration, []);
            this.currentMatches = [];
            this.currentActiveIndex = -1;
        }

        applyMatchDecorations(matches) {
            if (!this.editor) return;

            const newDecorations = (matches || []).map(m => ({
                range: new monaco.Range(
                    m.line,
                    m.column,
                    m.line,
                    m.column + m.length
                ),
                options: {
                    inlineClassName: 'ocs-monaco-match',
                    overviewRuler: {
                        color: 'rgba(234, 179, 8, 0.8)',
                        position: monaco.editor.OverviewRulerLane.Right
                    }
                }
            }));

            this.decorations = this.editor.deltaDecorations(this.decorations, newDecorations);
        }

        setActiveMatch(index) {
            if (!this.editor || !this.currentMatches || this.currentMatches.length === 0) {
                this.activeDecoration = this.editor ? this.editor.deltaDecorations(this.activeDecoration, []) : [];
                return;
            }

            const total = this.currentMatches.length;
            const validIndex = ((index % total) + total) % total;
            this.currentActiveIndex = validIndex;
            const m = this.currentMatches[validIndex];
            if (!m) return;

            // Apply active decoration
            const activeDec = [{
                range: new monaco.Range(
                    m.line,
                    m.column,
                    m.line,
                    m.column + m.length
                ),
                options: {
                    inlineClassName: 'ocs-monaco-match-active',
                    overviewRuler: {
                        color: '#f97316',
                        position: monaco.editor.OverviewRulerLane.Full
                    }
                }
            }];

            this.activeDecoration = this.editor.deltaDecorations(this.activeDecoration, activeDec);

            // Scroll and set position
            this.editor.revealLineInCenter(m.line);
            this.editor.setPosition({ lineNumber: m.line, column: m.column });
            this.editor.focus();
        }

        layout() {
            if (this.editor) {
                this.editor.layout();
            }
        }

        getDdlText() {
            return this.editor ? this.editor.getValue() : '';
        }
    }

    global.DdlViewer = DdlViewer;
})(window);
