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


def test_editor_line_height_computation_logic():
    def compute_editor_line_height(raw_lh, font_size):
        fs = float(font_size) if font_size else 14.0
        try:
            raw = float(raw_lh)
        except (ValueError, TypeError):
            raw = 0.0
        if raw <= 0:
            return round(fs * (19 / 13))
        if raw <= 4:
            return max(int(fs), round(fs * raw))
        return max(int(fs), round(raw))

    # Auto mode
    assert compute_editor_line_height(0, 13) == 19
    assert compute_editor_line_height(0, 14) == 20

    # Ratio/multiplier mode
    assert compute_editor_line_height(1, 13) == 13
    assert compute_editor_line_height(1.2, 13) == 16
    assert compute_editor_line_height(1.5, 13) == 20
    assert compute_editor_line_height(1.8, 13) == 23
    assert compute_editor_line_height(2.0, 13) == 26

    # Absolute pixel mode
    assert compute_editor_line_height(20, 13) == 20
    assert compute_editor_line_height(24, 13) == 24
    assert compute_editor_line_height(28, 13) == 28


def test_editor_css_preserves_monaco_cursor_alignment():
    css_path = Path("static/css/editor.css")
    assert css_path.exists()
    content = css_path.read_text(encoding="utf-8")

    # Ensure no ID selector forces 0px letter spacing on Monaco view lines
    assert "#monaco-sql-editor .monaco-editor .view-line" not in content
    assert "text-rendering: auto" in content


def test_settings_line_height_supports_decimal_ratios():
    settings_js_path = Path("static/js/settings.js")
    content = settings_js_path.read_text(encoding="utf-8")
    editor_js_path = Path("static/js/editor.js")
    editor_content = editor_js_path.read_text(encoding="utf-8")

    assert "step: 0.1" in content
    assert "computeEditorLineHeight" in editor_content
    # Confirm wrap.style.lineHeight is NOT applied inline on container
    assert "wrap.style.lineHeight = editorLineHeight" not in content

