/**
 * AppStorage - Native IPC Bridge for persistent configurations.
 * Communicates with Python via window.pywebview.api to read/write:
 * - data/settings.json (IDE settings, theme, fonts, addons)
 * - data/connections.json (Database connection profiles)
 * 
 * Strict Rule: NEVER use localStorage for connection strings or themes!
 */
(function (global) {
    'use strict';

    let _cachedApi = null;
    async function ensureApi() {
        if (_cachedApi) return _cachedApi;
        if (window.pywebview && window.pywebview.api) {
            _cachedApi = window.pywebview.api;
            return _cachedApi;
        }
        if (typeof window.waitForPywebview === 'function') {
            const api = await window.waitForPywebview();
            if (api) {
                _cachedApi = api;
                return _cachedApi;
            }
        }
        if (window.pywebview && window.pywebview.api) {
            _cachedApi = window.pywebview.api;
            return _cachedApi;
        }
        return null;
    }

    window.addEventListener('pywebviewready', () => {
        if (window.pywebview && window.pywebview.api) {
            _cachedApi = window.pywebview.api;
        }
    });

    const AppStorage = {
        async getSettings() {
            try {
                const api = await ensureApi();
                if (api && typeof api.get_settings === 'function') {
                    const res = await api.get_settings();
                    if (res && res.success) return res.settings || {};
                }
            } catch (e) {
                console.warn('[AppStorage] getSettings error:', e);
            }
            return {
                editor: { fontFamily: "Consolas", fontSize: 14, tabSize: 4 },
                appearance: { theme: "dark" },
                addons: { bravo_tool: { enabled: true } }
            };
        },

        async getSystemFonts() {
            if (global._cachedSystemFonts) return global._cachedSystemFonts;
            try {
                const api = await ensureApi();
                if (api && typeof api.get_system_fonts === 'function') {
                    const res = await api.get_system_fonts();
                    if (res && res.success && res.data) {
                        global._cachedSystemFonts = res.data;
                        return res.data;
                    }
                }
                const resp = await fetch('/api/system/fonts');
                if (resp && resp.ok) {
                    const json = await resp.json();
                    if (json.success && json.data) {
                        global._cachedSystemFonts = json.data;
                        return json.data;
                    }
                }
            } catch (e) {
                console.warn('[AppStorage] getSystemFonts error:', e);
            }
            return null;
        },

        async saveSettings(settings) {
            try {
                const api = await ensureApi();
                if (api && typeof api.save_settings === 'function') {
                    const res = await api.save_settings(settings);
                    return res && res.success;
                }
                // Fallback for Web/browser mode without pywebview native API:
                try {
                    localStorage.setItem('ide-settings', JSON.stringify(settings));
                    const theme = settings.theme || settings.appearance?.theme || 'dark';
                    localStorage.setItem('ide-theme', theme);
                    return true;
                } catch (_) {
                    return false;
                }
            } catch (e) {
                console.error('[AppStorage] saveSettings error:', e);
            }
            return false;
        },

        async getTheme() {
            const settings = await this.getSettings();
            return settings?.theme || settings?.appearance?.theme || 'dark';
        },

        async setTheme(themeName) {
            const settings = await this.getSettings();
            settings.theme = themeName;
            if (!settings.appearance) settings.appearance = {};
            settings.appearance.theme = themeName;
            return await this.saveSettings(settings);
        },

        async getSavedConnections() {
            try {
                const api = await ensureApi();
                if (api && typeof api.get_saved_connections === 'function') {
                    const res = await api.get_saved_connections();
                    if (res && res.success && Array.isArray(res.connections) && res.connections.length > 0) {
                        try { localStorage.setItem('ide_saved_connections', JSON.stringify(res.connections)); } catch (_) {}
                        return res.connections;
                    }
                }
            } catch (e) {
                console.warn('[AppStorage] getSavedConnections error:', e);
            }
            // Secondary Native IPC fallback via list_connections
            try {
                const api = await ensureApi();
                if (api && typeof api.list_connections === 'function') {
                    const res = await api.list_connections();
                    if (res && res.success && Array.isArray(res.saved_connections) && res.saved_connections.length > 0) {
                        try { localStorage.setItem('ide_saved_connections', JSON.stringify(res.saved_connections)); } catch (_) {}
                        return res.saved_connections;
                    }
                }
            } catch (_) {}
            // HTTP fetch fallback
            try {
                const res = await fetch('/api/connections');
                if (res && res.ok) {
                    const data = await res.json();
                    const list = (data && Array.isArray(data.saved_connections) && data.saved_connections.length > 0)
                        ? data.saved_connections
                        : ((data && Array.isArray(data.connections) && data.connections.length > 0) ? data.connections : null);
                    if (list) {
                        try { localStorage.setItem('ide_saved_connections', JSON.stringify(list)); } catch (_) {}
                        return list;
                    }
                }
            } catch (_) {}
            // Fallback to cached localStorage
            try {
                const raw = localStorage.getItem('ide_saved_connections');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
                }
            } catch (_) {}
            return [];
        },

        async getConnectionPassword(idOrName) {
            try {
                const api = await ensureApi();
                if (api && typeof api.get_connection_password === 'function') {
                    const res = await api.get_connection_password(idOrName);
                    if (res && res.success) return res.password || "";
                }
            } catch (e) {
                console.warn('[AppStorage] getConnectionPassword error:', e);
            }
            return "";
        },

        async saveConnectionProfile(profile) {
            try {
                const api = await ensureApi();
                if (api && typeof api.save_connection_profile === 'function') {
                    const res = await api.save_connection_profile(profile);
                    if (res && res.success) return res.connection || profile;
                }
            } catch (e) {
                console.error('[AppStorage] saveConnectionProfile error:', e);
            }
            return null;
        },

        async deleteSavedConnection(profileId) {
            try {
                const api = await ensureApi();
                if (api && typeof api.delete_saved_connection_profile === 'function') {
                    const res = await api.delete_saved_connection_profile(profileId);
                    return res && res.success;
                }
            } catch (e) {
                console.error('[AppStorage] deleteSavedConnection error:', e);
            }
            return false;
        },

        // ── Snippets Storage API ──────────────────────────────────────────────
        async getSnippets() {
            try {
                const api = await ensureApi();
                if (api && typeof api.get_snippets === 'function') {
                    const res = await api.get_snippets();
                    if (res && res.success && Array.isArray(res.snippets)) {
                        return res.snippets;
                    }
                }
            } catch (e) {
                console.warn('[AppStorage] getSnippets native error:', e);
            }
            // Fallback: fetch from /static/data/snippets.json or localStorage
            try {
                const res = await fetch('../static/data/snippets.json');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data)) return data;
                }
            } catch (_) {}
            try {
                const local = localStorage.getItem('ide-snippets');
                if (local) return JSON.parse(local);
            } catch (_) {}
            return [];
        },

        async saveSnippets(snippets) {
            try {
                const api = await ensureApi();
                if (api && typeof api.save_snippets === 'function') {
                    const res = await api.save_snippets(snippets);
                    return Boolean(res && res.success);
                }
            } catch (e) {
                console.warn('[AppStorage] saveSnippets native error:', e);
            }
            try {
                localStorage.setItem('ide-snippets', JSON.stringify(snippets));
                return true;
            } catch (_) {
                return false;
            }
        },

        async resetSnippets() {
            try {
                const api = await ensureApi();
                if (api && typeof api.reset_snippets === 'function') {
                    const res = await api.reset_snippets();
                    if (res && res.success && Array.isArray(res.snippets)) return res.snippets;
                }
            } catch (e) {
                console.warn('[AppStorage] resetSnippets native error:', e);
            }
            return await this.getSnippets();
        },

        async getCodeStyles() {
            try {
                const api = await ensureApi();
                if (api && typeof api.get_code_styles === 'function') {
                    const res = await api.get_code_styles();
                    if (res && res.success) return res;
                }
                const resp = await fetch('/api/styles');
                if (resp && resp.ok) {
                    const data = await resp.json();
                    if (data && data.success) return data;
                }
            } catch (e) {
                console.warn('[AppStorage] getCodeStyles error:', e);
            }
            try {
                const local = localStorage.getItem('ide-code-styles');
                if (local) return JSON.parse(local);
            } catch (_) {}
            return null;
        },

        async saveCodeStyles(stylesData) {
            try {
                const api = await ensureApi();
                if (api && typeof api.save_code_styles === 'function') {
                    const res = await api.save_code_styles(stylesData);
                    if (res && res.success) return true;
                }
                const resp = await fetch('/api/styles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(stylesData)
                });
                if (resp && resp.ok) {
                    const json = await resp.json();
                    if (json && json.success) return true;
                }
            } catch (e) {
                console.warn('[AppStorage] saveCodeStyles error:', e);
            }
            try {
                localStorage.setItem('ide-code-styles', JSON.stringify(stylesData));
                return true;
            } catch (_) {
                return false;
            }
        },

        async resetCodeStyles() {
            try {
                const api = await ensureApi();
                if (api && typeof api.reset_code_styles === 'function') {
                    const res = await api.reset_code_styles();
                    if (res && res.success) return res;
                }
                const resp = await fetch('/api/styles/reset', { method: 'POST' });
                if (resp && resp.ok) {
                    const json = await resp.json();
                    if (json && json.success) return json;
                }
            } catch (e) {
                console.warn('[AppStorage] resetCodeStyles error:', e);
            }
            return await this.getCodeStyles();
        }
    };

    global.AppStorage = AppStorage;
})(window);
