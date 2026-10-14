# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 10:
- update_row and delete_row must not default to 1 affected when 0 rows were updated/deleted.
- submit_changes must check rowcount in all concurrency modes (including non-optimistic)
  and fail if 0 rows were affected.
"""
from unittest.mock import MagicMock, patch
import pytest
from app.services.table_data_editor_service import TableDataEditorService


def test_update_row_reports_actual_zero_affected():
    """Verify update_row reports affected=0 when execute returns 0 rows affected."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {"success": True, "total_affected": 0, "row_count": 0}

    res = TableDataEditorService.update_row(
        adapter=adapter,
        database="testdb",
        schema="dbo",
        table="users",
        pk_conditions={"id": 99999},
        changes={"name": "New Name"}
    )

    assert res["success"] is True
    assert res["affected"] == 0, f"Expected affected=0, got {res['affected']}"


def test_delete_row_reports_actual_zero_affected():
    """Verify delete_row reports affected=0 when execute returns 0 rows affected."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {"success": True, "total_affected": 0, "row_count": 0}

    res = TableDataEditorService.delete_row(
        adapter=adapter,
        database="testdb",
        schema="dbo",
        table="users",
        pk_conditions={"id": 99999}
    )

    assert res["success"] is True
    assert res["affected"] == 0, f"Expected affected=0, got {res['affected']}"


def test_update_row_defaults_to_0_when_row_count_missing():
    """Verify update_row defaults to 0 (not 1) when execute result lacks row_count."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {"success": True}

    res = TableDataEditorService.update_row(
        adapter=adapter,
        database="testdb",
        schema="dbo",
        table="users",
        pk_conditions={"id": 1},
        changes={"name": "New Name"}
    )
    assert res["affected"] == 0


def test_delete_row_defaults_to_0_when_row_count_missing():
    """Verify delete_row defaults to 0 (not 1) when execute result lacks row_count."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.execute.return_value = {"success": True}

    res = TableDataEditorService.delete_row(
        adapter=adapter,
        database="testdb",
        schema="dbo",
        table="users",
        pk_conditions={"id": 1}
    )
    assert res["affected"] == 0


def test_submit_changes_checks_rowcount_in_non_optimistic_mode_update():
    """Verify submit_changes checks rowcount in non-optimistic mode and raises on 0 rows affected."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 0  # 0 rows affected
    mock_cursor.nextset.return_value = False
    mock_conn.cursor.return_value = mock_cursor
    adapter.connection = mock_conn

    changes = {
        "inserts": [],
        "updates": [{"keys": {"id": 999}, "modified_data": {"name": "Changed"}}],
        "deletes": []
    }

    with patch.object(TableDataEditorService, "get_metadata", return_value={"pk_columns": ["id"]}):
        with pytest.raises(RuntimeError, match="(?i)khóa|rowcount|0 dòng"):
            TableDataEditorService.submit_changes(
                adapter=adapter,
                database="testdb",
                schema="dbo",
                table="users",
                changes=changes,
                concurrency_mode="last_wins"
            )


def test_submit_changes_checks_rowcount_in_non_optimistic_mode_delete():
    """Verify submit_changes checks rowcount in non-optimistic delete and raises on 0 rows affected."""
    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 0  # 0 rows affected
    mock_cursor.nextset.return_value = False
    mock_conn.cursor.return_value = mock_cursor
    adapter.connection = mock_conn

    changes = {
        "inserts": [],
        "updates": [],
        "deletes": [{"keys": {"id": 999}}]
    }

    with patch.object(TableDataEditorService, "get_metadata", return_value={"pk_columns": ["id"]}):
        with pytest.raises(RuntimeError, match="(?i)khóa|rowcount|0 dòng"):
            TableDataEditorService.submit_changes(
                adapter=adapter,
                database="testdb",
                schema="dbo",
                table="users",
                changes=changes,
                concurrency_mode="last_wins"
            )
