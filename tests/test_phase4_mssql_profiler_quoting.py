"""
Tests for Phase 4: Quoting and escaping in mssql_profiler.py.
"""
from unittest.mock import MagicMock, patch
import pytest
from app.services.profiler.mssql_profiler import MssqlProfilerSession


def test_mssql_profiler_session_quotes_name():
    session = MssqlProfilerSession(
        session_id="test-session]--evil",
        conn_config={"username": "sa", "password": "pw", "server": "localhost"},
        xe_session_name="luoBTool_XE_test]--evil"
    )

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    session._create_connection = MagicMock(return_value=mock_conn)

    session._init_session()

    executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list]

    # Verify session name is properly escaped and quoted
    # Must use [luoBTool_XE_test]]--evil]
    assert any("[luoBTool_XE_test]]--evil]" in sql for sql in executed_sqls)
    # Check drop statement
    assert any("DROP EVENT SESSION [luoBTool_XE_test]]--evil] ON SERVER;" in sql for sql in executed_sqls)
    # Check start statement
    assert any("ALTER EVENT SESSION [luoBTool_XE_test]]--evil] ON SERVER STATE = START;" in sql for sql in executed_sqls)
