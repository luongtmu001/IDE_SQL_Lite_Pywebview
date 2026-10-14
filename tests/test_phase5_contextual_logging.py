# -*- coding: utf-8 -*-
import logging
from unittest.mock import MagicMock
import pytest

from app.models.connection_session import ConnectionSession
from app.services.connection_manager import ConnectionManager
from app.services.profiler.mssql_profiler import cleanup_orphaned_sessions


def test_connection_session_logs_contextually_on_adapter_close_failure(caplog):
    mock_adapter = MagicMock()
    mock_adapter.close.side_effect = RuntimeError("Broken pipe")

    session = ConnectionSession(
        connection_id="conn_log_test",
        owner_session_id="test_user",
        config={"type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )

    with caplog.at_level(logging.WARNING, logger="luobtool.connection_session"):
        session.close()

    assert any("Error closing adapter" in record.message for record in caplog.records)


def test_connection_manager_logs_contextually_on_close_error(caplog):
    cm = ConnectionManager()
    mock_adapter = MagicMock()
    mock_adapter.close.side_effect = RuntimeError("Network timeout")

    session = ConnectionSession(
        connection_id="conn_cm_log",
        owner_session_id="user1",
        config={"type": "sqlserver"},
        adapter=mock_adapter,
        metadata_service=None,
        query_service=None,
    )
    with cm._lock:
        cm._connections["conn_cm_log"] = session

    with caplog.at_level(logging.WARNING, logger="luobtool.connection_manager"):
        try:
            cm.close("user1", "conn_cm_log")
        except RuntimeError:
            pass

    assert any("Error closing adapter for connection conn_cm_log" in record.message for record in caplog.records)


def test_profiler_logs_contextually_on_drop_failure(caplog):
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_cursor.execute.side_effect = RuntimeError("XE engine busy")

    with caplog.at_level(logging.WARNING, logger="luobtool.profiler.mssql"):
        dropped = cleanup_orphaned_sessions(mock_conn, session_names=["luoBTool_XE_failing"])

    assert dropped == 0
    assert any("Failed to drop orphaned XE session luoBTool_XE_failing" in record.message for record in caplog.records)
