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


def test_phase4b_source_code_integrity():
    """Verify Phase 4b source code implementations in context-analyzer.js, scope-resolver.js, and completion-engine.js."""
    ctx_path = os.path.join(WORKSPACE_DIR, "static", "js", "context-analyzer.js")
    with open(ctx_path, "r", encoding="utf-8") as f:
        ctx_content = f.read()

    assert "detectRoutineContext" in ctx_content, "context-analyzer.js must define detectRoutineContext"
    assert "RETURNS" in ctx_content and "TRIGGER" in ctx_content, "context-analyzer.js must detect RETURNS TRIGGER"
    assert "triggerTable" in ctx_content, "context-analyzer.js must resolve triggerTable"
    assert "routineContext.isRoutineBody" in ctx_content, "context-analyzer.js must check isRoutineBody"

    scope_path = os.path.join(WORKSPACE_DIR, "static", "js", "scope-resolver.js")
    with open(scope_path, "r", encoding="utf-8") as f:
        scope_content = f.read()

    assert "targetObject" in scope_content, "scope-resolver.js SqlSymbol must support targetObject"
    assert "inserted" in scope_content and "deleted" in scope_content, "scope-resolver.js must register inserted/deleted pseudo-tables"
    assert "NEW" in scope_content and "OLD" in scope_content, "scope-resolver.js must register NEW/OLD pseudo-records"
    assert "TG_OP" in scope_content and "TG_TABLE_NAME" in scope_content, "scope-resolver.js must register PostgreSQL trigger variables"
    assert "pseudo_table" in scope_content, "scope-resolver.js must support pseudo_table type"

    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_content = f.read()

    assert "scopePseudos" in eng_content, "completion-engine.js must generate pseudo_table candidates"
    assert "pseudo_table" in eng_content, "completion-engine.js must prioritize pseudo_table in FROM clause"


def test_headless_routine_context_phase4b():
    """Verify Phase 4b Routine Body IntelliSense (Stored Proc, Function, Trigger) for T-SQL & PostgreSQL in Headless Browser."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_phase4b_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 4b Routine Context Test</title>
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
                    const tbl = (table || '').toLowerCase();
                    if (tbl === 'orders') {
                        return [
                            { name: 'OrderID', data_type: 'int', is_pk: true },
                            { name: 'CustomerID', data_type: 'int', is_pk: false },
                            { name: 'OrderDate', data_type: 'datetime', is_pk: false },
                            { name: 'Freight', data_type: 'decimal(10,2)', is_pk: false }
                        ];
                    }
                    if (tbl === 'customers') {
                        return [
                            { name: 'CustomerID', data_type: 'int', is_pk: true, is_identity: true },
                            { name: 'CompanyName', data_type: 'nvarchar(50)', is_pk: false },
                            { name: 'ContactName', data_type: 'nvarchar(50)', is_pk: false },
                            { name: 'City', data_type: 'nvarchar(50)', is_pk: false }
                        ];
                    }
                    return [];
                },
                fetchObjects: async (connId, db, schema) => [
                    { name: 'Customers', type: 'table', schema: 'dbo' },
                    { name: 'Orders', type: 'table', schema: 'dbo' }
                ],
                fetchDataTypes: async () => ({ types: ['INT', 'VARCHAR', 'NUMERIC', 'DATETIME'] })
            };

            const engine = new window.CompletionEngine(mockDataProvider);
            const tabCtx = { connectionId: 'c1', database: 'Northwind', schema: 'dbo', dbType: 'sqlserver' };

            // ── Test 1: T-SQL Stored Procedure body & parameter inheritance ───────
            const sql1 = "CREATE PROCEDURE dbo.sp_GetCustomerOrders\n    @CustomerID INT,\n    @IncludeInactive BIT = 0\nAS\nBEGIN\n    SELECT @";
            const cursor1 = sql1.length; // right after '@'
            const ctx1 = window.SqlContextAnalyzer.analyze(sql1, cursor1, tabCtx.dbType);

            logs.push("Test 1 isInRoutine: " + ctx1.isInRoutine);
            logs.push("Test 1 isInRoutineBody: " + ctx1.isInRoutineBody);
            logs.push("Test 1 routineType: " + ctx1.routineType);
            logs.push("Test 1 routineName: " + ctx1.routineName);
            logs.push("Test 1 isAlterContext: " + ctx1.isAlterContext);
            logs.push("Test 1 clause: " + ctx1.clause);

            const cands1 = await engine.generator.generate(ctx1, tabCtx, sql1);
            const ranked1 = engine.ranker.rank(cands1, ctx1, '@');
            const names1 = ranked1.map(c => c.name);

            const hasParamCustID_1 = names1.includes('@CustomerID');
            const hasParamInactive_1 = names1.includes('@IncludeInactive');
            logs.push("Test 1 Has @CustomerID: " + hasParamCustID_1);
            logs.push("Test 1 Has @IncludeInactive: " + hasParamInactive_1);

            const filtered1 = engine.filter.filter(cands1, '@Cust');
            const rankedFiltered1 = engine.ranker.rank(filtered1, ctx1, '@Cust');
            logs.push("Test 1 Top item for @Cust: " + (rankedFiltered1.length > 0 ? rankedFiltered1[0].name : 'none'));

            // ── Test 2: T-SQL Trigger pseudo-tables (inserted. and deleted.) ──────
            const sql2 = "CREATE TRIGGER tr_Orders_Audit\nON dbo.Orders\nAFTER INSERT, UPDATE\nAS\nBEGIN\n    SELECT inserted.";
            const cursor2 = sql2.length; // right after '.'
            const ctx2 = window.SqlContextAnalyzer.analyze(sql2, cursor2, tabCtx.dbType);

            logs.push("Test 2 isInRoutine: " + ctx2.isInRoutine);
            logs.push("Test 2 routineType: " + ctx2.routineType);
            logs.push("Test 2 triggerTable: " + (ctx2.triggerTable ? ctx2.triggerTable.table : 'null'));
            logs.push("Test 2 qualifier: " + ctx2.qualifier);
            logs.push("Test 2 resolvedObject: " + (ctx2.resolvedObject ? ctx2.resolvedObject.object : 'null'));

            const cands2 = await engine.generator.generate(ctx2, tabCtx, sql2);
            const names2 = cands2.map(c => c.name);
            logs.push("Test 2 inserted. has OrderID: " + names2.includes('OrderID'));
            logs.push("Test 2 inserted. has CustomerID: " + names2.includes('CustomerID'));
            logs.push("Test 2 inserted. has OrderDate: " + names2.includes('OrderDate'));
            logs.push("Test 2 inserted. has Freight: " + names2.includes('Freight'));

            // Test 2b: deleted. columns
            const sql2b = "CREATE TRIGGER tr_Orders_Audit\nON dbo.Orders\nAFTER INSERT, UPDATE\nAS\nBEGIN\n    SELECT deleted.";
            const ctx2b = window.SqlContextAnalyzer.analyze(sql2b, sql2b.length, tabCtx.dbType);
            const cands2b = await engine.generator.generate(ctx2b, tabCtx, sql2b);
            const names2b = cands2b.map(c => c.name);
            logs.push("Test 2b deleted. has OrderID: " + names2b.includes('OrderID'));

            // Test 2c: FROM clause inside trigger body suggests inserted / deleted
            const sql2c = "CREATE TRIGGER tr_Orders_Audit\nON dbo.Orders\nAFTER INSERT, UPDATE\nAS\nBEGIN\n    SELECT * FROM ";
            const ctx2c = window.SqlContextAnalyzer.analyze(sql2c, sql2c.length, tabCtx.dbType);
            const cands2c = await engine.generator.generate(ctx2c, tabCtx, sql2c);
            const names2c = cands2c.map(c => c.name.toLowerCase());
            logs.push("Test 2c FROM suggests inserted: " + names2c.includes('inserted'));
            logs.push("Test 2c FROM suggests deleted: " + names2c.includes('deleted'));

            // ── Test 3: PostgreSQL PL/pgSQL Function with DECLARE variables ──────
            const tabCtxPg = { connectionId: 'c2', database: 'postgres', schema: 'public', dbType: 'postgresql' };
            const sql3 = "CREATE OR REPLACE FUNCTION process_sales(p_id INT, p_year INT)\nRETURNS NUMERIC AS $$\nDECLARE\n    v_count INT := 0;\n    v_rate NUMERIC(10, 2) := 0.05;\nBEGIN\n    SELECT v_";
            const cursor3 = sql3.length;
            const ctx3 = window.SqlContextAnalyzer.analyze(sql3, cursor3, tabCtxPg.dbType);

            logs.push("Test 3 isInRoutineBody: " + ctx3.isInRoutineBody);
            const vars3 = (ctx3.localVariables || []).map(v => v.name);
            logs.push("Test 3 localVariables has v_count: " + vars3.includes('v_count'));
            logs.push("Test 3 localVariables has v_rate: " + vars3.includes('v_rate'));
            logs.push("Test 3 localVariables has p_id: " + vars3.includes('p_id'));

            const cands3 = await engine.generator.generate(ctx3, tabCtxPg, sql3);
            const filtered3 = engine.filter.filter(cands3, 'v_');
            const names3 = filtered3.map(c => c.name);
            logs.push("Test 3 filtered for v_ has v_count: " + names3.includes('v_count'));
            logs.push("Test 3 filtered for v_ has v_rate: " + names3.includes('v_rate'));

            // ── Test 4: PostgreSQL Trigger with NEW. and OLD. and TG_* variables ───
            const sql4 = "CREATE TRIGGER tr_cust_audit\nAFTER UPDATE ON dbo.Customers\nFOR EACH ROW\nEXECUTE FUNCTION tr_cust_func();\n\nCREATE OR REPLACE FUNCTION tr_cust_func()\nRETURNS TRIGGER AS $$\nBEGIN\n    SELECT NEW.";
            const cursor4 = sql4.length;
            const ctx4 = window.SqlContextAnalyzer.analyze(sql4, cursor4, tabCtxPg.dbType);

            logs.push("Test 4 routineType: " + ctx4.routineType);
            logs.push("Test 4 triggerTable: " + (ctx4.triggerTable ? ctx4.triggerTable.table : 'null'));
            logs.push("Test 4 qualifier: " + ctx4.qualifier);
            logs.push("Test 4 resolvedObject: " + (ctx4.resolvedObject ? ctx4.resolvedObject.object : 'null'));

            const cands4 = await engine.generator.generate(ctx4, tabCtxPg, sql4);
            const names4 = cands4.map(c => c.name);
            logs.push("Test 4 NEW. has CustomerID: " + names4.includes('CustomerID'));
            logs.push("Test 4 NEW. has CompanyName: " + names4.includes('CompanyName'));
            logs.push("Test 4 NEW. has ContactName: " + names4.includes('ContactName'));

            const vars4 = (ctx4.localVariables || []).map(v => v.name);
            logs.push("Test 4 has TG_OP: " + vars4.includes('TG_OP'));
            logs.push("Test 4 has TG_TABLE_NAME: " + vars4.includes('TG_TABLE_NAME'));

            // ── Test 5: Regressions Check (Phase 1, 2, 3, 4) ──────────────────────
            // Phase 1: Statement isolation
            const sqlReg1 = "SELECT 1;\nSELECT ";
            const ctxReg1 = window.SqlContextAnalyzer.analyze(sqlReg1, sqlReg1.length, tabCtx.dbType);
            logs.push("Phase 1 regression isolated: " + (ctxReg1.statementRange.start > 0));

            // Phase 2: Identifier quoting
            const sqlReg2 = "SELECT [Cus";
            const ctxReg2 = window.SqlContextAnalyzer.analyze(sqlReg2, 11, tabCtx.dbType);
            logs.push("Phase 2 regression isQuoted: " + ctxReg2.isQuotedIdentifier);

            // Phase 3: Forward FROM scan
            const sqlReg3 = "SELECT \nFROM Customers c";
            const ctxReg3 = window.SqlContextAnalyzer.analyze(sqlReg3, 7, tabCtx.dbType);
            logs.push("Phase 3 regression forward alias c: " + Boolean(ctxReg3.aliasMap && ctxReg3.aliasMap['c']));

            // Phase 4: INSERT alreadyListed filtering
            const sqlReg4 = "INSERT INTO Customers (CompanyName, )";
            const ctxReg4 = window.SqlContextAnalyzer.analyze(sqlReg4, 35, tabCtx.dbType);
            logs.push("Phase 4 regression alreadyListed: " + ctxReg4.alreadyListed.includes('companyname'));

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

    print("\n--- Phase 4b In-Browser Test Logs ---")
    match = re.search(r'<div id="test-output">(.*?)</div>', dom_output, re.DOTALL)
    assert match, f"Could not find test-output div in output: {dom_output}"
    inner = match.group(1).replace("<br>", "\n").replace("&gt;", ">").replace("&lt;", "<")
    print(inner)

    assert "ERROR:" not in inner, f"Headless test encountered an error:\n{inner}"

    # Verifications for Test 1: T-SQL Stored Procedure
    assert "Test 1 isInRoutine: true" in inner, "Test 1 must detect isInRoutine"
    assert "Test 1 isInRoutineBody: true" in inner, "Test 1 must detect isInRoutineBody"
    assert "Test 1 routineType: procedure" in inner, "Test 1 must detect routineType = procedure"
    assert "Test 1 routineName: sp_GetCustomerOrders" in inner, "Test 1 must detect routineName = sp_GetCustomerOrders"
    assert "Test 1 isAlterContext: false" in inner, "Test 1 must suppress isAlterContext inside routine body"
    assert "Test 1 clause: SELECT" in inner, "Test 1 must detect clause = SELECT"
    assert "Test 1 Has @CustomerID: true" in inner, "Test 1 must extract parameter @CustomerID"
    assert "Test 1 Has @IncludeInactive: true" in inner, "Test 1 must extract parameter @IncludeInactive"
    assert "Test 1 Top item for @Cust: @CustomerID" in inner, "Typing @Cust must rank @CustomerID at top"

    # Verifications for Test 2: T-SQL Trigger pseudo-tables
    assert "Test 2 isInRoutine: true" in inner, "Test 2 must detect isInRoutine"
    assert "Test 2 routineType: trigger" in inner, "Test 2 must detect routineType = trigger"
    assert "Test 2 triggerTable: Orders" in inner, "Test 2 must extract triggerTable = Orders"
    assert "Test 2 qualifier: inserted" in inner, "Test 2 must detect qualifier = inserted"
    assert "Test 2 resolvedObject: Orders" in inner, "Test 2 must resolve inserted to Orders"
    assert "Test 2 inserted. has OrderID: true" in inner, "inserted. must suggest OrderID"
    assert "Test 2 inserted. has CustomerID: true" in inner, "inserted. must suggest CustomerID"
    assert "Test 2 inserted. has OrderDate: true" in inner, "inserted. must suggest OrderDate"
    assert "Test 2 inserted. has Freight: true" in inner, "inserted. must suggest Freight"
    assert "Test 2b deleted. has OrderID: true" in inner, "deleted. must suggest OrderID"
    assert "Test 2c FROM suggests inserted: true" in inner, "FROM clause must suggest inserted pseudo-table"
    assert "Test 2c FROM suggests deleted: true" in inner, "FROM clause must suggest deleted pseudo-table"

    # Verifications for Test 3: PostgreSQL Function with DECLARE
    assert "Test 3 isInRoutineBody: true" in inner, "Test 3 must detect isInRoutineBody"
    assert "Test 3 localVariables has v_count: true" in inner, "Test 3 must extract DECLARE variable v_count"
    assert "Test 3 localVariables has v_rate: true" in inner, "Test 3 must extract DECLARE variable v_rate"
    assert "Test 3 localVariables has p_id: true" in inner, "Test 3 must extract parameter p_id"
    assert "Test 3 filtered for v_ has v_count: true" in inner, "Typing v_ must suggest v_count"
    assert "Test 3 filtered for v_ has v_rate: true" in inner, "Typing v_ must suggest v_rate"

    # Verifications for Test 4: PostgreSQL Trigger with NEW. and OLD.
    assert "Test 4 routineType: trigger" in inner, "Test 4 must detect routineType = trigger"
    assert "Test 4 triggerTable: Customers" in inner, "Test 4 must resolve triggerTable = Customers"
    assert "Test 4 qualifier: NEW" in inner, "Test 4 must detect qualifier = NEW"
    assert "Test 4 resolvedObject: Customers" in inner, "Test 4 must resolve NEW to Customers"
    assert "Test 4 NEW. has CustomerID: true" in inner, "NEW. must suggest CustomerID"
    assert "Test 4 NEW. has CompanyName: true" in inner, "NEW. must suggest CompanyName"
    assert "Test 4 NEW. has ContactName: true" in inner, "NEW. must suggest ContactName"
    assert "Test 4 has TG_OP: true" in inner, "PostgreSQL trigger scope must have TG_OP"
    assert "Test 4 has TG_TABLE_NAME: true" in inner, "PostgreSQL trigger scope must have TG_TABLE_NAME"

    # Verifications for Regressions (Phases 1-4)
    assert "Phase 1 regression isolated: true" in inner, "Phase 1 statement isolation must remain intact"
    assert "Phase 2 regression isQuoted: true" in inner, "Phase 2 quoting must remain intact"
    assert "Phase 3 regression forward alias c: true" in inner, "Phase 3 forward alias must remain intact"
    assert "Phase 4 regression alreadyListed: true" in inner, "Phase 4 alreadyListed must remain intact"


def test_headless_user_reported_issues_fix():
    """Verify specific fixes for user-reported issues:
    1. PostgreSQL: IntelliSense in function/procedure/trigger (trigger NEW. without ON table, parameters, and routine body statements).
    2. SQL Server: Temp table (#temp) suggestions in procedures with SET NOCOUNT ON, no bare '#' symbol, and variable completions.
    """
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_user_reported_fixes_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>User Reported Issues Fix Test</title>
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
            const mockDataProvider = {
                fetchColumns: async (connId, db, schema, table) => {
                    const tbl = (table || '').toLowerCase();
                    if (tbl === 'employees') return [{ name: 'emp_id', data_type: 'int' }, { name: 'salary', data_type: 'numeric' }];
                    return [];
                },
                fetchObjects: async () => [
                    { name: 'accounts', type: 'table', schema: 'public' },
                    { name: 'employees', type: 'table', schema: 'public' }
                ],
                fetchDataTypes: async () => ({ types: ['INT', 'NUMERIC'] })
            };
            const engine = new window.CompletionEngine(mockDataProvider);

            // 1. PostgreSQL Standalone Trigger Function NEW.
            const pgSql = `CREATE OR REPLACE FUNCTION check_emp_salary()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.salary < 0 THEN
        RAISE EXCEPTION 'Negative salary';
    END IF;
    RETURN NEW;
END;
$$;`;
            const sqlPgTrg = pgSql.replace('NEW.salary', 'NEW.');
            const idxPgTrg = sqlPgTrg.indexOf('NEW.') + 'NEW.'.length;
            const ctxPgTrg = window.SqlContextAnalyzer.analyze(sqlPgTrg, idxPgTrg, 'postgresql');
            const candsPgTrg = await engine.getCompletions(sqlPgTrg, { line: 5, ch: 11 }, ctxPgTrg, { connectionId: 'c1', database: 'pg', schema: 'public', dbType: 'postgresql' });
            const pgNames = (candsPgTrg || []).map(c => c.name);
            logs.push("PG Trigger NEW. has salary: " + pgNames.includes('salary'));
            logs.push("PG Trigger NEW. has emp_id: " + pgNames.includes('emp_id'));

            // 2. SQL Server Procedure with SET NOCOUNT ON and Temp Table #
            const ssSql = `CREATE PROCEDURE dbo.sp_ProcessOrders
    @StartDate DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    CREATE TABLE #TempOrders (
        OrderID INT,
        OrderDate DATETIME
    );

    SELECT *
    FROM #
END`;
            const idxSS = ssSql.indexOf('FROM #') + 'FROM #'.length;
            const ctxSS = window.SqlContextAnalyzer.analyze(ssSql, idxSS, 'sqlserver');
            const candsSS = await engine.getCompletions(ssSql, { line: 12, ch: 10 }, ctxSS, { connectionId: 'c2', database: 'db', schema: 'dbo', dbType: 'sqlserver' });
            const ssNames = (candsSS || []).map(c => c.name);
            logs.push("SS TempTable suggested: " + ssNames.includes('#TempOrders'));
            logs.push("SS No bare hash: " + (!ssNames.includes('#')));
            logs.push("SS Clause is FROM: " + (ctxSS.clause === 'FROM'));

            // 3. SQL Server Procedure variable completion @
            const ssSqlVar = `CREATE PROCEDURE dbo.sp_Params
    @ID INT,
    @Name VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON
    SELECT @
END`;
            const idxSSVar = ssSqlVar.indexOf('SELECT @') + 'SELECT @'.length;
            const ctxSSVar = window.SqlContextAnalyzer.analyze(ssSqlVar, idxSSVar, 'sqlserver');
            const candsSSVar = await engine.getCompletions(ssSqlVar, { line: 6, ch: 12 }, ctxSSVar, { connectionId: 'c2', database: 'db', schema: 'dbo', dbType: 'sqlserver' });
            const ssVarNames = (candsSSVar || []).map(c => c.name);
            logs.push("SS Variable has @ID: " + ssVarNames.includes('@ID'));
            logs.push("SS Variable has @Name: " + ssVarNames.includes('@Name'));
            logs.push("SS Clause not corrupted by SET NOCOUNT ON: " + (ctxSSVar.clause === 'SELECT'));

            document.getElementById('test-output').innerHTML = logs.join('<br>\n');
        } catch(e) {
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

    match = re.search(r'<div id="test-output">(.*?)</div>', dom_output, re.DOTALL)
    assert match, f"Could not find test-output div in output: {dom_output}"
    inner = match.group(1).replace("<br>", "\n").replace("&gt;", ">").replace("&lt;", "<")
    print("\n--- User Reported Issues Fix Test Logs ---")
    print(inner)

    assert "ERROR:" not in inner, f"Headless test encountered an error:\n{inner}"
    assert "PG Trigger NEW. has salary: true" in inner
    assert "PG Trigger NEW. has emp_id: true" in inner
    assert "SS TempTable suggested: true" in inner
    assert "SS No bare hash: true" in inner
    assert "SS Clause is FROM: true" in inner
    assert "SS Variable has @ID: true" in inner
    assert "SS Variable has @Name: true" in inner
    assert "SS Clause not corrupted by SET NOCOUNT ON: true" in inner

