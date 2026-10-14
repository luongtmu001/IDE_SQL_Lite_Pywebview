# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 9:
- PostgreSQL sequence synchronization with setval uses SAVEPOINT and qualified schema
- Only executes when an explicit identity value is actually inserted
- Failure in setval rolls back to SAVEPOINT so transaction is not corrupted
"""
from unittest.mock import MagicMock, patch
import pytest
from app.services.table_data_editor_service import TableDataEditorService


@pytest.fixture
def mock_adapter():
    adapter = MagicMock()
    adapter.db_type = "postgresql"
    mock_conn = MagicMock()
    mock_conn.autocommit = True
    adapter.connection = mock_conn
    return adapter


def test_setval_not_called_when_no_explicit_identity(mock_adapter):
    """When inserting without explicit identity column value, setval must NOT run."""
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 1
    mock_cursor.nextset.return_value = False
    mock_adapter.connection.cursor.return_value = mock_cursor

    changes = {
        "inserts": [{"data": {"name": "Test item"}}],
        "updates": [],
        "deletes": [],
    }

    with patch.object(TableDataEditorService, "get_metadata", return_value={"identity_columns": ["id"]}):
        res = TableDataEditorService.submit_changes(
            adapter=mock_adapter,
            database="testdb",
            schema="public",
            table="products",
            changes=changes,
        )

    assert res.get("success") is True
    executed_sqls = [str(call[0][0]) for call in mock_cursor.execute.call_args_list]
    # setval must not be executed
    assert not any("setval" in s.lower() for s in executed_sqls)
    assert not any("sp_setval" in s for s in executed_sqls)


def test_setval_called_with_savepoint_when_explicit_identity(mock_adapter):
    """When explicit identity is inserted, setval runs within SAVEPOINT."""
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 1
    mock_cursor.nextset.return_value = False
    mock_adapter.connection.cursor.return_value = mock_cursor

    changes = {
        "inserts": [{"data": {"id": 100, "name": "Explicit item"}}],
        "updates": [],
        "deletes": [],
    }

    with patch.object(TableDataEditorService, "get_metadata", return_value={"identity_columns": ["id"]}):
        res = TableDataEditorService.submit_changes(
            adapter=mock_adapter,
            database="testdb",
            schema="myschema",
            table="products",
            changes=changes,
        )

    assert res.get("success") is True
    executed_sqls = [str(call[0][0]) for call in mock_cursor.execute.call_args_list]
    assert any("SAVEPOINT sp_setval" in s for s in executed_sqls)
    assert any("setval" in s.lower() for s in executed_sqls)
    assert any("RELEASE SAVEPOINT sp_setval" in s for s in executed_sqls)


def test_setval_failure_rolls_back_to_savepoint(mock_adapter):
    """When setval fails, it rolls back to SAVEPOINT without aborting transaction."""
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 1
    mock_cursor.nextset.return_value = False

    def execute_side_effect(sql, *args, **kwargs):
        if "setval" in str(sql).lower():
            raise Exception("relation sequence does not exist")
        return None

    mock_cursor.execute.side_effect = execute_side_effect
    mock_adapter.connection.cursor.return_value = mock_cursor

    changes = {
        "inserts": [{"data": {"id": 100, "name": "Item with non-existent seq"}}],
        "updates": [],
        "deletes": [],
    }

    with patch.object(TableDataEditorService, "get_metadata", return_value={"identity_columns": ["id"]}):
        res = TableDataEditorService.submit_changes(
            adapter=mock_adapter,
            database="testdb",
            schema="myschema",
            table="products",
            changes=changes,
        )

    assert res.get("success") is True
    executed_sqls = [str(call[0][0]) for call in mock_cursor.execute.call_args_list]
    assert any("ROLLBACK TO SAVEPOINT sp_setval" in s for s in executed_sqls)
