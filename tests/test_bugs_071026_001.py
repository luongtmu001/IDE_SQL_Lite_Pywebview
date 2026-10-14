import os
import shutil
import subprocess
try:
    import pytest
except ImportError:
    class _MockPytest:
        @staticmethod
        def skip(reason=""):
            print(f"SKIPPED: {reason}")
    pytest = _MockPytest()

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


def test_update_set_source_code_integrity():
    """Verify source code changes for Bug 1 in context-analyzer.js and completion-engine.js."""
    ctx_path = os.path.join(WORKSPACE_DIR, "static", "js", "context-analyzer.js")
    with open(ctx_path, "r", encoding="utf-8") as f:
        ctx_content = f.read()

    assert "endSetKeywords" in ctx_content, "context-analyzer.js must check endSetKeywords ['FROM', 'WHERE', 'OUTPUT']"
    assert "isBeforeEndSet" in ctx_content, "context-analyzer.js must check isBeforeEndSet"
    assert "clause === 'SET'" in ctx_content, "context-analyzer.js forward scan must support SET clause"

    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_content = f.read()

    assert "isUpdateSet && context.targetTable" in eng_content, "completion-engine.js must check targetTable in UPDATE SET"
    assert "Skip JOINed tables in UPDATE SET target position" in eng_content, "completion-engine.js must filter JOIN tables in UPDATE SET"


def test_headless_update_set_target_column_isolation():
    """Test Bug 1 via Headless Browser: in UPDATE SET, only targetTable columns are suggested on the left side of '='."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_update_set_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>UPDATE SET Target Column Isolation Test</title>
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
                    const tblLower = (table || '').toLowerCase();
                    if (tblLower === '#cttmp') {
                        return [
                            { name: 'CtTmpId', data_type: 'int', is_pk: true },
                            { name: 'CtAmount', data_type: 'decimal(18,2)', is_pk: false },
                            { name: 'CtNote', data_type: 'nvarchar(100)', is_pk: false }
                        ];
                    }
                    if (tblLower === 'vb30accdoc') {
                        return [
                            { name: 'DocNo', data_type: 'varchar(20)', is_pk: true },
                            { name: 'DocDate', data_type: 'datetime', is_pk: false },
                            { name: 'PartnerCode', data_type: 'varchar(20)', is_pk: false }
                        ];
                    }
                    return [];
                },
                fetchObjects: async (connId, db, schema) => [
                    { name: 'vB30AccDoc', type: 'view', schema: 'dbo' },
                    { name: '#CtTmp', type: 'temp_table', schema: '' }
                ],
                fetchDataTypes: async () => ({ types: ['INT', 'DECIMAL', 'VARCHAR', 'NVARCHAR'] })
            };

            const engine = new window.CompletionEngine(mockDataProvider);
            const tabCtx = { connectionId: 'c1', database: 'TestDb', schema: 'dbo', dbType: 'sqlserver' };

            // ── Test 1: Left side of '=' in UPDATE SET (Target Column position) ──
            const sql1 = "UPDATE #CtTmp SET  FROM #CtTmp a JOIN vB30AccDoc b ON a.CtTmpId = b.DocNo";
            const cursor1 = "UPDATE #CtTmp SET ".length; // right after 'SET '
            const ctx1 = window.SqlContextAnalyzer.analyze(sql1, cursor1, tabCtx.dbType);

            logs.push("Test 1 isUpdateSet: " + ctx1.isUpdateSet);
            logs.push("Test 1 isUpdateSetValue: " + ctx1.isUpdateSetValue);
            logs.push("Test 1 targetTable: " + (ctx1.targetTable ? ctx1.targetTable.table : 'null'));

            const cands1 = await engine.generator.generate(ctx1, tabCtx, sql1);
            const names1 = cands1.map(c => c.name);

            const hasCtTmpCol_1 = names1.includes('CtAmount') || names1.includes('CtTmpId');
            const hasVB30Col_1 = names1.includes('DocNo') || names1.includes('PartnerCode') || names1.includes('DocDate');
            const hasVB30Alias_1 = names1.includes('b');

            logs.push("Test 1 Has Target #CtTmp Columns: " + hasCtTmpCol_1);
            logs.push("Test 1 Has Joined vB30AccDoc Columns (MUST BE FALSE): " + hasVB30Col_1);
            logs.push("Test 1 Has Joined Alias b (MUST BE FALSE): " + hasVB30Alias_1);

            // ── Test 2: Right side of '=' in UPDATE SET (Expression/Value position) ──
            const sql2 = "UPDATE #CtTmp SET CtAmount =  FROM #CtTmp a JOIN vB30AccDoc b ON a.CtTmpId = b.DocNo";
            const cursor2 = "UPDATE #CtTmp SET CtAmount = ".length; // right after '='
            const ctx2 = window.SqlContextAnalyzer.analyze(sql2, cursor2, tabCtx.dbType);

            logs.push("Test 2 isUpdateSet: " + ctx2.isUpdateSet);
            logs.push("Test 2 isUpdateSetValue: " + ctx2.isUpdateSetValue);

            const cands2 = await engine.generator.generate(ctx2, tabCtx, sql2);
            const names2 = cands2.map(c => c.name);

            const hasCtTmpCol_2 = names2.includes('CtAmount') || names2.includes('CtTmpId');
            const hasVB30Col_2 = names2.includes('DocNo') || names2.includes('PartnerCode');

            logs.push("Test 2 Has Target #CtTmp Columns (CAN BE TRUE): " + hasCtTmpCol_2);
            logs.push("Test 2 Has Joined vB30AccDoc Columns (MUST BE TRUE): " + hasVB30Col_2);

            // ── Test 3: UPDATE with target alias 'a' ──
            const sql3 = "UPDATE a SET  FROM #CtTmp a JOIN vB30AccDoc b ON a.CtTmpId = b.DocNo";
            const cursor3 = "UPDATE a SET ".length;
            const ctx3 = window.SqlContextAnalyzer.analyze(sql3, cursor3, tabCtx.dbType);

            logs.push("Test 3 isUpdateSet: " + ctx3.isUpdateSet);
            logs.push("Test 3 targetTable: " + (ctx3.targetTable ? ctx3.targetTable.table : 'null'));

            const cands3 = await engine.generator.generate(ctx3, tabCtx, sql3);
            const names3 = cands3.map(c => c.name);

            const hasCtTmpCol_3 = names3.includes('CtAmount') || names3.includes('CtTmpId');
            const hasVB30Col_3 = names3.includes('DocNo') || names3.includes('PartnerCode');

            logs.push("Test 3 Has Target #CtTmp Columns: " + hasCtTmpCol_3);
            logs.push("Test 3 Has Joined vB30AccDoc Columns (MUST BE FALSE): " + hasVB30Col_3);

            document.getElementById('test-output').innerText = "DONE\n" + logs.join('\n');
        } catch (err) {
            document.getElementById('test-output').innerText = "ERROR: " + err.toString() + "\n" + err.stack;
        }
    })();
    </script>
</body>
</html>"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    proc = subprocess.run(
        [
            browser_exe,
            "--headless=new",
            "--disable-gpu",
            "--dump-dom",
            f"file:///{os.path.abspath(html_path).replace(os.sep, '/')}",
        ],
        capture_output=True,
        text=True,
        timeout=15,
        encoding="utf-8",
        errors="ignore",
    )

    out = proc.stdout
    assert "DONE" in out, f"Test failed to complete: {out}"
    assert "Test 1 isUpdateSet: true" in out
    assert "Test 1 Has Target #CtTmp Columns: true" in out
    assert "Test 1 Has Joined vB30AccDoc Columns (MUST BE FALSE): false" in out
    assert "Test 1 Has Joined Alias b (MUST BE FALSE): false" in out

    assert "Test 2 isUpdateSetValue: true" in out
    assert "Test 2 Has Joined vB30AccDoc Columns (MUST BE TRUE): true" in out

    assert "Test 3 isUpdateSet: true" in out
    assert "Test 3 Has Target #CtTmp Columns: true" in out
    assert "Test 3 Has Joined vB30AccDoc Columns (MUST BE FALSE): false" in out


def test_find_widget_focus_protection_integrity():
    """Verify source code changes for Find Widget focus in editor.js and style.css."""
    editor_path = os.path.join(WORKSPACE_DIR, "static", "js", "editor.js")
    with open(editor_path, "r", encoding="utf-8") as f:
        editor_content = f.read()

    assert "Safe Click handler for Find Widget" in editor_content
    assert "findWidget" in editor_content
    # Confirm dangerous mousedown capture with stopPropagation on domNode has been removed
    assert "domNode.addEventListener('mousedown'" not in editor_content

    find_path = os.path.join(WORKSPACE_DIR, "static", "js", "find-replace.js")
    with open(find_path, "r", encoding="utf-8") as f:
        find_content = f.read()
    assert "actions.find" in find_content
    assert "getActiveAppEditor" in find_content

    css_path = os.path.join(WORKSPACE_DIR, "static", "css", "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    assert ".monaco-editor .find-widget" in css_content
    assert "pointer-events: auto !important;" in css_content
    assert "z-index: 1050 !important;" in css_content


def test_responsive_action_bar_overflow_integrity():
    """Verify source code changes for Action bar and Stop button in templates, css, and editor.js."""
    index_path = os.path.join(WORKSPACE_DIR, "templates", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        index_content = f.read()

    assert 'id="ide-btn-stop" class="ide-action-btn ide-action-btn--danger ide-action-essential"' in index_content, "Stop button must be in essential group in index.html"
    assert "ide-action-collapsible" in index_content
    assert "ide-btn-action-overflow" in index_content
    assert "ide-action-overflow-menu" in index_content
    assert "ide-overflow-btn-parse" in index_content
    assert "ide-overflow-btn-format" in index_content
    assert "ide-overflow-btn-plan" in index_content
    assert "ide-overflow-btn-stop" not in index_content, "Stop button should not be inside overflow menu since it is always essential outside"

    partial_path = os.path.join(WORKSPACE_DIR, "templates", "partials", "editor.html")
    with open(partial_path, "r", encoding="utf-8") as f:
        partial_content = f.read()

    assert 'id="ide-btn-stop" class="ide-action-btn ide-action-btn--danger ide-action-essential"' in partial_content, "Stop button must be in essential group in partials/editor.html"
    assert "ide-action-collapsible" in partial_content
    assert "ide-btn-action-overflow" in partial_content
    assert "ide-action-overflow-menu" in partial_content

    css_path = os.path.join(WORKSPACE_DIR, "static", "css", "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    assert ".ide-action-bar.is-compact .ide-action-collapsible" in css_content
    assert ".ide-action-bar.is-compact .ide-action-overflow-wrap" in css_content
    assert ".ide-action-overflow-wrap {\n    display: none !important;" in css_content

    editor_path = os.path.join(WORKSPACE_DIR, "static", "js", "editor.js")
    with open(editor_path, "r", encoding="utf-8") as f:
        editor_content = f.read()

    assert "wireOverflowMenu" in editor_content
    assert "ResizeObserver" in editor_content
    assert "isOverflowing" in editor_content


def test_headless_dot_trigger_after_alias():
    """Verify that typing dot after an alias (e.g. 'b.') in UPDATE SET auto-triggers column completion."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_dot_trigger_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Dot Trigger After Alias Test</title>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/sql-dialects.js"></script>
    <script src="../static/js/context-analyzer.js"></script>
    <script src="../static/js/scope-resolver.js"></script>
    <script src="../static/js/trigger-controller.js"></script>
</head>
<body>
    <div id="test-output">Running...</div>
    <script>
    (function() {
        const results = [];
        try {
            const controller = new window.IntelliSenseTriggerController();
            const sql = "UPDATE #CtTmp SET cola = b. FROM #CtTmp a JOIN vB30AccDoc b ON a.CtTmpId = b.DocNo";
            const cursorOffset = "UPDATE #CtTmp SET cola = b.".length;

            const context = window.SqlContextAnalyzer.analyze(sql, cursorOffset);
            results.push("Qualifier: " + context.qualifier);
            results.push("TriggerChar: " + context.triggerChar);
            results.push("ContextType: " + context.contextType);

            // 1. Monaco change event with changes array
            const monacoChange = {
                origin: '+input',
                changes: [{ range: {}, text: '.' }]
            };

            // Test A: when popup was IDLE
            const decisionIdle = controller.decideChange(monacoChange, context, false, false);
            results.push("DecisionIdleAction: " + decisionIdle.action);
            results.push("DecisionIdleReason: " + decisionIdle.reason);
            results.push("DecisionIdleToken: " + decisionIdle.token);

            // Test B: when popup was VISIBLE (e.g. while typing 'b')
            const decisionVisible = controller.decideChange(monacoChange, context, true, false);
            results.push("DecisionVisibleAction: " + decisionVisible.action);
            results.push("DecisionVisibleReason: " + decisionVisible.reason);
            results.push("DecisionVisibleToken: " + decisionVisible.token);

            document.getElementById('test-output').innerText = results.join('\n');
        } catch (err) {
            document.getElementById('test-output').innerText = 'ERROR: ' + err.message + '\n' + err.stack;
        }
    })();
    </script>
</body>
</html>
"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_url = f"file:///{html_path.replace(os.sep, '/')}"
    cmd = [
        browser_exe,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        file_url
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    out = res.stdout

    assert "Qualifier: b" in out, f"Context must detect qualifier 'b': {out}"
    assert "TriggerChar: ." in out, f"Context must detect triggerChar '.': {out}"
    assert "DecisionIdleAction: trigger" in out, f"Must trigger from idle: {out}"
    assert "DecisionIdleToken: b" in out, f"Must pass token 'b': {out}"
    assert "DecisionVisibleAction: trigger" in out, f"Must trigger from visible: {out}"
    assert "DecisionVisibleToken: b" in out, f"Must pass token 'b': {out}"


def test_postgres_debug_toggle_integrity():
    """Verify Bug 4 PostgreSQL debug toggle button integrity across templates, css, and query.js."""
    css_path = os.path.join(WORKSPACE_DIR, "static", "css", "style.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css_content = f.read()

    assert ".ide-action-btn--debug-toggle" in css_content
    assert ".ide-action-btn--debug-toggle .ide-debug-icon" in css_content
    assert ".ide-action-btn--debug-toggle.active" in css_content
    assert "#eab308" in css_content  # light active yellow
    assert "#f97316" in css_content  # dark active orange

    query_path = os.path.join(WORKSPACE_DIR, "static", "js", "query.js")
    with open(query_path, "r", encoding="utf-8") as f:
        query_content = f.read()

    assert "handleRunAction" in query_content
    assert "tab.isDebugActive" in query_content
    assert "executeDebugQuery()" in query_content

    # Check templates
    index_path = os.path.join(WORKSPACE_DIR, "templates", "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        index_content = f.read()
    assert 'class="ide-action-btn ide-action-btn--debug-toggle ide-action-essential d-none"' in index_content
    assert 'class="fa-solid fa-bug ide-debug-icon"' in index_content


def test_run_debug_shortcuts_integrity():
    """Verify F5 / Ctrl+E / Ctrl+Enter shortcuts invoke handleRunAction (supporting debug mode)."""
    editor_path = os.path.join(WORKSPACE_DIR, "static", "js", "editor.js")
    with open(editor_path, "r", encoding="utf-8") as f:
        editor_content = f.read()

    assert "sql-execute-f5" in editor_content
    assert "sql-execute-e" in editor_content
    assert "sql-execute-enter" in editor_content
    assert "handleRunAction" in editor_content

    query_path = os.path.join(WORKSPACE_DIR, "static", "js", "query.js")
    with open(query_path, "r", encoding="utf-8") as f:
        query_content = f.read()

    assert "handleRunAction," in query_content
    assert "window.handleRunAction = handleRunAction;" in query_content
    assert "isRunShortcut" in query_content


def test_headless_intellisense_trigger_general():
    """Verify that AppIntelliSense.trigger runs without ReferenceError and triggers after 'SELECT * FROM '."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_intellisense_trigger_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>IntelliSense Trigger Test</title>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/sql-dialects.js"></script>
    <script src="../static/js/context-analyzer.js"></script>
    <script src="../static/js/scope-resolver.js"></script>
    <script src="../static/js/metadata-cache.js"></script>
    <script src="../static/js/completion-engine.js"></script>
    <script src="../static/js/trigger-controller.js"></script>
    <script src="../static/js/intellisense.js"></script>
</head>
<body>
    <div id="test-output">Running...</div>
    <script>
    (async function() {
        const results = [];
        try {
            // Mock editor adapter
            let text = "SELECT * FROM ";
            let cursorOffset = text.length;
            const mockAdapter = {
                getText: () => text,
                getCursorOffset: () => cursorOffset,
                getCursor: () => ({ line: 1, ch: cursorOffset }),
                getCursorCoordinates: () => ({ top: 100, left: 100 }),
                hasSelection: () => false,
                on: () => {},
                replaceRange: () => {}
            };

            // Test trigger call: must not throw ReferenceError: prevStmtStart is not defined
            const controller = window.AppIntelliSense.getController();
            let triggerThrew = false;
            try {
                await controller.trigger(mockAdapter, false, 'from_join_space');
                results.push("TriggerSuccess: true");
            } catch (err) {
                triggerThrew = true;
                results.push("TriggerError: " + err.message);
            }

            // Test decision on typing space after FROM
            const trigCtrl = window.AppIntelliSense.getTriggerController();
            const ctx = window.SqlContextAnalyzer.analyze(text, cursorOffset);
            const decision = trigCtrl.decideChange({ changes: [{ text: ' ' }] }, ctx, false, false);
            results.push("DecisionAction: " + decision.action);
            results.push("DecisionReason: " + decision.reason);

            document.getElementById('test-output').innerText = results.join('\n');
        } catch (globalErr) {
            document.getElementById('test-output').innerText = 'GLOBAL_ERROR: ' + globalErr.message;
        }
    })();
    </script>
</body>
</html>"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_url = f"file:///{html_path.replace(os.sep, '/')}"
    cmd = [
        browser_exe,
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        file_url
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    out = res.stdout

    assert "TriggerSuccess: true" in out, f"Trigger failed: {out}"
    assert "DecisionAction: trigger" in out, f"Space after FROM must trigger: {out}"


if __name__ == "__main__":
    print("Running test_update_set_source_code_integrity...")
    test_update_set_source_code_integrity()
    print("PASS: test_update_set_source_code_integrity")

    print("Running test_find_widget_focus_protection_integrity...")
    test_find_widget_focus_protection_integrity()
    print("PASS: test_find_widget_focus_protection_integrity")

    print("Running test_responsive_action_bar_overflow_integrity...")
    test_responsive_action_bar_overflow_integrity()
    print("PASS: test_responsive_action_bar_overflow_integrity")

    print("Running test_postgres_debug_toggle_integrity...")
    test_postgres_debug_toggle_integrity()
    print("PASS: test_postgres_debug_toggle_integrity")

    print("Running test_headless_update_set_target_column_isolation...")
    test_headless_update_set_target_column_isolation()
    print("PASS: test_headless_update_set_target_column_isolation")

    print("Running test_headless_dot_trigger_after_alias...")
    test_headless_dot_trigger_after_alias()
    print("PASS: test_headless_dot_trigger_after_alias")

    print("Running test_headless_intellisense_trigger_general...")
    test_headless_intellisense_trigger_general()
    print("PASS: test_headless_intellisense_trigger_general")

    print("\nALL 7 TESTS PASSED SUCCESSFULLY!")


