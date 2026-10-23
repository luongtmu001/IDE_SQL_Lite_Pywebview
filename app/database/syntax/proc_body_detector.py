# -*- coding: utf-8 -*-
"""
Procedural SQL Detector and Extractor.
Identifies stored procedures, functions, triggers, and procedural blocks (PL/pgSQL DO $$),
and extracts parameter names and local variable declarations for both SQL Server and PostgreSQL.

Used by:
- Semantic Analyzer (to whitelist procedure parameters and local variables, avoiding false positives)
- Validator MSSQL (to accurately map line offsets for procedure syntax errors)
- Validator PG (to recognize PL/pgSQL routines and avoid inappropriate EXPLAIN/sqlglot routing)
"""
from __future__ import annotations

import re
from typing import Any

# Match T-SQL and PostgreSQL procedure/function/trigger definitions
_PROC_DEF_REGEX = re.compile(
    r"\b(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+(PROCEDURE|PROC|FUNCTION|TRIGGER)\s+([#@\w\.\"\[\]]+)",
    re.IGNORECASE,
)

_PG_DO_REGEX = re.compile(
    r"\bDO\s+(?:LANGUAGE\s+[a-zA-Z0-9_]+\s+)?(\$[a-zA-Z0-9_]*\$)",
    re.IGNORECASE,
)

_TSQL_PROC_START_REGEX = re.compile(
    r"\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER)\s+(?:PROCEDURE|PROC|FUNCTION|TRIGGER)\b",
    re.IGNORECASE,
)

_PG_PROC_START_REGEX = re.compile(
    r"\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER)\s+(?:FUNCTION|PROCEDURE|TRIGGER)\b|\bDO\s+(?:LANGUAGE\s+[a-zA-Z0-9_]+\s+)?\$",
    re.IGNORECASE,
)

# Common data type keywords in PostgreSQL to distinguish parameter names from types
_PG_DATATYPE_KEYWORDS = {
    "integer", "int", "int2", "int4", "int8", "smallint", "bigint", "serial", "bigserial",
    "decimal", "numeric", "real", "float", "float4", "float8", "double", "precision",
    "character", "varchar", "char", "bpchar", "text", "citext",
    "boolean", "bool",
    "date", "time", "timestamp", "timestamptz", "interval",
    "bytea", "json", "jsonb", "xml", "uuid",
    "record", "void", "trigger", "anyelement", "anyarray", "table", "refcursor", "cursor",
}

_PG_PARAM_MODES = {"in", "out", "inout", "variadic"}


def clean_ident(ident: str) -> str:
    """Clean identifier of quotes and brackets."""
    if not ident:
        return ""
    s = ident.strip()
    if (s.startswith("[") and s.endswith("]")) or (s.startswith('"') and s.endswith('"')):
        s = s[1:-1].strip()
    return s


def is_procedural_sql(sql: str, dialect: str = "sqlserver") -> bool:
    """
    Check if the given SQL contains stored procedure, function, trigger,
    or procedural execution block (e.g. DO $$ in PostgreSQL).
    """
    if not sql or not sql.strip():
        return False

    d = dialect.lower()
    is_pg = "postgres" in d or "pgsql" in d or d == "pg"

    if is_pg:
        # Check PostgreSQL procedural indicators
        if _PG_PROC_START_REGEX.search(sql):
            return True
        if "LANGUAGE plpgsql" in sql or "language plpgsql" in sql.lower():
            return True
        if _PG_DO_REGEX.search(sql):
            return True
    else:
        # Check T-SQL procedural indicators
        if _TSQL_PROC_START_REGEX.search(sql):
            return True

    return False


def extract_proc_bodies(sql: str, dialect: str = "sqlserver") -> list[dict[str, Any]]:
    """
    Extract procedure/function/trigger definitions from SQL text with line numbers.
    Returns a list of dicts:
    [
        {
            "name": str,
            "clean_name": str,
            "type": str,               # 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'DO_BLOCK'
            "start_line": int,         # 1-based line in the document where routine begins
            "header": str,
            "body": str,
            "body_start_line": int,
            "params": list[str],
        },
        ...
    ]
    """
    if not sql or not sql.strip():
        return []

    d = dialect.lower()
    is_pg = "postgres" in d or "pgsql" in d or d == "pg"
    results: list[dict[str, Any]] = []

    # 1. Search for CREATE/ALTER PROCEDURE/FUNCTION/TRIGGER
    for m in _PROC_DEF_REGEX.finditer(sql):
        routine_type = m.group(1).upper()
        if routine_type == "PROC":
            routine_type = "PROCEDURE"
        raw_name = m.group(2).strip()
        parts = [clean_ident(p) for p in raw_name.split(".") if p.strip()]
        clean_name = parts[-1] if parts else raw_name

        def_start_pos = m.start()
        start_line = sql[:def_start_pos].count("\n") + 1

        # Determine parameter header and body position
        params: list[str] = []
        body_start_line = start_line

        if is_pg:
            # PostgreSQL: look for parameter list in parentheses right after function name
            after_name = sql[m.end():]
            paren_start = after_name.find("(")
            if paren_start != -1 and paren_start < 60:
                # Find matching closing parenthesis
                depth = 0
                paren_end = -1
                for idx_c, ch in enumerate(after_name[paren_start:]):
                    if ch == "(":
                        depth += 1
                    elif ch == ")":
                        depth -= 1
                        if depth == 0:
                            paren_end = paren_start + idx_c
                            break
                if paren_end != -1:
                    param_str = after_name[paren_start + 1 : paren_end]
                    params = _extract_pg_params_from_header(param_str)

            # Find body start in PostgreSQL (e.g. after $$ or AS $)
            dollar_m = re.search(r"(\$[a-zA-Z0-9_]*\$)", after_name)
            if dollar_m:
                abs_dollar_pos = m.end() + dollar_m.end()
                body_start_line = sql[:abs_dollar_pos].count("\n") + 1
        else:
            # T-SQL: parameters are defined between proc name and AS / BEGIN
            after_name = sql[m.end():]
            as_match = re.search(r"\bAS\b", after_name, re.IGNORECASE)
            if as_match:
                param_str = after_name[: as_match.start()]
                params = _extract_tsql_params_from_header(param_str)
                abs_as_pos = m.end() + as_match.end()
                body_start_line = sql[:abs_as_pos].count("\n") + 1
            else:
                params = _extract_tsql_params_from_header(after_name[:500])

        results.append({
            "name": raw_name,
            "clean_name": clean_name.lower(),
            "type": routine_type,
            "start_line": start_line,
            "body_start_line": body_start_line,
            "params": params,
        })

    # 2. Check for PostgreSQL DO $$ blocks
    if is_pg:
        for do_m in _PG_DO_REGEX.finditer(sql):
            tag = do_m.group(1)
            start_pos = do_m.start()
            start_line = sql[:start_pos].count("\n") + 1
            body_start_pos = do_m.end()
            body_start_line = sql[:body_start_pos].count("\n") + 1

            results.append({
                "name": "DO_BLOCK",
                "clean_name": "do_block",
                "type": "DO_BLOCK",
                "start_line": start_line,
                "body_start_line": body_start_line,
                "params": [],
            })

    return results


def _extract_tsql_params_from_header(header_text: str) -> list[str]:
    """Extract parameter names starting with @ from T-SQL procedure/function header."""
    if not header_text:
        return []
    # Match any @ParamName
    param_matches = re.findall(r"@([a-zA-Z0-9_]+)", header_text)
    return [f"@{p.lower()}" for p in param_matches]


def _extract_pg_params_from_header(header_text: str) -> list[str]:
    """Extract parameter names from PostgreSQL function signature."""
    if not header_text:
        return []

    params: list[str] = []
    # Split by comma at depth 0 (ignoring nested commas like numeric(10,2))
    depth = 0
    curr: list[str] = []
    items: list[str] = []

    for ch in header_text:
        if ch == "(":
            depth += 1
            curr.append(ch)
        elif ch == ")":
            depth = max(0, depth - 1)
            curr.append(ch)
        elif ch == "," and depth == 0:
            it = "".join(curr).strip()
            if it:
                items.append(it)
            curr = []
        else:
            curr.append(ch)
    last_it = "".join(curr).strip()
    if last_it:
        items.append(last_it)

    for item in items:
        # Strip default expressions: param_name type DEFAULT val, or param_name type = val
        item_no_default = re.split(r"\bDEFAULT\b|=", item, flags=re.IGNORECASE)[0].strip()
        tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*|\"[^\"]+\"", item_no_default)
        if not tokens:
            continue

        # Strip mode keywords (IN, OUT, INOUT, VARIADIC)
        while tokens and tokens[0].lower() in _PG_PARAM_MODES:
            tokens.pop(0)

        if not tokens:
            continue

        # The first token is the parameter name (if named)
        first_tok = clean_ident(tokens[0])
        first_lower = first_tok.lower()

        # If the parameter list has no names, e.g. foo(integer, text), first token is a datatype
        if first_lower not in _PG_DATATYPE_KEYWORDS:
            params.append(first_lower)

    return params


def get_proc_params_from_sql(sql: str, dialect: str = "sqlserver") -> dict[str, list[str]]:
    """
    Extract a dictionary of {routine_name_lower: [param_names_lower]} from the SQL text.
    """
    procs = extract_proc_bodies(sql, dialect)
    return {p["clean_name"]: p["params"] for p in procs}


def get_proc_local_identifiers(sql: str, dialect: str = "sqlserver") -> set[str]:
    """
    Collect all procedure parameters and local variables declared in the SQL script.
    - SQL Server: @params, DECLARE @var
    - PostgreSQL: parameters from signatures, variables declared in DECLARE blocks,
      loop control variables (FOR rec IN ... LOOP).

    Returns a set of lowercase identifier names that should NOT be flagged as missing table columns.
    """
    if not sql:
        return set()

    d = dialect.lower()
    is_pg = "postgres" in d or "pgsql" in d or d == "pg"
    identifiers: set[str] = set()

    # 1. Procedure/function parameters
    procs = extract_proc_bodies(sql, dialect)
    for p in procs:
        for param in p.get("params", []):
            clean_p = param.lstrip("@").lower() if not is_pg else param.lower()
            identifiers.add(clean_p)
            if not is_pg:
                identifiers.add(f"@{clean_p}")

    # 2. Local variables
    if is_pg:
        # PostgreSQL DECLARE blocks:
        # DECLARE
        #     var_name datatype [:= default];
        #     var_name2 text;
        # BEGIN
        declare_blocks = re.findall(
            r"\bDECLARE\s+(.*?)\bBEGIN\b",
            sql,
            re.IGNORECASE | re.DOTALL,
        )
        for block in declare_blocks:
            # Each statement in declare block is separated by semicolon
            for decl in block.split(";"):
                decl_clean = re.sub(r"--.*$", "", decl, flags=re.MULTILINE)
                decl_clean = re.sub(r"/\*.*?\*/", " ", decl_clean, flags=re.DOTALL).strip()
                if not decl_clean:
                    continue
                # Match identifier at start of declaration
                m_var = re.match(r"^\s*([a-zA-Z_][a-zA-Z0-9_]*|\"[^\"]+\")", decl_clean)
                if m_var:
                    var_name = clean_ident(m_var.group(1)).lower()
                    if var_name not in _PG_DATATYPE_KEYWORDS and var_name not in ("constant", "cursor"):
                        identifiers.add(var_name)

        # PL/pgSQL FOR loop record variables: FOR var_name IN ... LOOP
        for for_m in re.finditer(r"\bFOR\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\b", sql, re.IGNORECASE):
            identifiers.add(for_m.group(1).lower())

        # PL/pgSQL FOREACH loop variables: FOREACH var_name IN ARRAY ... LOOP
        for fe_m in re.finditer(r"\bFOREACH\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+IN\s+ARRAY\b", sql, re.IGNORECASE):
            identifiers.add(fe_m.group(1).lower())

    else:
        # T-SQL: DECLARE @var datatype, @var2 datatype
        # Variables in T-SQL are prefixed with @
        for var_m in re.finditer(r"@([a-zA-Z0-9_]+)", sql):
            v_name = var_m.group(1).lower()
            identifiers.add(v_name)
            identifiers.add(f"@{v_name}")

    return identifiers
