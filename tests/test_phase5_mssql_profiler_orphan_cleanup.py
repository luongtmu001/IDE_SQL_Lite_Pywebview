# -*- coding: utf-8 -*-
from unittest.mock import MagicMock
import pytest

from app.services.profiler.mssql_profiler import (
    MssqlProfilerSession,
    list_orphaned_sessions,
    cleanup_orphaned_sessions,
)
import app.services.profiler.mssql_profiler as mssql_profiler_mod


def test_permission_docs_present():
    """Verify that required SQL Server permissions are explicitly documented in module docstrings."""
    doc = mssql_profiler_mod.__doc__ or ""
    assert "ALTER ANY EVENT SESSION" in doc
    assert "VIEW SERVER STATE" in doc or "VIEW SERVER PERFORMANCE STATE" in doc


def test_list_orphaned_sessions():
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    mock_cursor.fetchall.return_value = [
        ("luoBTool_XE_abc123", 101, 1),
        ("luoBTool_XE_def456", 102, 0),
    ]

    sessions = list_orphaned_sessions(mock_conn)

    assert len(sessions) == 2
    assert sessions[0]["name"] == "luoBTool_XE_abc123"
    assert sessions[0]["is_running"] is True
    assert sessions[1]["name"] == "luoBTool_XE_def456"
    assert sessions[1]["is_running"] is False

    sql_called = mock_cursor.execute.call_args[0][0]
    assert "LIKE 'luoBTool_XE_%'" in sql_called


def test_cleanup_orphaned_sessions_all():
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    # First fetch for list_orphaned_sessions
    mock_cursor.fetchall.return_value = [
        ("luoBTool_XE_session_1", 10, 1),
        ("luoBTool_XE_session_2", 11, 0),
    ]

    dropped = cleanup_orphaned_sessions(mock_conn)

    assert dropped == 2
    # Check that DROP statements were executed
    executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
    drop_sqls = [s for s in executed_sqls if "DROP EVENT SESSION" in s]
    assert len(drop_sqls) == 2
    assert "[luoBTool_XE_session_1]" in drop_sqls[0]
    assert "[luoBTool_XE_session_2]" in drop_sqls[1]


def test_cleanup_orphaned_sessions_safety_rejects_non_luobtool_prefix():
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor

    targets = [
        "system_health",
        "telemetry_xevents",
        "AlwaysOn_health",
        "luoBTool_XE_safe",
    ]

    dropped = cleanup_orphaned_sessions(mock_conn, session_names=targets)

    assert dropped == 1
    executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]
    for sql in executed_sqls:
        assert "system_health" not in sql
        assert "telemetry_xevents" not in sql
        assert "AlwaysOn_health" not in sql
    assert any("luoBTool_XE_safe" in s for s in executed_sqls)


def test_class_methods_match_module_functions():
    assert hasattr(MssqlProfilerSession, "list_orphaned_sessions")
    assert hasattr(MssqlProfilerSession, "cleanup_orphaned_sessions")
