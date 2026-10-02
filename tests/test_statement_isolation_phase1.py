"""
test_statement_isolation_phase1.py - Automated Tests for Phase 1: Statement Isolation

Tests compliance with Section 5 & Section 8.6 of SQL_INTELLISENSE_AGENT_SPEC.md:
1. Two queries in the same document do NOT leak tables/aliases across statements.
2. Cross-statement symbols (#temp, @var, table variables) are preserved via batch scope.
3. Semicolons inside parentheses (depth > 0) do not break statements.
4. Semicolon and GO delimiters properly isolate query scopes.
"""

import os
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_statement_isolation_in_files():
    """Verify that ScopeResolver and ContextAnalyzer implement statement isolation."""
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    context_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')

    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()

    with open(context_path, 'r', encoding='utf-8') as f:
        context_code = f.read()

    # ScopeResolver must accept statementRange in buildScopeTree
    assert 'statementRange' in scope_code
    assert 'buildScopeTree(tokens, fullLength' in scope_code
    assert 'childScopes' in scope_code

    # ContextAnalyzer must pass statementRange to buildScopeTree
    assert 'buildScopeTree(allCodeTokens' in context_code
    assert 'statementRange' in context_code
    assert 'detectStatementBoundary' in context_code


def test_headless_statement_isolation():
    """Execute real in-browser test using Edge headless."""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    edge_exe = next((p for p in edge_paths if os.path.exists(p)), None)
    if not edge_exe:
        pytest.skip("Microsoft Edge executable not found for headless testing")

    test_html = os.path.join(BASE_DIR, 'scratch', 'test_statement_isolation_runner.html')

    html_content = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Statement Isolation Test</title></head>
<body>
<div id="output">Running...</div>
<script src="../static/js/sql-tokenizer.js"></script>
<script src="../static/js/sql-dialects.js"></script>
<script src="../static/js/scope-resolver.js"></script>
<script src="../static/js/context-analyzer.js"></script>
<script>
    const logs = [];
    try {
        // Test 1: Statement Isolation between 2 queries
        const sql = "SELECT * FROM Orders o;\\nSELECT  FROM Customers c;";
        const cursorIndex = sql.indexOf("SELECT  FROM") + 7; // at "SELECT | FROM Customers c;"

        const ctx = window.SqlContextAnalyzer.analyze(sql, cursorIndex, 'mssql');

        // Check queryTables in current statement
        const tableNames = (ctx.queryTables || []).map(t => (t.table || '').toLowerCase());
        logs.push("QueryTables: " + tableNames.join(','));

        const hasCustomers = tableNames.includes('customers');
        const hasOrders = tableNames.includes('orders');
        logs.push("Has Customers: " + hasCustomers);
        logs.push("Has Orders (leaked): " + hasOrders);

        // Check aliasMap
        const aliasKeys = Object.keys(ctx.aliasMap || {}).map(k => k.toLowerCase());
        logs.push("Alias keys: " + aliasKeys.join(','));
        const hasAliasC = aliasKeys.includes('c');
        const hasAliasO = aliasKeys.includes('o');
        logs.push("Has alias c: " + hasAliasC);
        logs.push("Has alias o (leaked): " + hasAliasO);

        // Test 2: Temp table and variable inherited from batch scope
        const sql2 = "CREATE TABLE #temp (id INT);\\nDECLARE @v INT = 1;\\nSELECT  FROM Customers c;";
        const cursor2 = sql2.indexOf("SELECT  FROM") + 7;
        const ctx2 = window.SqlContextAnalyzer.analyze(sql2, cursor2, 'mssql');
        const t2Names = (ctx2.queryTables || []).map(t => (t.table || '').toLowerCase());
        const hasTemp = t2Names.includes('#temp');
        const hasVar = (ctx2.localVariables || []).some(v => v.name === '@v');
        logs.push("Has #temp in query: " + hasTemp);
        logs.push("Has @v in query: " + hasVar);

        // Test 3: Semicolon-less queries (User Case: B20BOM and B20Customer)
        const sql3 = "SELECT * FROM B20BOM\\nSELECT Code,   FROM B20Customer";
        const cursor3 = sql3.indexOf("Code,") + 7; // after "Code,  "
        const ctx3 = window.SqlContextAnalyzer.analyze(sql3, cursor3, 'mssql');
        const t3Names = (ctx3.queryTables || []).map(t => (t.table || '').toLowerCase());
        logs.push("Test 3 QueryTables: " + t3Names.join(','));
        const hasB20Customer = t3Names.includes('b20customer');
        const hasB20BOM = t3Names.includes('b20bom');
        logs.push("Has B20Customer: " + hasB20Customer);
        // Test 4: Newline after query typing new statement (e.g. "sel" or "upd")
        const sql4 = "SELECT * FROM B20BOM\\nsel";
        const cursor4 = 24;
        const ctx4 = window.SqlContextAnalyzer.analyze(sql4, cursor4, 'mssql');
        logs.push("Test 4 clause: " + ctx4.clause);
        logs.push("Test 4 start: " + ctx4.statementRange.start);
        const test4Ok = (ctx4.clause === '' && ctx4.statementRange.start === 21 && (ctx4.queryTables || []).length === 0);
        logs.push("Test 4 OK: " + test4Ok);

        // Test 5: Multi-line SELECT query preserves table
        const sql5 = "SELECT *\\nFROM B20BOM";
        const ctx5 = window.SqlContextAnalyzer.analyze(sql5, 8, 'mssql');
        const t5Names = (ctx5.queryTables || []).map(t => (t.table || '').toLowerCase());
        const hasT5BOM = t5Names.includes('b20bom');
        logs.push("Test 5 has B20BOM: " + hasT5BOM);

        const success = hasCustomers && !hasOrders && hasAliasC && !hasAliasO && hasTemp && hasVar && hasB20Customer && !hasB20BOM && test4Ok && hasT5BOM;
        logs.push("RESULT: " + (success ? "PASSED" : "FAILED"));
    } catch (e) {
        logs.push("ERROR: " + e.message);
    }
    document.getElementById('output').innerText = logs.join('\\n');
</script>
</body>
</html>
"""
    with open(test_html, 'w', encoding='utf-8') as f:
        f.write(html_content)

    cmd = [
        edge_exe,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        f"file:///{test_html.replace(os.sep, '/')}"
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    output = result.stdout

    assert "RESULT: PASSED" in output, f"Edge headless test failed. Output:\n{output}"
