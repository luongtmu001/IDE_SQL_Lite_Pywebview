# -*- coding: utf-8 -*-
"""
Diagnostics Mapper for SQL Syntax Check.
Standardizes error output, line/column coordinates, token boundaries,
and deduplicates diagnostics before returning to Monaco Editor.
"""
from __future__ import annotations

import re
from typing import Any


def clean_diagnostic_message(raw_msg: str) -> str:
    """Clean driver headers, line noise, and ODBC prefixes from diagnostic messages."""
    if not raw_msg:
        return "Syntax error"
    msg = str(raw_msg).strip()
    # Remove ODBC & driver headers
    msg = re.sub(r"\[Microsoft\]\[[^\]]+\](?:\[[^\]]+\])?", "", msg)
    msg = re.sub(r"psycopg2\.errors\.\w+:\s*", "", msg)
    msg = re.sub(r"\(\d+\)\s*\([^\)]+\)", "", msg)
    msg = re.sub(r"\(\d+\)", "", msg)
    msg = re.sub(
        r"Msg\s+\d+,\s*Level\s+\d+,\s*State\s+\d+,\s*(?:Procedure\s+[^\s,]+,\s*)?Line\s+\d+\s*",
        "",
        msg,
        flags=re.IGNORECASE,
    )
    msg = re.sub(r"Line\s+\d+:\s*", "", msg, flags=re.IGNORECASE)
    msg = re.sub(r";\s*$", "", msg)
    msg = re.sub(r"^[:;\s]+", "", msg)
    clean = msg.strip()
    return clean if clean else str(raw_msg).strip()


def normalize_diagnostic(
    raw: dict[str, Any],
    default_source: str = "sql",
    sql: str | None = None,
) -> dict[str, Any]:
    """
    Ensure every diagnostic dictionary strictly conforms to the Monaco marker contract.
    Guarantees valid 1-based line/col numbers and non-zero token length.
    """
    line = max(1, int(raw.get("line") or 1))
    col = max(1, int(raw.get("column") or raw.get("col") or 1))
    token = str(raw.get("token") or "").strip()

    # Calculate end_column
    if "end_column" in raw and raw["end_column"] is not None:
        end_col = max(col + 1, int(raw["end_column"]))
    elif token:
        end_col = col + max(1, len(token))
    else:
        end_col = col + 1

    # If full SQL text is available, verify token boundaries on line
    if sql and 0 < line:
        lines = sql.splitlines()
        if line <= len(lines):
            line_str = lines[line - 1]
            if token and token in line_str:
                # Align column if token appears at a slightly different index
                if col <= len(line_str) and not line_str[col - 1 : col - 1 + len(token)] == token:
                    idx = line_str.find(token)
                    if idx != -1:
                        col = idx + 1
                        end_col = col + len(token)

    raw_src = str(raw.get("source") or default_source).lower()
    if "postgres" in raw_src or "pgsql" in raw_src:
        canonical_src = "postgresql"
    elif "sqlserver" in raw_src or "tsql" in raw_src or "mssql" in raw_src:
        canonical_src = "sqlserver"
    else:
        canonical_src = raw_src

    return {
        "severity": str(raw.get("severity") or "error").lower(),
        "message": clean_diagnostic_message(str(raw.get("message") or "Syntax error")),
        "code": str(raw.get("code") or "SQL_SYNTAX_ERROR"),
        "line": line,
        "column": col,
        "end_column": end_col,
        "token": token,
        "offset": raw.get("offset"),
        "source": canonical_src,
    }


def deduplicate_diagnostics(diagnostics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Deduplicate diagnostics based on (line, column, token_lower).
    Preserves original insertion order.
    """
    if not diagnostics:
        return []

    seen: set[tuple[int, int, str]] = set()
    result: list[dict[str, Any]] = []

    for d in diagnostics:
        line = int(d.get("line") or 1)
        col = int(d.get("column") or 1)
        token = str(d.get("token") or "").lower().strip()
        key = (line, col, token)

        if key not in seen:
            seen.add(key)
            result.append(d)

    return result
