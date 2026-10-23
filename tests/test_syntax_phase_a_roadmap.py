# -*- coding: utf-8 -*-
"""
Tests for Syntax Check Roadmap Phase A + B1:
- A1: EXCEPTION WHEN in PostgreSQL PL/pgSQL
- A2: FOR ... LOOP block tracking in PostgreSQL PL/pgSQL
- A3: CALL statement offline routing
- B1: _compute_token_position utility in MSSQL validator
"""
import pytest
from app.database.syntax.adapters.postgresql_adapter import (
    check_offline_postgres_structural_blocks,
)
from app.database.syntax.coordinator import validate_sql_pipeline
from app.database.syntax.validator_pg import (
    _is_destructive_or_locking_ddl,
    validate_postgresql,
)
from app.database.syntax.validator_mssql import _compute_token_position


class TestSyntaxPhaseARoadmap:
    """Tests Phase A enhancements from syntax_check_analysis_and_roadmap.md."""

    # ---------------------------------------------------------------------
    # A1. EXCEPTION WHEN block in PL/pgSQL
    # ---------------------------------------------------------------------
    def test_exception_when_valid_plpgsql(self):
        """Valid function with EXCEPTION WHEN unique_violation and WHEN OTHERS must have 0 errors."""
        sql = """CREATE OR REPLACE FUNCTION fn_save_data(p_val int)
RETURNS void AS $$
BEGIN
    INSERT INTO t_test (val) VALUES (p_val);
EXCEPTION
    WHEN unique_violation THEN
        RAISE NOTICE 'Duplicate value ignored: %', p_val;
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for valid EXCEPTION block, got: {diags}"

        pipeline_diags = validate_sql_pipeline(sql, dialect="postgres")
        errors = [d for d in pipeline_diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Expected 0 pipeline errors, got: {errors}"

    def test_exception_unclosed_case_before_exception(self):
        """Unclosed CASE before EXCEPTION must be flagged cleanly."""
        sql = """CREATE OR REPLACE FUNCTION fn_test() RETURNS void AS $$
BEGIN
    v_val := CASE WHEN true THEN 1;
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert any("Unclosed CASE" in d["message"] for d in diags)

    def test_unmatched_exception_outside_begin(self):
        """EXCEPTION without matching BEGIN inside procedural block must be flagged."""
        sql = """CREATE OR REPLACE FUNCTION fn_bad_exception() RETURNS void AS $$
EXCEPTION
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert any("Unmatched EXCEPTION" in d["message"] for d in diags)

    # ---------------------------------------------------------------------
    # A2. FOR ... LOOP block tracking in PL/pgSQL
    # ---------------------------------------------------------------------
    def test_for_loop_integer_range(self):
        """FOR i IN 1..10 LOOP ... END LOOP; must have 0 errors."""
        sql = """CREATE OR REPLACE FUNCTION fn_for() RETURNS void AS $$
BEGIN
    FOR i IN 1..10 LOOP
        RAISE NOTICE '%', i;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for valid integer FOR loop, got: {diags}"

    def test_for_loop_query(self):
        """FOR rec IN SELECT ... LOOP ... END LOOP; must have 0 errors."""
        sql = """CREATE OR REPLACE FUNCTION fn_for_query() RETURNS void AS $$
DECLARE
    rec record;
BEGIN
    FOR rec IN SELECT id, name FROM users LOOP
        PERFORM do_work(rec.id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for valid query FOR loop, got: {diags}"

    def test_for_loop_nested(self):
        """Nested FOR loops must balance correctly."""
        sql = """CREATE OR REPLACE FUNCTION fn_nested_loops() RETURNS void AS $$
BEGIN
    FOR i IN 1..5 LOOP
        FOR j IN 1..3 LOOP
            RAISE NOTICE '% - %', i, j;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for nested FOR loops, got: {diags}"

    def test_for_missing_loop_keyword(self):
        """FOR header terminated with ';' without LOOP keyword must be flagged."""
        sql = """CREATE OR REPLACE FUNCTION fn_broken_for() RETURNS void AS $$
BEGIN
    FOR i IN 1..10;
        RAISE NOTICE '%', i;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert any("Missing LOOP keyword" in d["message"] for d in diags)

    def test_for_update_not_treated_as_loop(self):
        """SELECT ... FOR UPDATE clause must not trigger loop tracking."""
        sql = """CREATE OR REPLACE FUNCTION fn_for_update() RETURNS void AS $$
BEGIN
    PERFORM id FROM accounts WHERE balance > 0 FOR UPDATE;
END;
$$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for FOR UPDATE in function, got: {diags}"

    # ---------------------------------------------------------------------
    # A3. CALL statement offline routing
    # ---------------------------------------------------------------------
    def test_call_statement_is_routed_offline(self):
        """CALL statements must be identified as destructive/locking to bypass EXPLAIN."""
        sql1 = "CALL my_schema.rebuild_stats('2026-01-01', TRUE);"
        assert _is_destructive_or_locking_ddl(sql1) is True

        sql2 = 'CALL "my_schema"."run_maintenance"();'
        assert _is_destructive_or_locking_ddl(sql2) is True

        sql3 = "CALL proc_no_args;"
        assert _is_destructive_or_locking_ddl(sql3) is True

    def test_call_statement_validation_pipeline(self):
        """CALL statement through pipeline should return 0 syntax errors."""
        sql = "CALL my_schema.rebuild_stats('2026-01-01', TRUE);"
        diags = validate_postgresql(sql)
        errors = [d for d in diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Expected 0 errors for valid CALL statement, got: {errors}"

    # ---------------------------------------------------------------------
    # B1. _compute_token_position utility
    # ---------------------------------------------------------------------
    def test_compute_token_position_exact_word(self):
        line = "SELECT col1, CASE WHEN id = 1 THEN 'a' END FROM tbl"
        col, end_col = _compute_token_position(line, "CASE")
        assert col == 14
        assert end_col == 18
        assert line[col - 1 : end_col - 1] == "CASE"

    def test_compute_token_position_symbol(self):
        line = "SELECT a, b, FROM tbl"
        col, end_col = _compute_token_position(line, ",")
        assert col == 9
        assert end_col == 10
        assert line[col - 1 : end_col - 1] == ","

    def test_compute_token_position_not_found_fallback(self):
        line = "    WHERE x > 10"
        col, end_col = _compute_token_position(line, "MISSING_TOKEN")
        # Should fallback to stripped content index (5, 5 + len("WHERE x > 10"))
        assert col == 5
        assert line[col - 1 : col - 1 + 5] == "WHERE"

    # ---------------------------------------------------------------------
    # C2. T-SQL TRY...CATCH block tracker
    # ---------------------------------------------------------------------
    def test_tsql_try_catch_valid(self):
        from app.database.syntax.validator_mssql import _find_all_tsql_try_catch_blocks
        sql = """
BEGIN TRY
    INSERT INTO dbo.AuditLog (EventName) VALUES ('Test');
    SELECT 1 / 0;
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS ErrNum, ERROR_MESSAGE() AS ErrMsg;
END CATCH;
"""
        diags = _find_all_tsql_try_catch_blocks(sql)
        assert len(diags) == 0, f"Expected 0 errors for valid TRY...CATCH, got: {diags}"

    def test_tsql_try_missing_end_try(self):
        from app.database.syntax.validator_mssql import _find_all_tsql_try_catch_blocks
        sql = """
BEGIN TRY
    SELECT 1;
BEGIN CATCH
    SELECT 2;
END CATCH;
"""
        diags = _find_all_tsql_try_catch_blocks(sql)
        assert any("Unclosed BEGIN TRY" in d["message"] or "must follow immediately" in d["message"] for d in diags)

    def test_tsql_end_try_missing_begin_catch(self):
        from app.database.syntax.validator_mssql import _find_all_tsql_try_catch_blocks
        sql = """
BEGIN TRY
    SELECT 1;
END TRY
SELECT 'forgot catch';
"""
        diags = _find_all_tsql_try_catch_blocks(sql)
        assert any("Missing BEGIN CATCH block" in d["message"] for d in diags)
