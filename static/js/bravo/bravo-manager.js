/**
 * BravoManager - Launcher for independent BRAVO Tool native windows.
 * - Checks /api/bravo/config or AppStorage to show/hide the BRAVO button on the toolbar
 * - On click, opens a brand-new independent native OS window (pywebview)
 */
(function (global) {
    'use strict';

    let _enabled = false;

    const BravoManager = {

        // ── Initialize ─────────────────────────────────────────────────────────
        async init() {
            try {
                const res = await fetch('/api/bravo/config');
                const data = await res.json();
                _enabled = !!(data.success && data.enabled);
            } catch (e) {
                try {
                    if (window.AppStorage && typeof window.AppStorage.getSettings === 'function') {
                        const settings = await window.AppStorage.getSettings();
                        _enabled = !!settings?.addons?.bravo_tool?.enabled;
                    } else {
                        _enabled = false;
                    }
                } catch (_) {
                    _enabled = false;
                }
            }

            const wrap = document.getElementById('ide-bravo-launcher-wrap');
            const launcher = document.getElementById('ide-bravo-launcher');

            if (!wrap || !launcher) return;

            if (_enabled) {
                wrap.style.display = 'block';
                launcher.addEventListener('click', (e) => {
                    e.stopPropagation();
                    BravoManager.launch();
                });
            }
        },

        // ── Launch a new independent BRAVO window ────────────────────────────
        async launch() {
            if (!_enabled) return;
            try {
                let connId = window.ActiveConnectionId || null;
                let connName = window.ActiveConnectionName || null;
                let db = window.ActiveDatabase || null;
                let dbType = window.ActiveDbType || null;
                let schema = window.ActiveSchema || null;

                if ((!connId || !db) && window.AppTabs && typeof window.AppTabs.getActiveTab === 'function') {
                    const activeTab = window.AppTabs.getActiveTab();
                    if (activeTab) {
                        connId = connId || activeTab.connectionId;
                        connName = connName || activeTab.connectionName;
                        db = db || activeTab.database;
                        dbType = dbType || activeTab.dbType;
                        schema = schema || activeTab.schema;
                    }
                }

                if (dbType === 'group_marker' || (connName && String(connName).startsWith('__group__'))) {
                    connId = null;
                    connName = null;
                    db = null;
                    dbType = null;
                    schema = null;
                }

                if (!schema && db && db !== '—') {
                    schema = (dbType === 'postgresql' ? 'public' : 'dbo');
                }

                if (window.AppLoader) {
                    window.AppLoader.show('Đang mở BRAVO Tool...');
                }
                try {
                    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_bravo_window === 'function') {
                        await window.pywebview.api.open_bravo_window(connId, connName, db, dbType, schema);
                    } else {
                        const qs = new URLSearchParams({
                            connection_id: connId || '',
                            connection_name: connName || '',
                            database: db || '',
                            db_type: dbType || '',
                            schema: schema || ''
                        });
                        await fetch(`/api/bravo/open-window?${qs}`, { method: 'POST' });
                    }
                } finally {
                    setTimeout(() => {
                        if (window.AppLoader) window.AppLoader.hide();
                    }, 800);
                }
            } catch (e) {
                console.error('[BRAVO] Failed to launch independent Bravo window:', e);
            }
        }
    };

    global.BravoManager = BravoManager;
})(window);
