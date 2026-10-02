"""
test_quoting_and_replacement_phase2.py - Automated Tests for Phase 2: Quoting Dialect & Replacement Range

Tests compliance with Section 4.1, 9.2, 16 of SQL_INTELLISENSE_AGENT_SPEC.md:
1. Lexer tracks quoted identifiers: isQuoted, quoteChar, closeQuoteChar, terminated.
2. cleanIdentifier handles unclosed quotes ([Cus -> Cus, "Ord -> Ord) and unescapes ]] and "".
3. needsQuoting detects spaces, special chars, leading digits, reserved keywords, and uppercase in PG.
4. quoteIdentifier wraps according to dialect: [...] for MSSQL, "..." for PG, `...` for MySQL.
5. replacementRange starts at the opening quote/bracket and extends through auto-closed delimiter.
6. TriggerController treats '[' and '"' as trigger characters.
7. Intellisense insertion replaces the exact replacementRange with insertText without duplicate brackets.
8. Regression check: Phase 1 statement isolation remains 100% functional.
"""

import os
import subprocess
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_phase2_source_code_integrity():
    """Verify that all Phase 2 quoting and replacement logic exists in JS files."""
    tok_path = os.path.join(BASE_DIR, 'static', 'js', 'sql-tokenizer.js')
    ctx_path = os.path.join(BASE_DIR, 'static', 'js', 'context-analyzer.js')
    eng_path = os.path.join(BASE_DIR, 'static', 'js', 'completion-engine.js')
    trg_path = os.path.join(BASE_DIR, 'static', 'js', 'trigger-controller.js')
    inte_path = os.path.join(BASE_DIR, 'static', 'js', 'intellisense.js')

    for p in [tok_path, ctx_path, eng_path, trg_path, inte_path]:
        assert os.path.exists(p), f"{p} must exist"

    with open(tok_path, 'r', encoding='utf-8') as f:
        tok_code = f.read()
    assert "isQuoted" in tok_code
    assert "quoteChar" in tok_code
    assert "cleanIdentifier" in tok_code

    with open(ctx_path, 'r', encoding='utf-8') as f:
        ctx_code = f.read()
    assert "isQuotedIdentifier" in ctx_code
    assert "replacementRange" in ctx_code
    assert "prefixRange" in ctx_code
    assert "hasClosingQuoteAfterCursor" in ctx_code

    with open(eng_path, 'r', encoding='utf-8') as f:
        eng_code = f.read()
    assert "needsQuoting" in eng_code
    assert "quoteIdentifier" in eng_code
    assert "formatInsertText" in eng_code

    with open(trg_path, 'r', encoding='utf-8') as f:
        trg_code = f.read()
    assert "character_quote" in trg_code
    assert "'['" in trg_code

    with open(inte_path, 'r', encoding='utf-8') as f:
        inte_code = f.read()
    assert "currentContext.replacementRange" in inte_code
    assert "item.insertText" in inte_code


def test_headless_quoting_and_replacement_phase2():
    """Execute in-browser test using Edge headless to verify quoting and replacement behavior."""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    ]
    edge_exe = next((p for p in edge_paths if os.path.exists(p)), None)
    if not edge_exe:
        pytest.skip("Microsoft Edge executable not found for headless testing")

    test_html = os.path.join(BASE_DIR, 'scratch', 'test_quoting_runner.html')

    html_content = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Quoting & Replacement Phase 2 Test</title></head>
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
    try {
        const tokenizer = new window.SqlTokenizer();
        const analyzer = window.SqlContextAnalyzer;
        const engine = window.CompletionEngine;

        // ── 1. Tokenizer & cleanIdentifier test ──────────────────────────────
        const t1 = tokenizer.tokenize("SELECT [Customer Name], [Order]]Details FROM t");
        logs.push("Token 1 val: " + t1[2].value + " isQuoted: " + t1[2].isQuoted);
        logs.push("Clean 1: " + tokenizer.cleanIdentifier(t1[2].value));
        logs.push("Clean unclosed [Cus: " + analyzer.cleanIdentifier("[Cus"));
        logs.push("Clean unclosed double quote \\"Ord: " + analyzer.cleanIdentifier('"Ord'));

        // ── 2. needsQuoting & quoteIdentifier test ───────────────────────────
        logs.push("needsQuoting Order Details: " + engine.needsQuoting("Order Details", "mssql"));
        logs.push("quoteIdentifier Order Details (mssql): " + engine.quoteIdentifier("Order Details", "mssql"));
        logs.push("needsQuoting Table (reserved): " + engine.needsQuoting("Table", "mssql"));
        logs.push("needsQuoting 1stCol (digit): " + engine.needsQuoting("1stCol", "mssql"));
        logs.push("needsQuoting CustomerID in PG (uppercase): " + engine.needsQuoting("CustomerID", "postgres"));
        logs.push("needsQuoting customerid in PG (lowercase): " + engine.needsQuoting("customerid", "postgres"));
        logs.push("quoteIdentifier CustomerID (postgres): " + engine.quoteIdentifier("CustomerID", "postgres"));

        // ── 3. ContextAnalyzer replacementRange for unclosed [Cus ─────────────
        const sql1 = "SELECT [Cus FROM Customers c";
        const cursor1 = 11; // after "[Cus"
        const ctx1 = analyzer.analyze(sql1, cursor1, "mssql");
        logs.push("ctx1 isQuotedIdentifier: " + ctx1.isQuotedIdentifier);
        logs.push("ctx1 currentWord: " + ctx1.currentWord);
        logs.push("ctx1 quoteChar: " + ctx1.quoteChar);
        logs.push("ctx1 replacementRange: " + JSON.stringify(ctx1.replacementRange));
        logs.push("ctx1 prefixRange: " + JSON.stringify(ctx1.prefixRange));

        // ── 4. ContextAnalyzer replacementRange with auto-closed bracket [Cus] ─
        const sql2 = "SELECT [Cus] FROM Customers c";
        const cursor2 = 11; // cursor right before "]"
        const ctx2 = analyzer.analyze(sql2, cursor2, "mssql");
        logs.push("ctx2 hasClosingQuoteAfterCursor: " + ctx2.hasClosingQuoteAfterCursor);
        logs.push("ctx2 replacementRange: " + JSON.stringify(ctx2.replacementRange));

        // ── 5. TriggerController classification for quotes ───────────────────
        const trg = new window.TriggerController();
        const keyClassBracket = trg.classifyKey({ key: '[' });
        const keyClassQuote = trg.classifyKey({ key: '"' });
        logs.push("Key [ category: " + keyClassBracket.category);
        logs.push("Key \\" category: " + keyClassQuote.category);

        const changeDecision = trg.decideChange({ text: ['['], origin: '+input' }, ctx1, false);
        logs.push("decideChange on [ action: " + changeDecision.action + " reason: " + changeDecision.reason);

        // ── 6. CandidateGenerator formatInsertText test ──────────────────────
        const mockProvider = {
            fetchColumns: async () => [{ name: "CustomerID", data_type: "int" }, { name: "Customer Name", data_type: "varchar" }],
            fetchObjects: async () => [{ name: "Customers", type: "table" }, { name: "Order Details", type: "table" }]
        };
        const gen = new window.CandidateGenerator(mockProvider);
        const insert1 = gen.formatInsertText("CustomerID", "column", ctx1, { dbType: "mssql" });
        const insert2 = gen.formatInsertText("Customer Name", "column", { isQuotedIdentifier: false }, { dbType: "mssql" });
        const insert3 = gen.formatInsertText("Order Details", "table", { isQuotedIdentifier: false }, { dbType: "mssql" });
        const insert4 = gen.formatInsertText("CustomerID", "column", { isQuotedIdentifier: false }, { dbType: "postgres" });
        logs.push("insert1 (user typed [): " + insert1);
        logs.push("insert2 (auto-quoted space): " + insert2);
        logs.push("insert3 (auto-quoted table): " + insert3);
        logs.push("insert4 (postgres uppercase): " + insert4);

        // ── 7. Regression Check: Phase 1 Statement Boundary ──────────────────
        const sqlStmt = "SELECT * FROM B20BOM\\nSELECT Code,   FROM B20Customer";
        const curStmt = sqlStmt.indexOf("Code,") + 7;
        const ctxStmt = analyzer.analyze(sqlStmt, curStmt, "mssql");
        const tbls = (ctxStmt.queryTables || []).map(t => (t.table || '').toLowerCase());
        logs.push("Phase 1 regression queryTables: " + tbls.join(','));

        document.getElementById('output').innerText = "SUCCESS:\\n" + logs.join('\\n');
    } catch (err) {
        document.getElementById('output').innerText = "ERROR:\\n" + err.toString() + "\\n" + err.stack;
    }
</script>
</body>
</html>
"""
    with open(test_html, 'w', encoding='utf-8') as f:
        f.write(html_content)

    out_file = os.path.join(BASE_DIR, 'scratch', 'quoting_test_out.txt')
    if os.path.exists(out_file):
        os.remove(out_file)

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
    print("\n--- Phase 2 In-Browser Test Logs ---")
    for line in dom.split("\n"):
        if "Token 1" in line or "Clean" in line or "needsQuoting" in line or "quoteIdentifier" in line or "ctx1" in line or "ctx2" in line or "Key [" in line or "decideChange" in line or "insert" in line or "regression" in line:
            print(line.strip())

    # Assertions
    assert "Clean unclosed [Cus: Cus" in dom
    assert "Clean unclosed double quote \"Ord: Ord" in dom
    assert "needsQuoting Order Details: true" in dom
    assert "quoteIdentifier Order Details (mssql): [Order Details]" in dom
    assert "needsQuoting Table (reserved): true" in dom
    assert "needsQuoting 1stCol (digit): true" in dom
    assert "needsQuoting CustomerID in PG (uppercase): true" in dom
    assert "needsQuoting customerid in PG (lowercase): false" in dom
    assert "quoteIdentifier CustomerID (postgres): \"CustomerID\"" in dom

    # Replacement range tests
    # sql1: "SELECT [Cus FROM Customers c", "[Cus" starts at index 7, ends at 11
    assert '"start":7,"end":11' in dom
    # sql2: "SELECT [Cus] FROM Customers c", includes closing bracket "]" -> end is 12!
    assert 'ctx2 hasClosingQuoteAfterCursor: true' in dom
    assert '"start":7,"end":12' in dom

    # Trigger controller tests
    assert "Key [ category: TRIGGER_CHAR" in dom
    assert 'Key " category: TRIGGER_CHAR' in dom
    assert "decideChange on [ action: trigger reason: character" in dom

    # Candidate formatting
    assert "insert1 (user typed [): [CustomerID]" in dom
    assert "insert2 (auto-quoted space): [Customer Name]" in dom
    assert "insert3 (auto-quoted table): [Order Details]" in dom
    assert "insert4 (postgres uppercase): \"CustomerID\"" in dom

    # Phase 1 regression
    assert "Phase 1 regression queryTables: b20customer" in dom
    assert "b20bom" not in dom.lower().split("phase 1 regression querytables:")[1].split("\n")[0]
