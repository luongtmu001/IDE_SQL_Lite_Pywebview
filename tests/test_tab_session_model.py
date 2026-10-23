"""
tests/test_tab_session_model.py

Unit and integration tests for Per-Tab Session Model (GĐ4 & GĐ3).
Validates that each tab gets an independent connection session with SPID,
and that closing a tab closes its dedicated session cleanly.
"""

from unittest.mock import MagicMock
from app.services.connection_manager import ConnectionManager
from app.models.connection_session import ConnectionSession
from app.database.syntax.semantic_analyzer import (
    _PHYSICAL_TABLE_COLUMNS_CACHE,
    _set_cached_columns,
    _get_cached_columns,
    invalidate_physical_table_columns_cache,
)


def test_tab_session_lifecycle():
    cm = ConnectionManager()
    owner_id = "test_owner_sess"

    # Mock adapter factory
    mock_adapter_1 = MagicMock()
    mock_adapter_1.spid = 55
    mock_adapter_1.is_alive.return_value = True

    mock_adapter_2 = MagicMock()
    mock_adapter_2.spid = 56
    mock_adapter_2.is_alive.return_value = True

    # Pre-populate cached password
    config = {
        "type": "sqlserver",
        "server": "localhost",
        "port": 1433,
        "database": "master",
        "username": "sa",
        "name": "Local_MSSQL"
    }
    cm.set_cached_password(config, "secret123")

    # Mock create to return sessions with our mock adapters
    original_create = cm.create
    created_count = 0

    def mock_create(owner_session_id, cfg):
        nonlocal created_count
        created_count += 1
        adapter = mock_adapter_1 if created_count == 1 else mock_adapter_2
        conn_id = f"conn_test_{created_count}"
        conn = ConnectionSession(
            connection_id=conn_id,
            owner_session_id=owner_session_id,
            config=cfg,
            adapter=adapter,
            metadata_service=None,
            query_service=None,
        )
        with cm._lock:
            cm._connections[conn_id] = conn
        return conn

    cm.create = mock_create

    # 1. Create tab session for Tab-1
    conn_tab1 = cm.get_or_create_for_tab(owner_id, "tab-1", config=config)
    assert conn_tab1 is not None
    assert conn_tab1.tab_id == "tab-1"
    info1 = conn_tab1.public_info()
    assert info1["spid"] == 55
    assert info1["tab_id"] == "tab-1"

    # 2. Create tab session for Tab-2
    conn_tab2 = cm.get_or_create_for_tab(owner_id, "tab-2", config=config)
    assert conn_tab2 is not None
    assert conn_tab2.tab_id == "tab-2"
    info2 = conn_tab2.public_info()
    assert info2["spid"] == 56
    assert info2["tab_id"] == "tab-2"

    # Tab 1 and Tab 2 have distinct connection sessions (different SPIDs)
    assert conn_tab1.connection_id != conn_tab2.connection_id
    assert info1["spid"] != info2["spid"]

    # Re-requesting Tab-1 returns the existing active session
    conn_tab1_again = cm.get_or_create_for_tab(owner_id, "tab-1", config=config)
    assert conn_tab1_again.connection_id == conn_tab1.connection_id

    # 3. Close Tab-1
    closed = cm.close_for_tab(owner_id, "tab-1")
    assert closed == 1
    assert mock_adapter_1.close.called

    # Tab-2 remains untouched and alive
    assert conn_tab2.connection_id in cm._connections
    assert not mock_adapter_2.close.called


def test_cache_invalidation_per_connection():
    # Cache key format: (connection_id, dialect, server_lower, database_lower, schema_lower, table_lower)
    key_conn1 = ("conn_1", "sqlserver", "", "tempdb", "dbo", "#kqt")
    key_conn2 = ("conn_2", "sqlserver", "", "tempdb", "dbo", "#kqt")

    _set_cached_columns(key_conn1, {"id", "account"})
    _set_cached_columns(key_conn2, {"id", "total"})

    assert _get_cached_columns(key_conn1) == {"id", "account"}
    assert _get_cached_columns(key_conn2) == {"id", "total"}

    # Invalidate cache for conn_1 only (e.g. after execution in tab-1)
    invalidate_physical_table_columns_cache(connection_id="conn_1")

    assert _get_cached_columns(key_conn1) is None
    # conn_2 cache remains valid
    assert _get_cached_columns(key_conn2) == {"id", "total"}


def test_get_for_tab_and_mutators():
    from app.database.syntax.semantic_analyzer import analyze_sql_semantics, TempTableTimeline

    # 1. Test mutators copyColumnsFrom
    sql_mutator = """
    DECLARE @_Kqt NVARCHAR(50) = N'B10KqtDTCP';
    EXEC usp_sys_CreateTable N'#Kqt', @_Kqt;
    SELECT k.Account, k.ItemLevel FROM #Kqt k;
    """
    cached_tables = {
        "b10kqtdtcp": ["Account", "ItemLevel", "Amount"]
    }
    mutators = {
        "usp_sys_createtable": {"target": 1, "copyColumnsFrom": 2}
    }
    diags = analyze_sql_semantics(
        sql=sql_mutator,
        dialect="sqlserver",
        cached_tables_dict=cached_tables,
        mutators=mutators
    )
    # Valid columns Account and ItemLevel should not produce errors
    assert diags == []

    # 2. Test mutators detecting invalid column when schema is copied
    sql_invalid = """
    DECLARE @_Kqt NVARCHAR(50) = N'B10KqtDTCP';
    EXEC usp_sys_CreateTable N'#Kqt', @_Kqt;
    SELECT k.NonExistentCol FROM #Kqt k;
    """
    diags_invalid = analyze_sql_semantics(
        sql=sql_invalid,
        dialect="sqlserver",
        cached_tables_dict=cached_tables,
        mutators=mutators
    )
    assert len(diags_invalid) == 1
    assert "NonExistentCol" in diags_invalid[0]["message"]

    # 3. Test schemaChange: false does not make temp table open
    sql_append = """
    CREATE TABLE #t (Id INT);
    EXEC usp_sys_Append N'#t';
    SELECT t.InvalidCol FROM #t t;
    """
    diags_append = analyze_sql_semantics(
        sql=sql_append,
        dialect="sqlserver",
        mutators={"usp_sys_append": {"target": 1, "schemaChange": False}}
    )
    # Because schemaChange is False, #t remains closed with only [Id], so InvalidCol is an error
    assert len(diags_append) == 1
    assert "InvalidCol" in diags_append[0]["message"]
