# -*- coding: utf-8 -*-
"""
tests/test_history_titlebar_sync.py:
Automated test suite verifying titlebar/taskbar theme synchronization
for the Query History window in luoBTool IDE.
"""

import os
import sys
import json
import re
from pathlib import Path

# Ensure workspace root is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from main import MainApi, QueryHistorySubwindowApi, _load_settings_file
from app.services.connection_manager import ConnectionManager
from app.utils.dwm import THEME_TITLEBAR_PRESETS, hex_to_colorref


def test_main_py_titlebar_and_broadcast_integration():
    """Kiểm tra main.py tích hợp _history_window vào apply_titlebar_theme và _broadcast_settings."""
    main_py_path = ROOT_DIR / "main.py"
    assert main_py_path.exists(), "main.py must exist"
    content = main_py_path.read_text(encoding="utf-8")

    # 1. Kiểm tra apply_titlebar_theme có phần xử lý _history_window
    assert "self._history_window" in content
    assert 'title="Query History — luoBTool IDE"' in content, (
        "apply_titlebar_theme must specify exact window title for DWM matching"
    )

    # 2. Kiểm tra _broadcast_settings có đẩy IPC tới _history_window
    assert "getattr(self, '_history_window', None)" in content or "self._history_window" in content
    assert "targets.append(self._history_window)" in content, (
        "_broadcast_settings must include _history_window in targets"
    )

    # 3. Kiểm tra open_query_history_window có timer áp dụng DWM
    assert "for delay in (0.05, 0.15, 0.3, 0.6, 1.0):" in content
    assert "threading.Timer(delay, lambda: self.apply_titlebar_theme()).start()" in content

    # 4. Kiểm tra QueryHistorySubwindowApi ủy nhiệm apply_titlebar_theme
    cm = ConnectionManager()
    main_api = MainApi(cm)
    sub_api = QueryHistorySubwindowApi(main_api)
    assert hasattr(sub_api, "apply_titlebar_theme"), "QueryHistorySubwindowApi must expose apply_titlebar_theme"

    # Mock window object để kiểm tra apply_titlebar_theme không quăng ngoại lệ
    class DummyWindow:
        def __init__(self):
            self.title = "Query History — luoBTool IDE"
            self.native = None

    main_api._history_window = DummyWindow()
    res = sub_api.apply_titlebar_theme(bg_hex="#0055ea", text_hex="#ffffff", border_hex="#2157d7", is_dark=True)
    assert res.get("success") is True, f"apply_titlebar_theme failed: {res}"
    print("[Pass] Test 1: main.py titlebar theming, delayed timers and IPC broadcast verified.")


def test_dwm_presets_and_color_conversion():
    """Kiểm tra bảng màu DWM presets và thuật toán chuyển đổi COLORREF."""
    assert len(THEME_TITLEBAR_PRESETS) >= 30, (
        f"Expected at least 30 theme presets from theme-registry.js, got {len(THEME_TITLEBAR_PRESETS)}"
    )

    # Kiểm tra các theme quan trọng
    for theme_id in ["dark", "light", "win-xp", "win-nt", "nord", "monokai", "tokyo-night-dark"]:
        assert theme_id in THEME_TITLEBAR_PRESETS, f"Theme '{theme_id}' missing in THEME_TITLEBAR_PRESETS"
        preset = THEME_TITLEBAR_PRESETS[theme_id]
        assert preset["bg"].startswith("#"), f"Theme '{theme_id}' bg must be hex string"
        assert preset["text"].startswith("#"), f"Theme '{theme_id}' text must be hex string"

    # Kiểm tra Win-XP Luna Blue và Win-NT Navy Blue
    assert THEME_TITLEBAR_PRESETS["win-xp"]["bg"] == "#0055ea"
    assert THEME_TITLEBAR_PRESETS["win-nt"]["bg"] == "#000080"

    # Kiểm tra chuyển đổi COLORREF (0x00BBGGRR)
    # #0055ea -> R=00, G=55, B=ea -> 0xEA5500
    ref_xp = hex_to_colorref("#0055ea")
    assert ref_xp == (0xEA << 16) | (0x55 << 8) | 0x00, f"COLORREF mismatch for XP: {hex(ref_xp)}"

    print("[Pass] Test 2: DWM presets (36 themes) and Win32 COLORREF conversion verified.")


def test_css_query_history_titlebar_sync():
    """Kiểm tra file static/css/query-history.css sử dụng các biến titlebar chuẩn."""
    css_path = ROOT_DIR / "static" / "css" / "query-history.css"
    assert css_path.exists(), "query-history.css must exist"
    content = css_path.read_text(encoding="utf-8")

    # .qh-toolbar
    assert ".qh-toolbar" in content
    assert "--ide-titlebar-bg" in content
    assert "--ide-titlebar-text" in content

    # .qh-statusbar
    assert ".qh-statusbar" in content
    assert "background-color: var(--ide-titlebar-bg" in content
    assert "color: var(--ide-titlebar-text" in content

    # Contrast adaptation
    assert ".qh-brand" in content
    assert "var(--ide-titlebar-text" in content

    print("[Pass] Test 3: CSS toolbar & statusbar titlebar variables synchronization verified.")


def test_js_query_history_sync_titlebar_logic():
    """Kiểm tra file static/js/query-history.js có logic đồng bộ titlebar native."""
    js_path = ROOT_DIR / "static" / "js" / "query-history.js"
    assert js_path.exists(), "query-history.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # syncNativeTitlebar function and calls
    assert "function syncNativeTitlebar(" in content
    assert "api.apply_titlebar_theme(" in content
    assert "window.applyHistoryTheme =" in content
    assert "window.onSettingsChanged =" in content
    assert "ide-theme-changed" in content
    assert "pywebviewready" in content

    # MutationObserver
    assert "themeObserver = new MutationObserver(" in content
    assert "syncNativeTitlebar(themeVal)" in content

    print("[Pass] Test 4: JS syncNativeTitlebar, MutationObserver & event listeners verified.")


def test_template_head_immediate_restore():
    """Kiểm tra template query_history_window.html khôi phục theme ngay từ head."""
    html_path = ROOT_DIR / "templates" / "query_history_window.html"
    assert html_path.exists(), "query_history_window.html must exist"
    content = html_path.read_text(encoding="utf-8")

    assert "localStorage.getItem('ide-theme')" in content
    assert "localStorage.getItem('ide-settings')" in content
    assert "document.documentElement.setAttribute('data-bs-theme'" in content
    assert "<title>Query History — luoBTool IDE</title>" in content

    print("[Pass] Test 5: query_history_window.html early head theme restore verified.")


def test_strict_constraints_and_distribution_sync():
    """Kiểm tra các ràng buộc: settings.json không bị ghi đè, dist được đồng bộ."""
    settings_file = ROOT_DIR / "data" / "settings.json"
    assert settings_file.exists(), "settings.json must exist"
    mtime_before = settings_file.stat().st_mtime

    # Gọi get_editor_settings qua sub api
    cm = ConnectionManager()
    main_api = MainApi(cm)
    sub_api = QueryHistorySubwindowApi(main_api)
    res = sub_api.get_editor_settings()
    assert res.get("success") is True

    mtime_after = settings_file.stat().st_mtime
    assert mtime_before == mtime_after, "data/settings.json must NEVER be modified!"

    # Kiểm tra dist/LLTool/_internal sync
    dist_dir = ROOT_DIR / "dist" / "LLTool" / "_internal"
    if dist_dir.exists():
        for rel in [
            "static/css/query-history.css",
            "static/js/query-history.js",
            "templates/query_history_window.html"
        ]:
            src_f = ROOT_DIR / rel
            dst_f = dist_dir / rel
            assert dst_f.exists(), f"Distribution file {dst_f} must exist"
            assert src_f.read_bytes() == dst_f.read_bytes(), f"Distribution file {rel} is out of sync!"

    print("[Pass] Test 6: Strict constraints and distribution file synchronization verified.")


if __name__ == "__main__":
    test_main_py_titlebar_and_broadcast_integration()
    test_dwm_presets_and_color_conversion()
    test_css_query_history_titlebar_sync()
    test_js_query_history_sync_titlebar_logic()
    test_template_head_immediate_restore()
    test_strict_constraints_and_distribution_sync()

    print("\n" + "=" * 60)
    print("ALL QUERY HISTORY TITLEBAR / TASKBAR SYNC TESTS PASSED!")
    print("=" * 60)
