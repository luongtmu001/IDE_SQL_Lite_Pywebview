"""
Unit and Integration Tests for:
- Section 35: Format Code (Dialect-aware, Selection vs Document, Confirmation Dialog)
- Sections 36-48: Goto Begin / Goto End (SqlBlockAnalyzer, Block pairing, Nested blocks,
  String/Comment isolation, Dynamic SQL, SSMS & PostgreSQL syntax)
Reference: .SKILL/Object_Explorer_Filter_Context_Menu_Synonyms_Plan.md
"""

from pathlib import Path
import re
import pytest


# ══════════════════════════════════════════════════════════════════════════════
# Python port of SqlBlockAnalyzer for algorithmic validation
# ══════════════════════════════════════════════════════════════════════════════

class PySqlBlockAnalyzer:
    @staticmethod
    def tokenize(sql: str, dialect: str = "sqlserver"):
        tokens = []
        if not sql:
            return tokens

        is_pg = "postgr" in dialect.lower()
        length = len(sql)
        i = 0

        while i < length:
            ch = sql[i]
            next_ch = sql[i + 1] if i + 1 < length else ""

            # 1. Whitespace
            if ch.isspace():
                i += 1
                continue

            # 2. Line comment --
            if ch == "-" and next_ch == "-":
                i += 2
                while i < length and sql[i] != "\n":
                    i += 1
                continue

            # 3. Block comment /* ... */
            if ch == "/" and next_ch == "*":
                i += 2
                while i < length and not (sql[i] == "*" and i + 1 < length and sql[i + 1] == "/"):
                    i += 1
                if i < length:
                    i += 2
                continue

            # 4. String literal '...' or N'...'
            if ch == "'" or ((ch in ("N", "n") or (is_pg and ch in ("E", "e"))) and next_ch == "'"):
                if ch in ("N", "n", "E", "e"):
                    i += 1
                i += 1
                while i < length:
                    if sql[i] == "'":
                        if i + 1 < length and sql[i + 1] == "'":
                            i += 2
                            continue
                        else:
                            i += 1
                            break
                    i += 1
                continue

            # 5. Square bracket identifier [ident]
            if not is_pg and ch == "[":
                i += 1
                while i < length:
                    if sql[i] == "]":
                        if i + 1 < length and sql[i + 1] == "]":
                            i += 2
                            continue
                        else:
                            i += 1
                            break
                    i += 1
                continue

            # 6. Double-quoted identifier "ident"
            if ch == '"':
                i += 1
                while i < length:
                    if sql[i] == '"':
                        if i + 1 < length and sql[i + 1] == '"':
                            i += 2
                            continue
                        else:
                            i += 1
                            break
                    i += 1
                continue

            # 7. Word tokens
            if ch.isalpha() or ch == "_":
                start = i
                while i < length and (sql[i].isalnum() or sql[i] in ("_", "$")):
                    i += 1
                word = sql[start:i]
                upper = word.upper()

                if upper == "BEGIN":
                    rest = sql[i:]
                    m_sub = re.match(r"^\s+(TRY|CATCH|TRAN|TRANSACTION)\b", rest, re.IGNORECASE)
                    if m_sub:
                        sub_word = m_sub.group(1).upper()
                        full_end = i + len(m_sub.group(0))
                        if sub_word == "TRY":
                            tokens.append({"type": "BEGIN_TRY", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                        elif sub_word == "CATCH":
                            tokens.append({"type": "BEGIN_CATCH", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                        else:
                            i = full_end
                            continue
                    tokens.append({"type": "BEGIN", "text": word, "start": start, "end": i})
                    continue

                if upper == "END":
                    rest = sql[i:]
                    m_sub = re.match(r"^\s+(TRY|CATCH|IF|LOOP)\b", rest, re.IGNORECASE)
                    if m_sub:
                        sub_word = m_sub.group(1).upper()
                        full_end = i + len(m_sub.group(0))
                        if sub_word == "TRY":
                            tokens.append({"type": "END_TRY", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                        elif sub_word == "CATCH":
                            tokens.append({"type": "END_CATCH", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                        elif sub_word == "IF":
                            tokens.append({"type": "END_IF", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                        elif sub_word == "LOOP":
                            tokens.append({"type": "END_LOOP", "text": sql[start:full_end], "start": start, "end": full_end})
                            i = full_end
                            continue
                    tokens.append({"type": "END", "text": word, "start": start, "end": i})
                    continue

                if upper == "CASE":
                    tokens.append({"type": "CASE", "text": word, "start": start, "end": i})
                    continue

                if is_pg:
                    if upper == "IF":
                        tokens.append({"type": "IF", "text": word, "start": start, "end": i})
                        continue
                    if upper == "LOOP":
                        tokens.append({"type": "LOOP", "text": word, "start": start, "end": i})
                        continue

                continue

            i += 1

        return tokens

    @classmethod
    def analyze_blocks(cls, sql: str, dialect: str = "sqlserver"):
        tokens = cls.tokenize(sql, dialect)
        blocks = []
        stack = []

        for t in tokens:
            if t["type"] in ("BEGIN", "BEGIN_TRY", "BEGIN_CATCH", "CASE", "IF", "LOOP"):
                stack.append(t)
                continue

            if t["type"] == "END_TRY":
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j]["type"] == "BEGIN_TRY":
                        opening = stack.pop(j)
                        blocks.append({"type": "TRY_CATCH", "startToken": opening, "endToken": t})
                        break
                continue

            if t["type"] == "END_CATCH":
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j]["type"] == "BEGIN_CATCH":
                        opening = stack.pop(j)
                        blocks.append({"type": "TRY_CATCH", "startToken": opening, "endToken": t})
                        break
                continue

            if t["type"] == "END_IF":
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j]["type"] == "IF":
                        opening = stack.pop(j)
                        blocks.append({"type": "IF_BLOCK", "startToken": opening, "endToken": t})
                        break
                continue

            if t["type"] == "END_LOOP":
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j]["type"] == "LOOP":
                        opening = stack.pop(j)
                        blocks.append({"type": "LOOP_BLOCK", "startToken": opening, "endToken": t})
                        break
                continue

            if t["type"] == "END":
                for j in range(len(stack) - 1, -1, -1):
                    if stack[j]["type"] in ("BEGIN", "CASE"):
                        opening = stack.pop(j)
                        blocks.append({
                            "type": "CASE_BLOCK" if opening["type"] == "CASE" else "BEGIN_END",
                            "startToken": opening,
                            "endToken": t
                        })
                        break
                continue

        return blocks

    @classmethod
    def find_enclosing_block(cls, sql: str, cursor_offset: int, dialect: str = "sqlserver"):
        blocks = cls.analyze_blocks(sql, dialect)
        candidates = [b for b in blocks if b["startToken"]["start"] <= cursor_offset <= b["endToken"]["end"]]
        if not candidates:
            return None
        candidates.sort(key=lambda b: (b["endToken"]["end"] - b["startToken"]["start"]))
        return candidates[0]

    @classmethod
    def get_jump_target(cls, sql: str, cursor_offset: int, target_type: str, dialect: str = "sqlserver"):
        block = cls.find_enclosing_block(sql, cursor_offset, dialect)
        if not block:
            return {"targetOffset": None, "block": None}

        if target_type == "BEGIN":
            return {"targetOffset": block["startToken"]["start"], "block": block}
        else:
            return {"targetOffset": block["endToken"]["start"], "block": block}


# ══════════════════════════════════════════════════════════════════════════════
# Python port of SqlFormatter for algorithmic validation
# ══════════════════════════════════════════════════════════════════════════════

class PySqlFormatter:
    KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET',
        'TOP', 'DISTINCT', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT',
        'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
        'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
        'CROSS APPLY', 'OUTER APPLY', 'JOIN', 'ON',
        'INSERT INTO', 'INSERT', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'DELETE',
        'MERGE', 'OUTPUT', 'RETURNING',
        'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL',
        'IS', 'AS', 'ASC', 'DESC',
        'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'CREATE OR ALTER', 'CREATE OR REPLACE', 'CREATE', 'ALTER', 'DROP',
        'TABLE', 'VIEW', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'SEQUENCE', 'INDEX',
        'SYNONYM', 'TYPE', 'SCHEMA', 'DATABASE',
        'BEGIN TRY', 'END TRY', 'BEGIN CATCH', 'END CATCH',
        'BEGIN', 'END IF', 'END LOOP', 'ELSIF', 'LOOP', 'WHILE', 'IF',
        'RETURN', 'RETURNS', 'BREAK', 'CONTINUE', 'EXECUTE', 'EXEC',
        'DECLARE', 'WITH', 'NOLOCK', 'GO'
    ]

    LINE_BREAK_CLAUSES = [
        'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
        'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
        'CROSS APPLY', 'OUTER APPLY',
        'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
        'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT'
    ]

    @classmethod
    def format(cls, sql: str, dialect: str = "sqlserver") -> str:
        if not sql:
            return ""

        chunks = []
        length = len(sql)
        i = 0
        last_code_start = 0

        def flush_code(end_idx):
            nonlocal last_code_start
            if end_idx > last_code_start:
                chunks.append({"type": "code", "text": sql[last_code_start:end_idx]})
            last_code_start = end_idx

        while i < length:
            ch = sql[i]
            next_ch = sql[i + 1] if i + 1 < length else ""

            if ch == "-" and next_ch == "-":
                flush_code(i)
                start = i
                i += 2
                while i < length and sql[i] != "\n":
                    i += 1
                chunks.append({"type": "comment_line", "text": sql[start:i]})
                last_code_start = i
                continue

            if ch == "/" and next_ch == "*":
                flush_code(i)
                start = i
                i += 2
                while i < length and not (sql[i] == "*" and i + 1 < length and sql[i + 1] == "/"):
                    i += 1
                if i < length:
                    i += 2
                chunks.append({"type": "comment_block", "text": sql[start:i]})
                last_code_start = i
                continue

            if ch == "'" or (ch in ("N", "n") and next_ch == "'"):
                flush_code(i)
                start = i
                if ch in ("N", "n"):
                    i += 1
                i += 1
                while i < length:
                    if sql[i] == "'":
                        if i + 1 < length and sql[i + 1] == "'":
                            i += 2
                            continue
                        else:
                            i += 1
                            break
                    i += 1
                chunks.append({"type": "string", "text": sql[start:i]})
                last_code_start = i
                continue

            if ch == "[":
                flush_code(i)
                start = i
                i += 1
                while i < length:
                    if sql[i] == "]":
                        if i + 1 < length and sql[i + 1] == "]":
                            i += 2
                            continue
                        else:
                            i += 1
                            break
                    i += 1
                chunks.append({"type": "ident_bracket", "text": sql[start:i]})
                last_code_start = i
                continue

            i += 1

        flush_code(length)

        # Format code chunks
        for c in chunks:
            if c["type"] == "code":
                s = c["text"]
                s = re.sub(r"[ \t]{2,}", " ", s)
                s = re.sub(r"\s*,\s*", ", ", s)
                s = re.sub(r"\s*;", ";", s)

                sorted_kw = sorted(cls.KEYWORDS, key=lambda k: len(k), reverse=True)
                for kw in sorted_kw:
                    esc = re.escape(kw).replace(r"\ ", r"\s+")
                    s = re.sub(rf"\b{esc}\b", kw, s, flags=re.IGNORECASE)

                for clause in cls.LINE_BREAK_CLAUSES:
                    esc = re.escape(clause).replace(r"\ ", r"\s+")
                    s = re.sub(rf"([^\r\n])\s+({esc})\b", rf"\1\n{clause}", s, flags=re.IGNORECASE)

                c["text"] = s

        result = "".join(c["text"] for c in chunks)
        result = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", result).strip()
        return result


# ══════════════════════════════════════════════════════════════════════════════
# Tests: Sections 36-48 Goto Begin / Goto End & SqlBlockAnalyzer
# ══════════════════════════════════════════════════════════════════════════════

def test_sqlserver_begin_end_basic():
    sql = "BEGIN\n    SELECT 1;\nEND"
    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "sqlserver")
    assert len(blocks) == 1
    assert blocks[0]["type"] == "BEGIN_END"
    assert blocks[0]["startToken"]["text"] == "BEGIN"
    assert blocks[0]["endToken"]["text"] == "END"

    # Cursor inside SELECT 1;
    cursor_offset = sql.index("SELECT")
    target_begin = PySqlBlockAnalyzer.get_jump_target(sql, cursor_offset, "BEGIN", "sqlserver")
    assert target_begin["targetOffset"] == sql.index("BEGIN")

    target_end = PySqlBlockAnalyzer.get_jump_target(sql, cursor_offset, "END", "sqlserver")
    assert target_end["targetOffset"] == sql.index("END")


def test_sqlserver_nested_blocks():
    sql = (
        "BEGIN\n"
        "    IF @Val = 1\n"
        "    BEGIN\n"
        "        SELECT 2;\n"
        "    END\n"
        "END"
    )
    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "sqlserver")
    assert len(blocks) == 2

    # Cursor at SELECT 2 (inside inner block)
    inner_cursor = sql.index("SELECT 2")
    inner_begin_pos = sql.index("    BEGIN\n        SELECT 2") + 4
    inner_end_pos = sql.index("    END\nEND") + 4

    target_begin = PySqlBlockAnalyzer.get_jump_target(sql, inner_cursor, "BEGIN", "sqlserver")
    assert target_begin["targetOffset"] == inner_begin_pos

    target_end = PySqlBlockAnalyzer.get_jump_target(sql, inner_cursor, "END", "sqlserver")
    assert target_end["targetOffset"] == inner_end_pos


def test_sqlserver_try_catch_blocks():
    sql = (
        "BEGIN TRY\n"
        "    SELECT 1 / 0;\n"
        "END TRY\n"
        "BEGIN CATCH\n"
        "    SELECT ERROR_MESSAGE();\n"
        "END CATCH"
    )
    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "sqlserver")
    assert len(blocks) == 2
    assert blocks[0]["startToken"]["type"] == "BEGIN_TRY"
    assert blocks[0]["endToken"]["type"] == "END_TRY"
    assert blocks[1]["startToken"]["type"] == "BEGIN_CATCH"
    assert blocks[1]["endToken"]["type"] == "END_CATCH"

    # In TRY
    try_cursor = sql.index("SELECT 1 / 0")
    assert PySqlBlockAnalyzer.get_jump_target(sql, try_cursor, "BEGIN", "sqlserver")["targetOffset"] == sql.index("BEGIN TRY")
    assert PySqlBlockAnalyzer.get_jump_target(sql, try_cursor, "END", "sqlserver")["targetOffset"] == sql.index("END TRY")

    # In CATCH
    catch_cursor = sql.index("SELECT ERROR_MESSAGE()")
    assert PySqlBlockAnalyzer.get_jump_target(sql, catch_cursor, "BEGIN", "sqlserver")["targetOffset"] == sql.index("BEGIN CATCH")
    assert PySqlBlockAnalyzer.get_jump_target(sql, catch_cursor, "END", "sqlserver")["targetOffset"] == sql.index("END CATCH")


def test_sqlserver_case_end_expression():
    sql = (
        "BEGIN\n"
        "    SELECT CASE WHEN A=1 THEN 'Y' ELSE 'N' END AS Status;\n"
        "END"
    )
    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "sqlserver")
    assert len(blocks) == 2
    case_block = next(b for b in blocks if b["type"] == "CASE_BLOCK")
    assert case_block["startToken"]["type"] == "CASE"
    assert case_block["endToken"]["type"] == "END"

    # Cursor inside CASE
    case_cursor = sql.index("THEN 'Y'")
    assert PySqlBlockAnalyzer.get_jump_target(sql, case_cursor, "BEGIN", "sqlserver")["targetOffset"] == sql.index("CASE")
    assert PySqlBlockAnalyzer.get_jump_target(sql, case_cursor, "END", "sqlserver")["targetOffset"] == sql.index("END AS Status")


def test_ignore_keywords_in_strings_and_comments():
    sql = (
        "SELECT 'BEGIN', 'END';\n"
        "-- BEGIN fake\n"
        "/* BEGIN block END comment */\n"
        "SELECT 1;\n"
        "-- END fake"
    )
    tokens = PySqlBlockAnalyzer.tokenize(sql, "sqlserver")
    # None of the BEGIN or END in strings or comments should be tokenized
    types = [t["type"] for t in tokens]
    assert "BEGIN" not in types
    assert "END" not in types

    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "sqlserver")
    assert len(blocks) == 0

    target = PySqlBlockAnalyzer.get_jump_target(sql, sql.index("SELECT 1"), "BEGIN", "sqlserver")
    assert target["targetOffset"] is None


def test_ignore_begin_tran_transaction_scope():
    sql = (
        "BEGIN TRAN;\n"
        "BEGIN TRANSACTION;\n"
        "SELECT 1;\n"
        "COMMIT TRAN;"
    )
    tokens = PySqlBlockAnalyzer.tokenize(sql, "sqlserver")
    types = [t["type"] for t in tokens]
    assert "BEGIN" not in types
    assert "BEGIN_TRY" not in types


def test_postgresql_if_end_if_and_loop():
    sql = (
        "IF condition THEN\n"
        "    LOOP\n"
        "        SELECT 1;\n"
        "    END LOOP;\n"
        "END IF;"
    )
    blocks = PySqlBlockAnalyzer.analyze_blocks(sql, "postgresql")
    assert len(blocks) == 2

    # Inner loop
    loop_cursor = sql.index("SELECT 1")
    assert PySqlBlockAnalyzer.get_jump_target(sql, loop_cursor, "BEGIN", "postgresql")["targetOffset"] == sql.index("LOOP\n")
    assert PySqlBlockAnalyzer.get_jump_target(sql, loop_cursor, "END", "postgresql")["targetOffset"] == sql.index("END LOOP")

    # Outer IF
    if_cursor = sql.index("condition THEN")
    assert PySqlBlockAnalyzer.get_jump_target(sql, if_cursor, "BEGIN", "postgresql")["targetOffset"] == sql.index("IF condition")
    assert PySqlBlockAnalyzer.get_jump_target(sql, if_cursor, "END", "postgresql")["targetOffset"] == sql.index("END IF")


# ══════════════════════════════════════════════════════════════════════════════
# Tests: Section 35 Format Code
# ══════════════════════════════════════════════════════════════════════════════

def test_sql_formatter_keyword_casing_and_clauses():
    raw_sql = "select id, name from users where active = 1 order by name"
    formatted = PySqlFormatter.format(raw_sql, "sqlserver")

    assert "SELECT id, name" in formatted
    assert "\nFROM users" in formatted
    assert "\nWHERE active = 1" in formatted
    assert "\nORDER BY name" in formatted


def test_sql_formatter_preserves_strings_and_comments():
    raw_sql = "select 'select within string', [from] from tbl -- don't touch comment select"
    formatted = PySqlFormatter.format(raw_sql, "sqlserver")

    assert "'select within string'" in formatted
    assert "[from]" in formatted
    assert "-- don't touch comment select" in formatted


def test_sql_formatter_selection_formatting():
    # Only a snippet is passed
    snippet = "select * from my_table where id = 5"
    formatted = PySqlFormatter.format(snippet, "sqlserver")

    assert "SELECT *" in formatted
    assert "\nFROM my_table" in formatted
    assert "\nWHERE id = 5" in formatted


# ══════════════════════════════════════════════════════════════════════════════
# Tests: Project Integration (Files, UI Elements, Actions)
# ══════════════════════════════════════════════════════════════════════════════

def test_javascript_files_exist():
    analyzer_file = Path("static/js/sql-block-analyzer.js")
    formatter_file = Path("static/js/sql-formatter.js")
    assert analyzer_file.is_file(), "sql-block-analyzer.js must exist"
    assert formatter_file.is_file(), "sql-formatter.js must exist"

    analyzer_src = analyzer_file.read_text(encoding="utf-8")
    formatter_src = formatter_file.read_text(encoding="utf-8")

    assert "class SqlBlockAnalyzer" in analyzer_src
    assert "window.SqlBlockAnalyzer = SqlBlockAnalyzer" in analyzer_src
    assert "class SqlFormatter" in formatter_src
    assert "window.SqlFormatter = SqlFormatter" in formatter_src


def test_templates_index_and_editor_integration():
    index_html = Path("templates/index.html").read_text(encoding="utf-8")
    editor_html = Path("templates/partials/editor.html").read_text(encoding="utf-8")
    editor_js = Path("static/js/editor.js").read_text(encoding="utf-8")

    # 1. Scripts included in templates/index.html
    assert "sql-block-analyzer.js" in index_html, "index.html must include sql-block-analyzer.js"
    assert "sql-formatter.js" in index_html, "index.html must include sql-formatter.js"

    # 2. UI Action Bar buttons
    assert 'id="ide-btn-format"' in index_html, "index.html must have #ide-btn-format"
    assert 'id="ide-btn-format"' in editor_html, "editor.html must have #ide-btn-format"

    # 3. Navbar items
    assert 'id="ide-menu-format-code"' in index_html, "index.html must have #ide-menu-format-code"
    assert 'id="ide-menu-goto-begin"' in index_html, "index.html must have #ide-menu-goto-begin"
    assert 'id="ide-menu-goto-end"' in index_html, "index.html must have #ide-menu-goto-end"

    # 4. Confirmation Modal
    assert 'id="ide-modal-format-confirm"' in index_html, "index.html must have #ide-modal-format-confirm"
    assert 'id="ide-modal-format-confirm"' in editor_html, "editor.html must have #ide-modal-format-confirm"
    assert 'id="ide-btn-confirm-format"' in index_html, "index.html must have #ide-btn-confirm-format"

    # 5. Monaco Action Grouping and Orders in editor.js
    assert "sql-format-code" in editor_js
    assert "sql-goto-matching-begin" in editor_js
    assert "sql-goto-matching-end" in editor_js
    assert "contextMenuGroupId: '1_modification'" in editor_js
    assert "contextMenuOrder: 1.5" in editor_js
    assert "contextMenuOrder: 1.6" in editor_js
    assert "contextMenuOrder: 1.7" in editor_js

    # 6. AppEditor wrapper exposed methods
    assert "formatCode(customEd)" in editor_js
    assert "gotoBegin(customEd)" in editor_js
    assert "gotoEnd(customEd)" in editor_js
