# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 6:
- Verify that dead methods table_designer_script and table_designer_save are deleted from MainApi.
- Verify that no JavaScript in static/ calls table_designer_script or table_designer_save.
"""
from pathlib import Path
import pytest
from main import MainApi


def test_dead_table_designer_methods_removed():
    """Verify table_designer_script and table_designer_save are removed from MainApi."""
    api = MainApi()
    assert not hasattr(api, "table_designer_script"), "table_designer_script should be removed"
    assert not hasattr(api, "table_designer_save"), "table_designer_save should be removed"


def test_no_js_calls_removed_methods():
    """Verify that static JS files do not call the removed methods."""
    static_dir = Path("static")
    for js_file in static_dir.rglob("*.js"):
        content = js_file.read_text(encoding="utf-8", errors="ignore")
        assert "table_designer_script" not in content, f"Found reference in {js_file}"
        assert "table_designer_save" not in content, f"Found reference in {js_file}"
