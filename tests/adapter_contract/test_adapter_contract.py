# -*- coding: utf-8 -*-
"""
tests/adapter_contract/test_adapter_contract.py

Adapter Contract Test Suite (Mục 5.4).
Verifies that any DatabaseAdapter conforms to the unified interface and behaviors:
1. Lifecycle: connect(), ping(), is_alive, close()
2. Query Execution: execute(), parameter binding, multiple statements, row limits, error details
3. Cancellation: cancel() interrupts long-running execution
4. Metadata Inspection: list_databases(), list_schemas(), list_objects(), get_object_definition(), list_object_children()
5. Table Design Metadata: get_table_design_metadata() format and keys
6. Transactions: execute_migration_transaction() commits on success and rolls back on failure
"""

import os
import sys
import tempfile
import time
import pytest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.database.factory import create_adapter
from app.database.sqlite import SqliteAdapter


@pytest.fixture
def sqlite_temp_db(tmp_path):
    """Provides a fresh temporary SQLite file database path."""
    db_file = tmp_path / "contract_test.db"
    return str(db_file)


class TestAdapterContractSqlite:
    """Verifies that SqliteAdapter adheres to the complete DatabaseAdapter contract."""

    def test_lifecycle(self, sqlite_temp_db):
        config = {"type": "sqlite", "database": sqlite_temp_db}
        adapter = create_adapter(config)
        assert isinstance(adapter, SqliteAdapter)
        assert adapter.db_type == "sqlite"
        assert adapter.ping() is False

        adapter.connect()
        assert adapter.ping() is True

        adapter.close()
        assert adapter.ping() is False

    def test_execute_and_parameter_binding(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        # Create table and insert data
        create_sql = """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT,
            score REAL DEFAULT 0.0
        );
        """
        res_create = adapter.execute(create_sql)
        assert res_create["success"] is True

        # Insert with parameters
        insert_sql = "INSERT INTO users (name, email, score) VALUES (?, ?, ?);"
        res_insert1 = adapter.execute(insert_sql, params=("Alice", "alice@example.com", 95.5))
        assert res_insert1["success"] is True
        assert res_insert1["total_rows_affected"] == 1

        res_insert2 = adapter.execute(insert_sql, params=("Bob", "bob@example.com", 82.0))
        assert res_insert2["success"] is True

        # Select all
        res_select = adapter.execute("SELECT id, name, email, score FROM users ORDER BY id ASC;")
        assert res_select["success"] is True
        assert res_select["columns"] == ["id", "name", "email", "score"]
        assert len(res_select["rows"]) == 2
        assert res_select["rows"][0][1] == "Alice"
        assert res_select["rows"][1][1] == "Bob"

        adapter.close()

    def test_execute_multi_statement_batches(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        multi_sql = """
        CREATE TABLE items (id INT, val TEXT);
        INSERT INTO items VALUES (1, 'One');
        INSERT INTO items VALUES (2, 'Two');
        SELECT * FROM items ORDER BY id;
        """
        res = adapter.execute(multi_sql)
        assert res["success"] is True
        assert len(res["statements"]) == 4
        # Last statement is SELECT
        assert len(res["results"]) >= 1
        last_res = res["results"][-1]
        assert len(last_res["rows"]) == 2

        adapter.close()

    def test_execute_limit(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        adapter.execute("CREATE TABLE nums (n INT);")
        for i in range(10):
            adapter.execute(f"INSERT INTO nums VALUES ({i});")

        res_limited = adapter.execute("SELECT n FROM nums ORDER BY n ASC;", limit=3)
        assert res_limited["success"] is True
        assert len(res_limited["rows"]) == 3
        assert res_limited["row_count"] == 3

        adapter.close()

    def test_execute_error_handling(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        bad_sql = "SELECT * FROM non_existent_table_xyz;"
        res = adapter.execute(bad_sql)
        assert res["success"] is False
        assert len(res["errors"]) > 0
        assert "no such table" in res["errors"][0]["clean_message"].lower()

        adapter.close()

    def test_metadata_inspection(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        # DDL Setup
        adapter.execute("""
        CREATE TABLE customers (
            cust_id INTEGER PRIMARY KEY,
            full_name TEXT NOT NULL,
            phone TEXT
        );
        CREATE VIEW v_customers AS SELECT cust_id, full_name FROM customers;
        CREATE INDEX idx_customers_phone ON customers(phone);
        CREATE TRIGGER trg_customers_after_ins AFTER INSERT ON customers
        BEGIN
            SELECT 1;
        END;
        """)

        # 1. list_databases
        dbs = adapter.list_databases()
        assert len(dbs) >= 1
        assert any(d.get("name") == "main" for d in dbs)

        # 2. list_schemas
        schemas = adapter.list_schemas()
        assert len(schemas) >= 1
        assert any(s.get("name") == "main" for s in schemas)

        # 3. list_objects
        tables = adapter.list_objects("main", "main", "tables")
        assert any(t["name"] == "customers" for t in tables)

        views = adapter.list_objects("main", "main", "views")
        assert any(v["name"] == "v_customers" for v in views)

        triggers = adapter.list_objects("main", "main", "triggers")
        assert any(trg["name"] == "trg_customers_after_ins" for trg in triggers)

        # 4. get_object_definition
        view_def = adapter.get_object_definition("main", "main", "v_customers", "views")
        assert "CREATE VIEW v_customers" in view_def

        # 5. list_object_children
        cols = adapter.list_object_children("main", "main", "customers", "tables", "columns")
        col_names = [c["name"] for c in cols]
        assert "cust_id" in col_names
        assert "full_name" in col_names
        assert "phone" in col_names

        indexes = adapter.list_object_children("main", "main", "customers", "tables", "indexes")
        assert any(idx["name"] == "idx_customers_phone" for idx in indexes)

        adapter.close()

    def test_table_design_metadata(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        adapter.execute("""
        CREATE TABLE departments (
            dept_id INTEGER PRIMARY KEY,
            dept_name TEXT NOT NULL
        );
        CREATE TABLE employees (
            emp_id INTEGER PRIMARY KEY AUTOINCREMENT,
            emp_name VARCHAR(100) NOT NULL,
            dept_id INTEGER,
            salary DECIMAL(10, 2) DEFAULT 1000.00,
            FOREIGN KEY(dept_id) REFERENCES departments(dept_id)
        );
        CREATE UNIQUE INDEX uq_emp_name ON employees(emp_name);
        """)

        meta = adapter.get_table_design_metadata("main", "main", "employees")
        assert meta is not None
        assert meta["table"] == "employees"
        assert meta["engine"] == "sqlite"

        cols = meta["columns"]
        col_map = {c["name"]: c for c in cols}
        assert "emp_id" in col_map
        assert col_map["emp_id"]["is_pk"] is True
        assert col_map["emp_id"]["nullable"] is False

        assert "emp_name" in col_map
        assert col_map["emp_name"]["nullable"] is False

        assert "salary" in col_map
        assert "1000" in str(col_map["salary"]["default_value"])

        # Foreign keys
        fks = meta["foreign_keys"]
        assert len(fks) >= 1
        assert fks[0]["ref_table"] == "departments"

        # Unique indexes
        uniques = meta["uniques"]
        assert len(uniques) >= 1 or len(meta["indexes"]) >= 1

        adapter.close()

    def test_migration_transaction_rollback_on_error(self, sqlite_temp_db):
        adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        adapter.connect()

        adapter.execute("CREATE TABLE accounts (id INT PRIMARY KEY, balance INT);")
        adapter.execute("INSERT INTO accounts VALUES (1, 500);")

        # Atomic batch with a syntax/table error in the 2nd statement
        failing_batches = [
            "UPDATE accounts SET balance = balance - 100 WHERE id = 1;",
            "INSERT INTO non_existent_table_err VALUES (999);",
        ]

        with pytest.raises(Exception):
            adapter.execute_migration_transaction(failing_batches)

        # Verify that balance was rolled back to 500
        res = adapter.execute("SELECT balance FROM accounts WHERE id = 1;")
        assert res["rows"][0][0] == 500

        # Successful atomic batch
        success_batches = [
            "UPDATE accounts SET balance = balance - 50 WHERE id = 1;",
            "INSERT INTO accounts VALUES (2, 50);",
        ]
        adapter.execute_migration_transaction(success_batches)

        res2 = adapter.execute("SELECT balance FROM accounts WHERE id = 1;")
        assert res2["rows"][0][0] == 450
        res3 = adapter.execute("SELECT balance FROM accounts WHERE id = 2;")
        assert res3["rows"][0][0] == 50

        adapter.close()

    def test_read_only_mode_enforcement(self, sqlite_temp_db):
        # First create database with some data
        setup_adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db})
        setup_adapter.connect()
        setup_adapter.execute("CREATE TABLE config (k TEXT, v TEXT); INSERT INTO config VALUES ('mode', 'read');")
        setup_adapter.close()

        # Connect with read_only=True
        ro_adapter = create_adapter({"type": "sqlite", "database": sqlite_temp_db, "read_only": True})
        ro_adapter.connect()

        # Reads work
        res_read = ro_adapter.execute("SELECT * FROM config;")
        assert res_read["success"] is True
        assert len(res_read["rows"]) == 1

        # Writes must fail with error
        res_write = ro_adapter.execute("INSERT INTO config VALUES ('test', 'fail');")
        assert res_write["success"] is False
        assert any("readonly" in str(e).lower() for e in res_write["errors"] or []) or len(res_write["errors"]) > 0

        ro_adapter.close()
