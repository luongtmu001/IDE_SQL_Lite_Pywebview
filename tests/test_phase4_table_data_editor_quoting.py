"""
Tests for Phase 4: Quoting integration in table_data_editor_service.py.
Verifies _quote_ident, _format_table_name, and safe preview SQL quoting.
"""
import pytest
from app.services.table_data_editor_service import _quote_ident, _format_table_name


def test_quote_ident_wraps_sql_utils():
    # Regular identifier
    assert _quote_ident("Customers", "sqlserver") == "[Customers]"
    assert _quote_ident("Customers", "postgresql") == '"Customers"'

    # Special characters
    assert _quote_ident("Col]Name", "sqlserver") == "[Col]]Name]"
    assert _quote_ident('Col"Name', "postgresql") == '"Col""Name"'

    # Fake wrap injection attempt
    assert _quote_ident("[a]]; DROP TABLE Users; --]", "sqlserver") == "[a]]; DROP TABLE Users; --]"


def test_format_table_name_with_database():
    assert _format_table_name("dbo", "Users", "sqlserver", "SalesDB") == "[SalesDB].[dbo].[Users]"
    assert _format_table_name(None, "Users", "sqlserver", None) == "[dbo].[Users]"
    assert _format_table_name(None, "users", "postgresql", "sales") == '"public"."users"'
    assert _format_table_name("custom", "users", "postgresql", None) == '"custom"."users"'
