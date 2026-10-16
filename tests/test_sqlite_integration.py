# -*- coding: utf-8 -*-
"""
tests/test_sqlite_integration.py

Comprehensive Integration Tests for SQLite Database Adapter (Mục 5.4).
Verifies:
1. End-to-end connection creation and reuse via ConnectionManager
2. Query execution via QueryService and ConnectionSession
3. Metadata inspection through MetadataService
4. Table Data Editor service with SQLite (including rowid fallback for tables without PK)
5. Query cancellation via connection.interrupt()
6. Read-only mode enforcement via PRAGMA query_only
7. select_sqlite_file API in ConnectionsApiMixin
8. Zero inline CSS and semantic HTML verification in connection modal templates
"""

import os
import sys
import tempfile
import threading
import time
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.services.connection_manager import ConnectionManager
from app.services.table_data_editor_service import TableDataEditorService
from app.api.connections_api import ConnectionsApiMixin


@pytest.fixture
def sqlite_file_path(tmp_path):
    db_file = tmp_path / "app_integration.db"
    return str(db_file)


class TestSqliteIntegration:
    """Verifies SQLite end-to-end integration across all IDE service layers."""

    def test_connection_manager_create_and_query(self, sqlite_file_path):
        cm = ConnectionManager()
        owner_id = "test_user_session"

        config = {
            "name": "My Local SQLite DB",
            "type": "sqlite",
            "database": sqlite_file_path,
        }

        # 1. Create connection
        conn, reused = cm.create_or_get(owner_id, config)
        assert reused is False
        assert conn.is_alive() is True
        assert conn.adapter.db_type == "sqlite"

        # 2. Execute DDL & DML via session query service
        res_ddl = conn.query_service.execute("""
            CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                price REAL DEFAULT 0.0,
                in_stock BOOLEAN DEFAULT 1
            );
            INSERT INTO products (title, price, in_stock) VALUES ('Mechanical Keyboard', 89.99, 1);
            INSERT INTO products (title, price, in_stock) VALUES ('Wireless Mouse', 49.50, 1);
            INSERT INTO products (title, price, in_stock) VALUES ('USB-C Cable', 9.99, 0);
        """)
        assert res_ddl["success"] is True

        # 3. Query records
        res_query = conn.query_service.execute("SELECT id, title, price, in_stock FROM products ORDER BY id ASC;")
        assert res_query["success"] is True
        assert len(res_query["rows"]) == 3
        assert res_query["rows"][0][1] == "Mechanical Keyboard"
        assert res_query["rows"][1][1] == "Wireless Mouse"

        # 4. Connection reuse
        conn2, reused2 = cm.create_or_get(owner_id, config)
        assert reused2 is True
        assert conn2.connection_id == conn.connection_id

        # 5. Clean close
        cm.close(owner_id, conn.connection_id)
        assert conn.is_alive() is False

    def test_metadata_service_sqlite(self, sqlite_file_path):
        cm = ConnectionManager()
        owner_id = "meta_test_user"
        conn, _ = cm.create_or_get(owner_id, {"type": "sqlite", "database": sqlite_file_path})

        # DDL
        conn.query_service.execute("""
            CREATE TABLE authors (
                author_id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE books (
                book_id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id INT,
                title VARCHAR(200) NOT NULL,
                FOREIGN KEY (author_id) REFERENCES authors(author_id)
            );
            CREATE VIEW v_books AS SELECT book_id, title FROM books;
            CREATE INDEX idx_books_title ON books(title);
        """)

        ms = conn.metadata_service

        # Databases & Schemas
        dbs = ms.list_databases()
        assert len(dbs) >= 1
        assert any(d.get("name") == "main" for d in dbs)

        schemas = ms.list_schemas("main")
        assert len(schemas) >= 1
        assert any(s.get("name") == "main" for s in schemas)

        # Objects
        tables = ms.list_objects("main", "main", "tables")
        assert any(t["name"] == "books" for t in tables)
        assert any(t["name"] == "authors" for t in tables)

        views = ms.list_objects("main", "main", "views")
        assert any(v["name"] == "v_books" for v in views)

        # Object definition
        defn = ms.get_object_definition("main", "main", "v_books", "views")
        assert "CREATE VIEW v_books" in defn

        # Object children
        cols = ms.list_object_children("main", "main", "books", "tables", "columns")
        assert len(cols) == 3
        col_names = [c["name"] for c in cols]
        assert "book_id" in col_names
        assert "author_id" in col_names
        assert "title" in col_names

        cm.close(owner_id, conn.connection_id)

    def test_table_data_editor_sqlite_and_rowid(self, sqlite_file_path):
        cm = ConnectionManager()
        owner_id = "editor_test_user"
        conn, _ = cm.create_or_get(owner_id, {"type": "sqlite", "database": sqlite_file_path})

        # 1. Table WITH PK
        conn.query_service.execute("""
            CREATE TABLE orders (
                order_id INTEGER PRIMARY KEY,
                amount REAL
            );
            INSERT INTO orders VALUES (101, 250.0);
        """)

        meta_orders = TableDataEditorService.get_metadata(conn.adapter, "main", "main", "orders")
        assert meta_orders["has_pk"] is True
        assert meta_orders["pk_columns"] == ["order_id"]
        assert meta_orders["uses_rowid"] is False

        # 2. Table WITHOUT PK (should leverage rowid fallback)
        conn.query_service.execute("""
            CREATE TABLE logs (
                log_time TEXT,
                message TEXT
            );
            INSERT INTO logs VALUES ('2026-10-15 10:00:00', 'First log entry');
            INSERT INTO logs VALUES ('2026-10-15 10:05:00', 'Second log entry');
        """)

        meta_logs = TableDataEditorService.get_metadata(conn.adapter, "main", "main", "logs")
        assert meta_logs["has_pk"] is True
        assert meta_logs["pk_columns"] == ["rowid"]
        assert meta_logs["uses_rowid"] is True

        # Test build_select_sql for SQLite
        select_sql = TableDataEditorService.build_select_sql(
            engine="sqlite",
            schema="main",
            table="orders",
            select_cols=["order_id", "amount"],
            top_n=50
        )
        assert "LIMIT 50" in select_sql
        assert '"orders"' in select_sql

        cm.close(owner_id, conn.connection_id)

    def test_query_cancellation_sqlite(self, sqlite_file_path):
        cm = ConnectionManager()
        owner_id = "cancel_test_user"
        conn, _ = cm.create_or_get(owner_id, {"type": "sqlite", "database": sqlite_file_path})

        # Launch an intensive recursive CTE in a background thread and cancel it
        long_query = """
        WITH RECURSIVE cnt(x) AS (
            SELECT 1
            UNION ALL
            SELECT x+1 FROM cnt WHERE x < 100000000
        )
        SELECT COUNT(*) FROM cnt;
        """

        res_holder = {}

        def run_slow():
            res_holder["result"] = conn.query_service.execute(long_query)

        t = threading.Thread(target=run_slow)
        t.daemon = True
        t.start()

        # Give it a brief moment to begin running
        time.sleep(0.05)

        # Cancel the query
        cancel_ok = conn.adapter.cancel()
        assert cancel_ok is True

        t.join(timeout=3.0)
        assert not t.is_alive(), "Query thread should have been terminated by interrupt"

        res = res_holder.get("result", {})
        assert res.get("success") is False or "cancelled" in str(res.get("messages", [])).lower()

        cm.close(owner_id, conn.connection_id)

    def test_read_only_enforcement_sqlite(self, sqlite_file_path):
        cm = ConnectionManager()
        owner_id = "ro_test_user"

        # Setup database
        conn_setup, _ = cm.create_or_get(owner_id, {"type": "sqlite", "database": sqlite_file_path})
        conn_setup.query_service.execute("CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);")
        conn_setup.query_service.execute("INSERT INTO settings VALUES ('theme', 'dark');")
        cm.close(owner_id, conn_setup.connection_id)

        # Connect with read_only=True
        conn_ro, _ = cm.create_or_get(owner_id, {
            "type": "sqlite",
            "database": sqlite_file_path,
            "read_only": True
        })
        assert conn_ro.read_only is True

        # Read query succeeds
        res_r = conn_ro.query_service.execute("SELECT * FROM settings;")
        assert res_r["success"] is True
        assert len(res_r["rows"]) == 1

        # Write queries are rejected by SQL safety & DB PRAGMA
        res_w = conn_ro.query_service.execute("UPDATE settings SET v = 'light' WHERE k = 'theme';")
        assert res_w["success"] is False

        res_d = conn_ro.query_service.execute("DROP TABLE settings;")
        assert res_d["success"] is False

        cm.close(owner_id, conn_ro.connection_id)

    def test_select_sqlite_file_api_mock(self):
        class DummyApi(ConnectionsApiMixin):
            def __init__(self):
                self._window = MagicMock()
                self._window.create_file_dialog.return_value = ["C:/databases/my_sales.db"]

        api = DummyApi()
        res = api.select_sqlite_file()
        assert res["success"] is True
        assert res["file_path"] == "C:/databases/my_sales.db"

        # Cancelled
        api._window.create_file_dialog.return_value = None
        res_cancel = api.select_sqlite_file()
        assert res_cancel["success"] is False
        assert res_cancel.get("cancelled") is True

    def test_templates_have_no_inline_css_in_sqlite_elements(self):
        """Verifies strict zero inline CSS rule in newly added SQLite UI elements."""
        template_files = [
            ROOT_DIR / "templates" / "partials" / "connection_modal.html",
            ROOT_DIR / "templates" / "index.html",
        ]

        for tf in template_files:
            assert tf.exists(), f"Template not found: {tf}"
            content = tf.read_text(encoding="utf-8")
            assert 'id="connSqliteOptionsGroup"' in content
            assert 'id="connSqlitePath"' in content
            assert 'id="btnBrowseSqliteFile"' in content

            # Extract the connSqliteOptionsGroup block
            start_idx = content.find('id="connSqliteOptionsGroup"')
            end_idx = content.find('id="connServerOptionsGroup"', start_idx)
            block = content[start_idx:end_idx]

            # Assert strict zero inline styles
            assert 'style="' not in block, f"Inline style found in SQLite options block of {tf.name}"
            assert "style='" not in block, f"Inline style found in SQLite options block of {tf.name}"
