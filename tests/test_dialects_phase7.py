import os
import pytest

def test_sql_dialects_file_and_script_order():
    """Verify sql-dialects.js exists and is loaded before sql-tokenizer.js in index.html"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dialects_path = os.path.join(base_dir, 'static', 'js', 'sql-dialects.js')
    index_path = os.path.join(base_dir, 'templates', 'index.html')

    assert os.path.exists(dialects_path), f"sql-dialects.js not found at {dialects_path}"

    with open(index_path, 'r', encoding='utf-8') as f:
        html = f.read()

    assert 'static/js/sql-dialects.js' in html, "sql-dialects.js must be referenced in templates/index.html"

    dialect_idx = html.find('static/js/sql-dialects.js')
    tok_idx = html.find('static/js/sql-tokenizer.js')
    scope_idx = html.find('static/js/scope-resolver.js')
    ctx_idx = html.find('static/js/context-analyzer.js')
    prov_idx = html.find('static/js/metadata-provider.js')
    cache_idx = html.find('static/js/metadata-cache.js')
    engine_idx = html.find('static/js/completion-engine.js')
    intel_idx = html.find('static/js/intellisense.js')

    assert dialect_idx != -1 and tok_idx != -1 and scope_idx != -1
    assert ctx_idx != -1 and prov_idx != -1 and cache_idx != -1 and engine_idx != -1 and intel_idx != -1

    # Strict architectural pipeline order:
    assert dialect_idx < tok_idx < scope_idx < ctx_idx < prov_idx < cache_idx < engine_idx < intel_idx, (
        f"Order violation: dialect({dialect_idx}) < tokenizer({tok_idx}) < scope({scope_idx}) < "
        f"context({ctx_idx}) < provider({prov_idx}) < cache({cache_idx}) < engine({engine_idx}) < "
        f"intellisense({intel_idx})"
    )
    print("\n[PASS] Phase 7 sql-dialects.js file and script load order verified!")


def test_sql_dialects_classes_and_api():
    """Verify class declarations and primary methods in sql-dialects.js"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dialects_path = os.path.join(base_dir, 'static', 'js', 'sql-dialects.js')

    with open(dialects_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Core classes
    assert 'class SqlDialect' in code
    assert 'class SqlServerDialect extends SqlDialect' in code
    assert 'class PostgresDialect extends SqlDialect' in code
    assert 'class SqlDialectFactory' in code

    # Required contract methods (Section 43)
    for method in ['quoteIdentifier', 'unquoteIdentifier', 'normalizeIdentifier',
                   'isQuotedIdentifier', 'isTempObject', 'getKeywords', 'getFunctions',
                   'getDataTypes', 'getBatchSeparators', 'getAlterHeaderTemplate']:
        assert method in code, f"Method {method} not found in sql-dialects.js"

    # Window exports
    assert 'window.SqlDialect = SqlDialect' in code
    assert 'window.SqlServerDialect = SqlServerDialect' in code
    assert 'window.PostgresDialect = PostgresDialect' in code
    assert 'window.SqlDialectFactory = SqlDialectFactory' in code

    print("\n[PASS] SqlDialect classes and method APIs verified!")


def test_sqlserver_dialect_rules():
    """Verify SQL Server specific rules: brackets, #temp, GO, CREATE OR ALTER (Section 44)"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dialects_path = os.path.join(base_dir, 'static', 'js', 'sql-dialects.js')

    with open(dialects_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Quoting with square brackets
    assert "`[${clean}]`" in code or "'['" in code

    # Temporary objects with # or @
    assert "clean.startsWith('#') || clean.startsWith('@')" in code or "startsWith('#')" in code

    # Batch separator GO
    assert "'GO'" in code

    # CREATE OR ALTER
    assert 'CREATE OR ALTER' in code

    # Dialect keywords & functions
    assert '"TOP"' in code
    assert '"CROSS APPLY"' in code
    assert '"NOLOCK"' in code
    assert '"GETDATE"' in code
    assert '"ISNULL"' in code
    assert '"NEWID"' in code

    print("\n[PASS] SQL Server dialect rules and syntax features verified!")


def test_postgres_dialect_rules():
    """Verify PostgreSQL specific rules: double-quotes, lowercase folding, public default, CREATE OR REPLACE (Section 45)"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dialects_path = os.path.join(base_dir, 'static', 'js', 'sql-dialects.js')

    with open(dialects_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Quoting with double-quotes
    assert '`"${clean}"`' in code or '"\""' in code

    # Default schema public
    assert "'public'" in code

    # Case folding: unquoted identifiers fold to lowercase
    assert 's.toLowerCase()' in code

    # CREATE OR REPLACE for views/functions
    assert 'CREATE OR REPLACE' in code

    # Dialect keywords & functions
    assert '"LIMIT"' in code
    assert '"OFFSET"' in code
    assert '"RETURNING"' in code
    assert '"ILIKE"' in code
    assert '"NOW"' in code
    assert '"COALESCE"' in code
    assert '"GEN_RANDOM_UUID"' in code

    print("\n[PASS] PostgreSQL dialect rules, case folding, and keywords verified!")


def test_sql_dialect_factory_resolution():
    """Verify dialect factory registration and resolution logic"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dialects_path = os.path.join(base_dir, 'static', 'js', 'sql-dialects.js')

    with open(dialects_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Factory methods
    assert 'static getDialect(dbType' in code
    assert 'static getDialectForConnection(connectionId)' in code
    assert 'static register(' in code

    # Aliases handled
    for alias in ['sqlserver', 'mssql', 'postgresql', 'postgres', 'pg']:
        assert f"'{alias}'" in code

    print("\n[PASS] SqlDialectFactory resolution and aliases verified!")


def test_completion_engine_dialect_integration():
    """Verify CandidateGenerator in completion-engine.js queries SqlDialectFactory"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    assert 'SqlDialectFactory' in code
    assert 'SqlDialectFactory.getDialect' in code
    assert 'dialect.getKeywords()' in code
    assert 'dialect.getFunctions()' in code

    print("\n[PASS] CandidateGenerator dialect integration verified!")
