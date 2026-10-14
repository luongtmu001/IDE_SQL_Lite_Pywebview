# -*- coding: utf-8 -*-
import pytest
from app.utils.sql_safety import classify_statement, check_query_safety


def test_classify_read_only_queries():
    queries = [
        "SELECT 1, 2, 3",
        "SELECT id, username FROM users WHERE is_active = 1",
        "WITH active_users AS (SELECT * FROM users WHERE active = 1) SELECT * FROM active_users",
        "EXPLAIN SELECT * FROM orders",
        "SHOW TABLES",
        "-- A comment\nSELECT * FROM customers",
        "/* Multi-line\ncomment */ SELECT 100",
    ]
    for q in queries:
        res = classify_statement(q, dialect="tsql")
        assert res["is_read_only"] is True, f"Expected read-only for: {q}"


def test_classify_modifying_queries():
    queries = [
        ("INSERT INTO users (id, name) VALUES (1, 'Alice')", "INSERT"),
        ("UPDATE users SET name = 'Bob' WHERE id = 1", "UPDATE"),
        ("DELETE FROM users WHERE id = 1", "DELETE"),
        ("TRUNCATE TABLE logs", "TRUNCATE"),
        ("CREATE TABLE test (id INT)", "CREATE"),
        ("DROP TABLE test", "DROP"),
        ("ALTER TABLE test ADD col INT", "ALTER"),
        ("SELECT * INTO backup_users FROM users", "SELECT_INTO"),
        ("EXEC sp_reindex_tables", "EXEC"),
    ]
    for q, expected_action in queries:
        res = classify_statement(q, dialect="tsql")
        assert res["is_read_only"] is False, f"Expected modifying for: {q}"


def test_cte_with_modifying_action():
    # CTE that does a DELETE
    sql = "WITH old_records AS (SELECT id FROM logs WHERE age > 30) DELETE FROM logs WHERE id IN (SELECT id FROM old_records)"
    res = classify_statement(sql, dialect="postgres")
    assert res["is_read_only"] is False


def test_check_query_safety_read_only_enforcement():
    # Read-only mode allows SELECT
    check1 = check_query_safety("SELECT * FROM users", read_only=True)
    assert check1["allowed"] is True

    # Read-only mode blocks DELETE
    check2 = check_query_safety("DELETE FROM users WHERE id = 1", read_only=True)
    assert check2["allowed"] is False
    assert check2["error_code"] == "ERR_READ_ONLY"

    # Read-only mode blocks SELECT INTO
    check3 = check_query_safety("SELECT * INTO backup FROM users", read_only=True)
    assert check3["allowed"] is False
    assert check3["error_code"] == "ERR_READ_ONLY"


def test_check_query_safety_prod_confirmation():
    # Prod environment allows SELECT without confirmation
    check1 = check_query_safety("SELECT * FROM users", environment="prod", confirmed=False)
    assert check1["allowed"] is True
    assert check1["needs_confirmation"] is False

    # Prod environment requires confirmation for UPDATE
    check2 = check_query_safety("UPDATE users SET active = 0", environment="prod", confirmed=False)
    assert check2["allowed"] is False
    assert check2["needs_confirmation"] is True
    assert check2["error_code"] == "ERR_PROD_CONFIRMATION_REQUIRED"

    # With confirmed=True, execution is allowed on Prod
    check3 = check_query_safety("UPDATE users SET active = 0", environment="prod", confirmed=True)
    assert check3["allowed"] is True
    assert check3["needs_confirmation"] is False

    # Dev / Test environment does not require extra confirmation
    check4 = check_query_safety("UPDATE users SET active = 0", environment="dev", confirmed=False)
    assert check4["allowed"] is True
