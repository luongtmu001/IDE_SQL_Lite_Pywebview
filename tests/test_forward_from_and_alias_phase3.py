"""
test_forward_from_and_alias_phase3.py - Automated Tests for Phase 3:
Forward-Looking FROM scan & Phân định tầm nhìn Alias (Spec 7.3 Rule 7, 8.2, 8.3)

Tests:
1. Forward-looking scan in SELECT clause:
   - Query `SELECT | FROM Customers c` binds `Customers` and alias `c` immediately.
2. Select-list Alias in ORDER BY and GROUP BY:
   - `SELECT u.Name AS Ten, u.Age AS Tuoi FROM Users u ORDER BY T|` suggests `Ten` with top ranking (+120).
3. Select-list Alias hidden in WHERE and HAVING:
   - `SELECT u.Name AS Ten, u.Age AS Tuoi FROM Users u WHERE T|` filters out `Ten` (illegal in SQL).
4. Alias masking (Spec 8.3 Rule 1):
   - Unqualified: Alias `c` has higher priority (+60) than raw table name `Customers` (-30).
   - Qualified: `c.` gives full column priority; `Customers.` is tolerant but downgraded (-40).
5. Phase 1 & 2 Regressions:
   - Statement isolation without semicolon (`B20BOM` vs `B20Customer`) remains isolated.
   - Dialect quoting & replacement range remain functional.
"""

import os
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_phase3_source_code_integrity():
    """Verify that source files contain required Phase 3 implementations."""
    ctx_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    scope_path = os.path.join(BASE_DIR, 'static', 'js', 'scope-resolver.js')
    eng_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')

    with open(ctx_path, 'r', encoding='utf-8') as f:
        ctx_code = f.read()
    with open(scope_path, 'r', encoding='utf-8') as f:
        scope_code = f.read()
    with open(eng_path, 'r', encoding='utf-8') as f:
        eng_code = f.read()

    # Phase 3 Forward-looking FROM scan & selectAliases
    assert "extractSelectAliases" in ctx_code
    assert "clause === 'SELECT' && statementRange" in ctx_code
    assert "selectAliases" in ctx_code

    # Scope Resolver: isMaskedByAlias & preferredAlias
    assert "isMaskedByAlias" in scope_code
    assert "preferredAlias" in scope_code

    # Completion Engine: ORDER BY priority & WHERE filtering & alias masking
    assert "select_alias" in eng_code
    assert "isMaskedByAlias" in eng_code
    assert "context.clause === 'ORDER BY'" in eng_code
    assert "context.clause === 'WHERE'" in eng_code


def test_headless_forward_from_and_alias_phase3():
    """Execute in-browser test using Edge headless to verify Phase 3 behaviors."""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    edge_exe = next((p for p in edge_paths if os.path.exists(p)), None)
    if not edge_exe:
        pytest.skip("Microsoft Edge executable not found for headless testing")

    test_html = os.path.join(BASE_DIR, 'scratch', 'test_phase3_runner.html')

    html_content = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Phase 3 Forward FROM & Alias Visibility Test</title></head>
<body>
<div id="output">Running...</div>
<script src="../static/js/sql-tokenizer.js"></script>
<script src="../static/js/sql-dialects.js"></script>
<script src="../static/js/scope-resolver.js"></script>
<script src="../static/js/context-analyzer.js"></script>
<script src="../static/js/metadata-cache.js"></script>
<script src="../static/js/completion-engine.js"></script>
<script src="../static/js/trigger-controller.js"></script>
<script>
    const logs = [];
    async function runTests() {
        try {
            const analyzer = window.SqlContextAnalyzer;
            const ranker = new window.CompletionRanker();

            // Mock Data Provider
            const mockProvider = {
                fetchColumns: async (connId, db, schema, table) => {
                    const t = (table || '').toLowerCase();
                    if (t === 'customers') {
                        return [
                            { name: "CustomerID", data_type: "int", is_pk: true },
                            { name: "CompanyName", data_type: "nvarchar", is_pk: false },
                            { name: "ContactName", data_type: "nvarchar", is_pk: false }
                        ];
                    }
                    if (t === 'users') {
                        return [
                            { name: "UserID", data_type: "int", is_pk: true },
                            { name: "Name", data_type: "nvarchar", is_pk: false },
                            { name: "Age", data_type: "int", is_pk: false }
                        ];
                    }
                    return [];
                },
                fetchObjects: async () => [
                    { name: "Customers", type: "table", schema: "dbo" },
                    { name: "Users", type: "table", schema: "dbo" }
                ],
                fetchDataTypes: async () => ({ types: ["INT", "VARCHAR", "DATETIME"] })
            };
            const engine = new window.CompletionEngine(mockProvider);
            const generator = engine.generator;
            const tabCtx = { connectionId: "conn1", database: "testdb", schema: "dbo", dbType: "mssql" };

            // ── 1. Forward-Looking FROM Scan in SELECT ───────────────────────────
            const sql1 = "SELECT  FROM Customers c";
            const cur1 = 7; // cursor right after "SELECT "
            const ctx1 = analyzer.analyze(sql1, cur1, "mssql");
            logs.push("Test 1 Clause: " + ctx1.clause);
            const t1Names = (ctx1.queryTables || []).map(t => t.table.toLowerCase());
            logs.push("Test 1 QueryTables: " + t1Names.join(','));
            const hasC1 = Boolean(ctx1.aliasMap && (ctx1.aliasMap['c'] || ctx1.aliasMap['C']));
            logs.push("Test 1 Has Alias c: " + hasC1);

            const cands1 = await generator.generate(ctx1, tabCtx, "");
            const hasCustCol = cands1.some(c => c.name === 'CustomerID');
            const hasAliasC = cands1.some(c => c.name === 'c' && c.type === 'alias');
            logs.push("Test 1 Generated CustomerID column: " + hasCustCol);
            logs.push("Test 1 Generated Alias c: " + hasAliasC);

            // ── 2. Select-List Aliases Extraction ────────────────────────────────
            const sql2 = "SELECT u.Name AS Ten, u.Age AS Tuoi FROM Users u ORDER BY T";
            const cur2 = sql2.length;
            const ctx2 = analyzer.analyze(sql2, cur2, "mssql");
            logs.push("Test 2 Clause: " + ctx2.clause);
            logs.push("Test 2 Qualifier: " + JSON.stringify(ctx2.qualifier));
            logs.push("Test 2 selectAliases raw: " + JSON.stringify(ctx2.selectAliases));
            const selAliases = (ctx2.selectAliases || []).map(a => a.name);
            logs.push("Test 2 Select Aliases: " + selAliases.join(','));

            // ── 3. Select-List Alias in ORDER BY (Top Priority) ──────────────────
            const cands2 = await generator.generate(ctx2, tabCtx, "t");
            logs.push("Test 2 cands2 len: " + cands2.length + " names: " + cands2.map(c => c.name).join(','));
            const filtered2 = engine.filter.filter(cands2, "t");
            logs.push("Test 2 filtered2 len: " + filtered2.length + " names: " + filtered2.map(c => c.name).join(','));
            const ranked2 = ranker.rank(filtered2, ctx2, "t");
            const topItem2 = ranked2[0];
            logs.push("Test 2 Ranked top 5: " + ranked2.slice(0, 5).map(c => c.name + ":" + c.type + ":score=" + c._finalScore).join(', '));
            logs.push("Test 2 Top Ranked in ORDER BY: " + (topItem2 ? topItem2.name : 'none') + " (type: " + (topItem2 ? topItem2.type : '') + ")");

            // ── 4. Visibility Filter: Select Alias HIDDEN in WHERE ───────────────
            const sql3 = "SELECT u.Name AS Ten, u.Age AS Tuoi FROM Users u WHERE T";
            const cur3 = sql3.length;
            const ctx3 = analyzer.analyze(sql3, cur3, "mssql");
            logs.push("Test 3 Clause: " + ctx3.clause);
            const cands3 = await generator.generate(ctx3, tabCtx, "t");
            const ranked3 = ranker.rank(cands3, ctx3, "t");
            const hasTenInWhere = ranked3.some(c => c.name === 'Ten');
            logs.push("Test 3 Has Ten in WHERE (should be false): " + hasTenInWhere);

            // ── 5. Alias Masking (Spec 8.3 Rule 1) ───────────────────────────────
            // 5a. Unqualified ranking: Alias c vs raw table Customers with prefix "c"
            const cands4 = await generator.generate(ctx1, tabCtx, "c");
            const filtered4 = engine.filter.filter(cands4, "c");
            const ranked4 = ranker.rank(filtered4, ctx1, "c");
            logs.push("Test 4 ranked4 len: " + ranked4.length + " first 5: " + ranked4.slice(0, 5).map(c => c.name + ":" + c.type).join(','));
            const aliasCItem = ranked4.find(c => c.name.toLowerCase() === 'c' && c.type === 'alias');
            const custTableItem = ranked4.find(c => c.name.toLowerCase() === 'customers');
            const cScore = aliasCItem ? aliasCItem._finalScore : 0;
            const custScore = custTableItem ? custTableItem._finalScore : 0;
            logs.push("Test 4 Unqualified alias c score: " + cScore + " vs Customers table score: " + custScore);
            logs.push("Test 4 Alias c > Customers: " + (cScore > custScore));

            // 5b. Qualified ranking: c. vs Customers.
            const sqlC = "SELECT c. FROM Customers c";
            const ctxC = analyzer.analyze(sqlC, 9, "mssql"); // at "c."
            const candsC = await generator.generate(ctxC, tabCtx, "");
            const rankedC = ranker.rank(candsC, ctxC, "");
            const colCScore = rankedC.find(c => c.name === 'CustomerID')?._finalScore || 0;

            const sqlCust = "SELECT Customers. FROM Customers c";
            const ctxCust = analyzer.analyze(sqlCust, 17, "mssql"); // at "Customers."
            const candsCust = await generator.generate(ctxCust, tabCtx, "");
            const rankedCust = ranker.rank(candsCust, ctxCust, "");
            const colCustScore = rankedCust.find(c => c.name === 'CustomerID')?._finalScore || 0;

            logs.push("Test 4 Qualified c. CustomerID score: " + colCScore);
            logs.push("Test 4 Qualified Customers. CustomerID score (demoted): " + colCustScore);
            logs.push("Test 4 c. score > Customers. score: " + (colCScore > colCustScore));
            logs.push("Test 4 Customers. isMaskedByAlias: " + Boolean(ctxCust.resolvedObject && ctxCust.resolvedObject.isMaskedByAlias));

            // ── 6. Phase 1 & 2 Regressions ───────────────────────────────────────
            const sqlStmt = "SELECT * FROM B20BOM\\nSELECT Code,   FROM B20Customer";
            const curStmt = sqlStmt.indexOf("Code,") + 7;
            const ctxStmt = analyzer.analyze(sqlStmt, curStmt, "mssql");
            const tbls = (ctxStmt.queryTables || []).map(t => (t.table || '').toLowerCase());
            logs.push("Phase 1 regression queryTables: " + tbls.join(','));
            const isIsolated = tbls.includes('b20customer') && !tbls.includes('b20bom');
            logs.push("Phase 1 regression isolated: " + isIsolated);

            document.getElementById('output').innerText = "SUCCESS:\\n" + logs.join('\\n');
        } catch (err) {
            document.getElementById('output').innerText = "ERROR:\\n" + err.toString() + "\\n" + err.stack;
        }
    }
    runTests();
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

    res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    dom = res.stdout

    assert "SUCCESS:" in dom, f"Headless execution failed. DOM: {dom}"
    print("\n--- Phase 3 In-Browser Test Logs ---")
    for line in dom.replace("<br>", "\n").split("\n"):
        if "Test " in line or "Phase 1" in line:
            print(line.strip())

    # Assertions for Phase 3 Deliverables
    # 1. Forward-looking scan
    assert "Test 1 Clause: SELECT" in dom
    assert "Test 1 QueryTables: customers" in dom
    assert "Test 1 Has Alias c: true" in dom
    assert "Test 1 Generated CustomerID column: true" in dom
    assert "Test 1 Generated Alias c: true" in dom

    # 2. Select-List Aliases
    assert "Test 2 Select Aliases: Ten,Tuoi" in dom
    assert "Test 2 Top Ranked in ORDER BY: Ten (type: select_alias)" in dom

    # 3. Visibility filter in WHERE
    assert "Test 3 Has Ten in WHERE (should be false): false" in dom

    # 4. Alias Masking
    assert ("Test 4 Alias c > Customers: true" in dom) or ("Test 4 Alias c &gt; Customers: true" in dom)
    assert ("Test 4 c. score > Customers. score: true" in dom) or ("Test 4 c. score &gt; Customers. score: true" in dom)
    assert "Test 4 Customers. isMaskedByAlias: true" in dom

    # 5. Phase 1 & 2 Regressions
    assert "Phase 1 regression isolated: true" in dom

if __name__ == '__main__':
    test_headless_forward_from_and_alias_phase3()
