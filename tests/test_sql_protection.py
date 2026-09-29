import json
import re
import sys
from pathlib import Path
from unittest.mock import MagicMock
import pytest

if "webview" not in sys.modules:
    try:
        import webview
    except ImportError:
        sys.modules["webview"] = MagicMock()

from main import _load_settings_file


def test_settings_json_has_sqlprotection():
    settings_file = Path("data/settings.json")
    assert settings_file.exists(), "data/settings.json must exist"
    data = json.loads(settings_file.read_text(encoding="utf-8"))
    assert "sql" in data, "data/settings.json must have 'sql' section"
    assert "sqlprotection" in data["sql"], "sql section must have 'sqlprotection'"
    assert data["sql"]["sqlprotection"] == 1, "sqlprotection must default to 1"


def test_main_load_settings_file_defaults_sqlprotection():
    settings = _load_settings_file()
    assert "sql" in settings
    assert settings["sql"].get("sqlprotection") == 1


def test_settings_js_exposes_sqlprotection():
    settings_js = Path("static/js/settings.js").read_text(encoding="utf-8")
    assert "key: 'sqlprotection'" in settings_js
    assert "sqlprotection: 1" in settings_js
    assert "window._sqlConfig.sqlprotection" in settings_js


def test_sql_protection_js_and_css_exist():
    js_path = Path("static/js/sql-protection.js")
    css_path = Path("static/css/sql-protection.css")
    assert js_path.exists(), "static/js/sql-protection.js must exist"
    assert css_path.exists(), "static/css/sql-protection.css must exist"

    js_content = js_path.read_text(encoding="utf-8")
    assert "isProtectionEnabled" in js_content
    assert "tokenizeSql" in js_content
    assert "detectFatalSqlActions" in js_content
    assert "showFatalActionsGuard" in js_content
    assert "SSMSBoost Fatal Actions Guard" in js_content


def test_index_html_contains_fatal_actions_guard():
    index_html = Path("templates/index.html").read_text(encoding="utf-8")
    assert "sql-protection.css" in index_html
    assert "sql-protection.js" in index_html
    assert 'id="fatalActionsGuardBackdrop"' in index_html
    assert "SSMSBoost Fatal Actions Guard" in index_html
    assert 'id="fatalGuardYesBtn"' in index_html
    assert 'id="fatalGuardNoBtn"' in index_html
    assert 'id="fatalGuardRows"' in index_html
    assert "Potential problems detected in your query" in index_html


def test_query_js_calls_sql_protection():
    query_js = Path("static/js/query.js").read_text(encoding="utf-8")
    assert "window.SqlProtection" in query_js
    assert "window.SqlProtection.detectFatalSqlActions" in query_js
    assert "window.SqlProtection.showFatalActionsGuard" in query_js


class SimpleSqlDetectorPython:
    """Python reference equivalent to static/js/sql-protection.js for testing test cases"""

    @staticmethod
    def detect(sql_text: str, base_start_line: int = 1):
        # Remove single and multi line comments
        def strip_comments_keep_lines(text):
            lines = []
            in_multiline = False
            for line in text.splitlines():
                if in_multiline:
                    if "*/" in line:
                        line = line[line.index("*/") + 2:]
                        in_multiline = False
                    else:
                        lines.append("")
                        continue
                if "/*" in line:
                    if "*/" in line:
                        line = re.sub(r'/\*.*?\*/', ' ', line)
                    else:
                        line = line[:line.index("/*")]
                        in_multiline = True
                if "--" in line:
                    line = line[:line.index("--")]
                lines.append(line)
            return "\n".join(lines)

        cleaned = strip_comments_keep_lines(sql_text)
        issues = []

        tokens_with_lines = []
        for line_no, line_content in enumerate(cleaned.splitlines(), start=1):
            for m in re.finditer(r'[a-zA-Z0-9_#$@]+|[;()]', line_content):
                tokens_with_lines.append((m.group(0), line_no))

        terminators = {
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
            'CREATE', 'ALTER', 'DROP', 'MERGE', 'EXEC', 'EXECUTE',
            'BEGIN', 'END', 'COMMIT', 'ROLLBACK', ';'
        }
        ignore_prev = {'ON', 'OF', 'FOR', 'BEFORE', 'AFTER', 'THEN'}

        for idx, (tok_raw, line_no) in enumerate(tokens_with_lines):
            tok = tok_raw.upper()
            prev_tok = tokens_with_lines[idx - 1][0].upper() if idx > 0 else None
            next_tok = tokens_with_lines[idx + 1][0].upper() if idx + 1 < len(tokens_with_lines) else None

            if tok == 'TRUNCATE':
                issues.append(('TRUNCATE', 'TRUNCATE statement', line_no + base_start_line - 1))
            elif tok == 'DELETE':
                if prev_tok in ignore_prev or next_tok == '(':
                    continue
                paren = 0
                has_where = False
                for j in range(idx + 1, len(tokens_with_lines)):
                    t_val, _ = tokens_with_lines[j]
                    if t_val == '(':
                        paren += 1
                    elif t_val == ')':
                        if paren > 0:
                            paren -= 1
                    elif paren == 0:
                        if t_val.upper() == 'WHERE':
                            has_where = True
                        elif t_val == ';' or t_val.upper() in terminators:
                            break
                if not has_where:
                    issues.append(('DELETE', 'DELETE statement without WHERE clause', line_no + base_start_line - 1))
            elif tok == 'UPDATE':
                if prev_tok in ignore_prev or next_tok == '(' or next_tok == 'STATISTICS':
                    continue
                paren = 0
                has_where = False
                for j in range(idx + 1, len(tokens_with_lines)):
                    t_val, _ = tokens_with_lines[j]
                    if t_val == '(':
                        paren += 1
                    elif t_val == ')':
                        if paren > 0:
                            paren -= 1
                    elif paren == 0:
                        if t_val.upper() == 'WHERE':
                            has_where = True
                        elif t_val == ';' or t_val.upper() in terminators:
                            break
                if not has_where:
                    issues.append(('UPDATE', 'UPDATE statement without WHERE clause', line_no + base_start_line - 1))

        return issues


def test_sql_detection_cases():
    detector = SimpleSqlDetectorPython()

    # Case 1: Safe queries
    res = detector.detect("SELECT * FROM Users WHERE id = 1")
    assert len(res) == 0

    res = detector.detect("UPDATE Users SET name = 'A' WHERE id = 1")
    assert len(res) == 0

    res = detector.detect("DELETE FROM Users WHERE id = 1")
    assert len(res) == 0

    # Case 2: Temp table without WHERE
    res = detector.detect("UPDATE #temp SET val = 1")
    assert len(res) == 1
    assert res[0][1] == "UPDATE statement without WHERE clause"

    res = detector.detect("DELETE FROM #temp")
    assert len(res) == 1
    assert res[0][1] == "DELETE statement without WHERE clause"

    res = detector.detect("TRUNCATE TABLE #temp")
    assert len(res) == 1
    assert res[0][1] == "TRUNCATE statement"

    # Case 3: Real table without WHERE
    res = detector.detect("UPDATE [dbo].[Customers] SET Active = 0;")
    assert len(res) == 1

    res = detector.detect("DELETE Customers;")
    assert len(res) == 1

    # Case 4: Multiple statements
    script = """
    SELECT * FROM Logs;
    UPDATE Customers SET Active = 0;
    DELETE FROM #temp;
    TRUNCATE TABLE OldData;
    """
    res = detector.detect(script)
    assert len(res) == 3
    msgs = [r[1] for r in res]
    assert "UPDATE statement without WHERE clause" in msgs
    assert "DELETE statement without WHERE clause" in msgs
    assert "TRUNCATE statement" in msgs

    # Case 5: Constraints & Ignored
    script_fk = """
    CREATE TABLE OrderItems (
        Id INT,
        CONSTRAINT FK_Orders FOREIGN KEY (OrderId) REFERENCES Orders(Id)
        ON UPDATE CASCADE ON DELETE CASCADE
    );
    """
    assert len(detector.detect(script_fk)) == 0

    # Case 6: Subquery inside SET has WHERE but outer statement does not
    script_subquery = "UPDATE Customers SET Name = (SELECT Name FROM Other WHERE id = 1);"
    res = detector.detect(script_subquery)
    assert len(res) == 1
    assert res[0][1] == "UPDATE statement without WHERE clause"
