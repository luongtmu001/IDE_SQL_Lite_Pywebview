import os
import re
import json
import subprocess
import pytest

def find_browser_binary():
    paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return None

def test_phase8_source_code_integrity():
    """Verify CandidateFilter has Sub-Word matching methods and scoring tiers"""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    engine_path = os.path.join(base_dir, 'static', 'js', 'completion-engine.js')

    with open(engine_path, 'r', encoding='utf-8') as f:
        code = f.read()

    assert 'splitSubWords' in code, "CandidateFilter must implement splitSubWords"
    assert 'matchSubWord' in code, "CandidateFilter must implement matchSubWord"
    assert "'subword'" in code, "CandidateFilter must set _matchType to 'subword'"
    assert "subwordMatches" in code, "filter method must collect subwordMatches"
    assert "window.CandidateFilter = CandidateFilter;" in code


def test_phase8_headless_subword_evaluation(tmp_path):
    """Headless browser evaluation for Phase 8 Sub-Word Matching in Monaco Completion Engine"""
    browser_exe = find_browser_binary()
    if not browser_exe:
        pytest.skip("No Chrome or Edge binary found for headless test")

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    html_path = os.path.join(base_dir, 'tests', 'temp_test_subword_phase8.html')

    html_content = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Phase 8 Sub-Word Matching Test</title>
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
        const CandidateFilter = window.CandidateFilter;
        const CompletionRanker = window.CompletionRanker;
        const filter = new CandidateFilter();
        const ranker = new CompletionRanker();

        try {
            // Test 1: Sub-word splitting (PascalCase, camelCase, snake_case, kebab-case, acronyms, brackets, symbols)
            const split1_pascal = CandidateFilter.splitSubWords("CustomerId").map(w => w.raw);
            const split2_camel = CandidateFilter.splitSubWords("orderDetailId").map(w => w.raw);
            const split3_snake = CandidateFilter.splitSubWords("order_detail_id").map(w => w.raw);
            const split4_kebab = CandidateFilter.splitSubWords("order-date").map(w => w.raw);
            const split5_acronym = CandidateFilter.splitSubWords("XMLParser").map(w => w.raw);
            const split6_brackets = CandidateFilter.splitSubWords("[Order Details]").map(w => w.raw);
            const split7_variable = CandidateFilter.splitSubWords("@CustomerCount").map(w => w.raw);
            const split8_temp = CandidateFilter.splitSubWords("#TempOrderSummary").map(w => w.raw);
            const split9_unicode = CandidateFilter.splitSubWords("MãKháchHàng").map(w => w.raw);

            results.test1_splitting = {
                pascal: split1_pascal,
                camel: split2_camel,
                snake: split3_snake,
                kebab: split4_kebab,
                acronym: split5_acronym,
                brackets: split6_brackets,
                variable: split7_variable,
                temp: split8_temp,
                unicode: split9_unicode
            };

            // Test 2: matchSubWord core logic
            // 2A: 'cid' on 'CustomerId' -> matches (c - Customer, id - Id)
            const score_cid_cust = filter.matchSubWord("CustomerId", "cid");
            // 2B: 'odi' on 'order_detail_id' -> matches (o - order, d - detail, i - id)
            const score_odi = filter.matchSubWord("order_detail_id", "odi");
            // 2C: 'co' on 'CustomerOrder' and 'customer_orders'
            const score_co_pascal = filter.matchSubWord("CustomerOrder", "co");
            const score_co_snake = filter.matchSubWord("customer_orders", "co");
            // 2D: 'cO' case bonus on 'CustomerOrder'
            const score_cO_case = filter.matchSubWord("CustomerOrder", "cO");
            // 2E: 'custid' on 'CustomerId' (cust - Customer, id - Id)
            const score_custid = filter.matchSubWord("CustomerId", "custid");
            // 2F: Negative matches
            const score_neg_single = filter.matchSubWord("City", "cid"); // Only 1 sub-word
            const score_neg_nomatch = filter.matchSubWord("CustomerId", "xyz");
            const score_neg_prefix = filter.matchSubWord("CustomerId", "cust"); // Full prefix -> handled by matchPrefix

            results.test2_subword_scores = {
                cid_cust: score_cid_cust,
                odi: score_odi,
                co_pascal: score_co_pascal,
                co_snake: score_co_snake,
                cO_case: score_cO_case,
                custid: score_custid,
                neg_single: score_neg_single,
                neg_nomatch: score_neg_nomatch,
                neg_prefix: score_neg_prefix
            };

            // Test 3: Prioritization tiers in CandidateFilter.filter
            // Prefix matches (80-95) > Sub-Word matches (72-79) > Substring matches (50-70) > Fuzzy matches (10-40)
            const rawCandidates = [
                { name: "SpecialDiscount", type: "column" }, // Fuzzy for 'cid'
                { name: "IncidentDate", type: "column" },   // Substring for 'cid' ('in-cid-ent')
                { name: "CustomerId", type: "column" },     // Sub-Word for 'cid' ('Customer-Id')
                { name: "CidNumber", type: "column" }       // Exact/Prefix for 'cid'
            ];

            const filtered_cid = filter.filter(rawCandidates, "cid");
            results.test3_filter_tiers = {
                filtered: filtered_cid.map(c => ({
                    name: c.name,
                    matchType: c._matchType,
                    matchScore: c._matchScore
                }))
            };

            // Test 4: CompletionRanker DoD: 'cid' puts 'CustomerId' at the top above columns that only contain 'c', 'i', 'd'
            const columnsContext = {
                clause: "SELECT",
                currentWord: "cid"
            };

            const candidatesForRanker = [
                { name: "SpecialDiscount", type: "column" }, // Contains 'c', 'i', 'd'
                { name: "IncidentDate", type: "column" },   // Substring match 'cid'
                { name: "CustomerId", type: "column" },     // Sub-word match 'cid'
                { name: "CreditCardId", type: "column" },   // Sub-word with skipped word 'Card'
                { name: "City", type: "column" }            // Unrelated
            ];

            const filteredForRanker = filter.filter(candidatesForRanker, "cid");
            const ranked = ranker.rank(filteredForRanker, columnsContext, "cid");

            results.test4_ranker_dod = {
                topCandidate: ranked.length > 0 ? ranked[0].name : null,
                rankedOrder: ranked.map(r => ({
                    name: r.name,
                    matchType: r._matchType,
                    matchScore: r._matchScore,
                    finalScore: r._finalScore
                }))
            };

            // Test 5: End-to-end CompletionEngine with query 'cid' in SELECT cid FROM Customers
            const engine = window.DefaultCompletionEngine;
            const cache = window.AppMetadataCache;
            const connId = 'conn_phase8';
            const db = 'SalesDB';
            const schema = 'dbo';
            const tabCtx = { connectionId: connId, database: db, schema: schema, dbType: 'sqlserver' };

            cache.setColumns(connId, db, schema, 'Customers', [
                { name: 'CustomerId', data_type: 'int', is_pk: true },
                { name: 'IncidentDate', data_type: 'datetime' },
                { name: 'SpecialDiscount', data_type: 'decimal' },
                { name: 'CompanyName', data_type: 'nvarchar(100)' },
                { name: 'City', data_type: 'nvarchar(50)' }
            ]);

            const fullSql = "SELECT cid FROM Customers";
            const cursorOffset = fullSql.indexOf("cid") + 3; // cursor at end of "cid"
            const ctx = window.SqlContextAnalyzer.analyze(fullSql, cursorOffset);
            const completions = await engine.getCompletions(fullSql, cursorOffset, ctx, tabCtx);

            results.test5_engine_e2e = {
                hasCompletions: Boolean(completions && completions.length > 0),
                topItem: completions && completions.length > 0 ? completions[0].name : null,
                topScore: completions && completions.length > 0 ? completions[0]._finalScore : 0,
                allNames: completions ? completions.map(c => c.name) : []
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

    # Verify Test 1: Splitting
    t1 = data["test1_splitting"]
    assert t1["pascal"] == ["Customer", "Id"]
    assert t1["camel"] == ["order", "Detail", "Id"]
    assert t1["snake"] == ["order", "detail", "id"]
    assert t1["kebab"] == ["order", "date"]
    assert t1["acronym"] == ["XML", "Parser"]
    assert t1["brackets"] == ["Order", "Details"]
    assert t1["variable"] == ["Customer", "Count"]
    assert t1["temp"] == ["Temp", "Order", "Summary"]
    assert t1["unicode"] == ["Mã", "Khách", "Hàng"]

    # Verify Test 2: Sub-word scores
    t2 = data["test2_subword_scores"]
    assert 72 <= t2["cid_cust"] <= 79
    assert 72 <= t2["odi"] <= 79
    assert 72 <= t2["co_pascal"] <= 79
    assert 72 <= t2["co_snake"] <= 79
    assert t2["cO_case"] >= t2["co_pascal"]  # Case bonus
    assert 72 <= t2["custid"] <= 79
    assert t2["neg_single"] is None
    assert t2["neg_nomatch"] is None
    assert t2["neg_prefix"] is None

    # Verify Test 3: Prioritization tiers
    t3 = data["test3_filter_tiers"]["filtered"]
    names_in_order = [c["name"] for c in t3]
    # CidNumber (prefix) must be before CustomerId (subword)
    assert names_in_order.index("CidNumber") < names_in_order.index("CustomerId")
    # CustomerId (subword) must be before IncidentDate (substring)
    assert names_in_order.index("CustomerId") < names_in_order.index("IncidentDate")
    # IncidentDate (substring) must be before SpecialDiscount (fuzzy)
    assert names_in_order.index("IncidentDate") < names_in_order.index("SpecialDiscount")

    # Verify Test 4: DoD
    t4 = data["test4_ranker_dod"]
    assert t4["topCandidate"] == "CustomerId", f"Expected CustomerId as top candidate, got {t4['topCandidate']}"
    # CustomerId must be ranked before CreditCardId (no skipped words vs skipped word)
    rank_names = [r["name"] for r in t4["rankedOrder"]]
    assert rank_names.index("CustomerId") < rank_names.index("CreditCardId")
    assert rank_names.index("CustomerId") < rank_names.index("IncidentDate")
    assert rank_names.index("CustomerId") < rank_names.index("SpecialDiscount")

    # Verify Test 5: End-to-end Completion Engine
    t5 = data["test5_engine_e2e"]
    assert t5["hasCompletions"] is True
    assert t5["topItem"] == "CustomerId"
    print("\n[PASS] Phase 8 Sub-Word Matching Headless Evaluation passed with 100% compliance!")
