import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

if "webview" not in sys.modules:
    try:
        import webview
    except ImportError:
        sys.modules["webview"] = MagicMock()

import main


def test_settings_json_has_line_height_and_letter_spacing():
    settings_path = Path("data/settings.json")
    assert settings_path.exists(), "data/settings.json must exist"
    with open(settings_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    assert "editor" in data, "data/settings.json must have editor key"
    assert "lineHeight" in data["editor"], "editor must have lineHeight"
    assert "letterSpacing" in data["editor"], "editor must have letterSpacing"


def test_main_load_settings_file_defaults():
    loaded = main._load_settings_file()
    assert "editor" in loaded
    assert "lineHeight" in loaded["editor"]
    assert "letterSpacing" in loaded["editor"]


def test_settings_js_contains_configurations():
    settings_js_path = Path("static/js/settings.js")
    assert settings_js_path.exists()
    content = settings_js_path.read_text(encoding="utf-8")

    assert "lineHeight" in content
    assert "letterSpacing" in content
    assert "--ide-editor-line-height" in content
    assert "--ide-editor-letter-spacing" in content


def test_editor_js_contains_line_height_and_letter_spacing_handling():
    editor_js_path = Path("static/js/editor.js")
    assert editor_js_path.exists()
    content = editor_js_path.read_text(encoding="utf-8")

    assert "lineHeight" in content
    assert "letterSpacing" in content
    assert "remeasureMonacoFonts" in content
    assert "_baseLineHeight" in content
    assert "_baseLetterSpacing" in content
    assert "revealLine" in content


def test_tabs_js_contains_context_menu_and_operations():
    tabs_js_path = Path("static/js/tabs.js")
    assert tabs_js_path.exists()
    content = tabs_js_path.read_text(encoding="utf-8")

    assert "closeOtherTabs" in content
    assert "closeTabsToRight" in content
    assert "closeAllTabs" in content
    assert "duplicateTab" in content
    assert "renameTab" in content
    assert "copyTabTitle" in content
    assert "ide-tab-context-menu" in content
    assert "auxclick" in content
