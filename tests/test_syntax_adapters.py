# -*- coding: utf-8 -*-
"""
Unit Test Suite for Syntax Check Adapters (Phase 4).
Tests SqlServerScriptDomAdapter, PostgreSqlAdapter, DiagnosticsMapper,
and factory resolution independently.
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.database.syntax.adapters import (
    BaseSyntaxAdapter,
    PostgreSqlAdapter,
    SqlServerScriptDomAdapter,
    clean_diagnostic_message,
    deduplicate_diagnostics,
    get_syntax_adapter,
    normalize_diagnostic,
)


class TestDiagnosticsMapper(unittest.TestCase):
    def test_clean_diagnostic_message(self):
        raw = "[Microsoft][ODBC Driver 18 for SQL Server][SQL Server]Msg 156, Level 15, State 1, Line 3: Incorrect syntax near 'FROM'."
        cleaned = clean_diagnostic_message(raw)
        self.assertEqual(cleaned, "Incorrect syntax near 'FROM'.")

    def test_normalize_diagnostic(self):
        raw = {
            "line": "5",
            "column": "10",
            "message": "Some error",
            "token": "FROM",
        }
        norm = normalize_diagnostic(raw, default_source="sqlserver")
        self.assertEqual(norm["line"], 5)
        self.assertEqual(norm["column"], 10)
        self.assertEqual(norm["end_column"], 14)  # 10 + len("FROM")
        self.assertEqual(norm["severity"], "error")
        self.assertEqual(norm["code"], "SQL_SYNTAX_ERROR")
        self.assertEqual(norm["source"], "sqlserver")

    def test_deduplicate_diagnostics(self):
        items = [
            {"line": 2, "column": 5, "token": "FROM", "message": "Err 1"},
            {"line": 2, "column": 5, "token": "from", "message": "Err 1 duplicate"},
            {"line": 3, "column": 1, "token": "SELECT", "message": "Err 2"},
        ]
        deduped = deduplicate_diagnostics(items)
        self.assertEqual(len(deduped), 2)
        self.assertEqual(deduped[0]["line"], 2)
        self.assertEqual(deduped[1]["line"], 3)


class TestSqlServerScriptDomAdapter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = SqlServerScriptDomAdapter()

    def test_scriptdom_available(self):
        self.assertTrue(self.adapter.is_available, "ScriptDOM assembly should be available on Windows environment.")

    def test_empty_sql_returns_empty(self):
        self.assertEqual(self.adapter.validate(""), [])
        self.assertEqual(self.adapter.validate("   \n\t  "), [])

    def test_valid_basic_dml(self):
        sql = "SELECT id, name FROM users WHERE id = 1;"
        diags = self.adapter.validate(sql)
        self.assertEqual(diags, [])

    def test_valid_complex_procedural(self):
        sql = """
        CREATE PROCEDURE dbo.usp_ComplexProc
            @UserId INT
        AS
        BEGIN
            SET NOCOUNT ON;
            DECLARE @temp TABLE (id INT, code VARCHAR(50));
            
            BEGIN TRY
                WITH ActiveUsers AS (
                    SELECT id, code FROM users WHERE active = 1
                )
                INSERT INTO @temp (id, code)
                SELECT u.id, u.code
                FROM ActiveUsers u
                CROSS APPLY (SELECT TOP 1 log_date FROM logs WHERE user_id = u.id) l;
            END TRY
            BEGIN CATCH
                SELECT ERROR_MESSAGE() AS ErrMsg;
            END CATCH
        END
        """
        diags = self.adapter.validate(sql)
        self.assertEqual(diags, [])

    def test_valid_go_batches(self):
        sql = """
        SELECT 1 AS Batch1;
        GO
        CREATE TABLE #temp_b (id INT);
        GO
        SELECT * FROM #temp_b;
        """
        diags = self.adapter.validate(sql)
        self.assertEqual(diags, [])

    def test_invalid_sql_syntax_detection(self):
        sql = "SELECT FROM users;"
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        d = diags[0]
        self.assertEqual(d["line"], 1)
        self.assertEqual(d["column"], 8)
        self.assertEqual(d["token"], "FROM")
        self.assertEqual(d["code"], "SQL_SYNTAX_ERROR")
        self.assertEqual(d["source"], "sqlserver")

    def test_invalid_sql_multiline_procedure_error(self):
        sql = """-- Line 1
-- Line 2
CREATE PROCEDURE dbo.usp_Broken
AS
BEGIN
    SELECT 1 AS OK;
    SELECT (1 + 2 * 3 FROM Users;
END"""
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        d = diags[0]
        # Line 7 is: SELECT (1 + 2 * 3 FROM Users;
        self.assertEqual(d["line"], 7)
        self.assertEqual(d["token"], "FROM")

    def test_fallback_when_scriptdom_unavailable(self):
        # Instantiate adapter with invalid path
        fallback_adapter = SqlServerScriptDomAdapter(custom_dll_path="C:\\nonexistent_path\\dummy.dll")
        self.assertFalse(fallback_adapter.is_available)
        
        # Should gracefully fall back to legacy validator without raising
        diags = fallback_adapter.validate("SELECT 1 AS num;")
        self.assertEqual(diags, [])


    def test_deprecated_data_type_warning(self):
        sql = "DECLARE @doc IMAGE, @description TEXT;"
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        warn_types = [d["message"] for d in diags if d.get("severity") == "warning"]
        self.assertTrue(any("IMAGE" in m for m in warn_types))
        self.assertTrue(any("TEXT" in m for m in warn_types))

    def test_table_hint_without_with_warning(self):
        sql = "SELECT id, name FROM users (NOLOCK) WHERE active = 1;"
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        warns = [d for d in diags if d.get("severity") == "warning"]
        self.assertTrue(any("NOLOCK" in w["message"] for w in warns))

    def test_missing_semicolon_before_cte_warning(self):
        sql = """
        SELECT 1
        WITH cte AS (SELECT 2 AS val)
        SELECT * FROM cte;
        """
        diags = self.adapter.validate(sql)
        warns = [d for d in diags if d.get("severity") == "warning"]
        self.assertTrue(any("semicolon" in w["message"].lower() for w in warns))

    def test_dynamic_sqlserver_version_resolution(self):
        class MockSession:
            def __init__(self, ver):
                self.metadata_cache = {"server_version": ver}

        p150 = self.adapter._resolve_parser_class(MockSession("15.00.4123"))
        self.assertEqual(p150.__name__, "TSql150Parser")

        p140 = self.adapter._resolve_parser_class(MockSession("2017"))
        self.assertEqual(p140.__name__, "TSql140Parser")

        p_default = self.adapter._resolve_parser_class(None)
        self.assertEqual(p_default.__name__, "TSql160Parser")


class TestPostgreSqlAdapter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = PostgreSqlAdapter()

    def test_empty_sql_returns_empty(self):
        self.assertEqual(self.adapter.validate(""), [])

    def test_valid_postgres_dml(self):
        sql = "SELECT id, name FROM users WHERE active = true ORDER BY id;"
        diags = self.adapter.validate(sql)
        self.assertEqual(diags, [])

    def test_valid_postgres_cte(self):
        sql = """
        WITH RECURSIVE t(n) AS (
            VALUES (1)
            UNION ALL
            SELECT n + 1 FROM t WHERE n < 10
        )
        SELECT sum(n) FROM t;
        """
        diags = self.adapter.validate(sql)
        self.assertEqual(diags, [])

    def test_invalid_postgres_syntax(self):
        sql = "SELECT * FROM;"
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        d = diags[0]
        self.assertEqual(d["line"], 1)
        self.assertEqual(d["code"], "SQL_SYNTAX_ERROR")
        self.assertEqual(d["source"], "postgresql")

    def test_offline_unclosed_dollar_quote_error(self):
        sql = """
        DO $$
        BEGIN
            RAISE NOTICE 'test';
        END;
        """
        # Missing closing $$
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        self.assertTrue(any("Unclosed dollar-quoted block" in d["message"] for d in diags))

    def test_offline_unmatched_begin_in_procedural_code(self):
        sql = """
        DO $$
        BEGIN
            RAISE NOTICE 'test';
        $$;
        """
        # Missing END;
        diags = self.adapter.validate(sql)
        self.assertGreater(len(diags), 0)
        self.assertTrue(any("Unmatched BEGIN block" in d["message"] for d in diags))


class TestAdapterFactory(unittest.TestCase):
    def test_get_sqlserver_adapter(self):
        adapter = get_syntax_adapter("sqlserver")
        self.assertIsInstance(adapter, SqlServerScriptDomAdapter)

        adapter_tsql = get_syntax_adapter("tsql")
        self.assertIsInstance(adapter_tsql, SqlServerScriptDomAdapter)

    def test_get_postgres_adapter(self):
        adapter_pg = get_syntax_adapter("postgres")
        self.assertIsInstance(adapter_pg, PostgreSqlAdapter)

        adapter_pgsql = get_syntax_adapter("postgresql")
        self.assertIsInstance(adapter_pgsql, PostgreSqlAdapter)


if __name__ == "__main__":
    unittest.main()
