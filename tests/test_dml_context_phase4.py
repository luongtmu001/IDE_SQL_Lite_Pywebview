import os
import re
import json
import subprocess
import shutil
import pytest

WORKSPACE_DIR = r"d:\Luong\NB_Personal\Python\IDE-SQL-Lite_New_Pyweb"


def find_browser():
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for p in edge_paths:
        if os.path.exists(p):
            return p
    chrome = shutil.which("chrome")
    if chrome:
        return chrome
    return None


def test_phase4_source_code_integrity():
    """Verify Phase 4 source code implementations in context-analyzer.js, completion-engine.js, and sqlserver.py."""
    ctx_path = os.path.join(WORKSPACE_DIR, "static", "js", "context-analyzer.js")
    with open(ctx_path, "r", encoding="utf-8") as f:
        ctx_content = f.read()

    assert "extractDmlContext" in ctx_content, "context-analyzer.js must define extractDmlContext"
    assert "isInsertColumns" in ctx_content, "context-analyzer.js must detect isInsertColumns"
    assert "isUpdateSet" in ctx_content, "context-analyzer.js must detect isUpdateSet"
    assert "alreadyListed" in ctx_content, "context-analyzer.js must extract alreadyListed"
    assert "extractDmlContext," in ctx_content, "SqlContextAnalyzer must export extractDmlContext"

    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_content = f.read()

    assert "isInsertCols" in eng_content, "completion-engine.js must check isInsertCols"
    assert "is_identity" in eng_content, "completion-engine.js must check is_identity"
    assert "is_computed" in eng_content, "completion-engine.js must check is_computed"
    assert "alreadySet.has" in eng_content, "completion-engine.js must filter alreadyListed columns"

    sqlserver_path = os.path.join(WORKSPACE_DIR, "app", "database", "sqlserver.py")
    with open(sqlserver_path, "r", encoding="utf-8") as f:
        sqlserver_content = f.read()

    assert "c.is_identity," in sqlserver_content, "sqlserver.py must select c.is_identity in sys.columns"
    assert "c.is_computed" in sqlserver_content, "sqlserver.py must select c.is_computed in sys.columns"
    assert '"is_identity": is_identity' in sqlserver_content, "sqlserver.py must return is_identity"


def test_headless_dml_context_phase4():
    """Verify Phase 4 DML filtering (INSERT alreadyListed, identity/computed filtering, UPDATE SET) in Headless Browser."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_phase4_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 4 DML Context Test</title>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/sql-dialects.js"></script>
    <script src="../static/js/context-analyzer.js"></script>
    <script src="../static/js/scope-resolver.js"></script>
    <script src="../static/js/metadata-cache.js"></script>
    <script src="../static/js/completion-engine.js"></script>
</head>
<body>
    <div id="test-output">Running...</div>
    <script>
    (async function() {
        const logs = [];
        try {
            // Mock DataProvider
            const mockDataProvider = {
                fetchColumns: async (connId, db, schema, table) => {
                    if (table.toLowerCase() === 'customers') {
                        return [
                            { name: 'CustomerID', data_type: 'int', is_pk: true, is_identity: true, is_computed: false },
                            { name: 'ComputedTotal', data_type: 'decimal(18,2)', is_pk: false, is_identity: false, is_computed: true },
                            { name: 'RowVer', data_type: 'rowversion', is_pk: false, is_identity: false, is_computed: false },
                            { name: 'CompanyName', data_type: 'nvarchar(50)', is_pk: false, is_identity: false, is_computed: false },
                            { name: 'ContactName', data_type: 'nvarchar(50)', is_pk: false, is_identity: false, is_computed: false },
                            { name: 'City', data_type: 'nvarchar(50)', is_pk: false, is_identity: false, is_computed: false },
                            { name: 'Country', data_type: 'nvarchar(50)', is_pk: false, is_identity: false, is_computed: false }
                        ];
                    }
                    if (table.toLowerCase() === 'b20customer') {
                        return [{ name: 'CustCode', data_type: 'varchar(20)', is_pk: true }];
                    }
                    if (table.toLowerCase() === 'bom') {
                        return [{ name: 'BOMCode', data_type: 'varchar(20)', is_pk: true }];
                    }
                    return [];
                },
                fetchObjects: async (connId, db, schema) => [
                    { name: 'Customers', type: 'table', schema: 'dbo' },
                    { name: 'Orders', type: 'table', schema: 'dbo' }
                ],
                fetchDataTypes: async () => ({ types: ['INT', 'VARCHAR'] })
            };

            const engine = new window.CompletionEngine(mockDataProvider);
            const tabCtx = { connectionId: 'c1', database: 'Northwind', schema: 'dbo', dbType: 'sqlserver' };

            // ── Test 1: INSERT INTO with already listed column ─────────────────
            // SQL: INSERT INTO Customers (CompanyName, |)
            const sql1 = "INSERT INTO Customers (CompanyName, )";
            const cursor1 = 35; // right after ', '
            const ctx1 = window.SqlContextAnalyzer.analyze(sql1, cursor1, tabCtx.dbType);

            logs.push("Test 1 Clause: " + ctx1.clause);
            logs.push("Test 1 isInsertColumns: " + ctx1.isInsertColumns);
            logs.push("Test 1 targetTable: " + (ctx1.targetTable ? ctx1.targetTable.table : 'null'));
            logs.push("Test 1 alreadyListed: " + ctx1.alreadyListed.join(','));

            const cands1 = await engine.generator.generate(ctx1, tabCtx, sql1);
            const ranked1 = engine.ranker.rank(cands1, ctx1, '');
            const names1 = ranked1.map(c => c.name);

            const hasCustomerID_1 = names1.includes('CustomerID');
            const hasComputed_1 = names1.includes('ComputedTotal');
            const hasRowVer_1 = names1.includes('RowVer');
            const hasCompanyName_1 = names1.includes('CompanyName');
            const hasContactName_1 = names1.includes('ContactName');
            const hasCity_1 = names1.includes('City');

            logs.push("Test 1 Has CustomerID (identity, should be false): " + hasCustomerID_1);
            logs.push("Test 1 Has ComputedTotal (computed, should be false): " + hasComputed_1);
            logs.push("Test 1 Has RowVer (rowversion, should be false): " + hasRowVer_1);
            logs.push("Test 1 Has CompanyName (already listed, should be false): " + hasCompanyName_1);
            logs.push("Test 1 Has ContactName (should be true): " + hasContactName_1);
            logs.push("Test 1 Has City (should be true): " + hasCity_1);

            // ── Test 2: INSERT INTO typing partial column ──────────────────────
            // SQL: INSERT INTO Customers (CompanyName, Cont|)
            const sql2 = "INSERT INTO Customers (CompanyName, Cont)";
            const cursor2 = 39; // at end of 'Cont'
            const ctx2 = window.SqlContextAnalyzer.analyze(sql2, cursor2, tabCtx.dbType);

            logs.push("Test 2 currentWord: " + ctx2.currentWord);
            logs.push("Test 2 alreadyListed: " + ctx2.alreadyListed.join(','));

            const cands2 = await engine.generator.generate(ctx2, tabCtx, sql2);
            const filtered2 = engine.filter.filter(cands2, ctx2.currentWord);
            const ranked2 = engine.ranker.rank(filtered2, ctx2, ctx2.currentWord);
            const topItem2 = ranked2[0];

            logs.push("Test 2 Top item: " + (topItem2 ? topItem2.name : 'none'));
            logs.push("Test 2 Top item is ContactName: " + (topItem2 && topItem2.name === 'ContactName'));

            // ── Test 3: UPDATE SET with already assigned column ────────────────
            // SQL: UPDATE Customers SET CompanyName = 'ABC', |
            const sql3 = "UPDATE Customers SET CompanyName = 'ABC', ";
            const cursor3 = sql3.length;
            const ctx3 = window.SqlContextAnalyzer.analyze(sql3, cursor3, tabCtx.dbType);

            logs.push("Test 3 Clause: " + ctx3.clause);
            logs.push("Test 3 isUpdateSet: " + ctx3.isUpdateSet);
            logs.push("Test 3 alreadyListed: " + ctx3.alreadyListed.join(','));

            const cands3 = await engine.generator.generate(ctx3, tabCtx, sql3);
            const ranked3 = engine.ranker.rank(cands3, ctx3, '');
            const names3 = ranked3.map(c => c.name);

            const hasCompanyName_3 = names3.includes('CompanyName');
            const hasContactName_3 = names3.includes('ContactName');
            const hasCustomerID_3 = names3.includes('CustomerID');

            logs.push("Test 3 Has CompanyName (already set, should be false): " + hasCompanyName_3);
            logs.push("Test 3 Has ContactName (should be true): " + hasContactName_3);
            logs.push("Test 3 Has CustomerID (in UPDATE columns can be referenced, should be true): " + hasCustomerID_3);

            // ── Test 4: VALUES clause column index ─────────────────────────────
            // SQL: INSERT INTO Customers (CompanyName, ContactName) VALUES ('ABC', |)
            const sql4 = "INSERT INTO Customers (CompanyName, ContactName) VALUES ('ABC', )";
            const cursor4 = sql4.length - 1; // right after ', '
            const ctx4 = window.SqlContextAnalyzer.analyze(sql4, cursor4, tabCtx.dbType);

            logs.push("Test 4 Clause: " + ctx4.clause);
            logs.push("Test 4 isValues: " + ctx4.isValues);
            logs.push("Test 4 valueColumnIndex: " + ctx4.valueColumnIndex);

            // ── Test 5: Phase 1 & 2 Regressions ────────────────────────────────
            const sqlReg1 = "select * from b20Customer\nselect * from BOM";
            const ctxReg1 = window.SqlContextAnalyzer.analyze(sqlReg1, 10, tabCtx.dbType);
            const tblsReg1 = (ctxReg1.queryTables || []).map(t => t.table.toLowerCase());
            const isIsolated = tblsReg1.includes('b20customer') && !tblsReg1.includes('bom');
            logs.push("Phase 1 regression isolated: " + isIsolated);

            const sqlReg2 = "SELECT [Cus";
            const ctxReg2 = window.SqlContextAnalyzer.analyze(sqlReg2, 11, tabCtx.dbType);
            logs.push("Phase 2 regression isQuoted: " + ctxReg2.isQuotedIdentifier);

            document.getElementById('test-output').innerHTML = logs.join('<br>\n');
        } catch (e) {
            document.getElementById('test-output').innerHTML = "ERROR: " + e.stack;
        }
    })();
    </script>
</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_url = f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}"
    cmd = [
        browser_exe,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        "--virtual-time-budget=3000",
        file_url
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    dom_output = proc.stdout

    print("\n--- Phase 4 In-Browser Test Logs ---")
    match = re.search(r'<div id="test-output">(.*?)</div>', dom_output, re.DOTALL)
    assert match, f"Could not find test-output div in output: {dom_output}"
    inner = match.group(1).replace("<br>", "\n").replace("&gt;", ">").replace("&lt;", "<")
    print(inner)

    assert "ERROR:" not in inner, f"Headless test encountered an error:\n{inner}"

    # Verifications for Test 1 (INSERT column list & non-insertable filters)
    assert "Test 1 isInsertColumns: true" in inner, "Test 1 must detect isInsertColumns"
    assert "Test 1 alreadyListed: companyname" in inner, "Test 1 must extract CompanyName into alreadyListed"
    assert "Test 1 Has CustomerID (identity, should be false): false" in inner, "Identity columns must be filtered from INSERT"
    assert "Test 1 Has ComputedTotal (computed, should be false): false" in inner, "Computed columns must be filtered from INSERT"
    assert "Test 1 Has RowVer (rowversion, should be false): false" in inner, "Rowversion columns must be filtered from INSERT"
    assert "Test 1 Has CompanyName (already listed, should be false): false" in inner, "Already listed columns must be filtered from INSERT"
    assert "Test 1 Has ContactName (should be true): true" in inner, "Remaining columns must be suggested in INSERT"

    # Verifications for Test 2 (INSERT typing partial column)
    assert "Test 2 Top item is ContactName: true" in inner, "Typing 'Cont' must rank ContactName at top"

    # Verifications for Test 3 (UPDATE SET with already assigned column)
    assert "Test 3 isUpdateSet: true" in inner, "Test 3 must detect isUpdateSet"
    assert "Test 3 alreadyListed: companyname" in inner, "Test 3 must detect CompanyName in alreadyListed"
    assert "Test 3 Has CompanyName (already set, should be false): false" in inner, "Already set column must be filtered from UPDATE SET"
    assert "Test 3 Has ContactName (should be true): true" in inner, "Remaining columns must be suggested in UPDATE SET"

    # Verifications for Test 4 (VALUES column index)
    assert "Test 4 isValues: true" in inner, "Test 4 must detect isValues"
    assert "Test 4 valueColumnIndex: 1" in inner, "Test 4 must count comma depth = 1"

    # Regression verifications
    assert "Phase 1 regression isolated: true" in inner, "Phase 1 statement isolation must remain intact"
    assert "Phase 2 regression isQuoted: true" in inner, "Phase 2 quoting must remain intact"
