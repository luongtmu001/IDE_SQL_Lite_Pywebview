// Theme Manager — centralized theme control
// Usage: window.ThemeManager.toggle() / setTheme('dark') / getCurrentTheme()

(function () {
    const STORAGE_KEY = 'ide-theme';
    const DARK_CM_THEME = 'darcula';
    const LIGHT_CM_THEME = 'default';

    function getSystemTheme() {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    function getEffectiveTheme() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved === 'light' || saved === 'dark') return saved;
        } catch (_) {}
        return getSystemTheme();
    }

    function applyTheme(name, persist = true) {
        const html = document.documentElement;
        html.setAttribute('data-bs-theme', name);

        // Sync CodeMirror if initialized
        if (window.AppEditor && typeof window.AppEditor.setOption === 'function') {
            window.AppEditor.setOption('theme', name === 'dark' ? DARK_CM_THEME : LIGHT_CM_THEME);
        }
        if (window.AppEditor2 && typeof window.AppEditor2.setOption === 'function') {
            window.AppEditor2.setOption('theme', name === 'dark' ? DARK_CM_THEME : LIGHT_CM_THEME);
        }

        // Update toolbar icon
        const icon = document.querySelector('#ide-theme-btn i');
        if (icon) {
            icon.className = name === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }

        // Persist only if explicitly requested (e.g. user toggle)
        if (persist) {
            try { localStorage.setItem(STORAGE_KEY, name); } catch (_) {}
        }

        // Fire custom event so other components can react
        document.dispatchEvent(new CustomEvent('ide-theme-changed', { detail: { theme: name } }));
    }

    function toggle() {
        applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark', true);
    }

    function setTheme(name) {
        if (name === 'dark' || name === 'light') applyTheme(name, true);
    }

    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-bs-theme') === 'light' ? 'light' : 'dark';
    }

    // Default to OS theme immediately if no saved preference
    const initialTheme = getEffectiveTheme();
    document.documentElement.setAttribute('data-bs-theme', initialTheme);

    // Listen for OS theme changes
    if (window.matchMedia) {
        const osDark = window.matchMedia('(prefers-color-scheme: dark)');
        osDark.addEventListener('change', e => {
            // Only auto-switch if user hasn't explicitly set a preference
            try {
                if (localStorage.getItem(STORAGE_KEY)) return;
            } catch (_) {}
            applyTheme(e.matches ? 'dark' : 'light', false);
        });
    }

    window.ThemeManager = { toggle, setTheme, getCurrentTheme, applyTheme, getEffectiveTheme, getSystemTheme };
})();
