#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test suite validating Issue 2 fix:
Restoring history entry allows Ctrl+Z undo by using executeEdits & pushUndoStop
instead of clearing the undo stack with plain setValue.
"""

from pathlib import Path

WORKSPACE_DIR = Path(__file__).resolve().parent.parent


def test_editor_wrapper_replace_content_with_undo():
    editor_js_path = WORKSPACE_DIR / "static" / "js" / "editor.js"
    assert editor_js_path.exists(), "editor.js missing"
    content = editor_js_path.read_text(encoding="utf-8")

    assert "replaceContentWithUndo" in content
    assert "pushUndoStop" in content
    assert "executeEdits" in content
    assert "app-restore-undo" in content


def test_file_history_sidebar_uses_undoable_restore():
    sidebar_js_path = WORKSPACE_DIR / "static" / "js" / "file-history-sidebar.js"
    assert sidebar_js_path.exists(), "file-history-sidebar.js missing"
    content = sidebar_js_path.read_text(encoding="utf-8")

    assert "replaceContentWithUndo" in content
    assert "applyEntryToEditor" in content


def test_dist_sync():
    dist_editor = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / "static" / "js" / "editor.js"
    dist_sidebar = WORKSPACE_DIR / "dist" / "LLTool" / "_internal" / "static" / "js" / "file-history-sidebar.js"

    assert dist_editor.exists()
    assert dist_sidebar.exists()

    src_editor = WORKSPACE_DIR / "static" / "js" / "editor.js"
    src_sidebar = WORKSPACE_DIR / "static" / "js" / "file-history-sidebar.js"

    assert dist_editor.read_text(encoding="utf-8") == src_editor.read_text(encoding="utf-8")
    assert dist_sidebar.read_text(encoding="utf-8") == src_sidebar.read_text(encoding="utf-8")


if __name__ == "__main__":
    test_editor_wrapper_replace_content_with_undo()
    print("[PASS] test_editor_wrapper_replace_content_with_undo")
    test_file_history_sidebar_uses_undoable_restore()
    print("[PASS] test_file_history_sidebar_uses_undoable_restore")
    test_dist_sync()
    print("[PASS] test_dist_sync")
    print("All Restore Undo tests passed successfully!")
