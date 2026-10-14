# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 8:
- PostgreSQL adapter _build_conn_params handles 'server', 'host', and parses host:port
- sslmode support (default unchanged, handles ssl=True and sslmode string)
- search_path escaping double quotes properly
- _ensure_database rolls back self.config and session.config on connection failure
"""
from unittest.mock import MagicMock, patch
import pytest
from app.database.postgresql import PostgreSqlAdapter


def test_build_conn_params_server_and_port():
    """Verify _build_conn_params correctly picks server and port."""
    # 1. Server with separate port
    adapter1 = PostgreSqlAdapter({"server": "pg.internal.corp", "port": 5439, "database": "testdb"})
    params1 = adapter1._build_conn_params()
    assert params1["host"] == "pg.internal.corp"
    assert params1["port"] == 5439

    # 2. Server containing host:port
    adapter2 = PostgreSqlAdapter({"server": "pg.internal.corp:5440", "database": "testdb"})
    params2 = adapter2._build_conn_params()
    assert params2["host"] == "pg.internal.corp"
    assert params2["port"] == 5440

    # 3. Server containing host,port
    adapter3 = PostgreSqlAdapter({"server": "pg.internal.corp,5441", "database": "testdb"})
    params3 = adapter3._build_conn_params()
    assert params3["host"] == "pg.internal.corp"
    assert params3["port"] == 5441


def test_build_conn_params_sslmode():
    """Verify sslmode options in _build_conn_params."""
    # Explicit sslmode string
    adapter1 = PostgreSqlAdapter({"host": "localhost", "sslmode": "verify-full"})
    assert adapter1._build_conn_params().get("sslmode") == "verify-full"

    # ssl=True maps to require
    adapter2 = PostgreSqlAdapter({"host": "localhost", "ssl": True})
    assert adapter2._build_conn_params().get("sslmode") == "require"

    # Default: no sslmode injected if not specified
    adapter3 = PostgreSqlAdapter({"host": "localhost"})
    assert "sslmode" not in adapter3._build_conn_params()


def test_search_path_escapes_double_quotes():
    """Verify search_path escapes embedded double quotes."""
    adapter = PostgreSqlAdapter({"host": "localhost", "database": "testdb"})
    mock_conn = MagicMock()
    mock_conn.closed = False
    mock_cursor = MagicMock()
    mock_cursor.nextset.return_value = False
    mock_cursor.description = None
    mock_cursor.rowcount = 1
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    adapter.connection = mock_conn

    # Schema with embedded quotes
    adapter.execute("SELECT 1;", schema='my"schema')
    calls = [str(call) for call in mock_cursor.execute.call_args_list]
    assert any('SET search_path TO "my""schema"' in c for c in calls)


def test_ensure_database_rolls_back_config_on_failure():
    """Verify _ensure_database rolls back config and session.config if reconnect fails."""
    adapter = PostgreSqlAdapter({"host": "localhost", "database": "original_db"})
    mock_session = MagicMock()
    mock_session.config = {"database": "original_db"}
    adapter.session = mock_session

    with patch.object(adapter, "connect", side_effect=Exception("Database bad_db does not exist")):
        with pytest.raises(Exception, match="does not exist"):
            adapter._ensure_database("bad_db")

    # Configs must be rolled back, NOT corrupted to bad_db
    assert adapter.config["database"] == "original_db"
    assert mock_session.config["database"] == "original_db"
