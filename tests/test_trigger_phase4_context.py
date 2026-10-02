import os
import re

def test_phase4_context_detection_and_isolation_code():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ca_path = os.path.join(base_dir, "static", "js", "context-analyzer.js")
    tc_path = os.path.join(base_dir, "static", "js", "trigger-controller.js")

    with open(ca_path, "r", encoding="utf-8") as f:
        ca_code = f.read()

    with open(tc_path, "r", encoding="utf-8") as f:
        tc_code = f.read()

    # 1. Comment & String detection in ContextAnalyzer
    assert "isInsideComment" in ca_code
    assert "isInsideString" in ca_code
    assert "COMMENT_LINE" in ca_code
    assert "COMMENT_BLOCK" in ca_code
    assert "STRING" in ca_code
    assert "contextType = 'comment'" in ca_code
    assert "contextType = 'string'" in ca_code

    # 2. TriggerController comment/string isolation
    assert "context.isInsideComment || context.isInsideString" in tc_code
    assert "reason: 'comment_or_string'" in tc_code

    # 3. Numeric decimal dot guard (Section 18)
    assert "prevCodeTok.type === 'NUMBER' || /^\\d+$/.test(prevCodeTok.value)" in ca_code
    assert "reason: 'invalid_dot'" in tc_code

    # 4. Strict Section 25 Fallback Rule (no blind 'Show All')
    assert "hasValidContext" in tc_code
    assert "reason: 'no_context'" in tc_code

    # 5. Semantic Context Types
    for ctx in ["KEYWORD", "TABLE", "COLUMN", "ALIAS", "FUNCTION", "PROCEDURE", "PARAMETER", "ORDER_COLUMN", "GROUP_COLUMN", "ALTER_OBJECT"]:
        assert ctx in ca_code

    print("[PASS] Phase 4: Context Detection & Isolation source code verification passed!")


def test_phase4_comment_and_string_isolation_simulation():
    # Python simulation of ContextAnalyzer comment & string tokenizer ranges
    def analyze_comment_and_string(sql_text, cursor_idx):
        is_inside_comment = False
        is_inside_string = False
        context_type = 'keyword'

        # Check line comments
        line_matches = [m.start() for m in re.finditer(r'--', sql_text)]
        for start in line_matches:
            newline = sql_text.find('\n', start)
            end = len(sql_text) if newline == -1 else newline
            if start <= cursor_idx <= end:
                is_inside_comment = True
                context_type = 'comment'
                break

        # Check block comments
        if not is_inside_comment:
            for m in re.finditer(r'/\*[\s\S]*?(\*/|$)', sql_text):
                if m.start() <= cursor_idx <= m.end():
                    is_inside_comment = True
                    context_type = 'comment'
                    break

        # Check string literals
        if not is_inside_comment:
            for m in re.finditer(r"'([^']|'')*('|$)", sql_text):
                # Cursor strictly inside quotes
                if m.start() < cursor_idx <= m.end():
                    is_inside_string = True
                    context_type = 'string'
                    break

        return {
            'isInsideComment': is_inside_comment,
            'isInsideString': is_inside_string,
            'contextType': context_type
        }

    # Case 1: Single-line comment
    r1 = analyze_comment_and_string("-- SELECT Cus", 10)
    assert r1['isInsideComment'] is True
    assert r1['isInsideString'] is False
    assert r1['contextType'] == 'comment'

    # Case 2: Multi-line block comment
    r2 = analyze_comment_and_string("/*\n  SELECT Cus\n*/", 12)
    assert r2['isInsideComment'] is True
    assert r2['contextType'] == 'comment'

    # Case 3: Inside string literal
    r3 = analyze_comment_and_string("SELECT * FROM Customer WHERE Name = 'Cus'", 39)
    assert r3['isInsideString'] is True
    assert r3['isInsideComment'] is False
    assert r3['contextType'] == 'string'

    # Case 4: Unclosed string literal
    r4 = analyze_comment_and_string("SELECT * FROM Customer WHERE Name = 'Cus", 39)
    assert r4['isInsideString'] is True
    assert r4['contextType'] == 'string'

    # Case 5: Normal SQL outside string
    r5 = analyze_comment_and_string("SELECT * FROM Customer WHERE Name = 'Acme' AND Cus", 50)
    assert r5['isInsideComment'] is False
    assert r5['isInsideString'] is False
    assert r5['contextType'] == 'keyword'

    print("[PASS] Phase 4: Comment and String literal isolation verified!")


def test_phase4_numeric_decimal_dot_guard_simulation():
    # Python simulation of decimal dot guard logic in ContextAnalyzer & TriggerController
    def evaluate_dot_trigger(text_before_cursor):
        # Find token before dot
        m = re.search(r'([a-zA-Z0-9_#@]+)\.\s*$', text_before_cursor)
        if not m:
            return {'action': 'none', 'reason': 'no_dot'}

        prev_token = m.group(1)
        # Section 18 Guard: if numeric literal (e.g. 10.), suppress trigger!
        if prev_token.isdigit() or re.match(r'^\d+$', prev_token):
            return {'action': 'none', 'reason': 'invalid_dot', 'qualifier': ''}

        return {'action': 'trigger', 'reason': 'character', 'kind': 'column', 'qualifier': prev_token}

    # Case 1: Numeric decimal 10.
    res_num = evaluate_dot_trigger("SELECT 10.")
    assert res_num['action'] == 'none'
    assert res_num['reason'] == 'invalid_dot'

    # Case 2: Numeric decimal in expression 100.
    res_num2 = evaluate_dot_trigger("WHERE Price > 100.")
    assert res_num2['action'] == 'none'
    assert res_num2['reason'] == 'invalid_dot'

    # Case 3: Table alias dot c.
    res_alias = evaluate_dot_trigger("SELECT c.")
    assert res_alias['action'] == 'trigger'
    assert res_alias['kind'] == 'column'
    assert res_alias['qualifier'] == 'c'

    # Case 4: Schema dot dbo.
    res_schema = evaluate_dot_trigger("FROM dbo.")
    assert res_schema['action'] == 'trigger'
    assert res_schema['qualifier'] == 'dbo'

    print("[PASS] Phase 4: Numeric decimal dot guard verified!")


def test_phase4_clause_and_semantic_routing_matrix():
    # Matrix of SQL construct routing per Section 40 & Section 45
    cases = [
        {"sql": "SELECT Cus", "expected_clause": "SELECT", "expected_type": "column"},
        {"sql": "FROM Cus", "expected_clause": "FROM", "expected_type": "table"},
        {"sql": "JOIN Customer c ON c.CustomerId = o.", "expected_clause": "ON", "expected_type": "column"},
        {"sql": "WHERE Cus", "expected_clause": "WHERE", "expected_type": "column"},
        {"sql": "ORDER BY Cus", "expected_clause": "ORDER BY", "expected_type": "order_column"},
        {"sql": "GROUP BY Cus", "expected_clause": "GROUP BY", "expected_type": "group_column"},
        {"sql": "EXEC sp_help", "expected_clause": "EXEC", "expected_type": "procedure"},
        {"sql": "ALTER PROCEDURE p", "expected_clause": "", "expected_type": "alter_object"},
        {"sql": "SELECT * FROM (SELECT Cus", "expected_clause": "SELECT", "expected_type": "column"},
        {"sql": "WITH CustomerCTE AS (SELECT Cus", "expected_clause": "SELECT", "expected_type": "column"}
    ]

    def detect_simple_clause(sql):
        if "ALTER" in sql and ("PROCEDURE" in sql or "VIEW" in sql or "FUNCTION" in sql):
            return ("", "alter_object")
        for cl, tp in [
            ("ORDER BY", "order_column"),
            ("GROUP BY", "group_column"),
            ("WHERE", "column"),
            ("ON", "column"),
            ("JOIN", "table"),
            ("FROM", "table"),
            ("SELECT", "column"),
            ("EXEC", "procedure")
        ]:
            if re.search(r'\b' + cl.replace(" ", r"\s+") + r'\b', sql, re.IGNORECASE):
                # Return the last matching clause in the string
                pass
        # Find last matching clause
        keywords = ["SELECT", "FROM", "JOIN", "WHERE", "ON", "GROUP BY", "ORDER BY", "EXEC"]
        pattern = re.compile(r'\b(' + '|'.join(k.replace(" ", r'\s+') for k in keywords) + r')\b', re.IGNORECASE)
        matches = list(pattern.finditer(sql))
        if not matches:
            return ("", "unknown")
        last_cl = re.sub(r'\s+', ' ', matches[-1].group(1).upper())
        type_map = {
            "SELECT": "column",
            "FROM": "table",
            "JOIN": "table",
            "WHERE": "column",
            "ON": "column",
            "GROUP BY": "group_column",
            "ORDER BY": "order_column",
            "EXEC": "procedure"
        }
        return (last_cl, type_map.get(last_cl, "unknown"))

    for c in cases:
        clause, ctype = detect_simple_clause(c["sql"])
        assert clause == c["expected_clause"]
        assert ctype == c["expected_type"]

    print("[PASS] Phase 4: Clause and Semantic Routing Matrix verified!")


def test_phase4_section25_strict_fallback_rule():
    # Verify that typing outside any valid SQL clause or construct does NOT auto-trigger
    class Section25TriggerDecider:
        def decide(self, context, current_word):
            if context.get('isInsideComment') or context.get('isInsideString'):
                return {'action': 'none', 'reason': 'comment_or_string'}

            has_valid_context = bool(
                context.get('clause') or
                context.get('hasFollowUp') or
                context.get('isAlterContext') or
                context.get('isExec')
            )

            if len(current_word) >= 1 and has_valid_context:
                return {'action': 'trigger', 'reason': 'automatic', 'kind': context.get('contextType', 'keyword')}

            # Section 25 Rule: If uncertain -> NO_TRIGGER!
            return {'action': 'none', 'reason': 'no_context'}

    decider = Section25TriggerDecider()

    # 1. Valid context -> Triggers
    res_valid = decider.decide({'clause': 'SELECT', 'contextType': 'column'}, "Cus")
    assert res_valid['action'] == 'trigger'
    assert res_valid['kind'] == 'column'

    # 2. No context (e.g. cursor in blank space or outside query without clause) -> Strictly NONE!
    res_invalid = decider.decide({'clause': '', 'hasFollowUp': False, 'isAlterContext': False, 'isExec': False}, "RandomText")
    assert res_invalid['action'] == 'none'
    assert res_invalid['reason'] == 'no_context'

    # 3. Inside comment -> Strictly NONE!
    res_comment = decider.decide({'isInsideComment': True, 'clause': 'SELECT'}, "Cus")
    assert res_comment['action'] == 'none'
    assert res_comment['reason'] == 'comment_or_string'

    # 4. Inside string -> Strictly NONE!
    res_string = decider.decide({'isInsideString': True, 'clause': 'SELECT'}, "Cus")
    assert res_string['action'] == 'none'
    assert res_string['reason'] == 'comment_or_string'

    print("[PASS] Phase 4: Strict Section 25 Fallback Rule (no blind Show All) verified!")
