// Theme Manager — Centralized Theme Control & Persistent Profile
// Usage: window.ThemeManager.toggle() / setTheme('win-xp') / getCurrentTheme()

(function () {
    'use strict';

    const STORAGE_KEY = 'ide-theme';
    const DARK_CM_THEME = 'darcula';
    const LIGHT_CM_THEME = 'default';
    let _isSavingTheme = false;

    function getSystemTheme() {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    function getEffectiveTheme() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return saved;
        } catch (_) {}
        return getSystemTheme();
    }

    function applyTheme(name, persist = true) {
        if (!name) return;
        const html = document.documentElement;
        html.setAttribute('data-bs-theme', name);

        // Immediate synchronous cache in localStorage
        try {
            localStorage.setItem(STORAGE_KEY, name);
        } catch (_) {}

        const themeObj = (window.ThemeRegistry && typeof window.ThemeRegistry.getThemeById === 'function')
            ? window.ThemeRegistry.getThemeById(name)
            : null;
        const isDark = themeObj ? Boolean(themeObj.isDark) : (name !== 'light' && name !== 'win-nt' && name !== 'win-xp' && !name.toLowerCase().includes('light'));

        // Sync Monaco Editor theme
        if (typeof monaco !== 'undefined' && monaco.editor && window.MonacoInit) {
            const monacoTheme = window.MonacoInit.getMonacoTheme(name);
            monaco.editor.setTheme(monacoTheme);
        }
        if (window.AppEditor && typeof window.AppEditor.setOption === 'function') {
            window.AppEditor.setOption('theme', name);
        }
        if (window.AppEditor2 && typeof window.AppEditor2.setOption === 'function') {
            window.AppEditor2.setOption('theme', name);
        }

        // Update toolbar icon
        const icon = document.querySelector('#ide-theme-btn i');
        if (icon) {
            icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }

        // Fire custom event so other components can react
        const eventDetail = { detail: { theme: name }, bubbles: true, composed: true };
        document.dispatchEvent(new CustomEvent('ide-theme-changed', eventDetail));
        window.dispatchEvent(new CustomEvent('ide-theme-changed', eventDetail));

        // Sync Native Windows Titlebar via DWM (Windows 10 / Windows 11)
        syncNativeTitlebar(name, isDark);

        // Persist to file settings.json via AppStorage ONLY if explicitly requested AND not currently in a save cycle
        if (persist && !_isSavingTheme && window.AppStorage && typeof window.AppStorage.setTheme === 'function') {
            _isSavingTheme = true;
            window.AppStorage.setTheme(name)
                .catch(err => console.warn('[ThemeManager] Failed to persist theme:', err))
                .finally(() => {
                    setTimeout(() => { _isSavingTheme = false; }, 250);
                });
        }
    }

    function syncNativeTitlebar(name, isDark) {
        try {
            if (!window.pywebview || !window.pywebview.api) return;
            const themeObj = (window.ThemeRegistry && typeof window.ThemeRegistry.getThemeById === 'function')
                ? window.ThemeRegistry.getThemeById(name)
                : null;

            let bg = themeObj ? themeObj.titlebarBg : null;
            let text = themeObj ? themeObj.titlebarText : null;
            let border = themeObj ? themeObj.border : null;

            if (!bg) {
                const computed = getComputedStyle(document.documentElement);
                bg = (computed.getPropertyValue('--ide-titlebar-bg') || '').trim()
                  || (computed.getPropertyValue('--ide-bg-toolbar') || '').trim()
                  || (computed.getPropertyValue('--ide-bg-main') || '').trim();
                text = (computed.getPropertyValue('--ide-titlebar-text') || '').trim()
                   || (computed.getPropertyValue('--ide-text-active') || '').trim()
                   || (computed.getPropertyValue('--ide-text-main') || '').trim();
                border = (computed.getPropertyValue('--ide-border') || '').trim();
            }

            if (typeof window.pywebview.api.apply_titlebar_theme === 'function') {
                window.pywebview.api.apply_titlebar_theme(bg || name, text, border, isDark);
            }
        } catch (e) {
            console.debug('[ThemeManager] syncNativeTitlebar skipped:', e);
        }
    }

    function toggle() {
        const cur = getCurrentTheme();
        const next = (cur === 'dark') ? 'light' : 'dark';
        applyTheme(next, true);
    }

    function setTheme(name) {
        if (name) applyTheme(name, true);
    }

    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-bs-theme') || 'dark';
    }

    // 1. Synchronously set attribute immediately from localStorage / OS
    const initialTheme = getEffectiveTheme();
    document.documentElement.setAttribute('data-bs-theme', initialTheme);

    // 2. Asynchronously verify against settings.json as soon as IPC ready
    async function syncFromSettingsFile() {
        if (window.AppStorage && typeof window.AppStorage.getTheme === 'function') {
            try {
                const savedInFile = await window.AppStorage.getTheme();
                if (savedInFile && savedInFile !== document.documentElement.getAttribute('data-bs-theme')) {
                    applyTheme(savedInFile, false); // Always false on initial sync to avoid saving loop
                    return;
                }
            } catch (_) {}
        }
        // Ensure titlebar is synced on ready even if theme didn't change from settings.json
        const cur = getCurrentTheme();
        const themeObj = (window.ThemeRegistry && typeof window.ThemeRegistry.getThemeById === 'function')
            ? window.ThemeRegistry.getThemeById(cur)
            : null;
        const isDark = themeObj ? themeObj.isDark : (cur !== 'light' && cur !== 'win-nt' && cur !== 'win-xp');
        syncNativeTitlebar(cur, isDark);
        setTimeout(() => {
            syncNativeTitlebar(cur, isDark);
        }, 300);
        setTimeout(() => {
            syncNativeTitlebar(cur, isDark);
        }, 800);
    }

    if (window.pywebview && window.pywebview.api) {
        syncFromSettingsFile();
    } else {
        window.addEventListener('pywebviewready', syncFromSettingsFile);
    }

    // 3. Listen for OS theme changes (only if no explicit preference saved)
    if (window.matchMedia) {
        const osDark = window.matchMedia('(prefers-color-scheme: dark)');
        osDark.addEventListener('change', e => {
            try {
                if (localStorage.getItem(STORAGE_KEY)) return;
            } catch (_) {}
            applyTheme(e.matches ? 'dark' : 'light', false);
        });
    }

    // 4. Cross-window real-time synchronization via storage event
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY && e.newValue) {
            applyTheme(e.newValue, false);
        }
    });

    // Expose global API
    window.ThemeManager = {
        applyTheme,
        setTheme,
        toggle,
        getCurrentTheme
    };
})();
