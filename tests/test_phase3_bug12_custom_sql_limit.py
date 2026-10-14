# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 12:
- fetch_data with custom_sql must apply a row limit instead of limit=None
- Uses top_n if provided, or defaults to MAX_QUERY_ROWS from Config
"""
from unittest.mock import MagicMock, patch
import pytest
from app.services.table_data_editor_service import TableDataEditorService
from config import Config


def test_fetch_data_custom_sql_applies_top_n_limit():
    """Verify custom_sql applies top_n as the execute limit."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {
        "success": True,
        "columns": ["id"],
        "rows": [[1]],
        "row_count": 1,
    }

    res = TableDataEditorService.fetch_data(
        adapter=adapter,
        database="testdb",
        schema="dbo",
        table="users",
        top_n=250,
        custom_sql="SELECT * FROM users WHERE active = 1"
    )

    assert res["row_count"] == 1
    adapter.execute.assert_called_once()
    assert adapter.execute.call_args.kwargs.get("limit") == 250


def test_fetch_data_custom_sql_applies_max_query_rows_default():
    """Verify custom_sql falls back to Config.MAX_QUERY_ROWS when top_n is None or 0."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {
        "success": True,
        "columns": ["id"],
        "rows": [[1]],
        "row_count": 1,
    }

    with patch.object(Config, "MAX_QUERY_ROWS", 500):
        TableDataEditorService.fetch_data(
            adapter=adapter,
            database="testdb",
            schema="dbo",
            table="users",
            top_n=None,
            custom_sql="SELECT * FROM users"
        )

    assert adapter.execute.call_args.kwargs.get("limit") == 500
