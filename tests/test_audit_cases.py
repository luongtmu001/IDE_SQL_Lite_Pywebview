"""
test_audit_cases.py - Baseline Test Suite for Audit Findings
Covers:
1. MSSQL-SP-MISSING-END: ScriptDom vs legacy validator on T-SQL procedure missing END
2. PG-KW-PLPGSQL-MISSING: PL/pgSQL keywords presence in PostgresDialect
3. PG-HIGHLIGHT-PLPGSQL-MISSING: PL/pgSQL keywords in monaco-sql-lang.js
4. MSSQL-CATCH-FUNCTIONS: CATCH block context detection & error functions priority
5. PG-FN-MISSING-END: PostgreSQL PL/pgSQL offline block structure validation
"""
import os
import sys
import json
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_EXE = r"C:\Program Files\nodejs\node.exe"


# ==============================================================================
# 1. MSSQL-SP-MISSING-END
# ==============================================================================
def test_baseline_mssql_sp_missing_end():
    """Verify legacy validator vs ScriptDom on procedure missing END TRY."""
    from app.database.syntax.validator import validate_sql
    from app.database.syntax.coordinator import validate_sql_pipeline

    bad_proc_sql = """
    CREATE PROCEDURE dbo.usp_BadProc
    AS
    BEGIN
        BEGIN TRY
            SELECT 1;
        -- missing END TRY
        BEGIN CATCH
            SELECT 2;
        END CATCH
    END
    """
    # Legacy validator using sqlglot
    legacy_diags = validate_sql(bad_proc_sql, dialect="sqlserver")
    legacy_has_err = any(d.get("severity") in ("error", "critical", 1, 8) for d in legacy_diags)

    # ScriptDom pipeline
    pipe_diags = validate_sql_pipeline(bad_proc_sql, dialect="sqlserver")
    pipe_has_err = any(d.get("severity") in ("error", "critical", 1, 8) for d in pipe_diags)

    # Baseline observation: legacy misses it (False Negative), ScriptDom catches it
    assert pipe_has_err is True, "ScriptDom MUST detect missing END in procedure"
    print(f"\n[BASELINE] legacy_has_err: {legacy_has_err}, pipe_has_err: {pipe_has_err}")


# ==============================================================================
# 2. PG-KW-PLPGSQL-MISSING
# ==============================================================================
def test_baseline_pg_kw_plpgsql_in_dialect():
    """Check whether core PL/pgSQL keywords are defined in PostgresDialect."""
    node_cmd = """
    const { createIdeContext } = require('./tests/js/load.js');
    const ide = createIdeContext('postgresql');
    const pg = ide.sandbox.SqlDialectFactory.getDialect('postgresql');
    const kws = new Set(pg.getKeywords());
    const required = ['PERFORM', 'RAISE', 'ELSIF', 'FOREACH', 'EXCEPTION'];
    const present = required.filter(k => kws.has(k));
    const missing = required.filter(k => !kws.has(k));
    console.log(JSON.stringify({ present, missing }));
    """
    res = subprocess.run([NODE_EXE, "-e", node_cmd], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0, f"Node execution failed: {res.stderr}"
    data = json.loads(res.stdout)

    print(f"\n[BASELINE] Present PL/pgSQL in dialect: {data['present']}, Missing: {data['missing']}")
    # This documents the baseline: currently missing is not empty


# ==============================================================================
# 3. PG-HIGHLIGHT-PLPGSQL-MISSING
# ==============================================================================
def test_baseline_pg_highlight_in_monaco():
    """Check whether PL/pgSQL keywords are in monaco-sql-lang.js Monarch keywords."""
    monaco_path = os.path.join(BASE_DIR, "static", "js", "monaco-sql-lang.js")
    with open(monaco_path, "r", encoding="utf-8") as f:
        content = f.read()

    required = ['"PERFORM"', '"RAISE"', '"ELSIF"', '"FOREACH"', '"EXCEPTION"']
    missing = [k for k in required if k not in content]
    print(f"\n[BASELINE] Missing in Monaco Monarch tokenizer: {missing}")


# ==============================================================================
# 4. MSSQL-CATCH-FUNCTIONS
# ==============================================================================
def test_baseline_mssql_catch_block_context():
    """Check whether context analyzer identifies CATCH block and completions include ERROR_MESSAGE."""
    node_cmd = """
    const { createIdeContext } = require('./tests/js/load.js');
    const ide = createIdeContext('sqlserver');
    const analyzer = ide.sandbox.SqlContextAnalyzer;
    const engine = ide.sandbox.DefaultCompletionEngine;

    async function run() {
        const sql = 'BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT ‸ END CATCH';
        const caret = sql.indexOf('‸');
        const clean = sql.replace('‸', '');
        const ctx = analyzer.analyze(clean, caret, 'sqlserver');
        const comps = await engine.getCompletions(clean, caret, ctx, { connectionId: 'mock', dbType: 'sqlserver' });
        const hasErrMsg = comps.some(c => c.name === 'ERROR_MESSAGE');
        const hasThrow = comps.some(c => c.name === 'THROW');
        console.log(JSON.stringify({
            clause: ctx.clause,
            isInCatchBlock: Boolean(ctx.isInCatchBlock),
            hasErrorMessage: hasErrMsg,
            hasThrow: hasThrow
        }));
    }
    run();
    """
    res = subprocess.run([NODE_EXE, "-e", node_cmd], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0, f"Node execution failed: {res.stderr}"
    data = json.loads(res.stdout)
    print(f"\n[BASELINE] CATCH context: {data}")


# ==============================================================================
# 5. PG-FN-MISSING-END
# ==============================================================================
def test_baseline_pg_fn_missing_end():
    """Check offline validation on PL/pgSQL function missing END IF."""
    from app.database.syntax.validator import validate_sql
    from app.database.syntax.coordinator import validate_sql_pipeline

    broken_pg = """
    CREATE OR REPLACE FUNCTION public.broken_fn()
    RETURNS void AS $$
    BEGIN
        IF TRUE THEN
            PERFORM 1;
        -- missing END IF
    END;
    $$ LANGUAGE plpgsql;
    """
    legacy_diags = validate_sql(broken_pg, dialect="postgresql")
    legacy_has_err = any(d.get("severity") in ("error", "critical", 1, 8) for d in legacy_diags)

    pipe_diags = validate_sql_pipeline(broken_pg, dialect="postgresql")
    pipe_has_err = any(d.get("severity") in ("error", "critical", 1, 8) for d in pipe_diags)

    print(f"\n[BASELINE] PG offline: legacy_has_err: {legacy_has_err}, pipe_has_err: {pipe_has_err}")
