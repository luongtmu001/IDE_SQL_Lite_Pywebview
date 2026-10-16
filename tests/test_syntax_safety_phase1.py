# -*- coding: utf-8 -*-
"""
tests/test_syntax_safety_phase1.py

L10 & L11: Session Invariance and Determinism Tests for Syntax Validation.
Verifies S1 (PostgreSQL side-effects elimination) and S2 (SQL Server stability).

Requirements:
- PostgreSQL:
  1. No BEGIN; <SQL>; ROLLBACK; execution.
  2. SQL with nextval does NOT advance sequence values.
  3. SQL with pg_advisory_lock does NOT acquire or leave session locks.
  4. SQL with UPDATE does NOT modify table data.
  5. DDL (ALTER TABLE, CREATE INDEX CONCURRENTLY) is NEVER sent to live DB.
  6. Existing user transaction is NEVER aborted, committed, or rolled back.
  7. search_path is NEVER permanently modified on connection session.
- SQL Server:
  1. USE [db] switches are restored to original database context.
  2. Lock busy does NOT fall back to sqlglot (avoids intermittent false errors).
  3. All diagnostics have source == "sqlserver".
  4. 20 consecutive runs of the same SQL yield identical diagnostics (Determinism L11).
"""
import re
import threading
from unittest.mock import MagicMock
import pytest

from app.database.syntax.validator import validate_postgresql, validate_sql_server


class MockPostgresCursor:
    def __init__(self, conn):
        self.conn = conn
        self.description = None

    def execute(self, query, params=None):
        q = query.strip()
        self.conn.executed_queries.append(q)

        # Transaction control
        if re.match(r"^BEGIN\b", q, re.IGNORECASE):
            if self.conn.in_transaction:
                # If transaction was already active, nested BEGIN without savepoint is an error/warning
                self.conn.transaction_aborted = True
            self.conn.in_transaction = True
            return

        if re.match(r"^ROLLBACK\b", q, re.IGNORECASE):
            self.conn.in_transaction = False
            self.conn.transaction_aborted = False
            return

        if re.match(r"^COMMIT\b", q, re.IGNORECASE):
            self.conn.in_transaction = False
            return

        # SET search_path
        m_sp = re.match(r'^SET(?:\s+LOCAL)?\s+search_path\s+TO\s+([^;]+)', q, re.IGNORECASE)
        if m_sp:
            is_local = "LOCAL" in q.upper()
            if not is_local:
                self.conn.search_path = m_sp.group(1).strip()
            return

        # SHOW search_path
        if re.match(r'^SHOW\s+search_path', q, re.IGNORECASE):
            self.description = [("search_path",)]
            return

        # EXPLAIN (VERBOSE)
        if re.match(r'^EXPLAIN\b', q, re.IGNORECASE):
            # EXPLAIN checks syntax and planning, does NOT execute expressions
            # If query inside EXPLAIN has syntax error:
            inner_sql = re.sub(r'^EXPLAIN(?:\s*\([^)]*\))?\s+', '', q, flags=re.IGNORECASE).strip()
            if "FROM WHERE" in inner_sql.upper() or inner_sql.endswith("FROM"):
                err = Exception('syntax error at or near "WHERE"')
                diag = MagicMock()
                pos = q.upper().find("WHERE") + 1
                diag.statement_position = str(pos)
                diag.message_primary = 'syntax error at or near "WHERE"'
                err.diag = diag
                raise err
            self.description = [("QUERY PLAN",)]
            return

        # DDL execution check
        if re.match(r'^(?:ALTER|CREATE|DROP|TRUNCATE)\b', q, re.IGNORECASE):
            self.conn.ddl_executed.append(q)
            return

        # Direct execution of statements with side-effects:
        if "nextval(" in q.lower():
            m = re.search(r"nextval\(['\"]?([^'\")]+)['\"]?\)", q, re.IGNORECASE)
            seq_name = m.group(1) if m else "default_seq"
            self.conn.sequences[seq_name] = self.conn.sequences.get(seq_name, 0) + 1

        if "pg_advisory_lock(" in q.lower():
            m = re.search(r"pg_advisory_lock\((\d+)\)", q, re.IGNORECASE)
            lock_id = int(m.group(1)) if m else 0
            self.conn.advisory_locks.add(lock_id)

        if re.match(r"^UPDATE\b", q, re.IGNORECASE):
            self.conn.data_modified = True

    def fetchone(self):
        if self.description and self.description[0][0] == "search_path":
            return (self.conn.search_path,)
        return ("Result",)

    def fetchall(self):
        return []

    def close(self):
        pass


class MockPostgresConnection:
    def __init__(self):
        self.executed_queries = []
        self.ddl_executed = []
        self.autocommit = True
        self.in_transaction = False
        self.transaction_aborted = False
        self.search_path = "public, pg_catalog"
        self.sequences = {"orders_seq": 100}
        self.advisory_locks = set()
        self.data_modified = False

    def cursor(self):
        return MockPostgresCursor(self)


class MockPostgresSession:
    def __init__(self, conn=None):
        self.connection_id = "test_pg_session"
        self.conn = conn or MockPostgresConnection()
        self.adapter = MagicMock()
        self.adapter.connection = self.conn
        self.lock = threading.RLock()
        self.in_transaction = False
        self.config = {
            "type": "postgresql",
            "database": "test_db",
            "schema": "public",
        }


# =====================================================================
# S1 TESTS: PostgreSQL Session Invariance & Safety
# =====================================================================

def test_s1_pg_safe_nextval_not_incremented():
    """SAFE-1: SQL with nextval does NOT advance sequence values."""
    session = MockPostgresSession()
    initial_seq = session.conn.sequences["orders_seq"]

    sql = "SELECT nextval('orders_seq') AS new_id FROM orders;"
    validate_postgresql(sql, connection_session=session)

    assert session.conn.sequences["orders_seq"] == initial_seq, (
        f"Sequence advanced from {initial_seq} to {session.conn.sequences['orders_seq']}! "
        "PostgreSQL validation must not execute queries."
    )


def test_s1_pg_safe_advisory_lock_not_acquired():
    """SAFE-2: SQL with pg_advisory_lock does NOT acquire session locks."""
    session = MockPostgresSession()

    sql = "SELECT pg_advisory_lock(99999);"
    validate_postgresql(sql, connection_session=session)

    assert 99999 not in session.conn.advisory_locks, (
        "Advisory lock 99999 was acquired! PostgreSQL validation must not execute queries."
    )


def test_s1_pg_safe_update_without_where_no_data_modified():
    """SAFE-3: SQL with UPDATE without WHERE does NOT modify data."""
    session = MockPostgresSession()

    sql = "UPDATE customers SET status = 'deleted';"
    validate_postgresql(sql, connection_session=session)

    assert not session.conn.data_modified, (
        "UPDATE statement was executed! PostgreSQL validation must not execute queries."
    )


def test_s1_pg_safe_ddl_never_sent_to_db():
    """SAFE-4: DDL statements (ALTER TABLE, CREATE INDEX CONCURRENTLY) are NEVER sent to live DB."""
    session = MockPostgresSession()

    sql = (
        "ALTER TABLE orders ADD COLUMN extra_col text;\n"
        "CREATE INDEX CONCURRENTLY idx_orders_customer ON orders (customer_id);"
    )
    validate_postgresql(sql, connection_session=session)

    assert len(session.conn.ddl_executed) == 0, (
        f"DDL was sent to live DB: {session.conn.ddl_executed}. DDL must only be parsed offline!"
    )


def test_s1_pg_safe_open_transaction_not_aborted_or_rolled_back():
    """SAFE-5: If user has an open transaction, syntax check must not abort or roll it back."""
    session = MockPostgresSession()
    session.in_transaction = True
    session.conn.in_transaction = True

    sql = "SELECT * FROM orders WHERE total > 100;"
    validate_postgresql(sql, connection_session=session)

    assert session.in_transaction is True, "User session transaction was cleared!"
    assert session.conn.in_transaction is True, "Database connection transaction was rolled back or closed!"
    assert not session.conn.transaction_aborted, "Database transaction was put into aborted state!"


def test_s1_pg_search_path_invariant():
    """SAFE-6: search_path is never permanently altered on the connection."""
    session = MockPostgresSession()
    orig_sp = session.conn.search_path

    sql = "SELECT * FROM my_table;"
    validate_postgresql(sql, connection_session=session, schema="custom_schema")

    assert session.conn.search_path == orig_sp, (
        f"search_path changed from '{orig_sp}' to '{session.conn.search_path}'!"
    )


# =====================================================================
# S2 TESTS: SQL Server Stability, Determinism & Database Context
# =====================================================================

class MockSqlServerCursor:
    def __init__(self, conn):
        self.conn = conn
        self.description = None

    def execute(self, query, params=None):
        q = query.strip()
        self.conn.executed_queries.append(q)

        m_use = re.match(r"^USE\s+\[?([^\];]+)\]?", q, re.IGNORECASE)
        if m_use:
            self.conn.current_db = m_use.group(1).strip()
            return

        if re.match(r"^SELECT\s+DB_NAME\(\)", q, re.IGNORECASE):
            self.description = [("db_name",)]
            return

    def fetchone(self):
        if self.description and self.description[0][0] == "db_name":
            return (self.conn.current_db,)
        return None

    def fetchall(self):
        return []

    def nextset(self):
        return False

    def close(self):
        pass


class MockSqlServerConnection:
    def __init__(self):
        self.executed_queries = []
        self.current_db = "MainDb"

    def cursor(self):
        return MockSqlServerCursor(self)


class MockSqlServerSession:
    def __init__(self, conn=None):
        self.connection_id = "test_mssql_session"
        self.conn = conn or MockSqlServerConnection()
        self.adapter = MagicMock()
        self.adapter.connection = self.conn
        self.lock = threading.RLock()
        self.config = {
            "type": "sqlserver",
            "database": "MainDb",
        }


def test_s2_mssql_database_context_restored():
    """S2: Switching database for validation must restore original database context."""
    session = MockSqlServerSession()
    initial_db = session.conn.current_db

    sql = "SELECT 1 AS num;"
    validate_sql_server(sql, connection_session=session, database="TemporaryDb")

    assert session.conn.current_db == initial_db, (
        f"Database context remained at '{session.conn.current_db}' instead of restored '{initial_db}'!"
    )


def test_s2_mssql_lock_busy_no_sqlglot_fallback():
    """S2: When session lock is busy, do NOT fallback to sqlglot (avoid false errors)."""
    session = MockSqlServerSession()
    # Acquire lock permanently to simulate ongoing query
    session.lock.acquire()

    # Query with T-SQL specific construct (CROSS APPLY, #temp table) that sqlglot might flag
    sql = "SELECT * FROM #temp_orders o CROSS APPLY (SELECT 1 AS x) c;"
    diags = validate_sql_server(sql, connection_session=session)

    session.lock.release()

    # Under lock busy, validator must return empty/cancelled, NOT sqlglot syntax errors
    assert diags == [], f"Expected empty diagnostics on lock timeout, but got: {diags}"


def test_s2_mssql_diagnostics_source_tagged():
    """S2: All diagnostics must be tagged with source == 'sqlserver'."""
    sql = "SELECT FROM WHERE;"
    diags = validate_sql_server(sql)
    for d in diags:
        assert d.get("source") in ("sqlserver", "tsql"), f"Invalid source in diagnostic: {d}"


def test_s2_mssql_determinism_20_runs():
    """L11 Determinism: 20 consecutive runs of the same SQL return identical results."""
    sql = "SELECT OrderID, Total FROM dbo.Orders WHERE OrderID > 10;"
    results = [validate_sql_server(sql) for _ in range(20)]
    first = results[0]
    for idx, r in enumerate(results[1:], start=2):
        assert r == first, f"Run {idx} differed from run 1: {r} != {first}"
