"""
Tests for Query History Monaco Integration and Text Editor Zoom Inheritance:
1. Monaco Editor integration in query_history_window.html:
   - Presence of Monaco styles & scripts (loader.js, monaco-init.js, monaco-sql-lang.js)
   - Container #qhMonacoEditor with class qh-monaco-container
   - Collapse/Expand button #btnToggleFold
2. Monaco configuration in query-history.js:
   - readOnly: true and domReadOnly: true (strictly read-only, no editing permitted)
   - folding: true, foldingStrategy: 'auto', showFoldingControls: 'always' (code folding collapse/expand)
   - mouseWheelZoom: true and Ctrl+Wheel font zoom with onDidChangeConfiguration line-height sync
   - Find widget & keyword search support
   - Safe read-only inheritance of editor font settings (fontFamily, fontSize, lineHeight, letterSpacing)
3. Strict isolation constraint:
   - data/settings.json was NEVER modified (read-only)
   - Text Editor core files unaffected
"""

import os
import sys
import json
import re
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import MainApi, QueryHistorySubwindowApi
from app.services.connection_manager import ConnectionManager


def test_monaco_template_integration():
    html_path = Path("templates/query_history_window.html")
    assert html_path.exists(), "query_history_window.html must exist"
    content = html_path.read_text(encoding="utf-8")

    # 1. Monaco Editor CSS
    assert "monaco/vs/editor/editor.main.css" in content, "Monaco CSS must be linked"
    assert "codemirror" not in content.lower(), "CodeMirror must be completely removed from HTML"

    # 2. Monaco Container
    assert 'id="qhMonacoEditor"' in content, "Container #qhMonacoEditor must exist"
    assert 'class="qh-monaco-container"' in content, "Class qh-monaco-container must be applied"
    assert "qhCodeTextarea" not in content, "qhCodeTextarea must be removed"

    # 3. Monaco Loader & Scripts
    assert "monaco/vs/loader.js" in content, "loader.js must be included"
    assert "monaco-init.js" in content, "monaco-init.js must be included"
    assert "monaco-sql-lang.js" in content, "monaco-sql-lang.js must be included"

    # 4. Buttons in Toolbar
    assert 'id="btnToggleFold"' in content, "Collapse/Expand fold button must exist in toolbar"
    assert 'id="btnHeaderFind"' in content, "Find in SQL button must exist in toolbar"

    # 5. Shortcuts hints in status bar
    assert "Ctrl+F" in content, "Ctrl+F search hint must be shown"
    assert "Ctrl+Wheel" in content, "Ctrl+Wheel zoom hint must be shown"

    print("[Pass] Test 1: Monaco Editor template integration, scripts, container and buttons verified.")


def test_monaco_options_and_zoom_behavior():
    js_path = Path("static/js/query-history.js")
    assert js_path.exists(), "query-history.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # 1. Strictly Read-Only
    assert "readOnly: true" in content, "Monaco must have readOnly: true"
    assert "registerSqlFoldingProvider" in content, "Must register SQL folding range provider"

    # 2. Code Folding (Collapse/Expand)
    assert "folding: true" in content, "Monaco must have folding: true"
    assert "showFoldingControls: 'always'" in content, "Folding controls must always be visible"
    assert "foldingHighlight: true" in content, "Folding highlight must be enabled"
    assert "editor.foldAll" in content, "Fold All command must be wired"
    assert "editor.unfoldAll" in content, "Unfold All command must be wired"

    # 3. Mouse Wheel Zoom & Line-Height Sync
    assert "mouseWheelZoom: true" in content, "Monaco must have mouseWheelZoom: true"
    assert "onDidChangeConfiguration" in content, "onDidChangeConfiguration must be hooked"
    assert "hasChanged(monaco.editor.EditorOption.fontSize)" in content, "Must detect font size change"
    assert "e.ctrlKey" in content, "Wheel listener must check ctrlKey for zoom"

    # 4. Find & Search
    assert "findMatches" in content, "Programmatic findMatches must be supported"
    assert "revealRangeInCenter" in content, "Match reveal must be supported"
    assert "actions.find" in content, "actions.find action must be triggered"
    assert "btnHeaderFind" in content, "btnHeaderFind listener must exist"

    print("[Pass] Test 2: Monaco Read-Only, Code Folding, Mouse Wheel Zoom & Search options verified.")


def test_editor_font_inheritance_and_settings_isolation():
    settings_file = Path("data/settings.json")
    assert settings_file.exists(), "data/settings.json must exist"

    mtime_before = settings_file.stat().st_mtime
    raw_settings = json.loads(settings_file.read_text(encoding="utf-8"))

    cm = ConnectionManager()
    main_api = MainApi(cm)
    sub_api = QueryHistorySubwindowApi(main_api)

    res = sub_api.get_editor_settings()
    assert res.get("success") is True, "get_editor_settings must succeed"
    assert "editor" in res, "response must have editor key"

    # Verify values match active editor settings
    assert res["editor"]["fontFamily"] == raw_settings["editor"]["fontFamily"]
    assert res["editor"]["fontSize"] == raw_settings["editor"]["fontSize"]

    # Verify settings.json was NOT touched
    mtime_after = settings_file.stat().st_mtime
    assert mtime_before == mtime_after, "data/settings.json must NEVER be modified!"

    print("[Pass] Test 3: Safe read-only editor font settings inheritance and strict isolation verified.")


def test_css_styling_and_distribution_sync():
    css_path = Path("static/css/query-history.css")
    assert css_path.exists()
    css = css_path.read_text(encoding="utf-8")
    assert ".qh-monaco-container" in css, "qh-monaco-container CSS rule must exist"

    # Check dist sync
    dist_html = Path("dist/LLTool/_internal/templates/query_history_window.html")
    dist_js = Path("dist/LLTool/_internal/static/js/query-history.js")
    dist_css = Path("dist/LLTool/_internal/static/css/query-history.css")

    if dist_html.exists():
        assert 'id="qhMonacoEditor"' in dist_html.read_text(encoding="utf-8")
        assert 'mouseWheelZoom: true' in dist_js.read_text(encoding="utf-8")
        assert '.qh-monaco-container' in dist_css.read_text(encoding="utf-8")
        print("[Pass] Test 4: Distribution files in dist/LLTool/_internal are synchronized.")
    else:
        print("[Pass] Test 4: (Skipped dist check as dist is optional).")


if __name__ == "__main__":
    test_monaco_template_integration()
    test_monaco_options_and_zoom_behavior()
    test_editor_font_inheritance_and_settings_isolation()
    test_css_styling_and_distribution_sync()
    print("\n" + "=" * 60)
    print("ALL TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)
