# -*- coding: utf-8 -*-
"""
Best-Practice SQL Warning Rules (Sprint 3 - Smart IDE v1.1.0).
Provides non-fatal diagnostic rules (BP001 - BP006) for T-SQL and standard SQL:
- BP001: SELECT * without explicit column list (Severity: warning)
- BP002: WITH (NOLOCK) / (NOLOCK) table hint in T-SQL (Severity: warning)
- BP003: Missing schema qualification on table references (Severity: hint)
- BP004: TOP N without ORDER BY clause in T-SQL (Severity: warning)
- BP005: ISNULL(a, b) instead of ANSI COALESCE(a, b) (Severity: hint)
- BP006: 2-argument CONVERT(type, val) instead of ANSI CAST(val AS type) (Severity: hint)

All rules mask comments and string literals to prevent false positives.
"""
from __future__ import annotations

import re
from typing import Any


def _mask_sql_strings_and_comments(sql: str) -> str:
    """
    Replaces comments (-- ..., /* ... */) and string literals ('...') with spaces,
    preserving exact line breaks, lengths, and character positions for accurate line/col mapping.
    """
    if not sql:
        return ""

    chars = list(sql)
    n = len(chars)
    i = 0

    while i < n:
        # 1. Line comment: --
        if i + 1 < n and chars[i] == "-" and chars[i + 1] == "-":
            chars[i] = " "
            chars[i + 1] = " "
            i += 2
            while i < n and chars[i] != "\n":
                chars[i] = " "
                i += 1
            continue

        # 2. Block comment: /* ... */
        if i + 1 < n and chars[i] == "/" and chars[i + 1] == "*":
            chars[i] = " "
            chars[i + 1] = " "
            i += 2
            while i < n:
                if i + 1 < n and chars[i] == "*" and chars[i + 1] == "/":
                    chars[i] = " "
                    chars[i + 1] = " "
                    i += 2
                    break
                if chars[i] != "\n":
                    chars[i] = " "
                i += 1
            continue

        # 3. String literal: '...' (with '' escape)
        if chars[i] == "'":
            chars[i] = " "
            i += 1
            while i < n:
                if chars[i] == "'":
                    if i + 1 < n and chars[i + 1] == "'":
                        chars[i] = " "
                        chars[i + 1] = " "
                        i += 2
                        continue
                    chars[i] = " "
                    i += 1
                    break
                if chars[i] != "\n":
                    chars[i] = " "
                i += 1
            continue

        i += 1

    return "".join(chars)


def _offset_to_line_col(sql: str, offset: int) -> tuple[int, int]:
    """Calculate 1-based (line, column) from 0-based offset."""
    target = max(0, min(offset, len(sql)))
    line = 1
    col = 1
    for i in range(target):
        ch = sql[i]
        if ch == "\n":
            line += 1
            col = 1
        elif ch != "\r":
            col += 1
    return line, col


def _extract_parenthesized_args(text: str, open_paren_idx: int) -> list[str] | None:
    """
    Extracts top-level comma-separated arguments inside matching parentheses starting at open_paren_idx.
    Returns list of argument strings, or None if parentheses do not match.
    """
    if open_paren_idx >= len(text) or text[open_paren_idx] != "(":
        return None

    depth = 0
    start = open_paren_idx + 1
    args: list[str] = []
    curr_arg_start = start
    i = open_paren_idx

    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                args.append(text[curr_arg_start:i].strip())
                return args
        elif ch == "," and depth == 1:
            args.append(text[curr_arg_start:i].strip())
            curr_arg_start = i + 1
        i += 1

    return None


def check_best_practice_rules(sql: str, dialect: str = "sqlserver") -> list[dict[str, Any]]:
    """
    Runs best-practice analysis on the given SQL statement and returns normalized diagnostics.
    """
    if not sql or not sql.strip():
        return []

    d_lower = (dialect or "sqlserver").strip().lower()
    is_tsql = d_lower in ("sqlserver", "tsql", "mssql")

    masked = _mask_sql_strings_and_comments(sql)
    diagnostics: list[dict[str, Any]] = []

    # -------------------------------------------------------------
    # BP001: SELECT * without explicit column list
    # -------------------------------------------------------------
    # Match SELECT ... * but ignore COUNT(*), COUNT_BIG(*), or EXISTS (SELECT * ...)
    select_star_regex = re.compile(r"\bSELECT\s+(?:DISTINCT\s+)?(\*)", re.IGNORECASE)
    for m in select_star_regex.finditer(masked):
        star_offset = m.start(1)
        # Check context before SELECT: is it EXISTS\s*\(\s*SELECT ... ?
        prefix = masked[:m.start()].rstrip()
        if re.search(r"\bEXISTS\s*\(\s*$", prefix, re.IGNORECASE):
            continue

        line, col = _offset_to_line_col(sql, star_offset)
        diagnostics.append({
            "code": "BP001",
            "severity": "warning",
            "message": "Tránh sử dụng 'SELECT *'. Hãy chỉ định rõ ràng danh sách các cột cần truy vấn để tối ưu hiệu năng và băng thông.",
            "line": line,
            "column": col,
            "end_column": col + 1,
            "token": "*",
            "source": "best-practice",
        })

    # -------------------------------------------------------------
    # BP002: WITH (NOLOCK) / (NOLOCK) table hint in T-SQL
    # -------------------------------------------------------------
    if is_tsql:
        nolock_regex = re.compile(
            r"(?:\bWITH\s*\(\s*(?:NOLOCK|READUNCOMMITTED)\s*\)|\(\s*(?:NOLOCK|READUNCOMMITTED)\s*\))",
            re.IGNORECASE,
        )
        for m in nolock_regex.finditer(masked):
            matched_str = m.group(0)
            line, col = _offset_to_line_col(sql, m.start())
            diagnostics.append({
                "code": "BP002",
                "severity": "warning",
                "message": "Cân nhắc tránh sử dụng gợi ý bảng '(NOLOCK)' do nguy cơ đọc dữ liệu dirty/không nhất quán (dirty reads).",
                "line": line,
                "column": col,
                "end_column": col + len(matched_str),
                "token": matched_str,
                "source": "best-practice",
                "fix_data": {
                    "action": "remove",
                    "start_offset": m.start(),
                    "end_offset": m.end(),
                },
            })

    # -------------------------------------------------------------
    # BP003: Missing schema qualification on table references
    # -------------------------------------------------------------
    # Detects: FROM table_name or JOIN table_name where table_name has no dot "."
    # Excludes: #temp, ##temp, @table_var, subqueries (SELECT ...), CTE references, system keywords
    cte_names: set[str] = set()
    with_cte_match = re.search(r"\bWITH\s+([A-Za-z0-9_]+)\s+AS\s*\(", masked, re.IGNORECASE)
    if with_cte_match:
        # Collect all CTEs defined in WITH clause
        cte_defs = re.finditer(r"\b([A-Za-z0-9_]+)\s+AS\s*\(", masked, re.IGNORECASE)
        for c in cte_defs:
            cte_names.add(c.group(1).lower())

    # Find table references after FROM or JOIN
    from_join_regex = re.compile(
        r"\b(?:FROM|JOIN)\s+([A-Za-z0-9_#@\[\]\"]+(?:\.[A-Za-z0-9_#@\[\]\"]+)*)",
        re.IGNORECASE,
    )
    for m in from_join_regex.finditer(masked):
        full_tbl = m.group(1).strip()
        tbl_offset = m.start(1)

        # Ignore subquery start, table vars, temp tables, CTEs, or already qualified tables (has dot)
        if (
            full_tbl.startswith("(")
            or full_tbl.startswith("@")
            or full_tbl.startswith("#")
            or "." in full_tbl
        ):
            continue

        clean_name = full_tbl.strip("[]\"`").lower()
        # Reserved words / pseudo tables / known CTEs
        if clean_name in cte_names or clean_name in (
            "inserted", "deleted", "dual", "select", "where", "group", "having", "order"
        ):
            continue

        suggested_schema = "dbo" if is_tsql else "public"
        line, col = _offset_to_line_col(sql, tbl_offset)
        diagnostics.append({
            "code": "BP003",
            "severity": "hint",
            "message": f"Nên chỉ định rõ schema (ví dụ: '{suggested_schema}.{full_tbl}') để tránh chi phí phân giải và đảm bảo tính tường minh.",
            "line": line,
            "column": col,
            "end_column": col + len(full_tbl),
            "token": full_tbl,
            "source": "best-practice",
        })

    # -------------------------------------------------------------
    # BP004: TOP N without ORDER BY in T-SQL
    # -------------------------------------------------------------
    if is_tsql:
        top_regex = re.compile(
            r"\bTOP\s+(?:\(\s*\d+\s*\)|\d+)(?:\s+PERCENT)?(?:\s+WITH\s+TIES)?",
            re.IGNORECASE,
        )
        # Check statement batches split by ; or GO or UNION
        for m in top_regex.finditer(masked):
            top_offset = m.start()
            # Look ahead from TOP match until next statement terminator or end of string
            rest_of_query = masked[m.end():]
            stmt_end = re.search(r";|\bGO\b|\bUNION\b", rest_of_query, re.IGNORECASE)
            stmt_fragment = rest_of_query[:stmt_end.start()] if stmt_end else rest_of_query

            # Check if ORDER BY is present in the statement fragment
            if not re.search(r"\bORDER\s+BY\b", stmt_fragment, re.IGNORECASE):
                line, col = _offset_to_line_col(sql, top_offset)
                matched_token = m.group(0)
                diagnostics.append({
                    "code": "BP004",
                    "severity": "warning",
                    "message": "Sử dụng 'TOP' mà không có mệnh đề 'ORDER BY' sẽ trả về kết quả không có thứ tự xác định (non-deterministic).",
                    "line": line,
                    "column": col,
                    "end_column": col + len(matched_token),
                    "token": matched_token,
                    "source": "best-practice",
                })

    # -------------------------------------------------------------
    # BP005: ISNULL(a, b) instead of ANSI COALESCE(a, b) in T-SQL
    # -------------------------------------------------------------
    if is_tsql:
        isnull_regex = re.compile(r"\bISNULL\s*\(", re.IGNORECASE)
        for m in isnull_regex.finditer(masked):
            paren_idx = m.end() - 1
            args = _extract_parenthesized_args(masked, paren_idx)
            if args is not None and len(args) == 2:
                # Valid ISNULL(arg1, arg2)
                line, col = _offset_to_line_col(sql, m.start())
                diagnostics.append({
                    "code": "BP005",
                    "severity": "hint",
                    "message": "Hàm 'ISNULL(expr, val)' mang tính chất độc quyền T-SQL. Cân nhắc dùng hàm chuẩn ANSI 'COALESCE(expr, val)' để tăng tính di động.",
                    "line": line,
                    "column": col,
                    "end_column": col + 6,  # len("ISNULL")
                    "token": "ISNULL",
                    "source": "best-practice",
                    "fix_data": {
                        "action": "replace_token",
                        "start_offset": m.start(),
                        "end_offset": m.start() + 6,
                        "replacement": "COALESCE",
                    },
                })

    # -------------------------------------------------------------
    # BP006: 2-argument CONVERT(type, val) instead of ANSI CAST(val AS type)
    # -------------------------------------------------------------
    if is_tsql:
        convert_regex = re.compile(r"\bCONVERT\s*\(", re.IGNORECASE)
        for m in convert_regex.finditer(masked):
            paren_idx = m.end() - 1
            args = _extract_parenthesized_args(masked, paren_idx)
            if args is not None and len(args) == 2:
                # 2-arg CONVERT(type, val)
                line, col = _offset_to_line_col(sql, m.start())
                diagnostics.append({
                    "code": "BP006",
                    "severity": "hint",
                    "message": "Hàm 'CONVERT(type, val)' với 2 đối số có thể thay thế bằng hàm chuẩn ANSI 'CAST(val AS type)'.",
                    "line": line,
                    "column": col,
                    "end_column": col + 7,  # len("CONVERT")
                    "token": "CONVERT",
                    "source": "best-practice",
                    "fix_data": {
                        "action": "convert_to_cast",
                        "target_type": args[0],
                        "target_val": args[1],
                    },
                })

    return diagnostics
