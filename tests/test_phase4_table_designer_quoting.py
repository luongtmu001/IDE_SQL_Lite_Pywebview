"""
Tests for Phase 4: Quoting integration in TableDesignerService.
Verifies _quote_ident and _format_table_name in table_designer_service.py.
"""
import pytest
from app.services.table_designer_service import TableDesignerService


def test_table_designer_quote_ident_wraps_sql_utils():
    # Regular identifier
    assert TableDesignerService._quote_ident("Customers", "sqlserver") == "[Customers]"
    assert TableDesignerService._quote_ident("Customers", "postgresql") == '"Customers"'

    # Special characters: closing bracket must be doubled
    assert TableDesignerService._quote_ident("Col]Name", "sqlserver") == "[Col]]Name]"
    assert TableDesignerService._quote_ident('Col"Name', "postgresql") == '"Col""Name"'

    # Fake wrap injection attempt: must neutralize internal single bracket
    res = TableDesignerService._quote_ident("[a]; DROP TABLE Users; --]", "sqlserver")
    assert res == "[a]]; DROP TABLE Users; --]"
    assert "]];" in res


def test_table_designer_format_table_name():
    assert TableDesignerService._format_table_name("dbo", "Users", "sqlserver") == "[dbo].[Users]"
    assert TableDesignerService._format_table_name(None, "Users", "sqlserver") == "[dbo].[Users]"
    assert TableDesignerService._format_table_name(None, "users", "postgresql") == '"public"."users"'
    assert TableDesignerService._format_table_name("custom", "users", "postgresql") == '"custom"."users"'
