// Main Application Wiring

function initApp() {
    console.log('IDE SQL Lite — Initialized');

    // Initialize Monaco SQL editor
    window.AppEditor      = initEditor();
    window.AppTabs        = initTabs();
    window.AppExplorer    = initExplorer();
    window.AppQuery       = initQuery();
    window.AppConnections = initConnections();  // initialize connection modal

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

        if (resetToDefault || !lastEditorHeight) {
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

        if (editorPane && editorPane.style.height && editorPane.style.height !== '100%') {
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

    // ── Sidebar horizontal resizer ────────────────────────────────────────────
    const sidebar        = document.getElementById('ide-sidebar');
    const sidebarResizer = document.getElementById('ide-sidebar-resizer');
    const reopenBtn      = document.getElementById('ide-sidebar-reopen');

    const SIDEBAR_MIN     = 30;
    const SIDEBAR_MAX     = 600;
    const SIDEBAR_DEFAULT = 260;
    const COLLAPSE_THRESH = 30;

    let sLastWidth = window.AppSession ? window.AppSession.getSidebarWidth(SIDEBAR_DEFAULT) : parseInt(localStorage.getItem('ide-sidebar-width') || SIDEBAR_DEFAULT, 10);
    let sCollapsed = window.AppSession ? window.AppSession.isSidebarCollapsed() : (localStorage.getItem('ide-sidebar-collapsed') === 'true');
    let sDragging  = false;

    function setSidebarWidth(w) {
        if (sidebar) {
            sidebar.style.width    = w + 'px';
            sidebar.style.minWidth = w + 'px';
        }
        sLastWidth = w;
    }

    function collapseSidebar() {
        sCollapsed = true;
        if (sidebar) { sidebar.style.display = 'none'; }
        if (sidebarResizer) sidebarResizer.style.display = 'none';
        if (reopenBtn) reopenBtn.classList.remove('d-none');
        if (window.AppSession) window.AppSession.setSidebarCollapsed(true); else localStorage.setItem('ide-sidebar-collapsed', 'true');
        if (window.AppEditor) window.AppEditor.refresh();
    }

    function expandSidebar() {
        sCollapsed = false;
        if (sidebar) { sidebar.style.display = ''; setSidebarWidth(sLastWidth || SIDEBAR_DEFAULT); }
        if (sidebarResizer) sidebarResizer.style.display = '';
        if (reopenBtn) reopenBtn.classList.add('d-none');
        if (window.AppSession) window.AppSession.setSidebarCollapsed(false); else localStorage.setItem('ide-sidebar-collapsed', 'false');
        if (window.AppEditor) window.AppEditor.refresh();
    }

    // Restore saved state
    if (sCollapsed) {
        collapseSidebar();
    } else {
        setSidebarWidth(sLastWidth);
    }

    if (sidebarResizer) {
        sidebarResizer.addEventListener('pointerdown', e => {
            sDragging = true;
            sidebarResizer.setPointerCapture(e.pointerId);
            sidebarResizer.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        });

        sidebarResizer.addEventListener('pointermove', e => {
            if (!sDragging) return;
            const mainEl = document.getElementById('ide-main-area');
            const mainRect = mainEl.getBoundingClientRect();
            let newW = e.clientX - mainRect.left;
            newW = Math.max(0, Math.min(newW, SIDEBAR_MAX));

            if (newW <= COLLAPSE_THRESH) {
                collapseSidebar();
                sDragging = false;
                sidebarResizer.releasePointerCapture(e.pointerId);
                sidebarResizer.classList.remove('dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                return;
            }

            const clamped = Math.max(SIDEBAR_MIN, newW);
            setSidebarWidth(clamped);
        });

        sidebarResizer.addEventListener('pointerup', () => {
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

    // ── Notify native backend that IDE UI is fully ready to display ──────────
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

    setTimeout(() => {
        if (!notifyBackendReady()) {
            window.addEventListener('pywebviewready', () => {
                notifyBackendReady();
            }, { once: true });
        }
    }, 150);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}