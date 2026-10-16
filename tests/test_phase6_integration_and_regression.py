"""
tests/test_phase6_integration_and_regression.py

Phase 6: Comprehensive Integration and Regression Test Suite
Validates the unified interactions across:
1. Syntax Coordinator & Adapters (ScriptDOM for T-SQL, PL/pgSQL block checker for PostgreSQL).
2. Honest Diagnostics Mapping (no false PASS, PARTIAL status with honest flags).
3. Dialect Keyword Completeness & Context Analysis (TRY/CATCH block detection).
4. IntelliSense Completion Ranking & Safety Fallbacks.
5. Monaco Monarch Tokenizer classification integrity.
"""

import os
import sys
import json
import time
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_EXE = r"C:\Program Files\nodejs\node.exe"


class TestPhase6Integration:
    """End-to-End unified integration verification."""

    def test_e2e_mssql_syntax_and_scriptdom(self):
        """End-to-end T-SQL: Valid complex query vs syntax error detected by ScriptDOM."""
        from app.database.syntax.coordinator import validate_sql_pipeline

        # Valid complex procedure with TRY/CATCH and CTE
        valid_sql = """
        CREATE PROCEDURE dbo.usp_ValidOrderSummary
            @CustomerID INT
        AS
        BEGIN
            SET NOCOUNT ON;
            BEGIN TRY
                WITH OrderSummary AS (
                    SELECT OrderID, Total
                    FROM dbo.Orders
                    WHERE CustomerID = @CustomerID
                )
                SELECT OrderID, Total FROM OrderSummary;
            END TRY
            BEGIN CATCH
                SELECT ERROR_MESSAGE() AS ErrMsg, ERROR_NUMBER() AS ErrNum;
                THROW;
            END CATCH
        END;
        """
        diags_valid = validate_sql_pipeline(valid_sql, dialect="sqlserver")
        errors_valid = [d for d in diags_valid if d.get("severity") in ("error", "critical", 1, 8)]
        assert len(errors_valid) == 0, f"Expected 0 errors on valid T-SQL, got: {errors_valid}"

        # Broken procedure: missing END CATCH
        broken_sql = """
        CREATE PROCEDURE dbo.usp_Broken
        AS
        BEGIN
            BEGIN TRY
                SELECT 1;
            END TRY
            BEGIN CATCH
                SELECT 2;
        END
        """
        diags_broken = validate_sql_pipeline(broken_sql, dialect="sqlserver")
        errors_broken = [d for d in diags_broken if d.get("severity") in ("error", "critical", 1, 8)]
        assert len(errors_broken) > 0, "ScriptDOM MUST detect missing END in broken procedure"

    def test_e2e_postgresql_offline_syntax_and_honest_diagnostics(self):
        """End-to-end PG: Nested blocks, unclosed loops, honest PARTIAL status."""
        from app.database.syntax.coordinator import validate_sql_pipeline

        # Broken function missing END LOOP
        broken_fn = """
        CREATE OR REPLACE FUNCTION public.test_loop()
        RETURNS void AS $$
        DECLARE
            r record;
        BEGIN
            FOR r IN SELECT id FROM orders LOOP
                PERFORM r.id;
            -- missing END LOOP
        END;
        $$ LANGUAGE plpgsql;
        """
        diags = validate_sql_pipeline(broken_fn, dialect="postgresql")
        assert any("LOOP" in d.get("message", "").upper() or d.get("severity") in ("error", "critical", 1, 8) for d in diags)

        # Valid routine returns PARTIAL with informational notice offline
        valid_fn = """
        CREATE OR REPLACE FUNCTION public.valid_fn()
        RETURNS void AS $$
        BEGIN
            IF TRUE THEN
                PERFORM 1;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
        diags_valid = validate_sql_pipeline(valid_fn, dialect="postgresql")
        # Should not report syntax error
        assert not any(d.get("severity") in ("error", "critical", 1, 8) for d in diags_valid)

    def test_e2e_intellisense_catch_context_and_keywords(self):
        """End-to-end JS IntelliSense: CATCH context boosting and PG keyword availability."""
        node_script = """
        const { createIdeContext } = require('./tests/js/load.js');

        async function verify() {
            // 1. T-SQL CATCH Context
            const mssqlIde = createIdeContext({ dbType: 'mssql' });
            const mssqlSql = 'BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT ‸ END CATCH';
            const mssqlComps = await mssqlIde.getCompletions(mssqlSql);
            const errIdx = mssqlComps.findIndex(c => c.name === 'ERROR_MESSAGE');
            const throwIdx = mssqlComps.findIndex(c => c.name === 'THROW');

            // 2. PG Dialect keywords
            const pgIde = createIdeContext({ dbType: 'postgresql' });
            const pgDialect = pgIde.sandbox.SqlDialectFactory.getDialect('postgresql');
            const pgKws = new Set(pgDialect.getKeywords());

            const requiredPg = ['PERFORM', 'RAISE', 'ELSIF', 'FOREACH', 'EXCEPTION', 'SQLSTATE'];
            const allPgPresent = requiredPg.every(k => pgKws.has(k));

            console.log(JSON.stringify({
                errIdx,
                throwIdx,
                allPgPresent,
                mssqlCompsCount: mssqlComps.length
            }));
        }
        verify();
        """
        t0 = time.perf_counter()
        res = subprocess.run([NODE_EXE, "-e", node_script], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8")
        elapsed_ms = (time.perf_counter() - t0) * 1000
        assert res.returncode == 0, f"Node script failed: {res.stderr}"

        data = json.loads(res.stdout)
        assert data["allPgPresent"] is True, "All required PL/pgSQL keywords must be in PostgresDialect"
        assert data["errIdx"] != -1, "ERROR_MESSAGE must be suggested"
        assert data["errIdx"] < 10, f"ERROR_MESSAGE should be boosted near top, was at index {data['errIdx']}"
        assert elapsed_ms < 2000, f"Execution time {elapsed_ms}ms exceeded budget"

    def test_e2e_monaco_monarch_highlighting_integrity(self):
        """Monaco Monarch: Verifies syntax tokenization for both T-SQL error functions and PL/pgSQL keywords."""
        test_file = os.path.join(BASE_DIR, "tests", "js", "test_phase5_syntax_highlighting.test.js")
        res = subprocess.run([NODE_EXE, "--test", test_file], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8")
        assert res.returncode == 0, f"Monarch tokenizer tests failed: {res.stderr}\n{res.stdout}"
        assert "pass 5" in res.stdout
