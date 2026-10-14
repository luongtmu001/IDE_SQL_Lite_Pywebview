# -*- coding: utf-8 -*-
"""
Tests for Phase 6 Step 1: Extracted pure and stateless utilities:
- app.services.settings_store
- app.desktop.themes
- app.desktop.clipboard
- app.bravo.xml_codec
"""
import json
import pytest
from pathlib import Path

from app.services.settings_store import (
    read_json,
    write_json,
    load_settings_file,
    save_settings_file,
    load_snippets_file,
    save_snippets_file,
)
from app.desktop.themes import (
    clean_jsonc,
    hex_to_rgb,
    is_dark_color,
    generate_theme_css,
)
from app.desktop.clipboard import (
    native_set_clipboard,
    native_get_clipboard,
)
from app.bravo.xml_codec import (
    beautify_xml_string,
    decode_xml_payload,
    encode_xml_payload,
    validate_xml_syntax,
)


# ── 1. Settings Store Tests ───────────────────────────────────────────

def test_settings_store_read_write_json(tmp_path):
    target = tmp_path / "test.json"
    data = {"key": "value", "count": 42}
    assert write_json(target, data) is True
    assert target.exists()

    loaded = read_json(target, default={})
    assert loaded == data


def test_settings_store_load_settings_schema():
    st = load_settings_file()
    assert isinstance(st, dict)
    assert "editor" in st
    assert "appearance" in st
    assert "theme" in st
    assert "sql" in st
    assert "addons" in st
    assert "session" in st


# ── 2. Themes & JSONC Tests ────────────────────────────────────────────

def test_themes_clean_jsonc():
    jsonc = """
    {
        // Single line comment
        "theme": "custom", /* Block comment */
        "items": [1, 2, 3, ], // Trailing comma
    }
    """
    cleaned = clean_jsonc(jsonc)
    parsed = json.loads(cleaned)
    assert parsed["theme"] == "custom"
    assert parsed["items"] == [1, 2, 3]


def test_themes_hex_to_rgb_and_is_dark():
    assert hex_to_rgb("#ffffff") == (255, 255, 255)
    assert hex_to_rgb("#000000") == (0, 0, 0)
    assert hex_to_rgb("#fff") == (255, 255, 255)
    assert hex_to_rgb("invalid") is None

    assert is_dark_color("#000000") is True
    assert is_dark_color("#ffffff") is False
    assert is_dark_color("#18191E") is True


def test_themes_generate_theme_css():
    theme_data = {
        "colors": {
            "editor.background": "#1e1e1e",
            "editor.foreground": "#d4d4d4",
            "button.background": "#0e639c",
        }
    }
    res = generate_theme_css("my-theme", "My Theme", theme_data, is_dark=True)
    assert res["theme_id"] == "my-theme"
    assert res["theme_name"] == "My Theme"
    assert res["is_dark"] is True
    assert "--ide-theme-id:" in res["css"]
    assert "--ide-bg-editor:" in res["css"]


# ── 3. Clipboard Tests ─────────────────────────────────────────────────

def test_clipboard_native_operations():
    test_str = "Phase6_Step1_Clipboard_Verification_123"
    ok = native_set_clipboard(test_str)
    assert ok is True
    read_val = native_get_clipboard()
    assert read_val == test_str


# ── 4. Bravo XML Codec Tests ───────────────────────────────────────────

def test_xml_codec_syntax_validation():
    valid_xml = "<root><item id='1'>Text</item></root>"
    is_valid, err = validate_xml_syntax(valid_xml)
    assert is_valid is True
    assert err is None

    invalid_xml = "<root><item id='1'>Text</item>"
    is_valid, err = validate_xml_syntax(invalid_xml)
    assert is_valid is False
    assert err is not None


def test_xml_codec_beautify_and_roundtrip():
    xml_raw = "<root><child a='1'><subchild>Content</subchild></child></root>"
    pretty = beautify_xml_string(xml_raw)
    assert "<root>" in pretty
    assert "  <child" in pretty

    encoded_zip = encode_xml_payload(pretty, format_type="zip")
    assert isinstance(encoded_zip, bytes)
    assert len(encoded_zip) >= 4
    assert encoded_zip[:4] == b"PK\x03\x04"

    decoded_xml = decode_xml_payload(encoded_zip)
    assert "<root>" in decoded_xml
    assert "Content" in decoded_xml
