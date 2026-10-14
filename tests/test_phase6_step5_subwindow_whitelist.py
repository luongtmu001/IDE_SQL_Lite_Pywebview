# -*- coding: utf-8 -*-
"""
Tests for Phase 6 Step 5:
Explicit whitelist for subwindow APIs (removal of __getattr__ catch-all delegation).
"""
import pytest
from unittest.mock import MagicMock

from app.desktop.windows import (
    QueryHistorySubwindowApi,
    SettingsSubwindowApi,
    ProfilerSubwindowApi,
    EventListenerSubwindowApi,
)


def test_subwindows_have_no_getattr_catchall():
    """Verify that none of the subwindow API classes have __getattr__."""
    for cls in (
        QueryHistorySubwindowApi,
        SettingsSubwindowApi,
        ProfilerSubwindowApi,
        EventListenerSubwindowApi,
    ):
        assert "__getattr__" not in cls.__dict__, f"{cls.__name__} must not have __getattr__"


def test_subwindow_unauthorized_method_raises_attribute_error():
    """Verify that invoking unauthorized/non-whitelisted methods raises AttributeError."""
    mock_main_api = MagicMock()
    mock_main_api.execute_query = MagicMock(return_value={"success": True})
    mock_main_api.delete_connection = MagicMock(return_value={"success": True})

    settings_api = SettingsSubwindowApi(mock_main_api)
    profiler_api = ProfilerSubwindowApi(mock_main_api)
    history_api = QueryHistorySubwindowApi(mock_main_api)
    listener_api = EventListenerSubwindowApi(mock_main_api)

    # execute_query must not be accessible on subwindow APIs
    with pytest.raises(AttributeError):
        _ = settings_api.execute_query

    with pytest.raises(AttributeError):
        _ = profiler_api.execute_query

    with pytest.raises(AttributeError):
        _ = history_api.execute_query

    with pytest.raises(AttributeError):
        _ = listener_api.execute_query


def test_subwindow_whitelisted_methods_work():
    """Verify that whitelisted methods correctly delegate to _main_api."""
    mock_main_api = MagicMock()
    mock_main_api.history_get_stats.return_value = {"success": True, "stats": {}}
    mock_main_api.profiler_list_connections.return_value = {"success": True, "connections": []}
    mock_main_api.set_clipboard_text.return_value = {"success": True}

    settings_api = SettingsSubwindowApi(mock_main_api)
    res_stats = settings_api.history_get_stats()
    assert res_stats["success"] is True
    mock_main_api.history_get_stats.assert_called_once()

    profiler_api = ProfilerSubwindowApi(mock_main_api)
    res_prof = profiler_api.profiler_list_connections()
    assert res_prof["success"] is True
    mock_main_api.profiler_list_connections.assert_called_once()

    listener_api = EventListenerSubwindowApi(mock_main_api)
    res_clip = listener_api.set_clipboard_text("test")
    assert res_clip["success"] is True
    mock_main_api.set_clipboard_text.assert_called_once_with("test")
