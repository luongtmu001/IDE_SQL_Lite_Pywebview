# -*- coding: utf-8 -*-
"""
Tests for Phase 3 Bug 11:
- _parse_filter_expr must handle lowercase 'like' and 'not like' case-insensitively
- build_select_sql must handle non-numeric or malformed sort_order gracefully without raising ValueError
"""
import pytest
from app.services.table_data_editor_service import TableDataEditorService


def test_parse_filter_expr_handles_lowercase_like():
    """Verify lowercase 'like' is parsed as LIKE operator, not '='."""
    sql = TableDataEditorService._parse_filter_expr('"username"', "like '%admin%'")
    assert " = " not in sql
    assert sql.strip() == '"username" LIKE \'%admin%\''


def test_parse_filter_expr_handles_lowercase_not_like():
    """Verify lowercase 'not like' is parsed as NOT LIKE operator, not '='."""
    sql = TableDataEditorService._parse_filter_expr('"username"', "not like '%guest%'")
    assert " = " not in sql
    assert sql.strip() == '"username" NOT LIKE \'%guest%\''


def test_build_select_sql_handles_non_numeric_sort_order():
    """Verify non-numeric sort_order ('abc', '', None, 1.5) does not raise ValueError."""
    criteria = [
        {"column": "name", "sort_type": "ASC", "sort_order": "first"},
        {"column": "age", "sort_type": "DESC", "sort_order": None},
        {"column": "id", "sort_type": "ASC", "sort_order": "1"},
    ]

    sql = TableDataEditorService.build_select_sql(
        engine="sqlserver",
        schema="dbo",
        table="users",
        criteria=criteria,
        top_n=50,
    )

    assert "ORDER BY" in sql
    assert "[name] ASC" in sql
    assert "[age] DESC" in sql
    assert "[id] ASC" in sql
