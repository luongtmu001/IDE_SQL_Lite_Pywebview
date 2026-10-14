"""
Test suite for Phase 4: app.database.sql_utils module.
Verifies identifier quoting, qualified name generation, and literal escaping
across SQL Server and PostgreSQL engines with edge cases.
"""
import pytest


def test_import_sql_utils():
    from app.database.sql_utils import quote_ident, quote_qualified, escape_literal
    assert callable(quote_ident)
    assert callable(quote_qualified)
    assert callable(escape_literal)


class TestQuoteIdent:
    def test_basic_sqlserver(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("users", "sqlserver") == "[users]"
        assert quote_ident("Id", "mssql") == "[Id]"

    def test_basic_postgresql(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("users", "postgresql") == '"users"'
        assert quote_ident("UserName", "postgres") == '"UserName"'

    def test_spaces_in_identifier(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("first name", "sqlserver") == "[first name]"
        assert quote_ident("Order Details", "postgresql") == '"Order Details"'

    def test_internal_brackets_sqlserver(self):
        from app.database.sql_utils import quote_ident
        # foo]bar -> [foo]]bar]
        assert quote_ident("foo]bar", "sqlserver") == "[foo]]bar]"
        # multiple brackets
        assert quote_ident("a]b]c", "sqlserver") == "[a]]b]]c]"

    def test_internal_double_quotes_postgresql(self):
        from app.database.sql_utils import quote_ident
        # foo"bar -> "foo""bar"
        assert quote_ident('foo"bar', "postgresql") == '"foo""bar"'
        assert quote_ident('a"b"c', "postgresql") == '"a""b""c"'

    def test_pseudo_wrapped_or_already_wrapped_sqlserver(self):
        from app.database.sql_utils import quote_ident
        # Already wrapped normal identifier should remain safely wrapped
        assert quote_ident("[users]", "sqlserver") == "[users]"
        assert quote_ident("[foo]]bar]", "sqlserver") == "[foo]]bar]"
        
        # Fake wrapped with injection payload: must not trust!
        # [a]]; DROP TABLE Users; --] -> internal ] is doubled, neutralized
        res = quote_ident("[a]]; DROP TABLE Users; --]", "sqlserver")
        assert res == "[a]]; DROP TABLE Users; --]"
        
        # Malicious single unescaped bracket inside fake wrap:
        res2 = quote_ident("[a]; DROP TABLE Users; --]", "sqlserver")
        assert res2 == "[a]]; DROP TABLE Users; --]"
        assert "]];" in res2

    def test_pseudo_wrapped_or_already_wrapped_postgresql(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident('"users"', "postgresql") == '"users"'
        assert quote_ident('"foo""bar"', "postgresql") == '"foo""bar"'
        
        # Fake wrapped with injection payload
        res = quote_ident('"a"; DROP TABLE users; --"', "postgresql")
        assert res == '"a""; DROP TABLE users; --"'
        assert '"";' in res

    def test_unicode_and_vietnamese(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("Khách Hàng", "sqlserver") == "[Khách Hàng]"
        assert quote_ident("TàiKhoản_2026", "postgresql") == '"TàiKhoản_2026"'

    def test_reserved_keywords(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("SELECT", "sqlserver") == "[SELECT]"
        assert quote_ident("ORDER", "sqlserver") == "[ORDER]"
        assert quote_ident("user", "postgresql") == '"user"'
        assert quote_ident("table", "postgresql") == '"table"'

    def test_empty_and_none(self):
        from app.database.sql_utils import quote_ident
        assert quote_ident("", "sqlserver") == ""
        assert quote_ident(None, "sqlserver") == ""
        assert quote_ident("   ", "postgresql") == ""


class TestQuoteQualified:
    def test_table_and_schema_sqlserver(self):
        from app.database.sql_utils import quote_qualified
        assert quote_qualified("dbo", "Customer", engine="sqlserver") == "[dbo].[Customer]"

    def test_db_schema_table_sqlserver(self):
        from app.database.sql_utils import quote_qualified
        assert quote_qualified("MyDb", "dbo", "Customer", engine="sqlserver") == "[MyDb].[dbo].[Customer]"

    def test_none_part_skipped(self):
        from app.database.sql_utils import quote_qualified
        assert quote_qualified(None, "dbo", "Customer", engine="sqlserver") == "[dbo].[Customer]"
        assert quote_qualified("", "dbo", "Customer", engine="sqlserver") == "[dbo].[Customer]"

    def test_postgresql_qualified(self):
        from app.database.sql_utils import quote_qualified
        assert quote_qualified("public", "users", engine="postgresql") == '"public"."users"'

    def test_single_part(self):
        from app.database.sql_utils import quote_qualified
        assert quote_qualified("Customer", engine="sqlserver") == "[Customer]"


class TestEscapeLiteral:
    def test_none_returns_null(self):
        from app.database.sql_utils import escape_literal
        assert escape_literal(None) == "NULL"

    def test_numbers(self):
        from app.database.sql_utils import escape_literal
        assert escape_literal(123) == "123"
        assert escape_literal(45.67) == "45.67"

    def test_boolean(self):
        from app.database.sql_utils import escape_literal
        assert escape_literal(True, "sqlserver") == "1"
        assert escape_literal(False, "sqlserver") == "0"
        assert escape_literal(True, "postgresql") == "TRUE"
        assert escape_literal(False, "postgresql") == "FALSE"

    def test_strings_escaped(self):
        from app.database.sql_utils import escape_literal
        assert escape_literal("hello") == "'hello'"
        assert escape_literal("O'Reilly") == "'O''Reilly'"
        assert escape_literal("test's 'value'") == "'test''s ''value'''"

    def test_unicode_string_sqlserver(self):
        from app.database.sql_utils import escape_literal
        assert escape_literal("Xin chào", "sqlserver") == "N'Xin chào'"
        assert escape_literal("Xin chào", "postgresql") == "'Xin chào'"
