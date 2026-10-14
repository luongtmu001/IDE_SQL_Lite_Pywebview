"""
Tests for Phase 4 Step 2D & 2E:
- DDL statements ordering: Drop FK/index/constraint/default BEFORE drop column; Add columns BEFORE add constraints/indexes.
- Constraint definition diff: Drop and recreate if definition changed even when name is identical.
"""
import pytest
from app.services.table_designer_service import TableDesignerService


def test_ddl_ordering_drops_before_columns():
    """Drops must occur in order: FK -> Index -> Constraints -> Columns."""
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "CustomerId", "type": "int", "nullable": True},
            {"name": "OldCol", "type": "varchar", "size": "50", "nullable": True}
        ],
        "foreign_keys": [
            {"name": "FK_Orders_Customer", "fields": ["CustomerId"], "ref_schema": "dbo", "ref_table": "Customers", "ref_fields": ["Id"]}
        ],
        "indexes": [
            {"name": "IX_Orders_OldCol", "fields": [{"column": "OldCol", "desc": False}], "index_type": "NONCLUSTERED"}
        ],
        "uniques": [
            {"name": "UQ_Orders_OldCol", "fields": ["OldCol"]}
        ],
        "checks": [
            {"name": "CK_Orders_OldCol", "check_clause": "[OldCol] IS NOT NULL"}
        ],
        "triggers": []
    }

    # In mod, CustomerId and OldCol are dropped, along with their FK, Index, UQ, and CK
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True}
        ],
        "foreign_keys": [],
        "indexes": [],
        "uniques": [],
        "checks": [],
        "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]

    # Find statement indices
    fk_drop_idx = next(i for i, s in enumerate(sqls) if "drop constraint [FK_Orders_Customer]" in s)
    idx_drop_idx = next(i for i, s in enumerate(sqls) if "DROP INDEX [IX_Orders_OldCol]" in s)
    uq_drop_idx = next(i for i, s in enumerate(sqls) if "drop constraint [UQ_Orders_OldCol]" in s)
    ck_drop_idx = next(i for i, s in enumerate(sqls) if "drop constraint [CK_Orders_OldCol]" in s)
    col_drop_idx = next(i for i, s in enumerate(sqls) if "drop column [OldCol]" in s)

    # All constraint and index drops MUST happen before column drop
    assert fk_drop_idx < col_drop_idx
    assert idx_drop_idx < col_drop_idx
    assert uq_drop_idx < col_drop_idx
    assert ck_drop_idx < col_drop_idx


def test_index_definition_change_recreates_index():
    """If index definition changes (e.g. columns changed), index must be dropped and recreated."""
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Products",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Category", "type": "varchar", "size": "50", "nullable": True},
            {"name": "Subcategory", "type": "varchar", "size": "50", "nullable": True}
        ],
        "indexes": [
            {"name": "IX_Category", "fields": [{"column": "Category", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": False}
        ],
        "foreign_keys": [], "uniques": [], "checks": [], "triggers": []
    }

    # Same index name IX_Category, but now includes Subcategory and is UNIQUE
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Products",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Category", "type": "varchar", "size": "50", "nullable": True},
            {"name": "Subcategory", "type": "varchar", "size": "50", "nullable": True}
        ],
        "indexes": [
            {"name": "IX_Category", "fields": [{"column": "Category", "desc": False}, {"column": "Subcategory", "desc": False}], "index_type": "NONCLUSTERED", "is_unique": True}
        ],
        "foreign_keys": [], "uniques": [], "checks": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]

    # Must contain DROP INDEX [IX_Category]
    assert any("DROP INDEX [IX_Category]" in s for s in sqls)
    # Must contain CREATE UNIQUE NONCLUSTERED INDEX [IX_Category] with both columns
    assert any("CREATE UNIQUE NONCLUSTERED INDEX [IX_Category]" in s and "[Category], [Subcategory]" in s for s in sqls)


def test_foreign_key_definition_change_recreates_fk():
    """If foreign key definition changes (e.g. on_delete changed), FK must be dropped and recreated."""
    orig = {
        "engine": "postgresql",
        "schema": "public",
        "table": "orders",
        "columns": [
            {"name": "id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "user_id", "type": "int", "nullable": True}
        ],
        "foreign_keys": [
            {"name": "fk_orders_user", "fields": ["user_id"], "ref_schema": "public", "ref_table": "users", "ref_fields": ["id"], "on_delete": "NO ACTION"}
        ],
        "indexes": [], "uniques": [], "checks": [], "triggers": []
    }

    # Same FK name, but on_delete changed to CASCADE
    mod = {
        "engine": "postgresql",
        "schema": "public",
        "table": "orders",
        "columns": [
            {"name": "id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "user_id", "type": "int", "nullable": True}
        ],
        "foreign_keys": [
            {"name": "fk_orders_user", "fields": ["user_id"], "ref_schema": "public", "ref_table": "users", "ref_fields": ["id"], "on_delete": "CASCADE"}
        ],
        "indexes": [], "uniques": [], "checks": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]

    # Must drop constraint "fk_orders_user"
    assert any('drop constraint "fk_orders_user"' in s for s in sqls)
    # Must add constraint with on delete cascade
    assert any('add constraint "fk_orders_user"' in s and "on delete cascade" in s for s in sqls)


def test_check_constraint_definition_change_recreates_check():
    """If check clause changes, check constraint must be dropped and recreated."""
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Products",
        "columns": [{"name": "Price", "type": "decimal", "size": "10", "scale": "2", "nullable": False}],
        "checks": [{"name": "CK_Price", "check_clause": "[Price] > 0"}],
        "indexes": [], "foreign_keys": [], "uniques": [], "triggers": []
    }
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Products",
        "columns": [{"name": "Price", "type": "decimal", "size": "10", "scale": "2", "nullable": False}],
        "checks": [{"name": "CK_Price", "check_clause": "[Price] >= 10"}],
        "indexes": [], "foreign_keys": [], "uniques": [], "triggers": []
    }
    diff = TableDesignerService.generate_diff(orig, mod)
    sqls = [s["sql"] for s in diff["statements"]]

    assert any("drop constraint [CK_Price]" in s for s in sqls)
    assert any("add constraint [CK_Price] check ([Price] >= 10)" in s for s in sqls)
