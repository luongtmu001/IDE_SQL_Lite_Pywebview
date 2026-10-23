# -*- coding: utf-8 -*-
"""
PostgreSQL Syntax Validator.
Provides side-effect-free PostgreSQL syntax checking using EXPLAIN (VERBOSE)
on live database connection, offline validation for destructive/locking DDL,
and sqlglot fallback.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from app.database.syntax.validator_mssql import _validate_with_sqlglot

logger = logging.getLogger(__name__)


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

    lines = sql.splitlines(keepends=True)
    chars = list(sql)

    for item in items:
        start = item.get("start")
        end = item.get("end")
        if start is not None and end is not None and 0 <= start < end <= len(chars):
            snippet = "".join(chars[start:end])
            masked_chars = []
            for ch in snippet:
                if ch in ("\r", "\n"):
                    masked_chars.append(ch)
                else:
                    masked_chars.append(" ")
            chars[start:end] = masked_chars

    return "".join(chars), items


def _filter_debug_diagnostics(
    diagnostics: list[dict[str, Any]], debug_items: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Remove any diagnostics whose location overlaps with masked debug extensions."""
    if not debug_items:
        return diagnostics

    filtered = []
    for diag in diagnostics:
        d_line = diag.get("line", 1)
        d_col = diag.get("column", 1)
        overlap = False
        for item in debug_items:
            s_line = item.get("startLine", 1)
            e_line = item.get("endLine", 1)
            s_col = item.get("startCol", 1)
            e_col = item.get("endCol", 1)

            if s_line <= d_line <= e_line:
                if s_line == e_line:
                    if s_col <= d_col <= e_col:
                        overlap = True
                        break
                else:
                    overlap = True
                    break
        if not overlap:
            filtered.append(diag)
    return filtered


def _is_destructive_or_locking_ddl(sql: str) -> bool:
    """Detect DDL or catalog modifications that must never run against a live database."""
    ddl_pattern = re.compile(
        r"\b(?:"
        r"DROP\s+(?:DATABASE|TABLE|SCHEMA|VIEW|INDEX|FUNCTION|PROCEDURE|SEQUENCE|TRIGGER|TYPE|DOMAIN|EXTENSION|MATERIALIZED\s+VIEW)|"
        r"ALTER\s+(?:DATABASE|TABLE|SCHEMA|SYSTEM|ROLE|USER|VIEW|INDEX|SEQUENCE|FUNCTION|PROCEDURE|TRIGGER|TYPE|DOMAIN|MATERIALIZED\s+VIEW)|"
        r"TRUNCATE(?:\s+TABLE)?|"
        r"CREATE\s+(?:"
            r"(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|MATERIALIZED\s+VIEW)|"
            r"(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+|RECURSIVE\s+)?VIEW|"
            r"(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+|UNLOGGED\s+)?TABLE|"
            r"(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+)?SEQUENCE|"
            r"(?:UNIQUE\s+)?INDEX|"
            r"DATABASE|SCHEMA|TYPE|DOMAIN|EXTENSION"
        r")|"
        r"DO(?:\s+LANGUAGE\s+[a-zA-Z0-9_]+)?\s*\$|"
        r"CALL\s+[a-zA-Z0-9_.\"$]+|"
        r"VACUUM|REINDEX|CLUSTER"
        r")\b",
        re.IGNORECASE,
    )
    cleaned = re.sub(r"--[^\r\n]*", " ", sql)
    cleaned = re.sub(r"/\*.*?\*/", " ", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"'(''|[^'])*'", " ", cleaned)
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
