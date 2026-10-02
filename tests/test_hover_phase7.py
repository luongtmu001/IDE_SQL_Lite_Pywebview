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


def test_phase7_source_code_integrity():
    """Verify Phase 7 Hover Resolver and Monaco provider registrations in source code."""
    # 1. completion-engine.js checks
    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_code = f.read()

    assert "SqlHoverResolver" in eng_code, "SqlHoverResolver class must exist in completion-engine.js"
    assert "registerMonacoProvider" in eng_code, "registerMonacoProvider method must exist"
    assert "registerHoverProvider" in eng_code, "Must register hover provider with monaco"
    assert "window.SqlHoverResolver" in eng_code, "Must export window.SqlHoverResolver"
    assert "static getHover" in eng_code, "CompletionEngine must have static getHover"
    assert "getHover(" in eng_code, "CompletionEngine instance must have getHover"

    # 2. intellisense.js checks
    is_path = os.path.join(WORKSPACE_DIR, "static", "js", "intellisense.js")
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    assert "SqlHoverResolver" in is_code, "intellisense.js must coordinate with SqlHoverResolver"
    assert "getHoverInfo" in is_code, "AppIntelliSense must expose getHoverInfo API"

    # 3. monaco-sql-lang.js checks
    sql_lang_path = os.path.join(WORKSPACE_DIR, "static", "js", "monaco-sql-lang.js")
    with open(sql_lang_path, "r", encoding="utf-8") as f:
        lang_code = f.read()

    assert "SqlHoverResolver" in lang_code, "monaco-sql-lang.js must hook into SqlHoverResolver"


def test_phase7_headless_hover_evaluation():
    """Verify Phase 7 column metadata, table info, alias mapping, functions, and FK details in headless browser."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_phase7_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 7 Hover Provider Test</title>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/sql-dialects.js"></script>
    <script src="../static/js/scope-resolver.js"></script>
    <script src="../static/js/context-analyzer.js"></script>
    <script src="../static/js/metadata-cache.js"></script>
    <script src="../static/js/completion-engine.js"></script>
    <script src="../static/js/editor-adapter.js"></script>
    <script src="../static/js/intellisense.js"></script>
</head>
<body>
    <div id="test-output">Running...</div>
    <script>
    (async function() {
        const results = {};
        const hoverResolver = window.SqlHoverResolver;
        const cache = window.AppMetadataCache;

        try {
            // Setup Catalog Metadata & Cache
            const connId = 'conn_test';
            const db = 'SalesDB';
            const schema = 'dbo';
            const tabCtx = { connectionId: connId, database: db, schema: schema, dbType: 'sqlserver' };

            // Customers table columns
            cache.setColumns(connId, db, schema, 'Customers', [
                { name: 'CustomerId', data_type: 'int', is_pk: true, is_nullable: false, comment: 'Primary identifier' },
                { name: 'CompanyName', data_type: 'nvarchar(100)', is_pk: false, is_nullable: false },
                { name: 'City', data_type: 'nvarchar(50)', is_pk: false, is_nullable: true, default_value: "'Hanoi'" }
            ]);

            // Orders table columns
            cache.setColumns(connId, db, schema, 'Orders', [
                { name: 'OrderId', data_type: 'int', is_pk: true, is_nullable: false },
                { name: 'CustomerId', data_type: 'int', is_pk: false, is_fk: true, is_nullable: false },
                { name: 'OrderDate', data_type: 'datetime', is_pk: false, is_nullable: true }
            ]);

            // Foreign keys
            cache.setForeignKeys(connId, db, schema, 'Orders', [
                { column: 'CustomerId', target_table: 'Customers', target_column: 'CustomerId', constraint_name: 'FK_Orders_Customers' }
            ]);

            // Objects in schema
            cache.setObjects(connId, db, schema, [
                { name: 'Customers', schema: 'dbo', type: 'table' },
                { name: 'Orders', schema: 'dbo', type: 'table' },
                { name: 'vw_RecentOrders', schema: 'dbo', type: 'view' }
            ]);

            // Mock DataProvider for Stored Procedures
            const mockDataProvider = {
                async fetchColumns(c, d, s, t) { return cache.getColumns(c, d, s, t) || []; },
                async fetchForeignKeys(c, d, s, t) { return cache.getForeignKeys(c, d, s, t) || []; },
                async fetchParameters(c, d, s, name) {
                    if ((name || '').toUpperCase() === 'USP_GETCUSTOMERORDERS') {
                        return [
                            { name: '@CustomerId', data_type: 'int', is_output: false },
                            { name: '@FromDate', data_type: 'datetime', is_output: false }
                        ];
                    }
                    return [];
                }
            };
            hoverResolver.setDataProvider(mockDataProvider);
            hoverResolver.setMetadataCache(cache);
            hoverResolver.setTabContext(tabCtx);

            // Test 1: Hover over qualified column c.CustomerId in SELECT c.CustomerId FROM Customers c
            const sql1 = "SELECT c.CustomerId FROM Customers c";
            const offset1 = sql1.indexOf("CustomerId") + 2; // inside "CustomerId"
            const res1 = await hoverResolver.resolve(sql1, offset1, tabCtx);
            results.test1_qualified_column = {
                hasResult: Boolean(res1 && res1.contents),
                content: res1 ? res1.contents[0].value : ""
            };

            // Test 2: Hover over table alias c in SELECT c.CustomerId FROM Customers c
            const offset2 = sql1.indexOf("c.Customer") ; // on "c"
            const res2 = await hoverResolver.resolve(sql1, offset2, tabCtx);
            results.test2_alias = {
                hasResult: Boolean(res2 && res2.contents),
                content: res2 ? res2.contents[0].value : ""
            };

            // Test 3: Hover over Table name Customers in FROM Customers c
            const offset3 = sql1.indexOf("Customers c") + 3; // on "Customers"
            const res3 = await hoverResolver.resolve(sql1, offset3, tabCtx);
            results.test3_table = {
                hasResult: Boolean(res3 && res3.contents),
                content: res3 ? res3.contents[0].value : ""
            };

            // Test 4: Hover over unqualified column in multi-table query: SELECT OrderId FROM Orders o JOIN Customers c ON o.CustomerId = c.CustomerId
            const sql4 = "SELECT OrderId FROM Orders o JOIN Customers c ON o.CustomerId = c.CustomerId";
            const offset4 = sql4.indexOf("OrderId") + 2;
            const res4 = await hoverResolver.resolve(sql4, offset4, tabCtx);
            results.test4_unqualified_column = {
                hasResult: Boolean(res4 && res4.contents),
                content: res4 ? res4.contents[0].value : ""
            };

            // Test 5: Hover over column with Foreign Key constraint (o.CustomerId)
            const sql5 = "SELECT o.CustomerId FROM Orders o";
            const offset5 = sql5.indexOf("CustomerId") + 2;
            const res5 = await hoverResolver.resolve(sql5, offset5, tabCtx);
            results.test5_fk_column = {
                hasResult: Boolean(res5 && res5.contents),
                content: res5 ? res5.contents[0].value : ""
            };

            // Test 6: Hover over built-in function DATEADD in SELECT DATEADD(day, 1, GETDATE())
            const sql6 = "SELECT DATEADD(day, 1, GETDATE())";
            const offset6 = sql6.indexOf("DATEADD") + 2;
            const res6 = await hoverResolver.resolve(sql6, offset6, tabCtx);
            results.test6_builtin_function = {
                hasResult: Boolean(res6 && res6.contents),
                content: res6 ? res6.contents[0].value : ""
            };

            // Test 7: Hover over stored procedure in EXEC dbo.usp_GetCustomerOrders 10
            const sql7 = "EXEC dbo.usp_GetCustomerOrders 10";
            const offset7 = sql7.indexOf("usp_GetCustomerOrders") + 2;
            const res7 = await hoverResolver.resolve(sql7, offset7, tabCtx);
            results.test7_stored_procedure = {
                hasResult: Boolean(res7 && res7.contents),
                content: res7 ? res7.contents[0].value : ""
            };

            // Test 8: Hover over variable in DECLARE @Counter int; SELECT @Counter
            const sql8 = "DECLARE @Counter int; SELECT @Counter";
            const offset8 = sql8.lastIndexOf("@Counter") + 2;
            const res8 = await hoverResolver.resolve(sql8, offset8, tabCtx);
            results.test8_variable = {
                hasResult: Boolean(res8 && res8.contents),
                content: res8 ? res8.contents[0].value : ""
            };

            // Test 9: Noise guards - whitespace, comment, string, operator
            const sql9 = "SELECT 'hello' -- comment \n + 10";
            const res9_str = await hoverResolver.resolve(sql9, sql9.indexOf("hello"), tabCtx);
            const res9_comm = await hoverResolver.resolve(sql9, sql9.indexOf("comment"), tabCtx);
            const res9_op = await hoverResolver.resolve(sql9, sql9.indexOf("+"), tabCtx);
            const res9_ws = await hoverResolver.resolve(sql9, sql9.indexOf(" "), tabCtx);
            results.test9_guards = {
                stringIsNull: (res9_str === null),
                commentIsNull: (res9_comm === null),
                operatorIsNull: (res9_op === null),
                whitespaceIsNull: (res9_ws === null)
            };

            // Test 10: Monaco registerHoverProvider integration
            let registeredHoverProvider = null;
            window.monaco = {
                languages: {
                    registerHoverProvider(langId, provider) {
                        registeredHoverProvider = provider;
                        return { dispose: () => {} };
                    }
                },
                Range: function(sl, sc, el, ec) {
                    this.startLineNumber = sl;
                    this.startColumn = sc;
                    this.endLineNumber = el;
                    this.endColumn = ec;
                }
            };
            window._sqlHoverProviderRegistered = false;
            window.SqlHoverResolver.constructor.registerMonacoProvider();

            const mockModel = {
                getValue: () => "SELECT c.CustomerId FROM Customers c",
                getOffsetAt: () => 11
            };
            const monacoHoverRes = await registeredHoverProvider.provideHover(mockModel, { lineNumber: 1, column: 12 });
            results.test10_monaco_provider = {
                isRegistered: Boolean(registeredHoverProvider),
                hasRange: Boolean(monacoHoverRes && monacoHoverRes.range),
                hasContents: Boolean(monacoHoverRes && monacoHoverRes.contents && monacoHoverRes.contents.length > 0),
                content: monacoHoverRes ? monacoHoverRes.contents[0].value : ""
            };

            // Test 11: Facades
            const res11_app = await window.AppIntelliSense.getHoverInfo(sql1, offset1, tabCtx);
            const res11_engine = await window.CompletionEngine.getHover(sql1, offset1, tabCtx);
            results.test11_facades = {
                appMatches: Boolean(res11_app && res11_app.contents.length > 0),
                engineMatches: Boolean(res11_engine && res11_engine.contents.length > 0)
            };

            document.getElementById('test-output').textContent = JSON.stringify(results);
        } catch (err) {
            document.getElementById('test-output').textContent = JSON.stringify({ error: err.message, stack: err.stack });
        }
    })();
    </script>
</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_url = "file:///" + html_path.replace("\\", "/")

    # Run browser headless
    cmd = [
        browser_exe,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-web-security",
        "--allow-file-access-from-files",
        "--dump-dom",
        file_url
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
    output = proc.stdout

    # Extract JSON inside <div id="test-output">...</div>
    match = re.search(r'<div id="test-output">(.*?)</div>', output, re.DOTALL)
    assert match, f"Could not find test-output in browser DOM. Output:\n{output}"

    data_str = match.group(1).strip()
    data = json.loads(data_str)
    assert "error" not in data, f"JavaScript runtime error: {data.get('error')} \n {data.get('stack')}"

    # Verify Test 1: Qualified column
    t1 = data["test1_qualified_column"]
    assert t1["hasResult"] is True
    assert "Customers.CustomerId" in t1["content"]
    assert "int" in t1["content"]
    assert "[PK]" in t1["content"]
    assert "NOT NULL" in t1["content"]

    # Verify Test 2: Alias
    t2 = data["test2_alias"]
    assert t2["hasResult"] is True
    assert "(Alias) c" in t2["content"]
    assert "Customers" in t2["content"]

    # Verify Test 3: Table
    t3 = data["test3_table"]
    assert t3["hasResult"] is True
    assert "(Table)" in t3["content"]
    assert "Customers" in t3["content"]
    assert "Columns (3)" in t3["content"]
    assert "Primary Key: `CustomerId`" in t3["content"]

    # Verify Test 4: Unqualified column
    t4 = data["test4_unqualified_column"]
    assert t4["hasResult"] is True
    assert "Orders.OrderId" in t4["content"]
    assert "int" in t4["content"]
    assert "[PK]" in t4["content"]

    # Verify Test 5: Foreign key column
    t5 = data["test5_fk_column"]
    assert t5["hasResult"] is True
    assert "Orders.CustomerId" in t5["content"]
    assert "[FK]" in t5["content"]
    assert "Foreign Key → [Customers].[CustomerId]" in t5["content"]

    # Verify Test 6: Built-in function
    t6 = data["test6_builtin_function"]
    assert t6["hasResult"] is True
    assert "DATEADD(datepart, number, date)" in t6["content"]
    assert "Built-in SQL Function" in t6["content"]

    # Verify Test 7: Stored procedure
    t7 = data["test7_stored_procedure"]
    assert t7["hasResult"] is True
    assert "EXEC dbo.usp_GetCustomerOrders" in t7["content"]
    assert "Stored Procedure" in t7["content"]

    # Verify Test 8: Variable
    t8 = data["test8_variable"]
    assert t8["hasResult"] is True
    assert "(Variable) @Counter" in t8["content"]

    # Verify Test 9: Guards
    t9 = data["test9_guards"]
    assert t9["stringIsNull"] is True
    assert t9["commentIsNull"] is True
    assert t9["operatorIsNull"] is True
    assert t9["whitespaceIsNull"] is True

    # Verify Test 10: Monaco provider contract
    t10 = data["test10_monaco_provider"]
    assert t10["isRegistered"] is True
    assert t10["hasRange"] is True
    assert t10["hasContents"] is True
    assert "Customers.CustomerId" in t10["content"]

    # Verify Test 11: Facades
    t11 = data["test11_facades"]
    assert t11["appMatches"] is True
    assert t11["engineMatches"] is True
