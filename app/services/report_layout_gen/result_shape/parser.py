# -*- coding: utf-8 -*-
"""
Static SQL Parser: Extracts result set column definitions from SQL Server and PostgreSQL routine bodies
without executing the code.
"""
import re
from typing import Any, Dict, List, Optional, Tuple


def clean_identifier(name: str) -> str:
    """Strip brackets, quotes, and whitespace from a SQL column or table identifier."""
    if not name:
        return ""
    name = name.strip()
    # Strip [ ]
    if name.startswith("[") and name.endswith("]"):
        name = name[1:-1]
    # Strip " "
    elif name.startswith('"') and name.endswith('"'):
        name = name[1:-1]
    # Strip ` `
    elif name.startswith("`") and name.endswith("`"):
        name = name[1:-1]
    return name.strip()


def strip_sql_comments(sql: str) -> str:
    """Remove line comments (-- ...) and block comments (/* ... */) while preserving string literals."""
    if not sql:
        return ""
    result = []
    i = 0
    n = len(sql)
    in_single_quote = False
    while i < n:
        c = sql[i]
        if c == "'" and not in_single_quote:
            in_single_quote = True
            result.append(c)
            i += 1
        elif c == "'" and in_single_quote:
            if i + 1 < n and sql[i + 1] == "'":
                result.append("''")
                i += 2
            else:
                in_single_quote = False
                result.append(c)
                i += 1
        elif not in_single_quote and c == "-" and i + 1 < n and sql[i + 1] == "-":
            i += 2
            while i < n and sql[i] != "\n":
                i += 1
        elif not in_single_quote and c == "/" and i + 1 < n and sql[i + 1] == "*":
            i += 2
            while i < n and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i += 2
        else:
            result.append(c)
            i += 1
    return "".join(result)


def mask_sql_strings(sql: str) -> Tuple[str, List[str]]:
    """
    Replace all string literals '...' and N'...' with placeholders __SQL_STR_N__.
    Returns (masked_sql, list_of_raw_unquoted_strings).
    """
    literals: List[str] = []

    def repl(m: re.Match) -> str:
        idx = len(literals)
        raw_val = m.group(0)
        # Strip leading N if present, then strip surrounding single quotes
        if raw_val.startswith("N'") or raw_val.startswith("n'"):
            inner = raw_val[2:-1].replace("''", "'")
        elif raw_val.startswith("'") and raw_val.endswith("'"):
            inner = raw_val[1:-1].replace("''", "'")
        else:
            inner = raw_val
        literals.append(inner)
        return f"__SQL_STR_{idx}__"

    pattern = re.compile(r"(?:N)?'(?:''|[^'])*'", flags=re.IGNORECASE)
    masked = pattern.sub(repl, sql)
    return masked, literals


def split_sql_column_definitions(body: str) -> List[str]:
    """Split column definitions in CREATE TABLE body handling nested parentheses (e.g. decimal(18, 2))."""
    lines: List[str] = []
    current: List[str] = []
    depth = 0
    in_quote = False
    for char in body:
        if char == "'" and not in_quote:
            in_quote = True
        elif char == "'" and in_quote:
            in_quote = False

        if not in_quote:
            if char in ("(", "["):
                depth += 1
            elif char in (")", "]"):
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                item = "".join(current).strip()
                if item:
                    lines.append(item)
                current = []
                continue
        current.append(char)
    if current:
        item = "".join(current).strip()
        if item:
            lines.append(item)
    return lines


def extract_columns_from_select_clause(select_clause: str) -> List[Dict[str, Any]]:
    """
    Parse a comma-separated SELECT clause into a list of column definitions:
    [{'name': 'ColName', 'type': 'unknown', 'is_variable': False}]
    Handles aliases:
        expr AS [ColName]
        expr AS ColName
        [ColName] = expr
        @var = expr
        table.ColName
        [ColName]
    """
    # Strip leading DISTINCT, TOP n, ALL
    select_clause = re.sub(
        r"^(?:DISTINCT\s+)?(?:TOP\s+\d+\s+)?(?:ALL\s+)?",
        "",
        select_clause.strip(),
        flags=re.IGNORECASE,
    ).strip()

    columns: List[Dict[str, Any]] = []
    items: List[str] = []
    current: List[str] = []
    depth = 0
    in_single_quote = False

    for char in select_clause:
        if char == "'" and not in_single_quote:
            in_single_quote = True
        elif char == "'" and in_single_quote:
            in_single_quote = False

        if not in_single_quote:
            if char in ("(", "["):
                depth += 1
            elif char in (")", "]"):
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                item = "".join(current).strip()
                if item:
                    items.append(item)
                current = []
                continue

        current.append(char)

    if current:
        item = "".join(current).strip()
        if item:
            items.append(item)

    for item in items:
        # Check for [ColName] = expr or ColName = expr or @var = expr
        eq_match = re.match(r"^(@?[a-zA-Z0-9_]+|\[[^\]]+\])\s*=(.*)$", item, flags=re.DOTALL)
        if eq_match:
            alias = clean_identifier(eq_match.group(1))
            is_var = alias.startswith("@")
            columns.append({"name": alias, "type": "variable" if is_var else "unknown", "is_variable": is_var})
            continue

        # Check for expr AS [ColName] or expr AS ColName or expr AS @var
        as_match = re.search(r"\bAS\s+(\[[^\]]+\]|\"[^\"]+\"|@?[a-zA-Z0-9_]+)$", item, flags=re.IGNORECASE)
        if as_match:
            alias = clean_identifier(as_match.group(1))
            is_var = alias.startswith("@")
            columns.append({"name": alias, "type": "variable" if is_var else "unknown", "is_variable": is_var})
            continue

        # Check for implicit alias without AS: expr [ColName]
        implicit_match = re.search(r"[\s\)]+(\[[^\]]+\]|\"[^\"]+\"|[a-zA-Z0-9_]+)$", item)
        if implicit_match:
            candidate = clean_identifier(implicit_match.group(1))
            if candidate.upper() not in ("NULL", "DESC", "ASC", "END"):
                columns.append({"name": candidate, "type": "unknown", "is_variable": False})
                continue

        # Single identifier: e.g. a.ItemName or [ItemName]
        tokens = item.split(".")
        last_token = clean_identifier(tokens[-1])
        if last_token and not last_token.startswith("'") and not last_token.isdigit() and last_token != "*":
            is_var = last_token.startswith("@")
            columns.append({"name": last_token, "type": "variable" if is_var else "unknown", "is_variable": is_var})
        elif last_token == "*":
            columns.append({"name": "*", "type": "unknown", "is_variable": False})

    return columns


def parse_create_table_columns(ddl_sql: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    Extract columns from CREATE TABLE #temp_name (...) or table variable declarations (DECLARE @tbl TABLE (...)).
    Returns: {table_name_lower: [{'name': col, 'type': data_type}]}
    """
    results: Dict[str, List[Dict[str, Any]]] = {}

    pattern_create = re.compile(
        r"CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(#?[#a-zA-Z0-9_\[\]]+)\s*\((.*?)\)(?:\s*;|\s+ON|\s+GO|\s*$)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for m in pattern_create.finditer(ddl_sql):
        raw_name = clean_identifier(m.group(1))
        tbl_key = raw_name.lower()
        body = m.group(2)
        cols: List[Dict[str, Any]] = []

        for line in split_sql_column_definitions(body):
            line = line.strip()
            if not line:
                continue
            if re.match(r"^(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|INDEX|UNIQUE|CHECK)\b", line, re.IGNORECASE):
                continue
            parts = line.split()
            if parts:
                col_name = clean_identifier(parts[0])
                col_type = parts[1] if len(parts) > 1 else "unknown"
                cols.append({"name": col_name, "type": col_type.lower()})

        if cols:
            results[tbl_key] = cols

    pattern_declare = re.compile(
        r"DECLARE\s+(@[a-zA-Z0-9_]+)\s+TABLE\s*\((.*?)\)(?:\s*;|\s+GO|\s*$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for m in pattern_declare.finditer(ddl_sql):
        raw_name = clean_identifier(m.group(1))
        tbl_key = raw_name.lower()
        body = m.group(2)
        cols = []
        for line in split_sql_column_definitions(body):
            line = line.strip()
            if not line:
                continue
            if re.match(r"^(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|INDEX|UNIQUE|CHECK)\b", line, re.IGNORECASE):
                continue
            parts = line.split()
            if parts:
                col_name = clean_identifier(parts[0])
                col_type = parts[1] if len(parts) > 1 else "unknown"
                cols.append({"name": col_name, "type": col_type.lower()})
        if cols:
            results[tbl_key] = cols

    return results


def parse_select_into_tables(
    clean_sql: str,
    known_tables: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Extract columns from SELECT ... INTO #temp_table FROM statements.
    Resolves columns defined in the SELECT clause, including expanding SELECT * from another known temp table.
    """
    results: Dict[str, List[Dict[str, Any]]] = dict(known_tables)

    pattern = re.compile(
        r"\bSELECT\s+(?:TOP\s+\d+\s+)?((?:(?!SELECT|;).)*?)\s+\bINTO\s+(#?[#a-zA-Z0-9_\[\]]+)\s+\bFROM\s+([#a-zA-Z0-9_\[\]\.]+)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for m in pattern.finditer(clean_sql):
        select_clause = m.group(1).strip()
        into_table = clean_identifier(m.group(2)).lower()
        from_table = clean_identifier(m.group(3)).lower()

        raw_cols = extract_columns_from_select_clause(select_clause)
        resolved_cols: List[Dict[str, Any]] = []
        for c in raw_cols:
            if c.get("name") == "*" and from_table in results:
                resolved_cols.extend(results[from_table])
            elif not c.get("is_variable"):
                resolved_cols.append({"name": c["name"], "type": c.get("type", "unknown")})

        if resolved_cols:
            results[into_table] = resolved_cols

    return results


def parse_alter_table_add_columns(
    clean_sql: str,
    known_tables: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Extract columns added via ALTER TABLE #temp ADD col_name data_type ...
    """
    results: Dict[str, List[Dict[str, Any]]] = dict(known_tables)
    pattern = re.compile(
        r"\bALTER\s+TABLE\s+(#?[#a-zA-Z0-9_\[\]]+)\s+ADD\s+([a-zA-Z0-9_\[\]]+)\s+([a-zA-Z0-9_\(\)]+)",
        flags=re.IGNORECASE,
    )
    for m in pattern.finditer(clean_sql):
        tbl = clean_identifier(m.group(1)).lower()
        col = clean_identifier(m.group(2))
        col_type = m.group(3)
        if tbl in results:
            if not any(c["name"].lower() == col.lower() for c in results[tbl]):
                results[tbl].append({"name": col, "type": col_type.lower()})

    return results


def parse_postgres_cursors(func_source: str) -> List[Dict[str, Any]]:
    """
    Extract cursor result sets from PostgreSQL PL/pgSQL function:
    OPEN <cur_name> FOR SELECT ... FROM ...
    Returns: [{'name': cur_name, 'columns': [...]}]
    """
    results: List[Dict[str, Any]] = []
    clean_source = strip_sql_comments(func_source)
    masked_source, literals = mask_sql_strings(clean_source)
    temp_tables = parse_create_table_columns(masked_source)

    pattern = re.compile(
        r"OPEN\s+([a-zA-Z0-9_]+)\s+FOR\s+SELECT\s+((?:(?!SELECT|;).)*?)\s+FROM\s+([a-zA-Z0-9_\"\.]+)",
        flags=re.IGNORECASE | re.DOTALL,
    )

    for idx, m in enumerate(pattern.finditer(masked_source)):
        cur_name = m.group(1)
        select_clause = m.group(2)
        from_table = clean_identifier(m.group(3)).lower()
        cols = extract_columns_from_select_clause(select_clause)

        resolved_cols: List[Dict[str, Any]] = []
        for c in cols:
            if c.get("name") == "*" and from_table in temp_tables:
                resolved_cols.extend(temp_tables[from_table])
            elif not c.get("is_variable"):
                resolved_cols.append(c)

        results.append({
            "index": idx,
            "name": cur_name,
            "table_source": cur_name,
            "columns": resolved_cols,
        })

    # Also check dynamic SQL in literals if no static cursors
    if not results:
        for lit in literals:
            if "SELECT" in lit.upper() and "FROM" in lit.upper():
                dynamic_res = parse_sql_server_selects(lit)
                if dynamic_res:
                    return dynamic_res

    return results


def parse_sql_server_selects(proc_body: str) -> List[Dict[str, Any]]:
    """
    Find output SELECT statements in a SQL Server stored procedure.
    Filters out non-output statements:
      - INSERT INTO ... SELECT
      - SELECT ... INTO #temp (captured for temp table schema tracking)
      - SELECT @var = expr, @_param = expr (variable assignment)
      - IF EXISTS (SELECT ...)
      - Subqueries in WHERE / IN clauses
    Expands SELECT * or SELECT *, col1, col2 from parsed temp tables (CREATE TABLE, SELECT INTO, ALTER TABLE ADD).
    Handles dynamic SQL statements (EXEC, EXECUTE, sp_executesql).
    """
    clean_body = strip_sql_comments(proc_body)
    masked_body, literals = mask_sql_strings(clean_body)

    # 1. Parse temp tables created via CREATE TABLE or DECLARE @tbl TABLE
    temp_tables = parse_create_table_columns(masked_body)

    # 2. Parse temp tables created via SELECT ... INTO #temp
    temp_tables = parse_select_into_tables(masked_body, temp_tables)

    # 3. Parse columns added via ALTER TABLE #temp ADD col_name ...
    temp_tables = parse_alter_table_add_columns(masked_body, temp_tables)

    # 4. Tokenize for statement boundary and control flow scanning
    tok_pattern = re.compile(
        r"(\bSELECT\b|\bFROM\b|\bINTO\b|\bINSERT\b|\bWHERE\b|\bEXISTS\b|\bIN\b|\bBEGIN\b|\bEND\b|\bCASE\b|\bWHEN\b|\bTHEN\b|\bELSE\b|\bUPDATE\b|\bDELETE\b|\bCREATE\b|\bALTER\b|\bDROP\b|\bSET\b|\bDECLARE\b|\bEXEC\b|\bEXECUTE\b|\bRETURN\b|\bWHILE\b|\bIF\b|;|\(|\)|,|[#@a-zA-Z0-9_\[\]\.\*]+)",
        flags=re.IGNORECASE,
    )

    all_tokens: List[Tuple[str, int, int]] = []
    for m in tok_pattern.finditer(masked_body):
        all_tokens.append((m.group(0), m.start(), m.end()))

    STMT_STARTERS = {
        ";", "GO", "BEGIN", "END", "RETURN", "INSERT", "UPDATE", "DELETE",
        "DROP", "ALTER", "CREATE", "SET", "DECLARE", "EXEC", "EXECUTE",
        "IF", "WHILE", "PRINT", "TRUNCATE", "MERGE"
    }

    results: List[Dict[str, Any]] = []

    for i, (tok, start, end) in enumerate(all_tokens):
        if tok.upper() != "SELECT":
            continue

        # 1. Look backwards: Is this SELECT inside parentheses, or directly part of an INSERT statement?
        is_subquery_or_insert = False
        j = i - 1
        paren_depth = 0
        while j >= 0:
            prev_tok = all_tokens[j][0].upper()
            if prev_tok == ")":
                paren_depth += 1
            elif prev_tok == "(":
                if paren_depth > 0:
                    paren_depth -= 1
                else:
                    # Inside unclosed parenthesis (e.g. EXISTS(SELECT...), IN (SELECT...))
                    is_subquery_or_insert = True
                    break
            elif paren_depth == 0:
                if prev_tok in STMT_STARTERS:
                    if prev_tok == "INSERT":
                        is_subquery_or_insert = True
                    break
            j -= 1

        if is_subquery_or_insert:
            continue

        # 2. Forward scan: find INTO, FROM, and statement termination
        k = i + 1
        p_depth = 0
        c_depth = 0
        from_token_idx: Optional[int] = None
        has_into = False
        stmt_end_idx: Optional[int] = None

        while k < len(all_tokens):
            t = all_tokens[k][0].upper()
            if t == "(":
                p_depth += 1
            elif t == ")":
                p_depth = max(0, p_depth - 1)
            elif t == "CASE":
                c_depth += 1
            elif t == "END":
                if c_depth > 0:
                    c_depth -= 1
                elif p_depth == 0:
                    stmt_end_idx = k
                    break
            elif p_depth == 0 and c_depth == 0:
                if t == "INTO" and from_token_idx is None:
                    has_into = True
                elif t == "FROM" and from_token_idx is None:
                    from_token_idx = k
                elif from_token_idx is not None and t in STMT_STARTERS:
                    stmt_end_idx = k
                    break
            k += 1

        if stmt_end_idx is None:
            stmt_end_idx = k

        if has_into:
            continue
        if from_token_idx is None:
            continue

        select_start = all_tokens[i][2]
        from_pos = all_tokens[from_token_idx][1]
        select_clause = masked_body[select_start:from_pos].strip()

        from_table_tok = all_tokens[from_token_idx + 1][0] if from_token_idx + 1 < len(all_tokens) else ""
        from_table = clean_identifier(from_table_tok)
        from_table_key = from_table.lower()

        raw_cols = extract_columns_from_select_clause(select_clause)

        # Filter out variable assignments: if all columns are variables (@var = ...), skip it
        if raw_cols and all(c.get("is_variable", False) for c in raw_cols):
            continue

        # Filter out any variable assignment columns from output columns
        data_cols = [c for c in raw_cols if not c.get("is_variable", False)]

        # Expand * if from known temp tables
        if any(c.get("name") == "*" for c in data_cols):
            resolved_cols: List[Dict[str, Any]] = []
            for c in data_cols:
                if c.get("name") == "*" and from_table_key in temp_tables:
                    for tc in temp_tables[from_table_key]:
                        resolved_cols.append({"name": tc["name"], "type": tc.get("type", "unknown")})
                else:
                    resolved_cols.append({"name": c["name"], "type": c.get("type", "unknown")})
            data_cols = resolved_cols

        if data_cols:
            table_name = f"Table{len(results)}"
            results.append({
                "index": len(results),
                "name": table_name,
                "table_source": from_table,
                "columns": data_cols,
            })

    # 5. Handle dynamic SQL (EXEC / EXECUTE / sp_executesql)
    # If no results or if procedure uses dynamic SQL to return tables:
    if not results:
        for lit in literals:
            # Check if literal has a SELECT statement returning data
            if re.search(r"\bSELECT\b.*?\bFROM\b", lit, flags=re.IGNORECASE | re.DOTALL):
                dyn_res = parse_sql_server_selects(lit)
                if dyn_res:
                    for r in dyn_res:
                        r["index"] = len(results)
                        r["name"] = f"Table{len(results)}"
                        results.append(r)

    return results
