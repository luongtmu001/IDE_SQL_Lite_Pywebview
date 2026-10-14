# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 1:
USE [db] errors must not be swallowed; must raise RuntimeError with clear message.
"""
from unittest.mock import MagicMock
import pytest
from app.database.sqlserver import SqlServerAdapter
from app.services.table_data_editor_service import TableDataEditorService


def test_sqlserver_execute_swallowed_use_db_raises():
    """Verify sqlserver.execute does not swallow USE [db] exceptions."""
    adapter = SqlServerAdapter({"server": "localhost", "database": "master"})
    mock_cursor = MagicMock()
    mock_cursor.messages = []
    mock_cursor.description = None
    mock_cursor.nextset.return_value = False
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    def mock_cursor_execute(sql, *args, **kwargs):
        if sql.startswith("USE ["):
            raise Exception("Database 'non_existent_db' does not exist")
        return MagicMock()

    mock_cursor.execute.side_effect = mock_cursor_execute
    adapter.connection = mock_conn

    with pytest.raises(RuntimeError, match="Không thể chuyển ngữ cảnh sang database"):
        adapter.execute("SELECT 1", database="non_existent_db")


def test_sqlserver_execute_migration_transaction_use_db_raises():
    """Verify sqlserver.execute_migration_transaction does not swallow USE [db] exceptions."""
    adapter = SqlServerAdapter({"server": "localhost", "database": "master"})
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    def mock_cursor_execute(sql, *args, **kwargs):
        if sql.startswith("USE ["):
            raise Exception("Database 'non_existent_db' does not exist")
        return MagicMock()

    mock_cursor.execute.side_effect = mock_cursor_execute
    adapter.connection = mock_conn

    with pytest.raises(RuntimeError, match="Không thể chuyển ngữ cảnh sang database"):
        adapter.execute_migration_transaction(["CREATE TABLE t (id INT)"], database="non_existent_db")


def test_table_data_editor_service_use_db_raises():
    """Verify table_data_editor_service does not swallow USE [db] exceptions."""
    service = TableDataEditorService()
    mock_adapter = MagicMock()
    mock_adapter.engine = "sqlserver"
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_adapter.connection = mock_conn

    def mock_cursor_execute(sql, *args, **kwargs):
        if sql.startswith("USE ["):
            raise Exception("Database 'non_existent_db' does not exist")
        return MagicMock()

    mock_cursor.execute.side_effect = mock_cursor_execute

    with pytest.raises(RuntimeError, match="Không thể chuyển ngữ cảnh sang database"):
        TableDataEditorService.submit_changes(
            adapter=mock_adapter,
            database="non_existent_db",
            schema="dbo",
            table="Users",
            changes={"updates": [{"pk": {"id": 1}, "values": {"name": "Bob"}}]},
        )
