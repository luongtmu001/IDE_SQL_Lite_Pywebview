# -*- coding: utf-8 -*-
"""
Tests for Phase 8 Step 5: Backend SQL Protection (DELETE/UPDATE without WHERE, TRUNCATE).
Verifies:
1. AST and fallback detection in app.utils.sql_safety.detect_fatal_actions.
2. QueryApiMixin.execute_query enforcement respecting sql.sqlprotection setting and confirmed flag.
3. Flask /api/query/execute endpoint integration.
"""
from unittest.mock import MagicMock
import pytest

from app.utils.sql_safety import detect_fatal_actions
from app.api.query_api import QueryApiMixin
from main import MainApi


# =========================================================================
# 1. detect_fatal_actions unit tests
# =========================================================================

def test_detect_fatal_actions_delete_without_where():
    fatal = detect_fatal_actions("DELETE FROM users")
    assert len(fatal) >= 1
    assert any(a["type"] == "DELETE_WITHOUT_WHERE" for a in fatal)

    fatal_temp = detect_fatal_actions("DELETE #temp_logs")
    assert len(fatal_temp) >= 1
    assert any(a["type"] == "DELETE_WITHOUT_WHERE" for a in fatal_temp)


def test_detect_fatal_actions_update_without_where():
    fatal = detect_fatal_actions("UPDATE users SET is_active = 0")
    assert len(fatal) >= 1
    assert any(a["type"] == "UPDATE_WITHOUT_WHERE" for a in fatal)

    fatal_bracket = detect_fatal_actions("UPDATE [dbo].[Customers] SET [Status] = 'Inactive'")
    assert len(fatal_bracket) >= 1
    assert any(a["type"] == "UPDATE_WITHOUT_WHERE" for a in fatal_bracket)


def test_detect_fatal_actions_truncate():
    fatal1 = detect_fatal_actions("TRUNCATE TABLE audit_log")
    assert len(fatal1) >= 1
    assert any(a["type"] == "TRUNCATE" for a in fatal1)

    fatal2 = detect_fatal_actions("TRUNCATE audit_log")
    assert len(fatal2) >= 1
    assert any(a["type"] == "TRUNCATE" for a in fatal2)


def test_detect_fatal_actions_safe_queries():
    safe_queries = [
        "SELECT * FROM users",
        "SELECT 1",
        "DELETE FROM users WHERE id = 10",
        "UPDATE users SET is_active = 1 WHERE user_id = 42",
        "INSERT INTO users (name) VALUES ('Alice')",
        "CREATE TABLE test (id INT, CONSTRAINT fk FOREIGN KEY (id) REFERENCES t(id) ON DELETE CASCADE ON UPDATE CASCADE)",
    ]
    for q in safe_queries:
        fatal = detect_fatal_actions(q)
        assert len(fatal) == 0, f"Query should be considered safe: {q}, but got: {fatal}"


def test_detect_fatal_actions_subquery_inside_set():
    # Outer UPDATE has no WHERE clause, even though inner subquery does
    q = "UPDATE Customers SET Name = (SELECT Name FROM Other WHERE id = 1)"
    fatal = detect_fatal_actions(q)
    assert len(fatal) >= 1
    assert any(a["type"] == "UPDATE_WITHOUT_WHERE" for a in fatal)


def test_detect_fatal_actions_multiple_statements():
    script = """
    SELECT * FROM Logs;
    UPDATE Customers SET Active = 0;
    DELETE FROM #temp;
    TRUNCATE TABLE OldData;
    """
    fatal = detect_fatal_actions(script)
    types = [a["type"] for a in fatal]
    assert "UPDATE_WITHOUT_WHERE" in types
    assert "DELETE_WITHOUT_WHERE" in types
    assert "TRUNCATE" in types


# =========================================================================
# 2. MainApi / QueryApiMixin execute_query integration tests
# =========================================================================

def _create_mock_main_api(mock_execute_result=None):
    api = MainApi()
    mock_conn = MagicMock()
    mock_conn.read_only = False
    mock_conn.environment = "dev"
    mock_adapter = MagicMock()
    mock_adapter.db_type = "tsql"
    mock_conn.adapter = mock_adapter
    mock_conn.query_service.execute.return_value = mock_execute_result or {"rows": [["1"]], "columns": ["id"]}
    api._get_connection = MagicMock(return_value=mock_conn)
    return api, mock_conn


def test_execute_query_blocks_unconfirmed_fatal_action(monkeypatch):
    import main
    api, mock_conn = _create_mock_main_api()
    monkeypatch.setattr(
        main,
        "_load_settings_file",
        lambda: {"sql": {"sqlprotection": 1}}
    )

    res = api.execute_query(
        connection_id="conn-1",
        sql="DELETE FROM Users",
        confirmed=False
    )
    assert res["success"] is False
    assert res["needs_confirmation"] is True
    assert res["error_code"] == "ERR_FATAL_ACTION_CONFIRMATION_REQUIRED"
    assert "fatal_actions" in res
    assert mock_conn.query_service.execute.called is False


def test_execute_query_allows_confirmed_fatal_action(monkeypatch):
    import main
    api, mock_conn = _create_mock_main_api()
    monkeypatch.setattr(
        main,
        "_load_settings_file",
        lambda: {"sql": {"sqlprotection": 1}}
    )

    res = api.execute_query(
        connection_id="conn-1",
        sql="DELETE FROM Users",
        confirmed=True
    )
    assert res["success"] is True
    assert mock_conn.query_service.execute.called is True


def test_execute_query_allows_fatal_action_when_sqlprotection_disabled(monkeypatch):
    import main
    api, mock_conn = _create_mock_main_api()
    monkeypatch.setattr(
        main,
        "_load_settings_file",
        lambda: {"sql": {"sqlprotection": 0}}
    )

    res = api.execute_query(
        connection_id="conn-1",
        sql="DELETE FROM Users",
        confirmed=False
    )
    assert res["success"] is True
    assert mock_conn.query_service.execute.called is True


def test_execute_query_allows_safe_query_without_confirmation(monkeypatch):
    import main
    api, mock_conn = _create_mock_main_api()
    monkeypatch.setattr(
        main,
        "_load_settings_file",
        lambda: {"sql": {"sqlprotection": 1}}
    )

    res = api.execute_query(
        connection_id="conn-1",
        sql="DELETE FROM Users WHERE id = 1",
        confirmed=False
    )
    assert res["success"] is True
    assert mock_conn.query_service.execute.called is True


# =========================================================================
# 3. Flask route integration tests
# =========================================================================

def test_flask_execute_route_blocks_unconfirmed_fatal_action(monkeypatch):
    from flask import Flask
    from app.routes.query import query_bp

    app = Flask(__name__)
    app.register_blueprint(query_bp, url_prefix="/api/query")

    mock_conn = MagicMock()
    mock_conn.read_only = False
    mock_conn.environment = "dev"
    mock_adapter = MagicMock()
    mock_adapter.db_type = "tsql"
    mock_conn.adapter = mock_adapter
    mock_conn.query_service.execute.return_value = {"rows": []}

    mock_cm = MagicMock()
    mock_cm.get.return_value = mock_conn

    monkeypatch.setattr("app.routes.query.get_connection_manager", lambda: mock_cm)
    monkeypatch.setattr("app.routes.query.get_owner_session_id", lambda: "test-session")
    monkeypatch.setattr("app.routes.query._load_settings_file", lambda: {"sql": {"sqlprotection": 1}})

    client = app.test_client()

    # Fatal query unconfirmed
    resp = client.post("/api/query/execute", json={
        "connection_id": "conn-1",
        "sql": "TRUNCATE TABLE users",
        "confirmed": False
    })
    data = resp.get_json()
    assert data["success"] is False
    assert data["needs_confirmation"] is True
    assert data["error_code"] == "ERR_FATAL_ACTION_CONFIRMATION_REQUIRED"
    assert mock_conn.query_service.execute.called is False

    # Fatal query confirmed
    resp2 = client.post("/api/query/execute", json={
        "connection_id": "conn-1",
        "sql": "TRUNCATE TABLE users",
        "confirmed": True
    })
    data2 = resp2.get_json()
    assert mock_conn.query_service.execute.called is True
