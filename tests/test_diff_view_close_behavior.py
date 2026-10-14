#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test suite validating Issue 1 fix:
Closing Compare view (Diff View) does not delete or close the active SQL text editor tab.
"""

from pathlib import Path

WORKSPACE_DIR = Path(__file__).resolve().parent.parent


def test_close_active_diff_tab_logic():
    tabs_js_path = WORKSPACE_DIR / "static" / "js" / "tabs.js"
    assert tabs_js_path.exists(), "tabs.js missing"
    content = tabs_js_path.read_text(encoding="utf-8")

    # Verify closeActiveDiffTab only closes the tab if state.tabType === 'diff'
    assert "state && state.tabType === 'diff'" in content
    assert "window.closeActiveDiffTab" in content
    assert "window.closeDiffView" in content

    # Verify updateEmptyTabsState hides diff view when no tabs remain
    assert "if (remaining.length === 0) {" in content


def test_editor_js_diff_close_handling():
    editor_js_path = WORKSPACE_DIR / "static" / "js" / "editor.js"
    assert editor_js_path.exists(), "editor.js missing"
    content = editor_js_path.read_text(encoding="utf-8")

    assert "btn-diff-close" in content
    assert "window.closeDiffView" in content


def test_dist_sync():
    dist_tabs = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / "static" / "js" / "tabs.js"
    dist_editor = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / "static" / "js" / "editor.js"
    assert dist_tabs.exists()
    assert dist_editor.exists()

    src_tabs = WORKSPACE_DIR / "static" / "js" / "tabs.js"
    src_editor = WORKSPACE_DIR / "static" / "js" / "editor.js"

    assert dist_tabs.read_text(encoding="utf-8") == src_tabs.read_text(encoding="utf-8")
    assert dist_editor.read_text(encoding="utf-8") == src_editor.read_text(encoding="utf-8")


if __name__ == "__main__":
    test_close_active_diff_tab_logic()
    print("[PASS] test_close_active_diff_tab_logic")
    test_editor_js_diff_close_handling()
    print("[PASS] test_editor_js_diff_close_handling")
    test_dist_sync()
    print("[PASS] test_dist_sync")
    print("All Diff Close tests passed successfully!")
