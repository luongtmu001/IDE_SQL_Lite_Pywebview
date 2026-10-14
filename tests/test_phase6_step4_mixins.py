# -*- coding: utf-8 -*-
"""
Tests for Phase 6 Step 4:
Mechanical extraction of MainApi and BravoApi domain mixins into app/api/ and app/bravo/api.py.
"""
import inspect
from pathlib import Path
from unittest.mock import MagicMock
import pytest

from app.api.connections_api import ConnectionsApiMixin
from app.api.settings_api import SettingsApiMixin
from app.api.table_editor_api import TableEditorApiMixin
from app.api.designer_api import DesignerApiMixin
from app.api.profiler_api import ProfilerApiMixin
from app.api.metadata_api import MetadataApiMixin, MainMetadataApiMixin
from app.bravo.api import BravoApiMixin
from app.api.query_api import QueryApiMixin
from app.api.history_api import HistoryApiMixin
from app.api.session_api import SessionApiMixin
from main import BravoApi, MainApi


def test_mixin_inheritance_and_mro():
    """Verify that BravoApi and MainApi properly inherit from all modular mixins."""
    # BravoApi mixins
    assert issubclass(BravoApi, SettingsApiMixin)
    assert issubclass(BravoApi, TableEditorApiMixin)
    assert issubclass(BravoApi, DesignerApiMixin)
    assert issubclass(BravoApi, MetadataApiMixin)
    assert issubclass(BravoApi, ConnectionsApiMixin)
    assert issubclass(BravoApi, ProfilerApiMixin)
    assert issubclass(BravoApi, BravoApiMixin)

    # MainApi mixins
    assert issubclass(MainApi, BravoApi)
    assert issubclass(MainApi, QueryApiMixin)
    assert issubclass(MainApi, HistoryApiMixin)
    assert issubclass(MainApi, SessionApiMixin)
    assert issubclass(MainApi, MainMetadataApiMixin)


def test_main_py_line_count_drastically_reduced():
    """Verify that main.py is now well under 600 lines."""
    main_py = Path(__file__).resolve().parent.parent / "main.py"
    lines = main_py.read_text(encoding="utf-8").splitlines()
    assert len(lines) < 600, f"main.py should be under 600 lines, currently {len(lines)}"


def test_main_api_runtime_mixin_dispatch():
    """Verify that methods on mixins are callable and correctly bound to MainApi instance."""
    mock_cm = MagicMock()
    api = MainApi(cm=mock_cm)

    # From ConnectionsApiMixin
    assert hasattr(api, "get_saved_connections")
    assert callable(api.get_saved_connections)

    # From SettingsApiMixin
    assert hasattr(api, "get_settings")
    assert callable(api.get_settings)

    # From TableEditorApiMixin
    assert hasattr(api, "tx_status")
    assert callable(api.tx_status)

    # From DesignerApiMixin
    assert hasattr(api, "get_table_design")
    assert callable(api.get_table_design)

    # From MetadataApiMixin & MainMetadataApiMixin
    assert hasattr(api, "get_databases")
    assert hasattr(api, "get_tables")
    assert hasattr(api, "pg_dependency_get_column")

    # From BravoApiMixin
    assert hasattr(api, "get_program_list")
    assert hasattr(api, "layout_editor_list")

    # From QueryApiMixin
    assert hasattr(api, "execute_query")
    assert hasattr(api, "syntax_check")

    # From HistoryApiMixin
    assert hasattr(api, "history_get_stats")
    assert hasattr(api, "history_log_execution")

    # From SessionApiMixin
    assert hasattr(api, "session_save")
    assert hasattr(api, "session_load")


def test_bravo_api_does_not_leak_main_only_methods():
    """Ensure BravoApi does not accidentally expose MainApi-only methods."""
    bravo_methods = {m for m in dir(BravoApi) if not m.startswith("_")}
    assert "execute_query" not in bravo_methods
    assert "history_log_execution" not in bravo_methods
    assert "session_save" not in bravo_methods
    assert "get_tables" not in bravo_methods
    assert "pg_dependency_get_column" not in bravo_methods
