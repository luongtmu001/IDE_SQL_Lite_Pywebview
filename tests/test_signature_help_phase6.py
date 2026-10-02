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


def test_phase6_source_code_integrity():
    """Verify Phase 6 Signature Help engine and Monaco provider registrations in source code."""
    # 1. completion-engine.js checks
    eng_path = os.path.join(WORKSPACE_DIR, "static", "js", "completion-engine.js")
    with open(eng_path, "r", encoding="utf-8") as f:
        eng_code = f.read()

    assert "PARAMETER_DOCS" in eng_code, "PARAMETER_DOCS dictionary must exist"
    assert "parseSignatureParameters" in eng_code, "parseSignatureParameters helper must exist"
    assert "SqlSignatureHelpResolver" in eng_code, "SqlSignatureHelpResolver class must exist"
    assert "registerMonacoProvider" in eng_code, "registerMonacoProvider method must exist"
    assert "registerSignatureHelpProvider" in eng_code, "Must register signature help provider with monaco"
    assert "signatureHelpTriggerCharacters" in eng_code, "Must specify signatureHelpTriggerCharacters"
    assert "window.SqlSignatureHelpResolver" in eng_code, "Must export SqlSignatureHelpResolver"

    # 2. editor-adapter.js checks
    adapter_path = os.path.join(WORKSPACE_DIR, "static", "js", "editor-adapter.js")
    with open(adapter_path, "r", encoding="utf-8") as f:
        adapter_code = f.read()

    assert "triggerSignatureHelp" in adapter_code, "EditorAdapter must expose triggerSignatureHelp"
    assert "editor.action.triggerParameterHints" in adapter_code, "Must trigger Monaco parameter hints action"

    # 3. intellisense.js checks
    is_path = os.path.join(WORKSPACE_DIR, "static", "js", "intellisense.js")
    with open(is_path, "r", encoding="utf-8") as f:
        is_code = f.read()

    assert "SqlSignatureHelpResolver" in is_code, "intellisense.js must coordinate with SqlSignatureHelpResolver"
    assert "getSignatureHelp" in is_code, "AppIntelliSense must expose getSignatureHelp API"

    # 4. monaco-sql-lang.js checks
    sql_lang_path = os.path.join(WORKSPACE_DIR, "static", "js", "monaco-sql-lang.js")
    with open(sql_lang_path, "r", encoding="utf-8") as f:
        lang_code = f.read()

    assert "SqlSignatureHelpResolver" in lang_code, "monaco-sql-lang.js must hook into SqlSignatureHelpResolver"


def test_phase6_headless_signature_help_evaluation():
    """Verify Phase 6 parameter highlighting, nested calls, EXEC, and UDFs in headless browser."""
    browser_exe = find_browser()
    if not browser_exe:
        pytest.skip("No Chrome or Edge browser found on host")

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_phase6_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 6 Signature Help Test</title>
    <script src="../static/js/sql-tokenizer.js"></script>
    <script src="../static/js/sql-dialects.js"></script>
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
        const resolver = window.SqlSignatureHelpResolver;

        try {
            // Mock DataProvider for UDF and Stored Procedures
            const mockDataProvider = {
                async fetchParameters(connectionId, db, schema, name, dbType) {
                    const upper = (name || '').toUpperCase();
                    if (upper === 'USP_GETCUSTOMERORDERS') {
                        return [
                            { name: '@CustomerId', data_type: 'int', direction: 'IN', is_output: false },
                            { name: '@FromDate', data_type: 'datetime', direction: 'IN', is_output: false },
                            { name: '@TotalCount', data_type: 'int', direction: 'OUT', is_output: true }
                        ];
                    }
                    if (upper === 'FN_CALCULATETAX') {
                        return [
                            { name: '@Subtotal', data_type: 'decimal(18,2)', direction: 'IN', is_output: false },
                            { name: '@TaxRate', data_type: 'decimal(5,2)', direction: 'IN', is_output: false }
                        ];
                    }
                    return [];
                }
            };
            resolver.setDataProvider(mockDataProvider);

            // Test 1: Built-in DATEADD(|
            const sql1 = "SELECT DATEADD(";
            const res1 = await resolver.resolve(sql1, sql1.length);
            results.test1_dateadd_open = {
                sigLabel: res1 ? res1.signatures[0].label : null,
                activeParam: res1 ? res1.activeParameter : -1,
                paramCount: res1 ? res1.signatures[0].parameters.length : 0,
                activeParamLabel: res1 ? res1.signatures[0].parameters[res1.activeParameter].label : null,
                hasDoc: Boolean(res1 && res1.signatures[0].parameters[0].documentation)
            };

            // Test 2: DATEADD(day, |
            const sql2 = "SELECT DATEADD(day, ";
            const res2 = await resolver.resolve(sql2, sql2.length);
            results.test2_dateadd_param1 = {
                activeParam: res2 ? res2.activeParameter : -1,
                activeParamLabel: res2 ? res2.signatures[0].parameters[res2.activeParameter].label : null
            };

            // Test 3: DATEADD(day, 1, |
            const sql3 = "SELECT DATEADD(day, 1, ";
            const res3 = await resolver.resolve(sql3, sql3.length);
            results.test3_dateadd_param2 = {
                activeParam: res3 ? res3.activeParameter : -1,
                activeParamLabel: res3 ? res3.signatures[0].parameters[res3.activeParameter].label : null
            };

            // Test 4: Nested Call - inside DATEDIFF: DATEADD(day, DATEDIFF(month, '2020-01-01', |
            const sql4 = "SELECT DATEADD(day, DATEDIFF(month, '2020-01-01', ";
            const res4 = await resolver.resolve(sql4, sql4.length);
            results.test4_nested_inner = {
                sigLabel: res4 ? res4.signatures[0].label : null,
                activeParam: res4 ? res4.activeParameter : -1,
                activeParamLabel: res4 ? res4.signatures[0].parameters[res4.activeParameter].label : null
            };

            // Test 5: Nested Call - after DATEDIFF closes: DATEADD(day, DATEDIFF(month, '2020-01-01', '2020-02-01'), |
            const sql5 = "SELECT DATEADD(day, DATEDIFF(month, '2020-01-01', '2020-02-01'), ";
            const res5 = await resolver.resolve(sql5, sql5.length);
            results.test5_nested_outer = {
                sigLabel: res5 ? res5.signatures[0].label : null,
                activeParam: res5 ? res5.activeParameter : -1,
                activeParamLabel: res5 ? res5.signatures[0].parameters[res5.activeParameter].label : null
            };

            // Test 6: Variadic COALESCE(a, b, c, d, |
            const sql6 = "SELECT COALESCE(a, b, c, d, ";
            const res6 = await resolver.resolve(sql6, sql6.length);
            results.test6_variadic_coalesce = {
                activeParam: res6 ? res6.activeParameter : -1,
                activeParamLabel: res6 ? res6.signatures[0].parameters[res6.activeParameter].label : null
            };

            // Test 7: Non-function parenthesis: WHERE id IN (1, 2, |
            const sql7 = "SELECT * FROM Users WHERE id IN (1, 2, ";
            const res7 = await resolver.resolve(sql7, sql7.length);
            results.test7_non_func_in = {
                isNull: (res7 === null)
            };

            // Test 8: String & Comment Guard
            const sql8_str = "SELECT 'DATEADD('";
            const res8_str = await resolver.resolve(sql8_str, 12); // inside string
            const sql8_comment = "-- SELECT DATEADD(";
            const res8_comment = await resolver.resolve(sql8_comment, sql8_comment.length);
            results.test8_guards = {
                stringIsNull: (res8_str === null),
                commentIsNull: (res8_comment === null)
            };

            // Test 9: Stored Procedure EXEC dbo.usp_GetCustomerOrders |
            const sql9 = "EXEC dbo.usp_GetCustomerOrders ";
            const res9 = await resolver.resolve(sql9, sql9.length, { connectionId: 'c1', database: 'Northwind' });
            results.test9_exec_positional_0 = {
                sigLabel: res9 ? res9.signatures[0].label : null,
                activeParam: res9 ? res9.activeParameter : -1,
                activeParamLabel: res9 ? res9.signatures[0].parameters[res9.activeParameter].label : null
            };

            // Test 10: Stored Procedure Positional: EXEC dbo.usp_GetCustomerOrders 10, |
            const sql10 = "EXEC dbo.usp_GetCustomerOrders 10, ";
            const res10 = await resolver.resolve(sql10, sql10.length, { connectionId: 'c1', database: 'Northwind' });
            results.test10_exec_positional_1 = {
                activeParam: res10 ? res10.activeParameter : -1,
                activeParamLabel: res10 ? res10.signatures[0].parameters[res10.activeParameter].label : null
            };

            // Test 11: Stored Procedure Named Param: EXEC dbo.usp_GetCustomerOrders @FromDate = |
            const sql11 = "EXEC dbo.usp_GetCustomerOrders @FromDate = ";
            const res11 = await resolver.resolve(sql11, sql11.length, { connectionId: 'c1', database: 'Northwind' });
            results.test11_exec_named = {
                activeParam: res11 ? res11.activeParameter : -1,
                activeParamLabel: res11 ? res11.signatures[0].parameters[res11.activeParameter].label : null
            };

            // Test 12: User-Defined Function: SELECT dbo.fn_CalculateTax(100.5, |
            const sql12 = "SELECT dbo.fn_CalculateTax(100.5, ";
            const res12 = await resolver.resolve(sql12, sql12.length, { connectionId: 'c1', database: 'Northwind' });
            results.test12_udf = {
                sigLabel: res12 ? res12.signatures[0].label : null,
                activeParam: res12 ? res12.activeParameter : -1,
                activeParamLabel: res12 ? res12.signatures[0].parameters[res12.activeParameter].label : null
            };

            // Test 13: AppIntelliSense and CompletionEngine facades
            const res13_facade = await window.AppIntelliSense.getSignatureHelp(sql1, sql1.length);
            const res13_engine = await window.CompletionEngine.getSignatureHelp(sql1, sql1.length);
            results.test13_facades = {
                appIntelliSenseMatches: Boolean(res13_facade && res13_facade.signatures.length > 0),
                completionEngineMatches: Boolean(res13_engine && res13_engine.signatures.length > 0)
            };

            // Test 14: Monaco registerSignatureHelpProvider contract
            let registeredProvider = null;
            let registeredTriggers = null;
            window.monaco = {
                languages: {
                    registerSignatureHelpProvider(langId, provider) {
                        registeredProvider = provider;
                        registeredTriggers = provider.signatureHelpTriggerCharacters;
                        return { dispose: () => {} };
                    }
                }
            };
            window._sqlSignatureHelpRegistered = false;
            window.SqlSignatureHelpResolver.constructor.registerMonacoProvider();

            const mockModel = {
                getValue: () => "SELECT DATEADD(day, 1, ",
                getOffsetAt: (pos) => 23
            };
            const sigResult = await registeredProvider.provideSignatureHelp(mockModel, { lineNumber: 1, column: 24 });
            results.test14_monaco_provider = {
                isRegistered: Boolean(registeredProvider),
                triggers: registeredTriggers,
                hasValue: Boolean(sigResult && sigResult.value),
                activeParam: sigResult ? sigResult.value.activeParameter : -1,
                hasDispose: Boolean(sigResult && typeof sigResult.dispose === 'function')
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
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    output = proc.stdout

    # Extract JSON inside <div id="test-output">...</div>
    match = re.search(r'<div id="test-output">(.*?)</div>', output, re.DOTALL)
    assert match, f"Could not find test-output in browser DOM. Output:\n{output}"

    data_str = match.group(1).strip()
    data = json.loads(data_str)
    assert "error" not in data, f"JavaScript runtime error: {data.get('error')} \n {data.get('stack')}"

    # Verify Test 1: DATEADD(|
    t1 = data["test1_dateadd_open"]
    assert "DATEADD(datepart, number, date)" in t1["sigLabel"]
    assert t1["activeParam"] == 0, "DATEADD(| must have activeParameter = 0"
    assert t1["activeParamLabel"] == "datepart", "DATEADD(| must bold datepart parameter"
    assert t1["hasDoc"] is True, "Parameter must have documentation"

    # Verify Test 2: DATEADD(day, |
    t2 = data["test2_dateadd_param1"]
    assert t2["activeParam"] == 1, "DATEADD(day, | must have activeParameter = 1"
    assert t2["activeParamLabel"] == "number", "Parameter 1 must be number"

    # Verify Test 3: DATEADD(day, 1, |
    t3 = data["test3_dateadd_param2"]
    assert t3["activeParam"] == 2, "DATEADD(day, 1, | must have activeParameter = 2"
    assert t3["activeParamLabel"] == "date", "Parameter 2 must be date"

    # Verify Test 4: Nested Call - inside DATEDIFF
    t4 = data["test4_nested_inner"]
    assert "DATEDIFF" in t4["sigLabel"], "Enclosing inner function must be DATEDIFF"
    assert t4["activeParam"] == 2, "Must be at parameter 2 of DATEDIFF"
    assert t4["activeParamLabel"] == "enddate"

    # Verify Test 5: Nested Call - outer DATEADD after nested closes
    t5 = data["test5_nested_outer"]
    assert "DATEADD" in t5["sigLabel"], "Enclosing outer function must be DATEADD"
    assert t5["activeParam"] == 2, "Must be at parameter 2 of DATEADD"
    assert t5["activeParamLabel"] == "date"

    # Verify Test 6: Variadic COALESCE
    t6 = data["test6_variadic_coalesce"]
    assert t6["activeParamLabel"] == "...", "COALESCE at param 4 must point to variadic ellipsis ..."

    # Verify Test 7: Non-function IN (...) guard
    t7 = data["test7_non_func_in"]
    assert t7["isNull"] is True, "WHERE id IN (...) must not show function signature help"

    # Verify Test 8: Comment and string guards
    t8 = data["test8_guards"]
    assert t8["stringIsNull"] is True, "Inside string literal must degrade gracefully"
    assert t8["commentIsNull"] is True, "Inside comment line must degrade gracefully"

    # Verify Test 9: Stored procedure EXEC open
    t9 = data["test9_exec_positional_0"]
    assert "EXEC dbo.usp_GetCustomerOrders" in t9["sigLabel"]
    assert t9["activeParam"] == 0
    assert t9["activeParamLabel"] == "@CustomerId"

    # Verify Test 10: Stored procedure EXEC positional 1
    t10 = data["test10_exec_positional_1"]
    assert t10["activeParam"] == 1
    assert t10["activeParamLabel"] == "@FromDate"

    # Verify Test 11: Stored procedure EXEC named param
    t11 = data["test11_exec_named"]
    assert t11["activeParam"] == 1, "@FromDate named param must jump to index 1"
    assert t11["activeParamLabel"] == "@FromDate"

    # Verify Test 12: User-Defined Function (UDF)
    t12 = data["test12_udf"]
    assert "fn_CalculateTax" in t12["sigLabel"]
    assert t12["activeParam"] == 1
    assert t12["activeParamLabel"] == "@TaxRate"

    # Verify Test 13: Facades
    t13 = data["test13_facades"]
    assert t13["appIntelliSenseMatches"] is True
    assert t13["completionEngineMatches"] is True

    # Verify Test 14: Monaco registerSignatureHelpProvider contract
    t14 = data["test14_monaco_provider"]
    assert t14["isRegistered"] is True, "Must register with monaco.languages.registerSignatureHelpProvider"
    assert "(" in t14["triggers"] and "," in t14["triggers"], "Trigger characters must include '(' and ','"
    assert t14["hasValue"] is True, "provideSignatureHelp must return an object with value property"
    assert t14["activeParam"] == 2, "Monaco call must resolve activeParameter = 2 for DATEADD(day, 1, "
    assert t14["hasDispose"] is True, "Monaco result must provide dispose function"

