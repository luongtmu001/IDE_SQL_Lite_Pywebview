// monaco-init.js — Monaco Editor Loader & Theme Setup
// Centralizes Monaco AMD require config and custom theme definitions.
// Must be loaded AFTER loader.js and BEFORE any script that uses monaco.

(function (window) {
    "use strict";

    // ── Monaco Environment for local file:// & WebView2 context ───────────────
    window.MonacoEnvironment = {
        getWorker: function () {
            throw new Error("Use main thread local worker");
        }
    };


    // ── AMD loader path config ─────────────────────────────────────────────────
    const _base = (function () {
        // Robust detection: find script element loading Monaco loader.js
        const loaderScript = document.querySelector('script[src*="monaco/vs/loader.js"]') ||
                             document.querySelector('script[src*="vs/loader.js"]');
        if (loaderScript) {
            const src = loaderScript.getAttribute('src');
            const idx = src.indexOf('/loader.js');
            if (idx !== -1) {
                return src.substring(0, idx);
            }
        }
        const loc = window.location.href;
        const staticIdx = loc.indexOf("/static/");
        if (staticIdx !== -1) {
            return loc.substring(0, staticIdx) + "/static/vendor/monaco/vs";
        }
        return "../static/vendor/monaco/vs";
    })();

    if (typeof window.require !== "undefined" && window.require.config) {
        window.require.config({
            paths: { "vs": _base },
            "vs/nls": { availableLanguages: {} }
        });
    }

    // ── Theme names ─────────────────────────────────────────────────────────
    const DARK_THEME = "ide-dark";
    const LIGHT_THEME = "ide-light";

    function defineThemes() {
        if (typeof monaco === "undefined") return;

        monaco.editor.defineTheme(DARK_THEME, {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "569cd6", fontStyle: "bold" },
                { token: "keyword.sql", foreground: "569cd6", fontStyle: "bold" },
                { token: "operator", foreground: "d4d4d4" },
                { token: "predefined", foreground: "dcdcaa" },
                { token: "variable", foreground: "9cdcfe" },
                { token: "variable.predefined", foreground: "4fc1ff" },
                { token: "string", foreground: "ce9178" },
                { token: "string.escape", foreground: "d7ba7d" },
                { token: "comment", foreground: "6a9955", fontStyle: "italic" },
                { token: "comment.quote", foreground: "6a9955", fontStyle: "italic" },
                { token: "number", foreground: "b5cea8" },
                { token: "number.hex", foreground: "b5cea8" },
                { token: "type", foreground: "4ec9b0" },
                { token: "type.identifier", foreground: "4ec9b0" },
                { token: "delimiter", foreground: "d4d4d4" },
                { token: "identifier.quote", foreground: "9cdcfe" },
                // XML Token Highlighting for ide-dark
                { token: "tag", foreground: "4ec9b0", fontStyle: "bold" },
                { token: "tag.xml", foreground: "4ec9b0", fontStyle: "bold" },
                { token: "metatag", foreground: "569cd6" },
                { token: "metatag.xml", foreground: "569cd6" },
                { token: "metatag.content.xml", foreground: "dcdcaa" },
                { token: "attribute.name", foreground: "9cdcfe" },
                { token: "attribute.name.xml", foreground: "9cdcfe" },
                { token: "attribute.value", foreground: "ce9178" },
                { token: "attribute.value.xml", foreground: "ce9178" },
                { token: "delimiter.xml", foreground: "808080" },
                { token: "delimiter.cdata", foreground: "d7ba7d" },
                { token: "comment.content", foreground: "6a9955", fontStyle: "italic" },
                { token: "comment.xml", foreground: "6a9955", fontStyle: "italic" }
            ],
            colors: {
                "editor.background": "#1e1e1e",
                "editor.foreground": "#d4d4d4",
                "editor.lineHighlightBackground": "#2d2d2d",
                "editorLineNumber.foreground": "#858585",
                "editorLineNumber.activeForeground": "#c6c6c6",
                "editor.selectionBackground": "#264f78",
                "editor.selectionHighlightBackground": "#2f3f5c",
                "editorCursor.foreground": "#aeafad",
                "editorIndentGuide.background1": "#404040",
                "editorIndentGuide.activeBackground1": "#707070",
                "scrollbarSlider.background": "#424242",
                "scrollbarSlider.hoverBackground": "#686868",
                "editorWidget.background": "#252526",
                "editorWidget.border": "#454545",
                "editorSuggestWidget.background": "#252526",
                "editorSuggestWidget.border": "#454545",
                "editorSuggestWidget.selectedBackground": "#0d6efd33",
                "editorHoverWidget.background": "#252526",
                "editorHoverWidget.border": "#454545"
            }
        });

        monaco.editor.defineTheme(LIGHT_THEME, {
            base: "vs",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "0000ff", fontStyle: "bold" },
                { token: "keyword.sql", foreground: "0000ff", fontStyle: "bold" },
                { token: "operator", foreground: "000000" },
                { token: "predefined", foreground: "795e26" },
                { token: "variable", foreground: "001080" },
                { token: "variable.predefined", foreground: "0070c1" },
                { token: "string", foreground: "a31515" },
                { token: "string.escape", foreground: "ee0000" },
                { token: "comment", foreground: "008000", fontStyle: "italic" },
                { token: "comment.quote", foreground: "008000", fontStyle: "italic" },
                { token: "number", foreground: "098658" },
                { token: "number.hex", foreground: "098658" },
                { token: "type", foreground: "267f99" },
                { token: "type.identifier", foreground: "267f99" },
                { token: "delimiter", foreground: "000000" },
                { token: "identifier.quote", foreground: "001080" },
                // XML Token Highlighting for ide-light
                { token: "tag", foreground: "800000", fontStyle: "bold" },
                { token: "tag.xml", foreground: "800000", fontStyle: "bold" },
                { token: "metatag", foreground: "800080" },
                { token: "metatag.xml", foreground: "800080" },
                { token: "metatag.content.xml", foreground: "795e26" },
                { token: "attribute.name", foreground: "e50000" },
                { token: "attribute.name.xml", foreground: "e50000" },
                { token: "attribute.value", foreground: "0000ff" },
                { token: "attribute.value.xml", foreground: "0000ff" },
                { token: "delimiter.xml", foreground: "0000ff" },
                { token: "delimiter.cdata", foreground: "800000" },
                { token: "comment.content", foreground: "008000", fontStyle: "italic" },
                { token: "comment.xml", foreground: "008000", fontStyle: "italic" }
            ],
            colors: {
                "editor.background": "#ffffff",
                "editor.foreground": "#1e1e1e",
                "editor.lineHighlightBackground": "#f8f8f8",
                "editorLineNumber.foreground": "#a0a0a0"
            }
        });

        // Tokyo Night Light — Authentic light lavender editor theme
        monaco.editor.defineTheme("tokyo-night-light", {
            base: "vs",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "2959aa", fontStyle: "bold" },
                { token: "keyword.sql", foreground: "2959aa", fontStyle: "bold" },
                { token: "operator", foreground: "343b59" },
                { token: "predefined", foreground: "795e26" },
                { token: "variable", foreground: "001080" },
                { token: "variable.predefined", foreground: "0070c1" },
                { token: "string", foreground: "485e30" },
                { token: "string.escape", foreground: "ee0000" },
                { token: "comment", foreground: "848b98", fontStyle: "italic" },
                { token: "comment.quote", foreground: "848b98", fontStyle: "italic" },
                { token: "number", foreground: "965027" },
                { token: "number.hex", foreground: "965027" },
                { token: "type", foreground: "166775" },
                { token: "type.identifier", foreground: "166775" },
                { token: "delimiter", foreground: "343b59" },
                { token: "identifier.quote", foreground: "001080" }
            ],
            colors: {
                "editor.background": "#e6e7ed",
                "editor.foreground": "#343b59",
                "editor.lineHighlightBackground": "#dcdee3",
                "editorLineNumber.foreground": "#9da0ab",
                "editor.selectionBackground": "#acb0bf40",
                "editorWidget.background": "#d6d8df"
            }
        });

        // Tokyo Night Dark
        monaco.editor.defineTheme("tokyo-night-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "7aa2f7", fontStyle: "bold" },
                { token: "keyword.sql", foreground: "7aa2f7", fontStyle: "bold" },
                { token: "operator", foreground: "89ddff" },
                { token: "predefined", foreground: "0db9d7" },
                { token: "variable", foreground: "c0caf5" },
                { token: "string", foreground: "9ece6a" },
                { token: "comment", foreground: "565f89", fontStyle: "italic" },
                { token: "number", foreground: "ff9e64" },
                { token: "type", foreground: "2ac3de" }
            ],
            colors: {
                "editor.background": "#1a1b26",
                "editor.foreground": "#a9b1d6",
                "editor.lineHighlightBackground": "#1e202e",
                "editorLineNumber.foreground": "#363b54",
                "editor.selectionBackground": "#515c7e4d"
            }
        });

        // Tokyo Night Storm
        monaco.editor.defineTheme("tokyo-night-storm-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [
                { token: "keyword", foreground: "7aa2f7", fontStyle: "bold" },
                { token: "keyword.sql", foreground: "7aa2f7", fontStyle: "bold" },
                { token: "operator", foreground: "89ddff" },
                { token: "predefined", foreground: "0db9d7" },
                { token: "variable", foreground: "c0caf5" },
                { token: "string", foreground: "9ece6a" },
                { token: "comment", foreground: "565f89", fontStyle: "italic" },
                { token: "number", foreground: "ff9e64" },
                { token: "type", foreground: "2ac3de" }
            ],
            colors: {
                "editor.background": "#24283b",
                "editor.foreground": "#a9b1d6",
                "editor.lineHighlightBackground": "#292e42",
                "editorLineNumber.foreground": "#3b4261",
                "editor.selectionBackground": "#515c7e4d"
            }
        });

        // Monokai
        monaco.editor.defineTheme("monokai", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#272822",
                "editor.foreground": "#f8f8f2",
                "editor.lineHighlightBackground": "#3e3d32"
            }
        });

        // Nord
        monaco.editor.defineTheme("nord", {
            base: "vs-dark",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#2e3440",
                "editor.foreground": "#d8dee9",
                "editor.lineHighlightBackground": "#3b4252"
            }
        });
    }

    function ensureDynamicMonacoTheme(themeObj) {
        if (typeof monaco === "undefined" || !monaco.editor || !themeObj || !themeObj.id) return;
        const themeId = themeObj.id;
        const isDark = Boolean(themeObj.isDark);

        let bg = isDark ? "#1e1e1e" : "#ffffff";
        let fg = isDark ? "#d4d4d4" : "#1e1e1e";
        try {
            const computed = window.getComputedStyle(document.documentElement);
            const cssBg = (computed.getPropertyValue('--ide-bg-editor') || '').trim();
            const cssFg = (computed.getPropertyValue('--ide-text-main') || '').trim();
            if (cssBg) bg = cssBg;
            if (cssFg) fg = cssFg;
        } catch (_) {}

        monaco.editor.defineTheme(themeId, {
            base: isDark ? "vs-dark" : "vs",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": bg,
                "editor.foreground": fg,
                "editor.lineHighlightBackground": isDark ? "#2d2d2d" : "#f8f8f8",
                "editorLineNumber.foreground": isDark ? "#858585" : "#a0a0a0"
            }
        });
    }

    function getMonacoTheme(themeName) {
        if (!themeName) {
            themeName = document.documentElement.getAttribute("data-bs-theme") || "dark";
        }

        // 1. Direct specific themes defined in Monaco
        const definedThemes = [
            "tokyo-night-light",
            "tokyo-night-dark",
            "tokyo-night-storm-dark",
            "monokai",
            "nord",
            DARK_THEME,
            LIGHT_THEME
        ];
        if (definedThemes.includes(themeName)) {
            return themeName;
        }

        // 2. Check ThemeRegistry for dark vs light
        const reg = window.ThemeRegistry || (window.parent && window.parent.ThemeRegistry);
        if (reg && typeof reg.getThemeById === 'function') {
            const tObj = reg.getThemeById(themeName);
            if (tObj && tObj.id === themeName) {
                ensureDynamicMonacoTheme(tObj);
                return themeName;
            }
        }

        // 3. Fallback: check if name represents a light theme
        const isLight = (
            themeName === "light" ||
            themeName === "win-nt" ||
            themeName === "win-xp" ||
            themeName.toLowerCase().includes("light") ||
            themeName.toLowerCase().endsWith("-light")
        );

        return isLight ? LIGHT_THEME : DARK_THEME;
    }

    function getMonacoLanguage(dbType) {
        // Monaco uses generic "sql" for all SQL dialects
        return "sql";
    }

    window.MonacoInit = {
        DARK_THEME, LIGHT_THEME,
        defineThemes, getMonacoTheme, getMonacoLanguage,
        basePath: _base
    };

    const _readyCallbacks = [];
    let _isMonacoReady = false;

    function _fireReady() {
        _isMonacoReady = true;
        defineThemes();
        if (window.MonacoSqlLanguage && typeof window.MonacoSqlLanguage.register === 'function') {
            window.MonacoSqlLanguage.register();
        }
        try {
            const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
            const mTheme = getMonacoTheme(curTheme);
            if (typeof monaco !== 'undefined' && monaco.editor) {
                monaco.editor.setTheme(mTheme);
            }
        } catch (_) {}
        while (_readyCallbacks.length > 0) {
            const cb = _readyCallbacks.shift();
            try { cb(); } catch (e) { console.error('[MonacoInit] Callback error:', e); }
        }
        try {
            window.dispatchEvent(new CustomEvent('monaco-ready', { detail: { monaco } }));
        } catch (_) {}
    }

    // Called by editor.js and other components after AMD load
    window._onMonacoReady = function (callback) {
        if (_isMonacoReady && typeof monaco !== 'undefined' && monaco.editor) {
            if (callback) callback();
            return;
        }
        if (callback) _readyCallbacks.push(callback);
        if (typeof monaco !== 'undefined' && monaco.editor) {
            _fireReady();
        } else if (typeof window.require !== 'undefined') {
            window.require(['vs/editor/editor.main'], function () {
                _fireReady();
            });
        }
    };

    // Auto-trigger loading immediately
    if (typeof window.require !== 'undefined') {
        window._onMonacoReady();
    }

})(window);
