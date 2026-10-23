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
    assert diags == [], f"Expected no semantic errors, but got: {diags}"

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
    assert len(diags_invalid) == 1
    assert "col_invalid" in diags_invalid[0]["message"]

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
    assert diags == [], f"Expected no semantic errors for transitive call, got: {diags}"

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
