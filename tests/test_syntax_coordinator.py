# -*- coding: utf-8 -*-
"""
Unit Test Suite for Syntax Check Coordinator (Phase 5).
Validates the end-to-end pipeline:
Adapter Syntax Parsing + Semantic Column Analysis + Deduplication + Rollback Flag.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

import app.database.syntax.coordinator as coordinator_mod
from app.database.syntax.coordinator import (
    USE_LEGACY_SYNTAX_VALIDATOR,
    validate_sql_pipeline,
)


class TestSyntaxCheckCoordinator(unittest.TestCase):
    def test_empty_sql_returns_empty(self):
        self.assertEqual(validate_sql_pipeline(""), [])
        self.assertEqual(validate_sql_pipeline("   \t\n  "), [])

    def test_sqlserver_valid_query(self):
        sql = "SELECT id, name FROM users WHERE id = 1;"
        diags = validate_sql_pipeline(sql, dialect="sqlserver")
        self.assertEqual(diags, [])

    def test_sqlserver_syntax_error_detected(self):
        sql = "SELECT FROM users;"
        diags = validate_sql_pipeline(sql, dialect="sqlserver")
        self.assertGreater(len(diags), 0)
        d = diags[0]
        self.assertEqual(d["line"], 1)
        self.assertEqual(d["token"], "FROM")
        self.assertEqual(d["code"], "SQL_SYNTAX_ERROR")
        self.assertEqual(d["source"], "sqlserver")

    def test_sqlserver_table_variable_semantic_error(self):
        sql = """
        DECLARE @customer TABLE (
            id INT,
            name VARCHAR(50)
        );
        SELECT id, non_existent_col FROM @customer;
        """
        diags = validate_sql_pipeline(sql, dialect="sqlserver")
        self.assertEqual(len(diags), 1)
        d = diags[0]
        self.assertEqual(d["token"], "non_existent_col")
        self.assertEqual(d["code"], "SQL_INVALID_COLUMN")
        self.assertIn("table variable '@customer'", d["message"])

    def test_sqlserver_temp_table_semantic_error(self):
        sql = """
        CREATE TABLE #temp_data (
            id INT,
            name VARCHAR(50)
        );
        SELECT id, bad_column FROM #temp_data;
        """
        diags = validate_sql_pipeline(sql, dialect="sqlserver")
        self.assertEqual(len(diags), 1)
        d = diags[0]
        self.assertEqual(d["token"], "bad_column")
        self.assertEqual(d["code"], "SQL_INVALID_COLUMN")
        self.assertIn("temporary table '#temp_data'", d["message"])

    def test_sqlserver_physical_table_cache_semantic_error(self):
        sql = "SELECT id, invalid_field FROM b20customer;"
        cached = {"b20customer": ["id", "code", "name"]}
        diags = validate_sql_pipeline(
            sql,
            dialect="sqlserver",
            cached_tables_dict=cached,
        )
        self.assertEqual(len(diags), 1)
        d = diags[0]
        self.assertEqual(d["token"], "invalid_field")
        self.assertEqual(d["code"], "SQL_INVALID_COLUMN")

    def test_postgresql_valid_and_invalid_syntax(self):
        # Valid
        valid_sql = "SELECT 1 AS num;"
        self.assertEqual(validate_sql_pipeline(valid_sql, dialect="postgresql"), [])

        # Invalid
        invalid_sql = "SELECT * FROM;"
        diags = validate_sql_pipeline(invalid_sql, dialect="postgresql")
        self.assertGreater(len(diags), 0)
        self.assertEqual(diags[0]["code"], "SQL_SYNTAX_ERROR")
        self.assertEqual(diags[0]["source"], "postgresql")

    def test_force_legacy_rollback(self):
        sql = "SELECT 1 AS X;"
        # Force legacy call
        diags = validate_sql_pipeline(sql, dialect="sqlserver", force_legacy=True)
        self.assertEqual(diags, [])

    def test_config_legacy_rollback_toggle(self):
        sql = "SELECT 1 AS X;"
        try:
            coordinator_mod.USE_LEGACY_SYNTAX_VALIDATOR = True
            diags = validate_sql_pipeline(sql, dialect="sqlserver")
            self.assertEqual(diags, [])
        finally:
            coordinator_mod.USE_LEGACY_SYNTAX_VALIDATOR = False

    def test_adapter_exception_fallback(self):
        sql = "SELECT 1 AS X;"
        with patch("app.database.syntax.coordinator.get_syntax_adapter") as mock_get:
            mock_adapter = unittest.mock.MagicMock()
            mock_adapter.validate.side_effect = RuntimeError("Simulated adapter failure")
            mock_get.return_value = mock_adapter

            # Should not raise; falls back gracefully to legacy validator
            diags = validate_sql_pipeline(sql, dialect="sqlserver")
            self.assertEqual(diags, [])


if __name__ == "__main__":
    unittest.main()
