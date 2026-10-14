# -*- coding: utf-8 -*-
"""
Tests verifying the fix for the 3 regressions reported by the user:
1. Mouse actions (resizing, switching result tabs, message selection)
2. Object Explorer collapse/expand button (#ide-sidebar-toggle-btn)
3. Action Bar connection selectors not pushed down / hidden
4. Syntax check integration operates in isolation without conflicting with IDE features
"""

import re
try:
    import pytest
except ImportError:
    class _DummyPytest:
        @staticmethod
        def fixture(func):
            return func
    pytest = _DummyPytest()
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def test_query_js_syntax_integrity():
    """Verify query.js has no unclosed errorsList ternary or broken syntax."""
    query_js_path = BASE_DIR / "static" / "js" / "query.js"
    assert query_js_path.exists()
    content = query_js_path.read_text(encoding="utf-8")

    # Verify errorsList is closed properly
    match = re.search(r'const errorsList = .*?\? data\.errors\s*:\s*\(hasErrors \? \[\{\s*message:.*?\s*\}\] : \[\]\);', content, re.DOTALL)
    assert match is not None, "errorsList in query.js must be properly formatted and closed with `}] : []);`"

    # Verify msgBlocks definition follows cleanly
    assert "let msgBlocks = [];" in content


def test_app_js_initialization_sequence():
    """Verify app.js initializes all core components and binds mouse resizers and explorer toggle."""
    app_js_path = BASE_DIR / "static" / "js" / "app.js"
    assert app_js_path.exists()
    content = app_js_path.read_text(encoding="utf-8")

    # Sequence of components
    assert "window.AppEditor" in content and "initEditor" in content
    assert "window.AppTabs" in content and "initTabs" in content
    assert "window.AppExplorer" in content and "initExplorer" in content
    assert "window.AppQuery" in content and "initQuery" in content
    assert "window.AppConnections" in content and "initConnections" in content

    # Horizontal resizer
    assert "ide-resizer-horizontal" in content
    assert "hResizer.addEventListener('pointerdown'" in content

    # Sidebar collapse/expand toggle button
    assert "ide-sidebar-toggle-btn" in content
    assert "toggleBtn" in content
    assert "collapseSidebar()" in content
    assert "expandSidebar()" in content


def test_action_bar_layout_and_nowrap():
    """Verify index.html and editor.css enforce single-line flex-nowrap and overflow visible on Action Bar so dropdowns are not clipped."""
    html_path = BASE_DIR / "templates" / "index.html"
    assert html_path.exists()
    html_content = html_path.read_text(encoding="utf-8")

    # Action bar container must be flex-nowrap
    assert 'ide-action-bar d-flex align-items-center px-2 gap-1 flex-nowrap' in html_content

    # Context selectors container must be flex-nowrap and min-width: 0
    assert 'ide-ctx-selectors flex-nowrap' in html_content

    # Action bar actions buttons container must be flex-nowrap
    assert 'ide-action-bar-actions flex-nowrap' in html_content

    # Connection badge buttons
    assert 'id="ide-ctx-connection"' in html_content
    assert 'id="ide-ctx-database"' in html_content
    assert 'id="ide-ctx-schema"' in html_content

    # CSS rules in editor.css
    css_path = BASE_DIR / "static" / "css" / "editor.css"
    assert css_path.exists()
    css_content = css_path.read_text(encoding="utf-8")

    assert ".ide-action-bar {" in css_content
    assert "flex-wrap: nowrap !important;" in css_content
    assert "overflow: visible !important;" in css_content
    assert "z-index: 1050;" in css_content
    assert ".ide-ctx-selectors {" in css_content
    assert ".ide-action-bar-actions {" in css_content


def test_explorer_activates_connection_context():
    """Verify explorer.js activates connection context upon successful connect/reconnect."""
    explorer_js_path = BASE_DIR / "static" / "js" / "explorer.js"
    assert explorer_js_path.exists()
    content = explorer_js_path.read_text(encoding="utf-8")

    assert "window.activateConnectionContext(data.connection.connection_id" in content

    query_js_path = BASE_DIR / "static" / "js" / "query.js"
    assert query_js_path.exists()
    query_content = query_js_path.read_text(encoding="utf-8")
    assert "activateConnectionContext" in query_content


def test_syntax_check_service_isolation():
    """Verify syntax check service is completely modular and non-intrusive."""
    service_path = BASE_DIR / "static" / "js" / "syntax-check" / "syntax-check-service.js"
    assert service_path.exists()
    service_content = service_path.read_text(encoding="utf-8")

    # Marker owner must be isolated to 'syntax-check'
    assert "MARKER_OWNER = 'syntax-check'" in service_content

    # Must provide toggle API
    assert "isEnabled" in service_content
    assert "setEnabled" in service_content
    assert "toggleEnabled" in service_content

    # Must support cleanup on tab close
    assert "handleTabClosed" in service_content
    assert "clearModelMarkers" in service_content

    # Verify settings integration
    settings_js = (BASE_DIR / "static" / "js" / "settings.js").read_text(encoding="utf-8")
    assert "editor.syntaxCheck" in settings_js

    # Verify right click context menu integration in editor.js
    editor_js = (BASE_DIR / "static" / "js" / "editor.js").read_text(encoding="utf-8")
    assert "sql-toggle-syntax-check" in editor_js
