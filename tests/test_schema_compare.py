# -*- coding: utf-8 -*-
"""
Tests for Schema Compare Service (Feature 5.3).
Verifies:
1. Snapshot extraction from adapters.
2. Difference calculation (only_in_source, only_in_target, different, identical).
3. Constraint normalization by definition (preventing false drops/adds on random constraint names).
4. Migration script generation (selective tables, transaction wrapping, safety on drop).
"""
import pytest
from app.services.schema_compare_service import SchemaCompareService


class DummyAdapter:
    def __init__(self, db_type="sqlite", tables_dict=None):
        self.db_type = db_type
        self.tables_dict = tables_dict or {}

    def list_objects(self, database, schema, object_type, limit=0):
        if object_type == "tables":
            return [{"name": name} for name in self.tables_dict.keys()]
        return []

    def get_table_design_metadata(self, database, schema, table):
        return self.tables_dict.get(table)

    def get_object_definition(self, database, schema, name, object_type):
        return ""


def test_schema_compare_snapshot_basic():
    adapter = DummyAdapter(
        db_type="sqlite",
        tables_dict={
            "users": {
                "table": "users",
                "engine": "sqlite",
                "columns": [
                    {"name": "id", "type": "integer", "is_pk": True, "nullable": False},
                    {"name": "username", "type": "text", "is_pk": False, "nullable": False}
                ],
                "indexes": [],
                "foreign_keys": [],
                "uniques": [],
                "checks": [],
                "has_pk": True
            }
        }
    )

    snap = SchemaCompareService.snapshot(adapter, "main", "main")
    assert snap["engine"] == "sqlite"
    assert snap["table_count"] == 1
    assert "users" in snap["tables"]
    assert len(snap["tables"]["users"]["columns"]) == 2


def test_schema_compare_diff_identical():
    snap_a = {
        "engine": "sqlserver",
        "database": "db_a",
        "schema": "dbo",
        "tables": {
            "products": {
                "table": "products",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "price", "type": "decimal", "size": 18, "scale": 2, "is_pk": False, "nullable": False}
                ],
                "pk_name": "PK_products",
                "indexes": [],
                "foreign_keys": [],
                "uniques": [],
                "checks": [],
                "has_pk": True
            }
        }
    }
    # Exactly identical target
    snap_b = {
        "engine": "sqlserver",
        "database": "db_b",
        "schema": "dbo",
        "tables": {
            "products": {
                "table": "products",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "price", "type": "decimal", "size": 18, "scale": 2, "is_pk": False, "nullable": False}
                ],
                "pk_name": "PK_products",
                "indexes": [],
                "foreign_keys": [],
                "uniques": [],
                "checks": [],
                "has_pk": True
            }
        }
    }

    diff = SchemaCompareService.diff(snap_a, snap_b)
    summary = diff["summary"]
    assert summary["identical_count"] == 1
    assert summary["different_count"] == 0
    assert summary["missing_in_target_count"] == 0
    assert summary["extra_in_target_count"] == 0
    assert len(diff["tables"]) == 1
    assert diff["tables"][0]["status"] == "identical"


def test_schema_compare_diff_missing_and_extra():
    # Source A has users and orders
    snap_a = {
        "engine": "sqlserver",
        "database": "source_db",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "columns": [{"name": "id", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            },
            "orders": {
                "table": "orders",
                "engine": "sqlserver",
                "columns": [{"name": "order_id", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            }
        }
    }
    # Target B has users and legacy_logs (missing orders, extra legacy_logs)
    snap_b = {
        "engine": "sqlserver",
        "database": "target_db",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "columns": [{"name": "id", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            },
            "legacy_logs": {
                "table": "legacy_logs",
                "engine": "sqlserver",
                "columns": [{"name": "log_id", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            }
        }
    }

    diff = SchemaCompareService.diff(snap_a, snap_b)
    summary = diff["summary"]
    assert summary["missing_in_target_count"] == 1  # orders
    assert summary["extra_in_target_count"] == 1    # legacy_logs
    assert summary["identical_count"] == 1          # users

    orders_diff = [t for t in diff["tables"] if t["table"] == "orders"][0]
    assert orders_diff["status"] == "missing_in_target"
    assert orders_diff["action"] == "create"
    assert "CREATE TABLE [dbo].[orders]" in orders_diff["migration_sql"]

    logs_diff = [t for t in diff["tables"] if t["table"] == "legacy_logs"][0]
    assert logs_diff["status"] == "extra_in_target"
    assert logs_diff["action"] == "drop"
    assert logs_diff["destructive"] is True
    assert "DROP TABLE [dbo].[legacy_logs];" in logs_diff["migration_sql"]


def test_schema_compare_diff_columns_altered():
    # Source has modified column type and added column
    snap_a = {
        "engine": "sqlserver",
        "database": "db_a",
        "schema": "dbo",
        "tables": {
            "customers": {
                "table": "customers",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "name", "type": "nvarchar", "size": 100, "nullable": False},
                    {"name": "email", "type": "varchar", "size": 255, "nullable": True}  # Added
                ],
                "pk_name": "PK_customers",
                "has_pk": True
            }
        }
    }
    # Target has name as nvarchar(50) and no email
    snap_b = {
        "engine": "sqlserver",
        "database": "db_b",
        "schema": "dbo",
        "tables": {
            "customers": {
                "table": "customers",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "name", "type": "nvarchar", "size": 50, "nullable": False}
                ],
                "pk_name": "PK_customers",
                "has_pk": True
            }
        }
    }

    diff = SchemaCompareService.diff(snap_a, snap_b)
    assert diff["summary"]["different_count"] == 1
    cust_diff = diff["tables"][0]
    assert cust_diff["table"] == "customers"
    assert cust_diff["status"] == "different"
    assert cust_diff["changes_summary"]["columns_added"] == 1  # email
    assert cust_diff["changes_summary"]["columns_altered"] == 1  # name 50 -> 100
    assert "alter table [dbo].[customers]" in cust_diff["migration_sql"].lower()


def test_schema_compare_constraint_normalization():
    """
    Verifies that differing random auto-generated constraint names (e.g. PK__users__123 vs PK__users__890)
    do NOT cause false positive DROP/ADD constraint diffs when definition matches!
    """
    snap_a = {
        "engine": "sqlserver",
        "database": "db_a",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "email", "type": "varchar", "size": 100, "nullable": False}
                ],
                "pk_name": "PK__users__9876543210ABCDEF",
                "uniques": [
                    {"name": "UQ__users__1111222233334444", "fields": ["email"]}
                ],
                "has_pk": True
            }
        }
    }
    snap_b = {
        "engine": "sqlserver",
        "database": "db_b",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "email", "type": "varchar", "size": 100, "nullable": False}
                ],
                "pk_name": "PK__users__AABBCCDDEEFF0011",
                "uniques": [
                    {"name": "UQ__users__5555666677778888", "fields": ["email"]}
                ],
                "has_pk": True
            }
        }
    }

    diff = SchemaCompareService.diff(snap_a, snap_b)
    # Because PK and Unique have identical definitions, constraint normalization must align them!
    assert diff["summary"]["identical_count"] == 1
    assert diff["summary"]["different_count"] == 0
    assert diff["tables"][0]["status"] == "identical"


def test_schema_compare_migration_script_generation():
    snap_a = {
        "engine": "postgresql",
        "database": "mydb",
        "schema": "public",
        "tables": {
            "invoices": {
                "table": "invoices",
                "engine": "postgresql",
                "columns": [{"name": "id", "type": "integer", "is_pk": True, "nullable": False}],
                "has_pk": True
            }
        }
    }
    snap_b = {
        "engine": "postgresql",
        "database": "mydb",
        "schema": "public",
        "tables": {}
    }

    diff = SchemaCompareService.diff(snap_a, snap_b)
    script_res = SchemaCompareService.generate_migration_script(
        diff,
        selected_tables=["invoices"],
        options={"wrap_transaction": True}
    )

    sql = script_res["sql"]
    assert "BEGIN;" in sql
    assert "COMMIT;" in sql
    assert 'CREATE TABLE "public"."invoices"' in sql
    assert script_res["table_count"] == 1


def test_schema_compare_real_sqlite_databases(tmp_path):
    """
    End-to-end integration test with real SQLite database files:
    1. Compares DB A (Source) with DB B (Target).
    2. Verifies missing, extra, and different tables.
    3. Generates migration script.
    4. Executes migration script on Target DB B.
    5. Confirms DB B is successfully migrated to match DB A.
    """
    from app.services.connection_manager import ConnectionManager

    cm = ConnectionManager()
    owner = "test_sc_user"

    db_a_file = str(tmp_path / "source_app.db")
    db_b_file = str(tmp_path / "target_app.db")

    conn_a, _ = cm.create_or_get(owner, {"type": "sqlite", "database": db_a_file})
    conn_b, _ = cm.create_or_get(owner, {"type": "sqlite", "database": db_b_file})

    # Source DB A schema
    conn_a.query_service.execute("""
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT
        );
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER,
            total REAL
        );
    """)

    # Target DB B schema
    conn_b.query_service.execute("""
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE old_audit_logs (
            log_id INTEGER PRIMARY KEY,
            msg TEXT
        );
    """)

    # Run snapshot & diff
    snap_a = SchemaCompareService.snapshot(conn_a.adapter, "main", "main")
    snap_b = SchemaCompareService.snapshot(conn_b.adapter, "main", "main")

    diff = SchemaCompareService.diff(snap_a, snap_b)
    summary = diff["summary"]

    assert summary["missing_in_target_count"] == 1  # orders
    assert summary["extra_in_target_count"] == 1    # old_audit_logs
    assert summary["different_count"] == 1          # customers (missing email in target)

    # Generate migration script for customers & orders
    script_res = SchemaCompareService.generate_migration_script(
        diff,
        selected_tables=["customers", "orders"],
        options={"wrap_transaction": True, "include_drop_tables": False}
    )

    mig_sql = script_res["sql"]
    assert "orders" in mig_sql
    assert "customers" in mig_sql

    # Execute migration on Target DB B
    exec_res = conn_b.query_service.execute(mig_sql)
    assert exec_res.get("error") is None

    # Verify Target DB B now has orders table and email column
    new_snap_b = SchemaCompareService.snapshot(conn_b.adapter, "main", "main")
    assert "orders" in new_snap_b["tables"]
    b_cust_cols = [c["name"] for c in new_snap_b["tables"]["customers"]["columns"]]
    assert "email" in b_cust_cols

    cm.close_all(owner)


def test_schema_compare_zero_inline_css():
    """
    Verifies the Zero Inline CSS invariant:
    1. templates/schema_compare_window.html has 0 style="..." attributes.
    2. static/js/schema-compare.js has 0 inline style="..." attributes in generated HTML.
    3. schema-compare-container in templates/index.html and templates/partials/editor.html has 0 inline style.
    """
    import re
    from pathlib import Path

    ws_dir = Path(__file__).resolve().parent.parent

    # 1. Template
    win_tpl = ws_dir / "templates" / "schema_compare_window.html"
    assert win_tpl.exists()
    content = win_tpl.read_text(encoding="utf-8")
    # Exclude style-src in CSP meta header
    body_content = content[content.find("<body"):]
    style_matches = re.findall(r'\bstyle\s*=\s*["\'][^"\']*["\']', body_content, re.IGNORECASE)
    assert style_matches == [], f"Found inline style in schema_compare_window.html: {style_matches}"

    # 2. JS component
    js_file = ws_dir / "static" / "js" / "schema-compare.js"
    assert js_file.exists()
    js_content = js_file.read_text(encoding="utf-8")
    js_style_matches = re.findall(r'style\s*=\s*\\?["\'][^"\'\n]+', js_content, re.IGNORECASE)
    assert js_style_matches == [], f"Found inline style in schema-compare.js: {js_style_matches}"

    # 3. CSS file exists and is populated
    css_file = ws_dir / "static" / "css" / "schema-compare.css"
    assert css_file.exists()
    assert len(css_file.read_text(encoding="utf-8")) > 500


def test_schema_compare_api_mixin(tmp_path):
    """
    Tests SchemaCompareApiMixin methods integrated into MainApi.
    """
    from main import MainApi
    from app.services.connection_manager import ConnectionManager

    cm = ConnectionManager()
    api = MainApi(cm)

    # 1. get_connections
    conn_res = api.schema_compare_get_connections()
    assert conn_res["success"] is True
    assert isinstance(conn_res["connections"], list)

    # 2. Setup SQLite connection
    db_file = str(tmp_path / "api_test.db")
    conn, _ = cm.create_or_get("desktop_user", {"type": "sqlite", "database": db_file})
    conn.query_service.execute("CREATE TABLE t1 (id INT PRIMARY KEY);")

    # 3. get_schemas
    schema_res = api.schema_compare_get_schemas(conn.connection_id)
    assert schema_res["success"] is True
    assert "main" in schema_res["schemas"]

    # 4. run compare on same db
    run_res = api.schema_compare_run(
        conn.connection_id, "main", "main",
        conn.connection_id, "main", "main"
    )
    assert run_res["success"] is True
    assert run_res["summary"]["identical_count"] == 1

    # 5. generate script
    gen_res = api.schema_compare_generate_script(run_res["diff"], selected_tables=["t1"])
    assert gen_res["success"] is True
    assert isinstance(gen_res["sql"], str)

    cm.close_all("desktop_user")


def test_schema_compare_direct_connection_and_same_engine_enforcement(tmp_path):
    """
    Verifies:
    1. schema_compare_connect_direct creates runtime connection without requiring saved profile.
    2. schema_compare_run rejects cross-engine comparison when db_types differ.
    """
    from main import MainApi
    from app.services.connection_manager import ConnectionManager

    cm = ConnectionManager()
    api = MainApi(cm)

    # 1. Direct connection for SQLite DB
    db_file_1 = str(tmp_path / "direct_1.db")
    res_direct_1 = api.schema_compare_connect_direct({
        "type": "sqlite",
        "database": db_file_1
    })
    assert res_direct_1["success"] is True
    assert res_direct_1["connection"]["db_type"] == "sqlite"
    assert res_direct_1["connection"]["is_direct"] is True
    conn_id_1 = res_direct_1["connection"]["id"]

    # Initialize a table in direct DB 1
    conn_1 = cm.get("desktop_user", conn_id_1)
    conn_1.query_service.execute("CREATE TABLE orders (order_id INT PRIMARY KEY, amount REAL);")

    # 2. Second direct connection for SQLite DB
    db_file_2 = str(tmp_path / "direct_2.db")
    res_direct_2 = api.schema_compare_connect_direct({
        "type": "sqlite",
        "database": db_file_2
    })
    assert res_direct_2["success"] is True
    conn_id_2 = res_direct_2["connection"]["id"]

    # 3. Compare between two same-type direct connections -> Success
    run_res = api.schema_compare_run(
        conn_id_1, "main", "main",
        conn_id_2, "main", "main"
    )
    assert run_res["success"] is True
    assert run_res["summary"]["missing_in_target_count"] == 1

    # 4. Same engine enforcement: Create mock connection of another db_type (e.g. postgresql)
    class FakeAdapter:
        db_type = "postgresql"
        database = "fake_pg"

    class FakeConn:
        adapter = FakeAdapter()
        connection_id = "fake_pg_conn"
        owner_session_id = "desktop_user"
        config = {"type": "postgresql", "name": "Fake PG"}
        def touch(self): pass

    cm._connections["fake_pg_conn"] = FakeConn()

    # Attempt cross-engine compare (sqlite vs postgresql)
    cross_res = api.schema_compare_run(
        conn_id_1, "main", "main",
        "fake_pg_conn", "fake_pg", "public"
    )
    assert cross_res["success"] is False
    assert "Chỉ hỗ trợ so sánh 2 database cùng loại" in cross_res["error"]

    cm.close_all("desktop_user")


def test_schema_compare_programmability_objects():
    """
    Verifies that SchemaCompareService correctly diffs programmable objects:
    views, procedures, functions, and triggers, including DDL side-by-side diffing
    and migration script generation with object-type headers.
    """
    class ProgrammabilityAdapter:
        def __init__(self, db_type="sqlserver", objects_data=None):
            self.db_type = db_type
            self.objects = objects_data or {
                "tables": {},
                "views": {},
                "procedures": {},
                "functions": {},
                "triggers": {}
            }

        def list_objects(self, database, schema, object_type, limit=0):
            return [{"name": name} for name in self.objects.get(object_type, {}).keys()]

        def get_table_design_metadata(self, database, schema, table):
            return self.objects.get("tables", {}).get(table)

        def get_object_definition(self, database, schema, name, object_type):
            return self.objects.get(object_type, {}).get(name, "")

    src_adapter = ProgrammabilityAdapter(
        db_type="sqlserver",
        objects_data={
            "tables": {
                "users": {
                    "table": "users", "engine": "sqlserver",
                    "columns": [{"name": "id", "type": "int", "is_pk": True, "nullable": False}],
                    "has_pk": True
                }
            },
            "views": {
                "v_active_users": "CREATE VIEW v_active_users AS SELECT id FROM users WHERE is_active = 1",
                "v_reports": "CREATE VIEW v_reports AS SELECT id, count(*) as cnt FROM users GROUP BY id"
            },
            "procedures": {
                "sp_get_user": "CREATE PROCEDURE sp_get_user @id INT AS BEGIN SELECT * FROM users WHERE id = @id END"
            },
            "functions": {},
            "triggers": {}
        }
    )

    tgt_adapter = ProgrammabilityAdapter(
        db_type="sqlserver",
        objects_data={
            "tables": {
                "users": {
                    "table": "users", "engine": "sqlserver",
                    "columns": [{"name": "id", "type": "int", "is_pk": True, "nullable": False}],
                    "has_pk": True
                }
            },
            "views": {
                # Identical view
                "v_active_users": "CREATE VIEW v_active_users AS SELECT id FROM users WHERE is_active = 1",
                # Different definition in target
                "v_reports": "CREATE VIEW v_reports AS SELECT id FROM users"
            },
            "procedures": {},  # sp_get_user missing in target
            "functions": {
                # Extra function in target
                "fn_calc": "CREATE FUNCTION fn_calc() RETURNS INT AS BEGIN RETURN 1 END"
            },
            "triggers": {}
        }
    )

    # 1. Snapshot test
    snap_src = SchemaCompareService.snapshot(src_adapter, "db_src", "dbo")
    snap_tgt = SchemaCompareService.snapshot(tgt_adapter, "db_tgt", "dbo")

    assert "v_active_users" in snap_src["views"]
    assert "sp_get_user" in snap_src["procedures"]
    assert "fn_calc" in snap_tgt["functions"]

    # 2. Diff test
    diff_res = SchemaCompareService.diff(snap_src, snap_tgt)
    summary = diff_res["summary"]

    assert summary["tables_count"] == 1
    assert summary["views_count"] == 2
    assert summary["procedures_count"] == 1
    assert summary["functions_count"] == 1

    objects = diff_res["tables"]
    by_name = {d["name"]: d for d in objects}

    # v_active_users -> identical
    assert by_name["v_active_users"]["status"] == "identical"
    assert by_name["v_active_users"]["object_type"] == "view"

    # v_reports -> different
    assert by_name["v_reports"]["status"] == "different"
    assert by_name["v_reports"]["object_type"] == "view"
    assert "source_definition" in by_name["v_reports"]
    assert "target_definition" in by_name["v_reports"]
    assert by_name["v_reports"]["source_definition"] != by_name["v_reports"]["target_definition"]

    # sp_get_user -> missing_in_target (to create)
    assert by_name["sp_get_user"]["status"] == "missing_in_target"
    assert by_name["sp_get_user"]["action"] == "create"
    assert by_name["sp_get_user"]["object_type"] == "procedure"

    # fn_calc -> extra_in_target (to drop)
    assert by_name["fn_calc"]["status"] == "extra_in_target"
    assert by_name["fn_calc"]["action"] == "drop"
    assert by_name["fn_calc"]["destructive"] is True
    assert by_name["fn_calc"]["object_type"] == "function"

    # 3. Migration script generation test
    script_res = SchemaCompareService.generate_migration_script(
        diff_res,
        selected_tables=["v_reports", "sp_get_user"],
        options={"wrap_transaction": True}
    )
    assert isinstance(script_res["sql"], str)
    sql = script_res["sql"]
    assert "View: [v_reports]" in sql
    assert "Procedure: [sp_get_user]" in sql
    assert "SET XACT_ABORT ON;" in sql
    assert "COMMIT TRANSACTION;" in sql


def test_schema_compare_selective_object_types():
    """
    Verifies that SchemaCompareService.snapshot and schema_compare_run
    respect selective object_types (e.g. only tables or only views/procedures)
    to avoid over-fetching unwanted objects from database.
    """
    class MultiObjectAdapter:
        db_type = "sqlserver"
        def __init__(self):
            self.call_log = []

        def list_objects(self, database, schema, object_type, limit=0):
            self.call_log.append(f"list_{object_type}")
            if object_type == "tables":
                return [{"name": "t1"}, {"name": "t2"}]
            elif object_type == "views":
                return [{"name": "v1"}]
            elif object_type == "procedures":
                return [{"name": "sp1"}]
            return []

        def get_table_design_metadata(self, database, schema, table):
            self.call_log.append(f"meta_{table}")
            return {"table": table, "engine": "sqlserver", "columns": [], "has_pk": False}

        def get_object_definition(self, database, schema, name, object_type):
            self.call_log.append(f"def_{object_type}_{name}")
            return f"CREATE {object_type.upper()} {name} AS SELECT 1"

    adapter = MultiObjectAdapter()

    # 1. Test snapshot with only ['tables']
    snap_tables_only = SchemaCompareService.snapshot(adapter, "db", "dbo", object_types=["tables"])
    assert "t1" in snap_tables_only["tables"]
    assert len(snap_tables_only["views"]) == 0
    assert len(snap_tables_only["procedures"]) == 0
    assert "list_tables" in adapter.call_log
    assert "list_views" not in adapter.call_log

    # 2. Test snapshot with only ['views', 'procedures']
    adapter.call_log.clear()
    snap_code_only = SchemaCompareService.snapshot(adapter, "db", "dbo", object_types=["views", "procedures"])
    assert len(snap_code_only["tables"]) == 0
    assert "v1" in snap_code_only["views"]
    assert "sp1" in snap_code_only["procedures"]
    assert "list_tables" not in adapter.call_log
    assert "list_views" in adapter.call_log
    assert "list_procedures" in adapter.call_log


def test_schema_compare_subwindow_api_signature():
    """
    Verifies that SchemaCompareSubwindowApi.schema_compare_run correctly supports
    object_types argument (passing 7 positional arguments from JavaScript pywebview client).
    """
    from app.desktop.windows import SchemaCompareSubwindowApi

    class MockMainApi:
        def __init__(self):
            self.last_call = None

        def schema_compare_run(self, source_conn_id, source_db, source_schema, target_conn_id, target_db, target_schema, object_types=None):
            self.last_call = {
                "source_conn_id": source_conn_id,
                "source_db": source_db,
                "source_schema": source_schema,
                "target_conn_id": target_conn_id,
                "target_db": target_db,
                "target_schema": target_schema,
                "object_types": object_types
            }
            return {"success": True}

    mock_main = MockMainApi()
    sub_api = SchemaCompareSubwindowApi(mock_main)

    # Call with 7 positional arguments (self + 7 = 8 positional arguments)
    res = sub_api.schema_compare_run("c1", "db1", "dbo", "c2", "db2", "dbo", ["views"])
    assert res["success"] is True
    assert mock_main.last_call["object_types"] == ["views"]

    # Call with 6 positional arguments (object_types default None)
    res2 = sub_api.schema_compare_run("c1", "db1", "dbo", "c2", "db2", "dbo")
    assert res2["success"] is True
    assert mock_main.last_call["object_types"] is None


def test_schema_compare_table_source_and_target_definitions():
    """
    Verifies that table diffs include source_definition and target_definition for Monaco Diff Editor.
    """
    src_snap = {
        "engine": "sqlserver",
        "database": "src_db",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "schema": "dbo",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "name", "type": "nvarchar", "length": 100, "nullable": True}
                ],
                "has_pk": True
            },
            "products": {
                "table": "products",
                "engine": "sqlserver",
                "schema": "dbo",
                "columns": [{"name": "pid", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            }
        },
        "views": {}, "procedures": {}, "functions": {}, "triggers": {}
    }

    tgt_snap = {
        "engine": "sqlserver",
        "database": "tgt_db",
        "schema": "dbo",
        "tables": {
            "users": {
                "table": "users",
                "engine": "sqlserver",
                "schema": "dbo",
                "columns": [
                    {"name": "id", "type": "int", "is_pk": True, "nullable": False},
                    {"name": "name", "type": "varchar", "length": 50, "nullable": True}
                ],
                "has_pk": True
            },
            "orders": {
                "table": "orders",
                "engine": "sqlserver",
                "schema": "dbo",
                "columns": [{"name": "oid", "type": "int", "is_pk": True, "nullable": False}],
                "has_pk": True
            }
        },
        "views": {}, "procedures": {}, "functions": {}, "triggers": {}
    }

    diff_res = SchemaCompareService.diff(src_snap, tgt_snap)
    diffs_by_table = {d["table"]: d for d in diff_res["tables"]}

    # users (different): both source_definition and target_definition exist and have CREATE TABLE
    u_diff = diffs_by_table["users"]
    assert u_diff["object_type"] == "table"
    assert "CREATE TABLE [dbo].[users]" in u_diff["source_definition"]
    assert "CREATE TABLE [dbo].[users]" in u_diff["target_definition"]
    assert u_diff["status"] == "different"

    # products (missing in target): source_definition exists, target_definition is empty
    p_diff = diffs_by_table["products"]
    assert p_diff["object_type"] == "table"
    assert "CREATE TABLE [dbo].[products]" in p_diff["source_definition"]
    assert p_diff["target_definition"] == ""
    assert p_diff["status"] == "missing_in_target"

    # orders (extra in target): target_definition exists, source_definition is empty
    o_diff = diffs_by_table["orders"]
    assert o_diff["object_type"] == "table"
    assert o_diff["source_definition"] == ""
    assert "CREATE TABLE [dbo].[orders]" in o_diff["target_definition"]
    assert o_diff["status"] == "extra_in_target"


def test_schema_compare_subwindow_fetch_metadata():
    """Verifies that SchemaCompareSubwindowApi delegates fetch_connection_metadata to main_api."""
    from app.desktop.windows import SchemaCompareSubwindowApi

    class MockMainApi:
        def __init__(self):
            self.last_config = None

        def fetch_connection_metadata(self, config):
            self.last_config = config
            return {"success": True, "databases": ["master", "testdb"], "schemas": ["dbo"]}

    mock_main = MockMainApi()
    sub_api = SchemaCompareSubwindowApi(mock_main)

    res = sub_api.fetch_connection_metadata({"server": "localhost", "type": "sqlserver"})
    assert res["success"] is True
    assert res["databases"] == ["master", "testdb"]
    assert mock_main.last_config == {"server": "localhost", "type": "sqlserver"}

def test_schema_compare_cancel_and_delegation():
    """Verifies that schema_compare_cancel stops running process and delegates correctly."""
    from app.desktop.windows import SchemaCompareSubwindowApi
    from app.api.schema_compare_api import SchemaCompareApiMixin
    from unittest.mock import MagicMock

    class DummyApi(SchemaCompareApiMixin):
        def __init__(self):
            self.cm = MagicMock()
            self.owner_session_id = "test_session"

    dummy_api = DummyApi()

    # Verify cancel sets event
    res = dummy_api.schema_compare_cancel()
    assert res["success"] is True
    assert dummy_api._schema_compare_cancel_event.is_set()

    # Verify Subwindow API delegates
    sub_api = SchemaCompareSubwindowApi(dummy_api)
    res_sub = sub_api.schema_compare_cancel()
    assert res_sub["success"] is True


def test_schema_compare_get_schemas_connection_validation():
    """Verifies connection health check in schema_compare_get_schemas returns failure when invalid."""
    from app.api.schema_compare_api import SchemaCompareApiMixin
    from unittest.mock import MagicMock

    class DummyApi(SchemaCompareApiMixin):
        def __init__(self):
            self.cm = MagicMock()
            self.cm._connections = {}
            self.cm._lock = MagicMock()
            self.owner_session_id = "test_session"

    dummy_api = DummyApi()

    # Non-existent connection
    res = dummy_api.schema_compare_get_schemas("non_existent_conn_123")
    assert res["success"] is False
    assert "error" in res


def test_sqlserver_bulk_catalog_methods_mock():
    """Verifies SqlServerAdapter bulk table and code object catalog methods."""
    from app.database.sqlserver import SqlServerAdapter
    from unittest.mock import MagicMock

    adapter = SqlServerAdapter({"host": "dummy"})
    adapter.execute = MagicMock()

    # Mock execute for get_all_tables_design_metadata:
    # 1. columns
    # 2. indexes
    # 3. foreign_keys
    # 4. uniques
    # 5. checks
    # 6. triggers
    adapter.execute.side_effect = [
        # col_res: [table_name, column_id, col_name, type_name, max_len, prec, scale, is_nullable, is_identity, seed, inc, default_val, collation, is_pk, desc, is_udt, type_schema, type_raw, is_computed, pk_name, def_constraint]
        {"rows": [
            ["Users", 1, "id", "int", 4, 10, 0, False, True, 1, 1, None, None, True, None, False, "sys", "int", False, "PK_Users", None],
            ["Users", 2, "name", "nvarchar", 100, 0, 0, True, False, 1, 1, "('guest')", "SQL_Latin1_General_CP1_CI_AS", False, None, False, "sys", "nvarchar", False, None, "DF_Users_name"]
        ]},
        # idx_res
        {"rows": []},
        # fk_res
        {"rows": []},
        # uq_res
        {"rows": []},
        # chk_res
        {"rows": []},
        # trig_res
        {"rows": []}
    ]

    res = adapter.get_all_tables_design_metadata("TestDb", "dbo")
    assert "Users" in res
    assert res["Users"]["table"] == "Users"
    assert res["Users"]["pk_name"] == "PK_Users"
    assert len(res["Users"]["columns"]) == 2
    assert res["Users"]["columns"][0]["name"] == "id"
    assert res["Users"]["columns"][0]["is_pk"] is True
    assert res["Users"]["columns"][1]["name"] == "name"
    assert res["Users"]["columns"][1]["default_value"] == "'guest'"

    # Mock execute for get_all_code_objects_metadata
    adapter.execute.side_effect = [
        {"rows": [
            ["v_active_users", "CREATE VIEW dbo.v_active_users AS SELECT * FROM dbo.Users;"]
        ]}
    ]
    views_res = adapter.get_all_code_objects_metadata("TestDb", "dbo", "views")
    assert "v_active_users" in views_res
    assert views_res["v_active_users"]["definition"] == "CREATE VIEW dbo.v_active_users AS SELECT * FROM dbo.Users;"


def test_schema_compare_snapshot_bulk_and_fallback():
    """Verifies SchemaCompareService.snapshot uses bulk catalog and handles Rule 1 & 11 fallback."""
    from app.services.schema_compare_service import SchemaCompareService
    from unittest.mock import MagicMock

    adapter = MagicMock()
    adapter.db_type = "sqlserver"
    adapter.list_objects.side_effect = lambda db, sch, otype, limit=0: (
        [{"name": "TableA"}, {"name": "TableB"}] if otype == "tables" else
        [{"name": "ViewA"}, {"name": "ViewB"}] if otype == "views" else []
    )

    # Bulk returns TableA only (TableB was missing from bulk result)
    adapter.get_all_tables_design_metadata.return_value = {
        "TableA": {"table": "TableA", "columns": []}
    }
    # Fallback retrieves TableB
    adapter.get_table_design_metadata.return_value = {
        "table": "TableB", "columns": []
    }

    # Bulk views raises exception (test fallback)
    adapter.get_all_code_objects_metadata.side_effect = RuntimeError("Bulk permission error")
    adapter.get_object_definition.side_effect = lambda db, sch, name, otype: f"DEFINITION_OF_{name}"

    snap = SchemaCompareService.snapshot(
        adapter, "TestDb", "dbo",
        object_types=["tables", "views"]
    )

    assert "TableA" in snap["tables"]
    assert "TableB" in snap["tables"]
    adapter.get_table_design_metadata.assert_called_once_with("TestDb", "dbo", "TableB")

    assert "ViewA" in snap["views"]
    assert "ViewB" in snap["views"]
    assert snap["views"]["ViewA"]["definition"] == "DEFINITION_OF_ViewA"
    assert snap["views"]["ViewB"]["definition"] == "DEFINITION_OF_ViewB"


def test_schema_compare_bravo_layout_option_in_js():
    """
    Verifies that schema-compare.js:
    1. Contains the 'Layout' option in #scSelectObjType with id 'scOptLayout'.
    2. Preserves all standard Schema Compare options (all, tables, views, procedures, functions, triggers).
    3. Implements checkBravoExtensionStatus to dynamically toggle visibility based on addons.bravo_tool.enabled.
    4. Handles 'layout' in getSelectedObjectTypes and onObjectTypeSelectionChanged.
    """
    from pathlib import Path
    js_path = Path(__file__).resolve().parent.parent / "static" / "js" / "schema-compare.js"
    assert js_path.exists(), f"File not found: {js_path}"
    content = js_path.read_text(encoding="utf-8")

    # 1. Option tag
    assert '<option value="layout" id="scOptLayout" class="d-none">Layout</option>' in content

    # 2. Standard options intact
    assert '<option value="all">Tất cả các loại</option>' in content
    assert '<option value="tables">Bảng (Tables)</option>' in content
    assert '<option value="views">Views</option>' in content
    assert '<option value="procedures">Procedures</option>' in content
    assert '<option value="functions">Functions</option>' in content
    assert '<option value="triggers">Triggers</option>' in content

    # 3. Extension check implementation
    assert "checkBravoExtensionStatus" in content
    assert "bravo_tool" in content
    assert "isBravoExtensionEnabled" in content

    # 4. Handler support
    assert "typeNames" in content and "'layout': 'Layout'" in content
    assert "if (val === 'layout')" in content


def test_schema_compare_bravo_layout_ui_and_actions_in_js():
    """
    Verifies that schema-compare.js and schema-compare.css implement:
    1. Action button: scBtnPreviewLayoutScript (and removal of external xml / save buttons per user request).
    2. Methods: toggleLayoutModeControls, runBravoLayoutCompare, renderBravoLayoutList,
       onBravoLayoutRowClick, renderBravoLayoutDiff, previewBravoLayoutScript.
    3. CSS class .sc-obj-tag-layout in schema-compare.css.
    4. Object filter menu item #scFilterItemOptLayout for filtering Layout objects.
    """
    from pathlib import Path
    root_dir = Path(__file__).resolve().parent.parent
    js_path = root_dir / "static" / "js" / "schema-compare.js"
    css_path = root_dir / "static" / "css" / "schema-compare.css"

    js_content = js_path.read_text(encoding="utf-8")
    css_content = css_path.read_text(encoding="utf-8")

    # 1. UI Buttons
    assert 'id="scBtnPreviewLayoutScript"' in js_content
    assert 'id="scBtnOpenExternalXml"' not in js_content
    assert 'id="scBtnSaveLayout"' not in js_content
    assert 'id="scLayoutFileInput"' not in js_content
    assert 'id="scFilterItemOptLayout"' in js_content

    # 2. Methods
    assert "toggleLayoutModeControls(isLayout)" in js_content
    assert "async runBravoLayoutCompare()" in js_content
    assert "renderBravoLayoutList()" in js_content
    assert "async onBravoLayoutRowClick(layoutId)" in js_content
    assert "renderBravoLayoutDiff()" in js_content
    assert "async previewBravoLayoutScript()" in js_content

    # 3. CSS tag class
    assert ".sc-obj-tag-layout" in css_content


def test_schema_compare_js_syntax_integrity():
    """
    Verifies that schema-compare.js has no duplicate const declarations in the same scope
    and exports window.SchemaCompare correctly without syntax errors.
    """
    import re
    from pathlib import Path
    root_dir = Path(__file__).resolve().parent.parent
    js_path = root_dir / "static" / "js" / "schema-compare.js"
    js_content = js_path.read_text(encoding="utf-8")

    # Verify runCompare method body does not redeclare const objectTypes
    run_compare_match = re.search(r'async runCompare\(\)\s*\{([\s\S]*?)\n\s*this\.showLoadingModal', js_content)
    assert run_compare_match is not None, "runCompare method not found"
    body = run_compare_match.group(1)
    decl_count = len(re.findall(r'\b(?:const|let|var)\s+objectTypes\b', body))
    assert decl_count == 1, f"Expected exactly 1 declaration of objectTypes in runCompare, found {decl_count}"

    # Verify global export
    assert "global.SchemaCompare = new SchemaCompareComponent();" in js_content


def test_schema_compare_bravo_layout_pywebview_compatibility():
    """
    Verifies that pywebview can inspect and expose all Bravo layout API methods
    without raising 'unsupported callable' (e.g., due to unimported type hints in Python 3.14).
    """
    import inspect
    from app.api.schema_compare_api import SchemaCompareApiMixin
    from app.desktop.windows import SchemaCompareSubwindowApi
    from main import MainApi

    methods = [
        "schema_compare_bravo_layout_list",
        "schema_compare_bravo_layout_detail",
        "schema_compare_bravo_layout_generate_script",
        "schema_compare_bravo_layout_apply_update",
    ]

    for m in methods:
        # 1. SchemaCompareApiMixin
        assert hasattr(SchemaCompareApiMixin, m), f"SchemaCompareApiMixin missing {m}"
        spec = inspect.getfullargspec(getattr(SchemaCompareApiMixin, m))
        assert spec.args[0] == "self"

        # 2. MainApi
        assert hasattr(MainApi, m), f"MainApi missing {m}"
        spec_main = inspect.getfullargspec(getattr(MainApi, m))
        assert spec_main.args[0] == "self"

        # 3. SchemaCompareSubwindowApi
        assert hasattr(SchemaCompareSubwindowApi, m), f"SchemaCompareSubwindowApi missing {m}"
        spec_sub = inspect.getfullargspec(getattr(SchemaCompareSubwindowApi, m))
        assert spec_sub.args[0] == "self"
