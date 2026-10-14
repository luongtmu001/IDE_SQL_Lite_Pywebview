# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 2:
- explain_query must use conn.lock instead of non-existent adapter._lock.
- SET SHOWPLAN_TEXT OFF must always execute in a finally block even when query execution fails.
"""
import threading
from unittest.mock import MagicMock
import pytest
from main import MainApi


def test_explain_query_uses_conn_lock_and_disables_showplan_on_error():
    """Verify explain_query locks on conn.lock and turns off SHOWPLAN_TEXT in finally."""
    mock_cm = MagicMock()
    api = MainApi(mock_cm)

    # Mock session and adapter
    mock_session = MagicMock()
    mock_session.lock = threading.RLock()
    mock_adapter = MagicMock(spec=["db_type", "connection"])
    mock_adapter.db_type = "sqlserver"
    del mock_adapter._lock  # Ensure _lock does NOT exist

    mock_cursor = MagicMock()
    executed_statements = []

    def fake_execute(statement, *args, **kwargs):
        executed_statements.append(statement)
        if statement == "SELECT * FROM broken_syntax_table":
            raise Exception("SQL Server Execution Error")
        return MagicMock()

    mock_cursor.execute.side_effect = fake_execute
    mock_adapter.connection.cursor.return_value = mock_cursor
    mock_session.adapter = mock_adapter

    mock_cm.get_session.return_value = mock_session
    api._get_connection = MagicMock(return_value=mock_session)

    res = api.explain_query("conn_1", "SELECT * FROM broken_syntax_table")
    assert res["success"] is False
    assert "SQL Server Execution Error" in res["error"]

    # Verify SET SHOWPLAN_TEXT OFF was executed despite error
    assert "SET SHOWPLAN_TEXT ON" in executed_statements
    assert "SET SHOWPLAN_TEXT OFF" in executed_statements
