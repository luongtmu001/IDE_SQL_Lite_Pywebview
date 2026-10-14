# -*- coding: utf-8 -*-
"""
Tests for Phase 5 Step 4: Non-destructive Validation in TableDataEditorService.
Verifies validate_row (NOT NULL, UNIQUE, FK via SELECT) and validate_insert_rows
defaulting to non-destructive validation (no INSERT executed without trial_insert=True).
"""
from unittest.mock import MagicMock
from app.services.table_data_editor_service import TableDataEditorService


def test_validate_row_not_null_check():
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"
    mock_adapter.get_table_design_metadata.return_value = {
        "columns": [
            {"name": "Id", "type": "int", "is_pk": True, "is_identity": True, "is_nullable": False},
            {"name": "RequiredName", "type": "nvarchar", "is_pk": False, "is_identity": False, "is_nullable": False},
            {"name": "OptionalBio", "type": "nvarchar", "is_pk": False, "is_identity": False, "is_nullable": True},
        ],
        "uniques": [],
        "foreign_keys": []
    }
    TableDataEditorService.invalidate_metadata_cache()

    # 1. Missing RequiredName should fail NOT NULL
    res = TableDataEditorService.validate_row(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Users",
        values={"RequiredName": None, "OptionalBio": "hello"},
        target_column="RequiredName",
        is_new=True
    )
    assert res["valid"] is False
    assert res["constraint_type"] == "NOT_NULL"
    assert "RequiredName" in res["columns"]

    # 2. Provided RequiredName should pass
    res_ok = TableDataEditorService.validate_row(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Users",
        values={"RequiredName": "Alice", "OptionalBio": None},
        target_column="OptionalBio",
        is_new=True
    )
    assert res_ok["valid"] is True


def test_validate_row_composite_unique_and_self_exclusion():
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"
    mock_adapter.get_table_design_metadata.return_value = {
        "columns": [
            {"name": "Id", "type": "int", "is_pk": True, "is_identity": True, "is_nullable": False},
            {"name": "OrgId", "type": "int", "is_pk": False, "is_identity": False, "is_nullable": False},
            {"name": "DeptCode", "type": "nvarchar", "is_pk": False, "is_identity": False, "is_nullable": False},
        ],
        "pk_columns": ["Id"],
        "uniques": [{"name": "UQ_Org_Dept", "fields": ["OrgId", "DeptCode"]}],
        "foreign_keys": []
    }

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_adapter.connection = mock_conn

    TableDataEditorService.invalidate_metadata_cache()

    # Case 1: Partial composite (DeptCode missing) -> must NOT query DB
    res_partial = TableDataEditorService.validate_row(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Depts",
        values={"OrgId": 10},
        target_column="OrgId",
        is_new=True
    )
    assert res_partial["valid"] is True
    executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list if call[0]]
    assert not any("Depts" in s for s in executed_sqls)

    # Case 2: Duplicate found in DB
    mock_cursor.fetchone.return_value = (1,)
    res_dup = TableDataEditorService.validate_row(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Depts",
        values={"OrgId": 10, "DeptCode": "HR"},
        target_column="DeptCode",
        is_new=True
    )
    assert res_dup["valid"] is False
    assert res_dup["constraint_type"] == "UNIQUE KEY"
    assert res_dup["constraint_name"] == "UQ_Org_Dept"

    # Case 3: Self-row match exclusion when keys={'Id': 5}
    mock_cursor.execute.reset_mock()
    mock_cursor.fetchone.return_value = None
    res_self = TableDataEditorService.validate_row(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Depts",
        values={"Id": 5, "OrgId": 10, "DeptCode": "HR"},
        keys={"Id": 5},
        is_new=False,
        target_column="DeptCode"
    )
    assert res_self["valid"] is True
    executed_sql = mock_cursor.execute.call_args[0][0]
    assert "([Id] != ?)" in executed_sql or "[Id] != ?" in executed_sql


def test_validate_insert_rows_default_does_not_execute_insert():
    mock_adapter = MagicMock()
    mock_adapter.db_type = "sqlserver"
    mock_adapter.get_table_design_metadata.return_value = {
        "columns": [
            {"name": "Id", "type": "int", "is_pk": True, "is_identity": True, "is_nullable": False},
            {"name": "Code", "type": "nvarchar", "is_pk": False, "is_identity": False, "is_nullable": False},
        ],
        "uniques": [{"name": "UQ_Code", "fields": ["Code"]}],
        "foreign_keys": []
    }
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = None
    mock_conn.cursor.return_value = mock_cursor
    mock_adapter.connection = mock_conn

    TableDataEditorService.invalidate_metadata_cache()

    rows = [{"Code": "C001"}, {"Code": "C002"}]

    # By default, trial_insert=False -> non-destructive!
    res = TableDataEditorService.validate_insert_rows(
        adapter=mock_adapter,
        database="TestDb",
        schema="dbo",
        table="Products",
        rows=rows,
        trial_insert=False
    )

    assert res["success"] is True
    assert res["valid_count"] == 2
    assert res["error_count"] == 0

    # Verify no INSERT statements were executed!
    executed_sqls = [call[0][0] for call in mock_cursor.execute.call_args_list if call[0]]
    assert not any("INSERT INTO" in s.upper() for s in executed_sqls), (
        f"Non-destructive validation must NOT execute INSERT statements! Executed: {executed_sqls}"
    )
