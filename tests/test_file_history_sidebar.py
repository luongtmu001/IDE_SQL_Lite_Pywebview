#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Test Suite for File History Sidebar (Docked & Resizable on Right of Text Editor)
Verifies:
1. templates/partials/editor.html has #ide-btn-file-history, overflow menu item, and #ide-file-history-panel.
2. templates/index.html includes file-history-sidebar.css and file-history-sidebar.js.
3. static/css/file-history-sidebar.css has all required layout, resizer, and card styles.
4. static/js/file-history-sidebar.js exposes window.FileHistorySidebar with full lifecycle methods.
5. static/js/app.js handles #ide-btn-file-history and Ctrl+Shift+H with conditional logic:
   - If no file open -> openQueryHistoryWindow()
   - If file open -> FileHistorySidebar.toggle()
6. static/js/tabs.js notifies FileHistorySidebar on tab change/close and dispatches ide-history-updated.
7. static/js/query.js dispatches ide-history-updated on execution completion.
8. Distribution files in dist/LLTool/_internal/ are fully synchronized.
"""

import os
import sys
from pathlib import Path

WORKSPACE_DIR = Path(__file__).resolve().parent.parent


def test_html_markup_and_components():
    """Kiểm tra editor.html và index.html có đầy đủ nút bấm, thanh resizer và panel."""
    editor_html_path = WORKSPACE_DIR / "templates" / "partials" / "editor.html"
    index_html_path = WORKSPACE_DIR / "templates" / "index.html"

    assert editor_html_path.exists(), "templates/partials/editor.html missing!"
    assert index_html_path.exists(), "templates/index.html missing!"

    editor_content = editor_html_path.read_text(encoding="utf-8")
    index_content = index_html_path.read_text(encoding="utf-8")

    # 1. Nút trên thanh công cụ & Overflow menu
    for content, name in [(editor_content, "editor.html"), (index_content, "index.html")]:
        assert 'id="ide-btn-file-history"' in content, f"Missing #ide-btn-file-history in {name} toolbar"
        assert 'id="ide-overflow-btn-file-history"' in content, f"Missing #ide-overflow-btn-file-history in {name} overflow menu"
        assert "File Log" in content, f"Missing File Log label text in {name}"
        assert 'id="ide-file-history-resizer"' in content, f"Missing #ide-file-history-resizer in {name}"
        assert 'id="ide-file-history-panel"' in content, f"Missing #ide-file-history-panel in {name}"
        assert 'id="fhs-doc-title"' in content, f"Missing #fhs-doc-title in {name} panel header"
        assert 'id="fhs-runs-badge"' in content, f"Missing #fhs-runs-badge in {name} panel header"
        assert 'id="fhs-btn-refresh"' in content, f"Missing #fhs-btn-refresh in {name} panel header"
        assert 'id="fhs-btn-open-full"' in content, f"Missing #fhs-btn-open-full in {name} panel header"
        assert 'id="fhs-btn-close"' in content, f"Missing #fhs-btn-close in {name} panel header"
        assert 'id="fhs-search-input"' in content, f"Missing #fhs-search-input in {name} panel toolbar"
        assert 'id="fhs-entries-container"' in content, f"Missing #fhs-entries-container in {name} panel body"
        assert 'id="fhs-detail-footer"' in content, f"Missing #fhs-detail-footer in {name} panel footer"
        assert 'id="fhs-btn-diff"' in content, f"Missing #fhs-btn-diff in {name} panel footer"
        assert 'id="fhs-btn-apply"' in content, f"Missing #fhs-btn-apply in {name} panel footer"
        assert 'id="fhs-btn-copy"' in content, f"Missing #fhs-btn-copy in {name} panel footer"

    # 3. index.html links
    assert "file-history-sidebar.css" in index_content, "Missing file-history-sidebar.css in index.html head"
    assert "file-history-sidebar.js" in index_content, "Missing file-history-sidebar.js in index.html scripts"

    print("[Pass] Test 1: HTML markup and template integration verified.")


def test_css_styles_integrity():
    """Kiểm tra static/css/file-history-sidebar.css có đầy đủ styles cho resizer, panel và cards."""
    css_path = WORKSPACE_DIR / "static" / "css" / "file-history-sidebar.css"
    assert css_path.exists(), "static/css/file-history-sidebar.css missing!"

    css_content = css_path.read_text(encoding="utf-8")
    assert ".ide-file-history-resizer" in css_content
    assert "cursor: col-resize;" in css_content
    assert ".ide-file-history-panel" in css_content
    assert ".fhs-header" in css_content
    assert ".fhs-pill-btn" in css_content
    assert ".fhs-entry-card" in css_content
    assert ".fhs-entry-sql-preview" in css_content
    assert ".fhs-card-btn" in css_content

    print("[Pass] Test 2: CSS stylesheet integrity verified.")


def test_js_sidebar_controller():
    """Kiểm tra FileHistorySidebar controller trong static/js/file-history-sidebar.js."""
    js_path = WORKSPACE_DIR / "static" / "js" / "file-history-sidebar.js"
    assert js_path.exists(), "static/js/file-history-sidebar.js missing!"

    js_content = js_path.read_text(encoding="utf-8")
    assert "window.FileHistorySidebar" in js_content
    assert "function init()" in js_content or "init:" in js_content
    assert "function toggle()" in js_content or "toggle:" in js_content
    assert "function open(" in js_content or "open:" in js_content
    assert "function close()" in js_content or "close:" in js_content
    assert "function onTabChanged(" in js_content or "onTabChanged:" in js_content
    assert "function onAllTabsClosed(" in js_content or "onAllTabsClosed:" in js_content
    assert "function initResizerDragging()" in js_content
    assert "localStorage.getItem('ide-file-history-width')" in js_content
    assert "window.showDiffView" in js_content
    assert "window.AppEditor.setValue" in js_content
    assert "navigator.clipboard" in js_content

    print("[Pass] Test 3: JavaScript FileHistorySidebar controller verified.")


def test_app_js_conditional_trigger():
    """Kiểm tra static/js/app.js có xử lý điều kiện: nếu không có file mở thì mở cửa sổ log, nếu có thì bật/tắt side panel."""
    app_js_path = WORKSPACE_DIR / "static" / "js" / "app.js"
    assert app_js_path.exists(), "static/js/app.js missing!"

    app_content = app_js_path.read_text(encoding="utf-8")
    assert "handleFileHistoryTrigger" in app_content
    assert "ide-btn-file-history" in app_content
    assert "ide-overflow-btn-file-history" in app_content
    assert "window.openQueryHistoryWindow()" in app_content
    assert "window.FileHistorySidebar.toggle()" in app_content
    assert "window.AppTabs.getActiveTabState()" in app_content
    assert "e.shiftKey && e.key.toLowerCase() === 'h'" in app_content, "Missing Ctrl+Shift+H shortcut handler"

    print("[Pass] Test 4: app.js conditional trigger and shortcut verified.")


def test_tabs_and_query_events_integration():
    """Kiểm tra tabs.js và query.js tích hợp lắng nghe và phát sự kiện ide-history-updated."""
    tabs_js_path = WORKSPACE_DIR / "static" / "js" / "tabs.js"
    query_js_path = WORKSPACE_DIR / "static" / "js" / "query.js"

    assert tabs_js_path.exists(), "static/js/tabs.js missing!"
    assert query_js_path.exists(), "static/js/query.js missing!"

    tabs_content = tabs_js_path.read_text(encoding="utf-8")
    query_content = query_js_path.read_text(encoding="utf-8")

    # tabs.js: notifies on tab change and all tabs closed
    assert "window.FileHistorySidebar.onTabChanged(tabId, state)" in tabs_content
    assert "window.FileHistorySidebar.onAllTabsClosed()" in tabs_content
    assert "ide-history-updated" in tabs_content

    # query.js: dispatches ide-history-updated upon execution complete
    assert "ide-history-updated" in query_content

    print("[Pass] Test 5: tabs.js and query.js event hooks verified.")


def test_distribution_sync():
    """Kiểm tra đồng bộ các file sang dist/LLTool/_internal/."""
    files_to_check = [
        "static/css/file-history-sidebar.css",
        "static/js/file-history-sidebar.js",
        "templates/partials/editor.html",
        "templates/index.html",
        "static/js/app.js",
        "static/js/tabs.js",
        "static/js/query.js"
    ]

    for rel in files_to_check:
        src = WORKSPACE_DIR / rel
        dst = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / rel
        assert dst.exists(), f"Distribution file missing: {rel}"
        assert src.read_bytes() == dst.read_bytes(), f"Distribution file out of sync: {rel}"

    print("[Pass] Test 6: Distribution files synchronization verified.")


if __name__ == "__main__":
    print("=" * 70)
    print("RUNNING AUTOMATED TEST SUITE: File History Sidebar & Conditional Trigger")
    print("=" * 70)
    test_html_markup_and_components()
    test_css_styles_integrity()
    test_js_sidebar_controller()
    test_app_js_conditional_trigger()
    test_tabs_and_query_events_integration()
    test_distribution_sync()
    print("=" * 70)
    print("ALL TESTS PASSED (6/6) - 100% SUCCESS!")
    print("=" * 70)
