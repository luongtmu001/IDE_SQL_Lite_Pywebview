# -*- coding: utf-8 -*-
"""
Tests for PostgreSQL adapter enhancements and desktop syntax check pipeline integration.
Verifies:
1. ScriptDOM adapter loads from local bundled app/database/syntax/bin/
2. MainApi.syntax_check calls validate_sql_pipeline
3. PostgreSqlAdapter parameter resolution (server/host, user/username, sslmode)
4. PostgreSqlAdapter._ensure_database synchronizes ConnectionSession.config["database"]
5. PostgreSqlAdapter quotes and escapes search_path safely
"""
import os
import pytest
from unittest.mock import MagicMock, patch

from app.database.syntax.adapters.sqlserver_scriptdom import SqlServerScriptDomAdapter
from app.database.postgresql import PostgreSqlAdapter


def test_scriptdom_bundled_dll_located():
    """Verify SqlServerScriptDomAdapter locates the local bundled DLL in app/database/syntax/bin."""
    adapter = SqlServerScriptDomAdapter()
    assert adapter._dll_path is not None, "ScriptDOM DLL must be located"
    assert os.path.exists(adapter._dll_path), f"DLL file must exist at {adapter._dll_path}"
    assert "Microsoft.SqlServer.TransactSql.ScriptDom.dll" in adapter._dll_path
    assert adapter.is_available is True, "ScriptDOM adapter must be available"


def test_mainapi_syntax_check_calls_pipeline():
    """Verify MainApi.syntax_check in main.py executes validate_sql_pipeline."""
    from main import MainApi

    api = MainApi()
    test_sql = "SELECT 1 AS val;"

    with patch("app.database.syntax.coordinator.validate_sql_pipeline") as mock_pipeline:
        mock_pipeline.return_value = [{"line": 1, "message": "test", "severity": "info"}]

        res = api.syntax_check(
            sql=test_sql,
            dialect="sqlserver",
            connection_id=None,
            database="master",
            schema="dbo",
            is_debug=False,
            cached_tables=None,
        )

        assert res["success"] is True
        assert len(res["diagnostics"]) == 1
        assert res["diagnostics"][0]["message"] == "test"
        mock_pipeline.assert_called_once()


def test_postgresql_build_conn_params_aliases():
    """Verify _build_conn_params resolves server/user aliases and sslmode."""
    cfg = {
        "server": "192.168.1.100",
        "port": 5433,
        "database": "analytics_db",
        "user": "analyst",
        "password": "secret_pwd",
        "timeout": 15,
        "sslmode": "require",
        "application_name": "custom_app",
    }
    adapter = PostgreSqlAdapter(cfg)
    params = adapter._build_conn_params()

    assert params["host"] == "192.168.1.100"
    assert params["port"] == 5433
    assert params["dbname"] == "analytics_db"
    assert params["user"] == "analyst"
    assert params["password"] == "secret_pwd"
    assert params["connect_timeout"] == 15
    assert params["sslmode"] == "require"
    assert params["application_name"] == "custom_app"


def test_postgresql_ensure_database_syncs_session():
    """Verify _ensure_database updates both adapter.config and session.config."""
    cfg = {"database": "initial_db", "host": "localhost"}
    adapter = PostgreSqlAdapter(cfg)

    # Mock connection session attached to adapter
    mock_session = MagicMock()
    mock_session.config = {"database": "initial_db", "host": "localhost"}
    adapter.session = mock_session

    with patch.object(adapter, "connect") as mock_connect:
        adapter._ensure_database("new_db")
        assert adapter.config["database"] == "new_db"
        assert mock_session.config["database"] == "new_db"
        mock_connect.assert_called_once()


def test_postgresql_search_path_escaping():
    """Verify search_path escapes quotes safely."""
    adapter = PostgreSqlAdapter({"database": "test_db"})
    mock_conn = MagicMock()
    mock_conn.closed = False
    mock_cursor = MagicMock()
    mock_cursor.description = None
    mock_cursor.rowcount = 0
    mock_cursor.nextset.return_value = False
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    adapter.connection = mock_conn

    # Schema containing quotes
    schema_with_quotes = 'my"schema'
    adapter.execute("SELECT 1;", schema=schema_with_quotes)

    # Verify SET search_path was executed with escaped quotes: "my""schema"
    executed_statements = [call[0][0] for call in mock_cursor.execute.call_args_list]
    set_path_calls = [s for s in executed_statements if isinstance(s, str) and "SET search_path" in s]
    assert len(set_path_calls) == 1
    assert set_path_calls[0] == 'SET search_path TO "my""schema"'
