// Main Application Wiring

function initApp() {
    console.log('IDE SQL Lite — Initialized');

    // Initialize Monaco SQL editor and core subsystems with fault isolation
    try {
        window.AppEditor = typeof initEditor === 'function' ? initEditor() : null;
    } catch (err) {
        console.error('[initApp] Failed to initialize Editor:', err);
    }

    try {
        window.AppTabs = typeof initTabs === 'function' ? initTabs() : null;
        window.Tabs = window.AppTabs;
    } catch (err) {
        console.error('[initApp] Failed to initialize Tabs:', err);
    }

    try {
        window.AppExplorer = typeof initExplorer === 'function' ? initExplorer() : null;
    } catch (err) {
        console.error('[initApp] Failed to initialize Explorer:', err);
    }

    try {
        window.AppQuery = typeof initQuery === 'function' ? initQuery() : null;
    } catch (err) {
        console.error('[initApp] Failed to initialize Query:', err);
    }

    try {
        window.AppConnections = typeof initConnections === 'function' ? initConnections() : null;
    } catch (err) {
        console.error('[initApp] Failed to initialize Connections:', err);
    }

    // Apply current theme now that editor is ready (respects OS theme by default)
    if (window.ThemeManager) {
        const effectiveTheme = window.ThemeManager.getCurrentTheme ? window.ThemeManager.getCurrentTheme() : 'dark';
        window.ThemeManager.applyTheme(effectiveTheme, false);
    }

    // ── Theme toggle button ───────────────────────────────────────────────────
    const themeBtn = document.getElementById('ide-theme-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => window.ThemeManager.toggle());
    }

    // ── Query History launcher ────────────────────────────────────────────────
    window.openQueryHistoryWindow = async function () {
        try {
            let api = null;
            if (window.pywebview && window.pywebview.api) {
                api = window.pywebview.api;
            } else if (typeof window.waitForPywebview === 'function') {
                api = await window.waitForPywebview();
            }

            if (api && typeof api.open_query_history_window === 'function') {
                const res = await api.open_query_history_window();
                if (res && res.success) return;
            }

            // Web mode fallback
            const resp = await fetch('/api/history/open-window', { method: 'POST' }).catch(() => null);
            if (!resp || !resp.ok) {
                window.open('/templates/query_history_window.html', 'QueryHistoryWindow', 'width=1280,height=820,resizable=yes');
            }
        } catch (err) {
            console.error('Failed to open query history window:', err);
            try {
                window.open('/templates/query_history_window.html', 'QueryHistoryWindow', 'width=1280,height=820,resizable=yes');
            } catch (_) {}
        }
    };

    const menuHistoryBtn = document.getElementById('ide-menu-query-history');
    if (menuHistoryBtn) {
        menuHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.openQueryHistoryWindow();
        });
    }

    const actionHistoryBtn = document.getElementById('ide-btn-history');
    if (actionHistoryBtn) {
        actionHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.openQueryHistoryWindow();
        });
    }

    const overflowHistoryBtn = document.getElementById('ide-overflow-btn-history');
    if (overflowHistoryBtn) {
        overflowHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.openQueryHistoryWindow();
        });
    }

    // ── Active File History Sidebar Launcher ──────────────────────────────────
    function handleFileHistoryTrigger() {
        const activeTabState = (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function')
            ? window.AppTabs.getActiveTabState()
            : null;

        if (!activeTabState || !activeTabState.docId) {
            // Nếu không có file nào đang mở -> mở cửa sổ log đầy đủ
            window.openQueryHistoryWindow();
        } else {
            // Nếu file đang mở -> bật/tắt side panel xem log của file đó
            if (window.FileHistorySidebar && typeof window.FileHistorySidebar.toggle === 'function') {
                window.FileHistorySidebar.toggle();
            }
        }
    }

    const actionFileHistoryBtn = document.getElementById('ide-btn-file-history');
    if (actionFileHistoryBtn) {
        actionFileHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleFileHistoryTrigger();
        });
    }

    const overflowFileHistoryBtn = document.getElementById('ide-overflow-btn-file-history');
    if (overflowFileHistoryBtn) {
        overflowFileHistoryBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleFileHistoryTrigger();
        });
    }

    async function handleObjectSearchTrigger() {
        if (window.ObjectContentSearch && typeof window.ObjectContentSearch.openSearchTab === 'function') {
            const activeTabState = (window.AppTabs && typeof window.AppTabs.getActiveTabState === 'function')
                ? window.AppTabs.getActiveTabState()
                : null;
            let connId = (activeTabState && activeTabState.connectionId) || window.ActiveConnectionId;
            let connName = (activeTabState && activeTabState.connectionName) || window.ActiveConnectionName;
            let database = (activeTabState && activeTabState.database) || window.ActiveDatabase;
            let schema = (activeTabState && activeTabState.schema) || null;
            let dbType = (activeTabState && activeTabState.dbType) || window.ActiveDbType;

            if (!connId && window.AppExplorer && typeof window.AppExplorer.getActiveConnections === 'function') {
                const activeList = window.AppExplorer.getActiveConnections() || [];
                if (activeList.length > 0) {
                    connId = activeList[0].connection_id;
                    connName = activeList[0].name || activeList[0].server || 'Server';
                    dbType = activeList[0].type || 'sqlserver';
                    database = activeList[0].config?.database || database;
                }
            }

            if (!connId && window.AppStorage && typeof window.AppStorage.getSavedConnections === 'function') {
                try {
                    const saved = window.AppStorage.getSavedConnections() || [];
                    if (saved.length > 0) {
                        connId = saved[0].connection_id || saved[0].id;
                        connName = saved[0].name || saved[0].server || 'Server';
                        dbType = saved[0].type || 'sqlserver';
                        database = saved[0].config?.database || database;
                    }
                } catch (_) {}
            }

            if (!connId && window.Api && typeof window.Api.listConnections === 'function') {
                try {
                    const data = await window.Api.listConnections();
                    if (data && data.success && Array.isArray(data.connections) && data.connections.length > 0) {
                        connId = data.connections[0].connection_id;
                        connName = data.connections[0].name || data.connections[0].server || 'Server';
                        dbType = data.connections[0].type || 'sqlserver';
                        database = data.connections[0].config?.database || database;
                    }
                } catch (_) {}
            }

            if (!connId) {
                try {
                    const res = await fetch('/api/connections');
                    const data = await res.json();
                    if (data.success && Array.isArray(data.connections) && data.connections.length > 0) {
                        connId = data.connections[0].connection_id;
                        connName = data.connections[0].name || data.connections[0].server || 'Server';
                        dbType = data.connections[0].type || 'sqlserver';
                        database = data.connections[0].config?.database || database;
                    }
                } catch (_) {}
            }

            window.ObjectContentSearch.openSearchTab({
                connectionId: connId,
                connectionName: connName,
                database: database,
                schema: schema,
                dbType: dbType
            });
        }
    }

    // Bind all Object Search triggers (Edit menu, View menu, Toolbar, Overflow)
    document.querySelectorAll('#ide-menu-object-search, #ide-menu-view-object-search, [data-action="object-search"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            handleObjectSearchTrigger();
        });
    });

    const actionObjSearchBtn = document.getElementById('ide-btn-object-search');
    if (actionObjSearchBtn) {
        actionObjSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleObjectSearchTrigger();
        });
    }

    const overflowObjSearchBtn = document.getElementById('ide-overflow-btn-object-search');
    if (overflowObjSearchBtn) {
        overflowObjSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleObjectSearchTrigger();
        });
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            window.openQueryHistoryWindow();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            handleFileHistoryTrigger();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            handleObjectSearchTrigger();
        }
    });

    // ── Horizontal resizer (editor ↕ results) ─────────────────────────────────
    const hResizer    = document.querySelector('.ide-resizer-horizontal');
    let lastEditorHeight = null;
    let isResultPanelHidden = false;

    if (hResizer) {
        const editorPane  = document.getElementById('ide-editor-pane') || hResizer.previousElementSibling;
        let hDragging = false;
        let startY = 0;
        let startEditorH = 0;
        let containerH = 0;
        let minEditorH = 65;
        let maxEditorH = 500;
        let rAF = null;

        hResizer.addEventListener('pointerdown', e => {
            hDragging = true;
            hResizer.setPointerCapture(e.pointerId);
            hResizer.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'row-resize';

            startY = e.clientY;
            startEditorH = editorPane ? editorPane.getBoundingClientRect().height : 300;
            const container = editorPane ? editorPane.parentElement : null;
            containerH = container ? container.getBoundingClientRect().height : 600;

            const actionBar = editorPane ? editorPane.querySelector('.ide-action-bar') : null;
            const tabsBar = editorPane ? editorPane.querySelector('.ide-tabs-container') : null;
            minEditorH = (actionBar ? actionBar.offsetHeight : 34) + (tabsBar ? tabsBar.offsetHeight : 31);
            maxEditorH = containerH - 60; // Leave 60px minimum for status bar (25px) + result tabs bar (30px)
        });

        hResizer.addEventListener('pointermove', e => {
            if (!hDragging || !editorPane) return;
            const deltaY = e.clientY - startY;
            let newH = Math.round(startEditorH + deltaY);
            newH = Math.max(minEditorH, Math.min(newH, maxEditorH));

            if (rAF) cancelAnimationFrame(rAF);
            rAF = requestAnimationFrame(() => {
                editorPane.style.setProperty('flex', 'none', 'important');
                editorPane.style.height = newH + 'px';
                lastEditorHeight = newH + 'px';
            });
        });

        const stopDrag = () => {
            if (!hDragging) return;
            hDragging = false;
            if (rAF) cancelAnimationFrame(rAF);
            hResizer.classList.remove('dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            if (window.AppEditor) window.AppEditor.refresh();
        };

        hResizer.addEventListener('pointerup', stopDrag);
        hResizer.addEventListener('pointercancel', stopDrag);
    }

    // ── Toggle Result Panel (Ctrl+R / Cmd+R) & Show on Query Execution ───────
    function showResultPanel(resetToDefault = false) {
        const panel = document.getElementById('ide-result-panel');
        if (!panel) return;

        const resizer = document.querySelector('.ide-resizer-horizontal');
        const editorPane = document.getElementById('ide-editor-pane')
            || (resizer ? resizer.previousElementSibling : null);

        panel.classList.remove('d-none');
        panel.style.display = '';
        panel.style.removeProperty('height');

        if (resizer) {
            resizer.classList.remove('d-none');
            resizer.style.display = '';
        }

        // Validate lastEditorHeight: if it leaves less than 120px for panel, discard it
        let validSavedHeight = false;
        if (!resetToDefault && lastEditorHeight && typeof lastEditorHeight === 'string' && lastEditorHeight.endsWith('px')) {
            const savedPx = parseInt(lastEditorHeight, 10);
            const containerH = (editorPane && editorPane.parentElement) ? editorPane.parentElement.clientHeight : 0;
            if (savedPx > 80 && (!containerH || savedPx < containerH - 120)) {
                validSavedHeight = true;
            }
        }

        if (resetToDefault || !validSavedHeight) {
            if (editorPane) {
                editorPane.style.setProperty('flex', '1 1 0%', 'important');
                editorPane.style.height = '';
            }
            panel.style.setProperty('flex', '1 1 0%', 'important');
            panel.style.height = '';
            lastEditorHeight = null;
        } else {
            if (editorPane) {
                editorPane.style.setProperty('flex', 'none', 'important');
                editorPane.style.height = lastEditorHeight;
            }
        }

        isResultPanelHidden = false;

        const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (activeTab) {
            activeTab.isResultPanelHidden = false;
        }

        if (window.AppEditor) {
            window.AppEditor.refresh();
        }
    }

    function hideResultPanel() {
        const panel = document.getElementById('ide-result-panel');
        if (!panel) return;

        const resizer = document.querySelector('.ide-resizer-horizontal');
        const editorPane = document.getElementById('ide-editor-pane')
            || (resizer ? resizer.previousElementSibling : null);

        // Only save lastEditorHeight if it is an explicit dragged pixel height, not calc or full screen
        if (editorPane && editorPane.style.height && editorPane.style.height.endsWith('px') && !editorPane.style.height.includes('calc') && editorPane.style.height !== '100%') {
            lastEditorHeight = editorPane.style.height;
        }
        panel.classList.add('d-none');
        if (resizer) {
            resizer.classList.add('d-none');
        }
        if (editorPane) {
            editorPane.style.setProperty('flex', '1 1 auto', 'important');
            editorPane.style.height = 'calc(100% - 25px)';
        }
        isResultPanelHidden = true;

        const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (activeTab) {
            activeTab.isResultPanelHidden = true;
        }

        if (window.AppEditor) {
            window.AppEditor.refresh();
        }
    }

    function toggleResultPanel() {
        const panel = document.getElementById('ide-result-panel');
        if (!panel) return;

        const isHidden = isResultPanelHidden || panel.classList.contains('d-none') || panel.style.display === 'none';
        if (isHidden) {
            showResultPanel(false);
        } else {
            hideResultPanel();
        }
    }

    function ensureResultPanelVisible(resetToDefault = true) {
        const panel = document.getElementById('ide-result-panel');
        if (!panel) return;

        const isHidden = isResultPanelHidden || panel.classList.contains('d-none') || panel.style.display === 'none';
        if (isHidden) {
            showResultPanel(resetToDefault);
        } else if (resetToDefault) {
            // Panel was already visible, but verify it is not squished (e.g. clientHeight < 120px)
            if (panel.clientHeight < 120) {
                showResultPanel(true);
            }
        }
        const activeTab = window.AppTabs ? window.AppTabs.getActiveTabState() : null;
        if (activeTab) {
            activeTab.isResultPanelHidden = false;
        }
    }

    window.toggleResultPanel = toggleResultPanel;
    window.showResultPanel = showResultPanel;
    window.hideResultPanel = hideResultPanel;
    window.ensureResultPanelVisible = ensureResultPanelVisible;
    window.isResultPanelHidden = () => isResultPanelHidden;

    // Intercept Ctrl+R / Cmd+R globally (capture phase to override browser reload)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'r' || e.key === 'R' || e.code === 'KeyR')) {
            e.preventDefault();
            e.stopPropagation();
            // Disable toggling result panel when user is editing table data
            const activeTab = window.AppTabs?.getActiveTabState?.();
            const isTableEditor = activeTab?.tabType === 'data-editor' ||
                Boolean(document.activeElement?.closest?.('.table-data-editor-container')) ||
                Boolean(document.querySelector('.table-data-editor-container:not([style*="display: none"])'));
            if (isTableEditor) {
                return;
            }
            toggleResultPanel();
        }
    }, true);

    // ── Sidebar horizontal resizer & Collapse/Expand Toggle ──────────────────
    const sidebar        = document.getElementById('ide-sidebar');
    const sidebarResizer = document.getElementById('ide-sidebar-resizer');
    const reopenBtn      = document.getElementById('ide-sidebar-reopen');
    const toggleBtn      = document.getElementById('ide-sidebar-toggle-btn');

    const SIDEBAR_MIN     = 44;
    const SIDEBAR_MAX     = 600;
    const SIDEBAR_DEFAULT = 260;
    const COLLAPSE_THRESH = 70;

    let sLastWidth = window.AppSession ? window.AppSession.getSidebarWidth(SIDEBAR_DEFAULT) : parseInt(localStorage.getItem('ide-sidebar-width') || SIDEBAR_DEFAULT, 10);
    if (!sLastWidth || sLastWidth < 120) sLastWidth = SIDEBAR_DEFAULT;
    let sCollapsed = window.AppSession ? window.AppSession.isSidebarCollapsed() : (localStorage.getItem('ide-sidebar-collapsed') === 'true');
    let sDragging  = false;

    function setSidebarWidth(w) {
        if (sidebar && !sCollapsed) {
            sidebar.style.width    = w + 'px';
            sidebar.style.minWidth = w + 'px';
            sidebar.style.maxWidth = '';
        }
        if (w >= 120) {
            sLastWidth = w;
        }
    }

    function updateToggleButtonIcon() {
        if (!toggleBtn) return;
        const icon = toggleBtn.querySelector('i');
        if (sCollapsed) {
            if (icon) icon.className = 'fa-solid fa-angles-right';
            toggleBtn.title = 'Mở rộng Object Explorer';
        } else {
            if (icon) icon.className = 'fa-solid fa-angles-left';
            toggleBtn.title = 'Thu gọn Object Explorer';
        }
    }

    function collapseSidebar() {
        sCollapsed = true;
        if (sidebar) {
            sidebar.style.display = '';
            sidebar.classList.add('collapsed');
            sidebar.style.width = '44px';
            sidebar.style.minWidth = '44px';
            sidebar.style.maxWidth = '44px';
        }
        if (sidebarResizer) {
            sidebarResizer.style.pointerEvents = 'none';
            sidebarResizer.style.opacity = '0';
        }
        if (reopenBtn) reopenBtn.classList.add('d-none');
        updateToggleButtonIcon();
        if (window.AppSession) window.AppSession.setSidebarCollapsed(true); else localStorage.setItem('ide-sidebar-collapsed', 'true');
        if (window.AppExplorer && typeof window.AppExplorer.renderCollapsedRail === 'function') {
            window.AppExplorer.renderCollapsedRail();
        }
        if (window.AppEditor) window.AppEditor.refresh();
    }

    function expandSidebar() {
        sCollapsed = false;
        if (sidebar) {
            sidebar.style.display = '';
            sidebar.classList.remove('collapsed');
            sidebar.style.maxWidth = '';
            setSidebarWidth(sLastWidth || SIDEBAR_DEFAULT);
        }
        if (sidebarResizer) {
            sidebarResizer.style.display = '';
            sidebarResizer.style.pointerEvents = '';
            sidebarResizer.style.opacity = '';
        }
        if (reopenBtn) reopenBtn.classList.add('d-none');
        updateToggleButtonIcon();
        if (window.AppSession) window.AppSession.setSidebarCollapsed(false); else localStorage.setItem('ide-sidebar-collapsed', 'false');
        if (window.AppEditor) window.AppEditor.refresh();
    }

    // Expose helpers globally
    window.collapseSidebar = collapseSidebar;
    window.expandSidebar   = expandSidebar;
    window.isSidebarCollapsed = () => sCollapsed;

    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sCollapsed) {
                expandSidebar();
            } else {
                collapseSidebar();
            }
        });
    }

    // Restore saved state
    if (sCollapsed) {
        collapseSidebar();
    } else {
        setSidebarWidth(sLastWidth);
        updateToggleButtonIcon();
    }

    if (sidebarResizer) {
        sidebarResizer.addEventListener('pointerdown', e => {
            if (sCollapsed) return;
            sDragging = true;
            sidebarResizer.setPointerCapture(e.pointerId);
            sidebarResizer.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        });

        sidebarResizer.addEventListener('pointermove', e => {
            if (!sDragging || sCollapsed) return;
            const mainEl = document.getElementById('ide-main-area');
            const mainRect = mainEl.getBoundingClientRect();
            let newW = e.clientX - mainRect.left;
            newW = Math.max(0, Math.min(newW, SIDEBAR_MAX));

            if (newW <= COLLAPSE_THRESH) {
                collapseSidebar();
                sDragging = false;
                try { sidebarResizer.releasePointerCapture(e.pointerId); } catch (_) {}
                sidebarResizer.classList.remove('dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                return;
            }

            const clamped = Math.max(120, newW);
            setSidebarWidth(clamped);
        });

        sidebarResizer.addEventListener('pointerup', () => {
            if (!sDragging) return;
            sDragging = false;
            sidebarResizer.classList.remove('dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            if (window.AppSession) window.AppSession.setSidebarWidth(sLastWidth); else localStorage.setItem('ide-sidebar-width', sLastWidth);
            if (window.AppEditor) window.AppEditor.refresh();
        });
    }

    if (reopenBtn) {
        reopenBtn.addEventListener('click', expandSidebar);
    }

    // Initialize Navbar Submenu Hover Support
    initNavbarMenuHover();

    // Ensure all DOM, styles, themes, and Monaco editor have completed paint before dismissing splash
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            triggerAppReadyNotification();
        });
    });
}

// ── Navbar Menu Hover Handler ──────────────────────────────────────────────
function initNavbarMenuHover() {
    const navbar = document.querySelector('nav.ide-toolbar');
    if (!navbar) return;

    const dropdownItems = navbar.querySelectorAll('.navbar-nav .nav-item.dropdown');
    let isMenuBrowsingActive = false;
    let hoverTimeout = null;
    let leaveTimeout = null;

    // Track Bootstrap dropdown open state
    dropdownItems.forEach(item => {
        const toggle = item.querySelector('.dropdown-toggle');
        if (!toggle) return;

        toggle.addEventListener('show.bs.dropdown', () => {
            isMenuBrowsingActive = true;
        });

        toggle.addEventListener('hide.bs.dropdown', () => {
            setTimeout(() => {
                const anyOpen = navbar.querySelector('.dropdown-menu.show');
                if (!anyOpen && !navbar.matches(':hover')) {
                    isMenuBrowsingActive = false;
                }
            }, 50);
        });
    });

    dropdownItems.forEach(item => {
        const toggle = item.querySelector('.dropdown-toggle');
        const menu = item.querySelector('.dropdown-menu');
        if (!toggle || !menu) return;

        item.addEventListener('mouseenter', () => {
            if (leaveTimeout) {
                clearTimeout(leaveTimeout);
                leaveTimeout = null;
            }
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }

            const openMenu = () => {
                dropdownItems.forEach(other => {
                    if (other !== item) {
                        const otherToggle = other.querySelector('.dropdown-toggle');
                        if (otherToggle && window.bootstrap && window.bootstrap.Dropdown) {
                            const inst = bootstrap.Dropdown.getInstance(otherToggle);
                            if (inst) inst.hide();
                        }
                    }
                });

                if (window.bootstrap && window.bootstrap.Dropdown) {
                    const bsDropdown = bootstrap.Dropdown.getOrCreateInstance(toggle);
                    bsDropdown.show();
                    isMenuBrowsingActive = true;
                }
            };

            if (isMenuBrowsingActive) {
                openMenu();
            } else {
                hoverTimeout = setTimeout(openMenu, 100);
            }
        });

        item.addEventListener('mouseleave', () => {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }

            leaveTimeout = setTimeout(() => {
                if (window.bootstrap && window.bootstrap.Dropdown) {
                    const bsDropdown = bootstrap.Dropdown.getInstance(toggle);
                    if (bsDropdown) {
                        bsDropdown.hide();
                    }
                }
                setTimeout(() => {
                    const anyOpen = navbar.querySelector('.dropdown-menu.show');
                    if (!anyOpen) {
                        isMenuBrowsingActive = false;
                    }
                }, 50);
            }, 180);
        });
    });

    // Close all when clicking outside navbar
    document.addEventListener('click', (e) => {
        if (!e.target.closest('nav.ide-toolbar .navbar-nav')) {
            isMenuBrowsingActive = false;
            dropdownItems.forEach(item => {
                const toggle = item.querySelector('.dropdown-toggle');
                if (toggle && window.bootstrap && window.bootstrap.Dropdown) {
                    const inst = bootstrap.Dropdown.getInstance(toggle);
                    if (inst) inst.hide();
                }
            });
        }
    });
}

// ── App-Ready Notifier (Triggered after full init & first paint) ─────────────
function triggerAppReadyNotification() {
    function notifyBackendReady() {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.notify_app_ready === 'function') {
            try {
                window.pywebview.api.notify_app_ready();
                return true;
            } catch (e) {
                console.warn('[app.js] notify_app_ready error:', e);
            }
        }
        return false;
    }

    if (notifyBackendReady()) return;

    let attempts = 0;
    const poll = setInterval(() => {
        attempts++;
        if (notifyBackendReady() || attempts >= 100) {
            clearInterval(poll);
        }
    }, 50);

    window.addEventListener('pywebviewready', () => {
        if (notifyBackendReady()) {
            clearInterval(poll);
        }
    }, { once: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}