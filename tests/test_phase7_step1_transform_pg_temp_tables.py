# -*- coding: utf-8 -*-
"""
tests/test_phase7_step1_transform_pg_temp_tables.py:
Unit tests for app.database.debug.instrumenter.transform_pg_temp_tables.
Verifies proper transformation of SQL Server style #temp_table syntax to PostgreSQL temp tables,
ensuring string literals, dollar-quotes, escape strings, identifiers, comments, and PG operators
are protected without unintended corruption.
"""
import pytest
from app.database.debug.instrumenter import transform_pg_temp_tables


def test_no_hash_returns_identical():
    """Verify queries without # are returned unchanged with zero overhead."""
    sql = "SELECT id, name FROM users WHERE active = true;"
    assert transform_pg_temp_tables(sql) == sql


def test_basic_table_reference_replacement():
    """Verify simple #table is transformed to bs_temp_table."""
    sql = "SELECT * FROM #my_temp;"
    expected = "SELECT * FROM bs_temp_my_temp;"
    assert transform_pg_temp_tables(sql) == expected


def test_create_table_to_create_temp_table():
    """Verify CREATE TABLE #name becomes CREATE TEMP TABLE bs_temp_name."""
    sql = "CREATE TABLE #orders (id int, amount numeric(18,2));"
    expected = "CREATE TEMP TABLE bs_temp_orders (id int, amount numeric(18,2));"
    assert transform_pg_temp_tables(sql) == expected


def test_select_into_to_into_temp():
    """Verify SELECT ... INTO #name becomes SELECT ... INTO TEMP bs_temp_name."""
    sql = "SELECT id, code INTO #result_set FROM master_data;"
    expected = "SELECT id, code INTO TEMP bs_temp_result_set FROM master_data;"
    assert transform_pg_temp_tables(sql) == expected


def test_insert_into_temp_table():
    """Verify INSERT INTO #name inserts into bs_temp_name."""
    sql = "INSERT INTO #result_set (id, code) VALUES (1, 'ABC');"
    expected = "INSERT INTO bs_temp_result_set (id, code) VALUES (1, 'ABC');"
    assert transform_pg_temp_tables(sql) == expected


def test_quoted_identifier_protection():
    """Verify double-quoted identifiers containing # are NOT replaced."""
    sql = 'SELECT "col#1", "#pk" FROM #real_temp WHERE "table#ref" = 1;'
    expected = 'SELECT "col#1", "#pk" FROM bs_temp_real_temp WHERE "table#ref" = 1;'
    assert transform_pg_temp_tables(sql) == expected


def test_single_quoted_string_protection():
    """Verify standard single-quoted strings with # are NOT replaced."""
    sql = "SELECT '#not_a_temp', '#hello#world' FROM #data_tbl WHERE val = 'item#123';"
    expected = "SELECT '#not_a_temp', '#hello#world' FROM bs_temp_data_tbl WHERE val = 'item#123';"
    assert transform_pg_temp_tables(sql) == expected


def test_dollar_quoted_block_protection():
    """Verify PostgreSQL dollar-quoted blocks ($$...$$ and $tag$...$tag$) preserve # untouched."""
    sql = """
    CREATE OR REPLACE FUNCTION test_fn() RETURNS void AS $$
    BEGIN
        -- Inside dollar quote, #temp is a literal comment or internal text
        PERFORM '#not_replaced';
    END;
    $$ LANGUAGE plpgsql;
    SELECT * FROM #outer_temp;
    """
    res = transform_pg_temp_tables(sql)
    assert "PERFORM '#not_replaced';" in res
    assert "SELECT * FROM bs_temp_outer_temp;" in res


def test_dollar_quoted_tagged_block_protection():
    """Verify tagged dollar quotes $body$...$body$ preserve inner #."""
    sql = "SELECT $tag$SELECT * FROM #do_not_touch$tag$ AS code FROM #my_temp;"
    expected = "SELECT $tag$SELECT * FROM #do_not_touch$tag$ AS code FROM bs_temp_my_temp;"
    assert transform_pg_temp_tables(sql) == expected


def test_escape_string_literal_protection():
    """Verify E'...' and e'...' strings with escaped characters and # are preserved."""
    sql = r"SELECT E'line 1\n#not_temp\t\'quoted\'', e'#also_safe' FROM #run_table;"
    expected = r"SELECT E'line 1\n#not_temp\t\'quoted\'', e'#also_safe' FROM bs_temp_run_table;"
    assert transform_pg_temp_tables(sql) == expected


def test_single_and_multi_line_comment_protection():
    """Verify single-line and multi-line comments protect #."""
    sql = """
    -- This is a comment mentioning #temp_table
    /* Multi-line comment
       mentioning #another_temp
    */
    SELECT * FROM #active_temp;
    """
    res = transform_pg_temp_tables(sql)
    assert "-- This is a comment mentioning #temp_table" in res
    assert "mentioning #another_temp" in res
    assert "SELECT * FROM bs_temp_active_temp;" in res


def test_postgresql_json_and_geometric_operators():
    """Verify PostgreSQL operators starting with # (#>, #>>, #-, ##) are not mangled."""
    sql = "SELECT data #> '{a,b}', data #>> '{c}', data #- '{d}' FROM #json_tbl;"
    expected = "SELECT data #> '{a,b}', data #>> '{c}', data #- '{d}' FROM bs_temp_json_tbl;"
    assert transform_pg_temp_tables(sql) == expected


def test_multiple_temp_tables_in_joins():
    """Verify multiple temp tables in complex joins are all transformed correctly."""
    sql = """
    SELECT a.id, b.name
    FROM #temp_a a
    INNER JOIN #temp_b b ON a.id = b.id
    LEFT JOIN #temp_c c ON b.c_id = c.id;
    """
    expected = """
    SELECT a.id, b.name
    FROM bs_temp_temp_a a
    INNER JOIN bs_temp_temp_b b ON a.id = b.id
    LEFT JOIN bs_temp_temp_c c ON b.c_id = c.id;
    """
    assert transform_pg_temp_tables(sql) == expected
