/**
 * AppSession - Session State Manager (Zero-Network).
 * Strictly handles short-term session state in localStorage:
 * - Active tab ID
 * - Open tabs list and unsaved drafts
 * - Sidebar expanded/collapsed state & width
 * - Results panel height
 * - Default connection context for new tabs
 * 
 * Strict Rule: NEVER store connection credentials or themes in localStorage!
 */
(function (global) {
    'use strict';

    const KEYS = {
        ACTIVE_TAB: 'ide_active_tab',
        OPEN_TABS: 'ide_open_tabs',
        TAB_DRAFTS: 'ide_tab_drafts_',
        SIDEBAR_WIDTH: 'ide_sidebar_width',
        SIDEBAR_COLLAPSED: 'ide_sidebar_collapsed',
        RESULTS_HEIGHT: 'ide_results_height',
        DEFAULT_CONTEXT: 'ide_default_connection_context'
    };

    const AppSession = {
        getActiveTabId() {
            try { return localStorage.getItem(KEYS.ACTIVE_TAB); } catch (_) { return null; }
        },
        setActiveTabId(tabId) {
            try { localStorage.setItem(KEYS.ACTIVE_TAB, tabId || ''); } catch (_) {}
        },

        getTabDraft(tabId) {
            try { return localStorage.getItem(KEYS.TAB_DRAFTS + tabId) || ''; } catch (_) { return ''; }
        },
        setTabDraft(tabId, code) {
            try {
                if (code) {
                    localStorage.setItem(KEYS.TAB_DRAFTS + tabId, code);
                } else {
                    localStorage.removeItem(KEYS.TAB_DRAFTS + tabId);
                }
            } catch (_) {}
        },
        clearTabDraft(tabId) {
            try { localStorage.removeItem(KEYS.TAB_DRAFTS + tabId); } catch (_) {}
        },

        getSidebarWidth(defaultWidth = 260) {
            try {
                const w = parseInt(localStorage.getItem(KEYS.SIDEBAR_WIDTH), 10);
                return (!isNaN(w) && w >= 150 && w <= 800) ? w : defaultWidth;
            } catch (_) {
                return defaultWidth;
            }
        },
        setSidebarWidth(width) {
            try { localStorage.setItem(KEYS.SIDEBAR_WIDTH, String(width)); } catch (_) {}
        },

        isSidebarCollapsed() {
            try { return localStorage.getItem(KEYS.SIDEBAR_COLLAPSED) === 'true'; } catch (_) { return false; }
        },
        setSidebarCollapsed(collapsed) {
            try { localStorage.setItem(KEYS.SIDEBAR_COLLAPSED, String(collapsed)); } catch (_) {}
        },

        getResultsHeight(defaultHeight = 280) {
            try {
                const h = parseInt(localStorage.getItem(KEYS.RESULTS_HEIGHT), 10);
                return (!isNaN(h) && h >= 80) ? h : defaultHeight;
            } catch (_) {
                return defaultHeight;
            }
        },
        setResultsHeight(height) {
            try { localStorage.setItem(KEYS.RESULTS_HEIGHT, String(height)); } catch (_) {}
        },

        getDefaultConnectionContext() {
            try {
                const raw = localStorage.getItem(KEYS.DEFAULT_CONTEXT);
                return raw ? JSON.parse(raw) : {};
            } catch (_) {
                return {};
            }
        },
        setDefaultConnectionContext(ctx) {
            try {
                if (ctx) {
                    localStorage.setItem(KEYS.DEFAULT_CONTEXT, JSON.stringify(ctx));
                } else {
                    localStorage.removeItem(KEYS.DEFAULT_CONTEXT);
                }
            } catch (_) {}
        }
    };

    global.AppSession = AppSession;
})(window);
