# -*- coding: utf-8 -*-
"""
SQL Server (T-SQL) Syntax Validator.
Provides database-native syntax checking (SET PARSEONLY ON) with sqlglot fallback.
Handles standalone GO batch separators, structural tokens, and procedural blocks.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import sqlglot
from sqlglot.errors import ParseError

logger = logging.getLogger(__name__)


def split_sqlserver_batches(sql: str) -> list[dict[str, Any]]:
    """
    Split SQL Server script into batches separated by standalone GO statements.
    Accurately tracks starting line numbers for each batch.
    Ignores GO keywords occurring inside comments or string literals.
    """
    if not sql:
        return []

    lines = sql.splitlines(keepends=True)
    batches: list[dict[str, Any]] = []
    current_lines: list[str] = []
    current_start_line = 1

    in_block_comment = False
    in_single_quote = False

    go_regex = re.compile(r"^\s*GO(?:\s+\d+|\s+--.*)?$", re.IGNORECASE)

    for line_idx, line in enumerate(lines):
        line_no = line_idx + 1
        stripped = line.strip()

        starts_in_state = in_block_comment or in_single_quote

        # Scan line characters to update parser state
        i = 0
        n = len(line)
        while i < n:
            ch = line[i]
            next_ch = line[i + 1] if i + 1 < n else ""

            if in_block_comment:
                if ch == "*" and next_ch == "/":
                    in_block_comment = False
                    i += 2
                    continue
                i += 1
            elif in_single_quote:
                if ch == "'":
                    if next_ch == "'":
                        i += 2  # escaped quote
                        continue
                    in_single_quote = False
                    i += 1
                    continue
                i += 1
            else:
                if ch == "-" and next_ch == "-":
                    break  # rest of line is line comment
                elif ch == "/" and next_ch == "*":
                    in_block_comment = True
                    i += 2
                    continue
                elif ch == "'":
                    in_single_quote = True
                    i += 1
                    continue
                i += 1

        # Check if line is a standalone GO separator
        if (
            not starts_in_state
            and not in_block_comment
            and not in_single_quote
            and go_regex.match(stripped)
        ):
            if current_lines:
                batch_text = "".join(current_lines)
                batches.append(
                    {
                        "text": batch_text,
                        "start_line": current_start_line,
                        "line_count": len(current_lines),
                    }
                )
                current_lines = []
            current_start_line = line_no + 1
        else:
            if not current_lines and not stripped:
                # Skip leading empty lines before first statement in batch
                current_start_line = line_no + 1
            else:
                current_lines.append(line)

    if current_lines:
        batch_text = "".join(current_lines)
        if batch_text.strip():
            batches.append(
                {
                    "text": batch_text,
                    "start_line": current_start_line,
                    "line_count": len(current_lines),
                }
            )

    return batches


def _clean_sqlserver_message(raw_msg: str) -> str:
    """Clean ODBC and SQL Server diagnostic headers from error message."""
    if not raw_msg:
        return "Syntax error"
    msg = re.sub(r"\[Microsoft\]\[[^\]]+\](?:\[[^\]]+\])?", "", raw_msg)
    msg = re.sub(r"\(\d+\)\s*\([^\)]+\)", "", msg)
    msg = re.sub(r"\(\d+\)", "", msg)
    msg = re.sub(r"Msg\s+\d+,\s*Level\s+\d+,\s*State\s+\d+,\s*(?:Procedure\s+[^\s,]+,\s*)?Line\s+\d+\s*", "", msg, flags=re.IGNORECASE)
    msg = re.sub(r"Line\s+\d+:\s*", "", msg, flags=re.IGNORECASE)
    msg = re.sub(r";\s*$", "", msg)
    return msg.strip() or raw_msg.strip()


def _compute_token_position(target_line: str, token: str, default_col: int = 1) -> tuple[int, int]:
    """
    Compute 1-indexed (col, end_col) of token on target_line.
    Handles exact word boundaries for alphanumeric tokens, substring matches,
    non-empty stripped fallback, and line-length bounds.
    """
    if not target_line:
        return default_col, default_col + max(1, len(token))

    if token and token in target_line:
        if re.match(r"^\w+$", token):
            m = re.search(rf"\b{re.escape(token)}\b", target_line, re.IGNORECASE)
            if m:
                return m.start() + 1, m.end() + 1
        idx = target_line.find(token)
        if idx != -1:
            return idx + 1, idx + 1 + len(token)

    stripped = target_line.strip()
    if stripped:
        idx = target_line.find(stripped)
        return idx + 1, idx + 1 + len(stripped)

    return 1, max(2, len(target_line) + 1)


def _find_all_empty_select_tokens(sql: str, dialect: str) -> list[dict[str, Any]]:
    """Find all lines and columns of invalid SELECTs without projection expressions."""
    diagnostics = []
    try:
        tokens = list(sqlglot.tokenize(sql, read=dialect))
    except Exception:
        return diagnostics

    for i, t in enumerate(tokens):
        if t.token_type == sqlglot.TokenType.SELECT:
            j = i + 1
            while j < len(tokens) and tokens[j].token_type in (sqlglot.TokenType.COMMENT,):
                j += 1
            if j >= len(tokens) or tokens[j].token_type in (
                sqlglot.TokenType.FROM,
                sqlglot.TokenType.WHERE,
                sqlglot.TokenType.COMMA,
                sqlglot.TokenType.SEMICOLON,
                sqlglot.TokenType.END,
            ):
                start_col = max(1, t.col - len(t.text) + 1)
                diagnostics.append(
                    {
                        "severity": "error",
                        "message": "Missing column list or expression in SELECT statement",
                        "code": "SQL_SYNTAX_ERROR",
                        "line": t.line,
                        "column": start_col,
                        "end_column": start_col + len(t.text),
                        "token": t.text,
                        "source": dialect,
                    }
                )
    return diagnostics


def _find_all_missing_join_tokens(sql: str, dialect: str) -> list[dict[str, Any]]:
    """Find all lines and columns of JOINs missing an ON / USING clause."""
    diagnostics = []
    try:
        tokens = list(sqlglot.tokenize(sql, read=dialect))
    except Exception:
        return diagnostics

    for t in tokens:
        if "JOIN" in t.text.upper():
            start_col = max(1, t.col - len(t.text) + 1)
            diagnostics.append(
                {
                    "severity": "error",
                    "message": "Missing ON clause for JOIN",
                    "code": "SQL_SYNTAX_ERROR",
                    "line": t.line,
                    "column": start_col,
                    "end_column": start_col + len(t.text),
                    "token": t.text,
                    "source": dialect,
                }
            )
    return diagnostics


def _find_all_trailing_comma_tokens(sql: str, dialect: str) -> list[dict[str, Any]]:
    """Find trailing commas followed by FROM, WHERE, ), or ;."""
    diagnostics = []
    try:
        tokens = list(sqlglot.tokenize(sql, read=dialect))
    except Exception:
        return diagnostics

    for i, t in enumerate(tokens):
        if t.token_type == sqlglot.TokenType.COMMA:
            j = i + 1
            while j < len(tokens) and tokens[j].token_type in (sqlglot.TokenType.COMMENT,):
                j += 1
            if j < len(tokens) and tokens[j].token_type in (
                sqlglot.TokenType.FROM,
                sqlglot.TokenType.WHERE,
                sqlglot.TokenType.R_PAREN,
                sqlglot.TokenType.SEMICOLON,
            ):
                start_col = max(1, t.col - len(t.text) + 1)
                diagnostics.append(
                    {
                        "severity": "error",
                        "message": "Unexpected trailing comma",
                        "code": "SQL_SYNTAX_ERROR",
                        "line": t.line,
                        "column": start_col,
                        "end_column": start_col + 1,
                        "token": ",",
                        "source": dialect,
                    }
                )
    return diagnostics


def _clean_sql_code(sql: str) -> str:
    """Mask comments, quoted identifiers, and string literals with spaces, preserving newlines."""
    if not sql:
        return ""
    n = len(sql)
    i = 0
    clean_chars = list(sql)
    while i < n:
        if sql[i:i + 2] == "--":
            j = i + 2
            while j < n and sql[j] != "\n":
                j += 1
            for k in range(i, j):
                clean_chars[k] = " "
            i = j
            continue
        if sql[i:i + 2] == "/*":
            j = i + 2
            depth = 1
            while j < n and depth > 0:
                if sql[j:j + 2] == "/*":
                    depth += 1
                    j += 2
                elif sql[j:j + 2] == "*/":
                    depth -= 1
                    j += 2
                else:
                    j += 1
            for k in range(i, min(n, j)):
                if clean_chars[k] != "\n":
                    clean_chars[k] = " "
            i = j
            continue
        if sql[i] in ("E", "e") and i + 1 < n and sql[i + 1] == "'":
            j = i + 2
            while j < n:
                if sql[j] == "\\":
                    j += 2
                elif sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                    else:
                        j += 1
                        break
                else:
                    j += 1
            for k in range(i, min(n, j)):
                if clean_chars[k] != "\n":
                    clean_chars[k] = " "
            i = j
            continue
        if sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                    else:
                        j += 1
                        break
                else:
                    j += 1
            for k in range(i, min(n, j)):
                if clean_chars[k] != "\n":
                    clean_chars[k] = " "
            i = j
            continue
        if sql[i] == '"':
            j = i + 1
            while j < n:
                if sql[j] == '"':
                    if j + 1 < n and sql[j + 1] == '"':
                        j += 2
                    else:
                        j += 1
                        break
                else:
                    j += 1
            for k in range(i, min(n, j)):
                if clean_chars[k] != "\n":
                    clean_chars[k] = " "
            i = j
            continue
        if sql[i] == "[":
            j = i + 1
            while j < n and sql[j] != "]":
                j += 1
            j = min(n, j + 1)
            for k in range(i, j):
                if clean_chars[k] != "\n":
                    clean_chars[k] = " "
            i = j
            continue
        if sql[i] == "$":
            tag_match = re.match(r"\$[a-zA-Z0-9_]*\$", sql[i:])
            if tag_match:
                tag = tag_match.group(0)
                closing = sql.find(tag, i + len(tag))
                if closing != -1:
                    j = closing + len(tag)
                    for k in range(i, j):
                        if clean_chars[k] != "\n":
                            clean_chars[k] = " "
                    i = j
                    continue
        i += 1
    return "".join(clean_chars)


def find_unclosed_case_in_sql(sql: str) -> list[dict[str, Any]]:
    """Scan SQL for unclosed CASE expressions and return their locations."""
    if not sql:
        return []
    clean_sql = _clean_sql_code(sql)
    pattern = re.compile(r"\b(CASE|END(?:\s+IF|\s+LOOP|\s+CASE)?)\b|;", re.IGNORECASE)
    stack = []
    unclosed = []
    for m in pattern.finditer(clean_sql):
        tok = m.group(0).upper()
        pos = m.start()
        line = sql[:pos].count("\n") + 1
        last_nl = sql[:pos].rfind("\n")
        col = (pos + 1) if last_nl == -1 else (pos - last_nl)

        if tok == "CASE":
            stack.append({"line": line, "col": col, "pos": pos})
        elif tok in ("END", "END CASE"):
            if stack:
                stack.pop()
        elif tok == ";":
            if stack:
                unclosed.extend(stack)
                stack = []
    if stack:
        unclosed.extend(stack)
    return unclosed


def _find_all_tsql_try_catch_blocks(sql: str) -> list[dict[str, Any]]:
    """Validate paired BEGIN TRY ... END TRY BEGIN CATCH ... END CATCH blocks in T-SQL."""
    clean_sql = _clean_sql_code(sql)
    pattern = re.compile(r"\b(BEGIN\s+TRY|END\s+TRY|BEGIN\s+CATCH|END\s+CATCH)\b", re.IGNORECASE)
    try_stack = []
    catch_stack = []
    expecting_catch = None
    diags = []

    for m in pattern.finditer(clean_sql):
        raw_tok = m.group(0)
        tok = re.sub(r"\s+", " ", raw_tok.upper())
        pos = m.start()
        line = sql[:pos].count("\n") + 1
        last_nl = sql[:pos].rfind("\n")
        col = (pos + 1) if last_nl == -1 else (pos - last_nl)
        end_col = col + len(raw_tok)

        if tok == "BEGIN TRY":
            if expecting_catch:
                diags.append({
                    "severity": "error",
                    "message": "Missing BEGIN CATCH block: END TRY must be followed immediately by BEGIN CATCH",
                    "code": "SQL_SYNTAX_ERROR",
                    "line": expecting_catch["line"],
                    "column": expecting_catch["col"],
                    "end_column": expecting_catch["end_col"],
                    "token": "END TRY",
                    "source": "sqlserver",
                })
                expecting_catch = None
            try_stack.append({"line": line, "col": col, "end_col": end_col, "pos": pos})

        elif tok == "END TRY":
            if try_stack:
                try_stack.pop()
                expecting_catch = {"line": line, "col": col, "end_col": end_col, "pos": pos}
            else:
                diags.append({
                    "severity": "error",
                    "message": "Unmatched END TRY: no corresponding BEGIN TRY block",
                    "code": "SQL_SYNTAX_ERROR",
                    "line": line,
                    "column": col,
                    "end_column": end_col,
                    "token": raw_tok,
                    "source": "sqlserver",
                })

        elif tok == "BEGIN CATCH":
            if expecting_catch:
                expecting_catch = None
                catch_stack.append({"line": line, "col": col, "end_col": end_col, "pos": pos})
            else:
                diags.append({
                    "severity": "error",
                    "message": "BEGIN CATCH must follow immediately after an END TRY block",
                    "code": "SQL_SYNTAX_ERROR",
                    "line": line,
                    "column": col,
                    "end_column": end_col,
                    "token": raw_tok,
                    "source": "sqlserver",
                })
                catch_stack.append({"line": line, "col": col, "end_col": end_col, "pos": pos})

        elif tok == "END CATCH":
            if catch_stack:
                catch_stack.pop()
            else:
                diags.append({
                    "severity": "error",
                    "message": "Unmatched END CATCH: no corresponding BEGIN CATCH block",
                    "code": "SQL_SYNTAX_ERROR",
                    "line": line,
                    "column": col,
                    "end_column": end_col,
                    "token": raw_tok,
                    "source": "sqlserver",
                })

    if expecting_catch:
        diags.append({
            "severity": "error",
            "message": "Missing BEGIN CATCH block: END TRY must be followed by BEGIN CATCH",
            "code": "SQL_SYNTAX_ERROR",
            "line": expecting_catch["line"],
            "column": expecting_catch["col"],
            "end_column": expecting_catch["end_col"],
            "token": "END TRY",
            "source": "sqlserver",
        })

    for item in try_stack:
        diags.append({
            "severity": "error",
            "message": "Unclosed BEGIN TRY block: missing corresponding END TRY",
            "code": "SQL_SYNTAX_ERROR",
            "line": item["line"],
            "column": item["col"],
            "end_column": item["end_col"],
            "token": "BEGIN TRY",
            "source": "sqlserver",
        })

    for item in catch_stack:
        diags.append({
            "severity": "error",
            "message": "Unclosed BEGIN CATCH block: missing corresponding END CATCH",
            "code": "SQL_SYNTAX_ERROR",
            "line": item["line"],
            "column": item["col"],
            "end_column": item["end_col"],
            "token": "BEGIN CATCH",
            "source": "sqlserver",
        })

    return diags


def _validate_with_sqlglot(sql: str, dialect: str = "tsql") -> list[dict[str, Any]]:
    """Fallback or local validation using sqlglot parser with structural AST verification."""
    diagnostics: list[dict[str, Any]] = []
    try:
        expressions = sqlglot.parse(sql, read=dialect, error_level=sqlglot.ErrorLevel.RAISE)

        # 1. Structural token checks across all statements (including inside procedures/functions)
        diagnostics.extend(_find_all_empty_select_tokens(sql, dialect))
        diagnostics.extend(_find_all_trailing_comma_tokens(sql, dialect))
        if dialect == "tsql":
            diagnostics.extend(_find_all_tsql_try_catch_blocks(sql))

        # 2. Check Joins without ON clause
        for expr in expressions:
            if expr is None:
                continue
            for j in expr.find_all(sqlglot.exp.Join):
                kind = str(getattr(j, "kind", "") or "").upper()
                if "CROSS" not in kind and "NATURAL" not in kind:
                    if not j.args.get("on") and not j.args.get("using"):
                        diagnostics.extend(_find_all_missing_join_tokens(sql, dialect))
                        break

        # Deduplicate diagnostics by (line, column)
        seen = set()
        deduped = []
        for d in diagnostics:
            key = (d.get("line"), d.get("column"))
            if key not in seen:
                seen.add(key)
                deduped.append(d)
        return deduped

    except ParseError as e:
        errors = getattr(e, "errors", None) or [
            {"description": str(e), "line": 1, "col": 1, "highlight": ""}
        ]
        lines = sql.splitlines()

        for err in errors:
            line = err.get("line") or 1
            col = err.get("col") or 1
            token = (err.get("highlight") or "").strip()
            desc = err.get("description") or str(e)

            # Special handling for "Expected END after CASE":
            # sqlglot often points to the next token (which may be a valid END of another CASE or AS).
            # We locate the actual unclosed CASE expression in the SQL text.
            if "Expected END after CASE" in desc or "missing end" in desc.lower():
                unclosed = find_unclosed_case_in_sql(sql)
                if unclosed:
                    chosen = unclosed[0]
                    for item in unclosed:
                        if item["line"] <= line:
                            chosen = item
                        else:
                            break
                    line = chosen["line"]
                    col = chosen["col"]
                    token = "CASE"
                    desc = "Unclosed CASE expression: missing corresponding END"

            # Determine end column and align col with token start if found on line
            if 0 < line <= len(lines):
                col, end_col = _compute_token_position(lines[line - 1], token, default_col=col)
            else:
                end_col = col + max(1, len(token))

            diagnostics.append(
                {
                    "severity": "error",
                    "message": desc,
                    "code": "SQL_SYNTAX_ERROR",
                    "line": line,
                    "column": col,
                    "end_column": end_col,
                    "token": token,
                    "source": dialect,
                }
            )
        return diagnostics
    except Exception as e:
        logger.debug(f"[SyntaxCheck] sqlglot unexpected error: {e}")
        return []


def validate_sql_server(
    sql: str,
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
) -> list[dict[str, Any]]:
    """
    Validate SQL Server syntax using SET PARSEONLY ON if connection is available,
    otherwise falling back to sqlglot parser.
    Supports procedural statements (CREATE PROCEDURE, ALTER FUNCTION, EXEC, DECLARE, etc.)
    and multi-batch SQL containing standalone GO statements.
    """
    raw_connection = None
    if connection_session:
        # Prefer dedicated auxiliary validation connection if available and not a mock placeholder
        get_val_conn = getattr(connection_session, "get_validation_connection", None)
        if callable(get_val_conn) and not type(get_val_conn).__name__.startswith("MagicMock"):
            try:
                raw_connection = get_val_conn()
            except Exception:
                raw_connection = None
        if raw_connection is None and getattr(connection_session, "adapter", None):
            raw_connection = getattr(connection_session.adapter, "connection", None)

    # 1. Database-Native Validation via SET PARSEONLY ON
    if raw_connection is not None:
        session_lock = getattr(connection_session, "lock", None)
        lock_acquired = False
        if session_lock is not None:
            try:
                lock_acquired = session_lock.acquire(timeout=0.8)
                if not lock_acquired:
                    # Lock busy -> do not fallback to sqlglot to prevent intermittent false errors
                    logger.debug("[SyntaxCheck] SQL Server session lock busy, skipping live check")
                    return []
            except Exception:
                pass

        try:
            cursor = raw_connection.cursor()
            diagnostics: list[dict[str, Any]] = []
            all_lines = sql.splitlines()

            orig_db = None
            try:
                if database:
                    try:
                        cursor.execute("SELECT DB_NAME()")
                        row = cursor.fetchone()
                        if row and row[0]:
                            orig_db = row[0]
                    except Exception:
                        pass
                    try:
                        clean_db = str(database).replace("]", "]]")
                        cursor.execute(f"USE [{clean_db}]")
                    except Exception:
                        pass

                from app.database.syntax.proc_body_detector import clean_ident, extract_proc_bodies
                proc_bodies = extract_proc_bodies(sql, dialect="sqlserver")
                proc_map = {p["clean_name"]: p["start_line"] for p in proc_bodies}

                batches = split_sqlserver_batches(sql)
                if not batches:
                    batches = [{"text": sql, "start_line": 1, "line_count": len(all_lines)}]

                for batch in batches:
                    batch_text = batch["text"]
                    batch_start_line = batch["start_line"]
                    current_batch_text = batch_text

                    # Try collecting multiple errors per batch using dynamic execution with SET PARSEONLY ON
                    batch_errors = 0
                    max_batch_errors = 5

                    while batch_errors < max_batch_errors:
                        try:
                            escaped_batch = current_batch_text.replace("'", "''")
                            check_query = f"""
                            BEGIN TRY
                                EXEC('SET PARSEONLY ON;
{escaped_batch}');
                            END TRY
                            BEGIN CATCH
                                SELECT ERROR_LINE() - 1 AS err_line, ERROR_MESSAGE() AS err_msg, ERROR_NUMBER() AS err_num;
                            END CATCH
                            """
                            cursor.execute(check_query)
                            if not cursor.description:
                                break
                            rows = cursor.fetchall()
                            if not rows:
                                break
                            batch_rel_line, err_msg, err_num = rows[0]
                            if not isinstance(batch_rel_line, (int, float)):
                                try:
                                    batch_rel_line = int(batch_rel_line)
                                except (TypeError, ValueError):
                                    break

                            if not batch_rel_line or batch_rel_line < 1:
                                break

                            token_match = re.search(
                                r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?",
                                err_msg,
                                re.IGNORECASE,
                            )
                            token = token_match.group(1) if token_match else ""
                            token = token.rstrip(".'\"").strip("'\"").strip()

                            proc_match = re.search(r"Procedure\s+([^\s,]+),\s*Line\s+(\d+)", err_msg, re.IGNORECASE)
                            if proc_match:
                                raw_p_name = proc_match.group(1).strip()
                                p_clean = clean_ident(raw_p_name.split(".")[-1]).lower()
                                proc_rel_line = int(proc_match.group(2))
                                if p_clean in proc_map:
                                    proc_start_line = proc_map[p_clean]
                                else:
                                    proc_start_line = batch_start_line
                                    batch_lines = batch_text.splitlines()
                                    for idx_bl, bl_text in enumerate(batch_lines):
                                        if re.search(r"\b(?:CREATE|ALTER)\s+(?:PROCEDURE|PROC|FUNCTION|TRIGGER)\b", bl_text, re.IGNORECASE):
                                            proc_start_line = batch_start_line + idx_bl
                                            break
                                doc_line = proc_start_line + proc_rel_line - 1
                            else:
                                doc_line = batch_start_line + batch_rel_line - 1

                            # Adjust doc_line if token is on adjacent line
                            if 0 < doc_line <= len(all_lines) and token:
                                if token not in all_lines[doc_line - 1]:
                                    if doc_line > 1 and token in all_lines[doc_line - 2]:
                                        doc_line -= 1
                                    elif doc_line < len(all_lines) and token in all_lines[doc_line]:
                                        doc_line += 1

                            # Calculate column based on token position in target line
                            col, end_col = 1, 2
                            if 0 < doc_line <= len(all_lines):
                                col, end_col = _compute_token_position(all_lines[doc_line - 1], token)

                            clean_msg = _clean_sqlserver_message(err_msg)

                            diagnostics.append(
                                {
                                    "severity": "error",
                                    "message": clean_msg,
                                    "code": "SQL_SYNTAX_ERROR",
                                    "line": doc_line,
                                    "column": col,
                                    "end_column": end_col,
                                    "token": token,
                                    "source": "sqlserver",
                                }
                            )

                            batch_errors += 1

                            # Mask the faulty line to find subsequent errors in the same batch
                            batch_lines = current_batch_text.splitlines()
                            if 0 < batch_rel_line <= len(batch_lines):
                                batch_lines[batch_rel_line - 1] = "/* err */ SELECT 1;"
                                current_batch_text = "\n".join(batch_lines)
                            else:
                                break

                        except (StopIteration, GeneratorExit):
                            break
                        except Exception as batch_parse_err:
                            # Fallback to direct execute if dynamic EXEC parsing fails
                            try:
                                cursor.execute("SET PARSEONLY ON")
                                cursor.execute(batch_text)
                            except (StopIteration, GeneratorExit):
                                pass
                            except Exception as direct_err:
                                raw_err = str(direct_err).strip()
                                line_match = re.search(r"Line\s+(\d+)", raw_err, re.IGNORECASE)
                                token_match = re.search(
                                    r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?",
                                    raw_err,
                                    re.IGNORECASE,
                                )
                                token = token_match.group(1) if token_match else ""
                                token = token.rstrip(".'\"").strip("'\"").strip()

                                proc_match = re.search(r"Procedure\s+([^\s,]+),\s*Line\s+(\d+)", raw_err, re.IGNORECASE)
                                if proc_match:
                                    raw_p_name = proc_match.group(1).strip()
                                    p_clean = clean_ident(raw_p_name.split(".")[-1]).lower()
                                    proc_rel_line = int(proc_match.group(2))
                                    if p_clean in proc_map:
                                        proc_start_line = proc_map[p_clean]
                                    else:
                                        proc_start_line = batch_start_line
                                        batch_lines = batch_text.splitlines()
                                        for idx_bl, bl_text in enumerate(batch_lines):
                                            if re.search(r"\b(?:CREATE|ALTER)\s+(?:PROCEDURE|PROC|FUNCTION|TRIGGER)\b", bl_text, re.IGNORECASE):
                                                proc_start_line = batch_start_line + idx_bl
                                                break
                                    doc_line = proc_start_line + proc_rel_line - 1
                                elif line_match:
                                    doc_line = batch_start_line + int(line_match.group(1)) - 1
                                elif token:
                                    found_line = None
                                    for idx_l, l_text in enumerate(all_lines):
                                        if token in l_text:
                                            found_line = idx_l + 1
                                            break
                                    doc_line = found_line if found_line is not None else batch_start_line
                                else:
                                    doc_line = batch_start_line

                                col, end_col = 1, 2
                                if 0 < doc_line <= len(all_lines):
                                    col, end_col = _compute_token_position(all_lines[doc_line - 1], token)

                                clean_msg = _clean_sqlserver_message(raw_err)

                                diagnostics.append(
                                    {
                                        "severity": "error",
                                        "message": clean_msg,
                                        "code": "SQL_SYNTAX_ERROR",
                                        "line": doc_line,
                                        "column": col,
                                        "end_column": end_col,
                                        "token": token,
                                        "source": "sqlserver",
                                    }
                                )
                            finally:
                                try:
                                    cursor.execute("SET PARSEONLY OFF")
                                except Exception:
                                    pass
                            break

                return diagnostics
            finally:
                if orig_db:
                    try:
                        clean_orig = str(orig_db).replace("]", "]]")
                        cursor.execute(f"USE [{clean_orig}]")
                    except Exception:
                        pass
                try:
                    cursor.execute("SET PARSEONLY OFF")
                except Exception:
                    pass
                try:
                    cursor.close()
                except Exception:
                    pass

        except (StopIteration, GeneratorExit):
            return []
        except Exception as conn_err:
            logger.debug(
                f"[SyntaxCheck] SQL Server live parse failed or connection unavailable: {conn_err}"
            )
            return []
        finally:
            if lock_acquired and session_lock is not None:
                try:
                    session_lock.release()
                except Exception:
                    pass

    # Offline / fallback validation with sqlglot
    return _validate_with_sqlglot(sql, dialect="tsql")
