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


def test_phase5_source_code_integrity():
    """Verify Phase 5 FK backend and frontend code implementations."""
    # 1. Backend database adapters
    sqlserver_path = os.path.join(WORKSPACE_DIR, "app", "database", "sqlserver.py")
    with open(sqlserver_path, "r", encoding="utf-8") as f:
        ss_code = f.read()
    assert "def get_foreign_keys" in ss_code
    assert "sys.foreign_keys" in ss_code
    assert "sys.foreign_key_columns" in ss_code

    pg_path = os.path.join(WORKSPACE_DIR, "app", "database", "postgresql.py")
    with open(pg_path, "r", encoding="utf-8") as f:
        pg_code = f.read()
    assert "def get_foreign_keys" in pg_code
    assert "information_schema.table_constraints" in pg_code

    # 2. Metadata service and routes
    service_path = os.path.join(WORKSPACE_DIR, "app", "services", "metadata_service.py")
    with open(service_path, "r", encoding="utf-8") as f:
        srv_code = f.read()
    assert "def get_foreign_keys" in srv_code

    routes_path = os.path.join(WORKSPACE_DIR, "app", "routes", "metadata.py")
    with open(routes_path, "r", encoding="utf-8") as f:
        rt_code = f.read()
    assert "foreign_keys" in rt_code

    # 3. Main.py Api and api.js
    main_path = os.path.join(WORKSPACE_DIR, "main.py")
    with open(main_path, "r", encoding="utf-8") as f:
        main_code = f.read()
    assert "def get_foreign_keys" in main_code

    apijs_path = os.path.join(WORKSPACE_DIR, "static", "js", "api.js")
    with open(apijs_path, "r", encoding="utf-8") as f:
        apijs_code = f.read()
    assert "foreign_keys" in apijs_code

    # 4. Frontend cache and provider
    cache_path = os.path.join(WORKSPACE_DIR, "static", "js", "metadata-cache.js")
    with open(cache_path, "r", encoding="utf-8") as f:
        cache_code = f.read()
    assert "foreignKeysTier" in cache_code
    assert "getForeignKeys" in cache_code
    assert "setForeignKeys" in cache_code

    provider_path = os.path.join(WORKSPACE_DIR, "static", "js", "metadata-provider.js")
    with open(provider_path, "r", encoding="utf-8") as f:
        prov_code = f.read()
    assert "getForeignKeys" in prov_code

    # 5. IntelliSense and Completion Engine
    is_path = os.path.join(WORKSPACE_DIR, "static", "js", "intellisense.js")
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()
    assert "fetchForeignKeys" in is_code
    assert "join_condition" in is_code

    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_code = f.read()
    assert "generateTableAlias" in eng_code
    assert "_generateJoinTargetCandidates" in eng_code
    assert "_generateJoinOnCandidates" in eng_code
    assert "join_condition" in eng_code
    assert "FK Join Snippet" in eng_code


def test_phase5_headless_join_fk_and_on_snippets():
    """Verify Phase 5 FK JOIN target ranking, auto-alias, and ON condition snippets in headless browser."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_phase5_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 5 FK JOIN and ON Snippets Test</title>
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
            // Mock DataProvider with Catalog FKs and Columns
            const mockDataProvider = {
                fetchForeignKeys: async (connId, db, schema, table) => {
                    const tbl = (table || '').toLowerCase();
                    if (tbl === 'customers' || tbl === 'orders') {
                        return [
                            {
                                constraint_name: 'FK_Orders_Customers',
                                from_schema: 'dbo',
                                from_table: 'Orders',
                                from_columns: ['CustomerId'],
                                to_schema: 'dbo',
                                to_table: 'Customers',
                                to_columns: ['Id']
                            }
                        ];
                    }
                    if (tbl === 'orderdetails') {
                        return [
                            {
                                constraint_name: 'FK_OrderDetails_Orders',
                                from_schema: 'dbo',
                                from_table: 'OrderDetails',
                                from_columns: ['CompanyId', 'OrderId'],
                                to_schema: 'dbo',
                                to_table: 'Orders',
                                to_columns: ['CompanyId', 'Id']
                            }
                        ];
                    }
                    return [];
                },
                fetchColumns: async (connId, db, schema, table) => {
                    const tbl = (table || '').toLowerCase();
                    if (tbl === 'customers') {
                        return [
                            { name: 'Id', data_type: 'int', is_pk: true },
                            { name: 'Name', data_type: 'varchar(100)', is_pk: false }
                        ];
                    }
                    if (tbl === 'orders') {
                        return [
                            { name: 'Id', data_type: 'int', is_pk: true },
                            { name: 'CompanyId', data_type: 'int', is_pk: false },
                            { name: 'CustomerId', data_type: 'int', is_pk: false },
                            { name: 'OrderDate', data_type: 'datetime', is_pk: false }
                        ];
                    }
                    if (tbl === 'orderdetails') {
                        return [
                            { name: 'DetailId', data_type: 'int', is_pk: true },
                            { name: 'CompanyId', data_type: 'int', is_pk: false },
                            { name: 'OrderId', data_type: 'int', is_pk: false },
                            { name: 'UnitPrice', data_type: 'decimal(18,2)', is_pk: false }
                        ];
                    }
                    if (tbl === 'invoices') {
                        return [
                            { name: 'InvoiceId', data_type: 'int', is_pk: true },
                            { name: 'CustomerId', data_type: 'int', is_pk: false },
                            { name: 'TotalAmount', data_type: 'decimal(18,2)', is_pk: false }
                        ];
                    }
                    return [];
                },
                fetchObjects: async (connId, db, schema) => [
                    { name: 'Customers', type: 'table', schema: 'dbo' },
                    { name: 'Orders', type: 'table', schema: 'dbo' },
                    { name: 'OrderDetails', type: 'table', schema: 'dbo' },
                    { name: 'Invoices', type: 'table', schema: 'dbo' },
                    { name: 'Categories', type: 'table', schema: 'dbo' },
                    { name: 'Suppliers', type: 'table', schema: 'dbo' }
                ],
                fetchDataTypes: async () => ({ types: ['INT', 'VARCHAR', 'DECIMAL', 'DATETIME'] })
            };

            const engine = new window.CompletionEngine(mockDataProvider);
            const tabCtx = { connectionId: 'conn1', database: 'ShopDB', schema: 'dbo', dbType: 'sqlserver' };

            // ── Test 1: Smart Alias Generation Unit Tests ──
            const a1 = window.CompletionEngine.generateTableAlias('Customers');
            const a2 = window.CompletionEngine.generateTableAlias('Orders');
            const a3 = window.CompletionEngine.generateTableAlias('OrderDetails');
            const a4 = window.CompletionEngine.generateTableAlias('sales_order_lines');
            const a5 = window.CompletionEngine.generateTableAlias('Customers', new Set(['c']));
            logs.push("Alias Customers: " + a1);
            logs.push("Alias Orders: " + a2);
            logs.push("Alias OrderDetails: " + a3);
            logs.push("Alias sales_order_lines: " + a4);
            logs.push("Alias Customers collision: " + a5);

            // ── Test 2: Gợi ý tại JOIN | (Target table completion) ──
            const sqlJoin = "SELECT * FROM Customers c JOIN ";
            const cursorJoin = { line: 0, ch: sqlJoin.length };
            const ctxJoin = window.SqlContextAnalyzer.analyze(sqlJoin, sqlJoin.length, 'sqlserver');
            logs.push("Test 2 clause: " + ctxJoin.clause);
            logs.push("Test 2 queryTables count: " + (ctxJoin.queryTables ? ctxJoin.queryTables.length : 0));

            const candsJoin = await engine.getCompletions(sqlJoin, cursorJoin, ctxJoin, tabCtx);
            const top5Join = (candsJoin || []).slice(0, 5);
            logs.push("Test 2 Top 5 items: " + top5Join.map(c => c.name).join(' | '));

            // Verify Orders is boosted to the top and has FK detail
            const ordersItem = (candsJoin || []).find(c => c.name === 'Orders');
            logs.push("Test 2 Orders isFkTarget: " + (ordersItem ? ordersItem.isFkTarget : false));
            logs.push("Test 2 Orders detail: " + (ordersItem ? ordersItem.detail : ''));

            // Verify FK Join Snippet candidate exists: Orders o ON o.CustomerId = c.Id
            const snippetItem = (candsJoin || []).find(c => c.type === 'snippet' && c.displayType === 'FK Join Snippet');
            logs.push("Test 2 Snippet exists: " + Boolean(snippetItem));
            if (snippetItem) {
                logs.push("Test 2 Snippet name: " + snippetItem.name);
            }

            // Verify Orders is ranked higher than Categories/Suppliers
            const ordersIdx = (candsJoin || []).findIndex(c => c.name === 'Orders');
            const catIdx = (candsJoin || []).findIndex(c => c.name === 'Categories');
            logs.push("Test 2 Orders ranked before Categories: " + (ordersIdx !== -1 && catIdx !== -1 && ordersIdx < catIdx));

            // ── Test 3: Gợi ý tại JOIN Orders o ON | (Exact FK condition) ──
            const sqlOn = "SELECT * FROM Customers c JOIN Orders o ON ";
            const cursorOn = { line: 0, ch: sqlOn.length };
            const ctxOn = window.SqlContextAnalyzer.analyze(sqlOn, sqlOn.length, 'sqlserver');
            logs.push("Test 3 clause: " + ctxOn.clause);
            logs.push("Test 3 queryTables: " + (ctxOn.queryTables ? ctxOn.queryTables.map(t => t.table + ' ' + t.alias).join(', ') : ''));

            const candsOn = await engine.getCompletions(sqlOn, cursorOn, ctxOn, tabCtx);
            logs.push("Test 3 Total candidates: " + (candsOn ? candsOn.length : 0));
            if (candsOn && candsOn.length > 0) {
                logs.push("Test 3 Top 1 Candidate Name: " + candsOn[0].name);
                logs.push("Test 3 Top 1 Type: " + candsOn[0].type);
                logs.push("Test 3 Top 1 Detail: " + candsOn[0].detail);
            }

            // ── Test 4: Composite FK in ON clause (OrderDetails od JOIN Orders o ON) ──
            const sqlComposite = "SELECT * FROM Orders o JOIN OrderDetails od ON ";
            const cursorComp = { line: 0, ch: sqlComposite.length };
            const ctxComp = window.SqlContextAnalyzer.analyze(sqlComposite, sqlComposite.length, 'sqlserver');
            const candsComp = await engine.getCompletions(sqlComposite, cursorComp, ctxComp, tabCtx);
            if (candsComp && candsComp.length > 0) {
                logs.push("Test 4 Composite Top 1: " + candsComp[0].name);
                logs.push("Test 4 Has AND: " + candsComp[0].name.includes(' AND '));
            }

            // ── Test 5: Heuristic Fallback matching column names (Invoices inv JOIN Customers c ON) ──
            const sqlHeuristic = "SELECT * FROM Customers c JOIN Invoices inv ON ";
            const cursorHeur = { line: 0, ch: sqlHeuristic.length };
            const ctxHeur = window.SqlContextAnalyzer.analyze(sqlHeuristic, sqlHeuristic.length, 'sqlserver');
            const candsHeur = await engine.getCompletions(sqlHeuristic, cursorHeur, ctxHeur, tabCtx);
            const heurCond = (candsHeur || []).find(c => c.type === 'join_condition');
            logs.push("Test 5 Heuristic exists: " + Boolean(heurCond));
            if (heurCond) {
                logs.push("Test 5 Heuristic name: " + heurCond.name);
                logs.push("Test 5 Heuristic detail: " + heurCond.detail);
            }

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
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
    dom_output = proc.stdout

    match = re.search(r'<div id="test-output">(.*?)</div>', dom_output, re.DOTALL)
    assert match, f"Could not find test-output div in output: {dom_output}"
    inner = match.group(1).replace("<br>", "\n").replace("&gt;", ">").replace("&lt;", "<")
    print("\n--- Phase 5 Headless Test Logs ---")
    print(inner.encode('ascii', errors='backslashreplace').decode('ascii'))

    assert "ERROR:" not in inner, f"Headless test encountered an error:\n{inner}"

    # Assertions for Smart Alias Generation
    assert "Alias Customers: c" in inner
    assert "Alias Orders: o" in inner
    assert "Alias OrderDetails: od" in inner
    assert "Alias sales_order_lines: sol" in inner
    assert "Alias Customers collision: c2" in inner

    # Assertions for Test 2: JOIN Target
    assert "Test 2 Orders isFkTarget: true" in inner
    assert ("FK: Orders.CustomerId → Customers.Id" in inner or "Orders.CustomerId" in inner)
    assert "Test 2 Snippet exists: true" in inner
    assert "Test 2 Orders ranked before Categories: true" in inner

    # Assertions for Test 3: JOIN ON exact FK condition
    assert "Test 3 Top 1 Candidate Name: o.CustomerId = c.Id" in inner
    assert "Test 3 Top 1 Type: join_condition" in inner

    # Assertions for Test 4: Composite FK
    assert "Test 4 Has AND: true" in inner
    assert "od.CompanyId = o.CompanyId AND od.OrderId = o.Id" in inner

    # Assertions for Test 5: Heuristic Fallback
    assert "Test 5 Heuristic exists: true" in inner
    assert "inv.CustomerId = c.Id" in inner
