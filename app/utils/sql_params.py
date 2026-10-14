"""
SQL Script Parameter Parser & Safe Substituter (Mục 5.2)

Supports:
1. Parameter declaration via header comments:
   -- @param name: type = default
   Supported types: 'string', 'number', 'identifier', 'date'
2. Placeholder syntax in query body:
   {{name}}
3. SQL Injection Prevention:
   - string: escaped with single quotes (e.g. 'O''Reilly')
   - number: validated strictly as int or float
   - identifier: quoted with [name] (T-SQL) or "name" (PostgreSQL)
   - date: validated format (YYYY-MM-DD / YYYY-MM-DD HH:MM:SS) and escaped as literal
4. Safe replacement:
   - Ignores {{...}} occurring inside comments, string literals, or dollar-quoted blocks.
"""

import re
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional


PARAM_DECL_PATTERN = re.compile(
    r"^\s*--\s*@param\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z]+)(?:\s*=\s*(.*?))?\s*$",
    re.MULTILINE
)


def extract_param_declarations(sql: str) -> Dict[str, Dict[str, Any]]:
    """
    Extract parameter declarations from comment headers in the SQL script.
    Format:
        -- @param customer_id: number = 100
        -- @param order_date: date = 2026-01-01
        -- @param status: string = active
        -- @param tbl_name: identifier = Customers
    """
    declarations: Dict[str, Dict[str, Any]] = {}
    if not sql:
        return declarations

    for match in PARAM_DECL_PATTERN.finditer(sql):
        name = match.group(1).strip()
        p_type = match.group(2).strip().lower()
        default_val = match.group(3)
        if default_val is not None:
            default_val = default_val.strip()
            # Strip surrounding quotes from default value if present
            if (default_val.startswith("'") and default_val.endswith("'")) or \
               (default_val.startswith('"') and default_val.endswith('"')):
                default_val = default_val[1:-1]
        else:
            default_val = ""

        # Validate type
        if p_type not in ("string", "number", "identifier", "date"):
            p_type = "string"

        declarations[name] = {
            "name": name,
            "type": p_type,
            "default": default_val,
        }

    return declarations


def find_param_placeholders(sql: str, dialect: str = "sqlserver") -> List[Dict[str, Any]]:
    """
    Find all parameter placeholders {{name}} in SQL, ignoring those inside:
    - String literals ('...')
    - Comments (-- and /* */)
    - Dollar-quoted blocks ($$...$$) in PostgreSQL
    - Quoted identifiers ([...] or "...")
    """
    if not sql or "{{" not in sql:
        return []

    is_pg = any(k in str(dialect).lower() for k in ("postgr", "pg"))
    length = len(sql)
    found_placeholders: List[Dict[str, Any]] = []
    seen_names = set()

    i = 0
    current_line = 1

    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        if ch == "\n":
            current_line += 1
            i += 1
            continue

        # 1. Single-line comment
        if ch == "-" and next_ch == "-":
            i += 2
            while i < length and sql[i] != "\n":
                i += 1
            continue

        # 2. Multi-line comment
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

        # 3. String literal
        if ch == "'" or (ch in ("N", "n") and next_ch == "'"):
            if ch in ("N", "n"):
                i += 1
            i += 1
            while i < length:
                if sql[i] == "\n":
                    current_line += 1
                if sql[i] == "'":
                    if i + 1 < length and sql[i + 1] == "'":
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                i += 1
            continue

        # 4. Dollar-quoted blocks (PostgreSQL)
        if is_pg and ch == "$":
            m_dollar = re.match(r"^\$([a-zA-Z0-9_]*)\$", sql[i:])
            if m_dollar:
                tag = m_dollar.group(0)
                closing_idx = sql.find(tag, i + len(tag))
                if closing_idx != -1:
                    inner = sql[i:closing_idx + len(tag)]
                    current_line += inner.count("\n")
                    i = closing_idx + len(tag)
                    continue

        # 5. Identifier quotes
        if ch == '"':
            i += 1
            while i < length and sql[i] != '"':
                if sql[i] == "\n":
                    current_line += 1
                i += 1
            if i < length:
                i += 1
            continue

        if not is_pg and ch == "[":
            i += 1
            while i < length and sql[i] != "]":
                if sql[i] == "\n":
                    current_line += 1
                i += 1
            if i < length:
                i += 1
            continue

        # 6. Check for {{param_name}}
        if ch == "{" and next_ch == "{":
            m = re.match(r"^\{\{([a-zA-Z0-9_]+)\}\}", sql[i:])
            if m:
                p_name = m.group(1)
                full_token = m.group(0)
                if p_name not in seen_names:
                    seen_names.add(p_name)
                    found_placeholders.append({
                        "name": p_name,
                        "line": current_line,
                        "raw": full_token
                    })
                i += len(full_token)
                continue

        i += 1

    return found_placeholders


def get_query_parameters(sql: str, dialect: str = "sqlserver") -> List[Dict[str, Any]]:
    """
    Inspect the SQL query and return a unified list of required parameters
    with their declared types and default values.
    """
    declarations = extract_param_declarations(sql)
    placeholders = find_param_placeholders(sql, dialect)

    result_params: List[Dict[str, Any]] = []
    seen = set()

    # Process placeholders found in code
    for ph in placeholders:
        name = ph["name"]
        decl = declarations.get(name, {})
        result_params.append({
            "name": name,
            "type": decl.get("type", "string"),
            "default": decl.get("default", ""),
            "line": ph.get("line", 1)
        })
        seen.add(name)

    # Include any declared params that might not have appeared in placeholders yet
    for name, decl in declarations.items():
        if name not in seen:
            result_params.append({
                "name": name,
                "type": decl.get("type", "string"),
                "default": decl.get("default", ""),
                "line": 1
            })
            seen.add(name)

    return result_params


def format_safe_param_value(value: Any, p_type: str, dialect: str = "sqlserver") -> str:
    """
    Format and safely escape a parameter value according to its declared type.
    Strictly prevents SQL Injection.
    """
    is_pg = any(k in str(dialect).lower() for k in ("postgr", "pg"))
    p_type = (p_type or "string").lower()
    val_str = "" if value is None else str(value).strip()

    if p_type == "number":
        if not val_str:
            return "0"
        # Validate integer or float (supports negative and scientific notation)
        if not re.match(r"^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$", val_str):
            raise ValueError(f"Giá trị '{val_str}' không phải là số hợp lệ cho tham số kiểu number.")
        return val_str

    elif p_type == "identifier":
        if not val_str:
            raise ValueError("Tên identifier không được để trống.")
        # Sanitize identifier: prevent unmatched quotes or brackets
        if is_pg:
            clean_ident = val_str.replace('"', '""')
            return f'"{clean_ident}"'
        else:
            clean_ident = val_str.replace("]", "]]")
            return f"[{clean_ident}]"

    elif p_type == "date":
        if not val_str:
            return "NULL"
        # Verify valid date or datetime
        valid_date = False
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(val_str, fmt)
                val_str = dt.strftime("%Y-%m-%d %H:%M:%S" if (" " in fmt or "T" in fmt) else "%Y-%m-%d")
                valid_date = True
                break
            except ValueError:
                continue

        if not valid_date:
            raise ValueError(f"Giá trị '{val_str}' không đúng định dạng ngày tháng hợp lệ (YYYY-MM-DD).")
        # Escaped string literal
        escaped = val_str.replace("'", "''")
        return f"'{escaped}'"

    else:
        # Default: string
        # Standard SQL string literal with single quote escaping
        escaped = val_str.replace("'", "''")
        if not is_pg:
            # SQL Server supports Unicode string literal N'...'
            return f"N'{escaped}'"
        return f"'{escaped}'"


def substitute_parameters(sql: str, params: Dict[str, Any], dialect: str = "sqlserver") -> str:
    """
    Substitute {{param_name}} in SQL with safely escaped values.
    Preserves {{...}} inside comments, strings, or dollar-quoted blocks.
    """
    if not sql or "{{" not in sql:
        return sql

    is_pg = any(k in str(dialect).lower() for k in ("postgr", "pg"))
    param_meta = {p["name"]: p for p in get_query_parameters(sql, dialect)}

    # Map of safely formatted values
    formatted_values: Dict[str, str] = {}
    for name, meta in param_meta.items():
        raw_val = params.get(name)
        if raw_val is None or str(raw_val).strip() == "":
            raw_val = meta.get("default", "")
        formatted_values[name] = format_safe_param_value(raw_val, meta.get("type", "string"), dialect)

    # Tokenizer-based replacement
    length = len(sql)
    out: List[str] = []
    i = 0

    while i < length:
        ch = sql[i]
        next_ch = sql[i + 1] if i + 1 < length else ""

        # 1. Single-line comment
        if ch == "-" and next_ch == "-":
            start = i
            i += 2
            while i < length and sql[i] != "\n":
                i += 1
            out.append(sql[start:i])
            continue

        # 2. Multi-line comment
        if ch == "/" and next_ch == "*":
            start = i
            i += 2
            while i < length - 1 and not (sql[i] == "*" and sql[i + 1] == "/"):
                i += 1
            i = min(i + 2, length)
            out.append(sql[start:i])
            continue

        # 3. String literal
        if ch == "'" or (ch in ("N", "n") and next_ch == "'"):
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
            out.append(sql[start:i])
            continue

        # 4. Dollar-quoted blocks (PostgreSQL)
        if is_pg and ch == "$":
            m_dollar = re.match(r"^\$([a-zA-Z0-9_]*)\$", sql[i:])
            if m_dollar:
                tag = m_dollar.group(0)
                closing_idx = sql.find(tag, i + len(tag))
                if closing_idx != -1:
                    end_idx = closing_idx + len(tag)
                    out.append(sql[i:end_idx])
                    i = end_idx
                    continue

        # 5. Identifier quotes
        if ch == '"':
            start = i
            i += 1
            while i < length and sql[i] != '"':
                i += 1
            if i < length:
                i += 1
            out.append(sql[start:i])
            continue

        if not is_pg and ch == "[":
            start = i
            i += 1
            while i < length and sql[i] != "]":
                i += 1
            if i < length:
                i += 1
            out.append(sql[start:i])
            continue

        # 6. Placeholder replacement
        if ch == "{" and next_ch == "{":
            m = re.match(r"^\{\{([a-zA-Z0-9_]+)\}\}", sql[i:])
            if m:
                p_name = m.group(1)
                if p_name in formatted_values:
                    out.append(formatted_values[p_name])
                    i += len(m.group(0))
                    continue

        out.append(ch)
        i += 1

    return "".join(out)
