# -*- coding: utf-8 -*-
"""
PostgreSQL Syntax Adapter.
Implements the Hybrid Strategy for PostgreSQL:
- Online Mode (connection available): Database-native Transaction Rollback with statement_position,
  providing 100% full validation of both declarative SQL and procedural PL/pgSQL (DO $$ blocks).
- Offline Mode (no connection): Static AST parsing via sqlglot with structural statement checks.
- Debug Mode: Preserves bs.* debug function masking and diagnostics filtering.

Complies with Section 4.2 & 6.2 of .SKILL/SQL_Syntax_Check_Parser_Extension.md.
"""
from __future__ import annotations

import logging
from typing import Any

from app.database.syntax.adapters.base import BaseSyntaxAdapter
from app.database.syntax.adapters.diagnostics_mapper import normalize_diagnostic

logger = logging.getLogger(__name__)


import re

def check_offline_postgres_structural_blocks(sql: str) -> list[dict[str, Any]]:
    """Check structural block balance for PostgreSQL when offline."""
    diags: list[dict[str, Any]] = []
    if not sql or not sql.strip():
        return diags

    n = len(sql)
    i = 0
    blocks: list[tuple[str, int, int, int, int, int]] = []

    # First pass: find top-level dollar-quoted blocks
    # while correctly skipping comments and strings.
    while i < n:
        # 1. Single-line comment
        if sql[i:i + 2] == "--":
            i += 2
            while i < n and sql[i] != "\n":
                i += 1
            continue

        # 2. Multi-line comment (supporting nesting)
        if sql[i:i + 2] == "/*":
            i += 2
            depth = 1
            while i < n and depth > 0:
                if sql[i:i + 2] == "/*":
                    depth += 1
                    i += 2
                elif sql[i:i + 2] == "*/":
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue

        # 3. Escape string E'...' or e'...'
        if sql[i] in ("E", "e") and i + 1 < n and sql[i + 1] == "'":
            i += 2
            while i < n:
                if sql[i] == "\\":
                    i += 2
                elif sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            continue

        # 4. Single-quoted string '...'
        if sql[i] == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            continue

        # 5. Double-quoted identifier "..."
        if sql[i] == '"':
            i += 1
            while i < n:
                if sql[i] == '"':
                    if i + 1 < n and sql[i + 1] == '"':
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            continue

        # 6. Dollar quote $[a-zA-Z0-9_]*\$
        if sql[i] == "$":
            tag_match = re.match(r"\$[a-zA-Z0-9_]*\$", sql[i:])
            if tag_match:
                tag = tag_match.group(0)
                tag_start = i
                content_start = i + len(tag)

                tag_line = sql[:tag_start].count("\n") + 1
                last_nl = sql[:tag_start].rfind("\n")
                tag_col = (tag_start + 1) if last_nl == -1 else (tag_start - last_nl)

                closing_pos = sql.find(tag, content_start)
                if closing_pos == -1:
                    diags.append({
                        "severity": "error",
                        "message": f"Unclosed dollar-quoted block '{tag}'",
                        "code": "SQL_SYNTAX_ERROR",
                        "line": tag_line,
                        "column": tag_col,
                        "end_column": tag_col + len(tag),
                        "token": tag,
                        "source": "postgresql",
                    })
                    return diags

                content_end = closing_pos
                blocks.append((tag, content_start, content_end, tag_start, tag_line, tag_col))
                i = closing_pos + len(tag)
                continue

        i += 1

    # Second pass: check procedural blocks inside each dollar-quoted block
    for tag, c_start, c_end, t_start, t_line, t_col in blocks:
        block_text = sql[c_start:c_end]
        m = len(block_text)
        j = 0
        tokens: list[tuple[str, int, int, int]] = []  # (text, abs_pos, line, col)

        while j < m:
            # Skip single-line comment
            if block_text[j:j + 2] == "--":
                j += 2
                while j < m and block_text[j] != "\n":
                    j += 1
                continue

            # Skip multi-line comment
            if block_text[j:j + 2] == "/*":
                j += 2
                depth = 1
                while j < m and depth > 0:
                    if block_text[j:j + 2] == "/*":
                        depth += 1
                        j += 2
                    elif block_text[j:j + 2] == "*/":
                        depth -= 1
                        j += 2
                    else:
                        j += 1
                continue

            # Skip escape string
            if block_text[j] in ("E", "e") and j + 1 < m and block_text[j + 1] == "'":
                j += 2
                while j < m:
                    if block_text[j] == "\\":
                        j += 2
                    elif block_text[j] == "'":
                        if j + 1 < m and block_text[j + 1] == "'":
                            j += 2
                        else:
                            j += 1
                            break
                    else:
                        j += 1
                continue

            # Skip string literal
            if block_text[j] == "'":
                j += 1
                while j < m:
                    if block_text[j] == "'":
                        if j + 1 < m and block_text[j + 1] == "'":
                            j += 2
                        else:
                            j += 1
                            break
                    else:
                        j += 1
                continue

            # Skip double-quoted identifier
            if block_text[j] == '"':
                j += 1
                while j < m:
                    if block_text[j] == '"':
                        if j + 1 < m and block_text[j + 1] == '"':
                            j += 2
                        else:
                            j += 1
                            break
                    else:
                        j += 1
                continue

            # Skip inner dollar-quoted string
            if block_text[j] == "$":
                inner_match = re.match(r"\$[a-zA-Z0-9_]*\$", block_text[j:])
                if inner_match:
                    inner_tag = inner_match.group(0)
                    inner_close = block_text.find(inner_tag, j + len(inner_tag))
                    if inner_close != -1:
                        j = inner_close + len(inner_tag)
                        continue
                    else:
                        abs_pos = c_start + j
                        line_no = sql[:abs_pos].count("\n") + 1
                        last_nl = sql[:abs_pos].rfind("\n")
                        col_no = (abs_pos + 1) if last_nl == -1 else (abs_pos - last_nl)
                        diags.append({
                            "severity": "error",
                            "message": f"Unclosed inner dollar-quoted block '{inner_tag}'",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": line_no,
                            "column": col_no,
                            "end_column": col_no + len(inner_tag),
                            "token": inner_tag,
                            "source": "postgresql",
                        })
                        return diags

            # Match words, symbols, and operators
            word_match = re.match(r"[a-zA-Z_][a-zA-Z0-9_]*|::|:=|<>|!=|<=|>=|\|\||[;(),=<>+\-*/]", block_text[j:])
            if word_match:
                tok_str = word_match.group(0)
                abs_pos = c_start + j
                line_no = sql[:abs_pos].count("\n") + 1
                last_nl = sql[:abs_pos].rfind("\n")
                col_no = (abs_pos + 1) if last_nl == -1 else (abs_pos - last_nl)
                tokens.append((tok_str, abs_pos, line_no, col_no))
                j += len(tok_str)
                continue

            j += 1

        # Process tokens
        begin_stack: list[tuple[str, int, int, int]] = []
        if_stack: list[tuple[str, int, int, int]] = []
        loop_stack: list[tuple[str, int, int, int]] = []
        for_loop_pending: list[tuple[str, int, int, int]] = []
        case_stack: list[tuple[str, int, int, int]] = []
        k = 0
        num_toks = len(tokens)

        # Expression continuation tokens that can follow a scalar CASE's END
        EXPR_FOLLOWS = {
            "AS", "||", ",", ")", "+", "-", "*", "/", "=", "<>", "!=", "<=", ">=", "<", ">",
            "FROM", "WHERE", "GROUP", "HAVING", "ORDER", "LIMIT", "AND", "OR", "WHEN", "THEN",
            "ELSE", "LIKE", "ILIKE", "IN", "NOT", "IS", "BETWEEN", "OVER", "FILTER", "::"
        }

        paren_depth = 0

        while k < num_toks:
            tok_text, tok_pos, tok_line, tok_col = tokens[k]
            upper = tok_text.upper()
            prev_tok = tokens[k - 1][0].upper() if k > 0 else ""

            # Track parenthesis nesting
            if upper == "(":
                paren_depth += 1
                k += 1
                continue
            if upper == ")":
                if paren_depth > 0:
                    paren_depth -= 1
                k += 1
                continue

            # Check if pending FOR loop was terminated without LOOP keyword
            if upper in (";", "BEGIN", "END", "EXCEPTION") and for_loop_pending:
                for f_tok, f_pos, f_line, f_col in for_loop_pending:
                    diags.append({
                        "severity": "error",
                        "message": "Missing LOOP keyword after FOR loop header",
                        "code": "SQL_SYNTAX_ERROR",
                        "line": f_line,
                        "column": f_col,
                        "end_column": f_col + len(f_tok),
                        "token": "FOR",
                        "source": "postgresql",
                    })
                for_loop_pending.clear()

            if upper == "BEGIN":
                begin_stack.append((tok_text, tok_pos, tok_line, tok_col))
                k += 1
                continue

            if upper == "IF":
                # Ensure not DDL "DROP ... IF EXISTS" inside block
                if prev_tok in ("DROP", "CREATE", "TABLE", "VIEW", "INDEX", "SCHEMA", "DATABASE", "EXTENSION"):
                    pass
                else:
                    if_stack.append((tok_text, tok_pos, tok_line, tok_col))
                k += 1
                continue

            if upper == "FOR":
                next_upper = tokens[k + 1][0].upper() if k + 1 < num_toks else ""
                next_next_upper = tokens[k + 2][0].upper() if k + 2 < num_toks else ""

                # 1. Skip if inside parentheses (e.g. SUBSTRING(str FROM pos FOR len) or subquery (SELECT ... FOR UPDATE))
                if paren_depth > 0:
                    k += 1
                    continue

                # 2. Skip locking / row clauses: FOR UPDATE, FOR SHARE, FOR KEY SHARE, FOR NO KEY UPDATE, FOR EACH ROW
                if (
                    next_upper in ("UPDATE", "SHARE", "KEY", "EACH")
                    or (next_upper == "NO" and next_next_upper in ("KEY", "SCROLL"))
                    or prev_tok in ("FROM", "EXTRACT", "SUBSTRING")
                ):
                    k += 1
                    continue

                # 3. Skip OPEN cursor FOR ... statement:
                #    OPEN cursor_name [ [ NO ] SCROLL ] FOR query;
                #    OPEN cursor_name [ [ NO ] SCROLL ] FOR EXECUTE query_string ...;
                is_open_cursor = False
                p = k - 1
                p_paren = 0
                while p >= 0:
                    p_tok = tokens[p][0]
                    if p_tok == ")":
                        p_paren += 1
                    elif p_tok == "(":
                        p_paren -= 1
                    elif p_paren == 0:
                        p_u = p_tok.upper()
                        if p_u in (";", "BEGIN", "THEN", "LOOP", "ELSE", "EXCEPTION", "DO"):
                            break
                        if p_u == "OPEN":
                            is_open_cursor = True
                            break
                    p -= 1

                if is_open_cursor:
                    k += 1
                    continue

                # 4. Skip cursor declaration in DECLARE block:
                #    cursor_name [ [ NO ] SCROLL ] CURSOR [ ( arguments ) ] FOR query;
                is_cursor_decl = False
                p = k - 1
                p_paren = 0
                while p >= 0:
                    p_tok = tokens[p][0]
                    if p_tok == ")":
                        p_paren += 1
                    elif p_tok == "(":
                        p_paren -= 1
                    elif p_paren == 0:
                        p_u = p_tok.upper()
                        if p_u in (";", "BEGIN", "DECLARE", "EXCEPTION"):
                            break
                        if p_u == "CURSOR":
                            is_cursor_decl = True
                            break
                    p -= 1

                if is_cursor_decl:
                    k += 1
                    continue

                for_loop_pending.append((tok_text, tok_pos, tok_line, tok_col))
                k += 1
                continue

            if upper == "LOOP":
                loop_stack.append((tok_text, tok_pos, tok_line, tok_col))
                if for_loop_pending:
                    for_loop_pending.pop()
                k += 1
                continue

            if upper == "CASE":
                case_stack.append((tok_text, tok_pos, tok_line, tok_col))
                k += 1
                continue

            if upper == "EXCEPTION":
                if not begin_stack:
                    diags.append({
                        "severity": "error",
                        "message": "Unmatched EXCEPTION: no corresponding BEGIN block",
                        "code": "SQL_SYNTAX_ERROR",
                        "line": tok_line,
                        "column": tok_col,
                        "end_column": tok_col + len(tok_text),
                        "token": "EXCEPTION",
                        "source": "postgresql",
                    })
                else:
                    # Clear unclosed internal constructs before EXCEPTION with appropriate errors
                    while case_stack:
                        c_tok, c_pos, c_line, c_col = case_stack.pop()
                        diags.append({
                            "severity": "error",
                            "message": "Unclosed CASE expression: missing corresponding END before EXCEPTION",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": c_line,
                            "column": c_col,
                            "end_column": c_col + 4,
                            "token": "CASE",
                            "source": "postgresql",
                        })
                    while if_stack:
                        i_tok, i_pos, i_line, i_col = if_stack.pop()
                        diags.append({
                            "severity": "error",
                            "message": "Unmatched IF block: missing corresponding END IF before EXCEPTION",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": i_line,
                            "column": i_col,
                            "end_column": i_col + 2,
                            "token": "IF",
                            "source": "postgresql",
                        })
                    while loop_stack:
                        l_tok, l_pos, l_line, l_col = loop_stack.pop()
                        diags.append({
                            "severity": "error",
                            "message": "Unmatched LOOP block: missing corresponding END LOOP before EXCEPTION",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": l_line,
                            "column": l_col,
                            "end_column": l_col + 4,
                            "token": "LOOP",
                            "source": "postgresql",
                        })
                k += 1
                continue

            if upper == ";":
                k += 1
                continue

            if upper == "END":
                next_tok = tokens[k + 1][0].upper() if k + 1 < num_toks else ""

                if next_tok == "IF":
                    if if_stack:
                        if_stack.pop()
                    else:
                        diags.append({
                            "severity": "error",
                            "message": "Unmatched END IF: no corresponding IF block",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": tok_line,
                            "column": tok_col,
                            "end_column": tok_col + 6,
                            "token": "END IF",
                            "source": "postgresql",
                        })
                    k += 2
                    continue
                elif next_tok == "LOOP":
                    if loop_stack:
                        loop_stack.pop()
                    else:
                        diags.append({
                            "severity": "error",
                            "message": "Unmatched END LOOP: no corresponding LOOP block",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": tok_line,
                            "column": tok_col,
                            "end_column": tok_col + 8,
                            "token": "END LOOP",
                            "source": "postgresql",
                        })
                    k += 2
                    # Skip optional loop label, e.g. END LOOP my_loop;
                    if k < num_toks and tokens[k][0] not in (";", ",", "(", ")") and tokens[k][0].upper() not in ("BEGIN", "END", "IF", "CASE", "LOOP"):
                        k += 1
                    continue
                else:
                    # Check for genuine procedural END CASE;
                    # Criteria: next_tok == "CASE", next token after CASE is NOT "WHEN",
                    # and between END and CASE there is only whitespace (checked via raw offsets).
                    tok_offset = tok_pos - c_start
                    next_tok_offset = tokens[k + 1][1] - c_start if k + 1 < num_toks else tok_offset
                    raw_between = block_text[tok_offset + len(tok_text):next_tok_offset].strip()
                    tok_after_case = tokens[k + 2][0].upper() if k + 2 < num_toks else ""

                    if next_tok == "CASE" and raw_between == "" and tok_after_case != "WHEN":
                        if case_stack:
                            case_stack.pop()
                        else:
                            diags.append({
                                "severity": "error",
                                "message": "Unmatched END CASE: no corresponding CASE block",
                                "code": "SQL_SYNTAX_ERROR",
                                "line": tok_line,
                                "column": tok_col,
                                "end_column": tok_col + 8,
                                "token": "END CASE",
                                "source": "postgresql",
                            })
                        k += 2
                        # Skip optional label, e.g. END CASE my_case;
                        if k < num_toks and tokens[k][0] not in (";", ",", "(", ")") and tokens[k][0].upper() not in ("BEGIN", "END", "IF", "CASE", "LOOP"):
                            k += 1
                        continue

                    # Plain END: Could close a scalar CASE expression, or a BEGIN block
                    # 1. If next_tok is an expression continuation (AS, ||, comma, etc.), it MUST be closing a CASE!
                    if next_tok in EXPR_FOLLOWS:
                        if case_stack:
                            case_stack.pop()
                        else:
                            diags.append({
                                "severity": "error",
                                "message": "Unmatched END: no corresponding CASE expression",
                                "code": "SQL_SYNTAX_ERROR",
                                "line": tok_line,
                                "column": tok_col,
                                "end_column": tok_col + 3,
                                "token": "END",
                                "source": "postgresql",
                            })
                        k += 1
                        continue

                    # 2. If prev_tok was ";" (or "BEGIN" or "EXCEPTION"), the previous statement was already terminated by ";".
                    # A scalar CASE expression can never have ";" immediately before its END!
                    # Therefore, this END; is closing the BEGIN block!
                    if prev_tok in (";", "BEGIN", "EXCEPTION", ""):
                        if case_stack:
                            for c_tok, c_pos, c_line, c_col in case_stack:
                                diags.append({
                                    "severity": "error",
                                    "message": "Unclosed CASE expression: missing corresponding END",
                                    "code": "SQL_SYNTAX_ERROR",
                                    "line": c_line,
                                    "column": c_col,
                                    "end_column": c_col + 4,
                                    "token": "CASE",
                                    "source": "postgresql",
                                    })
                            case_stack.clear()

                        if begin_stack:
                            begin_stack.pop()
                            # Skip optional block label after END, e.g. END lbl;
                            if (
                                k + 1 < num_toks
                                and tokens[k + 1][0] not in (";", ",", "(", ")")
                                and tokens[k + 1][0].upper() not in ("BEGIN", "END", "IF", "CASE", "LOOP")
                            ):
                                k += 2
                            else:
                                k += 1
                            continue
                        else:
                            diags.append({
                                "severity": "error",
                                "message": "Unmatched END: no corresponding BEGIN block",
                                "code": "SQL_SYNTAX_ERROR",
                                "line": tok_line,
                                "column": tok_col,
                                "end_column": tok_col + 3,
                                "token": "END",
                                "source": "postgresql",
                            })
                            k += 1
                            continue

                    # 3. Otherwise (e.g. PERFORM CASE ... END; or x := CASE ... END;):
                    # prev_tok is NOT ";", so END is at the end of an expression!
                    if case_stack:
                        case_stack.pop()
                        k += 1
                        continue
                    elif begin_stack:
                        begin_stack.pop()
                        if (
                            k + 1 < num_toks
                            and tokens[k + 1][0] not in (";", ",", "(", ")")
                            and tokens[k + 1][0].upper() not in ("BEGIN", "END", "IF", "CASE", "LOOP")
                        ):
                            k += 2
                        else:
                            k += 1
                        continue
                    else:
                        diags.append({
                            "severity": "error",
                            "message": "Unmatched END: no corresponding block",
                            "code": "SQL_SYNTAX_ERROR",
                            "line": tok_line,
                            "column": tok_col,
                            "end_column": tok_col + 3,
                            "token": "END",
                            "source": "postgresql",
                        })
                        k += 1
                        continue

            k += 1

        for f_tok, f_pos, f_line, f_col in for_loop_pending:
            diags.append({
                "severity": "error",
                "message": "Missing LOOP keyword after FOR loop header",
                "code": "SQL_SYNTAX_ERROR",
                "line": f_line,
                "column": f_col,
                "end_column": f_col + len(f_tok),
                "token": "FOR",
                "source": "postgresql",
            })

        for c_tok, c_pos, c_line, c_col in case_stack:
            diags.append({
                "severity": "error",
                "message": "Unclosed CASE expression: missing corresponding END",
                "code": "SQL_SYNTAX_ERROR",
                "line": c_line,
                "column": c_col,
                "end_column": c_col + 4,
                "token": "CASE",
                "source": "postgresql",
            })

        for i_tok, i_pos, i_line, i_col in if_stack:
            diags.append({
                "severity": "error",
                "message": "Unmatched IF block: missing corresponding END IF in procedural code",
                "code": "SQL_SYNTAX_ERROR",
                "line": i_line,
                "column": i_col,
                "end_column": i_col + 2,
                "token": "IF",
                "source": "postgresql",
            })

        for l_tok, l_pos, l_line, l_col in loop_stack:
            diags.append({
                "severity": "error",
                "message": "Unmatched LOOP block: missing corresponding END LOOP in procedural code",
                "code": "SQL_SYNTAX_ERROR",
                "line": l_line,
                "column": l_col,
                "end_column": l_col + 4,
                "token": "LOOP",
                "source": "postgresql",
            })

        for b_tok, b_pos, b_line, b_col in begin_stack:
            diags.append({
                "severity": "error",
                "message": "Unmatched BEGIN block: missing corresponding END in procedural code",
                "code": "SQL_SYNTAX_ERROR",
                "line": b_line,
                "column": b_col,
                "end_column": b_col + 5,
                "token": "BEGIN",
                "source": "postgresql",
            })

    return diags


class PostgreSqlAdapter(BaseSyntaxAdapter):
    """
    PostgreSQL Syntax Adapter using Hybrid (Native Live Rollback + Offline Parser).
    Provides accurate statement_position parsing without database side-effects.
    """

    def validate(
        self,
        sql: str,
        connection_session: Any = None,
        database: str | None = None,
        schema: str | None = None,
        is_debug: bool = False,
    ) -> list[dict[str, Any]]:
        """Validate PostgreSQL syntax."""
        if not sql or not sql.strip():
            return []

        from app.database.syntax.validator import validate_postgresql

        raw_diags = validate_postgresql(
            sql=sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
        )

        # In offline mode or for procedural/DDL SQL, supplement with structural block validation
        has_active_conn = False
        if connection_session and getattr(connection_session, "adapter", None):
            has_active_conn = getattr(connection_session.adapter, "connection", None) is not None

        from app.database.syntax.validator_pg import _is_destructive_or_locking_ddl
        from app.database.syntax.proc_body_detector import is_procedural_sql

        is_procedural_or_ddl = _is_destructive_or_locking_ddl(sql) or is_procedural_sql(sql, dialect="postgres")
        if not has_active_conn or is_procedural_or_ddl:
            block_diags = check_offline_postgres_structural_blocks(sql)
            raw_diags.extend(block_diags)

            # Honest status marking: If routine contains procedural elements and no syntax errors were found
            has_errors = any(d.get("severity") == "error" for d in raw_diags)
            if not has_errors and ("$$" in sql or "plpgsql" in sql.lower()):
                upper_sql = sql.upper()
                if any(kw in upper_sql for kw in ("BEGIN", "IF", "LOOP", "PERFORM", "RAISE", "DECLARE", "EXCEPTION")):
                    status_msg = (
                        "PL/pgSQL block structure validated."
                        if has_active_conn
                        else "PL/pgSQL block structure validated (offline mode). Full semantic validation requires active database connection."
                    )
                    raw_diags.append({
                        "severity": "info",
                        "message": status_msg,
                        "code": "SQL_SYNTAX_PARTIAL",
                        "line": 1,
                        "column": 1,
                        "token": "$$",
                        "source": "postgresql",
                        "status": "PARTIAL",
                    })

        # Standardize diagnostics
        normalized = [
            normalize_diagnostic(d, default_source="postgresql", sql=sql)
            for d in raw_diags
        ]
        return normalized
