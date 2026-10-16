"""
SQL Statement Splitter (Mục 5.2) - Dialect-aware SQL statement and batch splitter.
Handles:
- Single quotes ('...') and Unicode string literals (N'...') with '' escaping
- PostgreSQL dollar-quoted blocks ($$...$$ and $tag$...$tag$)
- Double-quoted identifiers ("...")
- SQL Server square bracket identifiers ([...]])
- Single-line comments (-- ...) and multi-line comments (/* ... */)
- Semicolons (;) as statement delimiters
- SSMS batch separator (GO) on its own line
"""

import re
from typing import List, Dict, Any


def split_statements(sql: str, dialect: str = "sqlserver") -> List[Dict[str, Any]]:
    """
    Split SQL script into individual executable statements.
    
    Args:
        sql: The raw SQL script string.
        dialect: 'sqlserver', 'postgresql', 'tsql', 'postgres', etc.
        
    Returns:
        List of dicts:
        [
            {
                "index": 1,
                "sql": "SELECT 1",
                "start_line": 1,
                "end_line": 1,
                "delimiter": ";"
            },
            ...
        ]
    """
    if not sql or not sql.strip():
        return []

    is_pg = any(k in str(dialect).lower() for k in ("postgr", "pg"))
    length = len(sql)
    statements: List[Dict[str, Any]] = []

    stmt_start_idx = 0
    current_line = 1
    stmt_start_line = 1

    i = 0
    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        # Track line number
        if ch == "\n":
            current_line += 1
            i += 1
            continue

        # 1. Single-line comment: -- ... \n
        if ch == "-" and next_ch == "-":
            i += 2
            while i < length and sql[i] != "\n":
                i += 1
            continue

        # 2. Multi-line comment: /* ... */
        if ch == "/" and next_ch == "*":
            i += 2
            while i < length - 1 and not (sql[i] == "*" and sql[i + 1] == "/"):
                if sql[i] == "\n":
                    current_line += 1
                i += 1
            if i < length - 1:
                i += 2
            else:
                i = length
            continue

        # 3. Quoted string: '...' or N'...' with '' escaping
        if ch == "'" or ((ch in ("N", "n")) and next_ch == "'"):
            if ch in ("N", "n"):
                i += 1
            i += 1  # Skip opening quote
            while i < length:
                if sql[i] == "\n":
                    current_line += 1
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2  # Escaped ''
                        continue
                    else:
                        i += 1  # Closing quote
                        break
                i += 1
            continue

        # 4. PostgreSQL Dollar-quoted string literal: $$...$$ or $tag$...$tag$
        if is_pg and ch == "$":
            m_dollar = re.match(r"^\$([a-zA-Z0-9_]*)\$", sql[i:])
            if m_dollar:
                tag = m_dollar.group(0)
                tag_len = len(tag)
                closing_idx = sql.find(tag, i + tag_len)
                if closing_idx != -1:
                    inner = sql[i:closing_idx + tag_len]
                    current_line += inner.count("\n")
                    i = closing_idx + tag_len
                    continue

        # 5. PostgreSQL Escape string: E'...' or e'...'
        if is_pg and ch in ("E", "e") and next_ch == "'":
            i += 2
            while i < length:
                if sql[i] == "\n":
                    current_line += 1
                if sql[i] == "\\":
                    i += 2
                    continue
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                i += 1
            continue

        # 6. Double-quoted identifier: "..."
        if ch == '"':
            i += 1
            while i < length:
                if sql[i] == "\n":
                    current_line += 1
                if sql[i] == '"':
                    if i + 1 < length and sql[i + 1] == '"':
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                i += 1
            continue

        # 7. SQL Server square bracket identifier: [...] with ]] escaping
        if not is_pg and ch == "[":
            i += 1
            while i < length:
                if sql[i] == "\n":
                    current_line += 1
                if sql[i] == "]":
                    if i + 1 < length and sql[i + 1] == "]":
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                i += 1
            continue

        # 8. Check for SSMS batch separator GO on its own line (SQL Server only)
        if not is_pg and (ch in ("G", "g")) and (next_ch in ("O", "o")):
            # Must be preceded only by whitespace or start of line
            prev_nl = sql.rfind("\n", 0, i)
            line_prefix = sql[prev_nl + 1:i] if prev_nl != -1 else sql[0:i]
            if not line_prefix.strip():
                # Check what follows GO: optional semicolon, optional whitespace/comment, then newline or EOF
                rest = sql[i + 2:]
                m_go = re.match(r"^\s*;?\s*(?:--.*)?(?:\r?\n|$)", rest, flags=re.IGNORECASE)
                if m_go:
                    # Valid GO separator!
                    raw_chunk = sql[stmt_start_idx:i]
                    chunk = raw_chunk.strip()
                    if chunk:
                        leading_ws = raw_chunk[:len(raw_chunk) - len(raw_chunk.lstrip())]
                        actual_start_line = stmt_start_line + leading_ws.count("\n")
                        statements.append({
                            "index": len(statements) + 1,
                            "sql": chunk,
                            "start_line": actual_start_line,
                            "end_line": current_line,
                            "delimiter": "GO"
                        })
                    advance_len = 2 + len(m_go.group(0))
                    current_line += m_go.group(0).count("\n")
                    i += advance_len
                    stmt_start_idx = i
                    stmt_start_line = current_line
                    continue

        # 9. Statement delimiter: semicolon ;
        if ch == ";":
            current_so_far = sql[stmt_start_idx:i]
            # If inside a CREATE TRIGGER statement, don't split on internal semicolons before END
            if re.search(r"\bCREATE\s+(?:TEMP|TEMPORARY\s+)?TRIGGER\b", current_so_far, re.IGNORECASE):
                if not re.search(r"\bEND\s*$", current_so_far, re.IGNORECASE):
                    i += 1
                    continue

            raw_chunk = sql[stmt_start_idx:i]
            chunk = raw_chunk.strip()
            if chunk:
                leading_ws = raw_chunk[:len(raw_chunk) - len(raw_chunk.lstrip())]
                actual_start_line = stmt_start_line + leading_ws.count("\n")
                statements.append({
                    "index": len(statements) + 1,
                    "sql": chunk,
                    "start_line": actual_start_line,
                    "end_line": current_line,
                    "delimiter": ";"
                })
            i += 1
            stmt_start_idx = i
            stmt_start_line = current_line
            continue

        i += 1

    # Remaining chunk up to EOF
    raw_final = sql[stmt_start_idx:]
    final_chunk = raw_final.strip()
    if final_chunk:
        leading_ws = raw_final[:len(raw_final) - len(raw_final.lstrip())]
        actual_start_line = stmt_start_line + leading_ws.count("\n")
        statements.append({
            "index": len(statements) + 1,
            "sql": final_chunk,
            "start_line": actual_start_line,
            "end_line": current_line,
            "delimiter": ""
        })

    return statements
