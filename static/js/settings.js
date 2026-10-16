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

    // Fast synchronous restore for Grid Typography from cached settings
    try {
        const cachedSettingsStr = localStorage.getItem('ide-settings');
        if (cachedSettingsStr) {
            const cachedSettings = JSON.parse(cachedSettingsStr);
            if (cachedSettings && cachedSettings.grid) {
                const fam = cachedSettings.grid.fontFamily || 'Segoe UI, Arial, sans-serif';
                const sz = parseInt(cachedSettings.grid.fontSize, 10) || 13;
                document.documentElement.style.setProperty('--ide-grid-font-family', fam);
                document.documentElement.style.setProperty('--ide-grid-font-size', `${sz}px`);
            }
        }
    } catch (_) {}

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
                },
                {
                    key: 'syntaxCheck',
                    label: 'Kiểm tra cú pháp SQL (SQL Syntax Check)',
                    desc: 'Biến cấu hình: editor.syntaxCheck. Tự động kiểm tra cú pháp câu lệnh SQL và hiển thị cảnh báo lỗi trực tiếp trên Monaco Editor.',
                    type: 'switch'
                },
                {
                    key: 'codeStylesManager',
                    label: 'Quản lý Định dạng Mã SQL (SQL Code Styles)',
                    desc: 'Cấu hình chi tiết kiểu dáng thụt lề, dấu phẩy, mệnh đề JOIN, WHERE, CASE cho formatter.',
                    type: 'action-button',
                    icon: 'fa-solid fa-sliders',
                    buttonText: 'Mở Quản lý SQL Code Styles...',
                    onClick: () => {
                        if (window.SqlStyleManager && typeof window.SqlStyleManager.open === 'function') {
                            window.SqlStyleManager.open();
                        }
                    }
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
                },
                {
                    key: 'sqlprotection',
                    label: 'Bảo vệ câu lệnh SQL nguy hiểm (SQL Protection Guard)',
                    desc: 'Biến cấu hình: sql.sqlprotection. Cảnh báo an toàn trước khi thực thi các lệnh DELETE / UPDATE không có điều kiện WHERE, hoặc TRUNCATE bảng (1 = Bật bảo vệ, 0 = Tắt).',
                    type: 'select',
                    valueType: 'number',
                    options: [
                        { value: 1, label: '1 - Bật bảo vệ (Cảnh báo trước khi thực thi)' },
                        { value: 0, label: '0 - Tắt bảo vệ (Không cảnh báo)' }
                    ]
                },
                {
                    key: 'stopOnError',
                    label: 'Dừng khi gặp lỗi (Stop on Error)',
                    desc: 'Biến cấu hình: sql.stopOnError. Tự động dừng thực thi các câu lệnh tiếp theo trong script nếu câu lệnh trước xảy ra lỗi.',
                    type: 'switch'
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
        },
        {
            key: 'history',
            name: 'Lịch sử truy vấn',
            subtitle: 'Query History',
            icon: 'fa-solid fa-clock-rotate-left',
            fields: [
                {
                    key: 'enabled',
                    label: 'Ghi nhật ký lịch sử truy vấn (History Logging)',
                    desc: 'Biến cấu hình: history.enabled. Tự động ghi nhật ký lịch sử thực thi SQL khi nhấn F5 (hỗ trợ phục hồi, so sánh, xem lại).',
                    type: 'switch'
                },
                {
                    key: 'maxEntriesPerDoc',
                    label: 'Số lần chạy tối đa trên mỗi tài liệu (Max Entries Per Document)',
                    desc: 'Biến cấu hình: history.maxEntriesPerDoc. Giới hạn số bản ghi lịch sử lưu trữ cho mỗi file hoặc tab truy vấn. Mặc định: 200.',
                    type: 'number',
                    min: 10,
                    max: 2000,
                    step: 10
                },
                {
                    key: 'maxAgeDays',
                    label: 'Thời gian lưu trữ tối đa (Max Age in Days)',
                    desc: 'Biến cấu hình: history.maxAgeDays. Thời gian lưu trữ các bản ghi lịch sử (ngày). Các bản ghi cũ hơn sẽ tự động được dọn dẹp. Mặc định: 90 ngày.',
                    type: 'number',
                    min: 1,
                    max: 730,
                    step: 1
                },
                {
                    key: 'maxDbSizeMb',
                    label: 'Giới hạn dung lượng tối đa DB (Max Database Size in MB)',
                    desc: 'Biến cấu hình: history.maxDbSizeMb. Ngưỡng dung lượng tối đa cho file lưu trữ SQLite (MB). Khi vượt ngưỡng, hệ thống tự động dọn các bản ghi cũ nhất của các tài liệu không được ghim sao (⭐). Mặc định: 500 MB.',
                    type: 'number',
                    min: 50,
                    max: 5000,
                    step: 50
                },
                {
                    key: 'maxEntrySizeKb',
                    label: 'Giới hạn kích thước 1 câu truy vấn (Max Entry Size in KB)',
                    desc: 'Biến cấu hình: history.maxEntrySizeKb. Giới hạn kích thước câu lệnh SQL để ghi lưu trữ đầy đủ (KB). Câu lệnh vượt quá sẽ lưu phần đầu kèm cờ IsTruncated. Mặc định: 1024 KB (1 MB).',
                    type: 'number',
                    min: 64,
                    max: 10240,
                    step: 64
                },
                {
                    key: 'storageManagement',
                    type: 'custom',
                    render: renderHistoryStorageManagement
                }
            ]
        },
        {
            key: 'logging',
            name: 'Nhật ký hệ thống',
            subtitle: 'System & Error Logs',
            icon: 'fa-solid fa-file-waveform',
            fields: [
                {
                    key: 'enabled',
                    label: 'Ghi nhật ký ra file (Enable File Logging)',
                    desc: 'Biến cấu hình: logging.enabled. Tự động ghi nhật ký hoạt động và lỗi của ứng dụng ra file xoay vòng (app.log).',
                    type: 'switch'
                },
                {
                    key: 'level',
                    label: 'Mức độ chi tiết nhật ký (Log Level)',
                    desc: 'Biến cấu hình: logging.level. Cấp độ ghi nhật ký: DEBUG (chi tiết nhất), INFO (chuẩn hoạt động), WARNING (cảnh báo), ERROR (chỉ lỗi).',
                    type: 'select',
                    options: [
                        { value: 'DEBUG', label: 'DEBUG - Chi tiết kiểm thử và chuẩn đoán' },
                        { value: 'INFO', label: 'INFO - Hoạt động tiêu chuẩn (Khuyến nghị)' },
                        { value: 'WARNING', label: 'WARNING - Chỉ cảnh báo và lỗi' },
                        { value: 'ERROR', label: 'ERROR - Chỉ ghi nhận lỗi nghiêm trọng' }
                    ]
                },
                {
                    key: 'maxFileSizeMb',
                    label: 'Dung lượng tối đa mỗi file log (Max File Size in MB)',
                    desc: 'Biến cấu hình: logging.maxFileSizeMb. Khi file đạt giới hạn này, hệ thống tự động xoay vòng sang file log mới. Mặc định: 2 MB.',
                    type: 'number',
                    min: 1,
                    max: 50,
                    step: 1
                },
                {
                    key: 'maxFiles',
                    label: 'Số file xoay vòng tối đa (Max Backup Files)',
                    desc: 'Biến cấu hình: logging.maxFiles. Số file log cũ được giữ lại trước khi ghi đè file cũ nhất. Mặc định: 5 files.',
                    type: 'number',
                    min: 1,
                    max: 20,
                    step: 1
                },
                {
                    key: 'openLogFolderBtn',
                    label: 'Mở thư mục nhật ký (Open Log Folder)',
                    desc: 'Mở thư mục chứa các file app.log trên máy tính bằng File Explorer để xem trực tiếp hoặc gửi hỗ trợ kỹ thuật.',
                    type: 'action-button',
                    icon: 'fa-solid fa-folder-open',
                    buttonText: 'Mở thư mục Log...',
                    onClick: async (btn) => {
                        try {
                            btn.disabled = true;
                            let res = null;
                            if (window.pywebview?.api?.open_log_folder) {
                                res = await window.pywebview.api.open_log_folder();
                            } else if (global.api?.open_log_folder) {
                                res = await global.api.open_log_folder();
                            } else {
                                const resp = await fetch('/api/system/logs/open', { method: 'POST' });
                                if (resp && resp.ok) {
                                    res = await resp.json();
                                }
                            }
                            if (res && res.success) {
                                showPopupAlert('Thư mục Log', `Đã mở thư mục nhật ký:\n${res.path || ''}`, 'success');
                            } else {
                                showPopupAlert('Lỗi', res?.error || 'Không thể mở thư mục nhật ký.', 'error');
                            }
                        } catch (err) {
                            showPopupAlert('Lỗi', 'Lỗi khi mở thư mục log: ' + (err?.message || err), 'error');
                        } finally {
                            btn.disabled = false;
                        }
                    }
                }
            ]
        },
        {
            key: 'updates',
            name: 'Thông tin & Cập nhật',
            subtitle: 'About & Software Updates',
            icon: 'fa-solid fa-arrows-rotate',
            fields: [
                {
                    key: 'aboutInfoBox',
                    type: 'custom',
                    render: renderAboutAndVersionInfo
                },
                {
                    key: 'checkOnStartup',
                    label: 'Tự động kiểm tra bản cập nhật khi khởi động (Check on Startup)',
                    desc: 'Biến cấu hình: updates.checkOnStartup. Tự động kiểm tra xem có phiên bản mới hơn trên GitHub Releases khi mở ứng dụng trong luồng nền không chặn.',
                    type: 'switch'
                },
                {
                    key: 'updateUrl',
                    label: 'URL kiểm tra cập nhật tùy chỉnh (Custom Update URL)',
                    desc: 'Biến cấu hình: updates.updateUrl. Để trống để sử dụng GitHub Releases chính thức. Nhập URL file version.json nếu doanh nghiệp dùng máy chủ phân phối nội bộ.',
                    type: 'text'
                },
                {
                    key: 'openDataFolderBtn',
                    label: 'Mở thư mục Dữ liệu người dùng (Open User Data Folder)',
                    desc: 'Mở thư mục chứa toàn bộ cấu hình, kết nối và lịch sử truy vấn trên máy tính hoặc thẻ nhớ USB Portable.',
                    type: 'action-button',
                    icon: 'fa-solid fa-folder-open',
                    buttonText: 'Mở Thư mục Dữ liệu...',
                    onClick: handleOpenDataFolder
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
            keywordCase: 'upper',
            syntaxCheck: true
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
            timeoutSeconds: 30,
            sqlprotection: 1
        },
        addons: {
            bravo_tool: {
                enabled: true
            }
        },
        history: {
            enabled: true,
            maxEntriesPerDoc: 200,
            maxAgeDays: 90,
            maxDbSizeMb: 500,
            maxEntrySizeKb: 1024
        },
        logging: {
            enabled: true,
            level: 'INFO',
            maxFileSizeMb: 2,
            maxFiles: 5
        },
        updates: {
            checkOnStartup: true,
            updateUrl: ''
        }
    };

    let _settings = null;       // Currently saved settings in file
    let _draftSettings = null;  // Temporary draft modified by user before clicking Save
    let _isDirty = false;       // Flag tracking unsaved changes in draft
    let _activeCat = 'editor';
    try {
        const targetCat = localStorage.getItem('settings-active-cat');
        if (targetCat && CATEGORIES.some(c => c.key === targetCat)) {
            _activeCat = targetCat;
            localStorage.removeItem('settings-active-cat');
        }
    } catch (_) {}
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

    function applyIconSize(size) {
        const sz = parseInt(size, 10);
        const validSz = (!isNaN(sz) && sz >= 10 && sz <= 32) ? sz : 16;
        document.documentElement.style.setProperty('--ide-icon-size', `${validSz}px`);
        try {
            localStorage.setItem('ide-icon-size', String(validSz));
        } catch (_) {}
    }

    function syncToolbarQueryLimit(maxRows) {
        const limitEl = document.getElementById('ide-query-limit');
        if (!limitEl) return;
        const targetVal = String(maxRows);
        let found = false;
        for (let i = 0; i < limitEl.options.length; i++) {
            if (limitEl.options[i].value === targetVal) {
                found = true;
                break;
            }
        }
        if (!found) {
            const opt = document.createElement('option');
            opt.value = targetVal;
            opt.textContent = Number(maxRows) === 0 ? 'All' : String(maxRows);
            let inserted = false;
            const targetNum = Number(maxRows) === 0 ? Infinity : Number(maxRows);
            for (let i = 0; i < limitEl.options.length; i++) {
                const optNum = parseInt(limitEl.options[i].value, 10);
                const compNum = optNum === 0 ? Infinity : optNum;
                if (targetNum < compNum) {
                    limitEl.insertBefore(opt, limitEl.options[i]);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                limitEl.appendChild(opt);
            }
        }
        limitEl.value = targetVal;
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
            if (field.key === 'iconSize') {
                _draftSettings.appearance[field.key] = value;
                applyIconSize(value);
                return;
            }
        }

        if (catKey === 'grid') {
            if (!_draftSettings.grid) _draftSettings.grid = {};
            _draftSettings.grid[field.key] = value;
            const fam = _draftSettings.grid.fontFamily || 'Segoe UI, Arial, sans-serif';
            const sz = parseInt(_draftSettings.grid.fontSize, 10) || 13;
            document.documentElement.style.setProperty('--ide-grid-font-family', fam);
            document.documentElement.style.setProperty('--ide-grid-font-size', `${sz}px`);
            document.dispatchEvent(new CustomEvent('ide-settings-updated', { detail: { settings: _draftSettings } }));
            return;
        }

        if (catKey === 'sql' && field.key === 'maxRows') {
            const num = Number(value);
            window._sqlConfig = window._sqlConfig || {};
            window._sqlConfig.maxRows = num;
            syncToolbarQueryLimit(num);
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

        // 1.4. Appearance Icon Size (Object Explorer & Tree Icons)
        const iconSize = settings.appearance?.iconSize !== undefined ? settings.appearance.iconSize : 16;
        applyIconSize(iconSize);

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
        if (window.ObjectContentSearch && window.ObjectContentSearch.ddlViewer && typeof window.ObjectContentSearch.ddlViewer.applyTypographySettings === 'function') {
            window.ObjectContentSearch.ddlViewer.applyTypographySettings();
        }

        if (typeof window.remeasureMonacoFonts === 'function') {
            window.remeasureMonacoFonts();
        } else if (typeof monaco !== 'undefined' && monaco.editor && typeof monaco.editor.remeasureFonts === 'function') {
            try { monaco.editor.remeasureFonts(); } catch (_) {}
        }

        // 2.5. SQL Syntax Check Toggle
        if (window.SqlSyntaxCheckService && typeof window.SqlSyntaxCheckService.setEnabled === 'function') {
            const isSyntaxCheck = settings.editor?.syntaxCheck !== undefined ? Boolean(settings.editor.syntaxCheck) : true;
            window.SqlSyntaxCheckService.setEnabled(isSyntaxCheck);
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
            if (settings.sql.maxRows !== undefined) {
                const maxRowsNum = Number(settings.sql.maxRows);
                window._sqlConfig.maxRows = maxRowsNum;
                syncToolbarQueryLimit(maxRowsNum);
            }
            if (settings.sql.timeoutSeconds !== undefined) window._sqlConfig.timeoutSeconds = Number(settings.sql.timeoutSeconds);
            if (settings.sql.sqlprotection !== undefined) window._sqlConfig.sqlprotection = Number(settings.sql.sqlprotection);
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

    // ── Render History Storage Management Box ────────────────────────────────
    function renderHistoryStorageManagement(catKey, field, currentVal) {
        const wrap = document.createElement('div');
        wrap.className = 'history-storage-box';

        wrap.innerHTML = `
            <div class="storage-box-header">
                <div class="setting-title">
                    <i class="fa-solid fa-hard-drive me-2" style="color:var(--bs-primary, #cc7832);"></i>
                    Dung lượng & Bảo trì lưu trữ SQLite (Storage & Maintenance)
                </div>
                <div class="description">Theo dõi dung lượng thực tế của SQLite và thực hiện bảo trì, dọn dẹp hoặc thu gọn file dữ liệu.</div>
            </div>
            <div class="storage-metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Dung lượng file DB</div>
                    <div class="metric-value" id="qhMetricDbSize">-- MB</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Tài liệu (Documents)</div>
                    <div class="metric-value" id="qhMetricDocs">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Tổng lượt chạy (Entries)</div>
                    <div class="metric-value" id="qhMetricEntries">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Tiết kiệm nhờ nén</div>
                    <div class="metric-value text-success" id="qhMetricSavings">--%</div>
                </div>
            </div>
            <div class="storage-actions-toolbar">
                <button type="button" class="btn-storage-action" id="qhBtnCompact" title="Chạy VACUUM để giải phóng không gian đĩa bị phân mảnh">
                    <i class="fa-solid fa-compress me-1"></i> Tối ưu & Thu gọn (Compact)
                </button>
                <button type="button" class="btn-storage-action" id="qhBtnPurge" title="Xóa các bản ghi quá hạn và giới hạn cấu hình">
                    <i class="fa-solid fa-broom me-1"></i> Dọn dẹp quá hạn (Purge)
                </button>
                <button type="button" class="btn-storage-action btn-storage-danger" id="qhBtnClearAll" title="Xóa toàn bộ lịch sử truy vấn">
                    <i class="fa-solid fa-trash-can me-1"></i> Xóa toàn bộ (Clear all)
                </button>
            </div>
        `;

        async function refreshStats() {
            try {
                let stats = null;
                if (window.pywebview?.api?.history_get_stats) {
                    const res = await window.pywebview.api.history_get_stats();
                    if (res && res.success) stats = res.stats;
                } else {
                    const resp = await fetch('/api/history/stats');
                    if (resp.ok) {
                        const json = await resp.json();
                        if (json.success) stats = json.stats;
                    }
                }
                if (stats) {
                    const dbSizeEl = wrap.querySelector('#qhMetricDbSize');
                    const docsEl = wrap.querySelector('#qhMetricDocs');
                    const entriesEl = wrap.querySelector('#qhMetricEntries');
                    const savingsEl = wrap.querySelector('#qhMetricSavings');
                    if (dbSizeEl) dbSizeEl.textContent = `${stats.db_file_size_mb || 0} MB`;
                    if (docsEl) docsEl.textContent = String(stats.total_documents || 0);
                    if (entriesEl) entriesEl.textContent = String(stats.total_entries || 0);
                    if (savingsEl) savingsEl.textContent = `${stats.compression_savings_pct || 0}%`;
                }
            } catch (err) {
                console.warn('[Settings] Failed to fetch history stats:', err);
            }
        }

        setTimeout(() => {
            const btnCompact = wrap.querySelector('#qhBtnCompact');
            const btnPurge = wrap.querySelector('#qhBtnPurge');
            const btnClearAll = wrap.querySelector('#qhBtnClearAll');

            if (btnCompact) {
                btnCompact.onclick = async () => {
                    btnCompact.disabled = true;
                    btnCompact.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang thu gọn...';
                    try {
                        let res = null;
                        if (window.pywebview?.api?.history_compact) {
                            res = await window.pywebview.api.history_compact();
                        } else {
                            const resp = await fetch('/api/history/compact', { method: 'POST' });
                            res = await resp.json();
                        }
                        await refreshStats();
                        showPopupAlert('Tối ưu thành công', '✓ Đã chạy VACUUM tối ưu hóa cơ sở dữ liệu lịch sử thành công!', 'success');
                    } catch (e) {
                        showPopupAlert('Lỗi', 'Không thể thu gọn cơ sở dữ liệu: ' + e.message, 'error');
                    } finally {
                        btnCompact.disabled = false;
                        btnCompact.innerHTML = '<i class="fa-solid fa-compress me-1"></i> Tối ưu & Thu gọn (Compact)';
                    }
                };
            }

            if (btnPurge) {
                btnPurge.onclick = async () => {
                    btnPurge.disabled = true;
                    btnPurge.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang dọn dẹp...';
                    try {
                        const targetObj = _draftSettings || _settings || DEFAULT_SETTINGS;
                        const hCfg = targetObj.history || {};
                        let res = null;
                        if (window.pywebview?.api?.history_purge) {
                            res = await window.pywebview.api.history_purge(hCfg.maxAgeDays, hCfg.maxEntriesPerDoc, hCfg.maxDbSizeMb);
                        } else {
                            const resp = await fetch('/api/history/purge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    max_age_days: hCfg.maxAgeDays,
                                    max_entries_per_doc: hCfg.maxEntriesPerDoc,
                                    max_db_size_mb: hCfg.maxDbSizeMb
                                })
                            });
                            res = await resp.json();
                        }
                        await refreshStats();
                        const purgedCount = res?.purged_entries ?? 0;
                        showPopupAlert('Dọn dẹp thành công', `✓ Đã dọn dẹp ${purgedCount} bản ghi quá hạn / vượt giới hạn!`, 'success');
                    } catch (e) {
                        showPopupAlert('Lỗi', 'Không thể dọn dẹp lịch sử: ' + e.message, 'error');
                    } finally {
                        btnPurge.disabled = false;
                        btnPurge.innerHTML = '<i class="fa-solid fa-broom me-1"></i> Dọn dẹp quá hạn (Purge)';
                    }
                };
            }

            if (btnClearAll) {
                btnClearAll.onclick = () => {
                    showPopupConfirm(
                        'Xóa toàn bộ lịch sử',
                        'Bạn có chắc chắn muốn xóa TOÀN BỘ lịch sử truy vấn không? Toàn bộ các lần thực thi đã lưu sẽ bị xóa vĩnh viễn và không thể khôi phục.',
                        async () => {
                            btnClearAll.disabled = true;
                            btnClearAll.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang xóa...';
                            try {
                                if (window.pywebview?.api?.history_clear_all) {
                                    await window.pywebview.api.history_clear_all(false);
                                } else {
                                    await fetch('/api/history/clear_all', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ keep_favorites: false })
                                    });
                                }
                                await refreshStats();
                                showPopupAlert('Đã xóa', '✓ Đã xóa toàn bộ lịch sử truy vấn thành công!', 'success');
                            } catch (e) {
                                showPopupAlert('Lỗi', 'Không thể xóa lịch sử: ' + e.message, 'error');
                            } finally {
                                btnClearAll.disabled = false;
                                btnClearAll.innerHTML = '<i class="fa-solid fa-trash-can me-1"></i> Xóa toàn bộ (Clear all)';
                            }
                        }
                    );
                };
            }

            refreshStats();
        }, 50);

        return wrap;
    }

    // ── Open User Data Folder Helper ─────────────────────────────────────────
    async function handleOpenDataFolder(btn) {
        try {
            if (btn) btn.disabled = true;
            let res = null;
            if (window.pywebview?.api?.open_data_folder) {
                res = await window.pywebview.api.open_data_folder();
            } else {
                showPopupAlert('Thông báo', 'Tính năng mở thư mục chỉ hỗ trợ trên giao diện Desktop Native.');
                return;
            }
            if (res && res.success) {
                showPopupAlert('Thư mục Dữ liệu', `Đã mở thư mục dữ liệu:\n${res.path || ''}`, 'success');
            } else {
                showPopupAlert('Lỗi', res?.error || 'Không thể mở thư mục dữ liệu.', 'error');
            }
        } catch (err) {
            showPopupAlert('Lỗi', 'Lỗi khi mở thư mục: ' + (err?.message || err), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Render About & Software Updates Box ──────────────────────────────────
    function renderAboutAndVersionInfo(catKey, field, currentVal) {
        const wrap = document.createElement('div');
        wrap.className = 'about-info-box';

        wrap.innerHTML = `
            <div class="about-header">
                <div class="about-title-wrap">
                    <img src="../static/image/logo-200x200.png" class="about-logo" alt="Logo" onerror="this.style.display='none'">
                    <div>
                        <div class="about-app-name" id="aboutAppName">luoBTool IDE</div>
                        <div class="about-app-desc" id="aboutAppDesc">Modern SQL Database IDE & Developer Suite</div>
                    </div>
                </div>
                <div>
                    <span class="about-badge-pill about-badge-installed" id="aboutBadgeMode">
                        <i class="fa-solid fa-spinner fa-spin me-1"></i> Đang tải...
                    </span>
                </div>
            </div>

            <div class="storage-metrics-grid">
                <div class="metric-card">
                    <div class="metric-label">Phiên bản (Version)</div>
                    <div class="metric-value text-primary" id="aboutMetricVersion">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Chế độ hoạt động</div>
                    <div class="metric-value" id="aboutMetricMode">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Python Runtime</div>
                    <div class="metric-value" id="aboutMetricPython">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Nền tảng (Platform)</div>
                    <div class="metric-value" id="aboutMetricPlatform">--</div>
                </div>
            </div>

            <div class="about-path-box">
                <div class="about-path-label">
                    <span><i class="fa-solid fa-folder me-1 text-warning"></i> Thư mục Dữ liệu Người dùng (User Data Directory):</span>
                    <button type="button" class="btn-storage-action" id="btnTogglePortable" style="padding: 2px 8px; font-size: 11px;">
                        <i class="fa-solid fa-arrow-right-arrow-left me-1"></i> Đổi chế độ Portable
                    </button>
                </div>
                <div class="about-path-value" id="aboutUserDataDir">Đang tải...</div>
            </div>

            <div class="update-status-card" id="aboutUpdateCard">
                <div class="d-flex align-items-center justify-content-between">
                    <div>
                        <strong id="aboutUpdateStatusTitle"><i class="fa-solid fa-cloud-arrow-down me-2 text-info"></i>Trạng thái cập nhật phần mềm</strong>
                        <div class="small text-muted mt-1" id="aboutUpdateStatusSub">Nhấn nút bên cạnh để kiểm tra phiên bản mới nhất từ máy chủ phát hành.</div>
                    </div>
                    <button type="button" class="btn-storage-action" id="aboutBtnCheckInline">
                        <i class="fa-solid fa-rotate me-1"></i> Kiểm tra Cập nhật...
                    </button>
                </div>
                <div id="aboutUpdateDetails" class="d-none mt-2"></div>
            </div>
        `;

        let _isPortableNow = false;

        async function refreshAboutInfo() {
            try {
                let info = null;
                if (window.pywebview?.api?.get_app_version) {
                    const res = await window.pywebview.api.get_app_version();
                    if (res && res.success) info = res.data;
                }
                if (!info) {
                    info = {
                        appName: 'luoBTool IDE',
                        version: '1.0.0',
                        isPortable: false,
                        pythonVersion: '3.x',
                        platform: 'Windows',
                        userDataDir: '%APPDATA%\\LLTool'
                    };
                }

                _isPortableNow = Boolean(info.isPortable);

                const appNameEl = wrap.querySelector('#aboutAppName');
                const badgeModeEl = wrap.querySelector('#aboutBadgeMode');
                const verEl = wrap.querySelector('#aboutMetricVersion');
                const modeEl = wrap.querySelector('#aboutMetricMode');
                const pyEl = wrap.querySelector('#aboutMetricPython');
                const platEl = wrap.querySelector('#aboutMetricPlatform');
                const dataDirEl = wrap.querySelector('#aboutUserDataDir');

                if (appNameEl) appNameEl.textContent = info.appTitle || info.appName || 'luoBTool IDE';
                if (verEl) verEl.textContent = `v${info.version || '1.0.0'}`;
                if (modeEl) modeEl.textContent = _isPortableNow ? 'Portable (USB)' : 'Standard (%APPDATA%)';
                if (pyEl) pyEl.textContent = `Python ${info.pythonVersion || '3.x'}`;
                if (platEl) platEl.textContent = `${info.platform || 'Windows'}`;
                if (dataDirEl) dataDirEl.textContent = info.userDataDir || '--';

                if (badgeModeEl) {
                    if (_isPortableNow) {
                        badgeModeEl.className = 'about-badge-pill about-badge-portable';
                        badgeModeEl.innerHTML = '<i class="fa-solid fa-box-archive me-1"></i> Chế độ Portable';
                    } else {
                        badgeModeEl.className = 'about-badge-pill about-badge-installed';
                        badgeModeEl.innerHTML = '<i class="fa-solid fa-laptop me-1"></i> Cài đặt chuẩn';
                    }
                }
            } catch (err) {
                console.warn('[Settings] Failed to refresh about info:', err);
            }
        }

        setTimeout(() => {
            refreshAboutInfo();

            const btnCheck = wrap.querySelector('#aboutBtnCheckInline');
            const btnToggle = wrap.querySelector('#btnTogglePortable');
            const detailsEl = wrap.querySelector('#aboutUpdateDetails');
            const statusCard = wrap.querySelector('#aboutUpdateCard');
            const titleEl = wrap.querySelector('#aboutUpdateStatusTitle');
            const subEl = wrap.querySelector('#aboutUpdateStatusSub');

            if (btnToggle) {
                btnToggle.onclick = () => {
                    const nextMode = !_isPortableNow;
                    const promptMsg = nextMode
                        ? 'Bạn có muốn BẬT chế độ Portable không?\n\nỨng dụng sẽ tạo cờ portable.flag bên cạnh file thực thi và lưu toàn bộ cấu hình vào thư mục data/ của ứng dụng. Rất thích hợp khi chạy từ USB!'
                        : 'Bạn có muốn TẮT chế độ Portable không?\n\nCờ portable.flag sẽ bị xóa và ứng dụng sẽ lưu cấu hình người dùng vào %APPDATA%\\LLTool.';

                    showPopupConfirm('Chuyển đổi chế độ Portable', promptMsg, async () => {
                        try {
                            btnToggle.disabled = true;
                            if (window.pywebview?.api?.set_portable_mode) {
                                const res = await window.pywebview.api.set_portable_mode(nextMode);
                                if (res && res.success) {
                                    await refreshAboutInfo();
                                    showPopupAlert(
                                        'Thành công',
                                        `✓ Đã ${nextMode ? 'bật' : 'tắt'} Chế độ Portable thành công!`,
                                        'success'
                                    );
                                } else {
                                    showPopupAlert('Lỗi', res?.error || 'Không thể đổi chế độ Portable.', 'error');
                                }
                            }
                        } catch (e) {
                            showPopupAlert('Lỗi', 'Lỗi khi đổi chế độ Portable: ' + e.message, 'error');
                        } finally {
                            btnToggle.disabled = false;
                        }
                    });
                };
            }

            if (btnCheck) {
                btnCheck.onclick = async () => {
                    btnCheck.disabled = true;
                    btnCheck.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang kiểm tra...';
                    if (subEl) subEl.textContent = 'Đang kết nối tới máy chủ kiểm tra phiên bản mới...';

                    try {
                        let res = null;
                        const targetObj = _draftSettings || _settings || DEFAULT_SETTINGS;
                        const customUrl = targetObj?.updates?.updateUrl || null;

                        if (window.pywebview?.api?.check_for_updates) {
                            const apiRes = await window.pywebview.api.check_for_updates(true, customUrl);
                            if (apiRes && apiRes.success) res = apiRes.data;
                            else if (apiRes && apiRes.data) res = apiRes.data;
                            else throw new Error(apiRes?.error || 'Lỗi không xác định khi kiểm tra');
                        } else {
                            const resp = await fetch('/api/settings/check_updates', { method: 'POST' });
                            const apiRes = await resp.json();
                            res = apiRes?.data;
                        }

                        if (res) {
                            if (res.hasUpdate) {
                                statusCard.className = 'update-status-card has-update';
                                titleEl.innerHTML = `<i class="fa-solid fa-circle-arrow-up text-success me-2"></i><strong>Đã có phiên bản mới: v${res.latestVersion}!</strong>`;
                                subEl.textContent = `Phiên bản hiện tại của bạn là v${res.currentVersion}. Bản phát hành ngày: ${res.releaseDate || 'Gần đây'}.`;

                                let highlightsList = '';
                                if (Array.isArray(res.highlights) && res.highlights.length > 0) {
                                    highlightsList = `<ul class="update-changelog-list">${res.highlights.map(h => `<li>${h}</li>`).join('')}</ul>`;
                                } else if (res.releaseNotes) {
                                    highlightsList = `<div class="small mt-1 text-muted">${res.releaseNotes}</div>`;
                                }

                                detailsEl.className = 'mt-2 pt-2 border-top';
                                detailsEl.innerHTML = `
                                    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                                        <div>
                                            <span class="badge bg-success me-1">Khuyên dùng</span>
                                            <span class="small fw-semibold">Những cải tiến mới:</span>
                                        </div>
                                        <button type="button" class="btn btn-sm btn-primary" id="btnDownloadUpdate">
                                            <i class="fa-solid fa-download me-1"></i> Tải bản mới (Download)
                                        </button>
                                    </div>
                                    ${highlightsList}
                                `;

                                const btnDownload = detailsEl.querySelector('#btnDownloadUpdate');
                                if (btnDownload) {
                                    btnDownload.onclick = () => {
                                        if (window.pywebview?.api?.open_external_url && res.downloadUrl) {
                                            window.pywebview.api.open_external_url(res.downloadUrl);
                                        } else if (res.downloadUrl) {
                                            window.open(res.downloadUrl, '_blank');
                                        }
                                    };
                                }
                            } else if (res.success) {
                                statusCard.className = 'update-status-card up-to-date';
                                titleEl.innerHTML = `<i class="fa-solid fa-circle-check text-success me-2"></i><strong>Bạn đang dùng phiên bản mới nhất (v${res.currentVersion})</strong>`;
                                subEl.textContent = `Hệ thống đã kiểm tra lúc ${new Date().toLocaleTimeString()} và không tìm thấy bản cập nhật nào mới hơn.`;
                                detailsEl.className = 'd-none';
                            } else {
                                statusCard.className = 'update-status-card';
                                titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-warning me-2"></i><strong>Không thể kiểm tra cập nhật</strong>`;
                                subEl.textContent = res.error || 'Vui lòng kiểm tra lại kết nối mạng hoặc proxy.';
                                detailsEl.className = 'd-none';
                            }
                        }
                    } catch (err) {
                        statusCard.className = 'update-status-card';
                        titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-warning me-2"></i><strong>Lỗi khi kiểm tra</strong>`;
                        subEl.textContent = err.message || String(err);
                        detailsEl.className = 'd-none';
                    } finally {
                        btnCheck.disabled = false;
                        btnCheck.innerHTML = '<i class="fa-solid fa-rotate me-1"></i> Kiểm tra Cập nhật...';
                    }
                };
            }
        }, 50);

        return wrap;
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
        // Type 0: Custom component
        if (field.type === 'custom' && typeof field.render === 'function') {
            return field.render(catKey, field, currentVal);
        }

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
                let valToSet = select.value;
                if (field.valueType === 'number' || (field.options && field.options.length > 0 && typeof field.options[0].value === 'number')) {
                    valToSet = Number(valToSet);
                }
                setDraftValue(catKey, field, valToSet);
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
        try {
            await loadSettingsData();
        } catch (err) {
            console.error('[Settings] Error loading settings for modal:', err);
        } finally {
            renderSidebar();
            renderContent();
            updateRawJsonEditor();
        }

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
        if (!_settings.history) _settings.history = { ...DEFAULT_SETTINGS.history };
        if (!_settings.updates) _settings.updates = { ...DEFAULT_SETTINGS.updates };

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

        const queryLimitEl = document.getElementById('ide-query-limit');
        if (queryLimitEl) {
            queryLimitEl.addEventListener('change', () => {
                const val = parseInt(queryLimitEl.value, 10);
                if (!isNaN(val)) {
                    window._sqlConfig = window._sqlConfig || {};
                    window._sqlConfig.maxRows = val;
                }
            });
        }

        // 7. Auto-load on page ready
        setTimeout(async () => {
            try {
                await loadSettingsData();
                if (_settings) {
                    applyAllSettings(_settings);
                }
            } catch (err) {
                console.error('[Settings] Error loading settings data:', err);
                if (!_settings) _settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
                if (!_draftSettings) _draftSettings = JSON.parse(JSON.stringify(_settings));
            } finally {
                if (isStandaloneWindow) {
                    renderSidebar();
                    renderContent();
                    updateRawJsonEditor();
                }
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
