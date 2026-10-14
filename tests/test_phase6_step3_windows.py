# -*- coding: utf-8 -*-
"""
Tests for Phase 6 Step 3: Extracted window management:
- app.desktop.windows (QueryHistorySubwindowApi, SettingsSubwindowApi, ProfilerSubwindowApi, EventListenerSubwindowApi)
- Window opening helpers (open_settings_window, open_profiler_window, open_event_listener_window, open_query_history_window)
- apply_titlebar_theme_to_windows, broadcast_settings
"""
from unittest.mock import MagicMock, patch
import pytest

from app.desktop.windows import (
    QueryHistorySubwindowApi,
    SettingsSubwindowApi,
    ProfilerSubwindowApi,
    EventListenerSubwindowApi,
    open_settings_window,
    open_profiler_window,
    open_event_listener_window,
    open_query_history_window,
    apply_titlebar_theme_to_windows,
)


def test_subwindow_apis_instantiation_and_lifecycle():
    mock_main_api = MagicMock()
    mock_win = MagicMock()

    # QueryHistorySubwindowApi
    hist_api = QueryHistorySubwindowApi(mock_main_api)
    hist_api.set_window(mock_win)
    assert hist_api.close_window()["success"] is True
    mock_win.destroy.assert_called_once()

    # SettingsSubwindowApi
    settings_api = SettingsSubwindowApi(mock_main_api)
    mock_main_api.get_settings.return_value = {"theme": "dark"}
    assert settings_api.get_settings() == {"theme": "dark"}

    # ProfilerSubwindowApi
    prof_api = ProfilerSubwindowApi(mock_main_api)
    mock_main_api.profiler_start_trace.return_value = {"success": True}
    res = prof_api.profiler_start_trace(conn_id="conn1")
    assert res["success"] is True

    # EventListenerSubwindowApi
    el_api = EventListenerSubwindowApi(mock_main_api)
    assert hasattr(el_api, "el_discover_local_backends")


def test_open_settings_window_creates_webview_window():
    mock_api = MagicMock()
    mock_api._settings_window = None
    mock_win = MagicMock()

    with patch("webview.create_window", return_value=mock_win) as mock_create:
        res = open_settings_window(mock_api)
        assert res["success"] is True
        mock_create.assert_called_once()
        assert mock_api._settings_window == mock_win


def test_apply_titlebar_theme_to_windows():
    mock_api = MagicMock()
    mock_win = MagicMock()
    mock_win.native = None
    mock_win.title = "luoBTool IDE"
    mock_api._window = mock_win
    mock_api._main_api = None
    mock_api._current_titlebar_theme = None

    with patch("app.desktop.windows.apply_dwm_titlebar_theme") as mock_dwm:
        res = apply_titlebar_theme_to_windows(mock_api, bg_hex="#1e1e1e", text_hex="#ffffff", is_dark=True)
        assert res["success"] is True
        mock_dwm.assert_called()
        assert mock_api._current_titlebar_theme["bg"] == "#1e1e1e"
