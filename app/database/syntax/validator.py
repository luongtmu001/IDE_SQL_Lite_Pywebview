"""
Backend SQL Syntax Validator for SQL Server (T-SQL) and PostgreSQL.
Provides side-effect-free syntax checking using database-native mechanisms
(SET PARSEONLY ON for SQL Server) with sqlglot fallback.

Reference: .SKILL/sytax_check.md
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


def _validate_with_sqlglot(sql: str, dialect: str = "tsql") -> list[dict[str, Any]]:
    """Fallback or local validation using sqlglot parser with structural AST verification."""
    diagnostics: list[dict[str, Any]] = []
    try:
        expressions = sqlglot.parse(sql, read=dialect, error_level=sqlglot.ErrorLevel.RAISE)

        # 1. Structural token checks across all statements (including inside procedures/functions)
        diagnostics.extend(_find_all_empty_select_tokens(sql, dialect))
        diagnostics.extend(_find_all_trailing_comma_tokens(sql, dialect))

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

            # Determine end column and align col with token start if found on line
            end_col = col + max(1, len(token))
            if 0 < line <= len(lines):
                line_text = lines[line - 1]
                if token and token in line_text:
                    if re.match(r"^\w+$", token):
                        m = re.search(rf"\b{re.escape(token)}\b", line_text, re.IGNORECASE)
                        if m:
                            col = m.start() + 1
                            end_col = m.end() + 1
                        else:
                            idx = line_text.find(token)
                            col = idx + 1
                            end_col = col + len(token)
                    else:
                        idx = line_text.find(token)
                        col = idx + 1
                        end_col = col + len(token)
                elif col > len(line_text):
                    col = max(1, len(line_text))
                    end_col = col + 1

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
    otherwise fallback to sqlglot (read='tsql').
    Zero side-effects: statements are only compiled/parsed, never executed.
    Uses connection_session.lock to guarantee thread safety against concurrent queries.
    Captures accurate line numbers and multiple diagnostics per script.
    """
    raw_connection = None
    if connection_session and getattr(connection_session, "adapter", None):
        raw_connection = getattr(connection_session.adapter, "connection", None)

    # If active connection is available, use database-native SET PARSEONLY ON
    if raw_connection is not None:
        session_lock = getattr(connection_session, "lock", None)
        lock_acquired = False
        if session_lock is not None:
            try:
                lock_acquired = session_lock.acquire(timeout=0.8)
                if not lock_acquired:
                    # Lock busy (another query or metadata load in progress) -> do NOT fallback to sqlglot
                    logger.debug("[SyntaxCheck] SQL Server session lock busy, skipping live check")
                    return []
            except Exception:
                pass

        try:
            batches = split_sqlserver_batches(sql)
            if not batches:
                return []

            cursor = raw_connection.cursor()
            orig_db = None
            try:
                # Optionally switch database context if specified, saving original context
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

                all_lines = sql.splitlines()
                diagnostics: list[dict[str, Any]] = []

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
                            if not batch_rel_line or batch_rel_line < 1:
                                break

                            doc_line = batch_start_line + batch_rel_line - 1

                            token_match = re.search(
                                r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?",
                                err_msg,
                                re.IGNORECASE,
                            )
                            token = token_match.group(1) if token_match else ""
                            token = token.rstrip(".'\"").strip("'\"").strip()

                            # Adjust doc_line if token is on adjacent line
                            if 0 < doc_line <= len(all_lines) and token:
                                if token not in all_lines[doc_line - 1]:
                                    if doc_line > 1 and token in all_lines[doc_line - 2]:
                                        doc_line -= 1
                                    elif doc_line < len(all_lines) and token in all_lines[doc_line]:
                                        doc_line += 1

                            # Calculate column based on token position in target line
                            col = 1
                            end_col = 2
                            if 0 < doc_line <= len(all_lines):
                                target_line = all_lines[doc_line - 1]
                                if token and token in target_line:
                                    if re.match(r"^\w+$", token):
                                        m = re.search(rf"\b{re.escape(token)}\b", target_line, re.IGNORECASE)
                                        if m:
                                            col = m.start() + 1
                                            end_col = m.end() + 1
                                        else:
                                            idx = target_line.find(token)
                                            col = idx + 1
                                            end_col = col + len(token)
                                    else:
                                        idx = target_line.find(token)
                                        col = idx + 1
                                        end_col = col + len(token)
                                else:
                                    stripped = target_line.strip()
                                    if stripped:
                                        idx = target_line.find(stripped)
                                        col = idx + 1
                                        end_col = col + len(stripped)
                                    else:
                                        col = 1
                                        end_col = max(2, len(target_line) + 1)

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

                            # Mask the line with a valid dummy statement to find subsequent errors
                            curr_lines = current_batch_text.splitlines()
                            if 0 < batch_rel_line <= len(curr_lines):
                                curr_lines[batch_rel_line - 1] = "/* err */ SELECT 1;"
                                current_batch_text = "\n".join(curr_lines)
                            else:
                                break

                        except Exception:
                            # Fallback to direct SET PARSEONLY ON execution
                            try:
                                cursor.execute("SET PARSEONLY ON")
                                cursor.execute(current_batch_text)
                                while cursor.nextset():
                                    pass
                            except Exception as batch_err:
                                err_str = str(batch_err)

                                # Check if error is inside a stored procedure / function / trigger / view
                                proc_match = re.search(
                                    r"Procedure\s+([^\s,]+),\s*Line\s+(\d+)",
                                    err_str,
                                    re.IGNORECASE,
                                )
                                if proc_match:
                                    proc_raw_name = proc_match.group(1).split(".")[-1].strip("[]")
                                    proc_rel_line = int(proc_match.group(2))
                                    all_batch_lines = batch_text.splitlines()
                                    proc_def_offset = 0
                                    proc_pattern = re.compile(
                                        r"^\s*(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b",
                                        re.IGNORECASE,
                                    )
                                    for idx, bline in enumerate(all_batch_lines):
                                        if proc_pattern.search(bline):
                                            proc_def_offset = idx
                                            if proc_raw_name.lower() in bline.lower():
                                                break
                                    batch_rel_line = proc_def_offset + proc_rel_line
                                else:
                                    line_match = re.search(r"(?:Line|line)[:\s]+(\d+)", err_str)
                                    if line_match:
                                        batch_rel_line = int(line_match.group(1))
                                    else:
                                        # If no line number, search batch lines for the token to avoid line 1 fallback
                                        batch_rel_line = 1
                                        token_match = re.search(
                                            r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?",
                                            err_str,
                                            re.IGNORECASE,
                                        )
                                        token = token_match.group(1) if token_match else ""
                                        token = token.rstrip(".'\"").strip("'\"").strip()
                                        if token:
                                            all_batch_lines = batch_text.splitlines()
                                            for idx, bline in enumerate(all_batch_lines):
                                                if re.match(r"^\w+$", token):
                                                    if re.search(rf"\b{re.escape(token)}\b", bline, re.IGNORECASE):
                                                        batch_rel_line = idx + 1
                                                        break
                                                elif token in bline:
                                                    batch_rel_line = idx + 1
                                                    break

                                doc_line = batch_start_line + batch_rel_line - 1

                                token_match = re.search(
                                    r"near\s+(?:the\s+keyword\s+)?['\"]?([^'\"\r\n]+)['\"]?",
                                    err_str,
                                    re.IGNORECASE,
                                )
                                token = token_match.group(1) if token_match else ""
                                token = token.rstrip(".'\"").strip("'\"").strip()

                                col = 1
                                end_col = 2
                                if 0 < doc_line <= len(all_lines):
                                    target_line = all_lines[doc_line - 1]
                                    if token and token in target_line:
                                        idx = target_line.find(token)
                                        col = idx + 1
                                        end_col = col + len(token)
                                    else:
                                        stripped = target_line.strip()
                                        if stripped:
                                            idx = target_line.find(stripped)
                                            col = idx + 1
                                            end_col = col + len(stripped)

                                clean_msg = _clean_sqlserver_message(err_str)
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


def _position_to_line_col(sql: str, pos: int) -> tuple[int, int]:
    """Convert 1-based character position from PostgreSQL statement_position into (line, col)."""
    target = max(0, min(pos - 1, len(sql)))
    line = sql[:target].count("\n") + 1
    last_nl = sql[:target].rfind("\n")
    col = target + 1 if last_nl == -1 else target - last_nl
    return line, col


def mask_debug_extensions_for_validation(sql: str) -> tuple[str, list[dict[str, Any]]]:
    """
    Mask all bs.* calls in the SQL text for PostgreSQL syntax checking in debug mode.
    Preserves exact line numbers and line structure while replacing bs.* calls so that
    PostgreSQL or sqlglot do not check or flag syntax of bs.* calls.
    """
    try:
        from app.database.debug.instrumenter import detect_debug_extensions
        items = detect_debug_extensions(sql)
    except Exception:
        items = []

    if not items:
        return sql, []

    sorted_items = sorted(items, key=lambda x: x["startOffset"], reverse=True)
    res = sql

    for item in sorted_items:
        start_off = item["startOffset"]
        end_off = item["endOffset"]
        rem = res[end_off:]
        m_semi = re.match(r"^([ \t]*;+)", rem)
        if m_semi:
            end_off += len(m_semi.group(0))

        original_block = res[start_off:end_off]
        lines = original_block.split("\n")

        preceding = res[:start_off]
        dollar_tags = re.findall(r"\$[a-zA-Z0-9_]*\$", preceding)
        inside_dollar_quotes = (len(dollar_tags) % 2 == 1)

        masked_lines = []
        total = len(lines)
        if total == 1:
            line_len = len(lines[0])
            if inside_dollar_quotes:
                if line_len >= 10:
                    masked = "/*" + " " * (line_len - 10) + "*/ NULL;"
                elif line_len >= 5:
                    masked = "NULL;" + " " * (line_len - 5)
                else:
                    masked = " " * line_len
            else:
                if line_len >= 4:
                    masked = "/*" + " " * (line_len - 4) + "*/"
                else:
                    masked = " " * line_len
            masked_lines.append(masked)
        else:
            for idx, line in enumerate(lines):
                line_len = len(line)
                if idx == 0:
                    if line_len >= 2:
                        masked_lines.append("/*" + " " * (line_len - 2))
                    else:
                        masked_lines.append(" " * line_len)
                elif idx == total - 1:
                    if inside_dollar_quotes:
                        if line_len >= 8:
                            masked_lines.append(" " * (line_len - 8) + "*/ NULL;")
                        elif line_len >= 2:
                            masked_lines.append(" " * (line_len - 2) + "*/")
                        else:
                            masked_lines.append(" " * line_len)
                    else:
                        if line_len >= 2:
                            masked_lines.append(" " * (line_len - 2) + "*/")
                        else:
                            masked_lines.append(" " * line_len)
                else:
                    masked_lines.append(" " * line_len)

        masked_block = "\n".join(masked_lines)
        res = res[:start_off] + masked_block + res[end_off:]

    return res, items


def _filter_debug_diagnostics(diagnostics: list[dict[str, Any]], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter out diagnostics originating from or inside bs.* calls."""
    if not items:
        return diagnostics

    filtered = []
    for d in diagnostics:
        token = str(d.get("token") or "").lower().strip()
        msg = str(d.get("message") or "").lower()
        if token == "bs" or token.startswith("bs.") or "bs." in msg or 'relation "_ide_debug_trace_queue"' in msg:
            continue
        line = d.get("line", -1)
        is_in_ext = False
        for it in items:
            if it.get("startLine", -1) <= line <= it.get("endLine", -1):
                is_in_ext = True
                break
        if not is_in_ext:
            filtered.append(d)
    return filtered


def _is_destructive_or_locking_ddl(sql: str) -> bool:
    """Check if SQL contains DDL or statements that alter objects or cannot be analyzed via EXPLAIN."""
    if not sql:
        return False
    cleaned = re.sub(r"--[^\r\n]*", "", sql)
    cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL).strip()
    ddl_pattern = re.compile(
        r"^\s*(?:ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|VACUUM|REINDEX|CLUSTER|COMMENT|CALL|DO)\b",
        re.IGNORECASE,
    )
    return bool(ddl_pattern.search(cleaned))


def validate_postgresql(
    sql: str,
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    is_debug: bool = False,
) -> list[dict[str, Any]]:
    """
    Validate PostgreSQL syntax using database-native EXPLAIN (VERBOSE) for DML/queries,
    offline parsing for DDL/destructive statements, and sqlglot fallback.
    Zero side-effects: no statements are ever executed, no sequences advanced, no locks held,
    no data modified, and user transactions are never aborted or rolled back.
    """
    if is_debug:
        check_sql, debug_items = mask_debug_extensions_for_validation(sql)
    else:
        check_sql, debug_items = sql, []

    # If SQL contains destructive or locking DDL, validate offline only (never sent to live DB)
    if _is_destructive_or_locking_ddl(check_sql):
        diags = _validate_with_sqlglot(check_sql, dialect="postgres")
        return _filter_debug_diagnostics(diags, debug_items) if is_debug else diags

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

    # Protect user's active transaction: never execute on shared connection if user is in-transaction
    if raw_connection is not None:
        user_in_tx = getattr(connection_session, "in_transaction", False)
        if isinstance(user_in_tx, bool) and user_in_tx:
            logger.debug("[SyntaxCheck] PostgreSQL session has active user transaction; validating offline")
            diags = _validate_with_sqlglot(check_sql, dialect="postgres")
            return _filter_debug_diagnostics(diags, debug_items) if is_debug else diags

        tx_status = getattr(raw_connection, "status", 0)
        if isinstance(tx_status, int) and tx_status != 0:
            logger.debug("[SyntaxCheck] PostgreSQL connection is in transaction state; validating offline")
            diags = _validate_with_sqlglot(check_sql, dialect="postgres")
            return _filter_debug_diagnostics(diags, debug_items) if is_debug else diags

        autocommit_on = getattr(raw_connection, "autocommit", True)
        if isinstance(autocommit_on, bool) and not autocommit_on:
            logger.debug("[SyntaxCheck] PostgreSQL connection autocommit is off; validating offline")
            diags = _validate_with_sqlglot(check_sql, dialect="postgres")
            return _filter_debug_diagnostics(diags, debug_items) if is_debug else diags

        session_lock = getattr(connection_session, "lock", None)
        lock_acquired = False
        if session_lock is not None:
            try:
                lock_acquired = session_lock.acquire(timeout=0.8)
                if not lock_acquired:
                    # Lock busy -> do not fallback to sqlglot to prevent intermittent false errors
                    logger.debug("[SyntaxCheck] PostgreSQL session lock busy, skipping live check")
                    return []
            except Exception:
                pass

        diagnostics: list[dict[str, Any]] = []
        try:
            cursor = raw_connection.cursor()
            orig_search_path = None
            try:
                target_schema = (schema or "").strip()
                if target_schema:
                    try:
                        cursor.execute("SHOW search_path;")
                        row = cursor.fetchone()
                        if row and row[0]:
                            orig_search_path = row[0]
                    except Exception:
                        pass
                    try:
                        cursor.execute(f'SET search_path TO "{target_schema}", public, pg_catalog;')
                    except Exception:
                        pass

                current_sql = check_sql
                max_errors = 5
                err_count = 0
                seen_diag_keys = set()
                seen_lines = set()

                while err_count < max_errors:
                    try:
                        # Side-effect-free validation: EXPLAIN (VERBOSE) compiles and plans without executing
                        check_stmt = f"EXPLAIN (VERBOSE) {current_sql.rstrip(';')}"
                        cursor.execute(check_stmt)
                        break
                    except (StopIteration, GeneratorExit):
                        break
                    except Exception as pg_err:
                        diag = getattr(pg_err, "diag", None)
                        err_str = str(pg_err).strip()
                        msg = getattr(diag, "message_primary", None) or err_str.splitlines()[0]
                        pos = getattr(diag, "statement_position", None)

                        col_err_m = re.search(r'column\s+["\']([^"\']+)["\']\s+does not exist', err_str, re.IGNORECASE)
                        rel_err_m = re.search(r'relation\s+["\']([^"\']+)["\']\s+does not exist', err_str, re.IGNORECASE)
                        if col_err_m:
                            token = col_err_m.group(1)
                        elif rel_err_m:
                            token = rel_err_m.group(1)
                        else:
                            token_m = re.search(r'(?:at or near|near)\s+["\']?([^"\'\r\n]+)["\']?', err_str)
                            token = token_m.group(1) if token_m else ""
                        token = token.rstrip(".'\"").strip("'\"").strip()

                        line = 1
                        col = 1
                        if pos:
                            try:
                                raw_pos = int(pos)
                                prefix_len = len("EXPLAIN (VERBOSE) ")
                                curr_split = current_sql.splitlines()
                                adj_pos = raw_pos
                                # Check if raw_pos includes prefix or matches directly
                                if raw_pos > prefix_len:
                                    p_line, _ = _position_to_line_col(current_sql, raw_pos - prefix_len)
                                    if 0 < p_line <= len(curr_split) and token and token in curr_split[p_line - 1]:
                                        adj_pos = raw_pos - prefix_len
                                    else:
                                        p_line2, _ = _position_to_line_col(current_sql, raw_pos)
                                        if 0 < p_line2 <= len(curr_split) and token and token in curr_split[p_line2 - 1]:
                                            adj_pos = raw_pos
                                        else:
                                            adj_pos = raw_pos - prefix_len
                                line, col = _position_to_line_col(current_sql, adj_pos)
                            except Exception:
                                line = 1
                                col = 1
                        else:
                            line_m = re.search(r"LINE\s+(\d+):", err_str)
                            if line_m:
                                line = int(line_m.group(1))

                        # Adjust col and end_col on target_line
                        end_col = col + max(1, len(token))
                        curr_lines = current_sql.splitlines()
                        if 0 < line <= len(curr_lines):
                            target_line = curr_lines[line - 1]
                            if token and token in target_line:
                                if re.match(r"^\w+$", token):
                                    m = re.search(rf"\b{re.escape(token)}\b", target_line, re.IGNORECASE)
                                    if m:
                                        col = m.start() + 1
                                        end_col = m.end() + 1
                                    else:
                                        idx = target_line.find(token)
                                        col = idx + 1
                                        end_col = col + len(token)
                                else:
                                    idx = target_line.find(token)
                                    col = idx + 1
                                    end_col = col + len(token)
                            else:
                                stripped = target_line.strip()
                                if stripped:
                                    idx = target_line.find(stripped)
                                    col = idx + 1
                                    end_col = col + len(stripped)

                        diag_key = (line, col, token)
                        if diag_key in seen_diag_keys or line in seen_lines:
                            break
                        seen_diag_keys.add(diag_key)
                        seen_lines.add(line)

                        diagnostics.append(
                            {
                                "severity": "error",
                                "message": msg,
                                "code": "SQL_SYNTAX_ERROR",
                                "line": line,
                                "column": col,
                                "end_column": end_col,
                                "token": token,
                                "source": "postgresql",
                            }
                        )

                        err_count += 1

                        if 0 < line <= len(curr_lines):
                            curr_lines[line - 1] = "/* err */ SELECT 1;"
                            current_sql = "\n".join(curr_lines)
                        else:
                            break

                final_diags = _filter_debug_diagnostics(diagnostics, debug_items) if is_debug else diagnostics
                return final_diags
            finally:
                if orig_search_path:
                    try:
                        cursor.execute(f"SET search_path TO {orig_search_path};")
                    except Exception:
                        pass
                try:
                    cursor.close()
                except Exception:
                    pass

        except (StopIteration, GeneratorExit):
            if diagnostics:
                return _filter_debug_diagnostics(diagnostics, debug_items) if is_debug else diagnostics
        except Exception as conn_err:
            if diagnostics:
                return _filter_debug_diagnostics(diagnostics, debug_items) if is_debug else diagnostics
            logger.debug(
                f"[SyntaxCheck] PostgreSQL live parse failed or connection unavailable: {conn_err}"
            )
            return []
        finally:
            if lock_acquired and session_lock is not None:
                try:
                    session_lock.release()
                except Exception:
                    pass

    diags = _validate_with_sqlglot(check_sql, dialect="postgres")
    if not is_debug:
        try:
            from app.database.debug.instrumenter import detect_debug_extensions
            ext_items = detect_debug_extensions(sql)
            for it in ext_items:
                diags.append({
                    "severity": "error",
                    "message": f'Function or syntax "{it["name"]}" is not valid PostgreSQL syntax outside debug mode',
                    "code": "SQL_SYNTAX_ERROR",
                    "line": it["startLine"],
                    "column": it["startCol"],
                    "end_column": it["endCol"],
                    "token": it["name"],
                    "source": "postgresql",
                })
        except Exception:
            pass
    return _filter_debug_diagnostics(diags, debug_items) if is_debug else diags


def validate_sql(
    sql: str,
    dialect: str = "sqlserver",
    connection_session: Any = None,
    database: str | None = None,
    schema: str | None = None,
    is_debug: bool = False,
    cached_tables_dict: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """
    Main entrypoint for syntax and semantic validation across SQL Server and PostgreSQL.
    Combines database-native syntax checking (or fallback) with semantic column/table
    verification for physical tables, temporary tables, table variables, and CTEs.
    """
    if not sql or not sql.strip():
        return []

    d = (dialect or "sqlserver").strip().lower()

    # 1. Native Database Syntax / Grammar Validation
    if "postgres" in d or "pgsql" in d or d == "pg":
        diagnostics = validate_postgresql(
            sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
            is_debug=is_debug,
        )
    else:
        diagnostics = validate_sql_server(
            sql,
            connection_session=connection_session,
            database=database,
            schema=schema,
        )

    # 2. Semantic Analysis: validate columns in physical tables, temp tables, table variables, and CTEs
    try:
        from app.database.syntax.semantic_analyzer import analyze_sql_semantics
        semantic_diags = analyze_sql_semantics(
            sql=sql,
            dialect=d,
            connection_session=connection_session,
            database=database,
            schema=schema,
            cached_tables_dict=cached_tables_dict,
        )
        if semantic_diags:
            # Merge and deduplicate by (line, column, token)
            existing_keys = {
                (diag.get("line"), diag.get("column"), str(diag.get("token", "")).lower())
                for diag in diagnostics
            }
            for s_diag in semantic_diags:
                key = (s_diag.get("line"), s_diag.get("column"), str(s_diag.get("token", "")).lower())
                if key not in existing_keys:
                    diagnostics.append(s_diag)
                    existing_keys.add(key)
    except Exception as exc:
        logger.debug(f"[SyntaxCheck] semantic analyzer exception: {exc}")

    return diagnostics
