"""
Tests for Phase 4 Step 2F & 2G:
- Destructive marking for column narrowing (e.g. varchar(500) -> varchar(50), int -> smallint).
- Destructive marking and warning for adding NOT NULL columns without default.
- Unified nullable default (missing key defaults to nullable=True).
- Drop constraint (FK, UQ, CK) is not marked destructive (unlike PK).
"""
import pytest
from app.services.table_designer_service import TableDesignerService


def test_column_narrowing_is_marked_destructive():
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Bio", "type": "varchar", "size": "500", "nullable": True},
            {"name": "Age", "type": "int", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    # Bio narrowed from 500 to 50; Age narrowed from int to smallint
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Bio", "type": "varchar", "size": "50", "nullable": True},
            {"name": "Age", "type": "smallint", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    assert diff["has_destructive"] is True

    bio_stmt = next(s for s in diff["statements"] if "alter column [Bio]" in s["sql"])
    assert bio_stmt["destructive"] is True

    age_stmt = next(s for s in diff["statements"] if "alter column [Age]" in s["sql"])
    assert age_stmt["destructive"] is True

    assert any("narrowed" in w.lower() and "Bio" in w for w in diff["warnings"])
    assert any("narrowed" in w.lower() and "Age" in w for w in diff["warnings"])


def test_add_not_null_column_without_default_is_destructive():
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    # Add required NOT NULL column without a default value
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Email", "type": "nvarchar", "size": "100", "nullable": False}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    assert diff["has_destructive"] is True

    email_stmt = next(s for s in diff["statements"] if "add [Email]" in s["sql"])
    assert email_stmt["destructive"] is True
    assert any("Email" in w and "not null" in w.lower() for w in diff["warnings"])


def test_unified_nullable_default_when_key_missing():
    """When nullable key is omitted, it must consistently default to True (nullable), matching generate_column_def."""
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Note", "type": "varchar", "size": "100"} # nullable missing -> True
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    # Mod specifies nullable=True explicitly: no nullability change should be detected
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Users",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Note", "type": "varchar", "size": "100", "nullable": True}
        ],
        "indexes": [], "uniques": [], "checks": [], "foreign_keys": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    # Note should NOT have an alter statement because both mean nullable=True
    assert not any("alter column [Note]" in s["sql"] for s in diff["statements"])


def test_drop_non_pk_constraint_is_not_destructive():
    """Dropping a FK, UQ, or CK constraint should not mark the diff as destructive, unlike dropping a PK or column."""
    orig = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Code", "type": "varchar", "size": "50", "nullable": True}
        ],
        "uniques": [{"name": "UQ_Code", "fields": ["Code"]}],
        "checks": [{"name": "CK_Code", "check_clause": "[Code] IS NOT NULL"}],
        "foreign_keys": [], "indexes": [], "triggers": []
    }

    # Remove UQ and CK
    mod = {
        "engine": "sqlserver",
        "schema": "dbo",
        "table": "Orders",
        "columns": [
            {"name": "Id", "type": "int", "nullable": False, "is_pk": True},
            {"name": "Code", "type": "varchar", "size": "50", "nullable": True}
        ],
        "uniques": [], "checks": [], "foreign_keys": [], "indexes": [], "triggers": []
    }

    diff = TableDesignerService.generate_diff(orig, mod)
    # Drop UQ and CK statements should have destructive=False
    uq_stmt = next(s for s in diff["statements"] if "UQ_Code" in s["sql"])
    ck_stmt = next(s for s in diff["statements"] if "CK_Code" in s["sql"])
    assert uq_stmt["destructive"] is False
    assert ck_stmt["destructive"] is False
    assert diff["has_destructive"] is False
