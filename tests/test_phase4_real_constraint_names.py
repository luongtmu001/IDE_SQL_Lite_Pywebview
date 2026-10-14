"""
Tests for Phase 4 Step 2B & 2C: Real constraint names from metadata and SQL Server default constraints.
"""
import pytest
from app.services.table_designer_service import TableDesignerService


def test_sqlserver_pk_drop_uses_real_pk_name():
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "pk_name": "PK_Custom_User_Id",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True, "pk_name": "PK_Custom_User_Id"},
            {"name": "Name", "type": "nvarchar", "size": "50", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "pk_name": "PK_Custom_User_Id",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": False}, # PK removed
            {"name": "Name", "type": "nvarchar", "size": "50", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    # Must drop constraint [PK_Custom_User_Id], NOT [PK_Users]
    assert any("drop constraint [PK_Custom_User_Id]" in s for s in sqls)
    assert not any("drop constraint [PK_Users]" in s for s in sqls)


def test_postgresql_pk_drop_uses_real_pk_name():
    orig = {
        "engine": "postgresql",
        "schema": "public",
        "table": "users",
        "pk_name": "users_pkey",
        "columns": [
            {"name": "id", "type": "int", "nullable": False, "is_pk": True, "pk_name": "users_pkey"},
            {"name": "name", "type": "varchar", "size": "50", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    mod = {
        "engine": "postgresql",
        "schema": "public",
        "table": "users",
        "columns": [
            {"name": "id", "type": "int", "nullable": False, "is_pk": False},
            {"name": "name", "type": "varchar", "size": "50", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    # Must drop constraint "users_pkey", NOT "PK_users"
    assert any('drop constraint "users_pkey"' in s for s in sqls)
    assert not any('drop constraint "PK_users"' in s for s in sqls)


def test_sqlserver_modify_default_drops_old_constraint_first():
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {
                "name": "Status",
                "type": "int",
                "nullable": False,
                "default_value": "1",
                "default_constraint_name": "DF__Orders__Status__7A123456"
            }
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {
                "name": "Status",
                "type": "int",
                "nullable": False,
                "default_value": "2", # changed from 1 to 2
                "default_constraint_name": "DF__Orders__Status__7A123456"
            }
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    # Must drop the old default constraint first
    assert any("drop constraint [DF__Orders__Status__7A123456]" in s for s in sqls)
    # Then add the new constraint
    assert any("add constraint" in s and "default 2 for [Status]" in s for s in sqls)


def test_sqlserver_remove_default_drops_constraint():
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {
                "name": "Status",
                "type": "int",
                "nullable": False,
                "default_value": "1",
                "default_constraint_name": "DF__Orders__Status__7A123456"
            }
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {
                "name": "Status",
                "type": "int",
                "nullable": False,
                "default_value": "", # removed
                "default_constraint_name": ""
            }
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }
    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]
    # Must drop the old default constraint
    assert any("drop constraint [DF__Orders__Status__7A123456]" in s for s in sqls)
    # No add constraint statement
    assert not any("add constraint" in s for s in sqls)
