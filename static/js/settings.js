// ── VS Code Authentic Settings Manager ──────────────────────────────────────
// Supports Visual Form & Raw JSON editing, Save button, Theme inheritance,
// and transmission of CSS/JS variables for Editor, Grid Result, Messages, etc.

(function (global) {
    'use strict';

    let _systemFonts = null;
    let _systemFontsPromise = null;

    async function fetchSystemFonts() {
        if (_systemFonts) return _systemFonts;
        if (global._cachedSystemFonts) {
            _systemFonts = global._cachedSystemFonts;
            return _systemFonts;
        }
        if (_systemFontsPromise) return _systemFontsPromise;
        _systemFontsPromise = (async () => {
            try {
                if (global.AppStorage && typeof global.AppStorage.getSystemFonts === 'function') {
                    const data = await global.AppStorage.getSystemFonts();
                    if (data && data.all && data.all.length > 0) {
                        _systemFonts = data;
                        global._cachedSystemFonts = data;
                        return _systemFonts;
                    }
                }
                if (window.pywebview?.api?.get_system_fonts) {
                    const res = await window.pywebview.api.get_system_fonts();
                    if (res && res.success && res.data) {
                        _systemFonts = res.data;
                        global._cachedSystemFonts = res.data;
                        return _systemFonts;
                    }
                }
                const resp = await fetch('/api/system/fonts');
                if (resp && resp.ok) {
                    const json = await resp.json();
                    if (json.success && json.data) {
                        _systemFonts = json.data;
                        global._cachedSystemFonts = json.data;
                        return _systemFonts;
                    }
                }
            } catch (e) {
                console.warn('[Settings] Failed to fetch system fonts:', e);
            }
            return null;
        })();
        return _systemFontsPromise;
    }

    // Prefetch system fonts immediately on load
    fetchSystemFonts();

    const FONT_OPTIONS_CODE = [
        { value: 'Consolas', label: 'Consolas (Mặc định)' },
        { value: 'JetBrains Mono', label: 'JetBrains Mono' },
        { value: 'Cascadia Code', label: 'Cascadia Code' },
        { value: 'Fira Code', label: 'Fira Code' },
        { value: 'Courier New', label: 'Courier New' },
        { value: 'monospace', label: 'Monospace' }
    ];

    const FONT_OPTIONS_TEXT = [
        { value: 'Segoe UI', label: 'Segoe UI (Mặc định)' },
        { value: 'Arial', label: 'Arial' },
        { value: 'Tahoma', label: 'Tahoma' },
        { value: 'Consolas', label: 'Consolas' },
        { value: 'JetBrains Mono', label: 'JetBrains Mono' },
        { value: 'sans-serif', label: 'Sans-serif' }
    ];

    const FONT_OPTIONS_UI = [
        { value: 'Segoe UI', label: 'Segoe UI (Mặc định Windows)' },
        { value: 'Inter', label: 'Inter' },
        { value: 'Arial', label: 'Arial' },
        { value: 'Roboto', label: 'Roboto' },
        { value: 'Tahoma', label: 'Tahoma' },
        { value: 'Calibri', label: 'Calibri' },
        { value: 'System UI', label: 'System UI (Native OS Font)' }
    ];

    function getThemeOptions() {
        const reg = window.ThemeRegistry || (window.parent && window.parent.ThemeRegistry);
        if (reg && typeof reg.getAllThemes === 'function') {
            return reg.getAllThemes().map(t => ({
                value: t.id,
                label: t.name
            }));
        }
        return [
            { value: 'dark', label: 'Dark Mode (Giao diện Tối)' },
            { value: 'light', label: 'Light Mode (Giao diện Sáng)' },
            { value: 'win-nt', label: 'Windows NT (Classic)' },
            { value: 'win-xp', label: 'Windows XP (Luna)' },
            { value: 'monokai', label: 'Monokai' },
            { value: 'nord', label: 'Nord' }
        ];
    }

    const CATEGORIES = [
        {
            key: 'editor',
            name: 'Trình soạn thảo',
            subtitle: 'Text Editor',
            icon: 'fa-solid fa-pen-to-square',
            fields: [
                {
                    key: 'fontFamily',
                    label: 'Phông chữ soạn thảo (Editor Font Family)',
                    desc: 'Biến cấu hình: editor.fontFamily. Phông chữ hiển thị trong vùng soạn thảo câu lệnh SQL.',
                    type: 'select',
                    options: FONT_OPTIONS_CODE
                },
                {
                    key: 'fontSize',
                    label: 'Cỡ chữ soạn thảo (Editor Font Size)',
                    desc: 'Biến cấu hình: editor.fontSize. Kích thước chữ trong trình soạn thảo code (pixel).',
                    type: 'number',
                    min: 10,
                    max: 36,
                    step: 1
                },
                {
                    key: 'lineHeight',
                    label: 'Chiều cao dòng (Editor Line Height)',
                    desc: 'Biến cấu hình: editor.lineHeight. Chiều cao dòng trong trình soạn thảo code (pixel hoặc tỷ lệ: ví dụ 24 hoặc 1.5). Đặt bằng 0 để dùng mặc định (tự động theo cỡ chữ).',
                    type: 'number',
                    min: 0,
                    max: 80,
                    step: 0.1
                },
                {
                    key: 'letterSpacing',
                    label: 'Khoảng cách ký tự (Editor Letter Spacing)',
                    desc: 'Biến cấu hình: editor.letterSpacing. Khoảng cách giữa các ký tự trong trình soạn thảo code (pixel). Đặt bằng 0 để dùng mặc định.',
                    type: 'number',
                    min: -2,
                    max: 10,
                    step: 0.5
                },
                {
                    key: 'tabSize',
                    label: 'Độ dài Tab (Tab Size)',
                    desc: 'Biến cấu hình: editor.tabSize. Số lượng khoảng trắng tương ứng khi nhấn phím Tab.',
                    type: 'number',
                    min: 2,
                    max: 8,
                    step: 2
                },
                {
                    key: 'insertSpaces',
                    label: 'Chèn khoảng trắng thay vì Tab (Insert Spaces)',
                    desc: 'Biến cấu hình: editor.insertSpaces. Tự động chèn các khoảng trắng khi nhấn Tab.',
                    type: 'switch'
                },
                {
                    key: 'wordWrap',
                    label: 'Tự động ngắt dòng (Word Wrap)',
                    desc: 'Biến cấu hình: editor.wordWrap. Tự động xuống dòng khi nội dung vượt quá chiều ngang màn hình.',
                    type: 'switch'
                },
                {
                    key: 'minimap',
                    label: 'Bản đồ thu nhỏ (Minimap)',
                    desc: 'Biến cấu hình: editor.minimap. Hiển thị thanh cuộn xem trước dạng bản đồ thu nhỏ bên phải.',
                    type: 'switch'
                },
                {
                    key: 'keywordCase',
                    label: 'Định dạng từ khóa SQL (Keyword Case)',
                    desc: 'Biến cấu hình: editor.keywordCase. Quy tắc viết hoa hoặc viết thường các từ khóa cú pháp SQL.',
                    type: 'select',
                    options: [
                        { value: 'upper', label: 'VIẾT HOA (UPPERCASE)' },
                        { value: 'lower', label: 'viết thường (lowercase)' },
                        { value: 'preserve', label: 'Giữ nguyên (Preserve)' }
                    ]
                }
            ]
        },
        {
            key: 'grid',
            name: 'Bảng kết quả (Grid)',
            subtitle: 'Result Grid',
            icon: 'fa-solid fa-table-cells',
            fields: [
                {
                    key: 'fontFamily',
                    label: 'Phông chữ bảng kết quả (Grid Font Family)',
                    desc: 'Biến cấu hình: grid.fontFamily. Phông chữ hiển thị các hàng và cột trong bảng dữ liệu kết quả truy vấn.',
                    type: 'select',
                    options: FONT_OPTIONS_TEXT
                },
                {
                    key: 'fontSize',
                    label: 'Cỡ chữ bảng kết quả (Grid Font Size)',
                    desc: 'Biến cấu hình: grid.fontSize. Kích thước chữ trong các ô dữ liệu của bảng kết quả (pixel).',
                    type: 'number',
                    min: 10,
                    max: 24,
                    step: 1
                }
            ]
        },
        {
            key: 'messages',
            name: 'Thông báo SQL (Messages)',
            subtitle: 'SQL Messages',
            icon: 'fa-solid fa-comment-dots',
            fields: [
                {
                    key: 'fontFamily',
                    label: 'Phông chữ tab thông báo (Messages Font Family)',
                    desc: 'Biến cấu hình: messages.fontFamily. Phông chữ hiển thị văn bản kết quả, lỗi hoặc thông báo thực thi SQL trong tab Messages.',
                    type: 'select',
                    options: FONT_OPTIONS_CODE
                },
                {
                    key: 'fontSize',
                    label: 'Cỡ chữ tab thông báo (Messages Font Size)',
                    desc: 'Biến cấu hình: messages.fontSize. Kích thước chữ hiển thị trong tab thông báo Messages (pixel).',
                    type: 'number',
                    min: 10,
                    max: 24,
                    step: 1
                }
            ]
        },
        {
            key: 'appearance',
            name: 'Giao diện',
            subtitle: 'Appearance / Theme',
            icon: 'fa-solid fa-palette',
            fields: [
                {
                    key: 'theme',
                    label: 'Chế độ giao diện (Color Theme)',
                    desc: 'Biến cấu hình: theme. Chuyển đổi giao diện màu sắc của IDE. Đọc từ file theme-variables.css.',
                    type: 'select',
                    options: getThemeOptions()
                },
                {
                    key: 'importVsixTheme',
                    label: 'Import Theme từ file .vsix (VS Code Extension)',
                    desc: 'Mở hộp thoại chọn file .vsix để tự động phát hiện theme, kiểm tra tính duy nhất của theme key và lưu cấu hình vào style.css.',
                    type: 'action-button',
                    buttonText: 'Chọn file .vsix...',
                    icon: 'fa-solid fa-file-import'
                },
                {
                    key: 'iconSize',
                    label: 'Kích thước biểu tượng (Icon Size)',
                    desc: 'Biến cấu hình: appearance.iconSize. Kích thước hiển thị của các biểu tượng trên Object Explorer (pixel).',
                    type: 'number',
                    min: 12,
                    max: 24,
                    step: 2
                },
                {
                    key: 'uiFontFamily',
                    label: 'Phông chữ giao diện IDE (UI Font Family)',
                    desc: 'Biến cấu hình: appearance.uiFontFamily. Phông chữ hiển thị cho toàn bộ menu, thanh công cụ, sidebar và dialog (không ảnh hưởng Editor).',
                    type: 'select',
                    options: FONT_OPTIONS_UI
                },
                {
                    key: 'uiFontSize',
                    label: 'Cỡ chữ giao diện IDE (UI Font Size)',
                    desc: 'Biến cấu hình: appearance.uiFontSize. Cỡ chữ giao diện người dùng (từ 10px đến 24px, mặc định 13px).',
                    type: 'number',
                    min: 10,
                    max: 24,
                    step: 1
                }
            ]
        },
        {
            key: 'sql',
            name: 'Truy vấn SQL',
            subtitle: 'SQL Query',
            icon: 'fa-solid fa-database',
            fields: [
                {
                    key: 'maxRows',
                    label: 'Giới hạn số dòng kết quả (Max Rows)',
                    desc: 'Biến cấu hình: sql.maxRows. Số lượng dòng tối đa được nạp lên bảng hiển thị kết quả truy vấn (0 = không giới hạn).',
                    type: 'number',
                    min: 0,
                    max: 50000,
                    step: 500
                },
                {
                    key: 'timeoutSeconds',
                    label: 'Thời gian chờ truy vấn (Timeout Seconds)',
                    desc: 'Biến cấu hình: sql.timeoutSeconds. Thời gian tối đa (giây) cho phép câu truy vấn chạy trước khi ngắt.',
                    type: 'number',
                    min: 5,
                    max: 300,
                    step: 5
                }
            ]
        },
        {
            key: 'addons',
            name: 'Tiện ích mở rộng',
            subtitle: 'Extensions',
            icon: 'fa-solid fa-puzzle-piece',
            fields: [
                {
                    subpath: 'bravo_tool.enabled',
                    label: 'Kích hoạt BRAVO Tool Extension',
                    desc: 'Biến cấu hình: addons.bravo_tool.enabled. Hiển thị nút công cụ BRAVO Tool trên thanh taskbar để mở Layout Editor & Forms.',
                    type: 'switch'
                }
            ]
        }
    ];

    const DEFAULT_SETTINGS = {
        theme: 'dark',
        editor: {
            fontFamily: 'Consolas',
            fontSize: 14,
            lineHeight: 0,
            letterSpacing: 0,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: false,
            minimap: true,
            keywordCase: 'upper'
        },
        grid: {
            fontFamily: 'Segoe UI',
            fontSize: 13
        },
        messages: {
            fontFamily: 'Consolas',
            fontSize: 13
        },
        appearance: {
            theme: 'dark',
            iconSize: 16,
            uiFontFamily: 'Segoe UI',
            uiFontSize: 13
        },
        sql: {
            maxRows: 1000,
            timeoutSeconds: 30
        },
        addons: {
            bravo_tool: {
                enabled: true
            }
        }
    };

    let _settings = null;       // Currently saved settings in file
    let _draftSettings = null;  // Temporary draft modified by user before clicking Save
    let _isDirty = false;       // Has user changed anything?
    let _activeCat = 'editor';
    let _activeTab = 'visual';   // 'visual' or 'json'
    let _searchQuery = '';
    let _bsModal = null;

    // ── Popup Dialog Helpers (No default browser alert/confirm) ───────────────
    function showPopupAlert(title, message, iconType = 'info') {
        const backdrop = document.getElementById('settingsPopupBackdrop');
        if (!backdrop) {
            alert(message);
            return;
        }

        const titleEl = document.getElementById('settingsPopupTitle');
        const msgEl = document.getElementById('settingsPopupMessage');
        const footerEl = document.getElementById('settingsPopupFooter');
        const closeBtn = document.getElementById('settingsPopupCloseBtn');

        let iconHtml = '<i class="fa-solid fa-circle-info text-info me-2"></i>';
        if (iconType === 'success') iconHtml = '<i class="fa-solid fa-circle-check text-success me-2"></i>';
        if (iconType === 'warning') iconHtml = '<i class="fa-solid fa-triangle-exclamation text-warning me-2"></i>';
        if (iconType === 'error') iconHtml = '<i class="fa-solid fa-circle-xmark text-danger me-2"></i>';

        if (titleEl) titleEl.innerHTML = `${iconHtml}<span>${title}</span>`;
        if (msgEl) msgEl.textContent = message;

        if (footerEl) {
            footerEl.innerHTML = `
                <button type="button" class="btn-popup btn-popup-primary" id="popupAlertOkBtn">Đồng ý</button>
            `;
            const okBtn = document.getElementById('popupAlertOkBtn');
            if (okBtn) {
                okBtn.onclick = () => backdrop.classList.add('d-none');
                okBtn.focus();
            }
        }

        if (closeBtn) {
            closeBtn.onclick = () => backdrop.classList.add('d-none');
        }

        backdrop.classList.remove('d-none');
    }

    function showPopupConfirm(title, message, onConfirm, onDiscard) {
        const backdrop = document.getElementById('settingsPopupBackdrop');
        if (!backdrop) {
            if (confirm(message)) onConfirm();
            else if (onDiscard) onDiscard();
            return;
        }

        const titleEl = document.getElementById('settingsPopupTitle');
        const msgEl = document.getElementById('settingsPopupMessage');
        const footerEl = document.getElementById('settingsPopupFooter');
        const closeBtn = document.getElementById('settingsPopupCloseBtn');

        if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-circle-question text-warning me-2"></i><span>${title}</span>`;
        if (msgEl) msgEl.textContent = message;

        if (footerEl) {
            footerEl.innerHTML = `
                <button type="button" class="btn-popup btn-popup-secondary" id="popupConfirmCancelBtn">Hủy bỏ</button>
                <button type="button" class="btn-popup btn-popup-primary" id="popupConfirmOkBtn">Xác nhận</button>
            `;
            const okBtn = document.getElementById('popupConfirmOkBtn');
            const cancelBtn = document.getElementById('popupConfirmCancelBtn');

            if (okBtn) {
                okBtn.onclick = () => {
                    backdrop.classList.add('d-none');
                    if (typeof onConfirm === 'function') onConfirm();
                };
            }
            if (cancelBtn) {
                cancelBtn.onclick = () => {
                    backdrop.classList.add('d-none');
                    if (typeof onDiscard === 'function') onDiscard();
                };
            }
        }

        if (closeBtn) {
            closeBtn.onclick = () => backdrop.classList.add('d-none');
        }

        backdrop.classList.remove('d-none');
    }

    // ── Get & Set Values in Draft Settings ────────────────────────────────────
    function getSettingValue(settings, catKey, field) {
        if (!settings) return undefined;
        if (catKey === 'appearance' && field.key === 'theme') {
            return settings.appearance?.theme || settings.theme || 'dark';
        }
        if (field.subpath) {
            const parts = [catKey, ...field.subpath.split('.')];
            let curr = settings;
            for (const p of parts) {
                if (curr == null) return undefined;
                curr = curr[p];
            }
            return curr;
        }
        return settings[catKey] ? settings[catKey][field.key] : undefined;
    }

    function setDraftValue(catKey, field, value) {
        if (!_draftSettings) _draftSettings = {};
        _isDirty = true;

        if (catKey === 'appearance') {
            if (!_draftSettings.appearance) _draftSettings.appearance = {};
            if (field.key === 'theme') {
                _draftSettings.appearance.theme = value;
                _draftSettings.theme = value;
                if (window.ThemeManager && typeof window.ThemeManager.applyTheme === 'function') {
                    window.ThemeManager.applyTheme(value, false);
                }
                return;
            }
            if (field.key === 'uiFontFamily' || field.key === 'uiFontSize') {
                _draftSettings.appearance[field.key] = value;
                const fam = _draftSettings.appearance.uiFontFamily || 'Segoe UI';
                const sz = parseInt(_draftSettings.appearance.uiFontSize, 10) || 13;
                if (window.TypographyManager && typeof window.TypographyManager.apply === 'function') {
                    window.TypographyManager.apply({ uiFontFamily: fam, uiFontSize: sz }, false);
                }
                return;
            }
        }

        if (field.subpath) {
            const parts = [catKey, ...field.subpath.split('.')];
            let curr = _draftSettings;
            for (let i = 0; i < parts.length - 1; i++) {
                const p = parts[i];
                if (!curr[p] || typeof curr[p] !== 'object') curr[p] = {};
                curr = curr[p];
            }
            curr[parts[parts.length - 1]] = value;
        } else {
            if (!_draftSettings[catKey] || typeof _draftSettings[catKey] !== 'object') _draftSettings[catKey] = {};
            _draftSettings[catKey][field.key] = value;
        }
    }

    // ── Apply Settings (Truyền toàn bộ biến vào DOM và Runtime) ───────────────
    function applyAllSettings(settings) {
        if (!settings) return;

        // Lưu bản sao toàn cục để các module khác chủ động truy cập
        window.IDE_SETTINGS = JSON.parse(JSON.stringify(settings));

        // 1. Theme
        const theme = settings.appearance?.theme || settings.theme || 'dark';
        if (window.ThemeManager && typeof window.ThemeManager.applyTheme === 'function') {
            window.ThemeManager.applyTheme(theme, false);
        } else {
            document.documentElement.setAttribute('data-bs-theme', theme);
        }

        // 1.5. UI Typography (Skill: Global IDE UI Font & Font Size)
        const uiFont = settings.appearance?.uiFontFamily || settings.appearance?.fontFamily || 'Segoe UI';
        const uiFontSize = parseInt(settings.appearance?.uiFontSize || settings.appearance?.fontSize, 10) || 13;
        if (window.TypographyManager && typeof window.TypographyManager.apply === 'function') {
            window.TypographyManager.apply({ uiFontFamily: uiFont, uiFontSize: uiFontSize }, false);
        }

        // 2. Editor font & size (Truyền biến CSS và cập nhật Monaco/CodeMirror)
        const rawEditorFont = settings.editor?.fontFamily || 'Consolas';
        const cleanEditorFont = rawEditorFont.trim().replace(/^['"]+|['"]+$/g, '');
        const editorFontStack = cleanEditorFont.includes('monospace') || cleanEditorFont.includes('sans-serif')
            ? cleanEditorFont
            : `"${cleanEditorFont}", Consolas, monospace`;
        const editorSize = Number(settings.editor?.fontSize) || 14;
        const editorLineHeight = Number(settings.editor?.lineHeight) || 0;
        const editorLetterSpacing = Number(settings.editor?.letterSpacing) || 0;

        document.documentElement.style.setProperty('--ide-editor-font-family', editorFontStack);
        document.documentElement.style.setProperty('--ide-editor-font-size', editorSize + 'px');
        document.documentElement.style.setProperty('--ide-editor-line-height', editorLineHeight > 0 ? (editorLineHeight <= 4 ? String(editorLineHeight) : (editorLineHeight + 'px')) : 'normal');
        document.documentElement.style.setProperty('--ide-editor-letter-spacing', editorLetterSpacing + 'px');

        const updateEditorInstance = (edWrapper) => {
            if (!edWrapper) return;
            const wrap = edWrapper.getWrapperElement ? edWrapper.getWrapperElement() : null;
            if (wrap) {
                wrap.style.fontFamily = editorFontStack;
                wrap.style.fontSize = editorSize + 'px';
                // Do NOT set wrap.style.lineHeight or wrap.style.letterSpacing directly on container
                // to avoid interfering with Monaco Editor internal font metrics and cursor alignment.
                if (typeof edWrapper.refresh === 'function') edWrapper.refresh();
            }
            if (typeof edWrapper.setOption === 'function') {
                if (settings.editor?.wordWrap !== undefined) edWrapper.setOption('lineWrapping', Boolean(settings.editor.wordWrap));
                if (settings.editor?.tabSize !== undefined) edWrapper.setOption('tabSize', Number(settings.editor.tabSize) || 4);
                if (settings.editor?.insertSpaces !== undefined) edWrapper.setOption('indentWithTabs', !settings.editor.insertSpaces);
                edWrapper.setOption('fontFamily', editorFontStack);
                edWrapper.setOption('fontSize', editorSize);
                edWrapper.setOption('lineHeight', editorLineHeight);
                edWrapper.setOption('letterSpacing', editorLetterSpacing);
            }
            if (typeof edWrapper.updateOptions === 'function') {
                const calculatedLH = typeof window.computeEditorLineHeight === 'function'
                    ? window.computeEditorLineHeight(editorLineHeight, editorSize)
                    : (editorLineHeight > 0
                        ? (editorLineHeight <= 4 ? Math.max(editorSize, Math.round(editorSize * editorLineHeight)) : Math.max(editorSize, Math.round(editorLineHeight)))
                        : Math.round(editorSize * (19 / 13)));
                edWrapper.updateOptions({
                    fontFamily: editorFontStack,
                    fontSize: editorSize,
                    lineHeight: calculatedLH,
                    letterSpacing: editorLetterSpacing,
                    wordWrap: settings.editor?.wordWrap ? 'on' : 'off',
                    minimap: { enabled: Boolean(settings.editor?.minimap) }
                });
            }
        };

        if (window.AppEditor) updateEditorInstance(window.AppEditor);
        if (window.AppEditor2) updateEditorInstance(window.AppEditor2);

        if (typeof window.remeasureMonacoFonts === 'function') {
            window.remeasureMonacoFonts();
        } else if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.remeasureFonts === 'function') {
            try { monaco.editor.remeasureFonts(); } catch (_) {}
        }

        // 3. Grid Result font & size (Truyền biến CSS cho bảng kết quả)
        const gridFont = settings.grid?.fontFamily || 'Segoe UI, Arial, sans-serif';
        const gridFontSize = settings.grid?.fontSize || 13;
        document.documentElement.style.setProperty('--ide-grid-font-family', gridFont);
        document.documentElement.style.setProperty('--ide-grid-font-size', gridFontSize + 'px');

        // 4. Message SQL font & size (Truyền biến CSS cho tab thông báo)
        const msgFont = settings.messages?.fontFamily || 'Consolas, Courier New, monospace';
        const msgFontSize = settings.messages?.fontSize || 13;
        document.documentElement.style.setProperty('--ide-message-font-family', msgFont);
        document.documentElement.style.setProperty('--ide-message-font-size', msgFontSize + 'px');

        // 5. BRAVO Tool Addon
        const bravoEnabled = settings.addons?.bravo_tool?.enabled;
        const wrapBravo = document.getElementById('ide-bravo-launcher-wrap');
        if (wrapBravo && bravoEnabled !== undefined) {
            wrapBravo.style.display = bravoEnabled ? 'block' : 'none';
        }

        // 6. SQL Query config
        if (settings.sql) {
            window._sqlConfig = window._sqlConfig || {};
            if (settings.sql.maxRows !== undefined) window._sqlConfig.maxRows = Number(settings.sql.maxRows);
            if (settings.sql.timeoutSeconds !== undefined) window._sqlConfig.timeoutSeconds = Number(settings.sql.timeoutSeconds);
        }

        // 7. Dispatch Event thông báo cập nhật cho toàn hệ thống
        document.dispatchEvent(new CustomEvent('ide-settings-updated', { detail: { settings } }));
    }

    // Expose global callback for IPC broadcast
    window.onSettingsChanged = function (newSettings) {
        if (!newSettings) return;
        _settings = newSettings;
        applyAllSettings(newSettings);
        if (_draftSettings && !_isDirty) {
            _draftSettings = JSON.parse(JSON.stringify(newSettings));
            renderSidebar();
            renderContent();
            updateRawJsonEditor();
        }
    };

    // Cross-window sync via storage event for all settings
    window.addEventListener('storage', (e) => {
        if (e.key === 'ide-settings' && e.newValue) {
            try {
                const parsed = JSON.parse(e.newValue);
                if (window.onSettingsChanged) {
                    window.onSettingsChanged(parsed);
                }
            } catch (_) {}
        }
    });

    // ── Save Current Settings ─────────────────────────────────────────────────
    async function saveCurrentSettings() {
        // Nếu đang ở tab JSON: kiểm tra cú pháp JSON từ textarea trước
        if (_activeTab === 'json') {
            const textarea = document.getElementById('settingsRawJsonTextarea');
            if (textarea) {
                try {
                    const parsed = JSON.parse(textarea.value);
                    _draftSettings = parsed;
                } catch (e) {
                    showPopupAlert('Lỗi cú pháp JSON', 'Nội dung JSON không hợp lệ: ' + e.message, 'error');
                    return;
                }
            }
        }

        if (!_draftSettings) return;
        try {
            const theme = _draftSettings.appearance?.theme || _draftSettings.theme || 'dark';
            _draftSettings.theme = theme;
            if (!_draftSettings.appearance) _draftSettings.appearance = {};
            _draftSettings.appearance.theme = theme;

            // Ensure typography profile is properly validated and structured
            const uiFam = _draftSettings.appearance.uiFontFamily || 'Segoe UI';
            let uiSz = parseInt(_draftSettings.appearance.uiFontSize, 10);
            if (isNaN(uiSz) || uiSz < 10 || uiSz > 24) uiSz = 13;
            _draftSettings.appearance.uiFontFamily = uiFam;
            _draftSettings.appearance.uiFontSize = uiSz;

            if (window.AppStorage && typeof window.AppStorage.saveSettings === 'function') {
                const ok = await window.AppStorage.saveSettings(_draftSettings);
                if (ok) {
                    _settings = JSON.parse(JSON.stringify(_draftSettings));
                    _isDirty = false;
                    applyAllSettings(_settings);
                    if (window.ThemeManager && typeof window.ThemeManager.applyTheme === 'function') {
                        window.ThemeManager.applyTheme(theme, false);
                    }
                    if (window.TypographyManager && typeof window.TypographyManager.apply === 'function') {
                        window.TypographyManager.apply({ uiFontFamily: uiFam, uiFontSize: uiSz }, false);
                    }
                    try {
                        localStorage.setItem('ide-settings', JSON.stringify(_settings));
                        localStorage.setItem('ide-ui-font-family', uiFam);
                        localStorage.setItem('ide-ui-font-size', String(uiSz));
                    } catch (_) {}
                    updateRawJsonEditor();
                    showPopupAlert('Thành công', '✓ Đã lưu các thay đổi cài đặt và profile giao diện thành công!', 'success');
                    return;
                }
            }
            showPopupAlert('Lỗi', 'Không thể lưu cài đặt vào hệ thống.', 'error');
        } catch (e) {
            console.error('[SettingsManager] saveSettings failed:', e);
            showPopupAlert('Lỗi', 'Có lỗi xảy ra khi lưu cài đặt: ' + e.message, 'error');
        }
    }

    // ── Update Raw JSON Textarea ──────────────────────────────────────────────
    function updateRawJsonEditor() {
        const textarea = document.getElementById('settingsRawJsonTextarea');
        if (textarea) {
            const targetObj = _draftSettings || _settings || DEFAULT_SETTINGS;
            textarea.value = JSON.stringify(targetObj, null, 4);
        }
    }

    // ── Import VSIX Theme Handler ─────────────────────────────────────────────
    async function handleImportVsixTheme(btn) {
        if (!window.pywebview || !window.pywebview.api || typeof window.pywebview.api.import_vsix_theme !== 'function') {
            showPopupAlert('Thông báo', 'Tính năng import file .vsix yêu cầu môi trường desktop pywebview.', 'warning');
            return;
        }

        const originalHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i>Đang xử lý...';
        }

        try {
            const res = await window.pywebview.api.import_vsix_theme();
            if (!res) return;

            if (res.cancelled) {
                return;
            }

            if (res.duplicate) {
                // Yêu cầu: kiểm tra được key của theme xem có là duy nhất không, nếu trùng theme thì phải báo trùng
                showPopupAlert(
                    'Báo trùng Theme',
                    res.message || `Theme '${res.theme_name}' (mã: '${res.theme_id}') đã tồn tại trong hệ thống. Vui lòng kiểm tra lại.`,
                    'warning'
                );
                return;
            }

            if (!res.success) {
                showPopupAlert('Lỗi Import Theme', res.error || 'Có lỗi xảy ra khi đọc file .vsix.', 'error');
                return;
            }

            // Thành công:
            const themesList = (res.imported_themes && Array.isArray(res.imported_themes) && res.imported_themes.length > 0)
                ? res.imported_themes
                : [res];

            // 1. Nhúng động style vào DOM cho từng theme
            themesList.forEach(t => {
                if (t.css) {
                    let styleEl = document.getElementById(`dynamic-theme-${t.theme_id}`);
                    if (!styleEl) {
                        styleEl = document.createElement('style');
                        styleEl.id = `dynamic-theme-${t.theme_id}`;
                        document.head.appendChild(styleEl);
                    }
                    styleEl.textContent = t.css;
                }
            });

            // 2. Đăng ký tất cả các themes vào ThemeRegistry
            const targetRegistry = window.ThemeRegistry || (window.parent && window.parent.ThemeRegistry);
            if (targetRegistry && typeof targetRegistry.registerTheme === 'function') {
                themesList.forEach(t => {
                    targetRegistry.registerTheme({
                        id: t.theme_id,
                        name: t.theme_name,
                        isDark: Boolean(t.is_dark),
                        cmTheme: t.cm_theme || (t.is_dark ? 'darcula' : 'default'),
                        titlebarBg: t.titlebar_bg || (t.is_dark ? '#202228' : '#ffffff'),
                        titlebarText: t.titlebar_text || (t.is_dark ? '#ffffff' : '#000000'),
                        border: t.border || (t.is_dark ? '#3c3f41' : '#cccccc')
                    });
                });
            }

            // 3. Cập nhật options trong cấu trúc CATEGORIES cho trường Appearance Theme
            const appCategory = CATEGORIES.find(c => c.key === 'appearance');
            if (appCategory && appCategory.fields) {
                const themeField = appCategory.fields.find(f => f.key === 'theme');
                if (themeField) {
                    themeField.options = getThemeOptions();
                }
            }

            // 4. Tự động chọn theme đầu tiên vừa import trong draft settings
            const primaryTheme = themesList[0];
            setDraftValue('appearance', { key: 'theme' }, primaryTheme.theme_id);

            // 5. Áp dụng ngay giao diện mới để người dùng trải nghiệm tức thì
            if (window.ThemeManager && typeof window.ThemeManager.applyTheme === 'function') {
                window.ThemeManager.applyTheme(primaryTheme.theme_id, false);
            } else {
                document.documentElement.setAttribute('data-bs-theme', primaryTheme.theme_id);
            }

            // 6. Cập nhật lại giao diện Settings để dropdown hiển thị theme mới
            renderSidebar();
            renderContent();
            updateRawJsonEditor();

            // 7. Hiển thị thông báo thành công
            const namesList = themesList.map(t => `'${t.theme_name}'`).join(', ');
            showPopupAlert(
                'Import Theme thành công',
                `✓ ${res.message}\nĐã thêm ${themesList.length} theme (${namesList}) từ file .vsix, trích xuất bảng màu và lưu vào file style.css thành công.\nNhấn nút "Lưu (Save)" để lưu cố định cấu hình.`,
                'success'
            );
        } catch (err) {
            console.error('[Settings] Error importing VSIX theme:', err);
            showPopupAlert('Lỗi', 'Không thể import file .vsix: ' + err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        }
    }

    // ── Render Sidebar ────────────────────────────────────────────────────────
    function renderSidebar() {
        const navList = document.getElementById('settingsNavList');
        if (!navList) return;
        navList.innerHTML = '';

        const label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = _searchQuery ? 'Danh mục' : 'Commonly Used';
        navList.appendChild(label);

        CATEGORIES.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'nav-item' + (!_searchQuery && cat.key === _activeCat ? ' active' : '');
            item.innerHTML = `<span class="chevron">›</span><span>${cat.name}</span>`;
            item.onclick = () => {
                if (_searchQuery) {
                    const searchInput = document.getElementById('settingsSearchInput');
                    if (searchInput) searchInput.value = '';
                    _searchQuery = '';
                    const clearBtn = document.getElementById('settingsSearchClear');
                    if (clearBtn) clearBtn.classList.add('d-none');
                }
                _activeCat = cat.key;
                renderSidebar();
                renderContent();
            };
            navList.appendChild(item);
        });
    }

    // ── Render Field Elements ─────────────────────────────────────────────────
    function renderFieldElement(catKey, field, currentVal) {
        // Type 1: Checkbox (.check-setting)
        if (field.type === 'switch') {
            const wrap = document.createElement('div');
            wrap.className = 'check-setting';

            const title = document.createElement('div');
            title.className = 'setting-title';
            title.textContent = field.label;

            const label = document.createElement('label');
            label.className = 'check-row';

            const checkbox = document.createElement('input');
            checkbox.className = 'checkbox';
            checkbox.type = 'checkbox';
            checkbox.checked = Boolean(currentVal);

            const span = document.createElement('span');
            span.textContent = field.desc;

            checkbox.onchange = () => {
                setDraftValue(catKey, field, checkbox.checked);
            };

            label.appendChild(checkbox);
            label.appendChild(span);
            wrap.appendChild(title);
            wrap.appendChild(label);
            return wrap;
        }

        // Type 2: Select Dropdown (.gray-setting)
        if (field.type === 'select') {
            const wrap = document.createElement('div');
            wrap.className = 'gray-setting';

            const title = document.createElement('div');
            title.className = 'setting-title';
            title.textContent = field.label;

            const desc = document.createElement('div');
            desc.className = 'description';
            desc.textContent = field.desc;

            const select = document.createElement('select');
            select.className = 'select-input';

            const isUiFont = (catKey === 'appearance' && field.key === 'uiFontFamily');
            const isCodeFont = (field.key === 'fontFamily' && (catKey === 'editor' || catKey === 'grid' || catKey === 'messages'));
            const isTheme = (catKey === 'appearance' && field.key === 'theme');

            function populateFontSelect(targetSelect, val, isUi) {
                targetSelect.innerHTML = '';
                targetSelect.dataset.systemFontsLoaded = 'false';

                // 1. Recommended Fonts Group
                const recGroup = document.createElement('optgroup');
                recGroup.label = '⭐ Khuyên dùng (Recommended)';
                const recList = isUi ? FONT_OPTIONS_UI : FONT_OPTIONS_CODE;

                let valFound = false;
                recList.forEach(opt => {
                    const optEl = document.createElement('option');
                    optEl.value = opt.value;
                    optEl.textContent = opt.label;
                    if (String(opt.value).toLowerCase() === String(val || '').toLowerCase()) {
                        optEl.selected = true;
                        valFound = true;
                    }
                    recGroup.appendChild(optEl);
                });
                targetSelect.appendChild(recGroup);

                // If current val is not in recommended, add it as active option right away
                if (!valFound && val) {
                    const customOpt = document.createElement('option');
                    customOpt.value = val;
                    customOpt.textContent = `${val} (Đang dùng)`;
                    customOpt.selected = true;
                    targetSelect.insertBefore(customOpt, targetSelect.firstChild);
                    valFound = true;
                }

                // Lazy load trigger option at the bottom
                const lazyOpt = document.createElement('option');
                lazyOpt.value = '__LAZY_LOAD__';
                lazyOpt.textContent = '🔽 Tải danh sách phông máy tính... (Click to load all)';
                lazyOpt.style.fontStyle = 'italic';
                lazyOpt.style.color = '#007acc';
                targetSelect.appendChild(lazyOpt);

                // Lazy load function
                const loadSystemFontsLazy = async () => {
                    if (targetSelect.dataset.systemFontsLoaded === 'true' || targetSelect.dataset.systemFontsLoaded === 'loading') {
                        return;
                    }
                    targetSelect.dataset.systemFontsLoaded = 'loading';

                    const sysFonts = _systemFonts || global._cachedSystemFonts || await fetchSystemFonts();
                    if (!sysFonts || !Array.isArray(sysFonts.all) || sysFonts.all.length === 0) {
                        targetSelect.dataset.systemFontsLoaded = 'failed';
                        return;
                    }

                    // Remove placeholder option if exists
                    const placeholder = targetSelect.querySelector('option[value="__LAZY_LOAD__"]');
                    if (placeholder) placeholder.remove();

                    const curVal = targetSelect.value && targetSelect.value !== '__LAZY_LOAD__' ? targetSelect.value : val;
                    const recSet = new Set(recList.map(r => r.value.toLowerCase()));
                    const frag = document.createDocumentFragment();

                    if (isUi) {
                        const sysGroup = document.createElement('optgroup');
                        sysGroup.label = `💻 Phông chữ trên máy tính (${sysFonts.all.length} phông)`;
                        for (let i = 0; i < sysFonts.all.length; i++) {
                            const fontName = sysFonts.all[i];
                            if (recSet.has(fontName.toLowerCase())) continue;
                            const optEl = document.createElement('option');
                            optEl.value = fontName;
                            optEl.textContent = fontName;
                            if (String(fontName).toLowerCase() === String(curVal).toLowerCase()) {
                                optEl.selected = true;
                            }
                            sysGroup.appendChild(optEl);
                        }
                        frag.appendChild(sysGroup);
                    } else {
                        // Monospace first
                        const monoList = (sysFonts.monospace && sysFonts.monospace.length > 0) ? sysFonts.monospace : [];
                        if (monoList.length > 0) {
                            const monoGroup = document.createElement('optgroup');
                            monoGroup.label = `💻 Phông đơn cách trên máy (Monospace - ${monoList.length} phông)`;
                            for (let i = 0; i < monoList.length; i++) {
                                const fontName = monoList[i];
                                if (recSet.has(fontName.toLowerCase())) continue;
                                const optEl = document.createElement('option');
                                optEl.value = fontName;
                                optEl.textContent = fontName;
                                if (String(fontName).toLowerCase() === String(curVal).toLowerCase()) {
                                    optEl.selected = true;
                                }
                                monoGroup.appendChild(optEl);
                            }
                            frag.appendChild(monoGroup);
                        }

                        // Other system fonts
                        const monoSet = new Set(monoList.map(m => m.toLowerCase()));
                        const otherGroup = document.createElement('optgroup');
                        otherGroup.label = `Tất cả phông khác trên máy`;
                        for (let i = 0; i < sysFonts.all.length; i++) {
                            const fontName = sysFonts.all[i];
                            if (recSet.has(fontName.toLowerCase()) || monoSet.has(fontName.toLowerCase())) continue;
                            const optEl = document.createElement('option');
                            optEl.value = fontName;
                            optEl.textContent = fontName;
                            if (String(fontName).toLowerCase() === String(curVal).toLowerCase()) {
                                optEl.selected = true;
                            }
                            otherGroup.appendChild(optEl);
                        }
                        frag.appendChild(otherGroup);
                    }

                    targetSelect.appendChild(frag);
                    targetSelect.dataset.systemFontsLoaded = 'true';
                    if (curVal && curVal !== '__LAZY_LOAD__') {
                        targetSelect.value = curVal;
                    }
                };

                targetSelect._triggerLazyFontLoad = loadSystemFontsLazy;
                targetSelect.addEventListener('focus', loadSystemFontsLazy, { once: true });
                targetSelect.addEventListener('mousedown', loadSystemFontsLazy, { once: true });
                targetSelect.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter') {
                        loadSystemFontsLazy();
                    }
                }, { once: true });
            }

            if (isUiFont || isCodeFont) {
                populateFontSelect(select, currentVal, isUiFont);
            } else if (isTheme) {
                const options = getThemeOptions();
                options.forEach(opt => {
                    const optEl = document.createElement('option');
                    optEl.value = typeof opt === 'object' ? opt.value : opt;
                    optEl.textContent = typeof opt === 'object' ? opt.label : opt;
                    if (String(optEl.value) === String(currentVal)) {
                        optEl.selected = true;
                    }
                    select.appendChild(optEl);
                });
            } else {
                const options = field.options || [];
                options.forEach(opt => {
                    const optEl = document.createElement('option');
                    optEl.value = typeof opt === 'object' ? opt.value : opt;
                    optEl.textContent = typeof opt === 'object' ? opt.label : opt;
                    if (String(optEl.value) === String(currentVal)) {
                        optEl.selected = true;
                    }
                    select.appendChild(optEl);
                });
            }

            let previewWrap = null;
            let updateFontPreview = null;

            if (isUiFont || isCodeFont) {
                previewWrap = document.createElement('div');
                previewWrap.className = 'setting-font-preview';

                const previewLabel = document.createElement('div');
                previewLabel.className = 'preview-label';
                previewLabel.innerHTML = '<i class="fa-solid fa-eye me-1"></i>Xem trước phông chữ (Live Preview):';

                const previewText = document.createElement('div');
                previewText.className = 'preview-sample';
                if (isUiFont) {
                    previewText.textContent = 'Giao diện IDE: Bảng dữ liệu, Cây thư mục, Menu tác vụ (0123456789 - AaBbCc)';
                } else if (catKey === 'editor') {
                    previewText.textContent = 'SELECT [Id], [Title], [CreatedAt] FROM [dbo].[Users] WHERE [IsActive] = 1; -- 0123456789';
                } else if (catKey === 'grid') {
                    previewText.textContent = 'Bảng dữ liệu: [ID: 1042] | [Họ tên: Nguyễn Văn A] | [Số tiền: 15,250,000 ₫]';
                } else {
                    previewText.textContent = '(1 row affected) - Completion time: 2026-09-29 03:00:00';
                }

                previewWrap.appendChild(previewLabel);
                previewWrap.appendChild(previewText);

                updateFontPreview = function (fontName) {
                    if (!fontName || fontName === '__LAZY_LOAD__') return;
                    const clean = fontName.trim().replace(/^['"]+|['"]+$/g, '');
                    const stack = isUiFont
                        ? `"${clean}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
                        : `"${clean}", Consolas, monospace`;
                    previewText.style.fontFamily = stack;
                    select.style.fontFamily = stack;

                    if (isUiFont && window.TypographyManager && typeof window.TypographyManager.apply === 'function') {
                        window.TypographyManager.apply({ uiFontFamily: clean }, false);
                    }
                };

                updateFontPreview(currentVal);
            }

            select.onchange = () => {
                if (select.value === '__LAZY_LOAD__') {
                    select.value = currentVal || '';
                    if (typeof select._triggerLazyFontLoad === 'function') {
                        select._triggerLazyFontLoad();
                    }
                    return;
                }
                if (typeof updateFontPreview === 'function') {
                    updateFontPreview(select.value);
                }
                setDraftValue(catKey, field, select.value);
            };

            select.oninput = () => {
                if (select.value !== '__LAZY_LOAD__' && typeof updateFontPreview === 'function') {
                    updateFontPreview(select.value);
                }
            };

            wrap.appendChild(title);
            wrap.appendChild(desc);
            wrap.appendChild(select);
            if (previewWrap) {
                wrap.appendChild(previewWrap);
            }
            return wrap;
        }

        // Type 3: Action Button (.vsix-import-setting)
        if (field.type === 'action-button' || field.type === 'button') {
            const wrap = document.createElement('div');
            wrap.className = 'vsix-import-setting';

            const title = document.createElement('div');
            title.className = 'setting-title';
            title.textContent = field.label;

            const desc = document.createElement('div');
            desc.className = 'description';
            desc.textContent = field.desc;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-settings-action-custom';
            btn.innerHTML = `${field.icon ? `<i class="${field.icon} me-1"></i>` : ''}<span>${field.buttonText || 'Thực hiện'}</span>`;
            btn.onclick = () => {
                if (field.key === 'importVsixTheme') {
                    handleImportVsixTheme(btn);
                } else if (typeof field.onClick === 'function') {
                    field.onClick(btn);
                }
            };

            wrap.appendChild(title);
            wrap.appendChild(desc);
            wrap.appendChild(btn);
            return wrap;
        }

        // Type 4: Number or Text Input (.setting)
        const wrap = document.createElement('div');
        wrap.className = 'setting';

        const title = document.createElement('div');
        title.className = 'setting-title';
        title.textContent = field.label;

        const desc = document.createElement('div');
        desc.className = 'description';
        desc.textContent = field.desc;

        const input = document.createElement('input');
        input.className = field.type === 'number' ? 'number-input' : 'text-input';
        input.type = field.type === 'number' ? 'number' : 'text';
        input.value = currentVal !== undefined ? currentVal : '';
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;

        input.oninput = () => {
            const val = field.type === 'number' ? Number(input.value) : input.value;
            setDraftValue(catKey, field, val);
        };

        wrap.appendChild(title);
        wrap.appendChild(desc);
        wrap.appendChild(input);
        return wrap;
    }

    // ── Render Content Area ───────────────────────────────────────────────────
    function renderContent() {
        const contentArea = document.getElementById('settingsContentArea');
        if (!contentArea) return;
        contentArea.innerHTML = '';

        const dataSrc = _draftSettings || _settings || DEFAULT_SETTINGS;

        // Search mode
        if (_searchQuery) {
            const q = _searchQuery.toLowerCase();
            let matchCount = 0;

            const h1 = document.createElement('h1');
            h1.textContent = `Kết quả tìm kiếm cho "${_searchQuery}"`;
            contentArea.appendChild(h1);

            CATEGORIES.forEach(cat => {
                const matchedFields = cat.fields.filter(f => {
                    const label = (f.label || '').toLowerCase();
                    const desc = (f.desc || '').toLowerCase();
                    const catName = (cat.name || '').toLowerCase();
                    return label.includes(q) || desc.includes(q) || catName.includes(q);
                });

                if (matchedFields.length > 0) {
                    matchedFields.forEach(field => {
                        matchCount++;
                        const currentVal = getSettingValue(dataSrc, cat.key, field);
                        const el = renderFieldElement(cat.key, field, currentVal);
                        contentArea.appendChild(el);
                    });
                }
            });

            if (matchCount === 0) {
                const empty = document.createElement('div');
                empty.className = 'text-center text-muted py-5';
                empty.innerHTML = `
                    <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;">🔍</div>
                    <div>Không tìm thấy cài đặt nào phù hợp với "<strong>${_searchQuery}</strong>".</div>
                `;
                contentArea.appendChild(empty);
            }
            return;
        }

        // Category mode
        const activeCategory = CATEGORIES.find(c => c.key === _activeCat) || CATEGORIES[0];
        if (!activeCategory) return;

        const h1 = document.createElement('h1');
        h1.innerHTML = `${activeCategory.name} <span style="font-size:15px;font-weight:normal;opacity:0.6;">(${activeCategory.subtitle || activeCategory.name})</span>`;
        contentArea.appendChild(h1);

        activeCategory.fields.forEach(field => {
            const currentVal = getSettingValue(dataSrc, activeCategory.key, field);
            const el = renderFieldElement(activeCategory.key, field, currentVal);
            contentArea.appendChild(el);
        });
    }

    // ── Open Settings: New Window or Fallback Modal ───────────────────────────
    async function openSettings() {
        // In desktop mode: attempt to open new window via Python IPC
        try {
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_settings_window === 'function') {
                if (window.AppLoader) window.AppLoader.show('Đang mở Cài đặt...');
                try {
                    const res = await window.pywebview.api.open_settings_window();
                    if (res && res.success) return;
                } finally {
                    setTimeout(() => { if (window.AppLoader) window.AppLoader.hide(); }, 600);
                }
            }
        } catch (e) {
            console.warn('Native open_settings_window failed, falling back to modal:', e);
        }

        // Fallback: Open Modal Dialog
        await loadSettingsData();
        renderSidebar();
        renderContent();
        updateRawJsonEditor();

        const modalEl = document.getElementById('settingsModal');
        if (modalEl) {
            _bsModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal)
                ? bootstrap.Modal.getOrCreateInstance(modalEl)
                : null;
            if (_bsModal) _bsModal.show();
        }
    }

    async function loadSettingsData() {
        if (window.AppStorage && typeof window.AppStorage.getSettings === 'function') {
            _settings = await window.AppStorage.getSettings();
        } else {
            _settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        }

        // Merge defaults if keys missing
        if (!_settings.editor) _settings.editor = { ...DEFAULT_SETTINGS.editor };
        if (!_settings.grid) _settings.grid = { ...DEFAULT_SETTINGS.grid };
        if (!_settings.messages) _settings.messages = { ...DEFAULT_SETTINGS.messages };
        if (!_settings.appearance) _settings.appearance = { ...DEFAULT_SETTINGS.appearance };

        const currentTheme = document.documentElement.getAttribute('data-bs-theme') || _settings.theme || 'dark';
        _settings.theme = currentTheme;
        _settings.appearance.theme = currentTheme;

        // Clone to draft
        _draftSettings = JSON.parse(JSON.stringify(_settings));
        _isDirty = false;
    }

    // ── Initialize Event Listeners ────────────────────────────────────────────
    function initSettings() {
        const isStandaloneWindow = document.body.classList.contains('settings-standalone') ||
            document.querySelector('.settings-standalone') !== null;

        // 1. Triggers to Open Settings from Main IDE
        const btnToolbar = document.getElementById('ide-settings-btn');
        if (btnToolbar) {
            btnToolbar.addEventListener('click', (e) => {
                e.preventDefault();
                openSettings();
            });
        }

        const menuSettings = document.getElementById('menu-settings');
        if (menuSettings) {
            menuSettings.addEventListener('click', (e) => {
                e.preventDefault();
                openSettings();
            });
        }

        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.code === 'Comma')) {
                e.preventDefault();
                openSettings();
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-action="open-settings"]');
            if (target) {
                e.preventDefault();
                openSettings();
            }
        });

        // 2. Save Button
        const saveBtn = document.getElementById('settingsSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                saveCurrentSettings();
            });
        }

        // 3. Reset Button (Popup confirm)
        const resetBtn = document.getElementById('settingsResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showPopupConfirm(
                    'Khôi phục mặc định',
                    'Bạn có chắc chắn muốn khôi phục tất cả cài đặt về giá trị mặc định?',
                    () => {
                        _draftSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
                        _isDirty = true;
                        if (window.TypographyManager && typeof window.TypographyManager.apply === 'function') {
                            window.TypographyManager.apply({
                                uiFontFamily: DEFAULT_SETTINGS.appearance.uiFontFamily,
                                uiFontSize: DEFAULT_SETTINGS.appearance.uiFontSize
                            }, false);
                        }
                        renderSidebar();
                        renderContent();
                        updateRawJsonEditor();
                        showPopupAlert('Thông báo', 'Đã đặt lại các giá trị về mặc định. Nhấn nút "Lưu" để xác nhận lưu vào file.', 'info');
                    }
                );
            });
        }

        // 4. Search Box
        const searchInput = document.getElementById('settingsSearchInput');
        const clearBtn = document.getElementById('settingsSearchClear');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                _searchQuery = (searchInput.value || '').trim();
                if (clearBtn) clearBtn.classList.toggle('d-none', !_searchQuery);
                renderSidebar();
                renderContent();
            });
        }
        if (clearBtn && searchInput) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                _searchQuery = '';
                clearBtn.classList.add('d-none');
                renderSidebar();
                renderContent();
            });
        }

        // 5. Tabs (Visual Form / Raw JSON)
        const tabEls = document.querySelectorAll('.settings-window .tab');
        const visualArea = document.getElementById('settingsVisualArea');
        const jsonArea = document.getElementById('settingsJsonArea');
        const searchRow = document.getElementById('settingsSearchRow');

        tabEls.forEach(t => {
            t.addEventListener('click', () => {
                tabEls.forEach(x => x.classList.remove('active'));
                t.classList.add('active');

                const tabKey = t.dataset.tab;
                _activeTab = tabKey;

                if (tabKey === 'json') {
                    if (visualArea) visualArea.classList.add('d-none');
                    if (jsonArea) jsonArea.classList.remove('d-none');
                    if (searchRow) searchRow.classList.add('d-none');
                    updateRawJsonEditor();
                } else {
                    // Chuyển về tab Visual: parse lại từ textarea nếu có thay đổi
                    const textarea = document.getElementById('settingsRawJsonTextarea');
                    if (textarea && textarea.value) {
                        try {
                            _draftSettings = JSON.parse(textarea.value);
                        } catch (e) { }
                    }
                    if (jsonArea) jsonArea.classList.add('d-none');
                    if (visualArea) visualArea.classList.remove('d-none');
                    if (searchRow) searchRow.classList.remove('d-none');
                    renderSidebar();
                    renderContent();
                }
            });
        });

        // Live validation for textarea in JSON tab
        const textarea = document.getElementById('settingsRawJsonTextarea');
        const jsonBadge = document.getElementById('jsonStatusBadge');
        if (textarea) {
            textarea.addEventListener('input', () => {
                _isDirty = true;
                if (jsonBadge) {
                    try {
                        JSON.parse(textarea.value);
                        jsonBadge.className = 'badge bg-success';
                        jsonBadge.textContent = 'JSON hợp lệ';
                    } catch (e) {
                        jsonBadge.className = 'badge bg-danger';
                        jsonBadge.textContent = 'Lỗi cú pháp JSON';
                    }
                }
            });
        }

        // 6. Window Actions
        const copyBtn = document.getElementById('settingsCopyJsonBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const targetObj = _draftSettings || _settings || DEFAULT_SETTINGS;
                const str = JSON.stringify(targetObj, null, 4);
                const fnCopy = window.copyToClipboard || (s => navigator.clipboard.writeText(s));
                Promise.resolve(fnCopy(str)).then(() => {
                    showPopupAlert('Sao chép JSON', '✓ Đã sao chép nội dung settings.json vào clipboard.', 'success');
                }).catch(err => {
                    showPopupAlert('Lỗi', 'Không thể sao chép vào clipboard: ' + (err?.message || err), 'error');
                });
            });
        }

        const toggleSidebarBtn = document.getElementById('settingsToggleSidebarBtn');
        if (toggleSidebarBtn) {
            toggleSidebarBtn.addEventListener('click', () => {
                const sb = document.getElementById('settingsNavList');
                if (sb) sb.classList.toggle('collapsed');
            });
        }

        const fullscreenBtn = document.getElementById('settingsFullscreenBtn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                const dialog = document.getElementById('settingsModalDialog');
                if (dialog) {
                    dialog.classList.toggle('fullscreen');
                } else {
                    const win = document.querySelector('.settings-window');
                    if (win) win.classList.toggle('fullscreen');
                }
            });
        }

        const closeWindowBtn = document.getElementById('settingsCloseWindowBtn');
        if (closeWindowBtn) {
            closeWindowBtn.addEventListener('click', () => {
                if (_isDirty) {
                    showPopupConfirm(
                        'Thay đổi chưa lưu',
                        'Bạn có thay đổi chưa lưu. Bạn có muốn lưu trước khi đóng không?',
                        async () => {
                            await saveCurrentSettings();
                            window.close();
                        },
                        () => {
                            window.close();
                        }
                    );
                } else {
                    window.close();
                }
            });
        }

        // 7. Auto-load on page ready
        setTimeout(async () => {
            await loadSettingsData();
            if (_settings) {
                applyAllSettings(_settings);
            }
            if (isStandaloneWindow) {
                renderSidebar();
                renderContent();
                updateRawJsonEditor();
            }
        }, 120);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettings);
    } else {
        initSettings();
    }

    global.SettingsManager = {
        open: openSettings,
        showModal: openSettings,
        save: saveCurrentSettings,
        getSettings: () => _settings,
        getDraft: () => _draftSettings,
        applySettings: applyAllSettings,
        CATEGORIES
    };
})(window);
