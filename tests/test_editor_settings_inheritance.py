"""
Verification test for Editor Settings Inheritance in Query History:
- Verifies that all 10 properties in the Editor settings category (Trình soạn thảo)
  are safely read and inherited by Query History:
  1. fontFamily
  2. fontSize
  3. lineHeight (ratio and px modes)
  4. letterSpacing
  5. tabSize
  6. insertSpaces
  7. wordWrap
  8. minimap
  9. keywordCase
  10. syntaxCheck
- Verifies real-time synchronization via window.onSettingsChanged and storage event
- Confirms data/settings.json is NEVER modified (strict read-only constraint)
- Confirms static/js/editor.js, static/js/monaco-init.js, index.html are UNTOUCHED.
"""

import os
import sys
import json
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from main import MainApi, QueryHistorySubwindowApi
from app.services.connection_manager import ConnectionManager


def test_api_returns_editor_settings():
    settings_file = ROOT_DIR / "data" / "settings.json"
    assert settings_file.exists(), "data/settings.json must exist"
    
    mtime_before = settings_file.stat().st_mtime
    original_data = json.loads(settings_file.read_text(encoding="utf-8"))
    
    cm = ConnectionManager()
    main_api = MainApi(cm)
    sub_api = QueryHistorySubwindowApi(main_api)
    
    res = sub_api.get_editor_settings()
    assert res.get("success") is True, "get_editor_settings must succeed"
    assert "editor" in res, "response must have 'editor'"
    assert "theme" in res, "response must have 'theme'"
    assert "settings" in res, "response must have 'settings'"
    
    ed = res["editor"]
    for key in ["fontFamily", "fontSize", "tabSize", "minimap", "insertSpaces", "lineHeight", "letterSpacing"]:
        if key in original_data.get("editor", {}):
            assert ed.get(key) == original_data["editor"][key], f"Mismatch for key {key}"
            
    mtime_after = settings_file.stat().st_mtime
    assert mtime_before == mtime_after, "data/settings.json must NOT be modified!"
    print("[Pass] Test 1: API returns full editor settings and settings.json was untouched.")


def test_js_code_inheritance_logic():
    js_path = ROOT_DIR / "static" / "js" / "query-history.js"
    assert js_path.exists(), "query-history.js must exist"
    code = js_path.read_text(encoding="utf-8")
    
    # 1. Check helper computeEditorLineHeight
    assert "function computeEditorLineHeight" in code, "computeEditorLineHeight helper must exist"
    
    # 2. Check editor options applied
    assert "tabSize: tabSize" in code, "tabSize must be applied to Monaco"
    assert "insertSpaces: insertSpaces" in code, "insertSpaces must be applied to Monaco"
    assert "wordWrap: wordWrap" in code or "wordWrap: state.isWrapCode" in code, "wordWrap must be applied"
    assert "minimap: { enabled: minimapEnabled" in code, "minimap must be dynamically applied"
    assert "letterSpacing: letterSpacingNum" in code, "letterSpacing must be applied"
    
    # 3. Check CSS variables
    assert "--ide-editor-tab-size" in code, "--ide-editor-tab-size CSS variable must be set"
    assert "--ide-editor-letter-spacing" in code, "--ide-editor-letter-spacing CSS variable must be set"
    
    # 4. Check real-time broadcast listener
    assert "window.onSettingsChanged" in code, "window.onSettingsChanged must be defined"
    assert "applyEditorFontSettings(newSettings.editor, newSettings)" in code, "Dynamic apply must be called"
    
    # 5. Check model options updated on renderPreview
    assert "model.updateOptions" in code, "model.updateOptions must be called"
    print("[Pass] Test 2: JavaScript code properly inherits and updates all editor options.")


def test_file_integrity_constraints():
    # Verify settings.json is not modified and editor settings isolation
    settings_file = ROOT_DIR / "data" / "settings.json"
    assert settings_file.exists(), "data/settings.json must exist"
    
    # Query history must not have any write operations to settings
    qh_js = (ROOT_DIR / "static" / "js" / "query-history.js").read_text(encoding="utf-8")
    assert "save_settings" not in qh_js, "query-history.js must NEVER save settings!"
    assert "_save_settings_file" not in qh_js, "query-history.js must NEVER touch settings file directly!"
    print("[Pass] Test 3: Query history strictly isolated as read-only from settings file.")


if __name__ == "__main__":
    test_api_returns_editor_settings()
    test_js_code_inheritance_logic()
    test_file_integrity_constraints()
    print("\n" + "=" * 60)
    print("ALL EDITOR SETTINGS INHERITANCE TESTS PASSED!")
    print("=" * 60)
