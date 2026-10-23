# -*- coding: utf-8 -*-
"""
Tests for Sprint 3 (Smart IDE v1.1.0) and Milestone B2:
1. Milestone B2: Semantic Analyzer executes after ScriptDOM / T-SQL parser path.
2. C1: Best Practice rules (BP001 - BP006) with comment/string masking.
3. C3: Statement-level caching with 5s TTL and invalidation triggers.
"""
import time
import pytest
from app.database.syntax.coordinator import (
    validate_sql_pipeline,
    invalidate_syntax_cache,
    get_syntax_cache_size,
)
from app.database.syntax.best_practice_rules import (
    check_best_practice_rules,
    _mask_sql_strings_and_comments,
)


class TestB2SemanticAnalyzerAfterScriptDOM:
    """Verifies Milestone B2: Semantic Analyzer runs after ScriptDOM parser without regression."""

    def test_b2_table_variable_invalid_column_detected(self):
        """Valid ScriptDOM syntax with table variable but non-existent column must report SQL_INVALID_COLUMN."""
        sql = """
        DECLARE @Employees TABLE (
            EmpID INT,
            EmpName NVARCHAR(50)
        );
        SELECT NonExistentCol FROM @Employees;
        """
        diags = validate_sql_pipeline(sql, dialect="sqlserver", bypass_cache=True)
        # Check that semantic error is reported
        invalid_cols = [d for d in diags if d.get("code") == "SQL_INVALID_COLUMN"]
        assert len(invalid_cols) >= 1
        assert "NonExistentCol" in str(invalid_cols[0].get("message")) or "NonExistentCol" in str(invalid_cols[0].get("token"))

    def test_b2_cte_invalid_column_detected(self):
        """Valid ScriptDOM syntax with CTE but non-existent column must report SQL_INVALID_COLUMN."""
        sql = """
        WITH DeptSummary AS (
            SELECT 1 AS DeptID, 100 AS TotalSalary
        )
        SELECT InvalidField FROM DeptSummary;
        """
        diags = validate_sql_pipeline(sql, dialect="sqlserver", bypass_cache=True)
        invalid_cols = [d for d in diags if d.get("code") == "SQL_INVALID_COLUMN"]
        assert len(invalid_cols) >= 1
        assert "InvalidField" in str(invalid_cols[0].get("message")) or "InvalidField" in str(invalid_cols[0].get("token"))

    def test_b2_temp_table_invalid_column_detected(self):
        """Valid ScriptDOM syntax with temp table but non-existent column must report SQL_INVALID_COLUMN."""
        sql = """
        CREATE TABLE #TempOrders (
            OrderID INT,
            Amount DECIMAL(18, 2)
        );
        SELECT WrongColumn FROM #TempOrders;
        """
        diags = validate_sql_pipeline(sql, dialect="sqlserver", bypass_cache=True)
        invalid_cols = [d for d in diags if d.get("code") == "SQL_INVALID_COLUMN"]
        assert len(invalid_cols) >= 1
        assert "WrongColumn" in str(invalid_cols[0].get("message")) or "WrongColumn" in str(invalid_cols[0].get("token"))


class TestC1BestPracticeRules:
    """Verifies best-practice rules BP001 - BP006."""

    def test_mask_sql_strings_and_comments(self):
        sql = "SELECT * -- comment with SELECT *\n/* block comment SELECT * */ FROM 'SELECT *'"
        masked = _mask_sql_strings_and_comments(sql)
        assert len(masked) == len(sql)
        # Original newlines are preserved
        assert masked.count("\n") == sql.count("\n")
        # Comment contents and string literals are replaced by spaces
        assert "comment" not in masked
        assert "block comment" not in masked

    def test_bp001_select_star_warning(self):
        # Plain SELECT *
        sql = "SELECT * FROM dbo.Users;"
        diags = check_best_practice_rules(sql, dialect="sqlserver")
        bp1 = [d for d in diags if d.get("code") == "BP001"]
        assert len(bp1) == 1
        assert bp1[0]["severity"] == "warning"

        # COUNT(*) or COUNT_BIG(*) must NOT trigger BP001
        sql_count = "SELECT COUNT(*) FROM dbo.Users;"
        diags_count = check_best_practice_rules(sql_count, dialect="sqlserver")
        assert not any(d.get("code") == "BP001" for d in diags_count)

        # EXISTS (SELECT * ...) must NOT trigger BP001
        sql_exists = "SELECT col1 FROM dbo.Users WHERE EXISTS (SELECT * FROM dbo.Orders WHERE Orders.UserID = Users.ID);"
        diags_exists = check_best_practice_rules(sql_exists, dialect="sqlserver")
        assert not any(d.get("code") == "BP001" for d in diags_exists)

    def test_bp002_nolock_table_hint(self):
        sql = "SELECT col1 FROM dbo.Users WITH (NOLOCK) JOIN dbo.Orders (NOLOCK) ON Users.ID = Orders.UserID;"
        diags = check_best_practice_rules(sql, dialect="sqlserver")
        bp2 = [d for d in diags if d.get("code") == "BP002"]
        assert len(bp2) == 2
        assert bp2[0]["severity"] == "warning"
        assert "NOLOCK" in bp2[0]["token"]

    def test_bp003_missing_schema_qualification(self):
        # Users without schema
        sql = "SELECT col1 FROM Users;"
        diags = check_best_practice_rules(sql, dialect="sqlserver")
        bp3 = [d for d in diags if d.get("code") == "BP003"]
        assert len(bp3) >= 1
        assert bp3[0]["token"] == "Users"
        assert "dbo.Users" in bp3[0]["message"]

        # Temp tables, table variables, and CTEs should not trigger BP003
        sql_special = """
        WITH UserCTE AS (SELECT 1 AS ID)
        SELECT col1 FROM #TempTable JOIN @TableVar ON 1=1 JOIN UserCTE ON 1=1;
        """
        diags_special = check_best_practice_rules(sql_special, dialect="sqlserver")
        assert not any(d.get("code") == "BP003" for d in diags_special)

    def test_bp004_top_without_order_by(self):
        # TOP without ORDER BY
        sql_no_order = "SELECT TOP 10 col1 FROM dbo.Users;"
        diags_no_order = check_best_practice_rules(sql_no_order, dialect="sqlserver")
        bp4 = [d for d in diags_no_order if d.get("code") == "BP004"]
        assert len(bp4) == 1
        assert bp4[0]["severity"] == "warning"

        # TOP with ORDER BY
        sql_with_order = "SELECT TOP 10 col1 FROM dbo.Users ORDER BY col1 DESC;"
        diags_with_order = check_best_practice_rules(sql_with_order, dialect="sqlserver")
        assert not any(d.get("code") == "BP004" for d in diags_with_order)

    def test_bp005_isnull_vs_coalesce(self):
        sql = "SELECT ISNULL(col1, 'DefaultVal') FROM dbo.Users;"
        diags = check_best_practice_rules(sql, dialect="sqlserver")
        bp5 = [d for d in diags if d.get("code") == "BP005"]
        assert len(bp5) == 1
        assert bp5[0]["token"] == "ISNULL"
        assert "COALESCE" in bp5[0]["message"]

    def test_bp006_2_arg_convert_vs_cast(self):
        # 2-argument CONVERT
        sql_2arg = "SELECT CONVERT(NVARCHAR(30), col1) FROM dbo.Users;"
        diags_2arg = check_best_practice_rules(sql_2arg, dialect="sqlserver")
        bp6 = [d for d in diags_2arg if d.get("code") == "BP006"]
        assert len(bp6) == 1
        assert bp6[0]["token"] == "CONVERT"
        assert "CAST" in bp6[0]["message"]

        # 3-argument CONVERT with style (e.g. 120) should NOT trigger BP006
        sql_3arg = "SELECT CONVERT(VARCHAR(10), GETDATE(), 120) FROM dbo.Users;"
        diags_3arg = check_best_practice_rules(sql_3arg, dialect="sqlserver")
        assert not any(d.get("code") == "BP006" for d in diags_3arg)


class TestC3StatementLevelCache:
    """Verifies statement-level caching (5s TTL) and invalidation triggers."""

    def setup_method(self):
        invalidate_syntax_cache()

    def test_cache_hit_and_ttl(self):
        sql = "SELECT col1 FROM dbo.Users;"
        # First call: populates cache
        res1 = validate_sql_pipeline(sql, dialect="sqlserver")
        assert get_syntax_cache_size() >= 1

        # Second call: fast cache hit
        res2 = validate_sql_pipeline(sql, dialect="sqlserver")
        assert res1 == res2

    def test_cache_invalidation(self):
        sql = "SELECT col1 FROM dbo.Users;"
        validate_sql_pipeline(sql, dialect="sqlserver")
        assert get_syntax_cache_size() >= 1

        # Invalidate all cache
        cleared = invalidate_syntax_cache()
        assert cleared >= 1
        assert get_syntax_cache_size() == 0

    def test_different_queries_cache_separately(self):
        sql1 = "SELECT col1 FROM dbo.Users;"
        sql2 = "SELECT col2 FROM dbo.Orders;"
        validate_sql_pipeline(sql1, dialect="sqlserver")
        validate_sql_pipeline(sql2, dialect="sqlserver")
        assert get_syntax_cache_size() == 2
