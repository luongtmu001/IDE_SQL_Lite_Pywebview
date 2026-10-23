# -*- coding: utf-8 -*-
"""
Tests for PostgreSQL PL/pgSQL syntax checking:
1. Accurate BEGIN...END; matching for functions containing complex SELECT statements.
2. Accurate position reporting for unclosed CASE expressions (pointing to CASE, not subsequent ENDs).
3. Chained CASE expressions with '||' string concatenation.
"""
import pytest
from app.database.syntax.adapters.postgresql_adapter import (
    PostgreSqlAdapter,
    check_offline_postgres_structural_blocks,
)
from app.database.syntax.coordinator import validate_sql_pipeline
from app.database.syntax.validator_mssql import _validate_with_sqlglot, find_unclosed_case_in_sql


class TestPostgreSqlCaseAndFunctionEnd:
    """Verifies resolution of function END matching and CASE WHEN positioning bugs."""

    def test_chained_case_when_all_valid_in_function(self):
        """When all CASE expressions are closed, function BEGIN...END; must have zero errors."""
        sql = """CREATE OR REPLACE FUNCTION dbo.ufn_test(p_langid integer)
RETURNS SETOF dbo.test_type
LANGUAGE plpgsql
AS $function$
BEGIN
    SELECT
        ter.Code AS TerritoryCode,
        CASE WHEN COALESCE(Pay.Name, '') <> '' THEN _PaymentNote ELSE '' END
        || CASE WHEN COALESCE(bc.PortOfLoading, '') <> '' THEN _PortOfLoadingNote ELSE '' END
        || CASE WHEN COALESCE(Ship.Name, '') <> '' THEN _ShipViaNote ELSE '' END
        AS Note,
        '' AS TreeColName
    FROM Tmp_V_CtTmp bc
        LEFT OUTER JOIN dbo.B20Item item ON bc.ItemId = item.Id;

    RETURN NEXT _ref1;
END;
$function$;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 diags for valid function, got: {diags}"

        pipeline_diags = validate_sql_pipeline(sql, dialect="postgres")
        # Filter out info status markers
        errors = [d for d in pipeline_diags if d.get("severity") == "error"]
        assert len(errors) == 0, f"Expected 0 errors in pipeline, got: {errors}"

    def test_first_case_missing_end_points_to_first_case_not_function_end(self):
        """
        When the first CASE in a chain is missing END:
        1. The error must point to the first CASE (unclosed CASE expression).
        2. The second and third CASE's ENDs must NOT be flagged as unmatched.
        3. The function's final END; must NOT be flagged as unmatched BEGIN block.
        """
        sql = """CREATE OR REPLACE FUNCTION dbo.ufn_test(p_langid integer)
RETURNS SETOF dbo.test_type
LANGUAGE plpgsql
AS $function$
BEGIN
    SELECT
        ter.Code AS TerritoryCode,
        CASE WHEN COALESCE(Pay.Name, '') <> '' THEN _PaymentNote ELSE ''
        || CASE WHEN COALESCE(bc.PortOfLoading, '') <> '' THEN _PortOfLoadingNote ELSE '' END
        || CASE WHEN COALESCE(Ship.Name, '') <> '' THEN _ShipViaNote ELSE '' END
        AS Note,
        '' AS TreeColName
    FROM Tmp_V_CtTmp bc
        LEFT OUTER JOIN dbo.B20Item item ON bc.ItemId = item.Id;

    RETURN NEXT _ref1;
END;
$function$;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 1, f"Expected exactly 1 diagnostic, got: {diags}"
        d = diags[0]
        assert d["token"] == "CASE"
        assert d["line"] == 8  # Line of the first CASE
        assert "Unclosed CASE expression" in d["message"]

        # Ensure NO error on line 20 (END;)
        assert not any(err.get("token") == "END" and err.get("line") == 20 for err in diags)

    def test_sqlglot_error_position_corrected_for_unclosed_case(self):
        """
        When sqlglot parses a standalone query where a CASE expression is missing END,
        it must report token='CASE' at the line of the unclosed CASE, not highlight
        the END of a subsequent valid expression.
        """
        query = """SELECT
    ter.Code AS TerritoryCode,
    CASE WHEN COALESCE(Pay.Name, '') <> '' THEN _PaymentNote ELSE ''
    || CASE WHEN COALESCE(bc.PortOfLoading, '') <> '' THEN _PortOfLoadingNote ELSE '' END
    || CASE WHEN COALESCE(Ship.Name, '') <> '' THEN _ShipViaNote ELSE '' END
    AS Note
FROM Tmp_V_CtTmp bc;"""

        diags = _validate_with_sqlglot(query, dialect="postgres")
        assert len(diags) >= 1
        d = diags[0]
        assert d["token"] == "CASE", f"Expected token 'CASE', got: {d['token']}"
        assert d["line"] == 3, f"Expected line 3 (first CASE), got: {d['line']}"
        assert "Unclosed CASE expression" in d["message"]

    def test_find_unclosed_case_in_sql_helper(self):
        """Direct verification of the unclosed CASE scanner helper."""
        # Multiple closed cases
        sql_ok = "SELECT CASE WHEN a THEN 1 END, CASE WHEN b THEN 2 END;"
        assert find_unclosed_case_in_sql(sql_ok) == []

        # One unclosed in statement 1, statement 2 clean
        sql_err = "SELECT CASE WHEN a THEN 1; SELECT 2;"
        unclosed = find_unclosed_case_in_sql(sql_err)
        assert len(unclosed) == 1
        assert unclosed[0]["line"] == 1

    def test_procedural_case_statement_with_end_case(self):
        """Procedural CASE ... END CASE; must work without interference from scalar CASE rules."""
        sql = """CREATE OR REPLACE FUNCTION proc_case_test(val INT)
RETURNS TEXT AS $function$
BEGIN
    CASE val
        WHEN 1 THEN
            PERFORM 1;
        WHEN 2 THEN
            PERFORM 2;
        ELSE
            PERFORM 3;
    END CASE;
END;
$function$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert len(diags) == 0, f"Expected 0 diags for valid procedural CASE, got: {diags}"

    def test_procedural_case_missing_end_case(self):
        """Procedural CASE missing END CASE must report unclosed CASE."""
        sql = """CREATE OR REPLACE FUNCTION proc_case_bad(val INT)
RETURNS TEXT AS $function$
BEGIN
    CASE val
        WHEN 1 THEN PERFORM 1;
        -- Missing END CASE;
END;
$function$ LANGUAGE plpgsql;
"""
        diags = check_offline_postgres_structural_blocks(sql)
        assert any("CASE" in d.get("token", "") for d in diags)
