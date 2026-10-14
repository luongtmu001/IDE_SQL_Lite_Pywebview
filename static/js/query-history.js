/**
 * QUERY HISTORY CONTROLLER & REAL STORE ENGINE — luoBTool IDE
 * Kết nối giao diện Query History với SQLite Engine qua Zero-Network IPC / REST API.
 * Hỗ trợ nhóm theo mốc thời gian, lọc, xem trước SQL, diff, xóa và mở vào tab mới.
 */

(function () {
    'use strict';

    // ── Application State ─────────────────────────────────────────────────────
    const state = {
        documents: [],
        entriesMap: {}, // docId -> Array of normalized entries
        selectedDocId: null,
        selectedEntryId: null,
        searchQuery: '',
        filterFavoritesOnly: false,
        entryStatusFilter: 'all', // all, ok, error, selection
        isWrapCode: false,
        monacoEditor: null,
        diffEditor: null,
        isDiffActive: false,
        diffInline: false,
        diffOriginalModel: null,
        diffModifiedModel: null,
        editorSettings: null,
        isLoadingDocs: false,
        isLoadingEntries: false,
        searchDebounceTimer: null,
        // Phase 5: Advanced Filters
        filterServer: '',
        filterDatabase: '',
        filterDateRange: 'all',
        filterTag: '',
        filterFromTimestamp: null,
        filterToTimestamp: null,
        filterOptions: { servers: [], databases: [], tags: [] }
    };

    // ── Group Definitions ─────────────────────────────────────────────────────
    const GROUP_LABELS = {
        favorites: { title: '⭐ Yêu thích (Favorites)', icon: 'fa-star' },
        today: { title: 'Hôm nay (Today)', icon: 'fa-calendar-day' },
        yesterday: { title: 'Hôm qua (Yesterday)', icon: 'fa-calendar' },
        this_week: { title: 'Tuần này (This Week)', icon: 'fa-calendar-week' },
        last_week: { title: 'Tuần trước (Last Week)', icon: 'fa-calendar-days' },
        two_weeks_ago: { title: 'Hai tuần trước (Two Weeks Ago)', icon: 'fa-calendar-minus' },
        last_month: { title: 'Tháng trước (Last Month)', icon: 'fa-clock' },
        older: { title: 'Cũ hơn (Older)', icon: 'fa-box-archive' }
    };

    // ── Data Normalization Helpers ───────────────────────────────────────────
    function normalizeDoc(d) {
        if (!d) return null;
        return {
            docId: d.DocId || d.docId,
            displayName: d.DisplayName || d.displayName || 'Untitled.sql',
            filePath: d.FilePath !== undefined ? d.FilePath : d.filePath,
            isStarred: Boolean(d.IsStarred !== undefined ? d.IsStarred : d.isStarred),
            createdAt: d.CreatedAt || d.createdAt,
            lastRunAt: d.LastRunAt || d.lastRunAt,
            lastServer: d.LastServer || d.lastServer || 'localhost',
            lastDatabase: d.LastDatabase || d.lastDatabase || 'master',
            entryCount: d.EntryCount !== undefined ? d.EntryCount : (d.entryCount || 0)
        };
    }

    function normalizeEntry(e) {
        if (!e) return null;
        let tags = [];
        if (Array.isArray(e.Tags)) {
            tags = e.Tags.map(t => (typeof t === 'string' ? t : (t.name || t.TagName || ''))).filter(Boolean);
        } else if (Array.isArray(e.tags)) {
            tags = e.tags.map(t => (typeof t === 'string' ? t : (t.name || t.TagName || ''))).filter(Boolean);
        } else if (e.Tag) {
            tags = String(e.Tag).split(',').map(s => s.trim()).filter(Boolean);
        } else if (e.tag) {
            tags = String(e.tag).split(',').map(s => s.trim()).filter(Boolean);
        }
        return {
            entryId: Number(e.EntryId !== undefined ? e.EntryId : e.entryId),
            docId: e.DocId || e.docId,
            entryType: Number(e.EntryType !== undefined ? e.EntryType : (e.entryType || 1)),
            executedAt: e.ExecutedAt || e.executedAt,
            server: e.Server || e.server || 'localhost',
            database: e.DatabaseName || e.database || 'master',
            login: e.LoginName || e.login || 'sa',
            isSelection: Boolean(e.IsSelection !== undefined ? e.IsSelection : e.isSelection),
            isFavorite: Boolean(e.IsFavorite !== undefined ? e.IsFavorite : (e.is_favorite !== undefined ? e.is_favorite : e.isFavorite)),
            durationMs: e.DurationMs !== undefined ? e.DurationMs : (e.durationMs !== undefined ? e.durationMs : null),
            status: e.Status !== undefined ? e.Status : (e.status !== undefined ? e.status : null),
            errorSummary: e.ErrorSummary !== undefined ? e.ErrorSummary : e.errorSummary,
            runCount: Number(e.RunCount !== undefined ? e.RunCount : (e.runCount || 1)),
            rawSize: Number(e.RawSize !== undefined ? e.RawSize : (e.rawSize || 0)),
            sql: e.Sql !== undefined ? e.Sql : (e.sql !== undefined ? e.sql : null),
            note: (e.Note !== undefined ? e.Note : (e.note || '')) || '',
            tag: (e.Tag !== undefined ? e.Tag : (e.tag || '')) || '',
            tags: tags
        };
    }

    function getGroupForTimestamp(ts) {
        if (!ts) return 'older';
        const timeMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
        const now = Date.now();
        const diffHours = (now - timeMs) / (1000 * 60 * 60);

        const date = new Date(timeMs);
        const nowDate = new Date(now);

        const isToday = date.toDateString() === nowDate.toDateString();
        if (isToday) return 'today';

        const yesterday = new Date(now);
        yesterday.setDate(nowDate.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) return 'yesterday';

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays <= 7) return 'this_week';
        if (diffDays <= 14) return 'last_week';
        if (diffDays <= 21) return 'two_weeks_ago';
        if (diffDays <= 30) return 'last_month';
        return 'older';
    }

    // ── Initialization ────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        // Nạp trước cấu hình từ localStorage (nếu có) để áp dụng ngay từ đầu
        try {
            const raw = localStorage.getItem('ide-settings');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.editor) {
                    await applyEditorFontSettings(parsed.editor, parsed);
                }
            }
        } catch (_) {}

        initMonacoEditor();
        initSplitters();
        initEventListeners();

        // Đợi native API (nếu có) sẵn sàng trước khi nạp dữ liệu
        if (window.waitForPywebview) {
            await window.waitForPywebview();
        }

        // Tự động đồng bộ toàn bộ thiết lập Text Editor của IDE (chỉ đọc)
        await applyEditorFontSettings();

        await loadStorageStats();
        await loadFilterOptions();
        await loadDocuments();
    });

    // ── Dedicated SQL Folding Range Provider (Hỗ trợ collapse / expand đầy đủ) ──
    function registerSqlFoldingProvider() {
        if (typeof monaco === 'undefined' || !monaco.languages || !monaco.languages.registerFoldingRangeProvider) return;
        if (window._qhSqlFoldingRegistered) return;
        window._qhSqlFoldingRegistered = true;

        monaco.languages.registerFoldingRangeProvider('sql', {
            provideFoldingRanges: function (model, context, token) {
                const ranges = [];
                const lineCount = model.getLineCount();
                const blockStack = [];
                const parenStack = [];
                let inComment = false;
                let commentStart = -1;

                for (let i = 1; i <= lineCount; i++) {
                    const line = model.getLineContent(i);
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // 1. Khối chú thích nhiều dòng /* ... */
                    if (!inComment && trimmed.includes('/*')) {
                        inComment = true;
                        commentStart = i;
                    }
                    if (inComment) {
                        if (trimmed.includes('*/')) {
                            inComment = false;
                            if (i > commentStart) {
                                ranges.push({
                                    start: commentStart,
                                    end: i,
                                    kind: monaco.languages.FoldingRangeKind.Comment
                                });
                            }
                        }
                        continue;
                    }

                    // 2. Điểm đánh dấu phân vùng --#region / --region ... --#endregion / --endregion
                    if (/^--\s*#?region\b/i.test(trimmed)) {
                        blockStack.push({ type: 'REGION', line: i });
                        continue;
                    }
                    if (/^--\s*#?endregion\b/i.test(trimmed)) {
                        for (let k = blockStack.length - 1; k >= 0; k--) {
                            if (blockStack[k].type === 'REGION') {
                                const start = blockStack.splice(k, 1)[0].line;
                                if (i > start) {
                                    ranges.push({
                                        start: start,
                                        end: i,
                                        kind: monaco.languages.FoldingRangeKind.Region
                                    });
                                }
                                break;
                            }
                        }
                        continue;
                    }

                    // Lọc bỏ comment đơn dòng và chuỗi ký tự để quét cú pháp chính xác
                    const clean = line.replace(/--.*$/, '').replace(/'(?:''|[^'])*'/g, "''");

                    // 3. Khối đóng mở ngoặc đơn nhiều dòng (CTEs, subqueries, danh sách cột)
                    for (let c = 0; c < clean.length; c++) {
                        if (clean[c] === '(') {
                            parenStack.push(i);
                        } else if (clean[c] === ')') {
                            if (parenStack.length > 0) {
                                const startParen = parenStack.pop();
                                if (i > startParen) {
                                    ranges.push({ start: startParen, end: i });
                                }
                            }
                        }
                    }

                    // 4. Khối lệnh logic SQL: BEGIN ... END, CASE ... END
                    const beginMatches = clean.match(/\bBEGIN\b/gi);
                    const caseMatches = clean.match(/\bCASE\b/gi);
                    const endMatches = clean.match(/\bEND\b/gi);

                    if (beginMatches) {
                        for (let b = 0; b < beginMatches.length; b++) {
                            blockStack.push({ type: 'BLOCK', line: i });
                        }
                    }
                    if (caseMatches) {
                        for (let c = 0; c < caseMatches.length; c++) {
                            blockStack.push({ type: 'BLOCK', line: i });
                        }
                    }
                    if (endMatches) {
                        for (let e = 0; e < endMatches.length; e++) {
                            for (let k = blockStack.length - 1; k >= 0; k--) {
                                if (blockStack[k].type === 'BLOCK') {
                                    const start = blockStack.splice(k, 1)[0].line;
                                    if (i > start) {
                                        ranges.push({ start: start, end: i });
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }

                // 5. Khối thụt dòng phân cấp (Indentation Folding)
                const indentStack = [];
                for (let i = 1; i <= lineCount; i++) {
                    const line = model.getLineContent(i);
                    if (!line.trim()) continue;
                    const indent = line.search(/\S/);
                    while (indentStack.length > 0 && indent <= indentStack[indentStack.length - 1].indent) {
                        const top = indentStack.pop();
                        if (i - 1 > top.line) {
                            if (!ranges.some(r => r.start === top.line && r.end === i - 1)) {
                                ranges.push({ start: top.line, end: i - 1 });
                            }
                        }
                    }
                    indentStack.push({ line: i, indent: indent });
                }
                while (indentStack.length > 0) {
                    const top = indentStack.pop();
                    if (lineCount > top.line && !ranges.some(r => r.start === top.line && r.end === lineCount)) {
                        ranges.push({ start: top.line, end: lineCount });
                    }
                }

                return ranges;
            }
        });
    }

    // ── Helper: Chiều cao dòng nhất quán với Text Editor chính ───────────────
    function computeEditorLineHeight(rawLineHeight, fontSize) {
        if (typeof window.computeEditorLineHeight === 'function') {
            return window.computeEditorLineHeight(rawLineHeight, fontSize);
        }
        const fs = Number(fontSize) || 14;
        const raw = Number(rawLineHeight);
        if (!raw || isNaN(raw) || raw <= 0) {
            return Math.round(fs * (19 / 13));
        }
        if (raw <= 4) {
            return Math.max(fs, Math.round(fs * raw));
        }
        return Math.max(fs, Math.round(raw));
    }

    // ── Monaco Editor Setup (Kế thừa đầy đủ menu Trình soạn thảo từ Settings) ─
    function initMonacoEditor() {
        const container = document.getElementById('qhMonacoEditor');
        if (!container) return;

        const setupMonaco = () => {
            if (state.monacoEditor || typeof monaco === 'undefined' || !monaco.editor) return;

            // Đăng ký Provider Folding riêng cho SQL để nhận diện mọi khối BEGIN..END, CASE..END, ngoặc đơn
            registerSqlFoldingProvider();

            const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
            let mTheme = 'ide-dark';
            if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
                mTheme = window.MonacoInit.getMonacoTheme(curTheme);
            } else {
                mTheme = (curTheme === 'light' || curTheme === 'win-nt' || curTheme === 'win-xp') ? 'ide-light' : 'ide-dark';
            }

            const s = state.editorSettings || {};
            const rawFont = s.fontFamily || 'Consolas';
            const cleanFont = rawFont.trim().replace(/^['"]+|['"]+$/g, '');
            const fontStack = cleanFont.includes('monospace') || cleanFont.includes('sans-serif')
                ? cleanFont
                : `"${cleanFont}", 'JetBrains Mono', 'Fira Code', 'Consolas', monospace`;
            const fontSize = Number(s.fontSize) || 14;
            state.baseFontSize = fontSize;
            const rawLH = s.lineHeight !== undefined ? Number(s.lineHeight) : 0;
            const computedLineHeight = computeEditorLineHeight(rawLH, fontSize);
            const letterSpacingNum = s.letterSpacing !== undefined ? Number(s.letterSpacing) : 0;
            const tabSize = Number(s.tabSize) || 4;
            const insertSpaces = s.insertSpaces !== undefined ? Boolean(s.insertSpaces) : false;
            const wordWrap = (s.wordWrap !== undefined) ? (s.wordWrap ? 'on' : 'off') : (state.isWrapCode ? 'on' : 'off');
            const minimapEnabled = s.minimap !== undefined ? Boolean(s.minimap) : false;

            state.monacoEditor = monaco.editor.create(container, {
                value: '-- Chọn một câu lệnh để xem trước nội dung',
                language: 'sql',
                theme: mTheme,
                readOnly: true,
                domReadOnly: false, // Để false để con trỏ, thao tác bôi đen, cuộn chuột và phím tắt hoạt động mượt mà
                automaticLayout: true,
                mouseWheelZoom: true, // Cuộn chuột giữ phím Ctrl để phóng to / thu nhỏ font chữ như text editor
                fontSize: fontSize,
                fontFamily: fontStack,
                lineHeight: computedLineHeight,
                letterSpacing: letterSpacingNum,
                tabSize: tabSize,
                insertSpaces: insertSpaces,
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                glyphMargin: true,
                folding: true, // Hỗ trợ collapse / expand code
                foldingStrategy: 'auto',
                showFoldingControls: 'always',
                foldingHighlight: true,
                matchBrackets: 'always',
                renderLineHighlight: 'all',
                scrollBeyondLastLine: false,
                wordWrap: wordWrap,
                contextmenu: true,
                find: {
                    addExtraSpaceOnTop: false,
                    autoFindInSelection: 'multiline',
                    seedSearchStringFromSelection: 'always'
                },
                minimap: { enabled: minimapEnabled, maxColumn: 80 },
                scrollbar: {
                    vertical: 'visible',
                    horizontal: 'auto',
                    verticalScrollbarSize: 10,
                    horizontalScrollbarSize: 10
                }
            });

            // Lắng nghe Ctrl + Wheel để zoom kích thước font mượt mà và chống zoom toàn bộ cửa sổ webview
            const domNode = state.monacoEditor.getDomNode();
            if (domNode) {
                domNode.addEventListener('wheel', (e) => {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        const curSize = state.monacoEditor.getOption(monaco.editor.EditorOption.fontSize) || 14;
                        const delta = e.deltaY < 0 ? 1 : -1;
                        const nextSize = Math.max(9, Math.min(48, curSize + delta));
                        if (nextSize !== curSize) {
                            const rawHeight = state.editorSettings?.lineHeight;
                            const nextLH = computeEditorLineHeight(rawHeight, nextSize);
                            state.monacoEditor.updateOptions({
                                fontSize: nextSize,
                                lineHeight: nextLH
                            });
                        }
                    }
                }, { passive: false });
            }

            // Đồng bộ line-height khi zoom font chữ giống hệt Text Editor chính
            state.monacoEditor.onDidChangeConfiguration((e) => {
                if (e.hasChanged(monaco.editor.EditorOption.fontSize)) {
                    const curFontSize = state.monacoEditor.getOption(monaco.editor.EditorOption.fontSize);
                    const rawHeight = state.editorSettings?.lineHeight;
                    const expectedLineHeight = computeEditorLineHeight(rawHeight, curFontSize);
                    if (state.monacoEditor.getOption(monaco.editor.EditorOption.lineHeight) !== expectedLineHeight) {
                        state.monacoEditor.updateOptions({ lineHeight: expectedLineHeight });
                    }
                }
            });

            // Tự động đồng bộ theme với Monaco Editor khi thuộc tính data-bs-theme thay đổi
            const themeObserver = new MutationObserver((mutations) => {
                mutations.forEach((m) => {
                    if (m.type === 'attributes' && m.attributeName === 'data-bs-theme') {
                        const themeVal = document.documentElement.getAttribute('data-bs-theme') || 'dark';
                        let newTheme = 'ide-dark';
                        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
                            newTheme = window.MonacoInit.getMonacoTheme(themeVal);
                        } else {
                            newTheme = (themeVal === 'light' || themeVal === 'win-nt' || themeVal === 'win-xp') ? 'ide-light' : 'ide-dark';
                        }
                        if (state.monacoEditor) {
                            monaco.editor.setTheme(newTheme);
                        }
                        syncNativeTitlebar(themeVal);
                    }
                });
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });

            // Nếu đang có entry được chọn, render ngay nội dung vào Monaco
            const curEntry = getCurrentEntry();
            if (curEntry) {
                renderPreview();
            }
        };

        if (typeof monaco !== 'undefined' && monaco.editor) {
            setupMonaco();
        } else if (typeof window._onMonacoReady === 'function') {
            window._onMonacoReady(setupMonaco);
        } else {
            window.addEventListener('monaco-ready', setupMonaco, { once: true });
        }
    }

    // ── Đọc và kế thừa toàn bộ cấu hình Trình soạn thảo (Text Editor) từ settings (CHỈ ĐỌC, KHÔNG GHI) ─────
    async function applyEditorFontSettings(overrideSettings = null, fullSettings = null) {
        let editorSettings = overrideSettings;
        let allSettings = fullSettings;

        // 1. Đọc qua Native IPC Bridge (Pywebview desktop)
        if (!editorSettings) {
            try {
                if (window.pywebview && window.pywebview.api) {
                    const api = window.pywebview.api;
                    if (typeof api.get_editor_settings === 'function') {
                        const res = await api.get_editor_settings();
                        if (res && res.success && res.editor) {
                            editorSettings = res.editor;
                            if (res.settings) allSettings = res.settings;
                            if (res.theme && !allSettings) allSettings = { theme: res.theme };
                        }
                    } else if (typeof api.get_settings === 'function') {
                        const res = await api.get_settings();
                        if (res && res.success && res.settings) {
                            allSettings = res.settings;
                            if (res.settings.editor) editorSettings = res.settings.editor;
                        }
                    }
                }
            } catch (_) {}
        }

        // 2. Fallback qua REST API (Flask / Web mode)
        if (!editorSettings) {
            try {
                const res = await fetch('/api/history/editor_settings');
                const data = await res.json();
                if (data && data.success && data.editor) {
                    editorSettings = data.editor;
                    if (data.settings) allSettings = data.settings;
                    if (data.theme && !allSettings) allSettings = { theme: data.theme };
                }
            } catch (_) {}
        }

        // 3. Fallback qua localStorage nếu trước đó main window có lưu profile
        if (!editorSettings) {
            try {
                const raw = localStorage.getItem('ide-settings');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed) {
                        allSettings = parsed;
                        if (parsed.editor) editorSettings = parsed.editor;
                    }
                }
            } catch (_) {}
        }

        if (!editorSettings && !state.editorSettings) return;
        if (editorSettings) state.editorSettings = editorSettings;
        const s = state.editorSettings || {};

        // 1. Phông chữ soạn thảo (fontFamily)
        const rawFont = s.fontFamily || 'Consolas';
        const cleanName = rawFont.trim().replace(/^['"]+|['"]+$/g, '');
        const fontStack = cleanName.includes('monospace') || cleanName.includes('sans-serif')
            ? cleanName
            : `"${cleanName}", 'JetBrains Mono', 'Fira Code', 'Consolas', monospace`;

        // 2. Cỡ chữ soạn thảo (fontSize)
        const fontSize = Number(s.fontSize) || 14;
        state.baseFontSize = fontSize;

        // 3. Chiều cao dòng (lineHeight) - xử lý cả tỉ lệ và pixel
        const rawLineHeight = s.lineHeight !== undefined ? Number(s.lineHeight) : 0;
        const computedLineHeight = computeEditorLineHeight(rawLineHeight, fontSize);

        // 4. Khoảng cách ký tự (letterSpacing)
        const letterSpacingNum = s.letterSpacing !== undefined ? Number(s.letterSpacing) : 0;
        const letterSpacingCss = letterSpacingNum ? `${letterSpacingNum}px` : 'normal';

        // 5. Độ dài Tab (tabSize)
        const tabSize = Number(s.tabSize) || 4;

        // 6. Chèn khoảng trắng thay vì Tab (insertSpaces)
        const insertSpaces = s.insertSpaces !== undefined ? Boolean(s.insertSpaces) : false;

        // 7. Tự động ngắt dòng (wordWrap)
        if (s.wordWrap !== undefined) {
            state.isWrapCode = Boolean(s.wordWrap);
            const btnToggleWrap = document.getElementById('btnToggleWrap');
            if (btnToggleWrap) {
                btnToggleWrap.classList.toggle('active', state.isWrapCode);
            }
        }

        // 8. Bản đồ thu nhỏ (minimap)
        const minimapEnabled = s.minimap !== undefined ? Boolean(s.minimap) : false;

        // 9. Cấu hình Theme giao diện (Theme / Appearance)
        const activeTheme = (allSettings && (allSettings.appearance?.theme || allSettings.theme))
            || localStorage.getItem('ide-theme')
            || document.documentElement.getAttribute('data-bs-theme')
            || 'dark';
        if (activeTheme) {
            document.documentElement.setAttribute('data-bs-theme', activeTheme);
        }

        let mTheme = 'ide-dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            mTheme = window.MonacoInit.getMonacoTheme(activeTheme);
        } else {
            mTheme = (activeTheme === 'light' || activeTheme === 'win-nt' || activeTheme === 'win-xp') ? 'ide-light' : 'ide-dark';
        }

        // Áp dụng vào CSS Variables toàn cục
        document.documentElement.style.setProperty('--ide-editor-font-family', fontStack);
        document.documentElement.style.setProperty('--ide-editor-font-size', `${fontSize}px`);
        if (rawLineHeight > 0 && rawLineHeight <= 4) {
            document.documentElement.style.setProperty('--ide-editor-line-height', String(rawLineHeight));
        } else if (rawLineHeight > 4) {
            document.documentElement.style.setProperty('--ide-editor-line-height', `${rawLineHeight}px`);
        } else {
            document.documentElement.style.setProperty('--ide-editor-line-height', 'normal');
        }
        document.documentElement.style.setProperty('--ide-editor-letter-spacing', letterSpacingCss);
        document.documentElement.style.setProperty('--ide-editor-tab-size', String(tabSize));

        // Áp dụng trực tiếp vào Monaco Editor nếu đã khởi tạo
        if (state.monacoEditor) {
            state.monacoEditor.updateOptions({
                fontFamily: fontStack,
                fontSize: fontSize,
                lineHeight: computedLineHeight,
                letterSpacing: letterSpacingNum,
                tabSize: tabSize,
                insertSpaces: insertSpaces,
                wordWrap: state.isWrapCode ? 'on' : 'off',
                minimap: { enabled: minimapEnabled, maxColumn: 80 }
            });
            if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.setTheme === 'function') {
                monaco.editor.setTheme(mTheme);
            }
            const model = state.monacoEditor.getModel();
            if (model) {
                model.updateOptions({
                    tabSize: tabSize,
                    insertSpaces: insertSpaces
                });
            }
        }

        if (state.diffEditor) {
            state.diffEditor.updateOptions({
                fontFamily: fontStack,
                fontSize: fontSize,
                lineHeight: computedLineHeight,
                letterSpacing: letterSpacingNum
            });
        }

        // Đồng bộ màu thanh tiêu đề Windows (Titlebar / Taskbar) qua DWM
        syncNativeTitlebar(activeTheme);
    }

    // ── Đồng bộ thanh tiêu đề Windows (Titlebar / Taskbar) theo Theme ────────
    function syncNativeTitlebar(themeName) {
        try {
            if (!window.pywebview || !window.pywebview.api) {
                // Thử lại nếu API chưa sẵn sàng
                setTimeout(() => syncNativeTitlebar(themeName), 150);
                return;
            }
            const api = window.pywebview.api;
            if (typeof api.apply_titlebar_theme !== 'function') return;

            const computed = getComputedStyle(document.documentElement);
            const bg = (computed.getPropertyValue('--ide-titlebar-bg') || '').trim()
                || (computed.getPropertyValue('--ide-bg-toolbar') || '').trim()
                || (computed.getPropertyValue('--ide-bg-main') || '').trim();
            const text = (computed.getPropertyValue('--ide-titlebar-text') || '').trim()
                || (computed.getPropertyValue('--ide-text-active') || '').trim()
                || (computed.getPropertyValue('--ide-text-main') || '').trim();
            const border = (computed.getPropertyValue('--ide-border') || '').trim();

            const curMode = document.documentElement.getAttribute('data-bs-theme') || '';
            const isDark = curMode !== 'light' && !curMode.includes('light');

            api.apply_titlebar_theme(bg || themeName, text, border, isDark);
        } catch (_) {}
    }

    // Lắng nghe khi pywebview IPC cầu nối sẵn sàng
    window.addEventListener('pywebviewready', () => {
        const theme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        syncNativeTitlebar(theme);
    });

    // Hàm áp dụng theme toàn diện cho cửa sổ Query History
    window.applyHistoryTheme = function (themeName) {
        if (!themeName) return;
        document.documentElement.setAttribute('data-bs-theme', themeName);
        if (state.editorSettings) {
            applyEditorFontSettings(state.editorSettings, { theme: themeName });
        } else {
            syncNativeTitlebar(themeName);
        }
    };

    // ── Lắng nghe broadcast thay đổi cài đặt từ IDE chính theo thời gian thực ─────
    window.onSettingsChanged = function (newSettings) {
        if (!newSettings) return;
        const theme = newSettings.appearance?.theme || newSettings.theme;
        if (newSettings.editor) {
            applyEditorFontSettings(newSettings.editor, newSettings);
        } else if (theme) {
            applyEditorFontSettings(state.editorSettings, newSettings);
        }
        if (theme) {
            syncNativeTitlebar(theme);
        }
    };

    window.addEventListener('ide-theme-changed', (e) => {
        if (e && e.detail && e.detail.theme) {
            window.applyHistoryTheme(e.detail.theme);
        }
    });

    window.addEventListener('storage', (e) => {
        if (e.key === 'ide-settings' && e.newValue) {
            try {
                const parsed = JSON.parse(e.newValue);
                if (parsed && parsed.editor) {
                    applyEditorFontSettings(parsed.editor, parsed);
                }
            } catch (_) {}
        } else if (e.key === 'ide-theme' && e.newValue) {
            window.applyHistoryTheme(e.newValue);
        }
    });

    // ── Splitters / Drag Resizers ─────────────────────────────────────────────
    function initSplitters() {
        // 1. Horizontal Resizer (Top-Left Docs vs Bottom-Left Entries)
        const hResizer = document.getElementById('qhHResizer');
        const docsPanel = document.getElementById('qhDocsPanel');
        const entriesPanel = document.getElementById('qhEntriesPanel');

        if (hResizer && docsPanel && entriesPanel) {
            let isDraggingH = false;
            let startY = 0;
            let startEntriesHeight = 0;

            hResizer.addEventListener('pointerdown', (e) => {
                isDraggingH = true;
                startY = e.clientY;
                startEntriesHeight = entriesPanel.getBoundingClientRect().height;
                hResizer.setPointerCapture(e.pointerId);
                hResizer.classList.add('resizing');
                document.body.style.cursor = 'row-resize';
            });

            hResizer.addEventListener('pointermove', (e) => {
                if (!isDraggingH) return;
                const deltaY = e.clientY - startY;
                const newHeight = Math.max(120, Math.min(500, startEntriesHeight - deltaY));
                entriesPanel.style.height = `${newHeight}px`;
            });

            const stopDragH = (e) => {
                if (!isDraggingH) return;
                isDraggingH = false;
                try { hResizer.releasePointerCapture(e.pointerId); } catch (_) { }
                hResizer.classList.remove('resizing');
                document.body.style.cursor = '';
            };

            hResizer.addEventListener('pointerup', stopDragH);
            hResizer.addEventListener('pointercancel', stopDragH);
        }

        // 2. Vertical Resizer (Left Column vs Right Preview Panel)
        const vResizer = document.getElementById('qhVResizer');
        const leftCol = document.getElementById('qhLeftCol');

        if (vResizer && leftCol) {
            let isDraggingV = false;
            let startX = 0;
            let startWidth = 0;

            vResizer.addEventListener('pointerdown', (e) => {
                isDraggingV = true;
                startX = e.clientX;
                startWidth = leftCol.getBoundingClientRect().width;
                vResizer.setPointerCapture(e.pointerId);
                vResizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
            });

            vResizer.addEventListener('pointermove', (e) => {
                if (!isDraggingV) return;
                const deltaX = e.clientX - startX;
                const newWidth = Math.max(300, Math.min(750, startWidth + deltaX));
                leftCol.style.width = `${newWidth}px`;
                if (state.monacoEditor) {
                    state.monacoEditor.layout();
                }
            });

            const stopDragV = (e) => {
                if (!isDraggingV) return;
                isDraggingV = false;
                try { vResizer.releasePointerCapture(e.pointerId); } catch (_) { }
                vResizer.classList.remove('resizing');
                document.body.style.cursor = '';
                if (state.monacoEditor) {
                    state.monacoEditor.layout();
                }
            };

            vResizer.addEventListener('pointerup', stopDragV);
            vResizer.addEventListener('pointercancel', stopDragV);
        }
    }

    // ── Event Listeners ───────────────────────────────────────────────────────
    function initEventListeners() {
        // Quick Search input
        const searchInput = document.getElementById('qhSearchInput');
        const searchClear = document.getElementById('qhSearchClear');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                state.searchQuery = val.toLowerCase();
                if (searchClear) {
                    searchClear.style.display = val ? 'block' : 'none';
                }
                clearTimeout(state.searchDebounceTimer);
                state.searchDebounceTimer = setTimeout(() => {
                    loadDocuments();
                }, 250);
            });
        }

        if (searchClear) {
            searchClear.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    state.searchQuery = '';
                    searchClear.style.display = 'none';
                    loadDocuments();
                }
            });
        }

        // Favorites toggle button
        const btnFilterFav = document.getElementById('btnFilterFav');
        if (btnFilterFav) {
            btnFilterFav.addEventListener('click', () => {
                state.filterFavoritesOnly = !state.filterFavoritesOnly;
                btnFilterFav.classList.toggle('active', state.filterFavoritesOnly);
                loadDocuments();
                showToast(state.filterFavoritesOnly ? 'Đang lọc: Chỉ hiện file yêu thích ⭐' : 'Đang hiện: Toàn bộ file');
            });
        }

        // Refresh button
        const btnRefresh = document.getElementById('btnRefresh');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', async () => {
                await loadStorageStats();
                await loadDocuments();
                showToast('Đã làm mới danh sách lịch sử truy vấn');
            });
        }

        // Open containing folder
        const btnOpenFolder = document.getElementById('btnOpenContainingFolder');
        if (btnOpenFolder) {
            btnOpenFolder.addEventListener('click', async () => {
                const curDoc = getCurrentDoc();
                if (!curDoc || !curDoc.filePath) {
                    showToast('File này chưa được lưu ra đĩa (Draft)');
                    return;
                }
                try {
                    await fetch('/api/history/open_containing_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file_path: curDoc.filePath })
                    });
                } catch (err) {
                    showToast('Không thể mở thư mục: ' + err.message);
                }
            });
        }

        // Clear history of current document
        const btnClearDoc = document.getElementById('btnClearHistory');
        if (btnClearDoc) {
            btnClearDoc.addEventListener('click', async () => {
                const curDoc = getCurrentDoc();
                if (!curDoc) return;
                const confirmed = window.confirm(`Bạn có chắc muốn xóa toàn bộ lịch sử của "${curDoc.displayName}" không?`);
                if (!confirmed) return;

                try {
                    const res = await fetch(`/api/history/document/${encodeURIComponent(curDoc.docId)}`, {
                        method: 'DELETE'
                    });
                    const data = await res.json();
                    if (data && data.success) {
                        delete state.entriesMap[curDoc.docId];
                        state.selectedDocId = null;
                        state.selectedEntryId = null;
                        await loadStorageStats();
                        await loadDocuments();
                        showToast(`Đã xóa lịch sử của "${curDoc.displayName}"`);
                    } else {
                        showToast('Không thể xóa lịch sử file');
                    }
                } catch (err) {
                    showToast('Lỗi xóa lịch sử: ' + err.message);
                }
            });
        }

        // Copy SQL button
        const btnCopySql = document.getElementById('btnCopySql');
        const btnHeaderCopy = document.getElementById('btnHeaderCopy');
        const handleCopy = () => {
            const currentEntry = getCurrentEntry();
            if (!currentEntry || !currentEntry.sql) {
                showToast('Không có nội dung SQL để sao chép');
                return;
            }
            navigator.clipboard.writeText(currentEntry.sql).then(() => {
                showToast('Đã sao chép câu lệnh SQL vào clipboard!');
            }).catch(() => {
                showToast('Không thể sao chép tự động, vui lòng chọn và Ctrl+C');
            });
        };

        if (btnCopySql) btnCopySql.addEventListener('click', handleCopy);
        if (btnHeaderCopy) btnHeaderCopy.addEventListener('click', handleCopy);

        // Open in Editor button
        const btnOpenEditor = document.getElementById('btnOpenEditor');
        if (btnOpenEditor) {
            btnOpenEditor.addEventListener('click', () => {
                openCurrentEntryInEditor();
            });
        }

        // Find in SQL Button
        const btnHeaderFind = document.getElementById('btnHeaderFind');
        if (btnHeaderFind) {
            btnHeaderFind.addEventListener('click', () => {
                if (state.monacoEditor) {
                    state.monacoEditor.focus();
                    state.monacoEditor.trigger('toolbar', 'actions.find');
                }
            });
        }

        // Collapse / Expand All (Folding) Toggle
        const btnToggleFold = document.getElementById('btnToggleFold');
        if (btnToggleFold) {
            let isFolded = false;
            btnToggleFold.addEventListener('click', () => {
                if (!state.monacoEditor) return;
                isFolded = !isFolded;
                if (isFolded) {
                    state.monacoEditor.trigger('fold', 'editor.foldAll');
                    btnToggleFold.innerHTML = '<i class="fa-solid fa-expand"></i><span>Unfold</span>';
                    btnToggleFold.title = 'Mở rộng toàn bộ khối lệnh (Unfold All)';
                    showToast('Đã thu gọn toàn bộ khối code (Fold All)');
                } else {
                    state.monacoEditor.trigger('fold', 'editor.unfoldAll');
                    btnToggleFold.innerHTML = '<i class="fa-solid fa-compress"></i><span>Fold</span>';
                    btnToggleFold.title = 'Thu gọn toàn bộ khối lệnh (Fold All)';
                    showToast('Đã mở rộng toàn bộ khối code (Unfold All)');
                }
            });
        }

        // Wrap Lines Toggle
        const btnToggleWrap = document.getElementById('btnToggleWrap');
        if (btnToggleWrap) {
            btnToggleWrap.addEventListener('click', () => {
                state.isWrapCode = !state.isWrapCode;
                btnToggleWrap.classList.toggle('active', state.isWrapCode);
                if (state.monacoEditor) {
                    state.monacoEditor.updateOptions({ wordWrap: state.isWrapCode ? 'on' : 'off' });
                }
                showToast(state.isWrapCode ? 'Đã bật ngắt dòng tự động (Wrap Lines)' : 'Đã tắt ngắt dòng');
            });
        }

        // Entry filter pills (All, Success, Error, Selection)
        document.querySelectorAll('.qh-pill-btn').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.qh-pill-btn').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                state.entryStatusFilter = pill.dataset.filter;
                renderEntries();
            });
        });

        // ── Phase 5: Filter Drawer Events ──
        const btnAdvancedFilter = document.getElementById('btnAdvancedFilter');
        const filterDrawer = document.getElementById('qhFilterDrawer');
        const btnCloseFilterDrawer = document.getElementById('btnCloseFilterDrawer');
        const btnResetFilters = document.getElementById('btnResetFilters');

        if (btnAdvancedFilter && filterDrawer) {
            btnAdvancedFilter.addEventListener('click', () => {
                filterDrawer.classList.toggle('d-none');
            });
        }
        if (btnCloseFilterDrawer && filterDrawer) {
            btnCloseFilterDrawer.addEventListener('click', () => {
                filterDrawer.classList.add('d-none');
            });
        }
        if (btnResetFilters) {
            btnResetFilters.addEventListener('click', () => {
                resetFilters();
            });
        }

        ['qhFilterServer', 'qhFilterDatabase', 'qhFilterDateRange', 'qhFilterTag'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    applyFilterChange();
                });
            }
        });

        // ── Phase 5: Diff Menu & Dropdown Events ──
        const btnDiffMenu = document.getElementById('btnDiffMenu');
        const diffDropdown = document.getElementById('qhDiffDropdown');
        if (btnDiffMenu && diffDropdown) {
            btnDiffMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                diffDropdown.classList.toggle('d-none');
            });
        }

        document.addEventListener('click', (e) => {
            if (diffDropdown && !diffDropdown.classList.contains('d-none')) {
                const wrap = document.querySelector('.qh-diff-menu-wrap');
                if (wrap && !wrap.contains(e.target)) {
                    diffDropdown.classList.add('d-none');
                }
            }
        });

        const btnDiffPrev = document.getElementById('btnDiffPrev');
        if (btnDiffPrev) {
            btnDiffPrev.addEventListener('click', () => {
                if (diffDropdown) diffDropdown.classList.add('d-none');
                handleDiffPrevious();
            });
        }

        const btnDiffActive = document.getElementById('btnDiffActive');
        if (btnDiffActive) {
            btnDiffActive.addEventListener('click', () => {
                if (diffDropdown) diffDropdown.classList.add('d-none');
                handleDiffActiveEditor();
            });
        }

        const btnDiffPushMain = document.getElementById('btnDiffPushMain');
        if (btnDiffPushMain) {
            btnDiffPushMain.addEventListener('click', () => {
                if (diffDropdown) diffDropdown.classList.add('d-none');
                pushDiffToMainEditor();
            });
        }

        const btnToggleDiffInline = document.getElementById('btnToggleDiffInline');
        if (btnToggleDiffInline) {
            btnToggleDiffInline.addEventListener('click', () => {
                toggleDiffInline();
            });
        }

        const btnDiffPushFromBanner = document.getElementById('btnDiffPushFromBanner');
        if (btnDiffPushFromBanner) {
            btnDiffPushFromBanner.addEventListener('click', () => {
                pushDiffToMainEditor();
            });
        }

        const btnCloseDiff = document.getElementById('btnCloseDiff');
        if (btnCloseDiff) {
            btnCloseDiff.addEventListener('click', () => {
                closeDiffMode();
            });
        }

        // ── Phase 5 / 5.7: Note & Tag Bar Events ──
        const btnSaveNote = document.getElementById('btnSaveNote');
        const noteInput = document.getElementById('qhNoteInput');
        if (btnSaveNote) {
            btnSaveNote.addEventListener('click', () => {
                saveCurrentEntryNote();
            });
        }
        if (noteInput) {
            noteInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCurrentEntryNote();
                }
            });
        }

        // Star toggle on preview header
        const btnToggleEntryFav = document.getElementById('btnToggleEntryFav');
        if (btnToggleEntryFav) {
            btnToggleEntryFav.addEventListener('click', async () => {
                if (state.selectedEntryId) {
                    await toggleFavoriteEntry(state.selectedEntryId);
                }
            });
        }

        // Tag Popover toggle & actions
        const btnOpenTagPopover = document.getElementById('btnOpenTagPopover');
        const qhTagPopover = document.getElementById('qhTagPopover');
        const btnAddCustomTag = document.getElementById('btnAddCustomTag');
        const customTagInput = document.getElementById('qhCustomTagInput');
        const qhTagSuggestions = document.getElementById('qhTagSuggestions');

        if (btnOpenTagPopover && qhTagPopover) {
            btnOpenTagPopover.addEventListener('click', (e) => {
                e.stopPropagation();
                qhTagPopover.classList.toggle('d-none');
                if (!qhTagPopover.classList.contains('d-none')) {
                    if (customTagInput) {
                        customTagInput.value = '';
                        setTimeout(() => customTagInput.focus(), 50);
                    }
                    renderTagSuggestions();
                }
            });
        }

        if (btnAddCustomTag && customTagInput) {
            btnAddCustomTag.addEventListener('click', async (e) => {
                e.stopPropagation();
                const val = customTagInput.value.trim();
                if (val) {
                    await addTagToCurrentEntry(val);
                    customTagInput.value = '';
                    if (qhTagPopover) qhTagPopover.classList.add('d-none');
                }
            });
        }

        if (customTagInput) {
            customTagInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = customTagInput.value.trim();
                    if (val) {
                        await addTagToCurrentEntry(val);
                        customTagInput.value = '';
                        if (qhTagPopover) qhTagPopover.classList.add('d-none');
                    }
                }
            });
        }

        if (qhTagSuggestions) {
            qhTagSuggestions.addEventListener('click', async (e) => {
                const item = e.target.closest('.qh-tag-suggestion-item, .qh-tag-sug-item');
                if (item && item.dataset.tag) {
                    e.stopPropagation();
                    await addTagToCurrentEntry(item.dataset.tag);
                    if (qhTagPopover) qhTagPopover.classList.add('d-none');
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (qhTagPopover && !qhTagPopover.classList.contains('d-none')) {
                if (!qhTagPopover.contains(e.target) && e.target !== btnOpenTagPopover && !btnOpenTagPopover.contains(e.target)) {
                    qhTagPopover.classList.add('d-none');
                }
            }
        });

        const tagSelect = document.getElementById('qhTagSelect');
        if (tagSelect) {
            tagSelect.addEventListener('change', () => {
                handleTagSelect();
            });
        }

        const btnRemoveTag = document.getElementById('btnRemoveTag');
        if (btnRemoveTag) {
            btnRemoveTag.addEventListener('click', () => {
                handleRemoveTag();
            });
        }

        // ── Phase 5: Export & Import History Events ──
        const btnExportHistory = document.getElementById('btnExportHistory');
        if (btnExportHistory) {
            btnExportHistory.addEventListener('click', () => {
                handleExportHistory();
            });
        }

        const btnImportHistory = document.getElementById('btnImportHistory');
        const importFileInput = document.getElementById('qhImportFileInput');
        if (btnImportHistory && importFileInput) {
            btnImportHistory.addEventListener('click', () => {
                importFileInput.click();
            });
            importFileInput.addEventListener('change', (e) => {
                handleImportHistory(e);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // 1. Phím tắt toàn cục Ctrl+F mở hộp thoại tìm kiếm của Monaco Find Widget
            if (e.ctrlKey && e.key.toLowerCase() === 'f') {
                if (e.target.classList.contains('input') && e.target.closest('.find-widget')) {
                    return; // Cho phép gõ tìm kiếm bình thường trong Find Widget
                }
                e.preventDefault();
                if (state.monacoEditor) {
                    state.monacoEditor.focus();
                    state.monacoEditor.trigger('keyboard', 'actions.find');
                }
                return;
            }

            // Bỏ qua các input/textarea thông thường cho các phím điều hướng
            if (e.target.tagName === 'INPUT' || (e.target.tagName === 'TEXTAREA' && !e.target.classList.contains('inputarea'))) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                openCurrentEntryInEditor();
            } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                toggleStarCurrentDoc();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                navigateEntries(e.key === 'ArrowDown' ? 1 : -1);
            }
        });
    }

    // ── Open in Editor Helper ─────────────────────────────────────────────────
    async function openCurrentEntryInEditor() {
        const currentDoc = getCurrentDoc();
        const currentEntry = getCurrentEntry();
        if (!currentDoc || !currentEntry || !currentEntry.sql) {
            showToast('Không có nội dung SQL để mở');
            return;
        }

        try {
            await fetch('/api/history/open_in_editor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: currentEntry.sql,
                    title: currentDoc.displayName,
                    server: currentEntry.server,
                    database: currentEntry.database
                })
            });
            showToast(`Đã mở script "${currentDoc.displayName}" vào tab mới`);
        } catch (err) {
            showToast('Lỗi mở tab editor: ' + err.message);
        }
    }

    // ── API: Load Storage Statistics ──────────────────────────────────────────
    async function loadStorageStats() {
        try {
            await fetch('/api/history/stats');
        } catch (err) {
            console.warn('[QueryHistory] Failed to load stats:', err);
        }
    }

    // ── API: Load Documents List ──────────────────────────────────────────────
    async function loadDocuments() {
        state.isLoadingDocs = true;
        const treeContainer = document.getElementById('qhTreeScroll');
        if (treeContainer && state.documents.length === 0) {
            treeContainer.innerHTML = `
                <div class="qh-empty-state">
                    <i class="fa-solid fa-spinner fa-spin text-primary"></i>
                    <p>Đang tải danh sách tài liệu...</p>
                </div>
            `;
        }

        try {
            let url = `/api/history/documents?limit=300`;
            if (state.searchQuery) {
                url += `&search=${encodeURIComponent(state.searchQuery)}`;
            }
            if (state.filterFavoritesOnly) {
                url += `&favorites_only=true`;
            }
            if (state.filterServer) {
                url += `&server=${encodeURIComponent(state.filterServer)}`;
            }
            if (state.filterDatabase) {
                url += `&database=${encodeURIComponent(state.filterDatabase)}`;
            }
            if (state.filterFromTimestamp) {
                url += `&from_timestamp=${state.filterFromTimestamp}`;
            }
            if (state.filterToTimestamp) {
                url += `&to_timestamp=${state.filterToTimestamp}`;
            }

            const res = await fetch(url);
            const data = await res.json();

            if (data && data.success && Array.isArray(data.documents)) {
                state.documents = data.documents.map(normalizeDoc);
            } else {
                state.documents = [];
            }
        } catch (err) {
            console.error('[QueryHistory] Error loading documents:', err);
            showToast('Lỗi tải danh sách tài liệu: ' + err.message);
        } finally {
            state.isLoadingDocs = false;
        }

        renderDocuments();

        // Preserve selection or select first document
        if (state.documents.length > 0) {
            const stillExists = state.documents.some(d => d.docId === state.selectedDocId);
            if (!stillExists) {
                await selectDocument(state.documents[0].docId);
            } else {
                await selectDocument(state.selectedDocId);
            }
        } else {
            state.selectedDocId = null;
            state.selectedEntryId = null;
            renderEntries();
            renderPreview();
        }
    }

    // ── Render Documents List ─────────────────────────────────────────────────
    function renderDocuments() {
        const treeContainer = document.getElementById('qhTreeScroll');
        const docCountPill = document.getElementById('qhDocCount');
        if (!treeContainer) return;

        treeContainer.innerHTML = '';

        if (docCountPill) {
            docCountPill.textContent = `${state.documents.length} files`;
        }

        if (state.documents.length === 0) {
            treeContainer.innerHTML = `
                <div class="qh-empty-state">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <p>${state.searchQuery ? 'Không tìm thấy file nào khớp với bộ lọc' : 'Chưa có lịch sử truy vấn nào'}</p>
                </div>
            `;
            return;
        }

        // Group documents
        const groups = {};
        const starredDocs = state.documents.filter(d => d.isStarred);
        if (starredDocs.length > 0 && !state.filterFavoritesOnly) {
            groups['favorites'] = starredDocs;
        }

        state.documents.forEach(doc => {
            const g = getGroupForTimestamp(doc.lastRunAt);
            if (!groups[g]) groups[g] = [];
            groups[g].push(doc);
        });

        // Render each group
        Object.keys(GROUP_LABELS).forEach(groupKey => {
            const docsInGroup = groups[groupKey];
            if (!docsInGroup || docsInGroup.length === 0) return;

            const groupMeta = GROUP_LABELS[groupKey];
            const groupEl = document.createElement('div');
            groupEl.className = 'qh-group';
            groupEl.dataset.group = groupKey;

            groupEl.innerHTML = `
                <div class="qh-group-header">
                    <i class="fa-solid fa-chevron-down qh-chevron"></i>
                    <i class="fa-solid ${groupMeta.icon} text-warning"></i>
                    <span>${groupMeta.title}</span>
                    <span class="qh-count-pill ms-auto">${docsInGroup.length}</span>
                </div>
                <div class="qh-group-items"></div>
            `;

            // Toggle collapse
            const header = groupEl.querySelector('.qh-group-header');
            header.addEventListener('click', () => {
                groupEl.classList.toggle('collapsed');
            });

            // Append items
            const itemsContainer = groupEl.querySelector('.qh-group-items');
            docsInGroup.forEach(doc => {
                const itemEl = renderDocItem(doc);
                itemsContainer.appendChild(itemEl);
            });

            treeContainer.appendChild(groupEl);
        });
    }

    function renderDocItem(doc) {
        const itemEl = document.createElement('div');
        itemEl.className = `qh-doc-item ${doc.docId === state.selectedDocId ? 'active' : ''}`;
        itemEl.dataset.docId = doc.docId;

        const isDraft = !doc.filePath;
        const iconClass = isDraft ? 'fa-regular fa-file-code draft' : 'fa-solid fa-file-code';
        const typeTitle = isDraft ? 'File nháp chưa lưu ra đĩa (Draft)' : `Đã lưu: ${doc.filePath}`;
        const timeAgo = formatTimeAgo(doc.lastRunAt);

        const matchesContentOnly = state.searchQuery && 
            !doc.displayName.toLowerCase().includes(state.searchQuery) && 
            !(doc.filePath && doc.filePath.toLowerCase().includes(state.searchQuery)) &&
            !(doc.lastServer && doc.lastServer.toLowerCase().includes(state.searchQuery)) &&
            !(doc.lastDatabase && doc.lastDatabase.toLowerCase().includes(state.searchQuery));

        const contentMatchBadge = matchesContentOnly 
            ? `<span class="badge bg-secondary-subtle text-info border border-info-subtle px-1 py-0 me-1" style="font-size: 10px;" title="Khớp từ khóa trong nội dung file SQL"><i class="fa-solid fa-code me-1"></i>Nội dung SQL</span>` 
            : '';

        itemEl.innerHTML = `
            <i class="${iconClass} qh-doc-icon" title="${typeTitle}"></i>
            <div class="qh-doc-info" title="${doc.filePath || doc.displayName}">
                <div class="qh-doc-title-row">
                    <span class="qh-doc-name text-truncate">${contentMatchBadge}${escapeHtml(doc.displayName)}</span>
                    <button type="button" class="qh-star-btn ${doc.isStarred ? 'starred' : ''}" title="${doc.isStarred ? 'Bỏ yêu thích' : 'Gắn sao yêu thích'}">
                        <i class="fa-solid fa-star"></i>
                    </button>
                </div>
                <div class="qh-doc-sub-row">
                    <span class="qh-doc-server text-truncate"><i class="fa-solid fa-server me-1"></i>${escapeHtml(doc.lastServer || 'localhost')}</span>
                    <span class="qh-doc-time">${timeAgo}</span>
                </div>
            </div>
        `;

        // Click to select
        itemEl.addEventListener('click', async (e) => {
            if (e.target.closest('.qh-star-btn')) return;
            await selectDocument(doc.docId);
        });

        // Toggle star button
        const starBtn = itemEl.querySelector('.qh-star-btn');
        starBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleStarDoc(doc.docId);
        });

        return itemEl;
    }

    // ── Select Document ───────────────────────────────────────────────────────
    async function selectDocument(docId) {
        if (state.isDiffActive) closeDiffMode();
        state.selectedDocId = docId;

        // Update active class in list
        document.querySelectorAll('.qh-doc-item').forEach(el => {
            el.classList.toggle('active', el.dataset.docId === docId);
        });

        // Load entries for this doc
        await loadEntries(docId);
    }

    // ── API: Load Entries for Document ────────────────────────────────────────
    async function loadEntries(docId) {
        if (!docId) {
            renderEntries();
            renderPreview();
            return;
        }

        state.isLoadingEntries = true;
        const entriesContainer = document.getElementById('qhEntriesScroll');
        if (entriesContainer && (!state.entriesMap[docId] || state.entriesMap[docId].length === 0)) {
            entriesContainer.innerHTML = `
                <div class="qh-empty-state">
                    <i class="fa-solid fa-spinner fa-spin text-info"></i>
                    <p>Đang tải lịch sử thực thi...</p>
                </div>
            `;
        }

        try {
            let url = `/api/history/entries?doc_id=${encodeURIComponent(docId)}&limit=200`;
            if (state.searchQuery) {
                url += `&search=${encodeURIComponent(state.searchQuery)}`;
            }
            if (state.filterServer) {
                url += `&server=${encodeURIComponent(state.filterServer)}`;
            }
            if (state.filterDatabase) {
                url += `&database=${encodeURIComponent(state.filterDatabase)}`;
            }
            if (state.filterTag) {
                url += `&tag=${encodeURIComponent(state.filterTag)}`;
            }
            if (state.filterFromTimestamp) {
                url += `&from_timestamp=${state.filterFromTimestamp}`;
            }
            if (state.filterToTimestamp) {
                url += `&to_timestamp=${state.filterToTimestamp}`;
            }
            const res = await fetch(url);
            const data = await res.json();

            if (data && data.success && Array.isArray(data.entries)) {
                state.entriesMap[docId] = data.entries.map(normalizeEntry);
            } else {
                state.entriesMap[docId] = [];
            }
        } catch (err) {
            console.error('[QueryHistory] Error loading entries:', err);
            showToast('Lỗi tải lịch sử lần chạy: ' + err.message);
        } finally {
            state.isLoadingEntries = false;
        }

        const entries = state.entriesMap[docId] || [];
        if (entries.length > 0) {
            const exists = entries.some(e => e.entryId === state.selectedEntryId);
            state.selectedEntryId = exists ? state.selectedEntryId : entries[0].entryId;
        } else {
            state.selectedEntryId = null;
        }

        renderEntries();

        if (state.selectedEntryId) {
            await selectEntry(state.selectedEntryId);
        } else {
            renderPreview();
        }
    }

    // ── Render History Entries List ───────────────────────────────────────────
    function renderEntries() {
        const entriesContainer = document.getElementById('qhEntriesScroll');
        const entriesDocTitle = document.getElementById('qhEntriesDocTitle');
        const entryCountPill = document.getElementById('qhEntryCountPill');
        if (!entriesContainer) return;

        entriesContainer.innerHTML = '';

        const currentDoc = getCurrentDoc();
        if (entriesDocTitle) {
            entriesDocTitle.textContent = currentDoc ? currentDoc.displayName : 'Chưa chọn file';
        }

        const entries = state.entriesMap[state.selectedDocId] || [];

        // Apply status & favorite filter
        const filteredEntries = entries.filter(entry => {
            if (state.entryStatusFilter === 'ok') return entry.status === 0;
            if (state.entryStatusFilter === 'error') return entry.status === 1;
            if (state.entryStatusFilter === 'selection') return entry.isSelection;
            if (state.entryStatusFilter === 'favorite') return entry.isFavorite;
            return true;
        });

        if (entryCountPill) {
            entryCountPill.textContent = `${filteredEntries.length} lần`;
        }

        if (filteredEntries.length === 0) {
            entriesContainer.innerHTML = `
                <div class="qh-empty-state">
                    <i class="fa-solid fa-list-check"></i>
                    <p>Không có lịch sử nào cho mục đã chọn</p>
                </div>
            `;
            return;
        }

        filteredEntries.forEach(entry => {
            const entryEl = renderEntryItem(entry);
            entriesContainer.appendChild(entryEl);
        });
    }

    function renderEntryItem(entry) {
        const itemEl = document.createElement('div');
        itemEl.className = `qh-entry-item ${entry.entryId === state.selectedEntryId ? 'active' : ''}`;
        itemEl.dataset.entryId = entry.entryId;

        const isExecution = entry.entryType === 1;
        const typeIcon = isExecution ? 'fa-solid fa-play qh-entry-type-icon exec' : 'fa-regular fa-file qh-entry-type-icon snapshot';
        const typeTitle = isExecution ? 'Execution (Chạy F5)' : 'Snapshot (Lưu phiên)';

        const timeStr = formatExactTime(entry.executedAt);

        let statusBadge = '';
        if (entry.status === 0) {
            statusBadge = `<span class="qh-badge qh-badge-ok"><i class="fa-solid fa-check me-1"></i>OK</span>`;
        } else if (entry.status === 1) {
            statusBadge = `<span class="qh-badge qh-badge-err"><i class="fa-solid fa-xmark me-1"></i>Lỗi</span>`;
        } else if (entry.status === 2) {
            statusBadge = `<span class="qh-badge qh-badge-cancelled"><i class="fa-solid fa-ban me-1"></i>Hủy</span>`;
        }

        const runCountBadge = (entry.runCount > 1) ? `<span class="qh-badge qh-badge-repeat" title="Chạy lại giống nhau ${entry.runCount} lần">×${entry.runCount}</span>` : '';
        const selectionBadge = entry.isSelection ? `<span class="qh-badge qh-badge-selection">Selection</span>` : '';

        // Multi-tags badge
        const tagsList = (entry.tags && entry.tags.length > 0) ? entry.tags : (entry.tag ? [entry.tag] : []);
        const tagBadges = tagsList.map(t => `<span class="qh-badge qh-badge-tag"><i class="fa-solid fa-tag me-1"></i>${escapeHtml(t)}</span>`).join('');

        const noteIndicator = entry.note ? `<i class="fa-solid fa-note-sticky qh-entry-note-indicator" title="${escapeHtml(entry.note)}"></i>` : '';
        const durationStr = entry.durationMs !== null ? `${entry.durationMs} ms` : '—';

        // Favorite star button on entry item
        const favIconClass = entry.isFavorite ? 'fa-solid fa-star text-warning' : 'fa-regular fa-star text-muted';
        const favBtn = `<span class="qh-entry-star-btn ${entry.isFavorite ? 'is-fav' : ''}" data-entry-id="${entry.entryId}" title="${entry.isFavorite ? 'Bỏ yêu thích lần chạy này' : 'Đánh dấu yêu thích'}"><i class="${favIconClass}"></i></span>`;

        itemEl.innerHTML = `
            <div class="d-flex align-items-center">
                ${favBtn}
                <i class="${typeIcon}" title="${typeTitle}"></i>
            </div>
            <div class="qh-entry-body">
                <div class="qh-entry-top">
                    <span class="qh-entry-time">${timeStr}</span>
                    <div class="qh-entry-badges">
                        ${runCountBadge}
                        ${selectionBadge}
                        ${tagBadges}
                        ${statusBadge}
                        ${noteIndicator}
                    </div>
                </div>
                <div class="qh-entry-bottom">
                    <span class="qh-entry-target text-truncate">${escapeHtml(entry.database)} @ ${escapeHtml(entry.server)}</span>
                    <span class="qh-entry-duration">${durationStr}</span>
                </div>
            </div>
        `;

        const starBtn = itemEl.querySelector('.qh-entry-star-btn');
        if (starBtn) {
            starBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleFavoriteEntry(entry.entryId);
            });
        }

        itemEl.addEventListener('click', async () => {
            await selectEntry(entry.entryId);
        });

        // Double click to open directly
        itemEl.addEventListener('dblclick', () => {
            openCurrentEntryInEditor();
        });

        return itemEl;
    }

    // ── Select Entry & Render Preview ─────────────────────────────────────────
    async function selectEntry(entryId) {
        if (state.isDiffActive) closeDiffMode();
        state.selectedEntryId = entryId;

        document.querySelectorAll('.qh-entry-item').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.entryId) === entryId);
        });

        const entry = getCurrentEntry();
        if (entry && entry.sql === null) {
            // Lazy load uncompressed SQL
            try {
                const res = await fetch(`/api/history/entry/${entryId}`);
                const data = await res.json();
                if (data && data.success && data.entry) {
                    entry.sql = data.entry.Sql || data.entry.sql || '';
                    if (data.entry.ErrorSummary) entry.errorSummary = data.entry.ErrorSummary;
                    if (data.entry.RawSize) entry.rawSize = data.entry.RawSize;
                }
            } catch (err) {
                console.error('[QueryHistory] Failed to load SQL content:', err);
                entry.sql = `-- Không thể nạp nội dung: ${err.message}`;
            }
        }

        renderPreview();
    }

    function renderPreview() {
        const currentDoc = getCurrentDoc();
        const currentEntry = getCurrentEntry();

        const previewTitle = document.getElementById('qhPreviewTitle');
        const previewTimestamp = document.getElementById('qhPreviewTimestamp');
        const previewStatusPill = document.getElementById('qhPreviewStatusPill');
        const errorBanner = document.getElementById('qhErrorBanner');
        const errorMsg = document.getElementById('qhErrorMsg');

        const metaServer = document.getElementById('qhMetaServer');
        const metaDb = document.getElementById('qhMetaDb');
        const metaUser = document.getElementById('qhMetaUser');
        const metaDuration = document.getElementById('qhMetaDuration');
        const metaSize = document.getElementById('qhMetaSize');

        const noteInput = document.getElementById('qhNoteInput');
        const tagPill = document.getElementById('qhCurrentTagPill');
        const tagText = document.getElementById('qhCurrentTagText');

        if (!currentDoc || !currentEntry) {
            if (previewTitle) previewTitle.textContent = 'Chưa chọn bản ghi';
            if (previewTimestamp) previewTimestamp.textContent = '';
            if (previewStatusPill) previewStatusPill.style.display = 'none';
            if (errorBanner) errorBanner.style.display = 'none';
            if (noteInput) {
                noteInput.value = '';
                noteInput.disabled = true;
            }
            if (tagPill) tagPill.classList.add('d-none');
            if (state.monacoEditor) {
                state.monacoEditor.setValue('-- Không có nội dung để hiển thị');
                state.monacoEditor.layout();
            }
            if (metaServer) metaServer.textContent = '—';
            if (metaDb) metaDb.textContent = '—';
            if (metaUser) metaUser.textContent = '—';
            if (metaDuration) metaDuration.textContent = '—';
            if (metaSize) metaSize.textContent = '—';
            return;
        }

        // 1. Header info
        if (previewTitle) previewTitle.textContent = currentDoc.displayName;
        if (previewTimestamp) {
            previewTimestamp.textContent = `Executed at: ${new Date(currentEntry.executedAt).toLocaleString('vi-VN')}`;
        }

        if (noteInput) {
            noteInput.value = currentEntry.note || '';
            noteInput.disabled = false;
        }

        // Preview Header Star Toggle
        const btnToggleEntryFav = document.getElementById('btnToggleEntryFav');
        const iconEntryFav = document.getElementById('iconEntryFav');
        if (btnToggleEntryFav && iconEntryFav) {
            btnToggleEntryFav.disabled = false;
            if (currentEntry.isFavorite) {
                iconEntryFav.className = 'fa-solid fa-star text-warning';
                btnToggleEntryFav.title = 'Bỏ đánh dấu yêu thích lần chạy này';
            } else {
                iconEntryFav.className = 'fa-regular fa-star text-muted';
                btnToggleEntryFav.title = 'Đánh dấu yêu thích lần chạy này';
            }
        }

        // Dynamic Tag Pills in Note Bar
        const tagsContainer = document.getElementById('qhTagsContainer');
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            const tagsList = (currentEntry.tags && currentEntry.tags.length > 0)
                ? currentEntry.tags
                : (currentEntry.tag ? [currentEntry.tag] : []);
            tagsList.forEach(tagName => {
                const pill = document.createElement('span');
                pill.className = 'qh-tag-pill';
                pill.innerHTML = `<i class="fa-solid fa-tag me-1"></i><span>${escapeHtml(tagName)}</span><i class="fa-solid fa-xmark ms-1 qh-tag-remove" title="Gỡ tag"></i>`;
                const removeBtn = pill.querySelector('.qh-tag-remove');
                if (removeBtn) {
                    removeBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await removeTagFromCurrentEntry(tagName);
                    });
                }
                tagsContainer.appendChild(pill);
            });
        }

        if (tagPill && tagText) {
            if (currentEntry.tag) {
                tagPill.classList.remove('d-none');
                tagText.textContent = currentEntry.tag;
            } else {
                tagPill.classList.add('d-none');
            }
        }

        if (previewStatusPill) {
            previewStatusPill.style.display = 'inline-block';
            if (currentEntry.status === 0) {
                previewStatusPill.className = 'qh-badge qh-badge-ok';
                previewStatusPill.innerHTML = '<i class="fa-solid fa-circle-check me-1"></i>Thành công (OK)';
            } else if (currentEntry.status === 1) {
                previewStatusPill.className = 'qh-badge qh-badge-err';
                previewStatusPill.innerHTML = '<i class="fa-solid fa-circle-xmark me-1"></i>Có lỗi (Error)';
            } else if (currentEntry.status === 2) {
                previewStatusPill.className = 'qh-badge qh-badge-cancelled';
                previewStatusPill.innerHTML = '<i class="fa-solid fa-circle-pause me-1"></i>Đã hủy';
            } else {
                previewStatusPill.className = 'qh-badge text-secondary';
                previewStatusPill.innerHTML = '<i class="fa-regular fa-clock me-1"></i>Không xác định';
            }
        }

        // 2. Error banner
        if (errorBanner && errorMsg) {
            if (currentEntry.status === 1 && currentEntry.errorSummary) {
                errorBanner.style.display = 'flex';
                errorMsg.textContent = currentEntry.errorSummary;
            } else {
                errorBanner.style.display = 'none';
            }
        }

        // 3. Monaco SQL Content
        const sqlText = currentEntry.sql || '';
        if (state.monacoEditor) {
            state.monacoEditor.setValue(sqlText);
            const model = state.monacoEditor.getModel();
            if (model && state.editorSettings) {
                model.updateOptions({
                    tabSize: Number(state.editorSettings.tabSize) || 4,
                    insertSpaces: state.editorSettings.insertSpaces !== undefined ? Boolean(state.editorSettings.insertSpaces) : false
                });
            }
            state.monacoEditor.layout();

            // Tự động tìm kiếm, chọn và cuộn tới vị trí khớp từ khóa trong Monaco
            if (state.searchQuery && sqlText) {
                const model = state.monacoEditor.getModel();
                if (model) {
                    const matches = model.findMatches(state.searchQuery, false, false, false, null, true);
                    if (matches && matches.length > 0) {
                        const firstMatch = matches[0];
                        state.monacoEditor.setSelection(firstMatch.range);
                        state.monacoEditor.revealRangeInCenter(firstMatch.range);
                    }
                }
            }
        }

        // 4. Footer meta
        if (metaServer) metaServer.textContent = currentEntry.server;
        if (metaDb) metaDb.textContent = currentEntry.database;
        if (metaUser) metaUser.textContent = currentEntry.login || 'sa';
        if (metaDuration) metaDuration.textContent = currentEntry.durationMs !== null ? `${currentEntry.durationMs} ms` : '—';
        if (metaSize) {
            const rawBytes = currentEntry.rawSize || (currentEntry.sql ? currentEntry.sql.length : 0);
            metaSize.textContent = `${rawBytes} B`;
        }
    }

    // ── Helper Actions ────────────────────────────────────────────────────────
    async function toggleStarDoc(docId) {
        const doc = state.documents.find(d => d.docId === docId);
        if (!doc) return;

        try {
            const res = await fetch('/api/history/toggle_star', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ doc_id: docId })
            });
            const data = await res.json();
            if (data && data.success) {
                doc.isStarred = Boolean(data.is_starred);
                renderDocuments();
                showToast(doc.isStarred ? `Đã thêm "${doc.displayName}" vào Yêu thích ⭐` : `Đã bỏ gắn sao "${doc.displayName}"`);
            }
        } catch (err) {
            showToast('Lỗi toggle star: ' + err.message);
        }
    }

    async function toggleStarCurrentDoc() {
        if (!state.selectedDocId) return;
        await toggleStarDoc(state.selectedDocId);
    }

    async function navigateEntries(direction) {
        const entries = state.entriesMap[state.selectedDocId] || [];
        if (entries.length === 0) return;

        const currentIdx = entries.findIndex(e => e.entryId === state.selectedEntryId);
        let nextIdx = currentIdx + direction;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= entries.length) nextIdx = entries.length - 1;

        await selectEntry(entries[nextIdx].entryId);
    }

    function getCurrentDoc() {
        return state.documents.find(d => d.docId === state.selectedDocId) || null;
    }

    function getCurrentEntry() {
        const entries = state.entriesMap[state.selectedDocId] || [];
        return entries.find(e => e.entryId === state.selectedEntryId) || null;
    }

    function formatTimeAgo(ts) {
        if (!ts) return '';
        const timeMs = typeof ts === 'number' ? ts : new Date(ts).getTime();
        const diffMs = Date.now() - timeMs;
        const mins = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (mins < 1) return 'Vừa xong';
        if (mins < 60) return `${mins}m trước`;
        if (hours < 24) return `${hours}h trước`;
        if (days < 7) return `${days}d trước`;

        const d = new Date(timeMs);
        return `${d.getDate()}/${d.getMonth() + 1}`;
    }

    function formatExactTime(ts) {
        if (!ts) return '';
        const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    let toastTimer = null;
    function showToast(message) {
        const toast = document.getElementById('qhToast');
        const toastMsg = document.getElementById('qhToastMsg');
        if (!toast || !toastMsg) return;

        toastMsg.textContent = message;
        toast.classList.add('show');

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, 2800);
    }

    // ── Phase 5: Advanced Filters Logic ──────────────────────────────────────
    async function loadFilterOptions() {
        try {
            const res = await fetch('/api/history/filters');
            const data = await res.json();
            if (data && data.success && data.filters) {
                state.filterOptions = data.filters;
                populateFilterSelects();
            }
        } catch (err) {
            console.warn('[QueryHistory] Failed to load filter options:', err);
        }
    }

    function populateFilterSelects() {
        const selServer = document.getElementById('qhFilterServer');
        const selDb = document.getElementById('qhFilterDatabase');
        const selTag = document.getElementById('qhFilterTag');

        if (selServer) {
            const curVal = selServer.value;
            selServer.innerHTML = '<option value="">Tất cả Server</option>';
            (state.filterOptions.servers || []).forEach(srv => {
                if (!srv) return;
                const opt = document.createElement('option');
                opt.value = srv;
                opt.textContent = srv;
                if (srv === curVal) opt.selected = true;
                selServer.appendChild(opt);
            });
        }

        if (selDb) {
            const curVal = selDb.value;
            selDb.innerHTML = '<option value="">Tất cả Database</option>';
            (state.filterOptions.databases || []).forEach(db => {
                if (!db) return;
                const opt = document.createElement('option');
                opt.value = db;
                opt.textContent = db;
                if (db === curVal) opt.selected = true;
                selDb.appendChild(opt);
            });
        }

        if (selTag) {
            const curVal = selTag.value;
            selTag.innerHTML = '<option value="">Tất cả nhãn</option>';
            (state.filterOptions.tags || []).forEach(t => {
                if (!t) return;
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                if (t === curVal) opt.selected = true;
                selTag.appendChild(opt);
            });
        }
    }

    function applyFilterChange() {
        const selServer = document.getElementById('qhFilterServer');
        const selDb = document.getElementById('qhFilterDatabase');
        const selTag = document.getElementById('qhFilterTag');
        const selDate = document.getElementById('qhFilterDateRange');

        state.filterServer = selServer ? selServer.value : '';
        state.filterDatabase = selDb ? selDb.value : '';
        state.filterTag = selTag ? selTag.value : '';
        state.filterDateRange = selDate ? selDate.value : 'all';

        const now = Date.now();
        state.filterFromTimestamp = null;
        state.filterToTimestamp = null;

        if (state.filterDateRange === 'today') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            state.filterFromTimestamp = startOfToday.getTime();
        } else if (state.filterDateRange === 'yesterday') {
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const startOfYesterday = new Date(startOfToday);
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);
            state.filterFromTimestamp = startOfYesterday.getTime();
            state.filterToTimestamp = startOfToday.getTime();
        } else if (state.filterDateRange === '7days') {
            state.filterFromTimestamp = now - 7 * 86400 * 1000;
        } else if (state.filterDateRange === '30days') {
            state.filterFromTimestamp = now - 30 * 86400 * 1000;
        }

        let activeCount = 0;
        if (state.filterServer) activeCount++;
        if (state.filterDatabase) activeCount++;
        if (state.filterTag) activeCount++;
        if (state.filterDateRange !== 'all') activeCount++;

        const badge = document.getElementById('qhFilterBadge');
        const btnFilter = document.getElementById('btnAdvancedFilter');
        if (badge) {
            badge.textContent = activeCount;
            badge.classList.toggle('d-none', activeCount === 0);
        }
        if (btnFilter) {
            btnFilter.classList.toggle('active', activeCount > 0);
        }

        loadDocuments();
    }

    function resetFilters() {
        const selServer = document.getElementById('qhFilterServer');
        const selDb = document.getElementById('qhFilterDatabase');
        const selTag = document.getElementById('qhFilterTag');
        const selDate = document.getElementById('qhFilterDateRange');

        if (selServer) selServer.value = '';
        if (selDb) selDb.value = '';
        if (selTag) selTag.value = '';
        if (selDate) selDate.value = 'all';

        applyFilterChange();
        showToast('Đã đặt lại toàn bộ bộ lọc');
    }

    // ── Phase 5: Diff Mode Engine ─────────────────────────────────────────────
    function initDiffEditorIfNeeded() {
        if (state.diffEditor || typeof monaco === 'undefined' || !monaco.editor) return;
        const diffContainer = document.getElementById('qhMonacoDiffContainer');
        if (!diffContainer) return;

        const curTheme = document.documentElement.getAttribute('data-bs-theme') || 'dark';
        let mTheme = 'ide-dark';
        if (window.MonacoInit && typeof window.MonacoInit.getMonacoTheme === 'function') {
            mTheme = window.MonacoInit.getMonacoTheme(curTheme);
        } else {
            mTheme = (curTheme === 'light' || curTheme === 'win-nt' || curTheme === 'win-xp') ? 'ide-light' : 'ide-dark';
        }

        const s = state.editorSettings || {};
        const rawFont = s.fontFamily || 'Consolas';
        const cleanFont = rawFont.trim().replace(/^['"]+|['"]+$/g, '');
        const fontStack = cleanFont.includes('monospace') || cleanFont.includes('sans-serif')
            ? cleanFont
            : `"${cleanFont}", 'JetBrains Mono', 'Fira Code', 'Consolas', monospace`;
        const fontSize = Number(s.fontSize) || 14;

        state.diffEditor = monaco.editor.createDiffEditor(diffContainer, {
            readOnly: true,
            automaticLayout: true,
            renderSideBySide: !state.diffInline,
            theme: mTheme,
            fontSize: fontSize,
            fontFamily: fontStack,
            scrollBeyondLastLine: false,
            contextmenu: true,
            scrollbar: {
                vertical: 'visible',
                horizontal: 'auto',
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10
            }
        });
    }

    function showDiffMode(origSql, modSql, origTitle, modTitle) {
        initDiffEditorIfNeeded();
        if (!state.diffEditor) {
            showToast('Monaco Diff Editor chưa sẵn sàng');
            return;
        }

        const editorContainer = document.getElementById('qhMonacoEditor');
        const diffContainer = document.getElementById('qhMonacoDiffContainer');
        const diffBanner = document.getElementById('qhDiffBanner');
        const diffDesc = document.getElementById('qhDiffDescription');

        if (editorContainer) editorContainer.classList.add('d-none');
        if (diffContainer) diffContainer.classList.remove('d-none');
        if (diffBanner) diffBanner.classList.remove('d-none');
        if (diffDesc) diffDesc.textContent = `So sánh: ${origTitle} ↔ ${modTitle}`;

        if (state.diffOriginalModel) state.diffOriginalModel.dispose();
        if (state.diffModifiedModel) state.diffModifiedModel.dispose();

        state.diffOriginalModel = monaco.editor.createModel(origSql || '', 'sql');
        state.diffModifiedModel = monaco.editor.createModel(modSql || '', 'sql');

        state.diffEditor.setModel({
            original: state.diffOriginalModel,
            modified: state.diffModifiedModel
        });

        state.isDiffActive = true;
        state.lastDiffContext = { origSql, modSql, origTitle, modTitle };
        state.diffEditor.layout();
    }

    function closeDiffMode() {
        const editorContainer = document.getElementById('qhMonacoEditor');
        const diffContainer = document.getElementById('qhMonacoDiffContainer');
        const diffBanner = document.getElementById('qhDiffBanner');

        if (diffContainer) diffContainer.classList.add('d-none');
        if (editorContainer) editorContainer.classList.remove('d-none');
        if (diffBanner) diffBanner.classList.add('d-none');

        state.isDiffActive = false;
        if (state.monacoEditor) {
            state.monacoEditor.layout();
        }
    }

    async function handleDiffPrevious() {
        const currentDoc = getCurrentDoc();
        const currentEntry = getCurrentEntry();
        if (!currentDoc || !currentEntry) {
            showToast('Chưa chọn bản ghi lịch sử nào');
            return;
        }

        const entries = state.entriesMap[state.selectedDocId] || [];
        const curIdx = entries.findIndex(e => e.entryId === currentEntry.entryId);
        if (curIdx === -1 || curIdx >= entries.length - 1) {
            showToast('Không có bản ghi trước đó của file này để so sánh');
            return;
        }

        const prevEntry = entries[curIdx + 1];
        if (prevEntry.sql === null) {
            try {
                const res = await fetch(`/api/history/entry/${prevEntry.entryId}`);
                const data = await res.json();
                if (data && data.success && data.entry) {
                    prevEntry.sql = data.entry.Sql || data.entry.sql || '';
                }
            } catch (_) {
                prevEntry.sql = '';
            }
        }
        if (currentEntry.sql === null) {
            try {
                const res = await fetch(`/api/history/entry/${currentEntry.entryId}`);
                const data = await res.json();
                if (data && data.success && data.entry) {
                    currentEntry.sql = data.entry.Sql || data.entry.sql || '';
                }
            } catch (_) {
                currentEntry.sql = '';
            }
        }

        const prevTitle = `Bản trước (${formatExactTime(prevEntry.executedAt)})`;
        const curTitle = `Bản hiện tại (${formatExactTime(currentEntry.executedAt)})`;
        showDiffMode(prevEntry.sql || '', currentEntry.sql || '', prevTitle, curTitle);
    }

    async function handleDiffActiveEditor() {
        const currentEntry = getCurrentEntry();
        if (!currentEntry) {
            showToast('Chưa chọn bản ghi lịch sử nào');
            return;
        }
        if (currentEntry.sql === null) {
            try {
                const res = await fetch(`/api/history/entry/${currentEntry.entryId}`);
                const data = await res.json();
                if (data && data.success && data.entry) {
                    currentEntry.sql = data.entry.Sql || data.entry.sql || '';
                }
            } catch (_) {
                currentEntry.sql = '';
            }
        }

        let activeSql = '';
        try {
            const res = await fetch('/api/history/active_editor_content');
            const data = await res.json();
            if (data && data.success) {
                activeSql = data.content || '';
            }
        } catch (err) {
            console.warn('[QueryHistory] Failed to get active editor content:', err);
        }

        const curTitle = `Lịch sử (${formatExactTime(currentEntry.executedAt)})`;
        showDiffMode(activeSql, currentEntry.sql || '', 'Editor chính', curTitle);
    }

    async function pushDiffToMainEditor() {
        let origSql = '';
        let modSql = '';
        let origTitle = 'Bản trước';
        let modTitle = 'Bản hiện tại';

        if (state.isDiffActive && state.lastDiffContext) {
            origSql = state.lastDiffContext.origSql;
            modSql = state.lastDiffContext.modSql;
            origTitle = state.lastDiffContext.origTitle;
            modTitle = state.lastDiffContext.modTitle;
        } else {
            const currentEntry = getCurrentEntry();
            if (!currentEntry) {
                showToast('Chưa chọn bản ghi lịch sử nào');
                return;
            }
            const entries = state.entriesMap[state.selectedDocId] || [];
            const curIdx = entries.findIndex(e => e.entryId === currentEntry.entryId);
            if (curIdx >= 0 && curIdx < entries.length - 1) {
                const prevEntry = entries[curIdx + 1];
                if (prevEntry.sql === null) {
                    try {
                        const r = await fetch(`/api/history/entry/${prevEntry.entryId}`).then(x => x.json());
                        if (r && r.entry) prevEntry.sql = r.entry.Sql || '';
                    } catch (_) {}
                }
                origSql = prevEntry.sql || '';
                origTitle = `Bản trước (${formatExactTime(prevEntry.executedAt)})`;
            }
            if (currentEntry.sql === null) {
                try {
                    const r = await fetch(`/api/history/entry/${currentEntry.entryId}`).then(x => x.json());
                    if (r && r.entry) currentEntry.sql = r.entry.Sql || '';
                } catch (_) {}
            }
            modSql = currentEntry.sql || '';
            modTitle = `Lịch sử (${formatExactTime(currentEntry.executedAt)})`;
        }

        try {
            await fetch('/api/history/open_diff_in_editor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_sql: origSql,
                    modified_sql: modSql,
                    original_title: origTitle,
                    modified_title: modTitle
                })
            });
            showToast('Đã mở chế độ xem Diff trên cửa sổ IDE chính');
        } catch (err) {
            showToast('Không thể mở Diff trên IDE chính: ' + err.message);
        }
    }

    function toggleDiffInline() {
        state.diffInline = !state.diffInline;
        const btnToggleDiffInline = document.getElementById('btnToggleDiffInline');
        if (state.diffEditor) {
            state.diffEditor.updateOptions({ renderSideBySide: !state.diffInline });
        }
        if (btnToggleDiffInline) {
            btnToggleDiffInline.innerHTML = state.diffInline
                ? '<i class="fa-solid fa-table-columns me-1"></i><span>Side-by-side</span>'
                : '<i class="fa-solid fa-bars-staggered me-1"></i><span>Inline</span>';
        }
        showToast(state.diffInline ? 'Chuyển sang xem Diff cuộn dòng (Inline)' : 'Chuyển sang xem Diff song song (Side-by-side)');
    }

    // ── Phase 5 / 5.7: Note, Multi-Tag & Favorite Handlers ─────────────────
    async function toggleFavoriteEntry(entryId) {
        const docId = state.selectedDocId;
        const entries = state.entriesMap[docId] || [];
        const entry = entries.find(e => e.entryId === entryId);
        if (!entry) return;

        const nextFav = !entry.isFavorite;
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.history_set_entry_favorite === 'function') {
                const res = await window.pywebview.api.history_set_entry_favorite(entryId, nextFav);
                if (res && res.success !== false) {
                    entry.isFavorite = (res.is_favorite !== undefined) ? Boolean(res.is_favorite) : nextFav;
                }
            } else {
                const res = await fetch(`/api/history/entry/${entryId}/favorite`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_favorite: nextFav })
                });
                const data = await res.json();
                if (data && data.success) {
                    entry.isFavorite = Boolean(data.is_favorite);
                }
            }
            renderEntries();
            renderPreview();
            showToast(entry.isFavorite ? 'Đã thêm lần chạy này vào Yêu thích ⭐' : 'Đã bỏ yêu thích lần chạy');
        } catch (err) {
            console.error('[QueryHistory] Failed to toggle favorite:', err);
            showToast('Lỗi cập nhật yêu thích: ' + err.message);
        }
    }

    async function addTagToCurrentEntry(tagName) {
        const currentEntry = getCurrentEntry();
        if (!currentEntry) {
            showToast('Chưa chọn bản ghi để gắn tag');
            return;
        }
        const name = (tagName || '').trim();
        if (!name) return;

        if (currentEntry.tags && currentEntry.tags.includes(name)) {
            showToast(`Tag "${name}" đã được gắn`);
            return;
        }

        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.history_add_entry_tag === 'function') {
                await window.pywebview.api.history_add_entry_tag(currentEntry.entryId, name);
            } else {
                const res = await fetch(`/api/history/entry/${currentEntry.entryId}/tag`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tag_name: name })
                });
                const data = await res.json();
                if (!data || !data.success) {
                    throw new Error(data?.error || 'Không thể gắn tag');
                }
            }

            if (!currentEntry.tags) currentEntry.tags = [];
            currentEntry.tags.push(name);
            currentEntry.tag = currentEntry.tags.join(', ');

            renderEntries();
            renderPreview();
            await loadFilterOptions();
            showToast(`Đã gắn tag "${name}"`);
        } catch (err) {
            console.error('[QueryHistory] Failed to add tag:', err);
            showToast('Lỗi gắn tag: ' + err.message);
        }
    }

    async function removeTagFromCurrentEntry(tagName) {
        const currentEntry = getCurrentEntry();
        if (!currentEntry) return;

        const name = (tagName || '').trim();
        if (!name) return;

        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.history_remove_entry_tag === 'function') {
                await window.pywebview.api.history_remove_entry_tag(currentEntry.entryId, name);
            } else {
                const res = await fetch(`/api/history/entry/${currentEntry.entryId}/tag`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tag_name: name })
                });
                const data = await res.json();
                if (!data || !data.success) {
                    throw new Error(data?.error || 'Không thể gỡ tag');
                }
            }

            if (currentEntry.tags) {
                currentEntry.tags = currentEntry.tags.filter(t => t !== name);
                currentEntry.tag = currentEntry.tags.join(', ');
            }

            renderEntries();
            renderPreview();
            await loadFilterOptions();
            showToast(`Đã gỡ tag "${name}"`);
        } catch (err) {
            console.error('[QueryHistory] Failed to remove tag:', err);
            showToast('Lỗi gỡ tag: ' + err.message);
        }
    }

    function renderTagSuggestions() {
        const sugContainer = document.getElementById('qhTagSuggestions');
        if (!sugContainer) return;

        const presetTags = ['Release', 'Hotfix', 'Test', 'Migration', 'Production'];
        const existingTags = state.filterOptions && Array.isArray(state.filterOptions.tags) ? state.filterOptions.tags : [];
        const merged = Array.from(new Set([...presetTags, ...existingTags])).filter(Boolean);

        const currentEntry = getCurrentEntry();
        const activeTags = currentEntry ? (currentEntry.tags || []) : [];

        sugContainer.innerHTML = '';
        merged.forEach(tag => {
            const isAttached = activeTags.includes(tag);
            const item = document.createElement('div');
            item.className = 'qh-tag-suggestion-item';
            item.dataset.tag = tag;
            item.innerHTML = `<span>${escapeHtml(tag)}</span>${isAttached ? '<i class="fa-solid fa-check text-success ms-1" style="font-size:10px;"></i>' : ''}`;
            sugContainer.appendChild(item);
        });
    }

    async function saveCurrentEntryNote() {
        const currentEntry = getCurrentEntry();
        if (!currentEntry) return;

        const noteInput = document.getElementById('qhNoteInput');
        const newNote = noteInput ? noteInput.value.trim() : '';

        await saveEntryNoteAndTag(currentEntry.entryId, newNote, currentEntry.tag);
    }

    async function handleTagSelect() {
        const currentEntry = getCurrentEntry();
        const tagSelect = document.getElementById('qhTagSelect');
        if (!currentEntry || !tagSelect) return;

        const chosenTag = tagSelect.value;
        if (!chosenTag) return;

        tagSelect.value = '';
        await addTagToCurrentEntry(chosenTag);
    }

    async function handleRemoveTag() {
        const currentEntry = getCurrentEntry();
        if (!currentEntry) return;

        if (currentEntry.tags && currentEntry.tags.length > 0) {
            const lastTag = currentEntry.tags[currentEntry.tags.length - 1];
            await removeTagFromCurrentEntry(lastTag);
        } else {
            await saveEntryNoteAndTag(currentEntry.entryId, currentEntry.note, '');
        }
    }

    async function saveEntryNoteAndTag(entryId, note, tag) {
        try {
            const res = await fetch(`/api/history/entry/${entryId}/note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: note || null, tag: tag || null })
            });
            const data = await res.json();
            if (data && data.success) {
                const entry = getCurrentEntry();
                if (entry && entry.entryId === entryId) {
                    entry.note = note || '';
                    entry.tag = tag || '';
                }
                renderEntries();
                renderPreview();
                await loadFilterOptions();
                showToast('Đã cập nhật ghi chú & nhãn');
            } else {
                showToast('Không thể lưu ghi chú / nhãn');
            }
        } catch (err) {
            showToast('Lỗi lưu ghi chú: ' + err.message);
        }
    }

    // ── Phase 5: Export & Import History Handlers ─────────────────────────────
    async function handleExportHistory() {
        try {
            showToast('Đang trích xuất dữ liệu lịch sử...');
            const res = await fetch('/api/history/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (!data || !data.success) {
                showToast('Không thể xuất lịch sử: ' + (data?.error || 'Lỗi không xác định'));
                return;
            }

            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const a = document.createElement('a');
            a.href = url;
            a.download = `query_history_export_${nowStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast(`Đã xuất thành công ${data.documents?.length || 0} file và ${data.entries?.length || 0} bản ghi`);
        } catch (err) {
            showToast('Lỗi xuất lịch sử: ' + err.message);
        }
    }

    async function handleImportHistory(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                if (!parsed || (!parsed.documents && !parsed.entries)) {
                    showToast('File JSON không đúng cấu trúc lịch sử truy vấn luoBTool IDE');
                    return;
                }

                showToast('Đang nhập dữ liệu lịch sử...');
                const res = await fetch('/api/history/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(parsed)
                });
                const data = await res.json();
                if (data && data.success) {
                    showToast(`Nhập thành công: ${data.imported_documents || 0} documents, ${data.imported_entries || 0} entries`);
                    await loadStorageStats();
                    await loadFilterOptions();
                    await loadDocuments();
                } else {
                    showToast('Lỗi nhập dữ liệu: ' + (data?.error || 'Thao tác thất bại'));
                }
            } catch (jsonErr) {
                showToast('Lỗi đọc file JSON: ' + jsonErr.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

})();

