import pytest
from app.database.syntax.semantic_analyzer import analyze_sql_semantics, TempTableTimeline

def test_postgres_cross_procedure_temp_table():
    sql = """
    CREATE OR REPLACE PROCEDURE proc_b()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_b (col_b1 INT, col_b2 TEXT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_a()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_b();
        SELECT col_b1, col_b2 FROM temp_b;
    END;
    $$;
    """
    diags = analyze_sql_semantics(sql, dialect="postgres")
    # No error-level diagnostics
    errors = [d for d in diags if d.get("severity") == "error"]
    assert errors == [], f"Expected no semantic errors, but got: {errors}"

    # Yellow warning for inherited temp table from proc_b
    warnings = [d for d in diags if d.get("severity") == "warning"]
    assert len(warnings) == 1
    assert warnings[0]["code"] == "PG_TEMP_TABLE_INHERITED"
    assert "temp_b" in warnings[0]["message"]
    assert "proc_b" in warnings[0]["message"]

    # Invalid column on exported temp table temp_b should be caught
    sql_invalid = """
    CREATE OR REPLACE PROCEDURE proc_b()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_b (col_b1 INT, col_b2 TEXT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_a()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_b();
        SELECT col_invalid FROM temp_b;
    END;
    $$;
    """
    diags_invalid = analyze_sql_semantics(sql_invalid, dialect="postgres")
    errors_invalid = [d for d in diags_invalid if d.get("severity") == "error"]
    assert len(errors_invalid) == 1
    assert "col_invalid" in errors_invalid[0]["message"]

def test_postgres_callee_missing_temp_table_warning():
    sql = """
    CREATE OR REPLACE PROCEDURE proc_b()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_b (id INT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_a()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_b();
        SELECT id FROM temp_missing;
    END;
    $$;
    """
    diags = analyze_sql_semantics(sql, dialect="postgres")
    warnings = [d for d in diags if d.get("code") == "PG_TEMP_NOT_FOUND_IN_CALLEE"]
    assert len(warnings) == 1
    assert "temp_missing" in warnings[0]["message"]
    assert "proc_b()" in warnings[0]["message"]

def test_postgres_temp_table_conflict_warning():
    sql = """
    CREATE OR REPLACE PROCEDURE proc_b()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_b (id INT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_a()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_b();
        CREATE TEMP TABLE temp_b (id INT);
    END;
    $$;
    """
    diags = analyze_sql_semantics(sql, dialect="postgres")
    conflicts = [d for d in diags if d.get("code") == "PG_TEMP_CONFLICT_WARNING"]
    assert len(conflicts) == 1
    assert "temp_b" in conflicts[0]["message"]
    assert "proc_b()" in conflicts[0]["message"]
    assert "IF NOT EXISTS" in conflicts[0]["message"]

def test_postgres_uncalled_procedure_temp_table():
    sql = """
    CREATE OR REPLACE PROCEDURE proc_uncalled()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_uncalled (secret_id INT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_caller()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        SELECT secret_id FROM temp_uncalled;
    END;
    $$;
    """
    diags = analyze_sql_semantics(sql, dialect="postgres")
    assert len(diags) >= 1
    assert any("temp_uncalled" in d["message"] for d in diags)

def test_postgres_transitive_procedure_calls():
    sql = """
    CREATE OR REPLACE PROCEDURE proc_c()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CREATE TEMP TABLE temp_c (val TEXT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_b()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_c();
        CREATE TEMP TABLE temp_b (id INT);
    END;
    $$;

    CREATE OR REPLACE PROCEDURE proc_a()
    LANGUAGE plpgsql
    AS $$
    BEGIN
        CALL proc_b();
        SELECT val FROM temp_c;
        SELECT id FROM temp_b;
    END;
    $$;
    """
    diags = analyze_sql_semantics(sql, dialect="postgres")
    errors = [d for d in diags if d.get("severity") == "error"]
    assert errors == [], f"Expected no semantic errors for transitive call, got: {errors}"
    inherited = [d for d in diags if d.get("code") == "PG_TEMP_TABLE_INHERITED"]
    assert len(inherited) == 2
    assert any("temp_c" in d["message"] and "proc_c" in d["message"] for d in inherited)
    assert any("temp_b" in d["message"] and "proc_b" in d["message"] for d in inherited)

def test_sqlserver_procedure_temp_table_isolation():
    sql = """
    CREATE PROCEDURE dbo.usp_Child
    AS
    BEGIN
        CREATE TABLE #temp_child (ChildId INT, ChildName NVARCHAR(50));
        SELECT ChildId FROM #temp_child;
    END;
    GO

    CREATE PROCEDURE dbo.usp_Parent
    AS
    BEGIN
        EXEC dbo.usp_Child;
        SELECT ChildId FROM #temp_child;
    END;
    GO
    """
    diags = analyze_sql_semantics(sql, dialect="sqlserver")
    # Inside usp_Child, #temp_child is valid.
    # Inside usp_Parent, #temp_child must NOT be available because SQL Server does not export callee #temp.
    assert len(diags) == 1
    assert "#temp_child" in diags[0]["message"]
    assert "Invalid object name" in diags[0]["message"]

def test_sqlserver_procedure_self_temp_table_and_outer_isolation():
    sql = """
    CREATE PROCEDURE dbo.usp_Self
    AS
    BEGIN
        CREATE TABLE #temp_self (SelfId INT, SelfDesc NVARCHAR(100));
        SELECT SelfId, SelfDesc FROM #temp_self;
    END;
    GO

    -- Outer script after procedure finishes
    SELECT SelfId FROM #temp_self;
    """
    diags = analyze_sql_semantics(sql, dialect="sqlserver")
    # Inside usp_Self, #temp_self is valid.
    # In outer script after usp_Self finishes, #temp_self is dropped.
    assert len(diags) == 1
    assert "#temp_self" in diags[0]["message"]
