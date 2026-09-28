/**
 * Typography Manager — Centralized UI Typography Control & Persistent Profile
 * Complies with .SKILL/global_ide_ui_typography_skill.md:
 * - Controls IDE UI Font Family & UI Font Size independently from Editor.
 * - Zero-Reload runtime cascade update via CSS variables.
 * - Non-breaking: preserves 100% of existing IDE layout geometry and containers.
 * - Persists typography settings into data/settings.json profile.
 */

(function (global) {
    'use strict';

    const STORAGE_KEY_FONT_FAMILY = 'ide-ui-font-family';
    const STORAGE_KEY_FONT_SIZE = 'ide-ui-font-size';

    const DEFAULT_TYPOGRAPHY = {
        uiFontFamily: 'Segoe UI',
        uiFontSize: 13
    };

    const FONT_FAMILY_FALLBACKS = {
        'Segoe UI': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        'Inter': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
        'Arial': "Arial, 'Helvetica Neue', Helvetica, sans-serif",
        'Roboto': "'Roboto', 'Segoe UI', Arial, sans-serif",
        'Tahoma': "Tahoma, Verdana, 'Segoe UI', sans-serif",
        'System UI': "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    };

    let _currentTypography = { ...DEFAULT_TYPOGRAPHY };

    function resolveFontFamilyStack(fontName) {
        if (!fontName) return FONT_FAMILY_FALLBACKS['Segoe UI'];
        if (FONT_FAMILY_FALLBACKS[fontName]) {
            return FONT_FAMILY_FALLBACKS[fontName];
        }
        return `"${fontName}", ${FONT_FAMILY_FALLBACKS['Segoe UI']}`;
    }

    const TypographyManager = {
        init() {
            // 1. Fast synchronous restore from localStorage to eliminate FOUC / font jump
            try {
                const cachedFamily = localStorage.getItem(STORAGE_KEY_FONT_FAMILY);
                const cachedSize = parseInt(localStorage.getItem(STORAGE_KEY_FONT_SIZE), 10);
                if (cachedFamily || (!isNaN(cachedSize) && cachedSize >= 10 && cachedSize <= 24)) {
                    this.apply({
                        uiFontFamily: cachedFamily || DEFAULT_TYPOGRAPHY.uiFontFamily,
                        uiFontSize: (!isNaN(cachedSize) && cachedSize >= 10 && cachedSize <= 24) ? cachedSize : DEFAULT_TYPOGRAPHY.uiFontSize
                    }, false);
                }
            } catch (_) {}

            // 2. Asynchronously verify and sync with persistent settings profile in data/settings.json
            if (global.AppStorage && typeof global.AppStorage.getSettings === 'function') {
                global.AppStorage.getSettings().then(settings => {
                    if (settings && settings.appearance) {
                        const app = settings.appearance;
                        const family = app.uiFontFamily || app.fontFamily || DEFAULT_TYPOGRAPHY.uiFontFamily;
                        const size = parseInt(app.uiFontSize || app.fontSize, 10) || DEFAULT_TYPOGRAPHY.uiFontSize;
                        this.apply({ uiFontFamily: family, uiFontSize: size }, false);
                    }
                }).catch(err => {
                    console.warn('[TypographyManager] Failed to load settings profile:', err);
                });
            }
        },

        apply(config, persist = false) {
            if (!config) return;

            const family = config.uiFontFamily || config.fontFamily || _currentTypography.uiFontFamily || DEFAULT_TYPOGRAPHY.uiFontFamily;
            let size = parseInt(config.uiFontSize !== undefined ? config.uiFontSize : config.fontSize, 10);
            if (isNaN(size) || size < 10 || size > 24) {
                size = _currentTypography.uiFontSize || DEFAULT_TYPOGRAPHY.uiFontSize;
            }

            _currentTypography = {
                uiFontFamily: family,
                uiFontSize: size
            };

            // 1. Update CSS variables at :root (Zero-Reload runtime cascade without touching editor)
            const root = document.documentElement;
            const fontStack = resolveFontFamilyStack(family);
            root.style.setProperty('--ide-ui-font-family', fontStack);
            root.style.setProperty('--ide-ui-font-size', `${size}px`);
            root.style.setProperty('--ide-ui-line-height', '1.45');
            root.style.setProperty('--bs-body-font-family', fontStack);
            root.style.setProperty('--bs-body-font-size', `${size}px`);

            // 2. Cache in localStorage for immediate restore on reload
            try {
                localStorage.setItem(STORAGE_KEY_FONT_FAMILY, family);
                localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(size));
            } catch (_) {}

            // 3. Dispatch event for reactive components
            const evt = new CustomEvent('ide-typography-changed', {
                detail: { uiFontFamily: family, uiFontSize: size, fontStack }
            });
            document.dispatchEvent(evt);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(evt);
            }

            // 4. Persist to data/settings.json profile if requested
            if (persist && global.AppStorage && typeof global.AppStorage.getSettings === 'function') {
                global.AppStorage.getSettings().then(settings => {
                    const next = settings || {};
                    if (!next.appearance) next.appearance = {};
                    next.appearance.uiFontFamily = family;
                    next.appearance.uiFontSize = size;
                    return global.AppStorage.saveSettings(next);
                }).then(ok => {
                    if (ok) {
                        console.log('[TypographyManager] Typography profile persisted to settings.json');
                    }
                }).catch(err => {
                    console.error('[TypographyManager] Failed to persist typography profile:', err);
                });
            }
        },

        getTypography() {
            return { ..._currentTypography };
        },

        getSupportedFonts() {
            return Object.keys(FONT_FAMILY_FALLBACKS);
        },

        getDefaults() {
            return { ...DEFAULT_TYPOGRAPHY };
        },

        async saveProfile(family, size) {
            const fam = family || _currentTypography.uiFontFamily || DEFAULT_TYPOGRAPHY.uiFontFamily;
            let sz = parseInt(size !== undefined ? size : _currentTypography.uiFontSize, 10);
            if (isNaN(sz) || sz < 10 || sz > 24) sz = DEFAULT_TYPOGRAPHY.uiFontSize;

            this.apply({ uiFontFamily: fam, uiFontSize: sz }, true);
        },

        resetToDefault(persist = false) {
            this.apply({ ...DEFAULT_TYPOGRAPHY }, persist);
        }
    };

    global.TypographyManager = TypographyManager;

    // Cross-window sync via storage event
    if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_KEY_FONT_FAMILY || e.key === STORAGE_KEY_FONT_SIZE) {
                const cachedFam = localStorage.getItem(STORAGE_KEY_FONT_FAMILY) || DEFAULT_TYPOGRAPHY.uiFontFamily;
                const cachedSz = parseInt(localStorage.getItem(STORAGE_KEY_FONT_SIZE), 10) || DEFAULT_TYPOGRAPHY.uiFontSize;
                TypographyManager.apply({ uiFontFamily: cachedFam, uiFontSize: cachedSz }, false);
            }
        });
    }

    // Run initialization as early as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => TypographyManager.init());
    } else {
        TypographyManager.init();
    }

})(typeof window !== 'undefined' ? window : this);
