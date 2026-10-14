"""
Unit and Integration Tests for Environment Safety, Read-Only Enforcement, and Explicit Transactions (Mục 5.1).
"""
import pytest
from unittest.mock import MagicMock, patch
from app.utils.sql_safety import check_query_safety, classify_statement
from app.models.connection_session import ConnectionSession
from app.services.table_data_editor_service import TableDataEditorService


# ============================================================================
# 1. Tests for SQL Safety & Classification
# ============================================================================

def test_classify_statement_read_only():
    """Verify that SELECT, EXPLAIN, and read-only CTEs are classified as read-only."""
    select_queries = [
        "SELECT * FROM Users;",
        "  select id, name from tbl where id = 1  ",
        "WITH cte AS (SELECT id FROM Orders) SELECT * FROM cte;",
        "EXPLAIN SELECT * FROM Products;"
    ]
    for sql in select_queries:
        res = classify_statement(sql)
        assert res["is_read_only"] is True, f"Expected {sql} to be read-only"


def test_classify_statement_write():
    """Verify that DML, DDL, and SELECT INTO are classified as write/destructive."""
    write_queries = [
        "INSERT INTO Users (name) VALUES ('Alice')",
        "UPDATE Users SET name = 'Bob' WHERE id = 1",
        "DELETE FROM Users WHERE id = 1",
        "DROP TABLE Users",
        "ALTER TABLE Users ADD COLUMN age INT",
        "TRUNCATE TABLE Logs",
        "SELECT id, name INTO UsersBackup FROM Users",
        "WITH cte AS (SELECT 1 as x) DELETE FROM Users WHERE id IN (SELECT x FROM cte)"
    ]
    for sql in write_queries:
        res = classify_statement(sql)
        assert res["is_read_only"] is False, f"Expected {sql} to be non-read-only"


def test_check_query_safety_read_only_mode():
    """Verify that read_only=True blocks write queries but allows read queries."""
    # Read query allowed
    res_select = check_query_safety("SELECT * FROM tbl", read_only=True)
    assert res_select["allowed"] is True
    assert res_select.get("error_code") is None

    # Write queries blocked
    for bad_sql in ["UPDATE tbl SET x = 1", "DELETE FROM tbl", "DROP TABLE tbl"]:
        res_write = check_query_safety(bad_sql, read_only=True)
        assert res_write["allowed"] is False
        assert res_write["error_code"] == "ERR_READ_ONLY"
        assert res_write["needs_confirmation"] is False


def test_check_query_safety_production_handshake():
    """Verify that environment='prod' requires confirmation for DML/DDL but not for SELECT."""
    # SELECT in prod requires no confirmation
    res_select = check_query_safety("SELECT * FROM tbl", environment="prod", confirmed=False)
    assert res_select["allowed"] is True
    assert res_select["needs_confirmation"] is False

    # UPDATE in prod without confirmation requires confirmation
    res_update = check_query_safety("UPDATE tbl SET x = 1", environment="prod", confirmed=False)
    assert res_update["allowed"] is False
    assert res_update["needs_confirmation"] is True
    assert "PRODUCTION" in res_update["message"]

    # UPDATE in prod with confirmation is allowed
    res_confirmed = check_query_safety("UPDATE tbl SET x = 1", environment="prod", confirmed=True)
    assert res_confirmed["allowed"] is True
    assert res_confirmed["needs_confirmation"] is False

    # UPDATE in dev/test without confirmation is allowed
    for env in ["dev", "test", ""]:
        res_env = check_query_safety("UPDATE tbl SET x = 1", environment=env, confirmed=False)
        assert res_env["allowed"] is True
        assert res_env["needs_confirmation"] is False


# ============================================================================
# 2. Tests for ConnectionSession & Transaction Lifecycle
# ============================================================================

def _create_mock_session(connection_id="conn-1", environment="dev", read_only=False):
    mock_conn = MagicMock()
    mock_adapter = MagicMock()
    mock_adapter.connection = mock_conn

    session = ConnectionSession(
        connection_id=connection_id,
        owner_session_id="owner-1",
        config={"name": "Test Server", "type": "sqlserver", "environment": environment, "read_only": read_only},
        adapter=mock_adapter,
        metadata_service=MagicMock(),
        query_service=MagicMock(),
        environment=environment,
        read_only=read_only
    )
    return session, mock_conn, mock_adapter


def test_connection_session_properties_and_public_info():
    """Verify ConnectionSession preserves environment and read_only metadata."""
    session, _, _ = _create_mock_session(connection_id="conn-123", environment="prod", read_only=True)

    assert session.environment == "prod"
    assert session.read_only is True
    assert session.in_transaction is False

    info = session.public_info()
    assert info["environment"] == "prod"
    assert info["read_only"] is True
    assert info["in_transaction"] is False


def test_connection_session_transaction_lifecycle():
    """Verify begin, commit, and rollback transactions on ConnectionSession."""
    session, mock_conn, _ = _create_mock_session(connection_id="conn-tx", environment="dev", read_only=False)

    # 1. Begin Transaction
    res_begin = session.begin_transaction()
    assert res_begin["success"] is True
    assert session.in_transaction is True
    assert session.tx_started_at is not None
    assert mock_conn.autocommit is False

    # Beginning again while already open
    res_b2 = session.begin_transaction()
    assert res_b2["success"] is False
    assert "đã được mở" in res_b2["error"]

    # 2. Commit Transaction
    res_commit = session.commit_transaction()
    assert res_commit["success"] is True
    assert session.in_transaction is False
    assert mock_conn.commit.called

    # 3. Begin & Rollback
    res_b3 = session.begin_transaction()
    assert res_b3["success"] is True
    assert session.in_transaction is True

    res_rb = session.rollback_transaction()
    assert res_rb["success"] is True
    assert session.in_transaction is False
    assert mock_conn.rollback.called


def test_connection_session_read_only_blocks_begin_transaction():
    """Verify that read_only connection sessions cannot begin explicit transactions."""
    session, _, _ = _create_mock_session(connection_id="conn-ro", environment="prod", read_only=True)

    res_begin = session.begin_transaction()
    assert res_begin["success"] is False
    assert "chỉ đọc" in res_begin["error"].lower()
    assert session.in_transaction is False


def test_connection_session_auto_rollback_on_close():
    """Verify that closing a session with an active transaction automatically rolls it back."""
    session, mock_conn, mock_adapter = _create_mock_session(connection_id="conn-close", environment="dev")

    session.begin_transaction()
    assert session.in_transaction is True

    session.close()
    assert mock_conn.rollback.called
    assert mock_adapter.close.called
    assert session.in_transaction is False


# ============================================================================
# 3. Tests for TableDataEditorService with Read-Only and Active Transaction
# ============================================================================

def test_table_data_editor_read_only_rejection():
    """Verify that TableDataEditorService rejects modifications when session is read_only."""
    mock_adapter = MagicMock()
    mock_adapter.connection = MagicMock()
    mock_session = MagicMock()
    mock_session.read_only = True
    mock_adapter.session = mock_session

    with pytest.raises(PermissionError) as exc_info:
        TableDataEditorService.submit_changes(
            adapter=mock_adapter,
            database="testdb",
            schema="dbo",
            table="Users",
            changes={"inserts": [{"data": {"name": "Test"}}]}
        )
    assert "CHỈ ĐỌC" in str(exc_info.value)


def test_table_data_editor_within_explicit_transaction():
    """Verify that TableDataEditorService runs within an open transaction without committing."""
    mock_adapter = MagicMock()
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.rowcount = 1
    mock_conn.cursor.return_value = mock_cursor
    mock_adapter.connection = mock_conn
    mock_adapter.db_type = "sqlserver"

    mock_session = MagicMock()
    mock_session.read_only = False
    mock_session.in_transaction = True  # Active explicit transaction
    mock_adapter.session = mock_session

    # Mock metadata retrieval
    TableDataEditorService.get_metadata = MagicMock(return_value={
        "columns": [{"name": "id", "type": "int"}, {"name": "name", "type": "varchar"}],
        "pk_columns": ["id"],
        "identity_columns": [],
        "computed_columns": []
    })

    result = TableDataEditorService.submit_changes(
        adapter=mock_adapter,
        database="testdb",
        schema="dbo",
        table="Users",
        changes={"inserts": [{"data": {"id": 1, "name": "Alice"}}]}
    )

    assert result["success"] is True
    assert result["in_transaction"] is True
    # conn.commit() should NOT have been called because transaction is managed explicitly
    assert not mock_conn.commit.called


def test_connection_session_switch_to_write_mode():
    """Verify that a session can transition from read-only to write mode dynamically."""
    session, mock_conn, mock_adapter = _create_mock_session(connection_id="conn-toggle", environment="dev", read_only=True)

    # 1. Initially read-only
    assert session.read_only is True
    res_b1 = session.begin_transaction()
    assert res_b1["success"] is False
    assert "chỉ đọc" in res_b1["error"].lower()

    # 2. Switch to write mode
    res_switch = session.set_read_only(False)
    assert res_switch["success"] is True
    assert res_switch["read_only"] is False
    assert session.read_only is False

    # 3. Now begin_transaction works
    res_b2 = session.begin_transaction()
    assert res_b2["success"] is True
    assert session.in_transaction is True

    # 4. Switch back to read-only
    res_ro = session.set_read_only(True)
    assert res_ro["success"] is True
    assert session.read_only is True


def test_main_api_set_connection_read_only():
    """Verify MainApi set_connection_read_only method."""
    from main import MainApi
    api = MainApi()

    mock_session = MagicMock()
    mock_session.set_read_only.return_value = {"success": True, "read_only": False, "connection_id": "conn-1"}

    with patch.object(api, "_get_connection", return_value=mock_session):
        res = api.set_connection_read_only("conn-1", read_only=False)
        assert res["success"] is True
        assert res["read_only"] is False
        mock_session.set_read_only.assert_called_once_with(False)

