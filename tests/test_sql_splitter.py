"""
Unit tests for SQL Statement Splitter (Mục 5.2).
"""
import pytest
from app.utils.sql_splitter import split_statements


def test_split_simple_semicolons():
    sql = "SELECT 1; SELECT 2; SELECT 3;"
    stmts = split_statements(sql, dialect="sqlserver")
    assert len(stmts) == 3
    assert stmts[0]["sql"] == "SELECT 1"
    assert stmts[1]["sql"] == "SELECT 2"
    assert stmts[2]["sql"] == "SELECT 3"


def test_split_ignores_semicolon_in_string_literals():
    sql = "SELECT 'hello; world' AS greeting; SELECT 'test;;' AS val"
    stmts = split_statements(sql, dialect="sqlserver")
    assert len(stmts) == 2
    assert stmts[0]["sql"] == "SELECT 'hello; world' AS greeting"
    assert stmts[1]["sql"] == "SELECT 'test;;' AS val"


def test_split_ignores_semicolon_in_comments():
    sql = """
    -- This is a comment; with semicolon
    SELECT 1;
    /* Multi line comment
       with ; semicolon */
    SELECT 2;
    """
    stmts = split_statements(sql, dialect="sqlserver")
    assert len(stmts) == 2
    assert "SELECT 1" in stmts[0]["sql"]
    assert "SELECT 2" in stmts[1]["sql"]


def test_split_postgresql_dollar_quotes():
    sql = """
    CREATE OR REPLACE FUNCTION test_func() RETURNS void AS $$
    BEGIN
        SELECT 1;
        UPDATE tbl SET x = 1;
    END;
    $$ LANGUAGE plpgsql;
    SELECT * FROM tbl;
    """
    stmts = split_statements(sql, dialect="postgresql")
    assert len(stmts) == 2
    assert "CREATE OR REPLACE FUNCTION test_func" in stmts[0]["sql"]
    assert "SELECT 1;" in stmts[0]["sql"]  # Semicolons inside $$ are kept
    assert stmts[1]["sql"] == "SELECT * FROM tbl"


def test_split_sqlserver_go_batches():
    sql = """
    CREATE TABLE #Temp (Id INT);
    GO
    INSERT INTO #Temp VALUES (1);
    INSERT INTO #Temp VALUES (2);
    GO
    SELECT * FROM #Temp;
    """
    stmts = split_statements(sql, dialect="sqlserver")
    # Batch 1: CREATE TABLE #Temp (Id INT)
    # Batch 2: INSERT INTO #Temp VALUES (1); Batch 3: INSERT INTO #Temp VALUES (2);
    # Batch 4: SELECT * FROM #Temp;
    assert any("CREATE TABLE #Temp" in s["sql"] for s in stmts)
    assert any("SELECT * FROM #Temp" in s["sql"] for s in stmts)


def test_split_line_number_tracking():
    sql = "SELECT 1;\n\nSELECT 2;\n\nSELECT 3;"
    stmts = split_statements(sql, dialect="sqlserver")
    assert len(stmts) == 3
    assert stmts[0]["start_line"] == 1
    assert stmts[1]["start_line"] == 3
    assert stmts[2]["start_line"] == 5
