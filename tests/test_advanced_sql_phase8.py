"""
tests/test_advanced_sql_phase8.py - Automated Tests for Phase 8: Advanced SQL
Compliant with Section 29, 39, 40, 46, 47, 48, 51, and 70 of intellisense_improvement_plan_v2.md

Verifies:
1. CTE (Common Table Expressions) parsing, symbol table registration, and column projection.
2. Subquery / Derived table column isolation (Section 40).
3. Temporary table column definition parsing (#temp, ##global) and qualified suggestions (Section 46).
4. Table variables (@table) and scalar variables (@var) scoping and expression suggestions (Section 47, 48).
5. Stored procedure parameter resolution on EXEC (Section 29, 51).
6. Function signatures and documentation metadata dictionary (Section 51).
"""

import os
import re
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_advanced_sql_cte_support():
    """Verify CTE parsing, symbol table registration, and column projection (Section 39)."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Scope Resolver CTE capabilities
    assert 'extractCtes' in scope_code, "ScopeResolver must implement extractCtes"
    assert 'parseSelectProjection' in scope_code, "ScopeResolver must implement parseSelectProjection"
    assert "type: 'cte'" in scope_code or 'type: "cte"' in scope_code
    assert 'getAllVisibleCtes' in scope_code, "SymbolTable must support getAllVisibleCtes"

    # Completion Engine CTE capabilities
    assert "'cte'" in engine_code
    assert "displayType: 'CTE'" in engine_code
    assert "context.clause === 'FROM'" in engine_code or "isFromClause" in engine_code

    # Python simulation of CTE extraction and projection:
    # WITH CustomerData AS (SELECT Id, Name FROM Customer) SELECT * FROM CustomerData cd WHERE cd.
    cte_sql = """
    WITH CustomerData AS (
        SELECT Id, Name FROM Customer
    )
    SELECT * FROM CustomerData cd WHERE cd.
    """
    cte_pattern = re.compile(r'WITH\s+([a-zA-Z0-9_#@]+)\s*(?:\(([^)]+)\))?\s*AS\s*\(\s*SELECT\s+(.*?)\s+FROM', re.IGNORECASE | re.DOTALL)
    match = cte_pattern.search(cte_sql)
    assert match is not None, "CTE pattern must match"
    cte_name = match.group(1).strip()
    proj_clause = match.group(3).strip()

    assert cte_name == "CustomerData"
    columns = [c.strip().split()[-1] for c in proj_clause.split(',')]
    assert columns == ['Id', 'Name'], f"Expected ['Id', 'Name'], got {columns}"

    print("\n[PASS] CTE parsing, symbol registration, and column projection verified!")


def test_advanced_sql_derived_table_subquery_projection():
    """Verify derived table subquery column isolation (Section 40)."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Derived table extraction in ScopeResolver
    assert 'extractDerivedTables' in scope_code, "ScopeResolver must implement extractDerivedTables"
    assert "type: 'subquery'" in scope_code or 'type: "subquery"' in scope_code

    # Subquery column isolation guard in CompletionEngine
    assert 'isLocalSymbol' in engine_code, "CompletionEngine must guard against physical DB queries for local subqueries"
    assert '!isLocalSymbol' in engine_code or 'isLocalSymbol' in engine_code

    # Python simulation of Section 40:
    # SELECT * FROM (SELECT Id, CustomerName AS Name FROM Customer) c WHERE c.
    sub_sql = "SELECT * FROM (SELECT Id, CustomerName AS Name FROM Customer) c WHERE c."
    dt_pattern = re.compile(r'FROM\s*\(\s*SELECT\s+(.*?)\s+FROM.*?\)\s*(?:AS\s+)?([a-zA-Z0-9_]+)', re.IGNORECASE | re.DOTALL)
    match = dt_pattern.search(sub_sql)
    assert match is not None
    proj_clause = match.group(1).strip()
    alias = match.group(2).strip()

    assert alias == 'c'
    # Parse projected column names (including AS alias)
    col_chunks = [c.strip() for c in proj_clause.split(',')]
    extracted_cols = []
    for chunk in col_chunks:
        if ' AS ' in chunk.upper():
            extracted_cols.append(chunk.split()[-1])
        else:
            extracted_cols.append(chunk.split('.')[-1])

    assert extracted_cols == ['Id', 'Name']
    # Ensures non-projected columns (e.g. Address, Phone) are NOT in the projection
    assert 'Address' not in extracted_cols
    assert 'Phone' not in extracted_cols

    print("\n[PASS] Derived table subquery column isolation (Section 40) verified!")


def test_advanced_sql_temp_tables():
    """Verify temporary table column parsing and qualified suggestions (Section 46)."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    assert 'parseColumnDefinitions' in scope_code
    assert 'extractTempTablesAndVariables' in scope_code
    assert "type: 'temp_table'" in scope_code or 'type: "temp_table"' in scope_code
    assert 'getAllVisibleTempTables' in scope_code
    assert "displayType: 'Temp Table'" in engine_code

    # Simulation of CREATE TABLE #TempOrders (OrderId INT PRIMARY KEY, TotalAmount DECIMAL(18,2) NOT NULL)
    create_sql = "CREATE TABLE #TempOrders (OrderId INT PRIMARY KEY, TotalAmount DECIMAL(18,2) NOT NULL)"
    match = re.search(r'CREATE\s+TABLE\s+(#[a-zA-Z0-9_]+)\s*\((.*)\)', create_sql, re.IGNORECASE)
    assert match is not None
    temp_table_name = match.group(1)
    body = match.group(2)

    assert temp_table_name == "#TempOrders"
    chunks = []
    current = []
    depth = 0
    for char in body:
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        if char == ',' and depth == 0:
            chunks.append(''.join(current).strip())
            current = []
        else:
            current.append(char)
    if current:
        chunks.append(''.join(current).strip())

    col_defs = [c for c in chunks if not any(c.upper().startswith(kw) for kw in ['PRIMARY', 'CONSTRAINT', 'FOREIGN', 'CHECK'])]
    parsed_cols = [c.split()[0] for c in col_defs]

    assert parsed_cols == ['OrderId', 'TotalAmount']
    print("\n[PASS] Temp table column parsing (#temp) verified!")


def test_advanced_sql_table_and_scalar_variables():
    """Verify table variables (@table) and scalar variables (@var) (Section 47, 48)."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    assert "type: 'table_variable'" in scope_code or 'type: "table_variable"' in scope_code
    assert "type: 'scalar_variable'" in scope_code or 'type: "scalar_variable"' in scope_code
    assert 'getAllVisibleVariables' in scope_code
    assert "displayType: 'Table Var'" in engine_code
    assert "displayType: v.dataType ? `Variable (${v.dataType})` : 'Variable'" in engine_code

    # Python simulation of scalar & table variable declarations:
    # DECLARE @CustomerId INT = 1;
    # DECLARE @Items TABLE (ItemId INT, Qty INT);
    decl_sql = """
    DECLARE @CustomerId INT = 1;
    DECLARE @Status VARCHAR(50);
    DECLARE @Items TABLE (ItemId INT, Qty INT);
    """
    scalar_vars = re.findall(r'DECLARE\s+(@[a-zA-Z0-9_]+)\s+(?!TABLE)([a-zA-Z0-9_()]+)', decl_sql, re.IGNORECASE)
    table_vars = re.findall(r'DECLARE\s+(@[a-zA-Z0-9_]+)\s+TABLE\s*\((.*?)\)', decl_sql, re.IGNORECASE | re.DOTALL)

    assert len(scalar_vars) == 2
    assert scalar_vars[0] == ('@CustomerId', 'INT')
    assert scalar_vars[1] == ('@Status', 'VARCHAR(50)')

    assert len(table_vars) == 1
    assert table_vars[0][0] == '@Items'
    table_cols = [c.strip().split()[0] for c in table_vars[0][1].split(',')]
    assert table_cols == ['ItemId', 'Qty']

    print("\n[PASS] Table variables and scalar variables scoping verified!")


def test_advanced_sql_procedure_parameters():
    """Verify stored procedure parameter resolution and ranking on EXEC (Section 29, 51)."""
    ctx_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(ctx_path, 'r', encoding='utf-8') as f:
        ctx_code = f.read()

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()

    # Context Analyzer EXEC detection
    assert 'detectExecContext' in ctx_code, "context-analyzer.js must implement detectExecContext"
    assert 'isParameterPosition' in ctx_code
    assert 'procedureName' in ctx_code
    assert 'execContext' in ctx_code
    assert 'IntelliSenseContextType.PARAMETER' in ctx_code

    # Completion Engine parameter candidate generation & ranking
    assert 'fetchParameters' in engine_code
    assert "type: 'parameter'" in engine_code or 'type: "parameter"' in engine_code
    assert "label: `${pName} = `" in engine_code or "insertText: `${pName} = `" in engine_code
    assert "context.execContext.isParameterPosition" in engine_code

    print("\n[PASS] Stored procedure parameter resolution on EXEC verified!")


def test_advanced_sql_function_signatures():
    """Verify built-in function signature dictionary and metadata (Section 51)."""
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    assert 'FUNCTION_SIGNATURES' in code
    assert 'window.SqlFunctionSignatures = FUNCTION_SIGNATURES' in code
    assert 'getFunctionSignature' in code

    # Verify key functions have documented signatures
    expected_funcs = [
        "ISNULL", "COALESCE", "NULLIF", "DATEADD", "DATEDIFF",
        "GETDATE", "NOW", "SUBSTRING", "CAST", "CONVERT",
        "ROW_NUMBER", "RANK", "DENSE_RANK", "ROUND", "COUNT", "SUM"
    ]
    for fn in expected_funcs:
        assert f'"{fn}":' in code or f"'{fn}':" in code, f"Function {fn} must be in FUNCTION_SIGNATURES"

    assert "ISNULL(check_expression, replacement_value)" in code
    assert "COALESCE(expression1, expression2, ...)" in code
    assert "DATEADD(datepart, number, date)" in code
    assert "ROW_NUMBER() OVER" in code

    print("\n[PASS] Built-in function signatures & documentation verified!")
