"""
Tests for Phase 4 Step 2A: Quoting identifiers in Table Designer generate_diff.
Verifies table, column, and constraint quoting for SQL Server and PostgreSQL,
including names with spaces, uppercase, and keywords.
"""
import pytest
from app.services.table_designer_service import TableDesignerService


def test_sqlserver_generate_diff_quoting():
    orig = {
        "engine": "sqlserver",
        "schema": "sales",
        "table": "Order Details",
        "columns": [
            {"name": "Order ID", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Old Col", "type": "varchar", "size": "50", "nullable": True},
            {"name": "User", "type": "varchar", "size": "100", "nullable": True},
        ],
        "indexes": [],
        "uniques": [],
        "checks": [],
        "foreign_keys": [],
        "triggers": []
    }

    mod = {
        "engine": "sqlserver",
        "schema": "sales",
        "table": "Order Details",
        "columns": [
            {"name": "Order ID", "type": "int", "nullable": False, "is_pk": True},
            # "Old Col" dropped
            {"name": "User", "type": "nvarchar", "size": "200", "nullable": False}, # altered
            {"name": "New Col", "type": "datetime2", "scale": "3", "nullable": True}, # added
        ],
        "indexes": [],
        "uniques": [],
        "checks": [],
        "foreign_keys": [],
        "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    full_sql = "\n".join(sqls)

    # All table references should be properly quoted: [sales].[Order Details]
    assert "alter table [sales].[Order Details]" in full_sql

    # Dropped column quoted
    assert any("drop column [Old Col]" in s for s in sqls)

    # Added column quoted
    assert any("add [New Col] datetime2(3)" in s for s in sqls)

    # Altered column quoted
    assert any("alter column [User] nvarchar(200) not null" in s for s in sqls)


def test_postgresql_generate_diff_quoting():
    orig = {
        "engine": "postgresql",
        "schema": "my_schema",
        "table": "Users Table",
        "columns": [
            {"name": "user_id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Old Column", "type": "varchar", "size": "50", "nullable": True},
            {"name": "First Name", "type": "varchar", "size": "50", "nullable": True},
        ],
        "indexes": [],
        "uniques": [],
        "checks": [],
        "foreign_keys": [],
        "triggers": []
    }

    mod = {
        "engine": "postgresql",
        "schema": "my_schema",
        "table": "Users Table",
        "columns": [
            {"name": "user_id", "type": "int", "nullable": False, "is_pk": True},
            # "Old Column" dropped
            {"name": "First Name", "type": "varchar", "size": "100", "nullable": False}, # altered type and nullability
            {"name": "Last Name", "type": "varchar", "size": "100", "nullable": True}, # added
        ],
        "indexes": [],
        "uniques": [],
        "checks": [],
        "foreign_keys": [],
        "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    full_sql = "\n".join(sqls)

    # Table quoted with schema: "my_schema"."Users Table"
    assert 'alter table "my_schema"."Users Table"' in full_sql

    # Dropped column quoted
    assert any('drop column "Old Column"' in s for s in sqls)

    # Added column quoted
    assert any('add "Last Name" varchar(100)' in s for s in sqls)

    # Altered column quoted with using clause
    assert any('alter column "First Name" type varchar(100) using "First Name"::varchar(100)' in s for s in sqls)
    assert any('alter column "First Name" set not null' in s for s in sqls)
