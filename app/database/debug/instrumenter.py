"""PostgreSQL Debug Extension Instrumentation Engine

Handles detection and runtime transformation of IDE debug extensions
such as bs.trace, bs.print, bs.assert, bs.watch.
Reference: .SKILL/custom_function_debug.md
"""

import json
import re
from typing import Any, Dict, List, Optional, Tuple


def offset_to_line_col(text: str, offset: int) -> Tuple[int, int]:
    """Calculate 1-indexed line and column for a character offset."""
    line = 1
    col = 1
    end = min(offset, len(text))
    for i in range(end):
        ch = text[i]
        if ch == "\n":
            line += 1
            col = 1
        elif ch != "\r":
            col += 1
    return line, col


def detect_debug_extensions(sql: str, start_order: int = 1, line_offset: int = 0) -> List[Dict[str, Any]]:
    """Detect all bs.* calls in the SQL text.

    Skips comments (-- and /* */) and string literals ('...').
    Inspects inside PL/pgSQL dollar-quoted blocks ($$...$$).
    """
    if not sql:
        return []

    matches = []
    length = len(sql)
    i = 0
    trace_counter = max(0, start_order - 1)

    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        # 1. Single-line comment: -- ...
        if ch == "-" and next_ch == "-":
            i += 2
            while i < length and sql[i] != "\n":
                i += 1
            continue

        # 2. Multi-line comment: /* ... */
        if ch == "/" and next_ch == "*":
            i += 2
            while i < length - 1 and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i += 2
            continue

        # 3. String literal: '...'
        if ch == "'":
            # Check if this single quote is the start of a routine body (e.g. AS '... or DO '...)
            prev_k = i - 1
            while prev_k >= 0 and sql[prev_k].isspace():
                prev_k -= 1
            word_end = prev_k + 1
            while prev_k >= 0 and re.match(r"[a-zA-Z0-9_]", sql[prev_k]):
                prev_k -= 1
            word = sql[prev_k + 1:word_end].upper() if prev_k >= -1 else ""

            if word in ("AS", "DO"):
                # Routine body string! Inspect inside it rather than skipping.
                i += 1
                continue

            i += 1
            while i < length:
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            continue

        # 4. Check for pattern: bs.<command>(
        if (ch == "b" or ch == "B") and (next_ch == "s" or next_ch == "S"):
            prev_ch = sql[i - 1] if i > 0 else " "
            if not re.match(r"[a-zA-Z0-9_]", prev_ch):
                k = i + 2
                while k < length and sql[k].isspace():
                    k += 1
                if k < length and sql[k] == ".":
                    k += 1
                    while k < length and sql[k].isspace():
                        k += 1
                    cmd_start = k
                    while k < length and re.match(r"[a-zA-Z0-9_]", sql[k]):
                        k += 1
                    cmd = sql[cmd_start:k].lower()

                    if cmd:
                        while k < length and sql[k].isspace():
                            k += 1
                        if k < length and sql[k] == "(":
                            open_paren_idx = k
                            depth = 1
                            k += 1
                            in_str = False
                            in_comment = False

                            while k < length and depth > 0:
                                c = sql[k]
                                n = sql[k + 1] if k + 1 < length else ""

                                if not in_str and not in_comment:
                                    if c == "-" and n == "-":
                                        in_comment = "line"
                                        k += 2
                                        continue
                                    elif c == "/" and n == "*":
                                        in_comment = "block"
                                        k += 2
                                        continue
                                    elif c == "'":
                                        in_str = True
                                        k += 1
                                        continue
                                    elif c == "(":
                                        depth += 1
                                    elif c == ")":
                                        depth -= 1
                                        if depth == 0:
                                            break
                                elif in_comment == "line":
                                    if c == "\n":
                                        in_comment = False
                                elif in_comment == "block":
                                    if c == "*" and n == "/":
                                        in_comment = False
                                        k += 2
                                        continue
                                elif in_str:
                                    if c == "'":
                                        if n == "'":
                                            k += 2
                                            continue
                                        else:
                                            in_str = False
                                k += 1

                            close_paren_idx = k
                            raw_text = sql[i : close_paren_idx + 1]
                            inner_content = sql[open_paren_idx + 1 : close_paren_idx].strip()

                            trace_counter += 1
                            start_line, start_col = offset_to_line_col(sql, i)
                            end_line, end_col = offset_to_line_col(sql, close_paren_idx + 1)
                            if line_offset > 0:
                                start_line += line_offset
                                end_line += line_offset

                            matches.append({
                                "name": f"bs.{cmd}",
                                "namespace": "bs",
                                "command": cmd,
                                "sourceTraceId": f"trace_{trace_counter}",
                                "sourceOrder": trace_counter,
                                "startOffset": i,
                                "endOffset": close_paren_idx + 1,
                                "startLine": start_line,
                                "startCol": start_col,
                                "endLine": end_line,
                                "endCol": end_col,
                                "rawText": raw_text,
                                "innerContent": inner_content,
                            })

                            i = close_paren_idx + 1
                            continue

        i += 1

    return matches


def comment_out_debug_extensions(sql: str, matches: Optional[List[Dict[str, Any]]] = None) -> Tuple[str, int]:
    """Comment out all bs.* calls in the SQL text line-by-line using '-- '."""
    if not sql:
        return sql, 0
    items = matches if matches is not None else detect_debug_extensions(sql)
    if not items:
        return sql, 0

    sorted_items = sorted(items, key=lambda x: x["startOffset"], reverse=True)
    res = sql

    for item in sorted_items:
        original_block = res[item["startOffset"] : item["endOffset"]]
        lines = original_block.split("\n")
        commented_lines = []
        for line in lines:
            trimmed = line.lstrip()
            if trimmed.startswith("--"):
                commented_lines.append(line)
            else:
                indent = line[: len(line) - len(trimmed)]
                commented_lines.append(f"{indent}-- {trimmed}")
        commented_block = "\n".join(commented_lines)
        res = res[: item["startOffset"]] + commented_block + res[item["endOffset"] :]

    return res, len(items)


QUEUE_TABLE_NAME = "_ide_debug_trace_queue"


def get_setup_debug_sql() -> str:
    """SQL to create or reset the session-local trace queue."""
    return f"""
    CREATE TEMP TABLE IF NOT EXISTS {QUEUE_TABLE_NAME} (
        seq_id BIGSERIAL PRIMARY KEY,
        trace_id TEXT,
        payload_json JSONB,
        logged_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
    TRUNCATE {QUEUE_TABLE_NAME};
    """


def get_collect_debug_sql() -> str:
    """SQL to retrieve and clear all telemetry events in runtime order."""
    return f"""
    SELECT trace_id, payload_json, logged_at
    FROM {QUEUE_TABLE_NAME}
    ORDER BY seq_id;
    TRUNCATE {QUEUE_TABLE_NAME};
    """


def transform_pg_temp_tables(sql: str) -> str:
    """Transform SQL Server style #temp_table syntax to PostgreSQL temp tables.

    Transforms:
    - #name -> bs_temp_name
    - CREATE TABLE #name -> CREATE TEMP TABLE bs_temp_name
    - SELECT ... INTO #name -> SELECT ... INTO TEMP bs_temp_name
    - Preserves string literals ('...'), escape strings (E'...'), Dollar-quoted blocks ($$...$$),
      quoted identifiers ("..."), comments (-- and /* */), and PostgreSQL operators (#>, #>>, #-, ##).
    """
    if not sql or "#" not in sql:
        return sql

    length = len(sql)
    i = 0
    result = []

    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        # 1. Single-line comment: -- ...
        if ch == "-" and next_ch == "-":
            start = i
            i += 2
            while i < length and sql[i] != "\n":
                i += 1
            result.append(sql[start:i])
            continue

        # 2. Multi-line comment: /* ... */
        if ch == "/" and next_ch == "*":
            start = i
            i += 2
            while i < length - 1 and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i = min(i + 2, length)
            result.append(sql[start:i])
            continue

        # 3. Quoted identifier: "..."
        if ch == '"':
            start = i
            i += 1
            while i < length:
                if sql[i] == '"':
                    if i + 1 < length and sql[i + 1] == '"':
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            result.append(sql[start:i])
            continue

        # 4. Dollar-quoted string literal: $$...$$ or $tag$...$tag$
        if ch == "$":
            m_dollar = re.match(r"^\$([a-zA-Z0-9_]*)\$", sql[i:])
            if m_dollar:
                tag = m_dollar.group(0)
                tag_len = len(tag)
                closing_idx = sql.find(tag, i + tag_len)
                if closing_idx != -1:
                    end_idx = closing_idx + tag_len
                    result.append(sql[i:end_idx])
                    i = end_idx
                    continue

        # 5. Escape string literal: E'...' or e'...'
        prev_ch = sql[i - 1] if i > 0 else " "
        if (ch == "E" or ch == "e") and next_ch == "'" and not re.match(r"[a-zA-Z0-9_]", prev_ch):
            start = i
            i += 2
            while i < length:
                if sql[i] == "\\":
                    i += 2
                elif sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            result.append(sql[start:i])
            continue

        # 6. Standard string literal: '...'
        if ch == "'":
            start = i
            i += 1
            while i < length:
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                    else:
                        i += 1
                        break
                else:
                    i += 1
            result.append(sql[start:i])
            continue

        # 7. PostgreSQL operators starting with #: #>, #>>, #-, ##
        if ch == "#" and next_ch in (">", "-", "#"):
            result.append(ch)
            i += 1
            continue

        # 8. Check for #identifier (SQL Server style temp table)
        # Must be preceded by boundary (start of string or non-word character)
        if ch == "#" and re.match(r"[a-zA-Z_]", next_ch) and not re.match(r"[a-zA-Z0-9_\$]", prev_ch):
            k = i + 1
            while k < length and re.match(r"[a-zA-Z0-9_]", sql[k]):
                k += 1
            ident_name = sql[i + 1 : k]

            preceding_str = "".join(result)
            m_create = re.search(r"\bCREATE\s+TABLE\s*$", preceding_str, re.IGNORECASE)
            m_insert_into = re.search(r"\bINSERT\s+INTO\s*$", preceding_str, re.IGNORECASE)
            m_into = re.search(r"\bINTO\s*$", preceding_str, re.IGNORECASE)

            if m_create:
                cut_idx = len(preceding_str) - len(m_create.group(0))
                result = [preceding_str[:cut_idx] + "CREATE TEMP TABLE "]
                result.append(f"bs_temp_{ident_name}")
            elif m_insert_into:
                result.append(f"bs_temp_{ident_name}")
            elif m_into:
                cut_idx = len(preceding_str) - len(m_into.group(0))
                result = [preceding_str[:cut_idx] + "INTO TEMP "]
                result.append(f"bs_temp_{ident_name}")
            else:
                result.append(f"bs_temp_{ident_name}")

            i = k
            continue

        result.append(ch)
        i += 1

    return "".join(result)


def strip_debug_injections_from_function(func_def: str) -> str:
    """Strips injected _ide_debug_trace_queue statements from a function definition."""
    if not func_def:
        return func_def
    cleaned = re.sub(
        r"^\s*INSERT\s+INTO\s+_ide_debug_trace_queue\b.*?;?\s*$",
        "",
        func_def,
        flags=re.MULTILINE | re.IGNORECASE,
    )
    return cleaned


def instrument_sql_for_debug(
    sql: str,
    traces: Optional[List[Dict[str, Any]]] = None,
    start_order: int = 1,
    line_offset: int = 0,
) -> Tuple[str, List[Dict[str, Any]]]:
    """Transforms SQL in memory to replace bs.trace calls with queue inserts.

    Does not modify original editor source!
    """
    sql = transform_pg_temp_tables(sql)
    server_items = detect_debug_extensions(sql, start_order=start_order, line_offset=line_offset)
    items = server_items if server_items else (traces or [])
    if not items:
        return sql, []

    sorted_items = sorted(items, key=lambda x: x["startOffset"], reverse=True)
    instrumented = sql

    for item in sorted_items:
        cmd = item.get("command", "trace")
        trace_id = item.get("sourceTraceId", "trace_1")
        inner = item.get("innerContent", "").strip()

        # Clean trailing semicolons from expression
        clean_inner = re.sub(r";+\s*$", "", inner).strip()

        if cmd == "trace":
            # Check if inner query is a SELECT / WITH query or a scalar expression
            upper_inner = clean_inner.upper()
            if upper_inner.startswith("SELECT") or upper_inner.startswith("WITH") or upper_inner.startswith("TABLE"):
                query_part = f"({clean_inner})"
            else:
                query_part = f"(SELECT {clean_inner} AS value)"

            replacement = (
                f"INSERT INTO {QUEUE_TABLE_NAME} (trace_id, payload_json) "
                f"SELECT '{trace_id}', COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) "
                f"FROM {query_part} t"
            )
        elif cmd == "print":
            replacement = (
                f"INSERT INTO {QUEUE_TABLE_NAME} (trace_id, payload_json) "
                f"VALUES ('{trace_id}', jsonb_build_array(jsonb_build_object('value', ({clean_inner}))))"
            )
        else:
            # Default fallback for other extensions
            replacement = (
                f"INSERT INTO {QUEUE_TABLE_NAME} (trace_id, payload_json) "
                f"VALUES ('{trace_id}', jsonb_build_array(jsonb_build_object('raw', '{clean_inner}')))"
            )

        # Consume any trailing semicolon(s) immediately following the closing paren
        remainder = instrumented[item["endOffset"] :]
        m_semi = re.match(r"^([ \t]*;+)", remainder)
        if m_semi:
            replace_end = item["endOffset"] + len(m_semi.group(0))
        else:
            replace_end = item["endOffset"]

        # Ensure replacement statement is terminated with exactly one semicolon
        clean_replacement = replacement.rstrip(" \t\r\n;") + ";"

        instrumented = (
            instrumented[: item["startOffset"]]
            + clean_replacement
            + instrumented[replace_end :]
        )

    return instrumented, items


def process_collected_telemetry(
    raw_rows: List[Any], trace_defs: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Process raw rows from _ide_debug_trace_queue into formatted trace events."""
    defs_map = {t.get("sourceTraceId"): t for t in trace_defs}
    events = []
    iteration_counters: Dict[str, int] = {}
    runtime_order = 0

    for row in raw_rows:
        runtime_order += 1
        trace_id = str(row[0]) if len(row) > 0 else f"trace_{runtime_order}"
        payload_raw = row[1] if len(row) > 1 else []
        logged_at = str(row[2]) if len(row) > 2 else ""

        # Parse JSON if string
        if isinstance(payload_raw, str):
            try:
                payload = json.loads(payload_raw)
            except Exception:
                try:
                    import ast
                    payload = ast.literal_eval(payload_raw)
                except Exception:
                    payload = []
        elif isinstance(payload_raw, list):
            payload = payload_raw
        elif isinstance(payload_raw, dict):
            payload = [payload_raw]
        else:
            payload = []

        # Determine iteration
        iteration = iteration_counters.get(trace_id, 0) + 1
        iteration_counters[trace_id] = iteration

        source_def = defs_map.get(trace_id, {})

        # Extract column names and rows from payload objects
        columns = []
        rows = []
        if payload and isinstance(payload, list) and len(payload) > 0:
            first_elem = payload[0]
            if isinstance(first_elem, dict):
                columns = list(first_elem.keys())
                for item in payload:
                    if isinstance(item, dict):
                        rows.append([item.get(c) for c in columns])
                    else:
                        rows.append([item])
            else:
                columns = ["value"]
                rows = [[item] for item in payload]

        events.append({
            "trace_id": trace_id,
            "runtime_order": runtime_order,
            "iteration": iteration,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "logged_at": logged_at,
            "source_location": {
                "startLine": source_def.get("startLine", 1),
                "startCol": source_def.get("startCol", 1),
                "endLine": source_def.get("endLine", 1),
                "endCol": source_def.get("endCol", 1),
                "rawText": source_def.get("rawText", ""),
                "innerContent": source_def.get("innerContent", ""),
            },
        })

    return events


def is_return_statement(stmt_text: str) -> bool:
    """Check if statement is a RETURN statement (e.g. RETURN;, return, RETURN 123;)."""
    if not stmt_text:
        return False
    clean = re.sub(r"--[^\n]*", "", stmt_text)
    clean = re.sub(r"/\*.*?\*/", "", clean, flags=re.DOTALL).strip()
    return bool(re.match(r"^RETURN\b", clean, re.IGNORECASE))


def split_postgres_statements(sql: str) -> List[Dict[str, Any]]:
    """Split a PostgreSQL script into top-level statements.

    Respects:
    - Single-line comments: -- ...
    - Multi-line nested comments: /* ... */
    - Single-quoted strings: '...' (with '' escapes)
    - Dollar-quoted strings: $tag$...$tag$ or $$...$$ (routine bodies, DO blocks)
    - Double-quoted identifiers: "..."
    - Top-level semicolons ';'
    - Standalone RETURN statements on a line (with or without semicolon)
    """
    if not sql or not sql.strip():
        return []

    statements = []
    length = len(sql)
    i = 0
    stmt_start = 0
    stmt_start_line = 1
    current_line = 1

    in_single_quote = False
    in_double_quote = False
    in_line_comment = False
    block_comment_depth = 0
    dollar_tag = None

    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        if ch == "\n":
            current_line += 1

        # 1. Inside single-line comment
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue

        # 2. Inside multi-line comment (can be nested in PostgreSQL)
        if block_comment_depth > 0:
            if ch == "/" and next_ch == "*":
                block_comment_depth += 1
                i += 2
                continue
            elif ch == "*" and next_ch == "/":
                block_comment_depth -= 1
                i += 2
                continue
            i += 1
            continue

        # 3. Inside single quote string
        if in_single_quote:
            if ch == "'":
                if next_ch == "'":
                    i += 2  # escaped ''
                    continue
                in_single_quote = False
            i += 1
            continue

        # 4. Inside double quote identifier
        if in_double_quote:
            if ch == '"':
                if next_ch == '"':
                    i += 2  # escaped ""
                    continue
                in_double_quote = False
            i += 1
            continue

        # 5. Inside dollar quotes ($tag$...$tag$)
        if dollar_tag is not None:
            if sql.startswith(dollar_tag, i):
                i += len(dollar_tag)
                dollar_tag = None
                continue
            i += 1
            continue

        # --- Outside any quotes or comments ---

        # Check for line comment start
        if ch == "-" and next_ch == "-":
            in_line_comment = True
            i += 2
            continue

        # Check for block comment start
        if ch == "/" and next_ch == "*":
            block_comment_depth = 1
            i += 2
            continue

        # Check for single quote start
        if ch == "'":
            in_single_quote = True
            i += 1
            continue

        # Check for double quote start
        if ch == '"':
            in_double_quote = True
            i += 1
            continue

        # Check for dollar quote start: $[a-zA-Z0-9_]*\$
        if ch == "$":
            m_tag = re.match(r"^\$([a-zA-Z0-9_]*)\$", sql[i:])
            if m_tag:
                dollar_tag = m_tag.group(0)
                i += len(dollar_tag)
                continue

        # Check for top-level semicolon
        if ch == ";":
            stmt_text = sql[stmt_start : i + 1]
            trimmed = stmt_text.strip()
            if trimmed:
                statements.append({
                    "text": stmt_text,
                    "start_offset": stmt_start,
                    "end_offset": i + 1,
                    "start_line": stmt_start_line,
                    "end_line": current_line,
                })
            stmt_start = i + 1
            stmt_start_line = current_line
            i += 1
            continue

        # Check for standalone RETURN line if not followed by semicolon
        # e.g. "RETURN\n" on its own line
        if (ch == "r" or ch == "R") and (i == 0 or sql[i - 1] in "\r\n\t ;"):
            m_ret = re.match(r"^RETURN\b(?:\s+[^\r\n;]+)?", sql[i:], re.IGNORECASE)
            if m_ret:
                prefix_before = sql[stmt_start:i].strip()
                clean_prefix = re.sub(r"--[^\n]*", "", prefix_before)
                clean_prefix = re.sub(r"/\*.*?\*/", "", clean_prefix, flags=re.DOTALL).strip()
                if not clean_prefix:
                    ret_end = i + len(m_ret.group(0))
                    rest = sql[ret_end:].lstrip(" \t")
                    if not rest or rest.startswith(("\r", "\n")):
                        stmt_text = sql[stmt_start:ret_end]
                        trimmed = stmt_text.strip()
                        if trimmed:
                            statements.append({
                                "text": stmt_text,
                                "start_offset": stmt_start,
                                "end_offset": ret_end,
                                "start_line": stmt_start_line,
                                "end_line": current_line,
                            })
                        stmt_start = ret_end
                        stmt_start_line = current_line
                        i = ret_end
                        continue

        i += 1

    # End of SQL text: check if trailing statement exists
    if stmt_start < length:
        stmt_text = sql[stmt_start:]
        trimmed = stmt_text.strip()
        if trimmed:
            statements.append({
                "text": stmt_text,
                "start_offset": stmt_start,
                "end_offset": length,
                "start_line": stmt_start_line,
                "end_line": current_line,
            })

    return statements
