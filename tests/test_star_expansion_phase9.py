"""
test_star_expansion_phase9.py - Automated Unit & Headless Browser Tests for Phase 9:
Star Expansion (* & alias.* Expansion into Column List) (Spec Section 8.4 & 10.6)

Tests:
1. Source code integrity:
   - expandStarColumns method in completion-engine.js
   - star_expansion matching in CandidateFilter
   - star_expansion priority in CompletionRanker
   - qualifierStartOffset in context-analyzer.js
   - item.replacementRange handling in intellisense.js
2. Headless Browser Scenarios:
   - Scenario 1: Single table without alias: SELECT * FROM Customers -> "CustomerId, CompanyName, ContactName, City"
   - Scenario 2: Single table with alias: SELECT * FROM Customers c -> "c.CustomerId, c.CompanyName, c.ContactName, c.City"
   - Scenario 3: Multi-table JOIN: SELECT * FROM Customers c JOIN Orders o ... -> "c.CustomerId, ..., o.OrderId, ..."
   - Scenario 4: Qualified star expansion c.* -> only columns of c, replacementRange covers c.*
   - Scenario 5: Qualified star expansion o.* -> only columns of o, replacementRange covers o.*
   - Scenario 6: Dialect Quoting: reserved keywords & special characters (e.g. [Order ID], [Group])
   - Scenario 7: Typing * in SELECT clause yields star_expansion as #1 top suggestion
   - Scenario 8: EditorAdapter simulated replacement: transforms document into full column list
"""

import json
import os
import re
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_phase9_source_code_integrity():
    """Verify that source files contain required Phase 9 Star Expansion implementations."""
    engine_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')
    analyzer_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    intellisense_path = os.path.join(BASE_DIR, 'static', 'js', 'intellisense.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        engine_code = f.read()
    with open(analyzer_path, 'r', encoding='utf-8') as f:
        analyzer_code = f.read()
    with open(intellisense_path, 'r', encoding='utf-8') as f:
        intellisense_code = f.read()

    # 1. CandidateGenerator.expandStarColumns
    assert "expandStarColumns" in engine_code
    assert "star_expansion" in engine_code
    assert "* (Expand columns)" in engine_code

    # 2. CandidateFilter match for star_expansion
    assert "item.type === 'star_expansion'" in engine_code

    # 3. Context Analyzer qualifierStartOffset
    assert "qualifierStartOffset" in analyzer_code

    # 4. IntelliSense custom item.replacementRange
    assert "item.replacementRange" in intellisense_code


def test_phase9_headless_star_expansion():
    """Execute in-browser test using Edge headless to verify Phase 9 Star Expansion behaviors."""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    browser_exe = None
    for p in edge_paths:
        if os.path.exists(p):
            browser_exe = p
            break

    if not browser_exe:
        pytest.skip("Microsoft Edge not found for headless evaluation.")

    html_path = os.path.join(BASE_DIR, "tests", "temp_test_star_phase9.html")

    html_content = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 9 Star Expansion Test</title>
    <!-- Load IDE Intellisense Pipeline -->
    <script src="../static/js/sql-dialects.js"></script>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/scope-resolver.js"></script>
    <script src="../static/js/context-analyzer.js"></script>
    <script src="../static/js/metadata-cache.js"></script>
    <script src="../static/js/completion-engine.js"></script>
    <script src="../static/js/editor-adapter.js"></script>
    <script src="../static/js/intellisense.js"></script>
</head>
<body>
    <div id="test-output">RUNNING</div>
    <script>
    (async function() {
        try {
            const results = {};
            const engine = window.DefaultCompletionEngine;
            const cache = window.AppMetadataCache;
            const analyzer = window.SqlContextAnalyzer;

            const connId = 'conn_phase9';
            const db = 'SalesDB';
            const schema = 'dbo';
            const tabCtx = { connectionId: connId, database: db, schema: schema, dbType: 'sqlserver' };

            // Mock table metadata in cache
            cache.setColumns(connId, db, schema, 'Customers', [
                { name: 'CustomerId', data_type: 'int', is_pk: true },
                { name: 'CompanyName', data_type: 'nvarchar(100)' },
                { name: 'ContactName', data_type: 'nvarchar(50)' },
                { name: 'City', data_type: 'nvarchar(50)' }
            ]);

            cache.setColumns(connId, db, schema, 'Orders', [
                { name: 'OrderId', data_type: 'int', is_pk: true },
                { name: 'CustomerId', data_type: 'int' },
                { name: 'OrderDate', data_type: 'datetime' },
                { name: 'TotalAmount', data_type: 'decimal' }
            ]);

            cache.setColumns(connId, db, schema, 'SpecialItems', [
                { name: 'Order ID', data_type: 'int' },
                { name: 'Group', data_type: 'nvarchar(50)' },
                { name: 'Price', data_type: 'decimal' }
            ]);

            // Scenario 1: Unqualified single table without alias: SELECT * FROM Customers
            const sql1 = "SELECT * FROM Customers";
            const cursor1 = sql1.indexOf("*") + 1; // cursor right after *
            const ctx1 = analyzer.analyze(sql1, cursor1);
            const comps1 = await engine.getCompletions(sql1, cursor1, ctx1, tabCtx);
            const star1 = comps1.find(c => c.type === 'star_expansion');

            results.scenario1 = {
                found: Boolean(star1),
                topItem: comps1.length > 0 ? comps1[0].name : null,
                insertText: star1 ? star1.insertText : null,
                label: star1 ? star1.label : null
            };

            // Scenario 2: Unqualified single table with alias: SELECT * FROM Customers c
            const sql2 = "SELECT * FROM Customers c";
            const cursor2 = sql2.indexOf("*") + 1;
            const ctx2 = analyzer.analyze(sql2, cursor2);
            const comps2 = await engine.getCompletions(sql2, cursor2, ctx2, tabCtx);
            const star2 = comps2.find(c => c.type === 'star_expansion');

            results.scenario2 = {
                found: Boolean(star2),
                insertText: star2 ? star2.insertText : null,
                label: star2 ? star2.label : null
            };

            // Scenario 3: Multi-table JOIN: SELECT * FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId
            const sql3 = "SELECT * FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId";
            const cursor3 = sql3.indexOf("*") + 1;
            const ctx3 = analyzer.analyze(sql3, cursor3);
            const comps3 = await engine.getCompletions(sql3, cursor3, ctx3, tabCtx);
            const star3 = comps3.find(c => c.type === 'star_expansion');

            results.scenario3 = {
                found: Boolean(star3),
                insertText: star3 ? star3.insertText : null,
                label: star3 ? star3.label : null
            };

            // Scenario 4: Qualified star expansion: SELECT c.* FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId
            const sql4 = "SELECT c.* FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId";
            const cursor4 = sql4.indexOf("c.*") + 3; // right after *
            const ctx4 = analyzer.analyze(sql4, cursor4);
            const comps4 = await engine.getCompletions(sql4, cursor4, ctx4, tabCtx);
            const star4 = comps4.find(c => c.type === 'star_expansion');

            results.scenario4 = {
                found: Boolean(star4),
                insertText: star4 ? star4.insertText : null,
                label: star4 ? star4.label : null,
                qualifier: ctx4.qualifier,
                qualifierStartOffset: ctx4.qualifierStartOffset,
                hasCustomReplacementRange: Boolean(star4 && star4.replacementRange)
            };

            // Scenario 5: Qualified star expansion: SELECT o.* FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId
            const sql5 = "SELECT c.*, o.* FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId";
            const cursor5 = sql5.indexOf("o.*") + 3;
            const ctx5 = analyzer.analyze(sql5, cursor5);
            const comps5 = await engine.getCompletions(sql5, cursor5, ctx5, tabCtx);
            const star5 = comps5.find(c => c.type === 'star_expansion');

            results.scenario5 = {
                found: Boolean(star5),
                insertText: star5 ? star5.insertText : null,
                label: star5 ? star5.label : null
            };

            // Scenario 6: Quoting in star expansion: [Order ID] and [Group]
            const sql6 = "SELECT * FROM SpecialItems";
            const cursor6 = sql6.indexOf("*") + 1;
            const ctx6 = analyzer.analyze(sql6, cursor6);
            const comps6 = await engine.getCompletions(sql6, cursor6, ctx6, tabCtx);
            const star6 = comps6.find(c => c.type === 'star_expansion');

            results.scenario6 = {
                insertText: star6 ? star6.insertText : null
            };

            // Scenario 7: Typing * in SELECT clause yields star_expansion as #1 candidate
            results.scenario7 = {
                isTopItemInScenario1: comps1.length > 0 && comps1[0].type === 'star_expansion',
                isTopItemInScenario4: comps4.length > 0 && comps4[0].type === 'star_expansion'
            };

            // Scenario 8: EditorAdapter text replacement simulation
            // Simulated fake editor
            class FakeEditor {
                constructor(text) {
                    this.text = text;
                }
                getValue() { return this.text; }
                getText() { return this.text; }
                indexFromPos(pos) { return pos.index; }
                posFromIndex(idx) { return { index: idx }; }
                replaceRange(newText, fromPos, toPos) {
                    this.text = this.text.substring(0, fromPos.index) + newText + this.text.substring(toPos.index);
                }
            }

            // Test replacement on Scenario 4 (c.*)
            const fakeEditor4 = new FakeEditor(sql4);
            const range4 = star4.replacementRange || ctx4.replacementRange;
            fakeEditor4.replaceRange(star4.insertText, { index: range4.start }, { index: range4.end });

            // Test replacement on Scenario 1 (*)
            const fakeEditor1 = new FakeEditor(sql1);
            const range1 = star1.replacementRange || ctx1.replacementRange;
            fakeEditor1.replaceRange(star1.insertText, { index: range1.start }, { index: range1.end });

            results.scenario8 = {
                replacedSql4: fakeEditor4.getValue(),
                replacedSql1: fakeEditor1.getValue()
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

    match = re.search(r'<div id="test-output">(.*?)</div>', output, re.DOTALL)
    assert match, f"Could not find test-output in browser DOM. Output:\n{output}"

    data_str = match.group(1).strip()
    data = json.loads(data_str)
    assert "error" not in data, f"JavaScript runtime error: {data.get('error')} \n {data.get('stack')}"

    # Verify Scenario 1: Single table without alias
    s1 = data["scenario1"]
    assert s1["found"] is True
    assert s1["topItem"] == "*"
    assert s1["insertText"] == "CustomerId, CompanyName, ContactName, City"
    assert "Expand columns" in s1["label"]

    # Verify Scenario 2: Single table with alias
    s2 = data["scenario2"]
    assert s2["found"] is True
    assert s2["insertText"] == "c.CustomerId, c.CompanyName, c.ContactName, c.City"

    # Verify Scenario 3: Multi-table JOIN
    s3 = data["scenario3"]
    assert s3["found"] is True
    assert s3["insertText"] == "c.CustomerId, c.CompanyName, c.ContactName, c.City, o.OrderId, o.CustomerId, o.OrderDate, o.TotalAmount"

    # Verify Scenario 4: Qualified star expansion c.*
    s4 = data["scenario4"]
    assert s4["found"] is True
    assert s4["insertText"] == "c.CustomerId, c.CompanyName, c.ContactName, c.City"
    assert s4["qualifier"] == "c"
    assert s4["hasCustomReplacementRange"] is True

    # Verify Scenario 5: Qualified star expansion o.*
    s5 = data["scenario5"]
    assert s5["found"] is True
    assert s5["insertText"] == "o.OrderId, o.CustomerId, o.OrderDate, o.TotalAmount"

    # Verify Scenario 6: Quoting
    s6 = data["scenario6"]
    assert "[Order ID]" in s6["insertText"]
    assert "[Group]" in s6["insertText"]

    # Verify Scenario 7: Star ranking
    s7 = data["scenario7"]
    assert s7["isTopItemInScenario1"] is True
    assert s7["isTopItemInScenario4"] is True

    # Verify Scenario 8: Document transformation
    s8 = data["scenario8"]
    assert s8["replacedSql1"] == "SELECT CustomerId, CompanyName, ContactName, City FROM Customers"
    assert s8["replacedSql4"] == "SELECT c.CustomerId, c.CompanyName, c.ContactName, c.City FROM Customers c JOIN Orders o ON c.CustomerId = o.CustomerId"

    print("\n[PASS] Phase 9 Star Expansion Headless Evaluation passed with 100% compliance!")
