"""Test Suite for SQL Context Engine & Parameter Parser
Reference: .SKILL/SQL_Parameter_Placeholder_Parse.md
"""

import os
import json
import pytest
from app.utils.crypto import decrypt_password
from app.database.postgresql import PostgreSqlAdapter


def test_sql_context_engine_file_and_script_order():
    """Verify sql-context-engine.js exists and is loaded properly in index.html"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'sql-context-engine.js')
    index_path = os.path.join(base_dir, 'templates', 'index.html')

    assert os.path.exists(engine_path), f"sql-context-engine.js not found at {engine_path}"

    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    assert 'static/js/sql-context-engine.js' in html, "sql-context-engine.js must be referenced in templates/index.html"

    dialect_idx = html.find('static/js/sql-dialects.js')
    ctx_engine_idx = html.find('static/js/sql-context-engine.js')
    tok_idx = html.find('static/js/sql-tokenizer.js')

    assert dialect_idx != -1 and ctx_engine_idx != -1 and tok_idx != -1
    assert dialect_idx < ctx_engine_idx < tok_idx, (
        f"Order violation: dialect({dialect_idx}) < context-engine({ctx_engine_idx}) < tokenizer({tok_idx})"
    )


def test_sql_context_engine_classes_and_api():
    """Verify classes and API exports in sql-context-engine.js"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'sql-context-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Core classes
    assert 'class SqlContextTokenizer' in code
    assert 'class SqlContextEngine' in code
    assert 'class SqlParameterParser' in code
    assert 'class SqlContextAdapter' in code

    # Core APIs
    assert 'analyze(' in code
    assert 'getCursorContext(' in code
    assert 'extract(' in code
    assert 'adapt(' in code

    # Global window exports
    assert 'window.SqlContextEngine = SqlContextEngine' in code
    assert 'window.SqlParameterParser = SqlParameterParser' in code
    assert 'window.SqlContextAdapter = SqlContextAdapter' in code
    assert 'window.sqlContextEngine = defaultEngine' in code
    assert 'window.sqlParameterParser = defaultParser' in code
    assert 'window.sqlContextAdapter = defaultAdapter' in code


def test_postgresql_select_format_execution():
    """Verify PostgreSQL execution of format('%I', '%L') without psycopg placeholder error."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    conn_path = os.path.join(base_dir, 'data', 'connections.json')

    with open(conn_path, 'r', encoding='utf-8-sig') as f:
        conns = json.load(f)

    cfg = next((c for c in conns if c.get('id') == 'conn_377e3f2f'), None)
    if not cfg:
        pytest.skip("Test database connection conn_377e3f2f not found")

    cfg_copy = dict(cfg)
    cfg_copy['password'] = decrypt_password(cfg_copy['password'])
    adapter = PostgreSqlAdapter(cfg_copy)
    adapter.connect()

    # The query that originally failed with:
    # only '%s', '%b', '%t' are allowed as placeholders, got '%I'
    sql = "SELECT format('SELECT * FROM %I WHERE id = %L', 'customer', 10);"
    res = adapter.execute(sql, database='Bravo10Setup', schema='dbo')

    assert res.get('success') is True
    assert len(res.get('rows', [])) == 1
    assert res['rows'][0][0] == "SELECT * FROM customer WHERE id = '10'"
    assert res.get('errors') == []


def test_postgresql_select_format_debug_mode():
    """Verify PostgreSQL execution of bs.trace() with format('%I', '%L') in debug mode."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    conn_path = os.path.join(base_dir, 'data', 'connections.json')

    with open(conn_path, 'r', encoding='utf-8-sig') as f:
        conns = json.load(f)

    cfg = next((c for c in conns if c.get('id') == 'conn_377e3f2f'), None)
    if not cfg:
        pytest.skip("Test database connection conn_377e3f2f not found")

    cfg_copy = dict(cfg)
    cfg_copy['password'] = decrypt_password(cfg_copy['password'])
    adapter = PostgreSqlAdapter(cfg_copy)
    adapter.connect()

    sql = "bs.trace(SELECT format('SELECT * FROM %I WHERE id = %L', 'customer', 10));"
    res = adapter.execute_debug(sql, database='Bravo10Setup', schema='dbo')

    assert res.get('success') is True
    assert len(res.get('trace_results', [])) == 1
    tr = res['trace_results'][0]
    assert tr.get('row_count') == 1
    assert tr.get('rows')[0][0] == "SELECT * FROM customer WHERE id = '10'"
    assert res.get('errors') == []


def test_postgresql_multi_trace_execution():
    """Verify multiple bs.trace() statements execute and produce multiple distinct grids."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    conn_path = os.path.join(base_dir, 'data', 'connections.json')

    with open(conn_path, 'r', encoding='utf-8-sig') as f:
        conns = json.load(f)

    cfg = next((c for c in conns if c.get('id') == 'conn_377e3f2f'), None)
    if not cfg:
        pytest.skip("Test database connection conn_377e3f2f not found")

    cfg_copy = dict(cfg)
    cfg_copy['password'] = decrypt_password(cfg_copy['password'])
    adapter = PostgreSqlAdapter(cfg_copy)
    adapter.connect()

    sql = """
    bs.trace(SELECT * FROM b00command LIMIT 3;)
    bs.trace(SELECT * FROM b00lookup LIMIT 2;)
    """
    res = adapter.execute_debug(sql, database='Bravo10Setup', schema='dbo')

    assert res.get('success') is True
    assert len(res.get('trace_results', [])) == 2
    tr1 = res['trace_results'][0]
    tr2 = res['trace_results'][1]
    assert tr1.get('row_count') == 3
    assert tr2.get('row_count') == 2
    assert tr1.get('trace_id') == 'trace_1'
    assert tr2.get('trace_id') == 'trace_2'
    assert len(tr1.get('columns')) == 30
    assert len(tr2.get('columns')) == 18
    assert res.get('errors') == []
