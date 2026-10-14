/**
 * AppSession - Session State Manager (Zero-Network & Desktop Native).
 * Handles full workspace session persistence across app launches:
 * - Tabs list, titles, docId, filePath, isDirty, isPinned
 * - Unsaved SQL drafts & editor content
 * - Cursor position { lineNumber, column } & scroll position { scrollTop, scrollLeft }
 * - Connection context (Server, Database, Schema, DbType)
 * - Sidebar expanded/collapsed state & width
 * - Results panel height
 * - Atomic persistence via Backend (session.json) with localStorage fallback
 * 
 * Strict Rule: NEVER store connection credentials or passwords in session!
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

    let _autoSaveTimer = null;
    let _sessionSerializer = null;

    const AppSession = {
        /**
         * Đăng ký hàm serialize trạng thái từ Tab Manager (tabs.js)
         */
        registerSerializer(fn) {
            _sessionSerializer = fn;
        },

        getActiveTabId() {
            try { return localStorage.getItem(KEYS.ACTIVE_TAB); } catch (_) { return null; }
        },
        setActiveTabId(tabId) {
            try { localStorage.setItem(KEYS.ACTIVE_TAB, tabId || ''); } catch (_) {}
        },

        getOpenTabs() {
            try {
                const raw = localStorage.getItem(KEYS.OPEN_TABS);
                return raw ? JSON.parse(raw) : [];
            } catch (_) {
                return [];
            }
        },
        setOpenTabs(tabs) {
            try {
                if (Array.isArray(tabs)) {
                    const serialized = tabs.map(t => ({
                        id: t.id,
                        title: t.title,
                        tabType: t.tabType || 'query',
                        docId: t.docId,
                        filePath: t.filePath || null,
                        connectionId: t.connectionId,
                        connectionName: t.connectionName,
                        database: t.database,
                        schema: t.schema,
                        dbType: t.dbType,
                        isDirty: Boolean(t.isDirty),
                        isPinned: Boolean(t.isPinned)
                    }));
                    localStorage.setItem(KEYS.OPEN_TABS, JSON.stringify(serialized));
                }
            } catch (_) {}
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
        },

        /**
         * Lưu session toàn diện (Tabs, drafts, cursor, layout) ra Backend và localStorage
         */
        async saveSession(sessionData) {
            if (!sessionData && typeof _sessionSerializer === 'function') {
                sessionData = _sessionSerializer();
            }
            if (!sessionData || typeof sessionData !== 'object') return false;

            // 1. Lưu dự phòng nhanh vào localStorage
            try {
                if (sessionData.activeTabId) this.setActiveTabId(sessionData.activeTabId);
                if (Array.isArray(sessionData.tabs)) {
                    this.setOpenTabs(sessionData.tabs);
                    sessionData.tabs.forEach(t => {
                        if (t && t.id && t.content !== undefined) {
                            this.setTabDraft(t.id, t.content);
                        }
                    });
                }
                if (sessionData.sidebarWidth) this.setSidebarWidth(sessionData.sidebarWidth);
                if (sessionData.sidebarCollapsed !== undefined) this.setSidebarCollapsed(sessionData.sidebarCollapsed);
                if (sessionData.resultsHeight) this.setResultsHeight(sessionData.resultsHeight);
                if (sessionData.defaultContext) this.setDefaultConnectionContext(sessionData.defaultContext);
            } catch (e) {
                console.warn('[Session] Local storage fallback save warning:', e);
            }

            // 2. Ghi ra Backend file data/session.json
            try {
                if (window.pywebview?.api?.session_save) {
                    const res = await window.pywebview.api.session_save(sessionData);
                    return res && res.success;
                }
                const resp = await fetch('/api/session/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sessionData)
                });
                if (resp && resp.ok) {
                    const data = await resp.json();
                    return Boolean(data && data.success);
                }
            } catch (e) {
                console.warn('[Session] Backend session save warning:', e);
            }
            return true;
        },

        /**
         * Tải session từ Backend hoặc fallback sang localStorage
         */
        async loadSession() {
            // 1. Thử tải từ Backend trước
            try {
                if (window.pywebview?.api?.session_load) {
                    const res = await window.pywebview.api.session_load();
                    if (res && res.disabled) return null;
                    if (res && res.success && res.session) {
                        return res.session;
                    }
                } else {
                    const resp = await fetch('/api/session/load');
                    if (resp && resp.ok) {
                        const res = await resp.json();
                        if (res && res.disabled) return null;
                        if (res && res.success && res.session) {
                            return res.session;
                        }
                    }
                }
            } catch (e) {
                console.warn('[Session] Backend session load warning:', e);
            }

            // 2. Fallback sang localStorage nếu Backend không có hoặc không khả dụng
            try {
                const openTabs = this.getOpenTabs();
                if (Array.isArray(openTabs) && openTabs.length > 0) {
                    const tabs = openTabs.map(t => {
                        const draft = this.getTabDraft(t.id);
                        return {
                            ...t,
                            content: draft || undefined
                        };
                    });
                    return {
                        version: 1,
                        activeTabId: this.getActiveTabId(),
                        sidebarWidth: this.getSidebarWidth(),
                        sidebarCollapsed: this.isSidebarCollapsed(),
                        resultsHeight: this.getResultsHeight(),
                        defaultContext: this.getDefaultConnectionContext(),
                        tabs
                    };
                }
            } catch (e) {
                console.warn('[Session] Local storage session restore warning:', e);
            }

            return null;
        },

        /**
         * Xóa phiên làm việc
         */
        async clearSession() {
            try {
                if (window.pywebview?.api?.session_clear) {
                    await window.pywebview.api.session_clear();
                } else {
                    await fetch('/api/session/clear', { method: 'POST' });
                }
            } catch (_) {}

            try {
                const tabs = this.getOpenTabs();
                tabs.forEach(t => {
                    if (t && t.id) this.clearTabDraft(t.id);
                });
                localStorage.removeItem(KEYS.OPEN_TABS);
                localStorage.removeItem(KEYS.ACTIVE_TAB);
            } catch (_) {}
        },

        /**
         * Lên lịch tự động lưu (debounced)
         */
        scheduleAutoSave(delayMs = 3000) {
            if (_autoSaveTimer) {
                clearTimeout(_autoSaveTimer);
            }
            _autoSaveTimer = setTimeout(() => {
                _autoSaveTimer = null;
                this.saveSession();
            }, delayMs);
        }
    };

    // Đăng ký lưu tức thì khi đóng cửa sổ / thoát ứng dụng
    window.addEventListener('beforeunload', () => {
        try {
            if (typeof _sessionSerializer === 'function') {
                const sessionData = _sessionSerializer();
                if (sessionData) {
                    // Đồng bộ ngay lập tức vào localStorage để không bị lỡ
                    if (sessionData.activeTabId) AppSession.setActiveTabId(sessionData.activeTabId);
                    if (Array.isArray(sessionData.tabs)) {
                        AppSession.setOpenTabs(sessionData.tabs);
                        sessionData.tabs.forEach(t => {
                            if (t && t.id && t.content !== undefined) {
                                AppSession.setTabDraft(t.id, t.content);
                            }
                        });
                    }
                    // Bắn beacon nếu trình duyệt hỗ trợ
                    if (navigator.sendBeacon) {
                        const blob = new Blob([JSON.stringify(sessionData)], { type: 'application/json' });
                        navigator.sendBeacon('/api/session/save', blob);
                    }
                }
            }
        } catch (_) {}
    });

    global.AppSession = AppSession;
})(window);
